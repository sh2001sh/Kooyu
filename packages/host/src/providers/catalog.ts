import { createHash } from "node:crypto";
import { ModelRuntime, VERSION } from "@earendil-works/pi-coding-agent";
import {
  modelParametersSchema,
  modelPricingSchema,
  reasoningOptionSchema,
  type ModelParameters,
  type ModelPricing,
} from "@kodo/protocol";
import type { Wire } from "../harnesses/adapter.js";

export interface PublicModel {
  key: string;
  provider: string;
  model: string;
  name: string;
  canonicalKey?: string;
  parameters: ModelParameters;
  /** Token rates are USD / 1M tokens; request rates are USD / request. */
  pricing?: ModelPricing;
}
export interface PublicCatalog {
  revision: string;
  etag?: string;
  fetchedAt: string;
  checkedAt: string;
  source: string;
  kind: "remote-catalog" | "bundled-catalog";
  /** Set once catalog prices are parsed; older stored catalogs are refetched without ETag. */
  pricingParsed?: boolean;
  pricingVersion?: number;
  entries: PublicModel[];
}
export const CATALOG_URL = "https://models.dev/catalog.json";
export const CATALOG_TTL = 24 * 3600000;
export const PRICING_VERSION = 2;

export function parameters(data: Wire): ModelParameters {
  const p: Wire = {};
  const limit = data.limit ?? {};
  for (const [key, value] of Object.entries({
    contextWindow: data.contextWindow ?? limit.context ?? data.context_length,
    maxInputTokens:
      data.maxInputTokens ?? limit.input ?? data.inputTokenLimit ?? data.max_input_tokens,
    maxOutputTokens:
      data.maxOutputTokens ??
      limit.output ??
      data.outputTokenLimit ??
      data.max_tokens ??
      data.top_provider?.max_completion_tokens,
  }))
    if (Number.isSafeInteger(value) && value > 0) p[key] = value;
  if (typeof data.reasoning === "boolean") p.reasoning = data.reasoning;
  const options = data.reasoningOptions ?? data.reasoning_options;
  if (Array.isArray(options))
    p.reasoningOptions = options.flatMap((o: unknown) => {
      const r = reasoningOptionSchema.safeParse(o);
      return r.success ? [r.data] : [];
    });
  if (data.reasoning?.supported_efforts?.length) {
    p.reasoning = true;
    p.reasoningOptions = [{ type: "effort", values: data.reasoning.supported_efforts }];
  }
  const effort = data.capabilities?.effort;
  if (effort?.supported === true) {
    const values = Object.keys(effort).filter(
      (k) => k !== "supported" && effort[k]?.supported === true,
    );
    if (values.length) {
      p.reasoning = true;
      p.reasoningOptions = [{ type: "effort", values }];
    }
  }
  const input = data.input ?? data.modalities?.input;
  if (Array.isArray(input)) {
    const valid = [...new Set(input.filter((v) => v === "text" || v === "image"))];
    if (valid.length) p.input = valid;
  }
  if (data.thinkingLevelMap) p.thinkingLevelMap = data.thinkingLevelMap;
  const price = pricing(data.pricing ?? data.cost);
  if (price) p.pricing = price;
  const parsed = modelParametersSchema.safeParse(p);
  if (!parsed.success) throw new Error("模型元数据格式不合法，保留原目录。");
  return parsed.data;
}

/** Normalize explicit prices without treating missing or invalid prices as free. */
export function pricing(cost: Wire | undefined): ModelPricing | undefined {
  if (!cost || typeof cost !== "object" || Array.isArray(cost)) return undefined;
  const result: ModelPricing = {};
  for (const [field, keys] of [
    ["input", ["input"]],
    ["output", ["output"]],
    ["cacheRead", ["cache_read", "cacheRead"]],
    ["cacheWrite", ["cache_write", "cacheWrite"]],
    ["reasoning", ["reasoning"]],
    ["perRequest", ["perRequest", "per_request"]],
  ] as const) {
    const values = keys.map((k) => cost[k]).filter((v) => v !== undefined);
    if (values.some((v) => typeof v !== "number" || !Number.isFinite(v) || v < 0)) return undefined;
    if (values.length) result[field] = values[0];
  }
  const mode = cost.billingMode ?? cost.billing_mode;
  if (mode !== undefined) result.billingMode = mode;
  if (cost.tiers !== undefined) {
    if (!Array.isArray(cost.tiers) || cost.tiers.length > 32) return undefined;
    for (const tier of cost.tiers) {
      if (!tier || typeof tier !== "object" || Array.isArray(tier)) return undefined;
      const source = tier.pricing ?? tier;
      if (
        typeof source !== "object" ||
        Array.isArray(source) ||
        source.tiers !== undefined ||
        source.context_over_200k !== undefined
      )
        return undefined;
      const rates = pricing(source);
      // Empty brackets may inherit base prices; malformed explicit prices must not.
      if (
        !rates &&
        Object.keys(source).some((key) =>
          [
            "input",
            "output",
            "cache_read",
            "cacheRead",
            "cache_write",
            "cacheWrite",
            "reasoning",
            "perRequest",
            "per_request",
            "billingMode",
            "billing_mode",
          ].includes(key),
        )
      )
        return undefined;
    }
    if (cost.tiers.some((tier: Wire) => tier?.tier !== undefined)) {
      // models.dev context tiers specify the lower boundary for higher rates.
      // Convert to our inclusive upper-bound brackets, retaining the base bracket.
      if (
        !cost.tiers.every(
          (tier: Wire) =>
            tier?.tier?.type === "context" &&
            Number.isSafeInteger(tier.tier.size) &&
            tier.tier.size > 0,
        )
      )
        return undefined;
      const ordered = [...cost.tiers].sort((a: Wire, b: Wire) => a.tier.size - b.tier.size);
      result.tiers = [
        { upToInputTokens: ordered[0].tier.size },
        ...ordered.map((tier: Wire, index: number) => ({
          ...pricing(tier.pricing ?? tier),
          ...(index + 1 < ordered.length ? { upToInputTokens: ordered[index + 1].tier.size } : {}),
        })),
      ];
    } else {
      result.tiers = cost.tiers.map((tier: Wire) => ({
        ...pricing(tier.pricing ?? tier),
        ...((tier.upToInputTokens ?? tier.up_to_input_tokens) !== undefined
          ? { upToInputTokens: tier.upToInputTokens ?? tier.up_to_input_tokens }
          : {}),
      }));
    }
  } else if (cost.context_over_200k !== undefined) {
    if (
      !cost.context_over_200k ||
      cost.context_over_200k.tiers !== undefined ||
      cost.context_over_200k.context_over_200k !== undefined
    )
      return undefined;
    const higher = pricing(cost.context_over_200k);
    if (!higher) return undefined;
    result.tiers = [{ upToInputTokens: 200000 }, higher];
  }
  const parsed = modelPricingSchema.safeParse(result);
  return parsed.success && Object.keys(parsed.data).length ? parsed.data : undefined;
}

export function parsePublicCatalog(data: Wire): PublicModel[] {
  if (
    !data ||
    !data.providers ||
    !data.models ||
    typeof data.providers !== "object" ||
    Array.isArray(data.providers)
  )
    throw new Error("在线目录缺少 providers/models，保留原目录。");
  const entries: PublicModel[] = [];
  for (const [provider, value] of Object.entries(data.providers)) {
    const p = value as Wire;
    if (!p || typeof p.models !== "object" || Array.isArray(p.models))
      throw new Error("Provider 目录格式变化，保留原目录。");
    for (const [model, raw] of Object.entries(p.models)) {
      if (!model || model.length > 200) continue;
      const m = raw as Wire;
      if (!m || typeof m !== "object") throw new Error("模型条目格式变化，保留原目录。");
      const canonical =
        typeof m.canonical_model_id === "string" ? data.models[m.canonical_model_id] : undefined;
      entries.push({
        key: `${provider}/${model}`,
        provider,
        model,
        name: typeof m.name === "string" ? m.name : model,
        canonicalKey: typeof m.canonical_model_id === "string" ? m.canonical_model_id : undefined,
        parameters: { ...(canonical ? parameters(canonical) : {}), ...parameters(m) },
        ...((pricing(m.pricing ?? m.cost) ?? pricing(canonical?.pricing ?? canonical?.cost))
          ? {
              pricing:
                pricing(m.pricing ?? m.cost) ?? pricing(canonical?.pricing ?? canonical?.cost),
            }
          : {}),
      });
    }
  }
  if (!entries.length || entries.length > 100000) throw new Error("在线目录规模异常，保留原目录。");
  return entries;
}

export async function bundledCatalog(): Promise<PublicCatalog> {
  const runtime = await ModelRuntime.create({ modelsPath: null });
  const now = new Date().toISOString();
  return {
    revision: `pi-${VERSION}`,
    source: `https://www.npmjs.com/package/@earendil-works/pi-coding-agent/v/${VERSION}`,
    kind: "bundled-catalog",
    fetchedAt: now,
    checkedAt: now,
    entries: runtime
      .getAllModels()
      .filter((m) => "maxTokens" in m && "reasoning" in m)
      .map((m) => {
        const model = m as Wire;
        const efforts = model.thinkingLevelMap
          ? Object.entries(model.thinkingLevelMap)
              .filter(([, v]) => v !== null)
              .map(([k]) => k)
          : [];
        return {
          key: `${m.provider}/${m.id}`,
          provider: m.provider,
          model: m.id,
          name: m.name,
          ...(pricing(model.cost) ? { pricing: pricing(model.cost) } : {}),
          parameters: parameters({
            ...model,
            maxOutputTokens: model.maxTokens,
            ...(efforts.length
              ? {
                  reasoningOptions: [
                    {
                      type: "effort",
                      values: efforts,
                    },
                  ],
                }
              : {}),
          }),
        };
      }),
  };
}

export async function readJSON(response: Response, maxBytes = 16 * 1024 * 1024): Promise<Wire> {
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`模型接口返回 HTTP ${response.status}`);
  }
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    throw new Error("模型目录过大。");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("模型接口未返回内容。");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) throw new Error("模型目录过大。");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export function contentRevision(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function effortValues(p: ModelParameters): string[] | undefined {
  if (p.reasoning === false) return [];
  const options = p.reasoningOptions?.filter((o) => o.type === "effort");
  return options?.length ? [...new Set(options.flatMap((o) => o.values))] : undefined;
}
