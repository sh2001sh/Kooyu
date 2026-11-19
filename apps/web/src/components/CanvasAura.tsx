import { useEffect, useState, type CSSProperties } from "react";
import type { HarnessId } from "@kodo/protocol";
import { HARNESS_VISUALS } from "../lib/harnesses";

/**
 * Pure-CSS feathered ambient light wash for empty draft & conversation canvases.
 * Zero idle CPU (no requestAnimationFrame canvas loop) and seamless edge blending
 * in both light (#FFFFFF) and dark (#121316) themes.
 */
export function CanvasAura({
  harnessId = "kodo",
  intensity = 1,
}: {
  harnessId?: HarnessId;
  intensity?: number;
}) {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));

  useEffect(() => {
    const target = document.documentElement;
    const sync = () => setDark(target.classList.contains("dark"));
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(target, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  const visual = HARNESS_VISUALS[harnessId];
  const clamped = Math.max(0, Math.min(1.25, intensity));

  return (
    <div
      className="canvas-aura"
      aria-hidden="true"
      style={
        {
          "--aura-accent": dark ? visual.darkInk : visual.ink,
          "--aura-intensity": clamped,
        } as CSSProperties
      }
    >
      <div className="canvas-aura__wash" />
    </div>
  );
}
