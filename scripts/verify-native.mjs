// Explicit live verification: sends one small prompt through an original harness.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { Store } from "../packages/host/dist/storage/store.js";
import { SessionService } from "../packages/host/dist/session-service.js";
const harness = process.argv[2] ?? "codex",
  dataDir = resolve(".local/verification/native-" + harness);
mkdirSync(dataDir, { recursive: true });
const store = new Store(join(dataDir, "kodo.sqlite")),
  service = new SessionService(store, { dataDir });
let session;
const report = {
  harness,
  startedAt: new Date().toISOString(),
  nativeSessionId: null,
  commandStatus: null,
  eventTypes: [],
  assistantText: [],
  result: "unverified",
};
try {
  const project = service.createProject({
    name: "Native live verification",
    rootPath: process.cwd(),
  });
  session = service.createDraft({
    title: "Live protocol check — no file changes",
    harnessId: harness,
    kind: harness === "kodo" ? "supervisor" : "direct",
    projectId: project.id,
    workspaceId: service.snapshot().workspaces.find((w) => w.projectId === project.id).id,
    ...(harness === "deepseek-harness"
      ? { model: "deepseek-official/deepseek-v4-flash" }
      : ["kodo", "pi"].includes(harness) &&
          process.env.KODO_VERIFY_PI_PROVIDER &&
          process.env.KODO_VERIFY_PI_MODEL
        ? { model: `${process.env.KODO_VERIFY_PI_PROVIDER}/${process.env.KODO_VERIFY_PI_MODEL}` }
        : {}),
  });
  if (
    ["kodo", "pi"].includes(harness) &&
    process.env.KODO_VERIFY_PI_PROVIDER &&
    process.env.KODO_VERIFY_PI_MODEL
  ) {
    report.route = {
      provider: process.env.KODO_VERIFY_PI_PROVIDER,
      model: process.env.KODO_VERIFY_PI_MODEL,
    };
  }
  await service.openNative(session.id);
  report.nativeSessionId = store.session(session.id).nativeSessionId;
  const id = crypto.randomUUID();
  service.acceptSend(session.id, {
    requestId: id,
    text: "Reply with exactly KODO_NATIVE_OK. Do not use tools, read files, or change anything.",
    mode: "new",
  });
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    const c = store.command(id),
      s = store.session(session.id);
    report.commandStatus = c?.status;
    if (["unknown", "rejected"].includes(c?.status)) {
      report.error = c.error;
      break;
    }
    if (c?.status === "confirmed" && s.runState === "idle") break;
  }
  const events = service.events(session.id);
  report.eventTypes = [...new Set(events.map((e) => e.type))];
  report.assistantText = events
    .filter((e) => e.type === "message" && e.payload?.role !== "user")
    .map((e) => e.payload?.text ?? e.payload?.content ?? e.payload);
  report.result =
    report.commandStatus === "confirmed" &&
    events.some((e) => e.type === "turn-ended") &&
    JSON.stringify(report.assistantText).includes("KODO_NATIVE_OK")
      ? "passed"
      : "not-passed";
} catch (error) {
  report.error = error.message;
  report.result = "blocked-or-failed";
} finally {
  if (session) await service.stop(session.id, true);
  await service.dispose();
  store.close();
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(dataDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (report.result !== "passed") process.exitCode = 1;
}
