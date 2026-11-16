import { kodoSecrets } from "../credentials/vault.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import {
  KodoError,
  type HarnessId,
  type BindingRuntime,
  type Provider,
  type HarnessBinding,
} from "@kodo/protocol";
import type { Store } from "../storage/store.js";
import { desktopInstallations, bundledLaunch } from "../harnesses/desktop-installations.js";
import { executable } from "../harnesses/rpc.js";
import type { DesktopInstallation, NativeLaunch } from "../harnesses/launch-types.js";
import { configureNativeBinding } from "../providers/native-config.js";

export const launchDefaults: Record<HarnessId, NativeLaunch> = {
  kodo: { command: "kodo-sdk", args: [] },
  pi: { command: "kodo-sdk", args: [] },
  codex: { command: "codex", args: ["app-server"] },
  "claude-code": { command: "claude-sdk", args: [] },
  "deepseek-harness": { command: "dsh", args: ["--profile", "sdk"] },
  zcode: { command: "zcode", args: ["app-server", "--stdio"] },
  opencode: { command: "opencode", args: ["serve"] },
  gemini: { command: "gemini", args: ["--acp"] },
  cursor: { command: "agent", args: ["acp"] },
  "kimi-code": { command: "kimi", args: ["acp"] },
  "grok-build": { command: "grok", args: ["agent", "stdio"] },
};
export function inspectInstallation(dataDir: string, id: HarnessId) {
  const path = join(dataDir, "installations.json");
  const overrides = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  const override = overrides[id];
  if (override?.desktopPath !== undefined && typeof override.desktopPath !== "string")
    throw new KodoError("INVALID_INPUT", "desktopPath 需要桌面应用的完整路径。");
  const desktops = desktopInstallations(id, override?.desktopPath);
  return resolveInstallation(id, override, desktops);
}
/** Resolve independently of the machine scan, so desktop-only selection is deterministic. */
export function resolveInstallation(
  id: HarnessId,
  override: { command?: unknown; args?: unknown; preferDesktop?: unknown } | undefined,
  desktops: DesktopInstallation[],
  findExecutable: typeof executable = executable,
) {
  if (override?.preferDesktop !== undefined && typeof override.preferDesktop !== "boolean")
    throw new KodoError("INVALID_INPUT", "preferDesktop 需要布尔值。");
  const fallback = launchDefaults[id],
    sdk = ["kodo-sdk", "claude-sdk"].includes(fallback.command);
  let launch: NativeLaunch | undefined;
  if (override?.command !== undefined) {
    if (
      typeof override.command !== "string" ||
      !Array.isArray(override.args) ||
      override.args.some((s: unknown) => typeof s !== "string")
    )
      throw new KodoError("INVALID_INPUT", "installations.json 启动配置无效。");
    launch = { command: override.command, args: override.args, source: "configured" };
  }
  const cliCommand =
    id === "cursor"
      ? ["agent", "cursor-agent"].find((command) => findExecutable(command))
      : findExecutable(fallback.command)
        ? fallback.command
        : undefined;
  if (!launch && !override?.preferDesktop && !sdk && cliCommand)
    launch = { ...fallback, command: cliCommand, source: "cli" };
  if (!launch)
    for (const desktop of desktops) {
      launch = bundledLaunch(id, desktop, fallback.args) ?? undefined;
      if (launch) break;
    }
  if (!launch && sdk) launch = { ...fallback, source: "sdk" };
  if (!launch && cliCommand) launch = { ...fallback, command: cliCommand, source: "cli" };
  const ready = Boolean(
    launch &&
    (["kodo-sdk", "claude-sdk"].includes(launch.command) || findExecutable(launch.command)),
  );
  const reason =
    override?.command && !ready
      ? "用户指定的原生入口不存在或不可执行，请检查 installations.json 的 command/args。"
      : desktops.length
        ? `已发现 ${desktops[0]!.name} 桌面版，但此版本尚未找到可调用的原生入口。桌面聊天产品不自动等于同名编码 harness；需提供其原生服务/CLI 入口。`
        : "未发现桌面应用、原生入口或 SDK；可在 installations.json 指定 desktopPath 或 command/args。";
  return {
    launch: ready ? launch! : { ...(launch ?? fallback), unavailableReason: reason },
    desktops,
    ready,
    reason: ready ? undefined : reason,
  };
}
export function resolveInstallationModes(
  id: HarnessId,
  desktops: DesktopInstallation[],
  findExecutable: typeof executable = executable,
) {
  const cliOnly = resolveInstallation(id, undefined, [], findExecutable);
  // Ignore PATH commands in this scenario; bundled entries are absolute paths.
  const desktopOnly = resolveInstallation(id, { preferDesktop: true }, desktops, (command) =>
    isAbsolute(command) ? findExecutable(command) : null,
  );
  return {
    cliOnly: {
      launchable: cliOnly.ready,
      source: cliOnly.ready
        ? cliOnly.launch.source === "sdk"
          ? ("sdk" as const)
          : ("cli" as const)
        : null,
      ...(cliOnly.reason ? { reason: cliOnly.reason } : {}),
    },
    desktopOnly: {
      launchable: desktopOnly.ready,
      source: desktopOnly.ready
        ? desktopOnly.launch.source === "sdk"
          ? ("sdk" as const)
          : ("desktop-bundled" as const)
        : null,
      ...(desktopOnly.reason ? { reason: desktopOnly.reason } : {}),
    },
  };
}
export function nativeLaunch(dataDir: string, id: HarnessId): NativeLaunch {
  return inspectInstallation(dataDir, id).launch;
}
export interface CredentialVault {
  set(ref: string, value: string): Promise<void>;
  delete(ref: string): Promise<void>;
}
const systemVault: CredentialVault = kodoSecrets;
export async function collectProviderCredentials(
  store: Store,
  vault: CredentialVault = systemVault,
) {
  const refs = store.transaction(() => {
    const current = store.records<Provider>("provider");
    const pinned = new Set(
      store
        .sessions()
        .filter((s) => s.bindingId)
        .map((s) => `${s.bindingId}:${s.bindingRevision}`),
    );
    const bindings = store.records<HarnessBinding>("harness-binding");
    const providerRevisions = new Set(
      [
        ...bindings,
        ...store
          .records<HarnessBinding>("harness-binding-revision")
          .filter((b) => pinned.has(`${b.id}:${b.revision}`)),
      ].map((b) => `${b.providerId}:${b.providerRevision}`),
    );
    const providers = [
      ...current,
      ...store
        .records<Provider>("provider-revision")
        .filter((p) => providerRevisions.has(`${p.id}:${p.revision}`)),
    ];
    const live = new Set<string>();
    for (const provider of providers)
      for (const endpoint of provider.endpoints)
        if (endpoint.credentialRef) live.add(endpoint.credentialRef);
    return store
      .records<{ ref: string; state: string; createdAt?: string }>("credential-owned")
      .filter(
        (c) =>
          !live.has(c.ref) &&
          (c.state !== "pending" || Date.parse(c.createdAt ?? "") < Date.now() - 3600000),
      );
  });
  let removed = 0;
  for (const ref of refs) {
    // Keep failed deletions in the durable inventory so a later run can retry.
    await vault.delete(ref.ref);
    store.remove("credential-owned", ref.ref);
    removed++;
  }
  return { removed };
}
export async function instanceEnv(
  harnessId: HarnessId,
  configuration: BindingRuntime | undefined,
  dataDir: string,
  runtimeKey?: string,
  modelMap?: Partial<Record<"main" | "sonnet" | "opus" | "haiku" | "fast", string>>,
): Promise<NodeJS.ProcessEnv> {
  // Keep the selected harness's existing login environment, strip unrelated credentials.
  const prefixes: Record<HarnessId, RegExp> = {
    kodo: /^(PI_|ANTHROPIC_|OPENAI_|GOOGLE_|DEEPSEEK_)/,
    pi: /^(PI_|ANTHROPIC_|OPENAI_|GOOGLE_|DEEPSEEK_)/,
    codex: /^(CODEX_|OPENAI_)/,
    "claude-code": /^(CLAUDE_|ANTHROPIC_)/,
    "deepseek-harness": /^(DSH_|DEEPSEEK_)/,
    zcode: /^(ZCODE_|ZAI_)/,
    opencode: /^OPENCODE_/,
    gemini: /^(GEMINI_|GOOGLE_)/,
    cursor: /^CURSOR_/,
    "kimi-code": /^(KIMI_|MOONSHOT_)/,
    "grok-build": /^(GROK_|XAI_)/,
  };
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env))
    if (!/(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(key) || prefixes[harnessId].test(key))
      env[key] = value;
  if (!configuration) return env;
  if (
    ![
      "kodo",
      "pi",
      "codex",
      "claude-code",
      "deepseek-harness",
      "opencode",
      "zcode",
      "gemini",
      "kimi-code",
      "grok-build",
    ].includes(harnessId)
  )
    throw new KodoError("UNSUPPORTED", "此 harness 的绑定隔离尚未验证，请选择原生配置。");
  if (configuration.binding)
    for (const name of Object.keys(env))
      if (
        /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(name) ||
        /^(OPENAI_BASE_URL|ANTHROPIC_BASE_URL|ANTHROPIC_AUTH_TOKEN)$/.test(name)
      )
        delete env[name];
  const key =
    runtimeKey !== undefined
      ? runtimeKey
      : configuration.credentialRef
        ? await kodoSecrets.get(configuration.credentialRef)
        : null;
  if (configuration.credentialRef && !key)
    throw new KodoError("UNAVAILABLE", "系统凭据库中缺少绑定凭据。");
  if (configuration.binding && configureNativeBinding(harnessId, configuration, dataDir, env, key))
    return env;
  if (harnessId === "codex") {
    const home = join(
      dataDir,
      "instances",
      harnessId,
      configuration.id,
      String(configuration.revision),
    );
    mkdirSync(home, { recursive: true });
    env.CODEX_HOME = home;
    if (key) env.OPENAI_API_KEY = key;
    if (configuration.baseUrl) {
      if (configuration.protocol !== "openai-responses")
        throw new KodoError("UNSUPPORTED", "Codex 自定义 endpoint 需要 openai-responses 协议。");
      writeFileSync(
        join(home, "config.toml"),
        `model = ${JSON.stringify(configuration.model)}\n${configuration.modelParameters?.contextWindow ? `model_context_window = ${configuration.modelParameters.contextWindow}\n` : ""}model_provider = "kodo"\n[model_providers.kodo]\nname = "Kooyu binding"\nbase_url = ${JSON.stringify(configuration.baseUrl)}\nwire_api = "responses"\n${key ? 'env_key = "OPENAI_API_KEY"\n' : ""}`,
      );
    }
  } else if (harnessId === "claude-code") {
    const home = join(
      dataDir,
      "instances",
      harnessId,
      configuration.id,
      String(configuration.revision),
    );
    mkdirSync(home, { recursive: true });
    env.CLAUDE_CONFIG_DIR = home;
    if (key) env.ANTHROPIC_API_KEY = key;
    else if (configuration.binding) env.ANTHROPIC_API_KEY = "kodo-anonymous-local-endpoint";
    if (configuration.baseUrl) env.ANTHROPIC_BASE_URL = configuration.baseUrl;
    if (configuration.protocol !== "anthropic-messages")
      throw new KodoError("UNSUPPORTED", "Claude SDK 需要 Anthropic Messages 协议。");
    // Claude Code asks for models by role (sonnet/opus/haiku and a small fast model).
    // A third-party source rarely has those names, so map each role to a real model.
    const map = modelMap ?? {};
    const main = map.main ?? configuration.model;
    if (main) env.ANTHROPIC_MODEL = main;
    for (const [role, name] of [
      ["sonnet", "ANTHROPIC_DEFAULT_SONNET_MODEL"],
      ["opus", "ANTHROPIC_DEFAULT_OPUS_MODEL"],
      ["haiku", "ANTHROPIC_DEFAULT_HAIKU_MODEL"],
    ] as const) {
      const target = map[role] ?? (configuration.binding ? main : undefined);
      if (target) env[name] = target;
    }
    const fast = map.fast ?? map.haiku ?? (configuration.binding ? main : undefined);
    if (fast) env.ANTHROPIC_SMALL_FAST_MODEL = fast;
  } else if (harnessId === "opencode" && configuration.binding) {
    const home = join(
      dataDir,
      "instances",
      harnessId,
      configuration.id,
      String(configuration.revision),
    );
    mkdirSync(home, { recursive: true });
    const params = configuration.modelParameters ?? {};
    const npm =
      configuration.protocol === "anthropic-messages"
        ? "@ai-sdk/anthropic"
        : configuration.protocol === "openai-responses"
          ? "@ai-sdk/openai"
          : "@ai-sdk/openai-compatible";
    const efforts =
      params.reasoningOptions?.flatMap((o) => (o.type === "effort" ? o.values : [])) ?? [];
    const config = {
      $schema: "https://opencode.ai/config.json",
      enabled_providers: [configuration.provider],
      model: `${configuration.provider}/${configuration.model}`,
      provider: {
        [configuration.provider]: {
          npm,
          name: configuration.name,
          options: {
            baseURL:
              configuration.protocol === "anthropic-messages" &&
              !/\/v1\/?$/.test(configuration.baseUrl ?? "")
                ? `${configuration.baseUrl!.replace(/\/$/, "")}/v1`
                : configuration.baseUrl,
            apiKey: "{env:KODO_PROVIDER_KEY}",
          },
          models: {
            [configuration.model]: {
              id: configuration.model,
              name: configuration.model,
              ...(params.reasoning !== undefined ? { reasoning: params.reasoning } : {}),
              limit: {
                ...(params.contextWindow ? { context: params.contextWindow } : {}),
                ...(params.maxOutputTokens ? { output: params.maxOutputTokens } : {}),
                ...(params.maxInputTokens ? { input: params.maxInputTokens } : {}),
              },
              ...(params.input ? { modalities: { input: params.input, output: ["text"] } } : {}),
              ...(efforts.length
                ? {
                    variants: Object.fromEntries(
                      efforts.map((v) => [
                        v,
                        configuration.protocol === "anthropic-messages"
                          ? { effort: v }
                          : { reasoningEffort: v },
                      ]),
                    ),
                  }
                : {}),
            },
          },
        },
      },
    };
    env.KODO_PROVIDER_KEY = key ?? "kodo-anonymous-local-endpoint";
    env.OPENCODE_CONFIG_CONTENT = JSON.stringify(config);
    env.OPENCODE_CONFIG_DIR = home;
    env.OPENCODE_DISABLE_PROJECT_CONFIG = "true";
  } else if (harnessId === "deepseek-harness") {
    if (configuration.baseUrl)
      throw new KodoError(
        "UNSUPPORTED",
        "DSH 自定义 endpoint 映射尚未验证；请在原生实例配置 provider。",
      );
    if (key) env.DEEPSEEK_API_KEY = key;
  }
  return env;
}
