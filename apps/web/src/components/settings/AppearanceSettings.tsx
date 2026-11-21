import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  Copy,
  Download,
  Monitor,
  Moon,
  Palette,
  RotateCcw,
  Sun,
} from "lucide-react";
import type { AppSettings } from "@kodo/protocol";
import {
  ACCENT_CHOICES,
  APPEARANCE_PRESETS,
  DEFAULT_APPEARANCE,
  normalizeHex,
  useAppearance,
  type AppearanceConfig,
  type ContrastChoiceId,
  type FontChoiceId,
  type RadiusChoiceId,
} from "../../lib/appearance";
import { useAppPreferences } from "../../lib/preferences";
import { HarnessBadge } from "../KooyuBrand";
import { Toggle } from "./SettingsKit";

function ColorTileEditor({
  title,
  value,
  onChange,
}: {
  title: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);

  const commit = (raw: string) => {
    const normalized = normalizeHex(raw, value);
    setText(normalized);
    if (normalized !== value) onChange(normalized);
  };

  return (
    <div className="ap-color-tile">
      <label className="ap-color-tile__swatch" title={`选择${title}`}>
        <input
          type="color"
          aria-label={`${title}取色器`}
          value={normalizeHex(value, "#FFFFFF")}
          onChange={(e) => {
            const next = e.target.value.toUpperCase();
            setText(next);
            onChange(next);
          }}
        />
        <span
          className="ap-color-tile__dot"
          style={{ background: normalizeHex(value, "#FFFFFF") }}
        />
      </label>
      <div className="ap-color-tile__meta">
        <span className="ap-color-tile__title">{title}</span>
        <input
          type="text"
          className="ap-color-tile__hex"
          aria-label={`${title}色值`}
          maxLength={7}
          value={text}
          onChange={(e) => {
            const v = e.target.value;
            setText(v);
            if (/^#?[0-9a-fA-F]{6}$/.test(v.trim())) {
              onChange(normalizeHex(v, value));
            }
          }}
          onBlur={() => commit(text)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(text);
            }
          }}
        />
      </div>
    </div>
  );
}

export function AppearanceSettings() {
  const { settings, save } = useAppPreferences();
  const { appearance, updateAppearance, selectPreset, resetAppearance } = useAppearance();
  const [copied, setCopied] = useState(false);
  const [importNotice, setImportNotice] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isDark, setIsDark] = useState(() =>
    typeof document !== "undefined" ? document.documentElement.classList.contains("dark") : false,
  );

  useEffect(() => {
    if (typeof document === "undefined") return;
    const sync = () => setIsDark(document.documentElement.classList.contains("dark"));
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  const setThemeMode = (mode: AppSettings["theme"]) => {
    const mediaDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const nextDark = mode === "dark" || (mode === "system" && mediaDark);
    document.documentElement.classList.toggle("dark", nextDark);
    localStorage.setItem("kodo.theme", nextDark ? "dark" : "light");
    setIsDark(nextDark);
    if (settings.theme !== mode) {
      void save({ ...settings, theme: mode }).catch(() => {});
    }
  };

  const activeBg = isDark ? appearance.darkBg : appearance.lightBg;
  const activeFg = isDark ? appearance.darkFg : appearance.lightFg;

  const handleCopyTheme = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(appearance, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  const handleImportFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as Partial<AppearanceConfig>;
        updateAppearance({ ...parsed, preset: parsed.preset ?? "custom" });
        setImportNotice("已导入外观配置");
        setTimeout(() => setImportNotice(""), 2200);
      } catch {
        setImportNotice("JSON 格式无效");
        setTimeout(() => setImportNotice(""), 2500);
      }
    };
    reader.readAsText(file);
  };

  const isModified = JSON.stringify(appearance) !== JSON.stringify(DEFAULT_APPEARANCE);

  return (
    <div className="ap-studio">
      <header className="ap-studio__header">
        <h1>外观</h1>
        <div className="ap-studio__header-actions">
          {importNotice && <span className="ap-studio__toast">{importNotice}</span>}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(e) => {
              handleImportFile(e.target.files?.[0]);
              e.currentTarget.value = "";
            }}
          />
          <button
            type="button"
            className="ap-action-pill"
            title="导入外观 JSON"
            aria-label="导入主题 JSON"
            onClick={() => fileInputRef.current?.click()}
          >
            <Download size={13} />
            <span>导入</span>
          </button>
          <button
            type="button"
            className={`ap-action-pill ${copied ? "is-done" : ""}`}
            title="导出当前外观 JSON"
            aria-label="复制当前主题配置"
            onClick={() => void handleCopyTheme()}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            <span>{copied ? "已复制" : "导出"}</span>
          </button>
          {isModified && (
            <button
              type="button"
              className="ap-action-pill ap-action-pill--reset"
              onClick={() => resetAppearance()}
            >
              <RotateCcw size={13} />
              <span>恢复默认外观</span>
            </button>
          )}
        </div>
      </header>

      {/* 1. Original Kooyu Live Conversation Stage + 3-Segment Mode Bar */}
      <section className="ap-preview-stage" aria-label="实时外观预览与亮暗模式">
        <div className="ap-preview-stage__ambient">
          <div className="ap-preview-window">
            <div className="ap-preview-window__bar">
              <HarnessBadge harnessId="kodo" size="xs" shape="squircle" />
              <strong>Kooyu 实时质感预览</strong>
              <span className="ap-preview-window__tag">
                毛玻璃 {appearance.glassOpacity}% · 模糊 {appearance.glassBlur}px
              </span>
            </div>
            <div className="ap-preview-window__body">
              <div className="ap-preview-bubble">帮我保持清爽克制的留白与代码阅读层次。</div>
              <div className="ap-preview-reply">
                <HarnessBadge harnessId="claude-code" size="xs" shape="squircle" />
                <span>
                  已实时同步当前 <code>{activeBg}</code> 画布与点缀色阶。
                </span>
                <span className="ap-preview-send" aria-hidden="true">
                  <ArrowUp size={12} strokeWidth={2.5} />
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="ap-mode-bar" role="radiogroup" aria-label="外观模式选择">
          {(
            [
              ["system", "跟随系统", Monitor],
              ["light", "日光浅色", Sun],
              ["dark", "曜石深色", Moon],
            ] as const
          ).map(([mode, label, Icon]) => {
            const active = settings.theme === mode;
            return (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={active}
                className={`ap-mode-pill ${active ? "is-active" : ""}`}
                onClick={() => setThemeMode(mode)}
              >
                <Icon size={14} aria-hidden="true" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* 2. Visual Palette Swatch Cards (预设画板) */}
      <section className="ap-section" aria-label="预设意境画板">
        <div className="ap-section__head">
          <h2>预设画板</h2>
        </div>
        <div className="ap-palette-grid" role="listbox" aria-label="预设主题">
          {APPEARANCE_PRESETS.map((p) => {
            const selected = appearance.preset === p.id;
            const bg = isDark ? p.darkBg : p.lightBg;
            const fg = isDark ? p.darkFg : p.lightFg;
            const accentHex =
              ACCENT_CHOICES.find((a) => a.id === p.accentId)?.lightHex ?? "#141518";
            return (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={selected}
                data-preset={p.id}
                className={`ap-palette-card ${selected ? "is-selected" : ""}`}
                onClick={() => selectPreset(p.id)}
              >
                <span
                  className="ap-palette-medallion"
                  style={{
                    background: `linear-gradient(135deg, ${bg} 50%, ${fg} 50%)`,
                  }}
                  aria-hidden="true"
                >
                  <i style={{ background: accentHex }} />
                </span>
                <strong>{p.label}</strong>
              </button>
            );
          })}
        </div>
      </section>

      {/* 3. Tactile Color Studio (强调色 + 画布/字色双栏) */}
      <section className="ap-card ap-color-studio" aria-label="色彩精调">
        <div className="ap-color-studio__accents">
          <div className="ap-row__label">
            <strong>强调色</strong>
          </div>
          <div className="ap-swatch-strip" role="radiogroup" aria-label="强调色">
            {ACCENT_CHOICES.filter((a) => a.id !== "custom").map((item) => {
              const dot = isDark ? item.darkHex : item.lightHex;
              const picked = appearance.accentId === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={picked}
                  aria-label={item.label}
                  title={item.label}
                  className={`ap-swatch-btn ${picked ? "is-picked" : ""}`}
                  onClick={() => updateAppearance({ accentId: item.id, preset: "custom" })}
                >
                  <span className="ap-swatch-btn__dot" style={{ background: dot }}>
                    {picked && (
                      <Check
                        size={12}
                        strokeWidth={2.6}
                        color={isDark && item.id === "default" ? "#121316" : "#FFFFFF"}
                      />
                    )}
                  </span>
                </button>
              );
            })}
            <label
              className={`ap-swatch-btn ap-swatch-btn--custom ${
                appearance.accentId === "custom" ? "is-picked" : ""
              }`}
              title="自定义强调色"
            >
              <input
                type="color"
                aria-label="自定义强调色"
                value={normalizeHex(appearance.customAccent, "#007AFF")}
                onChange={(e) =>
                  updateAppearance({
                    accentId: "custom",
                    customAccent: e.target.value.toUpperCase(),
                    preset: "custom",
                  })
                }
              />
              <span
                className="ap-swatch-btn__dot"
                style={{
                  background:
                    appearance.accentId === "custom"
                      ? appearance.customAccent
                      : "conic-gradient(#ff5e62, #ff9966, #36d1dc, #5b86e5, #a18cd1, #ff5e62)",
                }}
              >
                <Palette size={12} color="#FFFFFF" />
              </span>
            </label>
          </div>
        </div>

        <div className="ap-color-pair-grid">
          <ColorTileEditor
            title="画布底色"
            value={activeBg}
            onChange={(hex) =>
              updateAppearance(
                isDark ? { darkBg: hex, preset: "custom" } : { lightBg: hex, preset: "custom" },
              )
            }
          />
          <ColorTileEditor
            title="正文字色"
            value={activeFg}
            onChange={(hex) =>
              updateAppearance(
                isDark ? { darkFg: hex, preset: "custom" } : { lightFg: hex, preset: "custom" },
              )
            }
          />
        </div>
      </section>

      {/* 4. Liquid Glass & Depth Sliders */}
      <section className="ap-card" aria-label="液态毛玻璃与通透感">
        <div className="ap-row">
          <div className="ap-row__label">
            <strong>毛玻璃通透度</strong>
          </div>
          <div className="ap-row__controls ap-row__controls--slider">
            <input
              type="range"
              aria-label="毛玻璃透明度"
              min={45}
              max={98}
              step={1}
              value={appearance.glassOpacity}
              onChange={(e) => updateAppearance({ glassOpacity: Number(e.target.value) })}
            />
            <span className="ap-value-pill">{appearance.glassOpacity}%</span>
          </div>
        </div>

        <div className="ap-row">
          <div className="ap-row__label">
            <strong>面板不透明度</strong>
          </div>
          <div className="ap-row__controls ap-row__controls--slider">
            <input
              type="range"
              aria-label="面板不透明度"
              min={60}
              max={100}
              step={1}
              value={appearance.surfaceOpacity}
              onChange={(e) => updateAppearance({ surfaceOpacity: Number(e.target.value) })}
            />
            <span className="ap-value-pill">{appearance.surfaceOpacity}%</span>
          </div>
        </div>

        <div className="ap-row">
          <div className="ap-row__label">
            <strong>背景模糊半径</strong>
          </div>
          <div className="ap-row__controls ap-row__controls--slider">
            <input
              type="range"
              aria-label="背景模糊半径"
              min={0}
              max={40}
              step={2}
              value={appearance.glassBlur}
              onChange={(e) => updateAppearance({ glassBlur: Number(e.target.value) })}
            />
            <span className="ap-value-pill">{appearance.glassBlur} px</span>
          </div>
        </div>
      </section>

      {/* 5. Typography & Geometry */}
      <section className="ap-card" aria-label="排版与几何细节">
        <div className="ap-row ap-row--wrap">
          <div className="ap-row__label">
            <strong>字体</strong>
          </div>
          <div className="ap-seg-pills" role="radiogroup" aria-label="界面字体">
            {(
              [
                ["system", "系统原生"],
                ["sans", "现代无衬线"],
                ["serif", "人文衬线"],
                ["mono", "极客等宽"],
              ] as Array<[FontChoiceId, string]>
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={appearance.fontFamily === id}
                className={`ap-seg-pill ${appearance.fontFamily === id ? "is-active" : ""}`}
                onClick={() => updateAppearance({ fontFamily: id })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="ap-row ap-row--wrap">
          <div className="ap-row__label">
            <strong>圆角</strong>
          </div>
          <div className="ap-seg-pills" role="radiogroup" aria-label="圆角风格">
            {(
              [
                ["compact", "紧凑"],
                ["standard", "标准"],
                ["rounded", "圆润"],
              ] as Array<[RadiusChoiceId, string]>
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={appearance.radiusStyle === id}
                className={`ap-seg-pill ${appearance.radiusStyle === id ? "is-active" : ""}`}
                onClick={() => updateAppearance({ radiusStyle: id })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="ap-row ap-row--wrap">
          <div className="ap-row__label">
            <strong>描边对比</strong>
          </div>
          <div className="ap-seg-pills" role="radiogroup" aria-label="边框对比度">
            {(
              [
                ["soft", "柔和"],
                ["standard", "标准"],
                ["high", "高对比"],
              ] as Array<[ContrastChoiceId, string]>
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={appearance.contrast === id}
                className={`ap-seg-pill ${appearance.contrast === id ? "is-active" : ""}`}
                onClick={() => updateAppearance({ contrast: id })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="ap-row">
          <div className="ap-row__label">
            <strong>减少动态效果</strong>
          </div>
          <div className="ap-row__controls">
            <Toggle
              label="减少动态效果（外观工坊）"
              checked={settings.reduceMotion}
              onChange={(v) => {
                document.documentElement.dataset.reduceMotion = String(v);
                void save({ ...settings, reduceMotion: v }).catch(() => {});
              }}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
