// Live verification through an installed native runtime.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../packages/host/dist/storage/store.js";
import { SessionService } from "../packages/host/dist/session-service.js";
import { inspectInstallation, launchDefaults } from "../packages/host/dist/configuration/config.js";

const id = process.argv[2] ?? "zcode",
  chat = process.argv.includes("--chat"),
  lifecycle = process.argv.includes("--lifecycle"),
  tools = process.argv.includes("--tools");
if (tools && !chat) throw new Error("--tools requires --chat");
const acp = ["gemini", "cursor", "kimi-code", "grok-build"].includes(id);
if (!Object.hasOwn(launchDefaults, id)) throw new Error(`Unknown harness: ${id}`);
const sourceIndex = process.argv.indexOf("--source");
const commandIndex = process.argv.indexOf("--command");
const launchCommand = commandIndex >= 0 ? process.argv[commandIndex + 1] : undefined;
if (commandIndex >= 0 && !launchCommand) throw new Error("--command requires a path");
const launchArgs = process.argv.flatMap((arg, index) =>
  arg === "--arg" ? [process.argv[index + 1]] : [],
);
if (
  launchArgs.some(
    (arg) =>
      !arg ||
      ["--source", "--command", "--arg", "--model", "--chat", "--lifecycle", "--tools"].includes(
        arg,
      ),
  )
)
  throw new Error("--arg requires a value");
const expectedSource =
  sourceIndex >= 0
    ? process.argv[sourceIndex + 1]
    : launchCommand
      ? "configured"
      : "desktop-bundled";
if (!["cli", "desktop-bundled", "configured"].includes(expectedSource))
  throw new Error("--source must be cli, desktop-bundled or configured");
if (Boolean(launchCommand) !== (expectedSource === "configured"))
  throw new Error("--command requires --source configured");
const modelIndex = process.argv.indexOf("--model");
const selectedModel = modelIndex >= 0 ? process.argv[modelIndex + 1] : undefined;
const dir = resolve(`.local/verification/${expectedSource}-${id}-${Date.now()}`);
mkdirSync(dir, { recursive: true });
if (expectedSource === "desktop-bundled" || launchCommand)
  writeFileSync(
    join(dir, "installations.json"),
    JSON.stringify({
      [id]: launchCommand ? { command: launchCommand, args: launchArgs } : { preferDesktop: true },
    }),
  );
const report = {
  harness: id,
  expectedSource,
  result: "unverified",
  mode: chat ? "chat" : lifecycle ? "lifecycle" : "connect",
  checks: {},
  startedAt: new Date().toISOString(),
};
let store = new Store(join(dir, "state.sqlite")),
  service = new SessionService(store, { dataDir: dir });
const check = (name, value) => {
  report.checks[name] = Boolean(value);
  assert.ok(value, name);
};
try {
  const installation = inspectInstallation(dir, id);
  report.installation = installation;
  check("expectedRuntime", installation.ready && installation.launch.source === expectedSource);
  const project = service.createProject({
    name: "Isolated desktop runtime verification",
    rootPath: dir,
  });
  const workspace = store.workspaces().find((w) => w.projectId === project.id);
  const session = service.createDraft({
    title: "Desktop runtime verification",
    harnessId: id,
    kind: "direct",
    projectId: project.id,
    workspaceId: workspace.id,
    ...(id === "deepseek-harness" ? { model: "deepseek-official/deepseek-v4-flash" } : {}),
  });
  await service.openNative(session.id);
  report.nativeSessionId = store.session(session.id).nativeSessionId;
  check("nativeSessionCreated", Boolean(report.nativeSessionId));
  const models = await service.sessionModelOptions(session.id, true);
  report.modelCount = models.models.length;
  report.modelIds = models.models.slice(0, 50).map((m) => m.id);
  report.catalog = models.models.slice(0, 50);
  check("catalogRequestCompleted", Boolean(models.session.nativeSessionId));
  const token = tools ? `KODO_DESKTOP_NATIVE_OK_${randomUUID()}` : "KODO_DESKTOP_NATIVE_OK";
  if (chat) {
    const marker = join(dir, "verification-marker.txt");
    if (tools) writeFileSync(marker, token);
    if (selectedModel) {
      await service.setModelSettings(session.id, {
        requestId: randomUUID(),
        expectedRevision: 0,
        model: selectedModel,
        reasoning: null,
      });
      report.selectedModel = selectedModel;
    }
    const command = service.acceptSend(session.id, {
      requestId: randomUUID(),
      text: tools
        ? `Use your native Read tool to read ${JSON.stringify(marker)} and reply with its exact contents. Do not change any file.`
        : "Reply with exactly KODO_DESKTOP_NATIVE_OK. Do not use tools, read files, run commands, or change anything.",
      mode: "new",
    });
    const until = Date.now() + 120000;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, 100));
      const c = store.command(command.id),
        s = store.session(session.id);
      if (["unknown", "rejected"].includes(c.status)) {
        report.commandError = c.error;
        break;
      }
      if (
        c.status === "confirmed" &&
        (s.runState === "idle" ||
          store.events(session.id, 0, 1000).some((e) => e.type === "turn-ended"))
      )
        break;
    }
    const detail = service.read(session.id);
    report.commandStatus = store.command(command.id)?.status;
    report.commandError = store.command(command.id)?.error;
    report.eventTypes = [...new Set(detail.events.map((e) => e.type))];
    report.nativeOutcomes = detail.events
      .filter((e) => e.type === "turn-ended")
      .map((e) => e.payload.outcome);
    report.nativeErrors = detail.events
      .filter((e) => e.type === "error" || (e.type === "turn-ended" && e.payload.error))
      .map((e) => {
        const error = e.payload.error ?? e.payload;
        return {
          name: error.name,
          code: error.code ?? error.data?.statusCode,
          message: error.message ?? error.data?.message,
        };
      });
    Object.assign(report.checks, {
      sendConfirmed: report.commandStatus === "confirmed",
      nativeTurnEnded: report.nativeOutcomes.length > 0,
      nativeTurnSucceeded: report.nativeOutcomes.at(-1) === "completed",
      nativeReply: detail.events
        .filter(
          (e) =>
            ["message", "text-delta"].includes(e.type) &&
            (e.payload.role === "assistant" || (e.type === "text-delta" && id !== "opencode")),
        )
        .some((e) => JSON.stringify(e.payload).includes(token)),
      nativeIdPreserved: store.session(session.id).nativeSessionId === report.nativeSessionId,
      noNativeError: report.nativeErrors.length === 0,
    });
    if (tools) {
      const toolEvents = detail.events.filter((e) => e.type === "tool").map((e) => e.payload);
      const readIds = new Set(
        toolEvents
          .filter(
            (tool) =>
              ["Read", "read_file", "verification-marker.txt"].includes(tool.name ?? tool.title) ||
              tool.kind === "read",
          )
          .map((tool) => tool.toolCallId)
          .filter(Boolean),
      );
      report.checks.nativeToolCall = toolEvents.some(
        (tool) => tool.status === "completed" && readIds.has(tool.toolCallId),
      );
    }
    assert.ok(
      Object.values(report.checks).every(Boolean),
      Object.entries(report.checks)
        .filter(([, v]) => !v)
        .map(([k]) => k)
        .join(", "),
    );
  }
  if (lifecycle) {
    if (!acp) {
      const history = await service.nativeRead(session.id);
      check("nativeHistoryRead", history !== undefined && history !== null);
    }
    if (id === "opencode") {
      const list = await service.nativeList(session.id);
      check("nativeHistoryList", JSON.stringify(list).includes(report.nativeSessionId));
    }
    await service.dispose();
    store.close();
    store = new Store(join(dir, "state.sqlite"));
    store.recover();
    service = new SessionService(store, { dataDir: dir });
    await service.openNative(session.id);
    check(
      "nativeResumePreservesIdentity",
      store.session(session.id).nativeSessionId === report.nativeSessionId,
    );
    if (!acp)
      check("nativeHistoryAfterResume", (await service.nativeRead(session.id)) !== undefined);
    if (acp && chat) {
      const start = store.latestSequence(session.id);
      const command = service.acceptSend(session.id, {
        requestId: randomUUID(),
        mode: "new",
        text: "What exact token did you reply with in the previous turn? Reply with that token followed by RESUMED. Do not use tools or files.",
      });
      const until = Date.now() + 120000;
      while (Date.now() < until) {
        await new Promise((r) => setTimeout(r, 100));
        if (["unknown", "rejected", "confirmed"].includes(store.command(command.id)?.status)) {
          const events = store.events(session.id, start, 1000);
          if (events.some((e) => e.type === "turn-ended")) break;
        }
      }
      const events = store.events(session.id, start, 1000);
      const reply = events
        .filter((e) => e.type === "text-delta" && e.payload.channel === "assistant")
        .map((e) => e.payload.text ?? "")
        .join("");
      report.resumeReply = reply;
      check("resumeSendConfirmed", store.command(command.id)?.status === "confirmed");
      check("resumeNativeReply", reply.includes(token) && reply.includes("RESUMED"));
      check(
        "resumeNoNativeError",
        !events.some((e) => e.type === "error" || e.type === "disconnected"),
      );
    }
  }
  report.result = "passed";
} catch (e) {
  report.result = "failed-or-blocked";
  report.error = e.message;
  process.exitCode = 1;
} finally {
  await service.dispose();
  store.close();
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(dir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, report: join(dir, "report.json") }, null, 2));
}
