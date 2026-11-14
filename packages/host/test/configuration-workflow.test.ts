import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/storage/store.js";
import { ProviderService, type ProviderVault } from "../src/providers/service.js";
import { SessionService } from "../src/session-service.js";
import { appSettings, saveAppSettings } from "../src/configuration/preferences.js";
import { EngineManager } from "../src/configuration/engines.js";
import { nativeDefaults, nativeConfigLocations } from "../src/harnesses/native-defaults.js";
import { descriptor, type AdapterContext, type HarnessAdapter } from "../src/harnesses/adapter.js";
import type { HarnessBinding, ModelSettings } from "@kodo/protocol";

// Synthetic metadata and adapter boundaries only: no inference or real install claims.
const metadata = {
  data: [
    {
      id: "workflow-a",
      contextWindow: 128000,
      maxOutputTokens: 4096,
      input: ["text"],
      reasoning: false,
      pricing: { input: 2, output: 8 },
    },
    {
      id: "workflow-b",
      contextWindow: 256000,
      maxOutputTokens: 8192,
      input: ["text"],
      reasoning: false,
      pricing: { input: 3, output: 12 },
    },
  ],
};
const providerInput = {
  name: "Synthetic workflow",
  endpoints: [
    {
      name: "Responses",
      protocol: "openai-responses",
      baseUrl: "http://127.0.0.1:1/v1",
      apiKey: "synthetic-private-key",
    },
  ],
};
function vault(): ProviderVault {
  const keys = new Map<string, string>();
  return {
    get: async (ref) => keys.get(ref) ?? null,
    set: async (ref, key) => {
      keys.set(ref, key);
    },
    delete: async (ref) => {
      keys.delete(ref);
    },
  };
}
function disableRefresh(store: Store) {
  saveAppSettings(store, { ...appSettings(store), autoRefreshModels: false });
}
async function until(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail("Expected workflow condition did not settle");
}

test("saving a Provider imports models automatically; failure preserves it and retry clears the error", async () => {
  const store = new Store(":memory:");
  disableRefresh(store);
  let fail = false,
    requests = 0;
  const providers = new ProviderService(store, {
    vault: vault(),
    fetcher: async () => {
      requests++;
      if (fail) throw new Error("synthetic-private-key must never be exposed");
      return Response.json(metadata);
    },
  });
  try {
    const p = await providers.saveProvider(providerInput);
    let config = await providers.configuration();
    assert.equal(requests, 1);
    assert.equal(config.models.length, 2);
    assert.equal(config.providers[0]?.discovery?.[0]?.status, "ready");
    assert.deepEqual(config.models[0]?.effective.pricing, { input: 2, output: 8 });
    fail = true;
    const next = await providers.saveProvider({
      ...providerInput,
      id: p.id,
      expectedRevision: p.revision,
      endpoints: [{ ...providerInput.endpoints[0], id: p.endpoints[0]!.id }],
    });
    config = await providers.configuration();
    assert.equal(next.revision, 2);
    assert.equal(config.models.length, 2, "failed discovery retains the previous list");
    assert.equal(config.providers[0]?.discovery?.[0]?.status, "error");
    assert.equal(JSON.stringify(config).includes("synthetic-private-key"), false);
    fail = false;
    await providers.discover(next.id, next.endpoints[0]!.id);
    config = await providers.configuration();
    assert.equal(config.providers[0]?.discovery?.[0]?.status, "ready");
    assert.ok(config.models.every((m) => m.providerRevision === 2));
  } finally {
    await providers.close();
    store.close();
  }
});

test("provider profiles switch chat models once, resume native identity, and freeze historical metadata", async () => {
  const store = new Store(":memory:");
  disableRefresh(store);
  const root = mkdtempSync(join(tmpdir(), "kodo-workflow-"));
  const connections: { context: AdapterContext; native: string | null }[] = [];
  const sends: { text: string; settings?: ModelSettings }[] = [];
  let closes = 0;
  const adapter: HarnessAdapter = {
    descriptor: descriptor(
      "codex",
      "Synthetic workflow",
      "app-server",
      ["directChat", "steer"],
      "No inference",
      "partial",
    ),
    async connect(session, context) {
      connections.push({ context, native: session.nativeSessionId });
      return {
        nativeSessionId: session.nativeSessionId ?? "workflow-native",
        async send(text, _id, _mode, settings) {
          sends.push({ text, settings });
          return { nativeRunId: randomUUID() };
        },
        async cancel() {},
        async close() {
          closes++;
          await new Promise((r) => setTimeout(r, 20));
        },
      };
    },
  };
  const service = new SessionService(store, {
    dataDir: root,
    adapters: [adapter],
    providerVault: vault(),
    providerFetch: async () => Response.json(metadata),
  });
  try {
    const p = await service.providers.saveProvider(providerInput);
    const profile = service.providers.saveProviderBinding({
      harnessId: "codex",
      providerId: p.id,
      endpointId: p.endpoints[0]!.id,
      expectedDefaultsRevision: 0,
    });
    assert.equal(profile.selectionMode, "provider");
    const session = service.createDraft({ title: "Switch", kind: "direct", harnessId: "codex" });
    await service.openNative(session.id);
    assert.equal((await service.sessionModelOptions(session.id)).models.length, 2);
    await service.setModelSettings(session.id, {
      requestId: randomUUID(),
      expectedRevision: 0,
      model: "workflow-b",
      reasoning: null,
    });
    await Promise.all([service.openNative(session.id), service.openNative(session.id)]);
    assert.equal(connections.length, 2, "concurrent reads share a single reconnect");
    assert.equal(closes, 1);
    assert.equal(connections[1]?.native, "workflow-native");
    assert.equal(connections[1]?.context.configuration?.model, "workflow-b");
    assert.equal(connections[1]?.context.configuration?.modelParameters?.contextWindow, 256000);
    await assert.rejects(
      service.setModelSettings(session.id, {
        requestId: randomUUID(),
        expectedRevision: 1,
        model: "outside-provider",
        reasoning: null,
      }),
      /Provider/,
    );
    const running = service.acceptSend(session.id, {
      requestId: randomUUID(),
      text: "running on b",
      mode: "new",
    });
    await until(() => store.command(running.id)?.status === "confirmed");
    await service.setModelSettings(session.id, {
      requestId: randomUUID(),
      expectedRevision: 1,
      model: "workflow-a",
      reasoning: null,
    });
    const queued = service.acceptSend(session.id, {
      requestId: randomUUID(),
      text: "queued on a",
      mode: "queue",
    });
    const steer = service.acceptSend(session.id, {
      requestId: randomUUID(),
      text: "steer b",
      mode: "steer",
    });
    await until(() => store.command(steer.id)?.status === "confirmed");
    assert.equal(
      connections.length,
      2,
      "running model changes do not interrupt the active native turn",
    );
    assert.equal(sends.at(-1)?.settings, undefined, "steer keeps the active turn settings");
    connections[1]!.context.emit("usage", {
      input: 1000000,
      output: 0,
      sourceId: "workflow-turn-b",
    });
    const billed = store.records<{ model: string; costUsd: number }>("usage").at(-1)!;
    assert.equal(billed.model, "workflow-b");
    assert.equal(
      billed.costUsd,
      3,
      "cost follows the dispatched model, not the next desired model",
    );
    connections[1]!.context.emit("turn-ended", { outcome: "completed" });
    await until(() => store.command(queued.id)?.status === "confirmed");
    assert.equal(connections.length, 3);
    assert.equal(connections[2]?.context.configuration?.model, "workflow-a");
    assert.equal(connections[2]?.native, "workflow-native");
    assert.equal(sends.at(-1)?.settings?.model, "workflow-a");
    connections[2]!.context.emit("turn-ended", { outcome: "completed" });
    const model = (await service.providers.configuration()).models.find(
      (m) => m.model === "workflow-b",
    )!;
    await service.providers.saveModel({
      id: model.id,
      providerId: model.providerId,
      endpointId: model.endpointId,
      model: model.model,
      expectedRevision: model.revision,
      overrides: { contextWindow: 512000, pricing: { input: 0, output: 0 } },
    });
    const refreshed = store.record<HarnessBinding>("harness-binding", profile.id)!;
    assert.ok(refreshed.revision > profile.revision);
    assert.equal(
      service.providers.bindingModel(refreshed, "workflow-b").parameters.contextWindow,
      512000,
    );
    assert.equal(store.session(session.id).bindingRevision, profile.revision);
    assert.equal(
      service.providers.bindingModel(
        store.record<HarnessBinding>(
          "harness-binding-revision",
          `${profile.id}:${profile.revision}`,
        )!,
        "workflow-b",
      ).parameters.contextWindow,
      256000,
    );
    assert.equal(
      service.providers.estimateCost(
        "codex",
        "workflow-b",
        { input: 100, output: 100, cacheRead: null, cacheWrite: null },
        { input: 0, output: 0 },
      ),
      0,
    );
    const future = service.createDraft({
      title: "Future",
      kind: "direct",
      harnessId: "codex",
      model: "workflow-b",
    });
    assert.equal(future.bindingRevision, refreshed.revision);
    const native = service.createDraft({
      title: "Native",
      kind: "direct",
      harnessId: "codex",
      bindingId: null,
    });
    assert.equal(native.bindingId, null);
    saveAppSettings(store, { ...appSettings(store), personalInstructions: "请用中文回复。" });
    const instructed = service.createDraft({
      title: "Instructions",
      kind: "direct",
      harnessId: "codex",
    });
    const first = service.acceptSend(instructed.id, {
      requestId: randomUUID(),
      text: "first",
      mode: "new",
    });
    await until(() => store.command(first.id)?.status === "confirmed");
    assert.ok(sends.at(-1)?.text.includes("请用中文回复。"));
    assert.ok(sends.at(-1)?.text.endsWith("first"));
    connections.at(-1)!.context.emit("turn-ended", { outcome: "completed" });
    const second = service.acceptSend(instructed.id, {
      requestId: randomUUID(),
      text: "second",
      mode: "new",
    });
    await until(() => store.command(second.id)?.status === "confirmed");
    assert.equal(sends.at(-1)?.text, "second");
  } finally {
    await service.dispose();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("application preferences persist with revision checks and Kodo reads only its own defaults", () => {
  const store = new Store(":memory:"),
    root = mkdtempSync(join(tmpdir(), "kodo-independent-"));
  try {
    const initial = appSettings(store);
    const saved = saveAppSettings(store, { ...initial, theme: "dark", sendShortcut: "mod-enter" });
    assert.equal(appSettings(store).theme, "dark");
    assert.equal(saved.revision, 1);
    assert.throws(() => saveAppSettings(store, initial), /另一窗口/);
    const pi = join(root, "pi"),
      kodo = join(root, "kodo");
    mkdirSync(pi);
    mkdirSync(kodo);
    writeFileSync(
      join(pi, "settings.json"),
      JSON.stringify({ defaultProvider: "pi-only", defaultModel: "pi-model" }),
    );
    writeFileSync(
      join(kodo, "settings.json"),
      JSON.stringify({ defaultProvider: "kodo-only", defaultModel: "kodo-model" }),
    );
    const env = { ...process.env, PI_CODING_AGENT_DIR: pi };
    assert.equal(nativeDefaults("pi", env, kodo).model, "pi-only/pi-model");
    assert.equal(nativeDefaults("kodo", env, kodo).model, "kodo-only/kodo-model");
    assert.ok(nativeConfigLocations("kodo", env, kodo).every((file) => file.path.startsWith(kodo)));
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("managed engine installation switches only on success, preserves siblings and restores previous entry", async () => {
  const store = new Store(":memory:"),
    root = mkdtempSync(join(tmpdir(), "kodo-install-workflow-"));
  let fail = false,
    traversal = false,
    release!: () => void;
  let gate: Promise<void> | undefined;
  const manager = new EngineManager(store, root, {
    installPackage: async (name, generation) => {
      await gate;
      if (fail) throw new Error("Synthetic installation failed");
      const pkg = join(generation, "node_modules", name);
      mkdirSync(pkg, { recursive: true });
      writeFileSync(
        join(pkg, "package.json"),
        JSON.stringify({
          version: "1.2.3",
          bin: { codex: traversal ? "../../outside.js" : "entry.js" },
        }),
      );
      writeFileSync(join(pkg, "entry.js"), "// Synthetic installer fixture, never executed");
    },
  });
  try {
    const old = { command: process.execPath, args: ["old.js"] },
      sibling = { command: process.execPath, args: ["gemini.js"] };
    writeFileSync(
      join(root, "installations.json"),
      JSON.stringify({ codex: old, gemini: sibling }),
    );
    gate = new Promise((done) => {
      release = done;
    });
    manager.start("codex", "install");
    assert.throws(() => manager.start("codex", "upgrade"), /安装中/);
    assert.deepEqual(JSON.parse(readFileSync(join(root, "installations.json"), "utf8")).codex, old);
    release();
    await manager.close();
    gate = undefined;
    const installed = JSON.parse(readFileSync(join(root, "installations.json"), "utf8"));
    assert.equal(installed.codex.managedVersion, "1.2.3");
    assert.deepEqual(installed.gemini, sibling);
    fail = true;
    manager.start("codex", "upgrade");
    await manager.close();
    assert.equal(manager.list().find((m) => m.harnessId === "codex")?.job?.state, "failed");
    assert.deepEqual(JSON.parse(readFileSync(join(root, "installations.json"), "utf8")), installed);
    fail = false;
    traversal = true;
    manager.start("codex", "upgrade");
    await manager.close();
    assert.equal(manager.list().find((m) => m.harnessId === "codex")?.job?.state, "failed");
    manager.restore("codex");
    assert.deepEqual(JSON.parse(readFileSync(join(root, "installations.json"), "utf8")).codex, old);
  } finally {
    await manager.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
