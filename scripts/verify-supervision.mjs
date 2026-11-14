// Kooyu (Kooyu kernel) delegates to a real Codex app-server and resumes from a Host wake.
// Runs two native model routes and may incur usage. Never modifies files.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { Store } from "../packages/host/dist/storage/store.js";
import { SessionService } from "../packages/host/dist/session-service.js";
const dataDir = resolve(`.local/verification/supervision-${Date.now()}`);
mkdirSync(dataDir, { recursive: true });
const store = new Store(join(dataDir, "state.sqlite")),
  service = new SessionService(store, { dataDir });
const report = { result: "unverified", startedAt: new Date().toISOString(), checks: {} };
try {
  const project = service.createProject({
      name: "Native supervision verification",
      rootPath: process.cwd(),
    }),
    workspace = store.workspaces().find((w) => w.projectId === project.id);
  const controller = service.createDraft({
    title: "Native Kooyu supervision verification",
    harnessId: "kodo",
    kind: "supervisor",
    model: `${process.env.KODO_VERIFY_PI_PROVIDER ?? "codegoai"}/${process.env.KODO_VERIFY_PI_MODEL ?? "deepseek-v4-flash"}`,
  });
  service.grantProject(controller.id, project.id, {
    mode: "create-and-control",
    limits: { maxContinuations: 3, maxFailures: 2 },
  });
  const prompt = `This is a bounded native integration check. Use only the six harness_* tools, never file/shell tools. First call harness_list once. Then create exactly ONE direct Codex session using harness_open with harnessId codex, projectId ${project.id}, workspaceId ${workspace.id}, title Native delegation check. Do not open any other session. For this new target, call harness_watch with mode continue and goal: When a durable harness-event arrives, call harness_read on the target; if its reply contains KODO_NATIVE_DELEGATED_OK, call harness_stop on that target with pause true, then reply KODO_SUPERVISION_OK. Next call harness_send on that target exactly once with text: Reply exactly KODO_NATIVE_DELEGATED_OK. Do not use tools, read files or change anything. After send is accepted, end your current turn with WAITING_FOR_HOST_EVENT. Do not poll. A durable harness-event will wake you. On that later wake follow the watch goal, never send a second target message.`;
  const initial = crypto.randomUUID();
  service.acceptSend(controller.id, { requestId: initial, text: prompt, mode: "new" });
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    const events = store.events(controller.id, 0, 1000);
    if (
      events.some(
        (e) =>
          e.type === "message" &&
          e.payload?.role !== "user" &&
          JSON.stringify(e.payload).includes("KODO_SUPERVISION_OK"),
      ) &&
      store
        .commands(controller.id)
        .filter((c) => c.origin === "wake")
        .some((c) => c.status === "confirmed")
    )
      break;
    if (["unknown", "rejected"].includes(store.command(initial)?.status)) break;
  }
  const events = store.events(controller.id, 0, 1000),
    targets = store.sessions().filter((s) => s.kind === "direct");
  const tools = [
    ...new Set(
      events
        .filter((e) => e.type === "tool")
        .map((e) => e.payload?.toolName ?? e.payload?.name)
        .filter(Boolean),
    ),
  ];
  const expected = [
    "harness_list",
    "harness_open",
    "harness_watch",
    "harness_send",
    "harness_read",
    "harness_stop",
  ];
  report.tools = tools;
  report.checks.sixProductTools = expected.every((t) => tools.includes(t));
  report.checks.oneNativeTarget = targets.length === 1 && Boolean(targets[0].nativeSessionId);
  report.checks.oneNativeSend =
    targets.length === 1 &&
    store.commands(targets[0].id).filter((c) => c.kind === "send" && c.status === "confirmed")
      .length === 1;
  report.checks.nativeReply =
    targets.length === 1 &&
    store
      .events(targets[0].id, 0, 1000)
      .some(
        (e) =>
          e.type === "message" &&
          e.payload?.role !== "user" &&
          JSON.stringify(e.payload).includes("KODO_NATIVE_DELEGATED_OK"),
      );
  report.checks.persistedWake = store
    .commands(controller.id)
    .some((c) => c.origin === "wake" && c.status === "confirmed");
  report.checks.pausedAfterStop = store
    .watches()
    .some(
      (w) =>
        w.controllerSessionId === controller.id && w.mode === "continue" && w.state === "paused",
    );
  report.checks.controllerReply = events.some(
    (e) =>
      e.type === "message" &&
      e.payload?.role !== "user" &&
      JSON.stringify(e.payload).includes("KODO_SUPERVISION_OK"),
  );
  report.nativeIds = {
    kodo: store.session(controller.id).nativeSessionId,
    codex: targets[0]?.nativeSessionId,
  };
  report.commands = store.commands().map(({ id, sessionId, kind, origin, status, error }) => ({
    id,
    sessionId,
    kind,
    origin,
    status,
    error,
  }));
  report.result = Object.values(report.checks).every(Boolean) ? "passed" : "not-passed";
} catch (error) {
  report.result = "failed";
  report.error = error.message;
} finally {
  for (const s of store.sessions()) await service.stop(s.id, true);
  await service.dispose();
  store.close();
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(dataDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (report.result !== "passed") process.exitCode = 1;
}
