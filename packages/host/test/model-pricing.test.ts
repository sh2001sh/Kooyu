import assert from "node:assert/strict";
import { test } from "node:test";
import { modelPricingSchema, type ModelPricing } from "@kodo/protocol";
import { parameters, parsePublicCatalog, pricing } from "../src/providers/catalog.js";
import { ProviderService } from "../src/providers/service.js";
import { SessionService } from "../src/session-service.js";
import { Store } from "../src/storage/store.js";

test("pricing validates zero, cache rates, request charges and ascending input tiers", () => {
  const value = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    perRequest: 0,
    billingMode: "hybrid",
    tiers: [
      { upToInputTokens: 100, input: 0 },
      { input: 2, output: 4, perRequest: 0 },
    ],
  };
  assert.deepEqual(modelPricingSchema.parse(value), value);
  for (const invalid of [
    { input: -1 },
    { output: Infinity },
    { cacheRead: NaN },
    { perRequest: -0.01 },
    { tiers: [{ upToInputTokens: 0 }] },
    { tiers: [{ upToInputTokens: 100 }, { upToInputTokens: 50 }] },
    { tiers: [{ upToInputTokens: 100 }, { upToInputTokens: 100 }] },
    { tiers: [{}, { upToInputTokens: 100 }] },
    { tiers: [{ input: -1 }] },
  ])
    assert.equal(modelPricingSchema.safeParse(invalid).success, false, JSON.stringify(invalid));
});

test("metadata import keeps cache-only and per-request prices and tier details", () => {
  assert.deepEqual(pricing({ cache_read: 0, cache_write: 0.5 }), { cacheRead: 0, cacheWrite: 0.5 });
  assert.deepEqual(pricing({ per_request: 0, billing_mode: "request" }), {
    perRequest: 0,
    billingMode: "request",
  });
  const value = {
    input: 1,
    output: 2,
    tiers: [
      { upToInputTokens: 100, cacheRead: 0 },
      { input: 2, output: 4 },
    ],
  };
  assert.deepEqual(parameters({ pricing: value }).pricing, value);
  const catalog = parsePublicCatalog({
    models: {},
    providers: { synthetic: { models: { example: { pricing: value } } } },
  });
  assert.deepEqual(catalog[0]!.pricing, value);
  assert.equal(pricing({ tiers: [{ upToInputTokens: 100 }, { upToInputTokens: 50 }] }), undefined);
  for (const invalid of [
    { input: -1 },
    { input: "0" },
    { input: NaN },
    { input: 1, tiers: [null] },
    { input: 1, tiers: [{ input: -1 }] },
    { input: 1, tiers: [{ pricing: { cache_read: -1 } }] },
    { input: 1, tiers: [{ tiers: [{}] }] },
    { input: 1, tiers: [{ tier: { type: "unknown", size: 100 }, input: 3 }] },
    { input: 1, context_over_200k: { input: -1 } },
  ])
    assert.equal(pricing(invalid), undefined, JSON.stringify(invalid));
  assert.deepEqual(
    pricing({
      input: 1,
      output: 2,
      tiers: [
        { input: 3, output: 4, cache_read: 0, tier: { type: "context", size: 100 } },
        { input: 5, output: 6, tier: { type: "context", size: 200 } },
      ],
    }),
    {
      input: 1,
      output: 2,
      tiers: [
        { upToInputTokens: 100 },
        { upToInputTokens: 200, input: 3, output: 4, cacheRead: 0 },
        { input: 5, output: 6 },
      ],
    },
  );
  assert.deepEqual(pricing({ input: 1, context_over_200k: { input: 2 } }), {
    input: 1,
    tiers: [{ upToInputTokens: 200000 }, { input: 2 }],
  });
});

test("request and context-tier estimates honor explicit zero and unknown prices", async () => {
  const store = new Store(":memory:"),
    service = new ProviderService(store, { autoDiscover: false });
  const usage = { input: 80, output: 10, cacheRead: 10, cacheWrite: 10, requests: 1 };
  const estimate = (p: ModelPricing, u = usage) => service.estimateCost("codex", "synthetic", u, p);
  try {
    assert.equal(estimate({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }), 0);
    assert.equal(estimate({ input: 2, output: 4, cacheRead: 0, cacheWrite: 1 }), 0.00021);
    assert.equal(estimate({ perRequest: 0 }), 0);
    assert.equal(
      estimate({ billingMode: "request", input: 999, output: 999, perRequest: 0.25 }),
      0.25,
    );
    assert.equal(
      service.estimateCost(
        "codex",
        "synthetic",
        { ...usage, requests: 3 },
        { billingMode: "request", perRequest: 0.25 },
      ),
      0.75,
    );
    assert.equal(
      service.estimateCost(
        "codex",
        "synthetic",
        { input: 80, output: 10, cacheRead: 0, cacheWrite: 0 },
        { perRequest: 0.25 },
      ),
      null,
    );
    assert.equal(estimate({ billingMode: "request" }), null);
    assert.equal(estimate({ input: 1 }), null);
    assert.equal(estimate({ input: 1, output: 2, reasoning: 3 }), null);
    const p: ModelPricing = {
      input: 1,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
      tiers: [
        { upToInputTokens: 100, input: 0, output: 0 },
        { input: 3, output: 4, cacheRead: 1, cacheWrite: 2 },
      ],
    };
    assert.equal(estimate(p), 0);
    assert.equal(estimate(p, { ...usage, input: 81 }), 0.000313);
    assert.equal(estimate({ ...p, tiers: [p.tiers![0]!] }, { ...usage, input: 81 }), null);
    assert.equal(estimate({ ...p, tiers: [] }), 0.0001);
    assert.equal(estimate({ input: 0, output: 0, billingMode: "hybrid", perRequest: 0.01 }), 0.01);
  } finally {
    await service.close();
    store.close();
  }
});

test("usage ingestion estimates request charges only with an explicit request count", async () => {
  const store = new Store(":memory:");
  const service = new SessionService(store, { adapters: [] });
  store.put("model-catalog", "current", {
    entries: [
      {
        key: "synthetic/synthetic-request",
        provider: "synthetic",
        model: "synthetic-request",
        parameters: {},
        pricing: { billingMode: "request", perRequest: 0.25 },
      },
      {
        key: "synthetic/synthetic-free",
        provider: "synthetic",
        model: "synthetic-free",
        parameters: {},
        pricing: { billingMode: "request", perRequest: 0 },
      },
    ],
    kind: "remote-catalog",
    revision: "synthetic",
    source: "synthetic",
  });
  try {
    for (const [model, requests, expected] of [
      ["synthetic-request", 2, 0.5],
      ["synthetic-request", undefined, null],
      ["synthetic-request", 0.5, null],
      ["synthetic-request", 0, 0],
      ["synthetic-free", undefined, 0],
    ] as const) {
      const session = service.createDraft({
        title: "Synthetic pricing usage",
        kind: "direct",
        harnessId: "codex",
        model,
      });
      service.ingest(session.id, "usage", { requests });
      const usage = store
        .records<{ sessionId: string; costUsd: number | null; costKind: string }>("usage")
        .find((item) => item.sessionId === session.id)!;
      assert.equal(usage.costUsd, expected);
      assert.equal(usage.costKind, expected === null ? "unknown" : "estimate");
    }
  } finally {
    await service.dispose();
    store.close();
  }
});

test("saved model prices retain tier overrides, zeroes and automatic fields across refresh", async () => {
  const store = new Store(":memory:");
  const service = new ProviderService(store, {
    autoDiscover: false,
    fetcher: async () =>
      Response.json({
        models: {},
        providers: {
          synthetic: {
            models: {
              example: {
                limit: { context: 100000, output: 1000 },
                reasoning: false,
                modalities: { input: ["text"] },
                pricing: {
                  input: 1,
                  output: 2,
                  cacheRead: 0.1,
                  cacheWrite: 0.5,
                  tiers: [{ input: 3 }],
                },
              },
            },
          },
        },
      }),
  });
  try {
    await service.refreshCatalog();
    const provider = await service.saveProvider({
      name: "Synthetic pricing",
      catalogProvider: "synthetic",
      endpoints: [
        { name: "Local", protocol: "openai-responses", baseUrl: "http://127.0.0.1:1/v1" },
      ],
    });
    const overrides = {
      pricing: {
        input: 0,
        cacheRead: 0,
        perRequest: 0,
        billingMode: "hybrid",
        tiers: [{ upToInputTokens: 100, input: 0 }, { input: 5 }],
      },
    };
    const model = await service.saveModel({
      providerId: provider.id,
      endpointId: provider.endpoints[0]!.id,
      model: "example",
      overrides,
    });
    assert.deepEqual(model.overrides, overrides);
    assert.equal(model.effective.pricing!.output, 2);
    assert.equal(model.effective.pricing!.cacheWrite, 0.5);
    await service.refreshCatalog();
    const saved = (await service.configuration()).models.find((m) => m.id === model.id)!;
    assert.deepEqual(saved.overrides, overrides);
    const identity = {
      id: saved.id,
      expectedRevision: saved.revision,
      providerId: saved.providerId,
      endpointId: saved.endpointId,
      model: saved.model,
    };
    const flat = await service.saveModel({ ...identity, overrides: { pricing: { tiers: [] } } });
    assert.deepEqual(flat.effective.pricing!.tiers, []);
    const restored = await service.saveModel({
      ...identity,
      expectedRevision: flat.revision,
      overrides: {},
    });
    assert.deepEqual(restored.effective.pricing!.tiers, [{ input: 3 }]);
  } finally {
    await service.close();
    store.close();
  }
});
