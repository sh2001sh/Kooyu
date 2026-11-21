// A bounded real native request, requesting interruption after streaming starts. Uses the
// existing native login and incurs model usage. Never changes files.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { Store } from "../packages/host/dist/storage/store.js";
import { SessionService } from "../packages/host/dist/session-service.js";
const harness = process.argv[2] ?? "pi";
if (!["kodo", "pi", "codex", "claude-code"].includes(harness))
  throw new Error("This check supports Kooyu, pi, Codex and Claude Code only.");
const dataDir = resolve(`.local/verification/cancel-${harness}-${Date.now()}`);
mkdirSync(dataDir, { recursive: true });
const store = new Store(join(dataDir, "state.sqlite")),
  service = new SessionService(store, { dataDir });
const report = { harness, startedAt: new Date().toISOString(), result: "unverified", checks: {} };
async function waitFor(check, ms = 60000) {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error("Native verification deadline exceeded");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
try {
  const project = service.createProject({
      name: "Native cancel verification",
      rootPath: process.cwd(),
    }),
    workspace = store.workspaces().find((w) => w.projectId === project.id);
  const session = service.createDraft({
    title: "Native cancellation verification",
    harnessId: harness,
    kind: harness === "kodo" ? "supervisor" : "direct",
    projectId: project.id,
    workspaceId: workspace.id,
    ...(["pi", "kodo"].includes(harness)
      ? {
          model: `${process.env.KODO_VERIFY_PROVIDER ?? "openai"}/${process.env.KODO_VERIFY_MODEL ?? "gpt-4o-mini"}`,
        }
      : {}),
  });
  const requestId = crypto.randomUUID();
  service.acceptSend(session.id, {
    requestId,
    text: "For a cancellation check, output integers from 1 through 10000, one per line. Start immediately. Do not use tools, read files, or change anything. The Host will interrupt your reply.",
    mode: "new",
  });
  await waitFor(() => {
    const command = store.command(requestId);
    if (["unknown", "rejected"].includes(command?.status)) throw new Error(command.error);
    return store.events(session.id).some((e) => e.type === "text-delta");
  });
  if (store.session(session.id).runState !== "running")
    throw new Error("Native turn ended before interruption; in-flight cancellation unverified");
  const cursor = store.latestSequence(session.id),
    stopId = crypto.randomUUID();
  report.receipt = await service.stop(session.id, true, stopId);
  report.checks.requestAcknowledged = store.command(stopId)?.status === "confirmed";
  await waitFor(
    () =>
      store
        .events(session.id, cursor)
        .some((e) => ["turn-ended", "settled", "disconnected"].includes(e.type)),
    15000,
  );
  report.terminalEvents = store
    .events(session.id, cursor)
    .filter((e) => ["turn-ended", "settled", "disconnected"].includes(e.type))
    .map(({ type, payload }) => ({ type, payload }));
  report.checks.nativeTurnEnded = report.terminalEvents.some((e) => e.type === "turn-ended");
  report.checks.backgroundStateKnown = store.session(session.id).executionState === "settled";
  report.cancellationOutcome = report.terminalEvents.some((e) =>
    ["cancelled", "canceled", "interrupted"].includes(e.payload?.outcome),
  )
    ? "confirmed-by-native-event"
    : "unconfirmed";
  report.scope =
    "Native interrupt request acknowledgement and subsequent turn end; background state and cancellation outcome are reported separately.";
  // A native turn end and a cancellation acknowledgement never prove user-goal completion.
  report.result =
    report.checks.requestAcknowledged && report.checks.nativeTurnEnded ? "passed" : "not-passed";
} catch (error) {
  report.result = "failed";
  report.error = error.message;
} finally {
  await service.dispose();
  store.close();
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(dataDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (report.result !== "passed") process.exitCode = 1;
}
