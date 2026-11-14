import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { HarnessId } from "@kodo/protocol";
import { readDshNativeConfig, DSH_FALLBACK_MODEL } from "./dsh-native.js";
import { readKodoNativeModels } from "./models.js";

/** What a harness uses when Kodo does not override it, read from its own config files. */
export interface NativeDefaults {
  model: string | null;
  reasoning: string | null;
  permission: string | null;
}

const none: NativeDefaults = { model: null, reasoning: null, permission: null };

/** Resolve native locations without reading or exposing configuration contents. */
export function nativeConfigLocations(
  harnessId: HarnessId,
  env: NodeJS.ProcessEnv = process.env,
  kodoRoot = join(env.KODO_DATA_DIR ?? join(homeDirectory(), ".kodo"), "kodo"),
  home = homedir(),
): { path: string; exists: boolean }[] {
  const pi = env.PI_CODING_AGENT_DIR ?? join(home, ".pi", "agent");
  const opencode =
    env.OPENCODE_CONFIG_DIR ?? join(env.XDG_CONFIG_HOME ?? join(home, ".config"), "opencode");
  const candidates: Record<HarnessId, string[]> = {
    kodo: [join(kodoRoot, "settings.json"), join(kodoRoot, "models.json")],
    pi: [join(pi, "settings.json"), join(pi, "models.json")],
    codex: [join(env.CODEX_HOME ?? join(home, ".codex"), "config.toml")],
    "claude-code": [join(env.CLAUDE_CONFIG_DIR ?? join(home, ".claude"), "settings.json")],
    "deepseek-harness": ["sdk", "desktop", "web", "tui"].map((profile) =>
      join(env.DSH_HOME ?? join(home, ".dsh"), "profiles", profile, "cordis.patch.yml"),
    ),
    zcode: [
      env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE ??
        join(env.ZCODE_HOME ?? join(home, ".zcode"), "v2", "provider_config.json"),
    ],
    opencode: [
      ...(env.OPENCODE_CONFIG ? [env.OPENCODE_CONFIG] : []),
      join(opencode, "opencode.json"),
      join(opencode, "opencode.jsonc"),
    ],
    gemini: [join(home, ".gemini", "settings.json")],
    cursor: [
      join(home, ".cursor", "cli-config.json"),
      ...(env.APPDATA ? [join(env.APPDATA, "Cursor", "User", "settings.json")] : []),
    ],
    "kimi-code": [join(env.KIMI_CODE_HOME ?? join(home, ".kimi-code"), "config.toml")],
    "grok-build": [join(env.GROK_HOME ?? join(home, ".grok"), "config.toml")],
  };
  const locations = [...new Set(candidates[harnessId])].map((path) => {
    try {
      return { path, exists: statSync(path).isFile() };
    } catch {
      return { path, exists: false };
    }
  });
  const existing = locations.filter((file) => file.exists);
  // A native config may not be written until the first settings change.
  return existing.length ? existing : locations.slice(0, 1);
}

/** Compatibility field containing only files that already exist. */
export function nativeConfigFiles(
  harnessId: HarnessId,
  env: NodeJS.ProcessEnv = process.env,
  kodoRoot?: string,
): string[] {
  return nativeConfigLocations(harnessId, env, kodoRoot)
    .filter((file) => file.exists)
    .map((file) => file.path);
}

function read(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  } catch {
    return null;
  }
}
function json(path: string): Record<string, any> | null {
  const text = read(path);
  if (!text) return null;
  try {
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as Record<string, any>;
  } catch {
    return null;
  }
}
/** Top-level `key = "value"` from a TOML document, before the first table. */
function tomlTop(text: string, key: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) break;
    const m = new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`).exec(line);
    if (m) return m[1] ?? null;
  }
  return null;
}

const CODEX_PERMISSIONS: Record<string, string> = {
  "read-only": "只读",
  "workspace-write": "工作区写入",
  "danger-full-access": "完全访问",
};
const CLAUDE_PERMISSIONS: Record<string, string> = {
  default: "逐项审批",
  acceptEdits: "自动接受编辑",
  bypassPermissions: "跳过审批",
  plan: "计划模式",
};

export function nativeDefaults(
  harnessId: HarnessId,
  env: NodeJS.ProcessEnv = process.env,
  kodoRoot = join(env.KODO_DATA_DIR ?? join(homeDirectory(), ".kodo"), "kodo"),
): NativeDefaults {
  try {
    if (harnessId === "codex") {
      const text = read(join(env.CODEX_HOME ?? join(homedir(), ".codex"), "config.toml"));
      if (!text) return none;
      const sandbox = tomlTop(text, "sandbox_mode");
      const approval = tomlTop(text, "approval_policy");
      return {
        model: tomlTop(text, "model"),
        reasoning: tomlTop(text, "model_reasoning_effort"),
        // Codex's built-in default for a trusted project is workspace-write.
        permission: `${CODEX_PERMISSIONS[sandbox ?? "workspace-write"] ?? sandbox}${approval ? ` · ${approval}` : ""}`,
      };
    }
    if (harnessId === "claude-code") {
      const dir = env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
      const settings = json(join(dir, "settings.json")) ?? {};
      const mode = settings.permissions?.defaultMode;
      return {
        model: typeof settings.model === "string" ? settings.model : null,
        reasoning:
          typeof settings.effortLevel === "string"
            ? settings.effortLevel
            : typeof env.CLAUDE_CODE_EFFORT_LEVEL === "string"
              ? env.CLAUDE_CODE_EFFORT_LEVEL
              : null,
        permission: typeof mode === "string" ? (CLAUDE_PERMISSIONS[mode] ?? mode) : "逐项审批",
      };
    }
    if (harnessId === "pi" || harnessId === "kodo") {
      const root =
        harnessId === "kodo"
          ? kodoRoot
          : (env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"));
      const d = readKodoNativeModels(root).defaultModel;
      const level = json(join(root, "settings.json"))?.defaultThinkingLevel;
      return {
        model: d ? (d.provider ? `${d.provider}/${d.model}` : d.model) : null,
        reasoning: typeof level === "string" ? level : null,
        permission: null,
      };
    }
    if (harnessId === "deepseek-harness") {
      const d: { provider: string; model: string; reasoningEffort?: string } =
        readDshNativeConfig(env).defaultModel ?? DSH_FALLBACK_MODEL;
      return {
        model: `${d.provider}/${d.model}`,
        reasoning: d.reasoningEffort ?? null,
        permission: null,
      };
    }
    if (harnessId === "opencode") {
      const dir = env.OPENCODE_CONFIG_DIR ?? join(homedir(), ".config", "opencode");
      const config = json(join(dir, "opencode.json")) ?? {};
      return {
        model: typeof config.model === "string" ? config.model : null,
        reasoning: null,
        permission: null,
      };
    }
    if (harnessId === "gemini") {
      const settings = json(join(homedir(), ".gemini", "settings.json")) ?? {};
      const model = settings.model?.name ?? settings.model;
      return { model: typeof model === "string" ? model : null, reasoning: null, permission: null };
    }
  } catch {
    return none;
  }
  return none;
}
function homeDirectory() {
  return homedir();
}
