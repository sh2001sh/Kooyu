import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Accessible name when it differs from the visible label. */
  ariaLabel?: string;
  title?: string;
}

/**
 * Sliding-pill segmented control (§3.2.2). Segments stay real buttons with aria-pressed, so
 * existing role queries keep working; a single thumb element slides under the active segment
 * on the --spring-snap curve instead of the background flashing between buttons.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className = "",
  size = "md",
}: {
  options: SegmentedOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);
  const [ready, setReady] = useState(false);
  const activeIndex = options.findIndex((option) => option.value === value);

  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const measure = () => {
      const button = track.querySelectorAll<HTMLButtonElement>(":scope > button")[activeIndex];
      setThumb(button ? { x: button.offsetLeft, w: button.offsetWidth } : null);
    };
    measure();
    let raf = 0;
    if (!ready) {
      raf = requestAnimationFrame(() => setReady(true));
    }
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [activeIndex, options.length, ready]);

  return (
    <div
      ref={trackRef}
      className={`segmented segmented--${size} ${className}`.trim()}
      role="group"
      aria-label={ariaLabel}
      data-active-index={activeIndex}
      style={{ "--segments": options.length } as CSSProperties}
    >
      <span
        className="segmented__thumb"
        aria-hidden="true"
        data-visible={thumb ? "true" : "false"}
        data-ready={ready ? "true" : "false"}
        style={
          thumb
            ? ({ "--thumb-x": `${thumb.x}px`, "--thumb-w": `${thumb.w}px` } as CSSProperties)
            : undefined
        }
      />
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            type="button"
            key={option.value}
            className={active ? "active" : ""}
            aria-pressed={active}
            aria-label={option.ariaLabel}
            title={option.title}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
