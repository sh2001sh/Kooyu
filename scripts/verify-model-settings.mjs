// Real native calls using existing login; no synthetic responses or model API substitute.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Store } from "../packages/host/dist/storage/store.js";
import { SessionService } from "../packages/host/dist/session-service.js";

const harness = process.argv[2] ?? "codex";
if (!["kodo", "pi", "codex", "claude-code", "deepseek-harness"].includes(harness))
  throw new Error("Install and log into the native CLI before extending this real probe.");
const dir = resolve(`.local/verification/models-${harness}-${Date.now()}`);
mkdirSync(dir, { recursive: true });
const path = join(dir, "state.sqlite");
const store = new Store(path);
const service = new SessionService(store, { dataDir: dir });
const report = {
  harness,
  startedAt: new Date().toISOString(),
  result: "unverified",
  checks: {},
  turns: [],
  limits: [],
};
function check(name, value) {
  report.checks[name] = Boolean(value);
  assert.ok(value, name);
}
async function waitFor(fn, timeout = 120000) {
  const until = Date.now() + timeout;
  while (!fn()) {
    if (Date.now() > until) throw new Error("Native turn deadline exceeded");
    await new Promise((r) => setTimeout(r, 50));
  }
}
try {
  const project = service.createProject({
    name: "Real native model settings verification",
    rootPath: process.cwd(),
  });
  const workspace = store.workspaces().find((w) => w.projectId === project.id);
  const session = service.createDraft({
    title: "Native model switch test",
    harnessId: harness,
    kind: harness === "kodo" ? "supervisor" : "direct",
    projectId: project.id,
    workspaceId: workspace.id,
    ...(["kodo", "pi", "deepseek-harness"].includes(harness)
      ? {
          model: `${harness === "deepseek-harness" ? "deepseek-official" : "codegoai"}/deepseek-v4-flash`,
        }
      : {}),
  });
  const opened = await service.openNative(session.id);
  report.nativeId = opened.nativeSessionId;
  const options = await service.sessionModelOptions(session.id, true);
  report.catalog = options.models.slice(0, 60);
  const models =
    harness === "codex"
      ? ["gpt-6.1-sol", process.env.KODO_VERIFY_SECOND_MODEL ?? "gpt-6-astra"]
      : harness === "claude-code"
        ? ["sonnet", "opus"]
        : ["deepseek-v4-flash", "deepseek-v4-pro"];
  for (let i = 0; i < 2; i++) {
    const model = models[i];
    const catalog = options.models.find((m) => m.id === model);
    const reasoning = catalog?.reasoning?.includes(i ? "high" : "low")
      ? i
        ? "high"
        : "low"
      : null;
    const input = { requestId: randomUUID(), expectedRevision: i, model, reasoning };
    const changed = await service.setModelSettings(session.id, input);
    check(
      `settings${i}Idempotent`,
      (await service.setModelSettings(session.id, input)).settingsRevision === i + 1,
    );
    check(`settings${i}NativeId`, changed.nativeSessionId === report.nativeId);
    const start = store.latestSequence(session.id);
    const command = service.acceptSend(session.id, {
      requestId: randomUUID(),
      mode: "new",
      text: i
        ? "Repeat the token my previous message requested, followed by KODO_MODEL_B. Do not use tools or files."
        : "Reply exactly KODO_MODEL_A. Do not use tools or files.",
    });
    await waitFor(
      () =>
        ["unknown", "rejected"].includes(store.command(command.id)?.status) ||
        (store.command(command.id)?.status === "confirmed" &&
          store
            .events(session.id, start, 1000)
            .some((e) => e.type === "turn-ended" || e.type === "settled")),
    );
    const receipt = store.command(command.id);
    check(`turn${i}Confirmed`, receipt.status === "confirmed");
    const events = store.events(session.id, start, 1000);
    check(
      `turn${i}NoNativeError`,
      !events.some(
        (e) => e.type === "error" || (e.type === "turn-ended" && e.payload.outcome === "failed"),
      ),
    );
    const messages = events.filter((e) => e.type === "message" && e.payload.role !== "user");
    check(
      `turn${i}NativeReply`,
      JSON.stringify(messages).includes(i ? "KODO_MODEL_B" : "KODO_MODEL_A"),
    );
    if (i)
      check("nativeContextSurvivesModelSwitch", JSON.stringify(messages).includes("KODO_MODEL_A"));
    check(`turn${i}NativeIdStable`, store.session(session.id).nativeSessionId === report.nativeId);
    check(`turn${i}FrozenModel`, receipt.body.settings.model === model);
    report.turns.push({
      model,
      reasoning,
      nativeReply: messages.map((e) => e.payload),
      usage: events.filter((e) => e.type === "usage").map((e) => e.payload),
    });
    console.log(`${harness}: turn ${i + 1} passed (${model}, ${reasoning ?? "native reasoning"})`);
  }
  check("twoDistinctModelSelections", report.turns[0].model !== report.turns[1].model);
  report.finalCatalog = (await service.sessionModelOptions(session.id, true)).models.slice(0, 60);
  await service.dispose();
  store.close();
  const reopened = new Store(path);
  try {
    check(
      "modelSettingsPersisted",
      reopened.session(session.id).model === models[1] &&
        reopened.session(session.id).settingsRevision === 2 &&
        reopened.session(session.id).nativeSessionId === report.nativeId,
    );
  } finally {
    reopened.close();
  }
  report.result = "passed";
} catch (error) {
  report.result = "failed";
  report.error = error.message;
  process.exitCode = 1;
} finally {
  await service.dispose().catch(() => {});
  try {
    store.close();
  } catch {}
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(dir, "report.json"), JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      harness,
      result: report.result,
      checks: report.checks,
      error: report.error,
      report: join(dir, "report.json"),
    }),
  );
}
