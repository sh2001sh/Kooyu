import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  CatalogModel,
  BindingRuntime,
  HarnessBinding,
  Provider,
  Session,
} from "@kodo/protocol";
import {
  HARNESS_PROVIDER_PROTOCOLS,
  bindingReasoningLevels,
  bindingThinkingLevelMap,
} from "@kodo/protocol/client";
import { boundNativeModel } from "../src/providers/native-config.js";
import type { createAgentSession } from "@earendil-works/pi-coding-agent";
import { normalizeContext, type Model } from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-responses";
import { Store } from "../src/storage/store.js";
import { ProviderService, type ProviderVault } from "../src/providers/service.js";
import { collectProviderCredentials, instanceEnv } from "../src/configuration/config.js";
import { SessionService } from "../src/session-service.js";
import { createKodoKernel } from "../src/kodo/kernel.js";
import { parsePublicCatalog } from "../src/providers/catalog.js";
import { officialModelReasoning } from "../src/providers/model-reasoning.js";

// Isolated synthetic metadata and in-memory credentials; these are not native chat proofs.
const payload = (context = 123456) => ({
  models: {
    canonical: {
      limit: { context: 999999, output: 3000 },
      reasoning: true,
      modalities: { input: ["text"] },
    },
  },
  providers: {
    synthetic: {
      models: {
        example: {
          name: "Example",
          canonical_model_id: "canonical",
          limit: { context, output: 2345 },
          reasoning_options: [{ type: "effort", values: ["low", "high"] }],
        },
      },
    },
  },
});
const response = (value: unknown, etag = '"synthetic-v1"') =>
  Response.json(value, { headers: { etag } });
function fixture(fetcher: typeof fetch = async () => response(payload())) {
  const store = new Store(":memory:"),
    keys = new Map<string, string>();
  const vault: ProviderVault = {
    get: async (ref) => keys.get(ref) ?? null,
    set: async (ref, value) => {
      keys.set(ref, value);
    },
    delete: async (ref) => {
      keys.delete(ref);
    },
  };
  // These tests drive discovery explicitly; automatic save has dedicated regression coverage.
  const providers = new ProviderService(store, { vault, fetcher, autoDiscover: false });
  return {
    store,
    keys,
    vault,
    providers,
    async close() {
      await providers.close();
      store.close();
    },
  };
}

function configurationFor(f: ReturnType<typeof fixture>, binding: HarnessBinding): BindingRuntime {
  const provider = f.store.record<Provider>(
    "provider-revision",
    `${binding.providerId}:${binding.providerRevision}`,
  )!;
  const endpoint = provider.endpoints.find((item) => item.id === binding.endpointId)!;
  return {
    id: binding.id,
    revision: binding.revision,
    name: binding.name,
    provider: `kodo-${provider.id}`,
    model: binding.model,
    protocol: binding.protocol,
    baseUrl: endpoint.baseUrl,
    credentialRef: endpoint.credentialRef,
    modelParameters: binding.parameters,
    binding,
  };
}

test("remaining native Provider bindings generate isolated configurations, key references and exact model aliases", async () => {
  const f = fixture(),
    dir = mkdtempSync(join(tmpdir(), "kodo-native-binding-"));
  try {
    for (const harness of [
      "deepseek-harness",
      "zcode",
      "gemini",
      "kimi-code",
      "grok-build",
    ] as const) {
      const { m } = await setup(
        f,
        harness === "gemini" ? "google-generative-ai" : "anthropic-messages",
      );
      const b = f.providers.saveBinding({
        name: `Isolated ${harness}`,
        harnessId: harness,
        modelId: m.id,
        reasoning: "high",
      });
      const frozen = configurationFor(f, b);
      const runtime = await f.providers.runtime(frozen.binding);
      const env = await instanceEnv(harness, runtime.configuration, dir, runtime.apiKey);
      let config: string;
      if (harness === "deepseek-harness") {
        config = readFileSync(join(env.DSH_HOME!, "cordis.patch.yml"), "utf8");
        const rows = JSON.parse(config);
        const route = rows.find((r: any) => r.id === "llm-pi-ai").config.providers[frozen.provider];
        assert.equal(route.apiKeyEnv, "KODO_PROVIDER_KEY");
        assert.equal(route.models[0].contextWindow, 123456);
        assert.equal(route.models[0].maxTokens, 2345);
        assert.deepEqual(route.models[0].reasoningEfforts, { low: "low", high: "high" });
        assert.equal(
          rows.some((r: any) => r.id === "llm-deepseek"),
          false,
        );
      } else if (harness === "zcode") {
        config = readFileSync(env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE!, "utf8");
        const c = JSON.parse(config).config;
        assert.equal(c.defaultModelSelection.options.reasoningLevel, "high");
        assert.equal(c.providerConfigRules.providerRules[0].config.access.apiKey, runtime.apiKey);
        assert.notEqual(runtime.apiKey, "ISOLATED_SYNTHETIC_SECRET");
        assert.match(
          c.providerConfigRules.providerRules[0].config.api.baseUrl,
          /^http:\/\/127\.0\.0\.1:/,
        );
        assert.equal(boundNativeModel(frozen), `${frozen.provider}/example`);
      } else if (harness === "gemini") {
        config = readFileSync(join(env.GEMINI_CLI_HOME!, ".gemini", "settings.json"), "utf8");
        const c = JSON.parse(config);
        assert.equal(c.security.auth.selectedType, "gemini-api-key");
        assert.equal(
          c.modelConfigs.customOverrides[0].modelConfig.generateContentConfig.thinkingConfig
            .thinkingLevel,
          "HIGH",
        );
        assert.equal(env.GOOGLE_GEMINI_BASE_URL, frozen.baseUrl);
      } else {
        config = readFileSync(
          join(harness === "kimi-code" ? env.KIMI_CODE_HOME! : env.GROK_HOME!, "config.toml"),
          "utf8",
        );
        assert.match(config, /(?:api_key_env|env_key) = "KODO_PROVIDER_KEY"/);
        assert.match(
          config,
          harness === "kimi-code" ? /max_context_size = 123456/ : /context_window = 123456/,
        );
        assert.match(
          config,
          harness === "kimi-code" ? /type = "anthropic"/ : /api_backend = "messages"/,
        );
      }
      assert.ok(config.includes("high") || config.includes("HIGH"));
      assert.equal(config.includes("ISOLATED_SYNTHETIC_SECRET"), false);
      assert.equal(env.KODO_PROVIDER_KEY, runtime.apiKey);
      assert.ok(JSON.stringify(env).includes(dir.replaceAll("\\", "\\\\")));
    }
  } finally {
    await f.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("binding protocol matrix allows the Gemini Chat gateway and rejects unsupported formats and Cursor", async () => {
  const f = fixture();
  try {
    for (const protocol of [
      "openai-completions",
      "openai-responses",
      "anthropic-messages",
      "google-generative-ai",
    ] as const) {
      const { m } = await setup(f, protocol);
      for (const harness of [
        "deepseek-harness",
        "zcode",
        "gemini",
        "cursor",
        "kimi-code",
        "grok-build",
      ] as const) {
        const preview = f.providers.preview({
          name: "Format check",
          harnessId: harness,
          modelId: m.id,
        });
        assert.equal(
          preview.supported,
          HARNESS_PROVIDER_PROTOCOLS[harness].includes(protocol) ||
            (harness === "gemini" && protocol === "openai-completions"),
          `${harness}/${protocol}`,
        );
        if (harness === "gemini" && protocol === "openai-completions") {
          assert.equal(preview.route, "gateway");
          assert.equal(preview.credentialTransport, "local-relay");
        }
        if (harness === "cursor")
          assert.match(preview.issues.join(" "), /Cursor Agent.*自定义 Provider/);
      }
    }
    const { p } = await setup(f, "openai-completions");
    const unknown = await f.providers.saveModel({
      providerId: p.id,
      endpointId: p.endpoints[0]!.id,
      model: "unknown",
    });
    for (const harnessId of ["deepseek-harness", "kimi-code"])
      assert.equal(
        f.providers.preview({ name: "Unknown", harnessId, modelId: unknown.id }).supported,
        false,
      );
    assert.deepEqual(
      bindingReasoningLevels(
        {
          reasoning: true,
          reasoningOptions: [{ type: "effort", values: ["none", "low", "high"] }],
        },
        "zcode",
      ),
      ["disabled", "low", "high"],
    );
    assert.deepEqual(bindingReasoningLevels({ reasoning: false }, "deepseek-harness"), ["off"]);
  } finally {
    await f.close();
  }
});

test("Gemini Chat binding uses a local Google protocol endpoint and never gives CLI the upstream key", async () => {
  const f = fixture();
  try {
    const { m } = await setup(f, "openai-completions");
    const binding = f.providers.saveBinding({
      name: "Gemini via Chat",
      harnessId: "gemini",
      modelId: m.id,
      reasoning: "high",
    });
    assert.equal(binding.route, "gateway");
    const frozen = configurationFor(f, binding);
    const runtime = await f.providers.runtime(frozen.binding);
    assert.equal(runtime.configuration?.protocol, "google-generative-ai");
    assert.match(runtime.configuration?.baseUrl ?? "", /^http:\/\/127\.0\.0\.1:\d+\//);
    assert.notEqual(runtime.apiKey, "ISOLATED_SYNTHETIC_SECRET");
    assert.equal(frozen.protocol, "openai-completions");
    assert.equal(frozen.baseUrl, "http://127.0.0.1:1/v1");
  } finally {
    await f.close();
  }
});

test("one-click binding and harness default commit atomically, preserve other defaults and replay without reapplying", async () => {
  const f = fixture(),
    service = new SessionService(f.store, { providerVault: f.vault });
  try {
    const { m } = await setup(f);
    const old = service.createDraft({
      title: "Existing native config",
      harnessId: "zcode",
      kind: "direct",
      bindingId: null,
    });
    service.updateBindingDefaults({
      expectedRevision: 0,
      harnessBindingIds: { pi: null },
    });
    const request = {
      requestId: randomUUID(),
      name: "One click",
      harnessId: "zcode",
      modelId: m.id,
      applyAsDefault: true,
      expectedDefaultsRevision: 1,
    };
    const b = f.providers.saveBinding(request);
    assert.equal(service.bindingDefaults().harnessBindingIds.zcode, b.id);
    assert.equal(service.bindingDefaults().harnessBindingIds.pi, null);
    assert.equal(service.bindingDefaults().revision, 2);
    assert.equal(f.store.session(old.id).bindingId, null);
    assert.equal(
      service.createDraft({ title: "New default", harnessId: "zcode", kind: "direct" }).bindingId,
      b.id,
    );
    const count = f.store.records("harness-binding").length;
    assert.throws(
      () =>
        f.providers.saveBinding({
          ...request,
          requestId: randomUUID(),
          name: "Conflict",
          expectedDefaultsRevision: 0,
        }),
      /默认配置已修改/,
    );
    assert.equal(f.store.records("harness-binding").length, count);
    assert.equal(f.store.records("harness-binding").length, 1);
    service.updateBindingDefaults({
      expectedRevision: 2,
      harnessBindingIds: { pi: null, zcode: null },
    });
    assert.equal(f.providers.saveBinding(request).id, b.id);
    assert.equal(service.bindingDefaults().harnessBindingIds.zcode, null);
    assert.equal(service.bindingDefaults().revision, 3);
  } finally {
    await service.dispose();
    await f.close();
  }
});
async function setup(f: ReturnType<typeof fixture>, protocol = "openai-responses") {
  await f.providers.refreshCatalog();
  const p = await f.providers.saveProvider({
    name: "Synthetic route",
    catalogProvider: "synthetic",
    endpoints: [
      {
        name: "Primary",
        protocol,
        baseUrl: "http://127.0.0.1:1/v1",
        apiKey: "ISOLATED_SYNTHETIC_SECRET",
      },
    ],
  });
  const m = await f.providers.saveModel({
    providerId: p.id,
    endpointId: p.endpoints[0]!.id,
    model: "example",
  });
  return { p, m };
}

test("public model route limits override canonical fallback; no fuzzy model alias matching", () => {
  const entries = parsePublicCatalog(payload());
  assert.equal(entries[0]!.parameters.contextWindow, 123456);
  assert.equal(entries[0]!.parameters.maxOutputTokens, 2345);
  assert.equal(entries[0]!.parameters.reasoning, true);
  assert.equal(entries[0]!.canonicalKey, "canonical");
  assert.throws(() => parsePublicCatalog({ providers: {}, models: {} }), /目录规模/);
});

test("DeepSeek fallback uses official protocol efforts instead of a same-name reseller", async () => {
  const f = fixture(async (url) =>
    String(url).includes("models.dev")
      ? response({
          models: {},
          providers: {
            reseller: {
              models: {
                "deepseek-v4.1-flash": {
                  limit: { context: 1000000, output: 128000 },
                  reasoning: true,
                  modalities: { input: ["text"] },
                  reasoning_options: [{ type: "effort", values: ["low", "medium", "high"] }],
                },
              },
            },
          },
        })
      : response({
          data: [
            {
              id: "deepseek-v4.1-flash",
              reasoning_options: [{ type: "effort", values: ["low", "high"] }],
            },
          ],
        }),
  );
  try {
    await f.providers.refreshCatalog();
    const provider = await f.providers.saveProvider({
      name: "Synthetic gateway",
      endpoints: [
        { name: "Responses", protocol: "openai-responses", baseUrl: "http://localhost:1/v1" },
      ],
    });
    const model = await f.providers.saveModel({
      providerId: provider.id,
      endpointId: provider.endpoints[0]!.id,
      model: "deepseek-v4.1-flash",
    });
    assert.deepEqual(bindingReasoningLevels(model.effective), ["none", "low", "high", "max"]);
    assert.deepEqual(bindingReasoningLevels(model.effective, "kodo"), [
      "off",
      "low",
      "high",
      "max",
    ]);
    assert.equal(
      f.providers.preview({
        name: "Allowed",
        harnessId: "kodo",
        modelId: model.id,
        reasoning: "off",
      }).supported,
      true,
    );
    assert.equal(
      f.providers.preview({
        name: "Rejected",
        harnessId: "kodo",
        modelId: model.id,
        reasoning: "medium",
      }).supported,
      false,
    );
    await f.providers.discover(provider.id, provider.endpoints[0]!.id);
    const current = (await f.providers.configuration()).models.find(
      (item) => item.id === model.id,
    )!;
    assert.deepEqual(bindingReasoningLevels(current.effective), ["low", "high"]);
    assert.equal(current.sources.reasoningOptions!.kind, "endpoint");
    const edited = await f.providers.saveModel({
      ...identity(current),
      overrides: { reasoningOptions: [{ type: "effort", values: ["high"] }] },
    });
    assert.deepEqual(bindingReasoningLevels(edited.effective), ["high"]);
  } finally {
    await f.close();
  }
});

test("DeepSeek thinking definitions distinguish Responses none from SDK off", () => {
  const responses = officialModelReasoning("deepseek-v4.1-flash", "openai-responses")!;
  assert.deepEqual(bindingThinkingLevelMap(responses), {
    off: "none",
    minimal: null,
    low: "low",
    medium: null,
    high: "high",
    xhigh: null,
    max: "max",
  });
  const chat = officialModelReasoning("deepseek-v4.1-flash-1017", "openai-completions")!;
  assert.deepEqual(bindingReasoningLevels(chat), ["low", "high", "max"]);
  assert.equal(
    bindingThinkingLevelMap({ ...responses, thinkingLevelMap: { high: "max" } }).off,
    null,
  );
  assert.equal(
    bindingThinkingLevelMap({ ...responses, thinkingLevelMap: { high: "max" } }).high,
    "max",
  );
  assert.equal(officialModelReasoning("unrelated-deepseek-model", "openai-responses"), undefined);
});

test("DeepSeek Responses binding sends none, low, high and max through the pi SDK", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kodo-deepseek-wire-")),
    f = fixture();
  try {
    const { p } = await setup(f);
    const model = await f.providers.saveModel({
      providerId: p.id,
      endpointId: p.endpoints[0]!.id,
      model: "deepseek-v4.1-flash",
      overrides: { contextWindow: 1000000, maxOutputTokens: 128000, input: ["text"] },
    });
    const binding = f.providers.saveBinding({
      name: "DeepSeek wire fixture",
      harnessId: "pi",
      modelId: model.id,
      reasoning: "off",
    });
    const create = (async (options: Parameters<typeof createAgentSession>[0]) => {
      assert.equal(options!.thinkingLevel, "off");
      for (const level of ["off", "low", "high", "max"] as const) {
        let sent: { model: string; reasoning: { effort: string } } | undefined;
        const output = await streamSimple(
          options!.model! as Model<"openai-responses">,
          normalizeContext({ messages: [{ role: "user", content: "synthetic", timestamp: 0 }] }),
          {
            apiKey: "SYNTHETIC_RUNTIME_KEY",
            reasoning: level === "off" ? undefined : level,
            fetch: async (_url, init) => {
              sent = JSON.parse(String(init!.body));
              return new Response(
                `data: ${JSON.stringify({
                  type: "response.completed",
                  response: { id: "synthetic-response", status: "completed", output: [] },
                })}\n\n`,
                { headers: { "content-type": "text/event-stream" } },
              );
            },
          },
        ).result();
        assert.equal(output.stopReason, "stop", output.errorMessage);
        assert.equal(sent!.model, "deepseek-v4.1-flash");
        assert.equal(sent!.reasoning.effort, level === "off" ? "none" : level);
      }
      throw new Error("SYNTHETIC_DEEPSEEK_REQUESTS_VERIFIED");
    }) as typeof createAgentSession;
    await assert.rejects(
      createKodoKernel(
        { id: randomUUID(), harnessId: "pi" } as Session,
        {
          cwd: null,
          dataDir: dir,
          configuration: configurationFor(f, binding),
          env: { KODO_PROVIDER_KEY: "SYNTHETIC_RUNTIME_KEY" },
          reasoning: "off",
          launch: { command: "kodo-sdk", args: [] },
          emit: () => {},
          interact: async () => ({}),
        },
        create,
      ),
      /SYNTHETIC_DEEPSEEK_REQUESTS_VERIFIED/,
    );
  } finally {
    await f.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("configuration hydrates missing catalog prices on saved models without losing overrides", async () => {
  const f = fixture();
  try {
    const { m } = await setup(f);
    const edited = await f.providers.saveModel({
      ...identity(m),
      overrides: { pricing: { input: 0 }, contextWindow: 222222 },
    });
    const catalog = f.store.record<any>("model-catalog", "current")!;
    catalog.entries[0].pricing = { input: 1.25, output: 4.5, cacheRead: 0.1 };
    f.store.put("model-catalog", "current", catalog);
    const current = (await f.providers.configuration()).models.find((model) => model.id === m.id)!;
    assert.deepEqual(current.automatic.pricing, { input: 1.25, output: 4.5, cacheRead: 0.1 });
    assert.deepEqual(current.effective.pricing, { input: 0, output: 4.5, cacheRead: 0.1 });
    assert.equal(current.effective.contextWindow, 222222);
    assert.equal(current.sources.pricing?.kind, "user");
    assert.equal(current.revision, edited.revision + 1);
    const again = (await f.providers.configuration()).models.find((model) => model.id === m.id)!;
    assert.equal(again.revision, current.revision);
  } finally {
    await f.close();
  }
});

test("ETag 304 preserves revisions; invalid refresh preserves last good data and manual overrides", async () => {
  let mode = 0,
    conditional: string | undefined;
  const f = fixture(async (_url, init) => {
    conditional = (init?.headers as Record<string, string>)["If-None-Match"];
    return mode === 1
      ? new Response(null, { status: 304 })
      : mode === 2
        ? response({ invalid: true })
        : response(payload());
  });
  try {
    const { p, m } = await setup(f);
    const override = await f.providers.saveModel({
      ...identity(m),
      overrides: { contextWindow: 654321 },
    });
    const before = f.providers.state();
    mode = 1;
    await f.providers.refreshCatalog();
    assert.equal(conditional, '"synthetic-v1"');
    assert.equal(f.providers.state().revision, before.revision);
    assert.equal(f.store.record<CatalogModel>("provider-model", m.id)!.revision, override.revision);
    mode = 2;
    await assert.rejects(f.providers.refreshCatalog(), /保留最后有效/);
    assert.equal(
      f.store.record<CatalogModel>("provider-model", m.id)!.effective.contextWindow,
      654321,
    );
    assert.equal(f.store.record<CatalogModel>("provider-model", m.id)!.providerId, p.id);
  } finally {
    await f.close();
  }
});
function identity(m: CatalogModel) {
  return {
    id: m.id,
    expectedRevision: m.revision,
    providerId: m.providerId,
    endpointId: m.endpointId,
    model: m.model,
  };
}

test("online updates keep user overrides and immutable session bindings; restore automatic is explicit", async () => {
  let context = 123456;
  const f = fixture(async () => response(payload(context)));
  try {
    const { m } = await setup(f);
    assert.equal(m.revision, 1);
    const edited = await f.providers.saveModel({
      ...identity(m),
      overrides: { contextWindow: 222222 },
    });
    assert.equal(edited.sources.contextWindow!.kind, "user");
    const binding = f.providers.saveBinding({
      name: "Bound",
      harnessId: "codex",
      modelId: edited.id,
      reasoning: "high",
    });
    context = 333333;
    await f.providers.refreshCatalog();
    const current = f.store.record<CatalogModel>("provider-model", m.id)!;
    assert.equal(current.automatic.contextWindow, 333333);
    assert.equal(current.effective.contextWindow, 222222);
    assert.equal(configurationFor(f, binding).modelParameters!.contextWindow, 222222);
    const restored = await f.providers.saveModel({ ...identity(current), overrides: {} });
    assert.equal(restored.effective.contextWindow, 333333);
    assert.equal(restored.sources.contextWindow!.kind, "remote-catalog");
    await assert.rejects(f.providers.saveModel({ ...identity(m), overrides: {} }), /修订/);
  } finally {
    await f.close();
  }
});

test("multiple protocol endpoints retain independent model identity and discovered metadata wins", async () => {
  const f = fixture(async (url) =>
    String(url).includes("models.dev")
      ? response(payload())
      : response({ data: [{ id: "example", contextWindow: 444444, maxOutputTokens: 789 }] }),
  );
  try {
    const p = await f.providers.saveProvider({
      name: "Two routes",
      catalogProvider: "synthetic",
      endpoints: [
        { name: "Responses", protocol: "openai-responses", baseUrl: "http://127.0.0.1:1/v1" },
        { name: "Messages", protocol: "anthropic-messages", baseUrl: "http://127.0.0.1:2/v1" },
      ],
    });
    await f.providers.refreshCatalog();
    const a = (await f.providers.discover(p.id, p.endpoints[0]!.id))[0]!;
    const b = await f.providers.saveModel({
      providerId: p.id,
      endpointId: p.endpoints[1]!.id,
      model: "example",
    });
    assert.notEqual(a.id, b.id);
    assert.equal(a.effective.contextWindow, 444444);
    assert.equal(a.sources.contextWindow!.kind, "endpoint");
    assert.equal(b.effective.contextWindow, 123456);
    const unknown = await f.providers.saveModel({
      providerId: p.id,
      endpointId: p.endpoints[0]!.id,
      model: "example-latest",
    });
    assert.deepEqual(unknown.effective, {});
    assert.equal(
      f.providers.preview({ name: "Incomplete", harnessId: "kodo", modelId: unknown.id }).supported,
      false,
    );
  } finally {
    await f.close();
  }
});

test("pagination deduplicates IDs and a stale provider response is not applied", async () => {
  let release: (() => void) | undefined,
    gate = false;
  const f = fixture(async (url) => {
    if (String(url).includes("models.dev")) return response(payload());
    if (gate)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    return response(
      String(url).includes("after=")
        ? { data: [{ id: "example" }, { id: "other" }] }
        : { data: [{ id: "example" }], has_more: true, last_id: "example" },
    );
  });
  try {
    const { p } = await setup(f);
    assert.equal((await f.providers.discover(p.id, p.endpoints[0]!.id)).length, 2);
    gate = true;
    const pending = f.providers.discover(p.id, p.endpoints[0]!.id);
    while (!release) await new Promise((r) => setTimeout(r, 1));
    await f.providers.saveProvider({
      id: p.id,
      expectedRevision: p.revision,
      name: "Changed",
      endpoints: p.endpoints.map((e) => ({
        id: e.id,
        name: e.name,
        protocol: e.protocol,
        baseUrl: e.baseUrl,
      })),
    });
    gate = false;
    release();
    await assert.rejects(pending, /Provider 已更改/);
  } finally {
    await f.close();
  }
});

test("keyring rotation preserves current Provider keys and pinned profile revisions; no raw secret persisted", async () => {
  const f = fixture();
  try {
    const { p, m } = await setup(f);
    const binding = f.providers.saveBinding({ name: "Frozen", harnessId: "codex", modelId: m.id });
    await collectProviderCredentials(f.store, f.vault);
    assert.equal(f.keys.size, 1);
    const next = await f.providers.saveProvider({
      id: p.id,
      expectedRevision: 1,
      name: p.name,
      endpoints: p.endpoints.map((e) => ({
        id: e.id,
        name: e.name,
        protocol: e.protocol,
        baseUrl: e.baseUrl,
        apiKey: "ISOLATED_SYNTHETIC_SECRET_2",
      })),
    });
    await collectProviderCredentials(f.store, f.vault);
    assert.equal(f.keys.size, 2);
    assert.notEqual(next.endpoints[0]!.credentialRef, p.endpoints[0]!.credentialRef);
    assert.equal(configurationFor(f, binding).credentialRef, p.endpoints[0]!.credentialRef);
    const config = await f.providers.configuration();
    assert.ok(!JSON.stringify(config).includes("ISOLATED_SYNTHETIC_SECRET"));
    assert.equal(
      f.providers.preview({ name: "Stale", harnessId: "codex", modelId: m.id }).supported,
      false,
    );
    await assert.rejects(
      f.providers.saveProvider({
        id: p.id,
        expectedRevision: 1,
        name: "Stale",
        endpoints: [{ name: "e", protocol: "openai-responses", baseUrl: "http://localhost" }],
      }),
      /Provider 已被修改/,
    );
  } finally {
    await f.close();
  }
});

test("bound session rejects a mismatched harness and model but permits declared next-turn effort", async () => {
  const f = fixture(),
    service = new SessionService(f.store, { providerVault: f.vault });
  try {
    const { m } = await setup(f);
    const b = f.providers.saveBinding({
      name: "Codex only",
      harnessId: "codex",
      modelId: m.id,
      reasoning: "high",
    });
    assert.throws(
      () =>
        service.createDraft({
          title: "Wrong",
          harnessId: "claude-code",
          kind: "direct",
          bindingId: b.id,
        }),
      /另一个 Harness/,
    );
    const session = service.createDraft({
      title: "Bound",
      harnessId: "codex",
      kind: "direct",
      bindingId: b.id,
    });
    assert.equal(session.reasoning, "high");
    assert.equal((await service.sessionModelOptions(session.id)).models[0]!.contextWindow, 123456);
    await service.setModelSettings(session.id, {
      requestId: randomUUID(),
      expectedRevision: 0,
      model: null,
      reasoning: "low",
    });
    await assert.rejects(
      service.setModelSettings(session.id, {
        requestId: randomUUID(),
        expectedRevision: 1,
        model: "another",
        reasoning: "low",
      }),
      /固定模型绑定/,
    );
    const disabled = await f.providers.saveModel({
      ...identity(m),
      overrides: { reasoning: false },
    });
    assert.equal(
      f.providers.preview({
        name: "Disabled",
        harnessId: "codex",
        modelId: disabled.id,
        reasoning: "high",
      }).supported,
      false,
    );
    assert.equal(
      (await service.sessionModelOptions(session.id)).models[0]!.reasoning?.includes("high"),
      true,
    );
  } finally {
    await service.dispose();
    await f.close();
  }
});

test("native isolated configuration consumes frozen parameters without persisting runtime credentials", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kodo-provider-config-")),
    f = fixture();
  try {
    const { m } = await setup(f),
      b = f.providers.saveBinding({ name: "Isolated", harnessId: "codex", modelId: m.id });
    const p = configurationFor(f, b);
    const env = await instanceEnv("codex", p, dir, "SYNTHETIC_RUNTIME_KEY");
    const config = readFileSync(join(env.CODEX_HOME!, "config.toml"), "utf8");
    assert.match(config, /model_context_window = 123456/);
    assert.ok(!config.includes("SYNTHETIC_RUNTIME_KEY"));
    assert.equal(env.OPENAI_API_KEY, "SYNTHETIC_RUNTIME_KEY");
  } finally {
    await f.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pi SDK receives explicit binding limits and restricted effort mapping, not SDK defaults", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kodo-bound-pi-")),
    f = fixture();
  try {
    const { m: automatic } = await setup(f, "openai-completions");
    const m = await f.providers.saveModel({
      ...identity(automatic),
      overrides: { thinkingLevelMap: { high: "high" } },
    });
    const b = f.providers.saveBinding({
      name: "SDK",
      harnessId: "pi",
      modelId: m.id,
      reasoning: "high",
    });
    const profile = configurationFor(f, b);
    const create = (async (options: Parameters<typeof createAgentSession>[0]) => {
      assert.equal(options!.model!.contextWindow, 123456);
      assert.equal(options!.model!.maxTokens, 2345);
      assert.equal(options!.model!.thinkingLevelMap!.high, "high");
      assert.equal(options!.model!.thinkingLevelMap!.medium, null);
      assert.equal(options!.model!.provider, profile.provider);
      throw new Error("SYNTHETIC_SDK_ARGUMENTS_VERIFIED_NO_MODEL_CALL");
    }) as typeof createAgentSession;
    await assert.rejects(
      createKodoKernel(
        { id: randomUUID(), harnessId: "pi" } as Session,
        {
          cwd: null,
          dataDir: dir,
          configuration: profile,
          env: { KODO_PROVIDER_KEY: "SYNTHETIC_RUNTIME_KEY" },
          reasoning: "high",
          launch: { command: "kodo-sdk", args: [] },
          emit: () => {},
          interact: async () => ({}),
        },
        create,
      ),
      /SYNTHETIC_SDK_ARGUMENTS_VERIFIED/,
    );
  } finally {
    await f.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("configuration request IDs deduplicate concurrent creation, survive restart and reject changed contents", async () => {
  const f = fixture();
  let restored: ProviderService | undefined;
  try {
    const request = {
      requestId: randomUUID(),
      name: "Idempotent",
      endpoints: [
        {
          name: "R",
          protocol: "openai-responses",
          baseUrl: "http://localhost/v1",
          apiKey: "SYNTHETIC_KEY",
        },
      ],
    };
    const [a, b] = await Promise.all([
      f.providers.saveProvider(request),
      f.providers.saveProvider(request),
    ]);
    assert.deepEqual(a, b);
    assert.equal(f.store.records("provider").length, 1);
    assert.equal(f.keys.size, 1);
    await assert.rejects(f.providers.saveProvider({ ...request, name: "Changed" }), /同一配置请求/);
    const modelRequest = {
      requestId: randomUUID(),
      providerId: a.id,
      endpointId: a.endpoints[0]!.id,
      model: "unknown",
    };
    const m = await f.providers.saveModel(modelRequest);
    assert.deepEqual(await f.providers.saveModel(modelRequest), JSON.parse(JSON.stringify(m)));
    const bindingRequest = {
      requestId: randomUUID(),
      name: "Binding",
      harnessId: "codex",
      modelId: m.id,
    };
    const bound = f.providers.saveBinding(bindingRequest);
    assert.deepEqual(f.providers.saveBinding(bindingRequest), JSON.parse(JSON.stringify(bound)));
    assert.equal(f.store.records("harness-binding").length, 1);
    assert.ok(!JSON.stringify(f.store.records("configuration-request")).includes("SYNTHETIC_KEY"));
    await f.providers.close();
    restored = new ProviderService(f.store, { vault: f.vault });
    assert.deepEqual(await restored.saveProvider(request), JSON.parse(JSON.stringify(a)));
    assert.deepEqual(await restored.saveModel(modelRequest), JSON.parse(JSON.stringify(m)));
    assert.deepEqual(restored.saveBinding(bindingRequest), JSON.parse(JSON.stringify(bound)));
  } finally {
    await restored?.close();
    await f.close();
  }
});

test("failed later discovery page leaves the complete previous list and parameter revisions intact", async () => {
  let fail = false;
  const f = fixture(async (url) => {
    if (String(url).includes("models.dev")) return response(payload());
    if (String(url).includes("after=")) return new Response(null, { status: 503 });
    return response(
      fail
        ? { data: [{ id: "new-model", contextWindow: 42 }], has_more: true, last_id: "new-model" }
        : { data: [{ id: "example", contextWindow: 444444 }] },
    );
  });
  try {
    const { p } = await setup(f);
    await f.providers.discover(p.id, p.endpoints[0]!.id);
    const before = f.store.records("provider-model");
    fail = true;
    await assert.rejects(f.providers.discover(p.id, p.endpoints[0]!.id), /保留原列表/);
    assert.deepEqual(f.store.records("provider-model"), before);
  } finally {
    await f.close();
  }
});

test("close aborts in-flight discovery and waits before SQLite may be closed", async () => {
  let started!: () => void;
  const ready = new Promise<void>((r) => {
    started = r;
  });
  const f = fixture(async (url, init) => {
    if (String(url).includes("models.dev")) return response(payload());
    return new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener(
        "abort",
        () => reject(new Error("synthetic cancelled discovery")),
        { once: true },
      );
      started();
    });
  });
  try {
    const { p } = await setup(f);
    const pending = f.providers.discover(p.id, p.endpoints[0]!.id);
    const rejected = assert.rejects(pending, /保留原列表/);
    await ready;
    await f.providers.close();
    await rejected;
    assert.equal(f.store.records("provider-model-discovery").length, 0);
    assert.throws(() => f.providers.discover(p.id, p.endpoints[0]!.id), /已经关闭/);
  } finally {
    await f.close();
  }
});

test("binding defaults reject another harness and native catalog prices stay unknown for custom routes", async () => {
  const f = fixture(),
    service = new SessionService(f.store, { providerVault: f.vault });
  try {
    const { m } = await setup(f);
    const b = f.providers.saveBinding({ name: "Codex", harnessId: "codex", modelId: m.id });
    assert.throws(
      () =>
        service.updateBindingDefaults({
          expectedRevision: 0,
          productProfileId: b.id,
          harnessBindingIds: {},
        }),
      /productProfileId/,
    );
    assert.throws(
      () =>
        service.updateBindingDefaults({
          expectedRevision: 0,
          harnessBindingIds: { pi: b.id },
        }),
      /另一个 Harness/,
    );
    const project = service.createProject({ name: "Defaults" });
    assert.throws(
      () =>
        service.updateProjectDefaults(project.id, {
          expectedRevision: 0,
          bindingDefaults: { pi: b.id },
        }),
      /另一个 Harness/,
    );
    service.updateBindingDefaults({
      expectedRevision: 0,
      harnessBindingIds: { codex: b.id },
    });
    const s = service.createDraft({ title: "Price unknown", harnessId: "codex", kind: "direct" });
    service.ingest(s.id, "usage", {
      input: 12,
      output: 8,
      costUsd: 0.1234,
      scope: "turn",
      sourceId: "synthetic-usage",
    });
    const usage = f.store.records<{ costUsd: number | null; costKind: string; input: number }>(
      "usage",
    )[0]!;
    assert.equal(usage.input, 12);
    assert.equal(usage.costUsd, null);
    assert.equal(usage.costKind, "unknown");
  } finally {
    await service.dispose();
    await f.close();
  }
});

test("unverified Codex custom-tool gateway is unavailable while verified Claude Messages bridge can be saved", async () => {
  const f = fixture();
  try {
    const { m } = await setup(f, "openai-completions");
    const input = { name: "Bridge", modelId: m.id, route: "gateway" };
    assert.equal(f.providers.preview({ ...input, harnessId: "codex" }).supported, false);
    assert.throws(() => f.providers.saveBinding({ ...input, harnessId: "codex" }), /自定义工具/);
    assert.equal(f.providers.saveBinding({ ...input, harnessId: "claude-code" }).route, "gateway");
  } finally {
    await f.close();
  }
});

test("anonymous bindings strip native credentials and OpenCode receives explicit Anthropic v1/limits/variants", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kodo-bound-env-")),
    f = fixture();
  const old = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "SYNTHETIC_UNRELATED_NATIVE_KEY";
  try {
    const p = await f.providers.saveProvider({
      name: "Anonymous",
      endpoints: [{ name: "A", protocol: "anthropic-messages", baseUrl: "http://localhost:1" }],
    });
    const m = await f.providers.saveModel({
      providerId: p.id,
      endpointId: p.endpoints[0]!.id,
      model: "unlisted",
      overrides: {
        contextWindow: 987654,
        maxOutputTokens: 1234,
        reasoning: true,
        reasoningOptions: [{ type: "effort", values: ["low", "high"] }],
      },
    });
    const claude = f.providers.saveBinding({ name: "C", harnessId: "claude-code", modelId: m.id });
    const c = await instanceEnv("claude-code", configurationFor(f, claude), dir);
    assert.notEqual(c.ANTHROPIC_API_KEY, process.env.ANTHROPIC_API_KEY);
    assert.equal(c.ANTHROPIC_BASE_URL, "http://localhost:1");
    const opencode = f.providers.saveBinding({ name: "O", harnessId: "opencode", modelId: m.id });
    const profile = configurationFor(f, opencode);
    const o = await instanceEnv("opencode", profile, dir, "SYNTHETIC_RUNTIME_KEY");
    const config = JSON.parse(o.OPENCODE_CONFIG_CONTENT!);
    assert.equal(config.provider[profile.provider].options.baseURL, "http://localhost:1/v1");
    assert.equal(config.provider[profile.provider].models.unlisted.limit.context, 987654);
    assert.deepEqual(config.provider[profile.provider].models.unlisted.variants.high, {
      effort: "high",
    });
    assert.equal(o.OPENCODE_DISABLE_PROJECT_CONFIG, "true");
    assert.ok(!o.OPENCODE_CONFIG_CONTENT!.includes("SYNTHETIC_RUNTIME_KEY"));
  } finally {
    if (old === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = old;
    await f.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("model discovery uses protocol authentication and never sends a credential to a different origin", async () => {
  const observed: { url: string; headers: Record<string, string> }[] = [];
  const f = fixture(async (url, init) => {
    if (String(url).includes("models.dev")) return response(payload());
    observed.push({ url: String(url), headers: init!.headers as Record<string, string> });
    return response({
      models: [{ name: "models/example", inputTokenLimit: 4567, outputTokenLimit: 789 }],
    });
  });
  try {
    for (const protocol of [
      "openai-completions",
      "openai-responses",
      "anthropic-messages",
      "google-generative-ai",
    ]) {
      const p = await f.providers.saveProvider({
        name: protocol,
        endpoints: [
          { name: "List", protocol, baseUrl: "http://localhost:1", apiKey: "SYNTHETIC_KEY" },
        ],
      });
      const found = await f.providers.discover(p.id, p.endpoints[0]!.id);
      const r = observed.at(-1)!;
      assert.equal(
        r.url,
        protocol === "anthropic-messages"
          ? "http://localhost:1/v1/models"
          : "http://localhost:1/models",
      );
      assert.equal(
        r.headers[
          protocol === "anthropic-messages"
            ? "x-api-key"
            : protocol === "google-generative-ai"
              ? "x-goog-api-key"
              : "Authorization"
        ],
        protocol.startsWith("openai") ? "Bearer SYNTHETIC_KEY" : "SYNTHETIC_KEY",
      );
      assert.equal(
        found[0]!.model,
        protocol === "google-generative-ai" ? "example" : "models/example",
      );
      assert.equal(found[0]!.effective.maxInputTokens, 4567);
      assert.equal(found[0]!.effective.maxOutputTokens, 789);
      assert.equal(found[0]!.effective.contextWindow, undefined);
    }
    const p = await f.providers.saveProvider({
      name: "Invalid cross-origin",
      endpoints: [
        {
          name: "List",
          protocol: "openai-responses",
          baseUrl: "http://localhost:1",
          modelsUrl: "http://localhost:2/models",
          apiKey: "SYNTHETIC_KEY",
        },
      ],
    });
    await assert.rejects(f.providers.discover(p.id, p.endpoints[0]!.id), /同源/);
    assert.equal(observed.length, 4);
  } finally {
    await f.close();
  }
});

test("refreshing a model list drops models the endpoint no longer lists, keeping manual and edited ones", async () => {
  let listing = ["example", "old-a", "old-b"];
  const f = fixture(async (url) => {
    if (String(url).includes("models.dev")) return response(payload());
    return response({ data: listing.map((id) => ({ id })) });
  });
  try {
    const { p } = await setup(f);
    const endpoint = p.endpoints[0]!.id;
    await f.providers.discover(p.id, endpoint);
    const names = () =>
      f.store
        .records<{ model: string; endpointId: string }>("provider-model")
        .filter((m) => m.endpointId === endpoint)
        .map((m) => m.model)
        .sort();
    assert.deepEqual(names(), ["example", "old-a", "old-b"]);
    // A user edit to old-b keeps it even when the endpoint stops listing it.
    const oldB = f.store
      .records<{ id: string; revision: number; model: string }>("provider-model")
      .find((m) => m.model === "old-b")!;
    await f.providers.saveModel({
      id: oldB.id,
      expectedRevision: oldB.revision,
      providerId: p.id,
      endpointId: endpoint,
      model: "old-b",
      overrides: { contextWindow: 1000 },
    });
    // A new key returns a different list.
    listing = ["example", "fresh"];
    await f.providers.discover(p.id, endpoint);
    assert.deepEqual(names(), ["example", "fresh", "old-b"]);
  } finally {
    await f.close();
  }
});

test("native modality resolution uses models.dev for omitted input and exact route manual overrides take precedence", async () => {
  const f = fixture(async () =>
    response({
      models: {},
      providers: {
        vendor: { models: { "vision-example": { modalities: { input: ["text", "image"] } } } },
      },
    }),
  );
  try {
    await f.providers.refreshCatalog();
    const p = await f.providers.saveProvider({
      name: "Modality fixture",
      endpoints: [
        { name: "Responses", protocol: "openai-responses", baseUrl: "https://example.invalid/v1" },
      ],
    });
    const m = await f.providers.saveModel({
      providerId: p.id,
      endpointId: p.endpoints[0]!.id,
      model: "vision-example",
    });
    assert.deepEqual(m.effective.input, ["text", "image"]);
    const route = {
      provider: "native-vendor",
      id: m.model,
      baseUrl: "https://example.invalid/v1/",
      api: "openai-responses",
    };
    assert.deepEqual(f.providers.nativeModelInput(route), ["text", "image"]);
    assert.deepEqual(f.providers.nativeModelInput({ ...route, declaredInput: ["text"] }), ["text"]);
    const edited = await f.providers.saveModel({ ...identity(m), overrides: { input: ["text"] } });
    assert.deepEqual(f.providers.nativeModelInput({ ...route, declaredInput: ["text", "image"] }), [
      "text",
    ]);
    await f.providers.saveModel({ ...identity(edited), overrides: {} });
    assert.deepEqual(f.providers.nativeModelInput(route), ["text", "image"]);
    assert.equal(f.providers.nativeModelInput({ ...route, id: "unlisted-model" }), undefined);
  } finally {
    await f.close();
  }
});
