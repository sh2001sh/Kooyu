import type { Capability, HarnessId, HarnessBinding, Session, Snapshot } from "@kodo/protocol";

export const HARNESS_NAMES: Record<HarnessId, string> = {
  kodo: "Kooyu",
  pi: "pi",
  codex: "Codex",
  "claude-code": "Claude Code",
  "deepseek-harness": "DeepSeek Harness",
  zcode: "ZCode",
  opencode: "OpenCode",
  gemini: "Gemini CLI",
  cursor: "Cursor",
  "kimi-code": "Kimi Code",
  "grok-build": "Grok Build",
};

export interface HarnessVisual {
  monogram: string;
  tint: string;
  ink: string;
  darkTint: string;
  darkInk: string;
  tagline: string;
}

export const HARNESS_VISUALS: Record<HarnessId, HarnessVisual> = {
  kodo: {
    monogram: "K",
    tint: "rgba(241, 117, 97, 0.14)",
    ink: "#C2422F",
    darkTint: "rgba(241, 117, 97, 0.22)",
    darkInk: "#FF9B8A",
    tagline: "产品主控 · 会话管理与委派",
  },
  pi: {
    monogram: "π",
    tint: "rgba(116, 94, 212, 0.13)",
    ink: "#5640B8",
    darkTint: "rgba(147, 130, 240, 0.22)",
    darkInk: "#C4B9FF",
    tagline: "独立 pi 原生会话",
  },
  codex: {
    monogram: "</>",
    tint: "rgba(38, 128, 92, 0.13)",
    ink: "#166B48",
    darkTint: "rgba(62, 186, 134, 0.20)",
    darkInk: "#7AE0B3",
    tagline: "Codex App Server",
  },
  "claude-code": {
    monogram: "✦",
    tint: "rgba(217, 119, 69, 0.14)",
    ink: "#B35221",
    darkTint: "rgba(235, 140, 88, 0.22)",
    darkInk: "#FFB28A",
    tagline: "Claude Agent SDK / CLI",
  },
  "deepseek-harness": {
    monogram: "DS",
    tint: "rgba(52, 112, 224, 0.13)",
    ink: "#2257B8",
    darkTint: "rgba(92, 148, 250, 0.22)",
    darkInk: "#9CC2FF",
    tagline: "DeepSeek Harness SDK",
  },
  zcode: {
    monogram: "Z",
    tint: "rgba(184, 92, 168, 0.13)",
    ink: "#8F3C81",
    darkTint: "rgba(216, 122, 200, 0.22)",
    darkInk: "#F0A8E3",
    tagline: "ZCode App Server",
  },
  opencode: {
    monogram: "OC",
    tint: "rgba(72, 108, 130, 0.13)",
    ink: "#32566D",
    darkTint: "rgba(118, 164, 192, 0.22)",
    darkInk: "#A8D0E8",
    tagline: "OpenCode V1 Server",
  },
  gemini: {
    monogram: "◆",
    tint: "rgba(56, 138, 212, 0.13)",
    ink: "#1E66A8",
    darkTint: "rgba(98, 174, 245, 0.22)",
    darkInk: "#9AD0FF",
    tagline: "Gemini CLI · ACP",
  },
  cursor: {
    monogram: "▸",
    tint: "rgba(92, 92, 102, 0.13)",
    ink: "#3E3E48",
    darkTint: "rgba(168, 168, 184, 0.22)",
    darkInk: "#D6D6E2",
    tagline: "Cursor Agent CLI · ACP",
  },
  "kimi-code": {
    monogram: "K·",
    tint: "rgba(44, 142, 168, 0.13)",
    ink: "#1A6B82",
    darkTint: "rgba(82, 184, 212, 0.22)",
    darkInk: "#94DCF0",
    tagline: "Kimi Code · ACP",
  },
  "grok-build": {
    monogram: "Ø",
    tint: "rgba(128, 104, 72, 0.14)",
    ink: "#664E2E",
    darkTint: "rgba(184, 152, 108, 0.22)",
    darkInk: "#E0C498",
    tagline: "Grok Build · ACP",
  },
};

export const RUN_STATE_LABELS: Record<Session["runState"], string> = {
  idle: "空闲",
  running: "正在运行",
  "waiting-input": "等待输入",
  unknown: "运行未知",
};

export const CONNECTION_STATE_LABELS: Record<Session["connectionState"], string> = {
  connected: "原生已连接",
  reconnecting: "原生重连中",
  offline: "原生未连接",
};

export const CAPABILITY_LABELS: Record<Capability, string> = {
  directChat: "直接对话",
  historyRead: "历史读取",
  resume: "原生恢复",
  observeLive: "实时观察",
  observeExternal: "外部活动观察",
  steer: "运行中引导",
  cancel: "取消运行",
  interaction: "原生审批交互",
  usage: "Token / 费用计量",
  quota: "账户额度查询",
};

export function formatDate(value: string): string {
  return new Date(value).toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatRelativeDate(value: string): string {
  const target = new Date(value);
  const now = new Date();
  const sameDay =
    target.getFullYear() === now.getFullYear() &&
    target.getMonth() === now.getMonth() &&
    target.getDate() === now.getDate();
  if (sameDay) {
    return target.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }
  return target.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

/** Model name without its provider route, e.g. `codegoai/deepseek-v4.1-flash` → `deepseek-v4.1-flash`. */
export function shortModelLabel(model: string): string {
  const idx = model.lastIndexOf("/");
  return idx > 0 ? model.slice(idx + 1) : model;
}

/** Provider part of a model route, if any. */
export function modelProvider(model: string): string | undefined {
  const idx = model.lastIndexOf("/");
  return idx > 0 ? model.slice(0, idx) : undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A provider id fit for display: random ids and `account:` prefixes are not names. */
export function providerLabel(provider: string | undefined, name?: string): string | undefined {
  if (!provider) return undefined;
  const fromName = name?.includes(" · ") ? name.slice(name.lastIndexOf(" · ") + 3) : undefined;
  if (fromName) return fromName;
  if (UUID.test(provider)) return undefined;
  return provider.replace(/^account:/, "");
}

export function resolveInheritedBinding(
  snapshot: Snapshot,
  harnessId: HarnessId,
  projectId: string | null | undefined,
): { binding: HarnessBinding | null; source: string } {
  const project = projectId ? snapshot.projects.find((p) => p.id === projectId) : undefined;
  const projectDefault = project?.bindingDefaults?.[harnessId];
  if (projectDefault !== undefined) {
    if (projectDefault === null) return { binding: null, source: "项目默认原生" };
    return {
      binding: snapshot.bindings.find((p) => p.id === projectDefault) ?? null,
      source: "项目默认",
    };
  }
  const harnessDefault = snapshot.bindingDefaults.harnessBindingIds?.[harnessId];
  if (harnessDefault !== undefined) {
    if (harnessDefault === null) return { binding: null, source: "Harness 默认原生" };
    return {
      binding: snapshot.bindings.find((p) => p.id === harnessDefault) ?? null,
      source: "Harness 默认",
    };
  }
  return { binding: null, source: "原生配置与登录" };
}

/**
 * Picker label for a model option: the bare model name as title, and the provider as
 * subtitle only when the same model name is offered by more than one provider.
 */
export function modelChoiceLabels<T extends { id: string; provider?: string; name?: string }>(
  options: T[],
  routeOf: (option: T) => string,
): Map<T, { title: string; subtitle?: string }> {
  const counts = new Map<string, number>();
  for (const o of options) {
    const bare = shortModelLabel(o.id).toLowerCase();
    counts.set(bare, (counts.get(bare) ?? 0) + 1);
  }
  const labels = new Map<T, { title: string; subtitle?: string }>();
  for (const o of options) {
    const route = routeOf(o);
    const bare = shortModelLabel(o.id);
    const displayName = o.name?.includes(" · ")
      ? o.name.slice(0, o.name.lastIndexOf(" · "))
      : o.name;
    const title = displayName && !displayName.includes("/") ? displayName : bare;
    const provider = providerLabel(o.provider ?? modelProvider(route), o.name);
    labels.set(o, {
      title,
      subtitle: (counts.get(bare.toLowerCase()) ?? 0) > 1 && provider ? provider : undefined,
    });
  }
  return labels;
}
