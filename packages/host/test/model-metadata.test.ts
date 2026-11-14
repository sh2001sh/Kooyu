import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { createAgentSession } from "@earendil-works/pi-coding-agent";
import type { Session } from "@kodo/protocol";
import { createKodoKernel } from "../src/kodo/kernel.js";
import { nativeParameters } from "../src/harnesses/model-metadata.js";
import {
  acpModelOptions,
  claudeModelOptions,
  codexModelOptions,
  openCodeModelOptions,
  zcodeModelOptions,
  zcodeBuiltinModelOptions,
} from "../src/harnesses/model-options.js";
import {
  getKodoBuiltinCatalog,
  getKodoConfiguredCatalog,
  mergeModelOptions,
} from "../src/harnesses/models.js";
import { Store } from "../src/storage/store.js";
import { SessionService } from "../src/session-service.js";
import { descriptor, type HarnessAdapter } from "../src/harnesses/adapter.js";

test("missing limits and effort declarations remain unknown; explicit unsupported stays distinct", () => {
  const source = { kind: "native-runtime" as const, label: "Isolated synthetic native metadata" };
  assert.deepEqual(
    nativeParameters({ contextWindow: 0, maxInputTokens: "128000", maxOutputTokens: -1 }, source),
    {},
  );
  assert.deepEqual(
    nativeParameters(
      { contextWindow: Infinity, maxInputTokens: 1.1, reasoning: ["valid", 42] },
      source,
    ),
    {},
  );
  assert.equal(codexModelOptions([{ model: "a" }])[0]!.reasoning, undefined);
  assert.deepEqual(
    codexModelOptions([{ model: "a", supportedReasoningEfforts: [] }])[0]!.reasoning,
    [],
  );
  const codexDefault = codexModelOptions([
    { model: "native-default", isDefault: true, contextWindow: 123456 },
  ])[0]!;
  assert.equal(codexDefault.isDefault, true);
  assert.equal(codexDefault.contextWindow, 123456);
  assert.equal(codexDefault.parameterSources?.contextWindow?.kind, "native-runtime");
  assert.equal(claudeModelOptions([{ value: "a", supportsEffort: true }])[0]!.reasoning, undefined);
  assert.deepEqual(claudeModelOptions([{ value: "a", supportsEffort: false }])[0]!.reasoning, []);
  assert.equal(
    acpModelOptions([
      { category: "model", type: "select", currentValue: "a", options: [{ value: "a" }] },
    ])[0]!.reasoning,
    undefined,
  );
  assert.equal(zcodeModelOptions({ provider: "synthetic", model: "a" })[0]!.reasoning, undefined);
  assert.equal(zcodeModelOptions({ provider: "synthetic", model: "a" })[0]!.isCurrent, true);
});

test("ZCode bundled candidates show sourced reference limits and bundled reasoning levels", () => {
  const builtin = {
    config: {
      modelConfigRules: {
        modelRules: [
          { modelMatch: ".*", config: { properties: { contextWindow: 999999 } } },
          {
            modelMatch: ".*GLM-5\\.3.*",
            config: {
              properties: { contextWindow: 1000000 },
              optionSpecs: {
                maxOutputTokens: { max: 128000 },
                reasoningLevel: { values: ["low"] },
              },
            },
          },
        ],
        builtinProviderModelRules: [
          { providerId: "account:test", modelId: "GLM-5.3", config: { enabled: true } },
        ],
      },
    },
  };
  const candidate = zcodeBuiltinModelOptions(builtin)[0]!;
  assert.equal(candidate.id, "account:test/GLM-5.3");
  assert.equal(candidate.contextWindow, 1000000);
  assert.equal(candidate.maxOutputTokens, 128000);
  assert.deepEqual(candidate.reasoning, ["low"]);
  assert.equal(candidate.parameterSources?.contextWindow?.kind, "native-catalog");
  const current = zcodeModelOptions(
    { provider: "account:test", model: "GLM-5.3", thoughtLevels: ["high"] },
    builtin,
  )[0]!;
  assert.deepEqual(current.reasoning, ["high"]);
  assert.equal(current.parameterSources?.reasoning?.kind, "native-runtime");
  assert.equal(current.parameterSources?.contextWindow?.kind, "native-catalog");
});

test("OpenCode limits and variants stay scoped to the connected provider and exact model", () => {
  const models = openCodeModelOptions({
    connected: ["synthetic"],
    all: [
      { id: "other", models: { a: { limit: { context: 900000 } } } },
      {
        id: "synthetic",
        models: {
          a: {
            limit: { context: 123456, input: 110000, output: 3456 },
            variants: { adaptive: {}, deep: {} },
          },
          b: { variants: {} },
          c: {},
        },
      },
    ],
  });
  assert.equal(models.length, 3);
  assert.equal(models[0]!.contextWindow, 123456);
  assert.equal(models[0]!.maxInputTokens, 110000);
  assert.equal(models[0]!.maxOutputTokens, 3456);
  assert.deepEqual(models[0]!.reasoning, ["adaptive", "deep"]);
  assert.equal(models[0]!.parameterSources?.contextWindow?.kind, "native-runtime");
  assert.deepEqual(models[1]!.reasoning, []);
  assert.equal(models[1]!.contextWindow, undefined);
  assert.equal(models[2]!.reasoning, undefined);
});

test("recent IDs do not erase the SDK catalog's limits or model-specific thinking levels", async () => {
  const catalog = await getKodoBuiltinCatalog();
  const model = catalog.find((m) => m.provider === "openai" && m.id === "gpt-5")!;
  assert.ok(model.contextWindow && model.maxOutputTokens);
  assert.equal(model.parameterSources?.contextWindow?.kind, "native-catalog");
  assert.ok(model.parameterSources?.reasoning?.version);
  assert.ok(model.reasoning?.includes("minimal"));
  assert.ok(!model.reasoning?.includes("xhigh"));
  const merged = mergeModelOptions(
    [{ id: model.id, provider: model.provider, source: "recent" }],
    [model],
  );
  assert.deepEqual(merged, [model]);
  // A distinct native route shadows the SDK entry atomically. Do not fill its
  // absent fields using a same-named model from a different endpoint.
  const route = { id: model.id, provider: model.provider, source: "discovered" as const };
  assert.deepEqual(mergeModelOptions([route], [model]), [route]);
});

test("pi local config never exposes SDK fallback token limits for an incomplete custom model", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kodo-native-model-config-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  writeFileSync(
    join(dir, "models.json"),
    JSON.stringify({
      providers: {
        synthetic: {
          baseUrl: "https://example.invalid",
          api: "openai-completions",
          models: [
            { id: "incomplete" },
            { id: "unmapped", contextWindow: 123456, maxTokens: 3456, reasoning: true },
          ],
        },
      },
    }),
  );
  try {
    const models = await getKodoConfiguredCatalog();
    assert.equal(models[0]?.id, "incomplete");
    assert.equal(models[0]!.contextWindow, undefined);
    assert.equal(models[0]!.maxOutputTokens, undefined);
    assert.equal(models[0]!.reasoning, undefined);
    assert.equal(models[1]!.reasoning, undefined);
    const create = (async () => {
      throw new Error("must not create native session");
    }) as unknown as typeof createAgentSession;
    const ctx = {
      cwd: dir,
      dataDir: dir,
      env: {},
      launch: { command: "kodo-sdk", args: [] },
      model: "synthetic/incomplete",
      emit: () => {},
      interact: async () => ({}),
    };
    await assert.rejects(
      createKodoKernel({ id: randomUUID(), harnessId: "pi" } as Session, ctx, create),
      /未完整声明/,
    );
    await assert.rejects(
      createKodoKernel(
        { id: randomUUID(), harnessId: "pi" } as Session,
        { ...ctx, model: "synthetic/unmapped", reasoning: "high" },
        create,
      ),
      /未声明思考档位映射/,
    );
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Codex native default reaches draft and existing session model selectors", async (t) => {
  // Isolate from the developer's own ~/.codex/config.toml default.
  const previousHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = mkdtempSync(join(tmpdir(), "kodo-codex-home-"));
  t.after(() => {
    if (previousHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousHome;
  });
  const store = new Store(":memory:");
  const adapter: HarnessAdapter = {
    descriptor: descriptor(
      "codex",
      "Synthetic Codex",
      "app-server",
      [],
      "Synthetic catalog",
      "implemented",
    ),
    discoverModels: async () => [
      { id: "native-default", source: "discovered", isDefault: true, contextWindow: 123456 },
    ],
    connect: async () => {
      throw new Error("must not connect");
    },
  };
  const service = new SessionService(store, { adapters: [adapter] });
  try {
    const draft = service.createDraft({
      title: "Default model",
      harnessId: "codex",
      kind: "direct",
    });
    const catalog = await service.harnessModels("codex", true);
    assert.equal(catalog.defaultModel?.model, "native-default");
    const settings = await service.sessionModelOptions(draft.id);
    assert.equal(settings.defaultModel?.model, "native-default");
    assert.equal(settings.models[0]?.contextWindow, 123456);
  } finally {
    await service.dispose();
    store.close();
  }
});

test("opening an idle ZCode model picker discovers bundled candidates without opening a native session", async () => {
  const store = new Store(":memory:");
  const adapter: HarnessAdapter = {
    descriptor: descriptor(
      "zcode",
      "Synthetic ZCode",
      "app-server",
      [],
      "Synthetic catalog",
      "partial",
    ),
    discoverModels: async () => [
      { id: "account:test/GLM-5.3", source: "native-catalog", contextWindow: 1000000 },
    ],
    connect: async () => {
      throw new Error("must not connect");
    },
  };
  const service = new SessionService(store, { adapters: [adapter] });
  try {
    const draft = service.createDraft({
      title: "ZCode picker",
      harnessId: "zcode",
      kind: "direct",
    });
    const options = await service.sessionModelOptions(draft.id, false, true);
    assert.equal(options.models[0]?.id, "account:test/GLM-5.3");
    assert.equal(store.session(draft.id).nativeSessionId, null);
  } finally {
    await service.dispose();
    store.close();
  }
});

test("DSH and ZCode settings cannot bypass effort validation; refreshed catalogs replace stale declarations", async () => {
  const store = new Store(":memory:");
  let revision = 1;
  const adapters = (["deepseek-harness", "zcode"] as const).map((id): HarnessAdapter => ({
    descriptor: descriptor(
      id,
      "Synthetic declaration test",
      "app-server",
      [],
      "No native or model execution",
      "partial",
    ),
    connect: async () => {
      throw new Error("must not connect");
    },
    discoverModels: async () => [
      { id: "synthetic/model", source: "discovered", reasoning: [`declared-${revision}`] },
    ],
  }));
  const service = new SessionService(store, { adapters });
  try {
    for (const adapter of adapters) {
      const session = service.createDraft({
        title: "Synthetic metadata validation",
        harnessId: adapter.descriptor.id,
        kind: "direct",
        bindingId: null,
      });
      await assert.rejects(
        service.setModelSettings(session.id, {
          requestId: randomUUID(),
          expectedRevision: 0,
          model: "synthetic/model",
          reasoning: "handwritten",
        }),
        /未声明/,
      );
      assert.equal(store.session(session.id).settingsRevision, 0);
    }
    const first = await service.harnessModels("zcode", true);
    assert.deepEqual(first.models[0]!.reasoning, ["declared-1"]);
    revision = 2;
    const refreshed = await service.harnessModels("zcode", true);
    assert.deepEqual(refreshed.models[0]!.reasoning, ["declared-2"]);
  } finally {
    await service.dispose();
    store.close();
  }
});
