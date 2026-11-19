import { useEffect, useState } from "react";

export type AppearancePresetId = "kooyu" | "chatgpt" | "graphite" | "claude" | "nord" | "custom";
export type AccentChoiceId =
  "default" | "coral" | "blue" | "indigo" | "emerald" | "amber" | "custom";
export type FontChoiceId = "system" | "sans" | "serif" | "mono";
export type RadiusChoiceId = "compact" | "standard" | "rounded";
export type ContrastChoiceId = "soft" | "standard" | "high";

export interface AppearanceConfig {
  preset: AppearancePresetId;
  accentId: AccentChoiceId;
  customAccent: string;
  lightBg: string;
  lightFg: string;
  darkBg: string;
  darkFg: string;
  /** Surface / paper island opacity percentage (50–100). */
  surfaceOpacity: number;
  /** Frosted glass chrome opacity percentage (45–98). */
  glassOpacity: number;
  /** Backdrop blur radius in px (0–40). */
  glassBlur: number;
  fontFamily: FontChoiceId;
  radiusStyle: RadiusChoiceId;
  contrast: ContrastChoiceId;
}

export interface PresetDefinition {
  id: Exclude<AppearancePresetId, "custom">;
  label: string;
  badge: string;
  lightBg: string;
  lightFg: string;
  darkBg: string;
  darkFg: string;
  accentId: AccentChoiceId;
}

export const APPEARANCE_PRESETS: PresetDefinition[] = [
  {
    id: "kooyu",
    label: "极简墨白",
    badge: "墨",
    lightBg: "#FFFFFF",
    lightFg: "#141518",
    darkBg: "#121316",
    darkFg: "#F3F4F6",
    accentId: "default",
  },
  {
    id: "chatgpt",
    label: "澄澈素白",
    badge: "素",
    lightBg: "#FFFFFF",
    lightFg: "#1A1C1F",
    darkBg: "#212121",
    darkFg: "#ECECEC",
    accentId: "default",
  },
  {
    id: "graphite",
    label: "深空石墨",
    badge: "石",
    lightBg: "#FAFAFC",
    lightFg: "#1C1C1E",
    darkBg: "#1C1C1E",
    darkFg: "#F5F5F7",
    accentId: "blue",
  },
  {
    id: "claude",
    label: "温润米宣",
    badge: "宣",
    lightBg: "#FAF9F5",
    lightFg: "#1F1E1D",
    darkBg: "#1F1E1B",
    darkFg: "#EFECE6",
    accentId: "coral",
  },
  {
    id: "nord",
    label: "极夜冰川",
    badge: "冰",
    lightBg: "#F4F6FA",
    lightFg: "#2E3440",
    darkBg: "#242933",
    darkFg: "#ECEFF4",
    accentId: "indigo",
  },
];

export const ACCENT_CHOICES: Array<{
  id: AccentChoiceId;
  label: string;
  lightHex: string;
  darkHex: string;
}> = [
  { id: "default", label: "默认", lightHex: "#141518", darkHex: "#F3F4F6" },
  { id: "coral", label: "珊瑚红", lightHex: "#E6533C", darkHex: "#F17561" },
  { id: "blue", label: "苹果蓝", lightHex: "#007AFF", darkHex: "#3B9EFF" },
  { id: "indigo", label: "靛青紫", lightHex: "#5856D6", darkHex: "#7D7AFF" },
  { id: "emerald", label: "翡翠绿", lightHex: "#10A37F", darkHex: "#34D399" },
  { id: "amber", label: "琥珀金", lightHex: "#D97706", darkHex: "#F59E0B" },
  { id: "custom", label: "自定义", lightHex: "#007AFF", darkHex: "#3B9EFF" },
];

export const DEFAULT_APPEARANCE: AppearanceConfig = {
  preset: "kooyu",
  accentId: "default",
  customAccent: "#007AFF",
  lightBg: "#FFFFFF",
  lightFg: "#141518",
  darkBg: "#121316",
  darkFg: "#F3F4F6",
  surfaceOpacity: 100,
  glassOpacity: 86,
  glassBlur: 22,
  fontFamily: "system",
  radiusStyle: "standard",
  contrast: "standard",
};

const STORAGE_KEY = "kooyu.appearance.v1";
const CHANGE_EVENT = "kooyu:appearance-changed";

export function normalizeHex(input: string, fallback: string): string {
  const clean = input.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{6}$/.test(clean)) return `#${clean.toUpperCase()}`;
  if (/^[0-9a-fA-F]{3}$/.test(clean)) {
    return `#${clean
      .split("")
      .map((c) => c + c)
      .join("")
      .toUpperCase()}`;
  }
  return fallback.toUpperCase();
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = normalizeHex(hex, "#000000").slice(1);
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[clamp(r), clamp(g), clamp(b)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

function mixHex(hexA: string, hexB: string, weightA: number): string {
  const [r1, g1, b1] = hexToRgb(hexA);
  const [r2, g2, b2] = hexToRgb(hexB);
  const w = Math.max(0, Math.min(1, weightA));
  return rgbToHex(r1 * w + r2 * (1 - w), g1 * w + g2 * (1 - w), b1 * w + b2 * (1 - w));
}

function rgbaStr(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${Number(alpha.toFixed(3))})`;
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function loadAppearance(): AppearanceConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_APPEARANCE;
    const parsed = JSON.parse(raw) as Partial<AppearanceConfig>;
    return {
      preset: parsed.preset ?? DEFAULT_APPEARANCE.preset,
      accentId: parsed.accentId ?? DEFAULT_APPEARANCE.accentId,
      customAccent: normalizeHex(parsed.customAccent ?? "", DEFAULT_APPEARANCE.customAccent),
      lightBg: normalizeHex(parsed.lightBg ?? "", DEFAULT_APPEARANCE.lightBg),
      lightFg: normalizeHex(parsed.lightFg ?? "", DEFAULT_APPEARANCE.lightFg),
      darkBg: normalizeHex(parsed.darkBg ?? "", DEFAULT_APPEARANCE.darkBg),
      darkFg: normalizeHex(parsed.darkFg ?? "", DEFAULT_APPEARANCE.darkFg),
      surfaceOpacity: Math.max(
        50,
        Math.min(100, Number(parsed.surfaceOpacity ?? DEFAULT_APPEARANCE.surfaceOpacity)),
      ),
      glassOpacity: Math.max(
        45,
        Math.min(98, Number(parsed.glassOpacity ?? DEFAULT_APPEARANCE.glassOpacity)),
      ),
      glassBlur: Math.max(
        0,
        Math.min(40, Number(parsed.glassBlur ?? DEFAULT_APPEARANCE.glassBlur)),
      ),
      fontFamily: parsed.fontFamily ?? DEFAULT_APPEARANCE.fontFamily,
      radiusStyle: parsed.radiusStyle ?? DEFAULT_APPEARANCE.radiusStyle,
      contrast: parsed.contrast ?? DEFAULT_APPEARANCE.contrast,
    };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function applyAppearanceToDom(config: AppearanceConfig): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const isDark = root.classList.contains("dark");

  const bg = normalizeHex(
    isDark ? config.darkBg : config.lightBg,
    isDark ? DEFAULT_APPEARANCE.darkBg : DEFAULT_APPEARANCE.lightBg,
  );
  const fg = normalizeHex(
    isDark ? config.darkFg : config.lightFg,
    isDark ? DEFAULT_APPEARANCE.darkFg : DEFAULT_APPEARANCE.lightFg,
  );

  // Derive layered surfaces cleanly from user's chosen background & foreground
  const navigatorSolid = isDark ? mixHex(bg, "#000000", 0.62) : mixHex(bg, fg, 0.962);
  const raisedSolid = isDark ? mixHex(bg, fg, 0.955) : bg;
  const sunkenSolid = isDark ? mixHex(bg, "#000000", 0.78) : mixHex(bg, fg, 0.942);
  const bubbleSolid = isDark ? mixHex(bg, fg, 0.925) : mixHex(bg, fg, 0.946);

  const surfAlpha = Math.max(0.5, Math.min(1, config.surfaceOpacity / 100));
  const glassAlpha = Math.max(0.45, Math.min(0.98, config.glassOpacity / 100));

  root.style.setProperty(
    "--surface-navigator",
    surfAlpha < 1 ? rgbaStr(navigatorSolid, Math.min(1, surfAlpha * 0.96)) : navigatorSolid,
  );
  root.style.setProperty("--surface-paper", surfAlpha < 1 ? rgbaStr(bg, surfAlpha) : bg);
  root.style.setProperty(
    "--surface-raised",
    surfAlpha < 1 ? rgbaStr(raisedSolid, Math.min(1, surfAlpha + 0.04)) : raisedSolid,
  );
  root.style.setProperty("--surface-sunken", sunkenSolid);
  root.style.setProperty("--fill-bubble", bubbleSolid);
  root.style.setProperty("--surface-glass", rgbaStr(bg, glassAlpha));
  root.style.setProperty(
    "--surface-floating",
    rgbaStr(raisedSolid, Math.min(0.98, glassAlpha + 0.08)),
  );
  root.style.setProperty("--app-glass-blur", `${config.glassBlur}px`);
  root.style.setProperty("--app-surface-opacity", String(surfAlpha));

  // Sync <meta name="theme-color"> so Electron titlebar overlay and mobile browser chrome match
  let themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!themeMeta) {
    themeMeta = document.createElement("meta");
    themeMeta.name = "theme-color";
    document.head.appendChild(themeMeta);
  }
  themeMeta.content = navigatorSolid;

  // Typography & Ink hierarchy
  root.style.setProperty("--fg-base", fg);
  root.style.setProperty("--text", fg);
  root.style.setProperty("--text-secondary", mixHex(fg, bg, isDark ? 0.68 : 0.64));
  root.style.setProperty("--text-tertiary", mixHex(fg, bg, isDark ? 0.46 : 0.48));
  root.style.setProperty("--text-disabled", mixHex(fg, bg, 0.3));

  // Hairline border contrast
  const contrastMult = config.contrast === "high" ? 1.55 : config.contrast === "soft" ? 0.72 : 1;
  root.style.setProperty("--border-subtle", rgbaStr(fg, (isDark ? 0.07 : 0.065) * contrastMult));
  root.style.setProperty("--border", rgbaStr(fg, (isDark ? 0.11 : 0.1) * contrastMult));
  root.style.setProperty("--border-strong", rgbaStr(fg, (isDark ? 0.19 : 0.18) * contrastMult));

  // Accent color & On-Accent contrast
  const accentDef = ACCENT_CHOICES.find((a) => a.id === config.accentId) ?? ACCENT_CHOICES[0]!;
  const resolvedAccent =
    config.accentId === "custom"
      ? normalizeHex(config.customAccent, "#007AFF")
      : config.accentId === "default"
        ? fg
        : isDark
          ? accentDef.darkHex
          : accentDef.lightHex;
  const onAccent = relativeLuminance(resolvedAccent) > 0.42 ? "#121316" : "#FFFFFF";
  const accentHover = isDark
    ? mixHex(resolvedAccent, "#FFFFFF", 0.86)
    : mixHex(resolvedAccent, "#000000", 0.86);

  root.style.setProperty("--control-solid", resolvedAccent);
  root.style.setProperty("--control-solid-hover", accentHover);
  root.style.setProperty("--on-control", onAccent);
  root.style.setProperty("--control-text", resolvedAccent);
  root.style.setProperty("--control-tint", rgbaStr(resolvedAccent, isDark ? 0.14 : 0.08));
  root.style.setProperty("--control-tint-strong", rgbaStr(resolvedAccent, isDark ? 0.22 : 0.14));
  root.style.setProperty("--accent-solid", resolvedAccent);
  root.style.setProperty("--accent-solid-hover", accentHover);
  root.style.setProperty("--on-accent", onAccent);

  // Micro-accent: keep subtle coral when "default" monochrome is selected; otherwise follow user's chosen accent!
  const microAccent =
    config.accentId === "default" ? (isDark ? "#F17561" : "#E6533C") : resolvedAccent;
  root.style.setProperty("--brand-coral", microAccent);
  root.style.setProperty("--brand-coral-tint", rgbaStr(microAccent, isDark ? 0.16 : 0.1));
  root.style.setProperty("--brand-coral-tint-strong", rgbaStr(microAccent, isDark ? 0.24 : 0.18));

  // Font family
  const fontMap: Record<FontChoiceId, { sans: string; display: string }> = {
    system: {
      display:
        '"Segoe UI Variable Display", "SF Pro Display", "PingFang SC", "HarmonyOS Sans SC", -apple-system, BlinkMacSystemFont, sans-serif',
      sans: '"Inter", "SF Pro Text", "Segoe UI Variable Text", "PingFang SC", "HarmonyOS Sans SC", -apple-system, BlinkMacSystemFont, sans-serif',
    },
    sans: {
      display: '"Plus Jakarta Sans", "Inter", "PingFang SC", "Noto Sans SC", system-ui, sans-serif',
      sans: '"Inter", "Plus Jakarta Sans", "PingFang SC", "Noto Sans SC", system-ui, sans-serif',
    },
    serif: {
      display: '"Georgia", "Iowan Old Style", "Source Han Serif SC", "Songti SC", serif',
      sans: '"Charter", "Georgia", "Source Han Serif SC", "Songti SC", serif',
    },
    mono: {
      display: '"JetBrains Mono", "SF Mono", "Cascadia Code", "PingFang SC", monospace',
      sans: '"JetBrains Mono", "SF Mono", "Cascadia Code", "PingFang SC", monospace',
    },
  };
  const fonts = fontMap[config.fontFamily] ?? fontMap.system;
  root.style.setProperty("--font-display", fonts.display);
  root.style.setProperty("--font-sans", fonts.sans);

  // Corner radii
  if (config.radiusStyle === "compact") {
    root.style.setProperty("--radius-control", "7px");
    root.style.setProperty("--radius-row", "8px");
    root.style.setProperty("--radius-card", "10px");
  } else if (config.radiusStyle === "rounded") {
    root.style.setProperty("--radius-control", "12px");
    root.style.setProperty("--radius-row", "13px");
    root.style.setProperty("--radius-card", "18px");
  } else {
    root.style.setProperty("--radius-control", "9px");
    root.style.setProperty("--radius-row", "10px");
    root.style.setProperty("--radius-card", "14px");
  }
}

export function saveAppearance(next: AppearanceConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  applyAppearanceToDom(next);
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: next }));
}

let observerInstalled = false;
export function installAppearanceSync(): void {
  if (typeof document === "undefined" || observerInstalled) return;
  observerInstalled = true;
  applyAppearanceToDom(loadAppearance());
  const obs = new MutationObserver(() => {
    applyAppearanceToDom(loadAppearance());
  });
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
}

export function useAppearance() {
  const [appearance, setAppearanceState] = useState<AppearanceConfig>(() => loadAppearance());

  useEffect(() => {
    installAppearanceSync();
    const onUpdate = () => setAppearanceState(loadAppearance());
    window.addEventListener(CHANGE_EVENT, onUpdate);
    window.addEventListener("storage", onUpdate);
    return () => {
      window.removeEventListener(CHANGE_EVENT, onUpdate);
      window.removeEventListener("storage", onUpdate);
    };
  }, []);

  const updateAppearance = (patch: Partial<AppearanceConfig>) => {
    const merged: AppearanceConfig = { ...loadAppearance(), ...patch };
    setAppearanceState(merged);
    saveAppearance(merged);
  };

  const selectPreset = (presetId: Exclude<AppearancePresetId, "custom">) => {
    const preset = APPEARANCE_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    updateAppearance({
      preset: preset.id,
      accentId: preset.accentId,
      lightBg: preset.lightBg,
      lightFg: preset.lightFg,
      darkBg: preset.darkBg,
      darkFg: preset.darkFg,
    });
  };

  const resetAppearance = () => {
    setAppearanceState(DEFAULT_APPEARANCE);
    saveAppearance(DEFAULT_APPEARANCE);
  };

  return { appearance, updateAppearance, selectPreset, resetAppearance };
}
