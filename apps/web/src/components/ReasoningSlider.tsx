import { useEffect, useId, useMemo, useRef, useState } from "react";

type IntensityTier = "native" | "low" | "mid" | "high" | "peak";

const SVG_W = 300;
const SVG_H = 74;
const PAD_X = 16;
const SPAN_X = SVG_W - PAD_X * 2;
const Y_BASE = 54;
const Y_PEAK = 14;
const RAIL_Y = 64;
const CURVE_SAMPLES = 48;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function resolveIntensityTier(value: string, index: number, totalChoices: number): IntensityTier {
  if (!value || index <= 0) return "native";
  const normalized = value.trim().toLowerCase();
  if (normalized === "minimal" || normalized === "low") return "low";
  if (normalized === "medium" || normalized === "mid") return "mid";
  if (normalized === "high") return "high";
  if (normalized === "xhigh" || normalized === "max") return "peak";
  const ratio = totalChoices > 1 ? index / (totalChoices - 1) : 0;
  if (ratio <= 0.34) return "low";
  if (ratio <= 0.67) return "mid";
  if (ratio < 1) return "high";
  return "peak";
}

function litBarCount(tier: IntensityTier): number {
  switch (tier) {
    case "native":
      return 0;
    case "low":
      return 1;
    case "mid":
      return 2;
    case "high":
      return 3;
    case "peak":
      return 4;
  }
}

function evalCurveY(u: number, focus: number, swell: number): number {
  const s = Math.pow(clamp01(u), 0.92);
  const wave = 0.5 - 0.5 * Math.cos(Math.PI * s);
  const delta = (u - focus) / 0.115;
  const lift = swell * Math.exp(-(delta * delta));
  return Math.max(7, Math.min(Y_BASE + 1, Y_BASE - wave * (Y_BASE - Y_PEAK) - lift));
}

function ratioFromClientX(clientX: number, el: HTMLElement): number {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0) return 0;
  const inset = rect.width * (PAD_X / SVG_W);
  const span = Math.max(1, rect.width - inset * 2);
  return clamp01((clientX - (rect.left + inset)) / span);
}

function nearestIndexForRatio(ratio: number, totalChoices: number): number {
  if (totalChoices <= 1) return 0;
  return Math.max(0, Math.min(totalChoices - 1, Math.round(clamp01(ratio) * (totalChoices - 1))));
}

export function ReasoningSlider({
  levels,
  value,
  onChange,
  onCommit,
  disabled = false,
  label = "思考强度",
}: {
  levels: string[];
  value: string;
  onChange: (value: string) => void;
  onCommit?: (value: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const gradId = `rs-grad-${uid}`;
  const areaGradId = `rs-area-${uid}`;
  const clipId = `rs-clip-${uid}`;

  const choices = ["", ...levels];
  const index = Math.max(0, choices.indexOf(value));
  const snappedRatio = choices.length > 1 ? index / (choices.length - 1) : 0;
  const isDisabled = disabled || levels.length === 0;

  const [dragging, setDragging] = useState(false);
  const [displayRatio, setDisplayRatio] = useState(snappedRatio);
  const [swell, setSwell] = useState(2);

  const displayRatioRef = useRef(snappedRatio);
  const swellRef = useRef(2);
  displayRatioRef.current = displayRatio;
  swellRef.current = swell;

  const pointerActiveRef = useRef(false);
  const lastPreviewIdxRef = useRef(index);
  const ignoreNativeChangeUntilRef = useRef(0);
  const keyboardIndex = useRef<number | null>(null);

  useEffect(() => {
    if (dragging) return;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (reduced) {
      setDisplayRatio(snappedRatio);
      setSwell(2);
      return;
    }

    let raf = 0;
    let lastTs = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(40, Math.max(1, now - lastTs));
      lastTs = now;
      const k = Math.min(1, dt * 0.022);
      const nextRatio = displayRatioRef.current + (snappedRatio - displayRatioRef.current) * k;
      const nextSwell = swellRef.current + (2 - swellRef.current) * k;
      const doneRatio = Math.abs(snappedRatio - nextRatio) < 0.0012;
      const doneSwell = Math.abs(2 - nextSwell) < 0.04;
      setDisplayRatio(doneRatio ? snappedRatio : nextRatio);
      setSwell(doneSwell ? 2 : nextSwell);
      if (!doneRatio || !doneSwell) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [snappedRatio, dragging]);

  const activeIdx = dragging ? nearestIndexForRatio(displayRatio, choices.length) : index;
  const activeValue = choices[activeIdx] ?? value;
  const tier = resolveIntensityTier(activeValue, activeIdx, choices.length);
  const litBars = litBarCount(tier);

  const { linePath, areaPath, knobX, knobY, stops } = useMemo(() => {
    const pts: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= CURVE_SAMPLES; i++) {
      const u = i / CURVE_SAMPLES;
      pts.push({
        x: PAD_X + u * SPAN_X,
        y: evalCurveY(u, displayRatio, swell),
      });
    }
    const line = pts
      .map((pt, i) => `${i === 0 ? "M" : "L"}${pt.x.toFixed(2)},${pt.y.toFixed(2)}`)
      .join(" ");
    const first = pts[0]!;
    const last = pts[pts.length - 1]!;
    const area = `${line} L${last.x.toFixed(2)},${RAIL_Y} L${first.x.toFixed(2)},${RAIL_Y} Z`;

    const kx = PAD_X + displayRatio * SPAN_X;
    const ky = evalCurveY(displayRatio, displayRatio, swell);

    const stopNodes = choices.map((choice, stopIdx) => {
      const u = choices.length > 1 ? stopIdx / (choices.length - 1) : 0;
      return {
        key: choice || "__native__",
        u,
        x: PAD_X + u * SPAN_X,
        y: evalCurveY(u, displayRatio, swell),
        passed: u <= displayRatio + 0.001,
        current: stopIdx === activeIdx,
      };
    });

    return { linePath: line, areaPath: area, knobX: kx, knobY: ky, stops: stopNodes };
  }, [displayRatio, swell, choices, activeIdx]);

  const pct = Math.round(displayRatio * 1000) / 10;

  const commitKeyboard = () => {
    if (keyboardIndex.current === null) return;
    onCommit?.(choices[keyboardIndex.current] ?? "");
    keyboardIndex.current = null;
  };

  return (
    <div
      className={`reasoning-slider ${isDisabled ? "is-disabled" : ""} ${dragging ? "is-dragging" : ""}`}
      data-intensity={tier}
      style={{ "--slider-pct": `${pct}%`, "--stops": choices.length } as React.CSSProperties}
    >
      <div className="reasoning-slider__heading">
        <div className="reasoning-slider__title">
          <span>思考强度</span>
          <span className="reasoning-slider__bars" aria-hidden="true">
            {[0, 1, 2, 3].map((barIdx) => (
              <i key={barIdx} className={barIdx < litBars ? "is-lit" : ""} />
            ))}
          </span>
        </div>
        <strong className={`reasoning-slider__value is-${tier}`}>{activeValue || "原生"}</strong>
      </div>

      <div className="reasoning-slider__stage">
        <svg
          className="reasoning-slider__svg"
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#634ce6" />
              <stop offset="52%" stopColor="#9458f5" />
              <stop offset="100%" stopColor="#df553e" />
            </linearGradient>
            <linearGradient id={areaGradId} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="var(--fader-accent)" stopOpacity="0.34" />
              <stop offset="65%" stopColor="var(--fader-accent)" stopOpacity="0.1" />
              <stop offset="100%" stopColor="var(--fader-accent)" stopOpacity="0" />
            </linearGradient>
            <clipPath id={clipId}>
              <rect x="0" y="0" width={Math.max(0, knobX)} height={SVG_H} />
            </clipPath>
          </defs>

          <line
            x1={PAD_X}
            y1="22"
            x2={SVG_W - PAD_X}
            y2="22"
            className="reasoning-slider__gridline"
          />
          <line
            x1={PAD_X}
            y1="40"
            x2={SVG_W - PAD_X}
            y2="40"
            className="reasoning-slider__gridline"
          />

          <path d={linePath} className="reasoning-slider__curve-ghost" />

          <g clipPath={`url(#${clipId})`}>
            <path d={areaPath} fill={`url(#${areaGradId})`} />
            <path
              d={linePath}
              stroke={`url(#${gradId})`}
              className="reasoning-slider__curve-glow"
            />
            <path
              d={linePath}
              stroke={`url(#${gradId})`}
              className="reasoning-slider__curve-active"
            />
          </g>

          {stops.map((s) => (
            <g key={s.key}>
              <line
                x1={s.x}
                y1={s.y + 4}
                x2={s.x}
                y2={RAIL_Y}
                className={`reasoning-slider__stem ${s.current ? "is-current" : ""}`}
              />
              <circle
                cx={s.x}
                cy={s.y}
                r={s.current ? 3.2 : 2.3}
                className={`reasoning-slider__node ${s.passed ? "is-passed" : ""} ${
                  s.current ? "is-current" : ""
                }`}
              />
            </g>
          ))}

          <line
            x1={knobX}
            y1={knobY + 4}
            x2={knobX}
            y2={RAIL_Y}
            stroke={`url(#${gradId})`}
            className="reasoning-slider__plumb"
          />
          <circle
            cx={knobX}
            cy={knobY}
            r={dragging ? 10 : 7.5}
            className="reasoning-slider__orb-halo"
          />
          <circle cx={knobX} cy={knobY} r="4.2" className="reasoning-slider__orb" />
        </svg>

        <div className="reasoning-slider__rail" aria-hidden="true">
          <div className="reasoning-slider__fill" style={{ width: `${pct}%` }} />
          <span className="reasoning-slider__cap" style={{ left: `${pct}%` }}>
            <span className="reasoning-slider__cap-notch" />
          </span>
        </div>

        <input
          type="range"
          aria-label={label}
          min={0}
          max={Math.max(0, choices.length - 1)}
          step={1}
          value={activeIdx}
          disabled={isDisabled}
          onPointerDown={(event) => {
            if (isDisabled) return;
            pointerActiveRef.current = true;
            try {
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
              // Synthetic events without an active pointer ID do not require capture.
            }
            const ratio = ratioFromClientX(event.clientX, event.currentTarget);
            const nearest = nearestIndexForRatio(ratio, choices.length);
            lastPreviewIdxRef.current = nearest;
            setDragging(true);
            setSwell(5.5);
            setDisplayRatio(ratio);
            if ((choices[nearest] ?? "") !== value) {
              onChange(choices[nearest] ?? "");
            }
          }}
          onPointerMove={(event) => {
            if (!pointerActiveRef.current || isDisabled) return;
            const ratio = ratioFromClientX(event.clientX, event.currentTarget);
            setDisplayRatio(ratio);
            const nearest = nearestIndexForRatio(ratio, choices.length);
            if (nearest !== lastPreviewIdxRef.current) {
              lastPreviewIdxRef.current = nearest;
              onChange(choices[nearest] ?? "");
            }
          }}
          onPointerUp={(event) => {
            if (!pointerActiveRef.current) return;
            pointerActiveRef.current = false;
            ignoreNativeChangeUntilRef.current = performance.now() + 80;
            try {
              if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            } catch {
              // Ignore if capture already released.
            }
            const ratio = ratioFromClientX(event.clientX, event.currentTarget);
            const nearest = nearestIndexForRatio(ratio, choices.length);
            const chosen = choices[nearest] ?? "";
            setDragging(false);
            setDisplayRatio(ratio);
            onChange(chosen);
            onCommit?.(chosen);
          }}
          onPointerCancel={() => {
            pointerActiveRef.current = false;
            setDragging(false);
          }}
          onChange={(event) => {
            if (pointerActiveRef.current) return;
            if (performance.now() < ignoreNativeChangeUntilRef.current) return;
            onChange(choices[Number(event.target.value)] ?? "");
          }}
          onKeyDown={(event) => {
            const current = keyboardIndex.current ?? index;
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? choices.length - 1
                  : event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "PageUp"
                    ? Math.min(choices.length - 1, current + 1)
                    : event.key === "ArrowLeft" ||
                        event.key === "ArrowDown" ||
                        event.key === "PageDown"
                      ? Math.max(0, current - 1)
                      : null;
            if (next === null) return;
            event.preventDefault();
            keyboardIndex.current = next;
            onChange(choices[next] ?? "");
          }}
          onKeyUp={commitKeyboard}
          onBlur={() => {
            pointerActiveRef.current = false;
            setDragging(false);
            commitKeyboard();
          }}
        />
      </div>

      <div className="reasoning-slider__scale">
        {choices.map((choice, stopIdx) => (
          <button
            key={choice || "__native__"}
            type="button"
            tabIndex={-1}
            disabled={isDisabled}
            className={`reasoning-slider__stop ${stopIdx === activeIdx ? "is-active" : ""}`}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              if (isDisabled) return;
              keyboardIndex.current = null;
              pointerActiveRef.current = false;
              setDragging(false);
              onChange(choice);
              onCommit?.(choice);
            }}
          >
            {choice || "原生"}
          </button>
        ))}
      </div>
    </div>
  );
}
