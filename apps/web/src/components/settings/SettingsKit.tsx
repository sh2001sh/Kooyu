import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { useT } from "../../lib/i18n";

/**
 * Shared building blocks for every settings page, so all pages share one layout:
 * a page header, titled sections, and rows of label + description + control.
 */
export function SettingsPage({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="sx-page">
      <header className="sx-page__head">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {actions && <div className="sx-page__actions">{actions}</div>}
      </header>
      {children}
    </div>
  );
}

export function SettingsSection({
  title,
  description,
  actions,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="sx-section">
      <div className="sx-section__head">
        <div>
          <h3>{title}</h3>
          {description && <p>{description}</p>}
        </div>
        {actions && <div className="sx-section__actions">{actions}</div>}
      </div>
      <div className="sx-card">{children}</div>
    </section>
  );
}

export function SettingsRow({
  label,
  description,
  children,
  htmlFor,
  stacked = false,
}: {
  label: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  htmlFor?: string;
  /** Put the control under the label (for wide inputs such as text areas). */
  stacked?: boolean;
}) {
  return (
    <div className={`sx-row ${stacked ? "sx-row--stacked" : ""}`}>
      <div className="sx-row__text">
        {htmlFor ? (
          <label className="sx-row__label" htmlFor={htmlFor}>
            {label}
          </label>
        ) : (
          <span className="sx-row__label">{label}</span>
        )}
        {description && <span className="sx-row__desc">{description}</span>}
      </div>
      {children !== undefined && <div className="sx-row__control">{children}</div>}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`sx-toggle ${checked ? "is-on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="sx-toggle__knob" aria-hidden="true" />
    </button>
  );
}

export function StatusDot({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "off" | "busy";
  children: ReactNode;
}) {
  return (
    <span className={`sx-status is-${tone}`}>
      <span className="sx-status__dot" aria-hidden="true" />
      {children}
    </span>
  );
}

/** A save bar shown only when there are unsaved changes. */
export function SaveBar({
  dirty,
  busy,
  saved,
  error,
  onReset,
}: {
  dirty: boolean;
  busy: boolean;
  saved?: boolean;
  error?: string;
  onReset: () => void;
}) {
  const t = useT();
  if (!dirty && !saved && !error) return null;
  return (
    <div className={`sx-savebar ${error ? "is-error" : ""}`} role="status">
      <span>{error ? error : dirty ? t("save.unsaved") : t("save.saved")}</span>
      {dirty && (
        <>
          <button type="button" onClick={onReset} disabled={busy}>
            {t("save.reset")}
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? t("save.saving") : t("save.save")}
          </button>
        </>
      )}
    </div>
  );
}

export interface SxSelectOption<T extends string | number = string> {
  value: T;
  label: string;
  hint?: string;
  disabled?: boolean;
}

export function SxSelect<T extends string | number = string>({
  id,
  value,
  onChange,
  options,
  ariaLabel,
  disabled = false,
  compact = false,
  align = "auto",
  className = "",
  style,
}: {
  id?: string;
  value: T;
  onChange: (value: T) => void;
  options: SxSelectOption<T>[];
  ariaLabel?: string;
  disabled?: boolean;
  compact?: boolean;
  align?: "left" | "right" | "auto";
  className?: string;
  style?: CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<"top" | "bottom">("bottom");
  const [resolvedAlign, setResolvedAlign] = useState<"left" | "right">("right");
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedOption = options.find((opt) => String(opt.value) === String(value)) ?? options[0];

  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    setSide(spaceBelow < 280 && spaceAbove > spaceBelow ? "top" : "bottom");

    if (align === "auto") {
      const centerX = rect.left + rect.width / 2;
      setResolvedAlign(centerX > window.innerWidth / 2 ? "right" : "left");
    } else {
      setResolvedAlign(align);
    }
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div
      ref={containerRef}
      className={`sx-select-container ${compact ? "sx-select--compact" : ""} ${open ? "is-open" : ""} ${className}`}
      style={style}
    >
      <select
        id={id}
        aria-label={ariaLabel}
        value={String(value)}
        disabled={disabled}
        className="sx-select-native"
        tabIndex={-1}
        onChange={(e) => {
          const matched = options.find((opt) => String(opt.value) === e.target.value);
          if (matched) onChange(matched.value);
        }}
      >
        {options.map((opt) => (
          <option key={String(opt.value)} value={String(opt.value)} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
      </select>

      <button
        ref={triggerRef}
        type="button"
        id={id ? `${id}-btn` : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        className={`sx-select-trigger ${compact ? "sx-select--compact" : ""} ${open ? "is-open" : ""}`}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="sx-select-value">{selectedOption?.label ?? String(value)}</span>
        <ChevronDown
          size={compact ? 12 : 14}
          className={`sx-select-chevron ${open ? "is-open" : ""}`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className={`sx-select-menu sx-select-menu--side-${side} sx-select-menu--align-${resolvedAlign}`}
        >
          {options.map((opt) => {
            const isSelected = String(opt.value) === String(value);
            return (
              <button
                type="button"
                key={String(opt.value)}
                role="option"
                aria-selected={isSelected}
                disabled={opt.disabled}
                className={`sx-select-item ${isSelected ? "is-selected" : ""} ${opt.disabled ? "is-disabled" : ""}`}
                onClick={() => {
                  if (opt.disabled) return;
                  onChange(opt.value);
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
              >
                <div className="sx-select-item__content">
                  <span className="sx-select-item__label">{opt.label}</span>
                  {opt.hint && <span className="sx-select-item__hint">{opt.hint}</span>}
                </div>
                {isSelected && <Check size={14} className="sx-select-item__check" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
