import type { HarnessModelOption, BindingRuntime, HarnessBinding } from "@kodo/protocol";
import { bindingReasoningLevels } from "@kodo/protocol/client";

/** A session uses the frozen binding, never the newest remote catalog entry. */
export function boundModelOption(value: BindingRuntime | HarnessBinding): HarnessModelOption {
  const binding: HarnessBinding = "parameters" in value ? value : value.binding!;
  const p = binding.parameters;
  const reasoning = bindingReasoningLevels(p, binding.harnessId);
  const option: HarnessModelOption = {
    id: binding.model,
    name: binding.model,
    provider: `kodo-${binding.providerId}`,
    source: "discovered",
    reasoning,
    input: p.input,
    contextWindow: p.contextWindow,
    maxInputTokens: p.maxInputTokens,
    maxOutputTokens: p.maxOutputTokens,
    pricing: p.pricing,
    parameterSources: {},
  };
  for (const field of [
    "contextWindow",
    "maxInputTokens",
    "maxOutputTokens",
    "reasoning",
  ] as const) {
    const origin =
      binding.sources?.[field === "reasoning" ? "reasoningOptions" : field] ??
      binding.sources?.[field];
    if (origin)
      option.parameterSources![field] = {
        kind: origin.kind,
        label: origin.label,
        reference: origin.reference,
        version: origin.revision.slice(0, 16),
      };
  }
  return option;
}
