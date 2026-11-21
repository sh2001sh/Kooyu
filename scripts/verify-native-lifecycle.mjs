import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { Store } from "../packages/host/dist/storage/store.js";
import { SessionService } from "../packages/host/dist/session-service.js";
const harness = process.argv[2] ?? "codex",
  dataDir = resolve(`.local/verification/lifecycle-${harness}-${Date.now()}`);
mkdirSync(dataDir, { recursive: true });
if (harness === "claude-code" && process.env.KODO_VERIFY_CLAUDE_PATH)
  writeFileSync(
    join(dataDir, "installations.json"),
    JSON.stringify({ "claude-code": { command: process.env.KODO_VERIFY_CLAUDE_PATH, args: [] } }),
  );
let store = new Store(join(dataDir, "state.sqlite")),
  service = new SessionService(store, { dataDir }),
  session;
const report = { harness, result: "unverified", startedAt: new Date().toISOString(), checks: {} };
async function send(text) {
  const cursor = store.events(session.id, 0, 1000).at(-1)?.sequence ?? 0,
    id = crypto.randomUUID();
  service.acceptSend(session.id, { requestId: id, text, mode: "new" });
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
    const c = store.command(id),
      events = store.events(session.id, cursor, 1000);
    if (["unknown", "rejected"].includes(c?.status)) throw new Error(c.error);
    if (c?.status === "confirmed" && events.some((e) => e.type === "turn-ended")) return events;
  }
  throw new Error("Native turn did not finish within verification deadline");
}
try {
  const p = service.createProject({
      name: "Native lifecycle verification",
      rootPath: process.cwd(),
    }),
    w = store.workspaces().find((w) => w.projectId === p.id);
  session = service.createDraft({
    title: "Native lifecycle check",
    harnessId: harness,
    kind: harness === "kodo" ? "supervisor" : "direct",
    projectId: p.id,
    workspaceId: w.id,
    ...(["kodo", "pi"].includes(harness)
      ? {
          model: `${process.env.KODO_VERIFY_PROVIDER ?? "openai"}/${process.env.KODO_VERIFY_MODEL ?? "gpt-4o-mini"}`,
        }
      : harness === "deepseek-harness"
        ? { model: "deepseek-official/deepseek-v4-flash" }
        : {}),
  });
  const first = await send(
    harness === "kodo"
      ? "Call harness_list exactly once, then reply KODO_NATIVE_TOOLS_OK. Do not call any other tool or change files."
      : "Reply exactly KODO_NATIVE_LIFECYCLE_OK. Do not use tools, read files, or change anything.",
  );
  report.checks.firstTurn = first.some(
    (e) => e.type === "turn-ended" && ["completed", "complete"].includes(e.payload?.outcome),
  );
  if (harness === "kodo")
    report.checks.productTool = first.some(
      (e) => e.type === "tool" && JSON.stringify(e.payload).includes("harness_list"),
    );
  const nativeId = store.session(session.id).nativeSessionId;
  report.nativeSessionId = nativeId;
  try {
    const native = await service.nativeRead(session.id);
    report.checks.historyRead = JSON.stringify(native).includes(
      harness === "kodo" ? "KODO_NATIVE_TOOLS_OK" : "KODO_NATIVE_LIFECYCLE_OK",
    );
  } catch (error) {
    report.historyRead = error.message;
  }
  try {
    const list = await service.nativeList(session.id);
    report.checks.historyList = JSON.stringify(list).includes(nativeId);
  } catch (error) {
    report.historyList = error.message;
  }
  if (harness === "codex")
    try {
      await service.quota(session.id);
      report.checks.quotaRead = true;
    } catch (error) {
      report.quotaRead = error.message;
    }
  await service.dispose();
  store.close();
  store = new Store(join(dataDir, "state.sqlite"));
  store.recover();
  service = new SessionService(store, { dataDir });
  await service.openNative(session.id);
  report.checks.identityPreserved = store.session(session.id).nativeSessionId === nativeId;
  const second = await send(
    harness === "kodo"
      ? "State your product agent name, then reply KODO_NATIVE_RESUME_OK. Do not use tools, read files, or change anything."
      : "Reply exactly KODO_NATIVE_RESUME_OK. Do not use tools, read files, or change anything.",
  );
  report.checks.resumeReply = second.some(
    (e) => e.type === "message" && JSON.stringify(e.payload).includes("KODO_NATIVE_RESUME_OK"),
  );
  if (harness === "kodo")
    report.checks.productIdentity = second.some(
      (e) =>
        e.type === "message" &&
        e.payload?.role !== "user" &&
        /\bKooyu\b/.test(JSON.stringify(e.payload)),
    );
  report.result = Object.values(report.checks).every(Boolean) ? "passed" : "not-passed";
} catch (error) {
  report.error = error.message;
  report.result = "failed";
} finally {
  await service.dispose();
  store.close();
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(dataDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (report.result !== "passed") process.exitCode = 1;
}
