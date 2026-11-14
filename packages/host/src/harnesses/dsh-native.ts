import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { parse, stringify } from "yaml";
import type { HarnessModelOption } from "@kodo/protocol";
import type { Wire } from "./adapter.js";
import { nativeParameters } from "./model-metadata.js";

/**
 * DeepSeek Harness keeps user-configured providers in each profile's cordis.patch.yml.
 * The SDK profile Kodo boots is usually untouched, so read the providers the user set up
 * in their interactive profiles and overlay them with `--patch` (never editing user files).
 */
const PROFILES = ["sdk", "desktop", "web", "tui"];
/** Built into dsh-llm-deepseek; DEFAULT_CONTEXT_WINDOW = 1e6. */
const OFFICIAL: HarnessModelOption[] = [
  { id: "deepseek-official/deepseek-flash", name: "DeepSeek-V4.1-Flash · 官方 API" },
  { id: "deepseek-official/deepseek-v4-pro", name: "DeepSeek-V4-Pro · 官方 API" },
].map((m) => ({
  ...m,
  source: "native-catalog" as const,
  ...nativeParameters(
    { contextWindow: 1_000_000, reasoning: ["off", "low", "high", "max"] },
    { kind: "native-catalog", label: "DSH 内置 DeepSeek 目录" },
  ),
}));

export function dshHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.DSH_HOME ?? join(homedir(), ".dsh");
}

function readPatch(path: string): Wire[] {
  try {
    const value = parse(readFileSync(path, "utf8"), { logLevel: "silent" }) as unknown;
    return Array.isArray(value) ? (value as Wire[]) : [];
  } catch {
    return [];
  }
}

export interface DshNativeConfig {
  /** Merged `llm-pi-ai` provider routes, earlier profiles win. */
  providers: Record<string, Wire>;
  defaultModel: { provider: string; model: string; reasoningEffort?: string } | null;
}

export function readDshNativeConfig(env: NodeJS.ProcessEnv = process.env): DshNativeConfig {
  const providers: Record<string, Wire> = {};
  let defaultModel: DshNativeConfig["defaultModel"] = null;
  for (const profile of PROFILES) {
    const entries = readPatch(join(dshHome(env), "profiles", profile, "cordis.patch.yml"));
    for (const entry of entries) {
      if (entry?.id === "llm-pi-ai" && entry.config?.providers) {
        for (const [name, route] of Object.entries(entry.config.providers as Wire))
          if (!(name in providers) && route && typeof route === "object") providers[name] = route;
      }
      if (
        !defaultModel &&
        entry?.id === "agent-default-model" &&
        typeof entry.config?.provider === "string" &&
        typeof entry.config?.model === "string" &&
        // The account provider needs the desktop login session, not available to the SDK.
        entry.config.provider !== "deepseek-account"
      )
        defaultModel = {
          provider: entry.config.provider,
          model: entry.config.model,
          ...(typeof entry.config.reasoningEffort === "string"
            ? { reasoningEffort: entry.config.reasoningEffort }
            : {}),
        };
    }
  }
  return { providers, defaultModel };
}

export function dshNativeModelOptions(config: DshNativeConfig): HarnessModelOption[] {
  const options: HarnessModelOption[] = [];
  for (const [provider, route] of Object.entries(config.providers)) {
    if (!Array.isArray(route.models)) continue;
    for (const m of route.models as Wire[]) {
      if (typeof m?.id !== "string") continue;
      const efforts =
        m.reasoningEfforts === false
          ? ["off"]
          : m.reasoningEfforts && typeof m.reasoningEfforts === "object"
            ? Object.keys(m.reasoningEfforts)
            : undefined;
      options.push({
        id: `${provider}/${m.id}`,
        name: `${m.name ?? m.id} · ${route.displayName ?? provider}`,
        source: "native-catalog",
        ...(config.defaultModel?.provider === provider && config.defaultModel.model === m.id
          ? { isDefault: true }
          : {}),
        ...nativeParameters(
          { contextWindow: m.contextWindow, maxOutputTokens: m.maxTokens, reasoning: efforts },
          { kind: "native-config", label: "DSH 个人 profile 配置" },
        ),
      });
    }
  }
  return [...options, ...OFFICIAL];
}

/** Write a patch overlay with the user's provider routes; returns null when none exist. */
export function writeDshNativePatch(dataDir: string, config: DshNativeConfig): string | null {
  if (!Object.keys(config.providers).length) return null;
  const dir = join(dataDir, "instances", "deepseek-harness", "native");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "providers.patch.yml");
  const body = stringify([{ id: "llm-pi-ai", config: { providers: config.providers } }]);
  if (existsSync(path) && readFileSync(path, "utf8") === body) return path;
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, body, { mode: 0o600 });
  renameSync(temp, path);
  return path;
}

export const DSH_FALLBACK_MODEL = { provider: "deepseek-official", model: "deepseek-flash" };
