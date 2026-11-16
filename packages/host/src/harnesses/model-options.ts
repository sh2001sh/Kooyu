import { KodoError, type HarnessModelOption } from "@kodo/protocol";
import type { Wire } from "./adapter.js";
import { nativeParameters } from "./model-metadata.js";
import { declaredInput, type ModelInput } from "./input-modalities.js";

export function providerModel(value: string): { provider: string; model: string } {
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1)
    throw new KodoError("INVALID_INPUT", "此 harness 需要 provider/model 格式的模型名。");
  return { provider: value.slice(0, slash), model: value.slice(slash + 1) };
}

export function selectOptions(option?: Wire): Wire[] {
  if (!option || option.type !== "select" || !Array.isArray(option.options)) return [];
  return option.options.flatMap((item: Wire) =>
    Array.isArray(item.options) ? item.options : [item],
  );
}

export function acpModelOptions(config: Wire[], legacy?: Wire): HarnessModelOption[] {
  const model = config.find((o) => o.category === "model");
  const thought = config.find((o) => o.category === "thought_level" && o.type === "select");
  const reasoning = thought ? selectOptions(thought).map((o) => String(o.value)) : undefined;
  const parameters = nativeParameters(
    { reasoning },
    {
      kind: "native-runtime",
      label: "ACP 当前模型协商",
      reference: "https://agentclientprotocol.com/protocol/session-config-options",
    },
  );
  const current = model?.currentValue ?? legacy?.currentModelId;
  const choices = selectOptions(model).map((o): HarnessModelOption => ({
    id: String(o.value),
    name: o.name,
    source: "discovered",
    ...(o.value === current ? parameters : {}),
  }));
  return choices.length
    ? choices
    : (legacy?.availableModels ?? []).map((m: Wire) => ({
        id: String(m.modelId),
        name: m.name,
        source: "discovered",
        ...(m.modelId === current ? parameters : {}),
      }));
}

export function codexModelOptions(data: Wire[]): HarnessModelOption[] {
  return data
    .filter((m) => typeof m.model === "string")
    .map((m) => ({
      id: m.model,
      name: m.displayName,
      source: "discovered",
      input: declaredInput(m.inputModalities),
      ...(m.isDefault === true ? { isDefault: true } : {}),
      ...nativeParameters(
        {
          contextWindow: m.contextWindow,
          maxInputTokens: m.maxInputTokens,
          maxOutputTokens: m.maxOutputTokens,
          reasoning: Array.isArray(m.supportedReasoningEfforts)
            ? m.supportedReasoningEfforts.map((e: Wire) => e.reasoningEffort)
            : undefined,
        },
        {
          kind: "native-runtime",
          label: "Codex model/list",
          reference: "https://developers.openai.com/codex/app-server/",
        },
      ),
    }));
}

export function claudeModelOptions(data: Wire[]): HarnessModelOption[] {
  return data.map((m) => ({
    id: m.value,
    name: m.displayName,
    ...(typeof m.resolvedModel === "string" ? { resolvedModel: m.resolvedModel } : {}),
    ...(m.value === "default" ? { isDefault: true } : {}),
    source: "discovered",
    ...nativeParameters(
      { reasoning: m.supportsEffort === false ? [] : m.supportedEffortLevels },
      {
        kind: "native-runtime",
        label: "Claude SDK supportedModels",
        reference: "https://platform.claude.com/docs/en/agent-sdk/typescript",
      },
    ),
  }));
}

export function openCodeModelOptions(catalog: Wire): HarnessModelOption[] {
  const connected = new Set(catalog.connected ?? (catalog.all ?? []).map((p: Wire) => p.id));
  return (catalog.all ?? [])
    .filter((p: Wire) => connected.has(p.id))
    .flatMap((p: Wire) =>
      Object.entries(p.models ?? {}).map(([id, value]) => {
        const m = value as Wire;
        return {
          id: `${p.id}/${id}`,
          name: m.name,
          source: "discovered" as const,
          input: openCodeDeclaredInput(m),
          ...nativeParameters(
            {
              contextWindow: m.limit?.context,
              maxInputTokens: m.limit?.input,
              maxOutputTokens: m.limit?.output,
              reasoning:
                m.variants && typeof m.variants === "object" ? Object.keys(m.variants) : undefined,
            },
            {
              kind: "native-runtime",
              label: "OpenCode /provider 有效配置",
              reference: "https://opencode.ai/docs/models/",
            },
          ),
        };
      }),
    );
}

/**
 * Whether OpenCode's effective /provider entry for this model declares image input.
 * Newer servers report capabilities.input.image; older ones modalities.input.
 * Anything else, including an unconnected provider, counts as no.
 */
export function openCodeModelAcceptsImages(
  catalog: Wire,
  target: { provider: string; model: string },
): boolean {
  const connected = new Set(catalog.connected ?? (catalog.all ?? []).map((p: Wire) => p.id));
  if (!connected.has(target.provider)) return false;
  const provider = (catalog.all ?? []).find((p: Wire) => p.id === target.provider);
  const model = provider?.models?.[target.model] as Wire | undefined;
  return openCodeDeclaredInput(model)?.includes("image") ?? false;
}

export function openCodeDeclaredInput(model?: Wire): ModelInput | undefined {
  const image = model?.capabilities?.input?.image;
  if (typeof image === "boolean") return image ? ["text", "image"] : ["text"];
  return declaredInput(model?.modalities?.input);
}

function zcodeBuiltinParameters(builtin: Wire | undefined, modelId: string, user?: Wire) {
  const rules = builtin?.config?.modelConfigRules?.modelRules;
  const values: { contextWindow?: unknown; maxOutputTokens?: unknown; reasoning?: unknown } = {};
  let input: ModelInput | undefined;
  if (Array.isArray(rules))
    for (const rule of rules) {
      if (typeof rule?.modelMatch !== "string") continue;
      try {
        if (!new RegExp(rule.modelMatch, "i").test(modelId)) continue;
        if (typeof rule.config?.properties?.inputFormat?.supportsImage === "boolean")
          input = rule.config.properties.inputFormat.supportsImage ? ["text", "image"] : ["text"];
        if (rule.config?.properties?.contextWindow !== undefined)
          values.contextWindow = rule.config.properties.contextWindow;
        if (rule.config?.optionSpecs?.maxOutputTokens?.max !== undefined)
          values.maxOutputTokens = rule.config.optionSpecs.maxOutputTokens.max;
        if (Array.isArray(rule.config?.optionSpecs?.reasoningLevel?.values))
          values.reasoning = rule.config.optionSpecs.reasoningLevel.values;
      } catch {
        continue;
      }
    }
  // Personal per-model rules (Settings → model) override the bundled defaults.
  if (user?.config?.properties?.contextWindow !== undefined)
    values.contextWindow = user.config.properties.contextWindow;
  if (user?.config?.optionSpecs?.maxOutputTokens?.max !== undefined)
    values.maxOutputTokens = user.config.optionSpecs.maxOutputTokens.max;
  if (Array.isArray(user?.config?.optionSpecs?.reasoningLevel?.values))
    values.reasoning = user.config.optionSpecs.reasoningLevel.values;
  if (typeof user?.config?.properties?.inputFormat?.supportsImage === "boolean")
    input = user.config.properties.inputFormat.supportsImage ? ["text", "image"] : ["text"];
  return {
    input,
    ...nativeParameters(values, {
      kind: "native-catalog",
      label: user ? "ZCode 个人模型配置" : "ZCode 内置规则（可被个人配置覆盖）",
    }),
  };
}

export function zcodeModelOptions(config?: Wire, builtin?: Wire): HarnessModelOption[] {
  return config?.provider && config?.model
    ? (() => {
        const reference = zcodeBuiltinParameters(builtin, config.model);
        const native = nativeParameters(
          { reasoning: config.thoughtLevels },
          {
            kind: "native-runtime",
            label: "ZCode 当前模型原生快照",
          },
        );
        return [
          {
            id: `${config.provider}/${config.model}`,
            source: "discovered",
            isCurrent: true,
            ...reference,
            ...native,
            parameterSources: { ...reference.parameterSources, ...native.parameterSources },
          },
        ];
      })()
    : [];
}

/**
 * Providers the user configured in ZCode (provider_config.json): template providers expose
 * the template's enabled models, custom providers expose their personal model list.
 */
export function zcodeUserModelOptions(user?: Wire, builtin?: Wire): HarnessModelOption[] {
  const providers = user?.config?.providerConfigRules?.providerRules;
  if (!Array.isArray(providers)) return [];
  const modelRules: Wire[] = user?.config?.modelConfigRules?.providerModelRules ?? [];
  const templates: Wire[] = builtin?.config?.modelConfigRules?.templateModelRules ?? [];
  const result: HarnessModelOption[] = [];
  for (const provider of providers) {
    if (typeof provider?.providerId !== "string" || provider.config?.enabled === false) continue;
    const ids: string[] = Array.isArray(provider.config?.personalModelIds)
      ? provider.config.personalModelIds
      : typeof provider.templateId === "string"
        ? templates
            .filter((t) => t?.templateId === provider.templateId && t.config?.enabled !== false)
            .map((t) => t.modelId)
        : [];
    for (const modelId of ids) {
      if (typeof modelId !== "string" || !modelId) continue;
      const rule = modelRules.find(
        (r) => r?.providerId === provider.providerId && r?.modelId === modelId,
      );
      if (rule?.config?.enabled === false) continue;
      result.push({
        id: `${provider.providerId}/${modelId}`,
        name: `${modelId}${provider.providerName ? ` · ${provider.providerName}` : ` · ${provider.providerId}`}`,
        source: "native-catalog",
        ...zcodeBuiltinParameters(builtin, modelId, rule),
      });
    }
  }
  return result;
}

/** Bundled candidates are useful before a session exists, but do not prove account access. */
export function zcodeBuiltinModelOptions(config?: Wire): HarnessModelOption[] {
  const rules = config?.config?.modelConfigRules?.builtinProviderModelRules;
  if (!Array.isArray(rules)) return [];
  return rules
    .filter(
      (rule: Wire) =>
        typeof rule?.providerId === "string" &&
        typeof rule?.modelId === "string" &&
        rule.config?.enabled !== false,
    )
    .map((rule: Wire): HarnessModelOption => ({
      id: `${rule.providerId}/${rule.modelId}`,
      source: "native-catalog",
      ...zcodeBuiltinParameters(config, rule.modelId),
    }));
}

export function validateReasoning(
  model: string | null,
  reasoning: string | null,
  options: HarnessModelOption[],
): void {
  if (!reasoning) return;
  const matches = options.filter(
    (o) => o.id === model || o.resolvedModel === model || `${o.provider}/${o.id}` === model,
  );
  const match = matches.find((o) => o.reasoning !== undefined) ?? matches[0];
  if (!match?.reasoning?.includes(reasoning))
    throw new KodoError("UNSUPPORTED", "所选模型尚未声明这个思考档位，请先读取原生选项。");
}
