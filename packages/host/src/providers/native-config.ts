import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  KodoError,
  type EndpointProtocol,
  type HarnessId,
  type BindingRuntime,
} from "@kodo/protocol";
import {
  bindingReasoningLevels,
  bindingThinkingLevelMap,
  HARNESS_PROVIDER_PROTOCOLS,
} from "@kodo/protocol/client";

export function bindingConfigIssues(
  harness: HarnessId,
  p: BindingRuntime["modelParameters"],
  reasoning: string | null,
): string[] {
  const issues: string[] = [];
  if (harness === "cursor")
    issues.push(
      "Cursor Agent 未提供已确认的自定义 Provider 配置接口；请使用原生登录与模型设置。Cursor Private Inference 是不同产品，不能替代此入口。",
    );
  if (["deepseek-harness", "kimi-code"].includes(harness) && !p?.contextWindow)
    issues.push("此 Harness 需要已确认的上下文窗口；请获取模型元数据、关联目录或手工覆盖。");
  if (
    harness === "deepseek-harness" &&
    (!p?.maxOutputTokens || !p.input || p.reasoning === undefined)
  )
    issues.push(
      "DeepSeek Harness 需要明确的输出上限、输入与思考能力，避免原生默认参数覆盖真实模型。",
    );
  if (
    harness === "gemini" &&
    reasoning &&
    !["minimal", "low", "medium", "high"].includes(reasoning)
  )
    issues.push(
      "Gemini thinkingLevel 只接受已声明的 minimal / low / medium / high；token budget 尚未映射为档位。",
    );
  return issues;
}

/** Names used by native catalogs can differ from the wire model ID. */
export function boundNativeModel(configuration: BindingRuntime): string {
  return ["zcode", "kimi-code"].includes(configuration.binding?.harnessId ?? "")
    ? `${configuration.provider}/${configuration.model}`
    : configuration.model;
}

function atomic(path: string, value: unknown, json = true) {
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, json ? `${JSON.stringify(value, null, 2)}\n` : String(value), {
    mode: 0o600,
  });
  renameSync(temp, path);
}
const q = JSON.stringify;

/** Native schemas from the pinned source review. Never writes upstream keys. */
export function configureNativeBinding(
  harness: HarnessId,
  configuration: BindingRuntime,
  dataDir: string,
  env: NodeJS.ProcessEnv,
  key: string | null,
): boolean {
  if (!["deepseek-harness", "zcode", "gemini", "kimi-code", "grok-build"].includes(harness))
    return false;
  if (!HARNESS_PROVIDER_PROTOCOLS[harness].includes(configuration.protocol as EndpointProtocol))
    throw new KodoError("UNSUPPORTED", "此原生 Harness 不支持绑定的接口格式。");
  const issues = bindingConfigIssues(
    harness,
    configuration.modelParameters,
    configuration.binding!.reasoning,
  );
  if (issues.length) throw new KodoError("UNSUPPORTED", issues.join(" "));
  const home = join(
    dataDir,
    "instances",
    harness,
    configuration.id,
    String(configuration.revision),
  );
  mkdirSync(home, { recursive: true });
  const p = configuration.modelParameters ?? {},
    efforts = bindingReasoningLevels(p, harness) ?? [],
    reasoning = configuration.binding!.reasoning;
  env.KODO_PROVIDER_KEY = key ?? "kodo-anonymous-local-endpoint";
  if (harness === "deepseek-harness") {
    env.DSH_HOME = home;
    atomic(join(home, "cordis.patch.yml"), [
      {
        id: "llm-pi-ai",
        config: {
          providers: {
            [configuration.provider]: {
              displayName: configuration.name,
              api: configuration.protocol,
              baseURL: configuration.baseUrl,
              apiKeyEnv: "KODO_PROVIDER_KEY",
              models: [
                {
                  id: configuration.model,
                  name: configuration.model,
                  contextWindow: p.contextWindow,
                  maxTokens: p.maxOutputTokens,
                  input: p.input,
                  reasoningEfforts:
                    p.reasoning === false
                      ? false
                      : Object.fromEntries(
                          efforts.map((v) => [v, bindingThinkingLevelMap(p)[v as "high"] ?? v]),
                        ),
                },
              ],
            },
          },
        },
      },
      {
        id: "agent-default-model",
        config: {
          provider: configuration.provider,
          model: configuration.model,
          ...(reasoning ? { reasoningEffort: reasoning } : {}),
        },
      },
    ]);
  } else if (harness === "zcode") {
    // Only a short-lived local relay token is allowed in this native plaintext field.
    if (!/^http:\/\/127\.0\.0\.1:\d+\//.test(configuration.baseUrl ?? ""))
      throw new KodoError("UNSUPPORTED", "ZCode 绑定必须通过 Host 本地凭据中继启动。");
    const dir = join(home, ".zcode", "v2");
    mkdirSync(dir, { recursive: true });
    env.ZCODE_DATA_BASE_DIR = home;
    env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE = join(dir, "provider_config.json");
    atomic(env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE, {
      schemaVersion: 1,
      config: {
        defaultModelSelection: {
          providerId: configuration.provider,
          modelId: configuration.model,
          ...(reasoning ? { options: { reasoningLevel: reasoning } } : {}),
        },
        providerConfigRules: {
          providerRules: [
            {
              providerId: configuration.provider,
              providerName: configuration.name,
              enabled: true,
              config: {
                group: "standard-personal",
                access: { type: "api-key", apiKey: env.KODO_PROVIDER_KEY },
                api: {
                  type:
                    configuration.protocol === "openai-completions"
                      ? "openai-chat-completions"
                      : configuration.protocol,
                  baseUrl: configuration.baseUrl,
                },
                personalModelIds: [configuration.model],
                modelOrder: [configuration.model],
              },
            },
          ],
        },
        modelConfigRules: {
          providerModelRules: [
            {
              providerId: configuration.provider,
              modelId: configuration.model,
              config: {
                properties: {
                  ...(p.contextWindow ? { contextWindow: p.contextWindow } : {}),
                  ...(p.input ? { inputFormat: { supportsImage: p.input.includes("image") } } : {}),
                },
                optionSpecs: {
                  ...(p.maxOutputTokens
                    ? { maxOutputTokens: { max: Math.min(p.maxOutputTokens, 128000) } }
                    : {}),
                  ...(p.reasoning === false || efforts.length
                    ? { reasoningLevel: { values: p.reasoning === false ? ["disabled"] : efforts } }
                    : {}),
                },
              },
            },
          ],
          manualProviderModelRules: [],
        },
      },
    });
  } else if (harness === "gemini") {
    env.GEMINI_CLI_HOME = home;
    env.GEMINI_API_KEY = env.KODO_PROVIDER_KEY;
    env.GOOGLE_GEMINI_BASE_URL = configuration.baseUrl;
    env.GEMINI_MODEL = configuration.model;
    const dir = join(home, ".gemini");
    mkdirSync(dir, { recursive: true });
    atomic(join(dir, "settings.json"), {
      security: { auth: { selectedType: "gemini-api-key" } },
      model: { name: configuration.model },
      modelConfigs: {
        customOverrides: [
          {
            match: { model: configuration.model },
            modelConfig: {
              generateContentConfig: {
                ...(p.maxOutputTokens ? { maxOutputTokens: p.maxOutputTokens } : {}),
                ...(reasoning
                  ? { thinkingConfig: { thinkingLevel: reasoning.toUpperCase() } }
                  : p.reasoning === false
                    ? { thinkingConfig: { thinkingBudget: 0 } }
                    : {}),
              },
            },
          },
        ],
      },
    });
  } else if (harness === "kimi-code") {
    env.KIMI_CODE_HOME = home;
    const type = {
      "openai-completions": "openai",
      "openai-responses": "openai_responses",
      "anthropic-messages": "anthropic",
      "google-generative-ai": "google-genai",
    }[configuration.protocol as "openai-completions"];
    atomic(
      join(home, "config.toml"),
      [
        `default_model = ${q(boundNativeModel(configuration))}`,
        `[providers.${q(configuration.provider)}]`,
        `type = ${q(type)}`,
        `base_url = ${q(configuration.baseUrl)}`,
        'api_key_env = "KODO_PROVIDER_KEY"',
        `[models.${q(boundNativeModel(configuration))}]`,
        `provider = ${q(configuration.provider)}`,
        `model = ${q(configuration.model)}`,
        `max_context_size = ${p.contextWindow}`,
        ...(p.maxOutputTokens ? [`max_output_size = ${p.maxOutputTokens}`] : []),
        `capabilities = ${q(["tool_use", ...(p.input?.includes("image") ? ["image_in"] : []), ...(p.reasoning ? ["thinking"] : [])])}`,
        ...(efforts.length ? [`support_efforts = ${q(efforts)}`] : []),
        ...(reasoning ? [`default_effort = ${q(reasoning)}`] : []),
        "",
      ].join("\n"),
      false,
    );
  } else {
    env.GROK_HOME = home;
    env.GROK_DEFAULT_MODEL = configuration.model;
    const backend = {
      "openai-completions": "chat_completions",
      "openai-responses": "responses",
      "anthropic-messages": "messages",
    }[configuration.protocol as "openai-completions"];
    const baseUrl =
      configuration.protocol === "anthropic-messages" &&
      !/\/v1\/?$/.test(configuration.baseUrl ?? "")
        ? `${configuration.baseUrl!.replace(/\/$/, "")}/v1`
        : configuration.baseUrl;
    atomic(
      join(home, "config.toml"),
      [
        "[models]",
        `default = ${q(configuration.model)}`,
        ...(reasoning ? [`default_reasoning_effort = ${q(reasoning)}`] : []),
        `[model.${q(configuration.model)}]`,
        `model = ${q(configuration.model)}`,
        `name = ${q(configuration.name)}`,
        `base_url = ${q(baseUrl)}`,
        'env_key = "KODO_PROVIDER_KEY"',
        `api_backend = ${q(backend)}`,
        ...(p.contextWindow ? [`context_window = ${p.contextWindow}`] : []),
        ...(p.maxOutputTokens ? [`max_completion_tokens = ${p.maxOutputTokens}`] : []),
        ...(p.reasoning !== undefined
          ? [`supports_reasoning_effort = ${p.reasoning && efforts.length > 0}`]
          : []),
        ...(reasoning ? [`reasoning_effort = ${q(reasoning)}`] : []),
        "",
      ].join("\n"),
      false,
    );
  }
  return true;
}
