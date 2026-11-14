// Explicit live verification. Reads existing authorized native settings without
// changing them, and sends small prompts through the actual harness runtimes.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { Store } from "../packages/host/dist/storage/store.js";
import { SessionService } from "../packages/host/dist/session-service.js";
import { nativeLaunch } from "../packages/host/dist/configuration/config.js";

const harness = process.argv[2] ?? "pi",
  gateway = process.argv.includes("--gateway"),
  tools = process.argv.includes("--tools"),
  reopen = process.argv.includes("--reopen");
if (
  ![
    "pi",
    "kodo",
    "codex",
    "claude-code",
    "opencode",
    "deepseek-harness",
    "zcode",
    "gemini",
    "kimi-code",
    "grok-build",
  ].includes(harness)
)
  throw new Error("This probe covers implemented Provider binding routes only.");
const dir = resolve(
  `.local/verification/provider-${harness}${gateway ? "-gateway" : ""}${tools ? "-tools" : ""}-${Date.now()}`,
);
mkdirSync(dir, { recursive: true });
if (process.argv.includes("--installed-runtime")) {
  const installedDataDir =
    process.env.KODO_DATA_DIR ??
    join(process.env.LOCALAPPDATA ?? join(homedir(), ".local", "share"), "Kodo", "host");
  const installed = nativeLaunch(installedDataDir, harness);
  if (installed.unavailableReason) throw new Error(installed.unavailableReason);
  writeFileSync(
    join(dir, "installations.json"),
    JSON.stringify({
      [harness]: { command: installed.command, args: installed.args },
    }),
  );
}
if (process.argv.includes("--verification-tools")) {
  const entries = {
    "kimi-code": ["@moonshot-ai/kimi-code/dist/main.mjs", "acp"],
    gemini: ["@google/gemini-cli/bundle/gemini.js", "--acp"],
    "grok-build": ["@xai-official/grok/bin/grok", "agent", "stdio"],
  };
  const entry = entries[harness];
  if (!entry) throw new Error("No isolated verification tool entry for this harness");
  writeFileSync(
    join(dir, "installations.json"),
    JSON.stringify({
      [harness]: {
        command: process.execPath,
        args: [
          resolve(".local/verification/native-tools/node_modules", entry[0]),
          ...entry.slice(1),
        ],
      },
    }),
  );
}
const upstreamErrors = [];
const providerFetch = async (url, init) => {
  const r = await fetch(url, init);
  if (String(url).includes("/chat/completions") && !r.ok) {
    const data = await r
      .clone()
      .json()
      .catch(() => ({}));
    upstreamErrors.push({
      status: r.status,
      code: data.error?.code,
      message: String(data.error?.message ?? "")
        .replaceAll(key || "__NO_KEY__", "[redacted]")
        .slice(0, 250),
    });
  }
  return r;
};
let store = new Store(join(dir, "state.sqlite")),
  service = new SessionService(store, {
    dataDir: dir,
    providerFetch,
  });
const report = {
  harness,
  startedAt: new Date().toISOString(),
  result: "unverified",
  checks: {},
  turns: [],
  toolVerification: tools,
};
const check = (name, value) => {
  report.checks[name] = Boolean(value);
  assert.ok(value, name);
};
let session, key;
try {
  let baseUrl, protocol, model, catalogProvider, catalogKey;
  if (harness === "codex" && !gateway) {
    // Python's standard TOML reader keeps sensitive config out of shell text/output.
    const raw = JSON.parse(
      execFileSync(
        "python",
        [
          "-X",
          "utf8",
          "-c",
          'import pathlib,json,tomllib; p=pathlib.Path.home()/".codex"; c=tomllib.loads((p/"config.toml").read_text("utf-8")); v=c["model_providers"][c["model_provider"]]; a=json.loads((p/"auth.json").read_text("utf-8")); print(json.dumps({"baseUrl":v["base_url"],"model":c["model"],"key":a.get("OPENAI_API_KEY")}))',
        ],
        { encoding: "utf8", windowsHide: true },
      ),
    );
    ({ baseUrl, model, key } = raw);
    protocol = "openai-responses";
    catalogProvider = "openai";
  } else if (harness === "claude-code" && !gateway) {
    const { env } = JSON.parse(readFileSync(join(homedir(), ".claude/settings.json"), "utf8"));
    baseUrl = env.ANTHROPIC_BASE_URL;
    key = env.ANTHROPIC_AUTH_TOKEN ?? env.ANTHROPIC_API_KEY;
    model = env.ANTHROPIC_MODEL ?? env.ANTHROPIC_DEFAULT_SONNET_MODEL;
    protocol = "anthropic-messages";
    catalogProvider = "anthropic";
  } else {
    const { providers } = JSON.parse(
      readFileSync(join(homedir(), ".pi/agent/models.json"), "utf8"),
    );
    const route = providers.codegoai;
    baseUrl = route.baseUrl;
    key = process.env[route.apiKey] ?? route.apiKey;
    protocol = route.api;
    model = "deepseek-v4-flash";
    catalogKey = "deepseek/deepseek-v4-flash";
    if (gateway) {
      protocol = "openai-completions";
      baseUrl = `${baseUrl.replace(/\/$/, "")}/v1`;
    }
  }
  if (!key || !baseUrl || !model)
    throw new Error(
      "Missing existing native API key, endpoint or selected model; no credentials were invented.",
    );
  const state = await service.providers.refreshCatalog();
  report.catalog = state;
  check("remoteCatalog", state.source.includes("models.dev") && !state.stale);
  report.endpointHost = new URL(baseUrl).hostname;
  report.model = model;
  report.protocol = protocol;
  report.gateway = gateway;
  const provider = await service.providers.saveProvider({
    name: "Existing authorized route — isolated live verification",
    ...(catalogProvider ? { catalogProvider } : {}),
    endpoints: [{ name: "Native protocol", baseUrl, protocol, apiKey: key }],
  });
  check("keyringReference", Boolean(provider.endpoints[0].credentialRef));
  const discovered = store
    .records("provider-model")
    .find(
      (entry) =>
        entry.providerId === provider.id &&
        entry.endpointId === provider.endpoints[0].id &&
        entry.model === model,
    );
  let m = await service.providers.saveModel({
    ...(discovered ? { id: discovered.id, expectedRevision: discovered.revision } : {}),
    providerId: provider.id,
    endpointId: provider.endpoints[0].id,
    model,
    ...(catalogKey ? { catalogKey } : {}),
  });
  report.parameters = { automatic: m.automatic, sources: m.sources };
  // Verify override/restore against the actual stored public feed, without using
  // the temporary artificial value for model execution.
  if (m.automatic.contextWindow) {
    m = await service.providers.saveModel({
      id: m.id,
      expectedRevision: m.revision,
      providerId: m.providerId,
      endpointId: m.endpointId,
      model,
      overrides: { contextWindow: m.automatic.contextWindow - 1 },
    });
    check("manualOverride", m.sources.contextWindow.kind === "user");
    m = await service.providers.saveModel({
      id: m.id,
      expectedRevision: m.revision,
      providerId: m.providerId,
      endpointId: m.endpointId,
      model,
      overrides: {},
    });
    check(
      "restoreAutomatic",
      m.effective.contextWindow === m.automatic.contextWindow &&
        m.sources.contextWindow.kind === "remote-catalog",
    );
  }
  const declared =
    m.effective.reasoningOptions?.flatMap((o) => (o.type === "effort" ? o.values : [])) ?? [];
  const reasoning = declared.includes("low") ? "low" : null;
  const binding = service.providers.saveBinding({
    name: "Live native binding",
    harnessId: harness,
    modelId: m.id,
    reasoning,
    route: gateway ? "gateway" : "auto",
  });
  check(
    "bindingPinned",
    binding.modelRevision === m.revision && binding.providerRevision === provider.revision,
  );
  check(
    "noSecretsInConfiguration",
    !JSON.stringify(await service.providers.configuration()).includes(key),
  );
  const project = service.createProject({
    name: "Isolated Provider binding verification",
    rootPath: dir,
  });
  const workspace = store.workspaces().find((w) => w.projectId === project.id);
  session = service.createDraft({
    title: "Real bound native conversation",
    harnessId: harness,
    kind: harness === "kodo" ? "supervisor" : "direct",
    projectId: project.id,
    workspaceId: workspace.id,
    bindingId: binding.id,
  });
  await service.openNative(session.id);
  report.nativeSessionId = store.session(session.id).nativeSessionId;
  check("nativeIdentityCreated", Boolean(report.nativeSessionId));
  check(
    "frozenContextVisible",
    (await service.sessionModelOptions(session.id)).models[0]?.contextWindow ===
      m.effective.contextWindow,
  );
  for (let i = 0; i < 2; i++) {
    if (i === 1 && reopen) {
      await service.dispose();
      store.close();
      store = new Store(join(dir, "state.sqlite"));
      store.recover();
      service = new SessionService(store, { dataDir: dir, providerFetch });
      await service.openNative(session.id);
      check(
        "reopenSameIdentity",
        store.session(session.id).nativeSessionId === report.nativeSessionId,
      );
    }
    const start = store.latestSequence(session.id),
      token = tools ? `KODO_READ_${session.id.replaceAll("-", "")}` : "KODO_PROVIDER_REAL";
    const marker = join(dir, "verification-marker.txt");
    if (tools && i === 0) writeFileSync(marker, token, "utf8");
    const command = service.acceptSend(session.id, {
      requestId: randomUUID(),
      mode: "new",
      text:
        tools && i === 0
          ? `Use your native Read tool to read ${JSON.stringify(marker)} and reply with its exact contents. Do not use other tools or change any file.`
          : i
            ? "Repeat the exact token you replied with previously, followed by OK. Do not use tools or files."
            : `Reply exactly ${token}. Do not use tools or files.`,
    });
    const until = Date.now() + 120000;
    while (Date.now() < until) {
      const c = store.command(command.id),
        events = store.events(session.id, start, 1000);
      if (
        ["unknown", "rejected"].includes(c?.status) ||
        (c?.status === "confirmed" &&
          events.some((e) => e.type === "settled" || e.type === "turn-ended"))
      )
        break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const events = store.events(session.id, start, 1000),
      errors = events.filter((e) => e.type === "error" || e.type === "disconnected");
    const text = events
      .filter(
        (e) =>
          e.type === "text-delta" ||
          (harness === "deepseek-harness" &&
            e.type === "message" &&
            e.payload.role === "assistant"),
      )
      .map(
        (e) =>
          e.payload.text ??
          (e.payload.content ?? [])
            .filter((b) => b.type === "text")
            .map((b) => b.text ?? "")
            .join(""),
      )
      .join("");
    report.turns.push({
      commandStatus: store.command(command.id)?.status,
      commandError: store.command(command.id)?.error,
      text,
      eventTypes: [...new Set(events.map((e) => e.type))],
      errors: errors.map((e) => e.payload),
    });
    check(`turn${i}Confirmed`, store.command(command.id)?.status === "confirmed");
    check(`turn${i}NativeReply`, text.includes(token));
    check(`turn${i}NoErrors`, !errors.length);
    if (tools && i === 0) {
      const nativeTools = events.filter((e) => e.type === "tool").map((e) => e.payload);
      const readIds = new Set(
        nativeTools
          .filter(
            (tool) =>
              tool.name === "Read" ||
              tool.title === "Read" ||
              tool.kind === "read" ||
              tool.title === "verification-marker.txt",
          )
          .map((tool) => tool.toolCallId)
          .filter(Boolean),
      );
      check(
        "nativeToolCall",
        nativeTools.some((tool) => tool.status === "completed" && readIds.has(tool.toolCallId)),
      );
    }
    check(
      `turn${i}SameIdentity`,
      store.session(session.id).nativeSessionId === report.nativeSessionId,
    );
  }
  report.result = "passed";
} catch (e) {
  report.result = "failed";
  report.error = e.message;
  process.exitCode = 1;
} finally {
  if (session && store.session(session.id).runState === "running")
    await service.stop(session.id, true).catch(() => {});
  report.gatewayFailures = service.providers.gateway.failures;
  report.upstreamErrors = upstreamErrors;
  await service.dispose();
  store.close();
  const text = JSON.stringify(report, null, 2).replaceAll(key || "__NO_KEY__", "[redacted]");
  writeFileSync(join(dir, "report.json"), text + "\n");
  console.log(text);
  console.log(`Report: ${dir}`);
}
