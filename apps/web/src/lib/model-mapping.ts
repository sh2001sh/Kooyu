import type { AppSettings, HarnessId } from "@kodo/protocol";

export type ClaudeModelSlot = "main" | "sonnet" | "opus" | "haiku" | "fast";

export const CLAUDE_MODEL_MAP_SLOTS: ReadonlyArray<{
  slot: ClaudeModelSlot;
  label: string;
  shortLabel: string;
  hint: string;
}> = [
  {
    slot: "main",
    label: "主模型",
    shortLabel: "主模型",
    hint: "对话默认使用（ANTHROPIC_MODEL）",
  },
  {
    slot: "sonnet",
    label: "Sonnet 档",
    shortLabel: "Sonnet 档",
    hint: "选择 sonnet 时使用",
  },
  {
    slot: "opus",
    label: "Opus 档",
    shortLabel: "Opus 档",
    hint: "选择 opus 或计划模式时使用",
  },
  {
    slot: "haiku",
    label: "Haiku 档",
    shortLabel: "Haiku 档",
    hint: "后台与轻量任务使用",
  },
  {
    slot: "fast",
    label: "快速模型",
    shortLabel: "快速模型",
    hint: "标题生成等小任务（ANTHROPIC_SMALL_FAST_MODEL）",
  },
];

export function harnessSupportsModelMap(harnessId: HarnessId): boolean {
  return harnessId === "claude-code";
}

/** Suggest sensible Claude role-to-model mappings from a provider's available model list. */
export function suggestClaudeModelMap(
  models: string[],
  fallbackModel?: string | null,
): Partial<Record<ClaudeModelSlot, string>> {
  const unique = [...new Set(models.filter(Boolean))];
  if (unique.length === 0) return {};

  const pick = (patterns: RegExp[], exclude?: RegExp): string | undefined => {
    for (const pattern of patterns) {
      const match = unique.find((m) => pattern.test(m) && (!exclude || !exclude.test(m)));
      if (match) return match;
    }
    return undefined;
  };

  const lightExclude = /\b(haiku|flash|mini|lite|nano|small|fast)\b/i;
  const sonnet = pick([/sonnet/i, /\bpro\b/i, /\bplus\b/i], lightExclude);
  const opus = pick([/opus/i, /\bmax\b/i, /\bultra\b/i, /\bpro\b/i], lightExclude);
  const light = pick([/haiku/i, /flash/i, /mini/i, /lite/i, /small/i, /fast/i]);
  const main =
    sonnet ??
    opus ??
    (fallbackModel && unique.includes(fallbackModel) ? fallbackModel : undefined) ??
    unique[0];

  const next: Partial<Record<ClaudeModelSlot, string>> = {};
  if (main) next.main = main;
  if (sonnet && sonnet !== main) next.sonnet = sonnet;
  if (opus && opus !== main) next.opus = opus;
  if (light && light !== main) {
    next.haiku = light;
    next.fast = light;
  }
  return next;
}

type HarnessPreset = NonNullable<AppSettings["harnessDefaults"][HarnessId]>;

/** Remove model or modelMap entries that do not exist in a newly bound provider's model set. */
export function pruneHarnessDefaultsForModels(
  existing: HarnessPreset | undefined,
  validModels: ReadonlySet<string>,
): HarnessPreset | null {
  if (!existing) return null;
  let changed = false;
  let nextModel = existing.model ?? null;
  if (nextModel && !validModels.has(nextModel)) {
    nextModel = null;
    changed = true;
  }
  const nextMap: Partial<Record<ClaudeModelSlot, string>> = {};
  for (const [slot, val] of Object.entries(existing.modelMap ?? {})) {
    if (!val) continue;
    if (validModels.has(val)) {
      nextMap[slot as ClaudeModelSlot] = val;
    } else {
      changed = true;
    }
  }
  if (!changed) return existing;
  return {
    model: nextModel,
    reasoning: existing.reasoning ?? null,
    permissionMode: existing.permissionMode ?? null,
    modelMap: nextMap,
  };
}
