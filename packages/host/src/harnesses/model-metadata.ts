import { VERSION } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels, type Api, type Model } from "@earendil-works/pi-ai";
import type { HarnessModelOption, ModelParameterSource } from "@kodo/protocol";

/** Only explicit positive integral token counts are model limits. */
export function tokenLimit(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

export function nativeParameters(
  values: {
    contextWindow?: unknown;
    maxInputTokens?: unknown;
    maxOutputTokens?: unknown;
    reasoning?: unknown;
  },
  source: ModelParameterSource,
): Pick<
  HarnessModelOption,
  "contextWindow" | "maxInputTokens" | "maxOutputTokens" | "reasoning" | "parameterSources"
> {
  const result: ReturnType<typeof nativeParameters> = {};
  for (const field of ["contextWindow", "maxInputTokens", "maxOutputTokens"] as const) {
    const value = tokenLimit(values[field]);
    if (value !== undefined) {
      result[field] = value;
      (result.parameterSources ??= {})[field] = source;
    }
  }
  if (
    Array.isArray(values.reasoning) &&
    values.reasoning.every((v) => typeof v === "string" && v.length > 0)
  ) {
    result.reasoning = [...new Set(values.reasoning as string[])];
    (result.parameterSources ??= {}).reasoning = source;
  }
  return result;
}

export const kodoCatalogSource: ModelParameterSource = {
  kind: "native-catalog",
  label: "Kooyu 内核内置模型目录",
  version: VERSION,
  reference: `https://www.npmjs.com/package/@earendil-works/pi-coding-agent/v/${VERSION}`,
};

export function kodoModelOption(model: Model<Api>): HarnessModelOption {
  return {
    id: model.id,
    name: model.name,
    provider: model.provider,
    input: model.input,
    source: "native-catalog",
    ...nativeParameters(
      {
        contextWindow: model.contextWindow,
        maxOutputTokens: model.maxTokens,
        reasoning: getSupportedThinkingLevels(model),
      },
      kodoCatalogSource,
    ),
  };
}
