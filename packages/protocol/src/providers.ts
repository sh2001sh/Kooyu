import { z } from "zod";
import { HARNESS_IDS } from "./client.js";

export const endpointProtocolSchema = z.enum([
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
]);
export type EndpointProtocol = z.infer<typeof endpointProtocolSchema>;
const httpUrl = z
  .url()
  .refine(
    (v) => /^https?:\/\//.test(v) && !new URL(v).username && !new URL(v).password,
    "需要不含内嵌凭据的 HTTP(S) 地址",
  );
const tokenCount = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const priceFields = {
  input: z.number().nonnegative().finite().optional(),
  output: z.number().nonnegative().finite().optional(),
  cacheRead: z.number().nonnegative().finite().optional(),
  cacheWrite: z.number().nonnegative().finite().optional(),
  reasoning: z.number().nonnegative().finite().optional(),
  perRequest: z.number().nonnegative().finite().optional(),
};
export const modelPricingSchema = z
  .object({
    ...priceFields,
    /** Token rates are USD / 1M tokens; perRequest is USD / API request. */
    billingMode: z.enum(["tokens", "request", "hybrid"]).optional(),
    /** Each request uses the tier for its total input, including cached input. */
    tiers: z
      .array(z.object({ upToInputTokens: tokenCount.optional(), ...priceFields }).strict())
      .max(32)
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    let previous = 0;
    for (const [index, tier] of (value.tiers ?? []).entries()) {
      if (tier.upToInputTokens === undefined) {
        if (index !== value.tiers!.length - 1)
          ctx.addIssue({
            code: "custom",
            path: ["tiers", index, "upToInputTokens"],
            message: "只有最后一档可以不设上限。",
          });
      } else if (tier.upToInputTokens <= previous) {
        ctx.addIssue({
          code: "custom",
          path: ["tiers", index, "upToInputTokens"],
          message: "阶梯上限必须按从小到大排列。",
        });
      } else previous = tier.upToInputTokens;
    }
  });
export const reasoningOptionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("effort"),
      values: z.array(z.string().min(1).max(100)).min(1).max(32),
    })
    .strict(),
  z.object({ type: z.literal("toggle") }).strict(),
  z
    .object({
      type: z.literal("budget_tokens"),
      min: z.number().int().nonnegative(),
      max: tokenCount,
    })
    .strict()
    .refine((v) => v.min <= v.max),
]);
export const modelParametersSchema = z
  .object({
    contextWindow: tokenCount.optional(),
    pricing: modelPricingSchema.optional(),
    maxInputTokens: tokenCount.optional(),
    maxOutputTokens: tokenCount.optional(),
    reasoning: z.boolean().optional(),
    reasoningOptions: z.array(reasoningOptionSchema).max(8).optional(),
    thinkingLevelMap: z
      .partialRecord(
        z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]),
        z.string().max(100).nullable(),
      )
      .optional(),
    input: z
      .array(z.enum(["text", "image"]))
      .min(1)
      .max(2)
      .optional(),
  })
  .strict();
export type ModelParameters = z.infer<typeof modelParametersSchema>;
export interface ParameterOrigin {
  kind: "user" | "endpoint" | "remote-catalog" | "bundled-catalog";
  label: string;
  reference?: string;
  revision: string;
  fetchedAt: string;
}
export type ParameterOrigins = Partial<Record<keyof ModelParameters, ParameterOrigin>>;
export interface ProviderEndpoint {
  id: string;
  name: string;
  protocol: EndpointProtocol;
  baseUrl: string;
  modelsUrl?: string;
  credentialRef: string | null;
}
export interface Provider {
  id: string;
  revision: number;
  name: string;
  catalogProvider?: string;
  endpoints: ProviderEndpoint[];
  updatedAt: string;
  discovery?: {
    endpointId: string;
    status: "ready" | "error";
    count: number;
    message?: string;
    updatedAt: string;
  }[];
}
export const providerSchema = z
  .object({
    requestId: z.string().uuid().optional(),
    id: z.string().uuid().optional(),
    expectedRevision: z.number().int().nonnegative().optional(),
    name: z.string().trim().min(1).max(100),
    catalogProvider: z.string().trim().min(1).max(100).optional(),
    endpoints: z
      .array(
        z
          .object({
            id: z.string().uuid().optional(),
            name: z.string().trim().min(1).max(100),
            protocol: endpointProtocolSchema,
            baseUrl: httpUrl,
            modelsUrl: httpUrl.optional(),
            apiKey: z.string().min(1).max(8192).optional(),
            clearCredential: z.boolean().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict();
export interface CatalogModel {
  id: string;
  providerId: string;
  endpointId: string;
  providerRevision: number;
  model: string;
  name: string;
  revision: number;
  catalogKey?: string;
  automatic: ModelParameters;
  automaticSources: ParameterOrigins;
  overrides: ModelParameters;
  effective: ModelParameters;
  sources: ParameterOrigins;
  listedAt?: string;
  updatedAt: string;
}
export const catalogModelSchema = z
  .object({
    requestId: z.string().uuid().optional(),
    id: z.string().uuid().optional(),
    expectedRevision: z.number().int().nonnegative().optional(),
    providerId: z.string().uuid(),
    endpointId: z.string().uuid(),
    model: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(200).optional(),
    catalogKey: z.string().max(300).nullable().optional(),
    overrides: modelParametersSchema.optional(),
  })
  .strict();
export interface HarnessBinding {
  id: string;
  revision: number;
  name: string;
  harnessId: (typeof HARNESS_IDS)[number];
  providerId: string;
  providerRevision: number;
  endpointId: string;
  modelId: string;
  modelRevision: number;
  model: string;
  /** Absent on existing bindings, which keep their fixed-model behavior. */
  selectionMode?: "fixed" | "provider";
  /** Frozen model metadata for this provider revision. */
  availableModels?: CatalogModel[];
  reasoning: string | null;
  route: "direct" | "gateway";
  protocol: EndpointProtocol;
  parameters: ModelParameters;
  sources: ParameterOrigins;
  updatedAt: string;
}
export const bindingSchema = z
  .object({
    requestId: z.string().uuid().optional(),
    id: z.string().uuid().optional(),
    expectedRevision: z.number().int().nonnegative().optional(),
    name: z.string().trim().min(1).max(100),
    harnessId: z.enum(HARNESS_IDS),
    modelId: z.string().uuid(),
    selectionMode: z.enum(["fixed", "provider"]).optional(),
    reasoning: z.string().max(100).nullable().default(null),
    route: z.enum(["auto", "direct", "gateway"]).default("auto"),
    applyAsDefault: z.boolean().optional(),
    expectedDefaultsRevision: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine(
    (v) => !v.applyAsDefault || v.expectedDefaultsRevision !== undefined,
    "应用默认配置需要当前默认配置修订。",
  );
export interface CatalogState {
  revision: string | null;
  fetchedAt: string | null;
  checkedAt: string | null;
  source: string;
  modelCount: number;
  stale: boolean;
  error?: string;
}
export interface ProviderConfiguration {
  providers: Provider[];
  models: CatalogModel[];
  bindings: HarnessBinding[];
  catalog: CatalogState;
}
