import { useEffect, useRef, useState } from "react";
import type { HarnessId } from "@kodo/protocol";
import { HARNESS_VISUALS } from "../lib/harnesses";

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "").trim();
  if (clean.length !== 6) return `rgba(128, 128, 138, ${alpha})`;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Interactive architectural art canvas layer:
 * couples curated studio 3D glass sculpture imagery with a live DPI-scaled
 * parametric harmonic field & cursor-responsive chromatic light wash.
 */
export function CanvasAura({
  harnessId = "kodo",
  intensity = 1,
}: {
  harnessId?: HarnessId;
  intensity?: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointerRef = useRef({ x: 0.5, y: 0.42, tx: 0.5, ty: 0.42, active: false });
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const [imgReady, setImgReady] = useState(true);

  useEffect(() => {
    const target = document.documentElement;
    const sync = () => setDark(target.classList.contains("dark"));
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(target, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    setImgReady(true);
  }, [dark]);

  useEffect(() => {
    const host = hostRef.current?.parentElement ?? hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const visual = HARNESS_VISUALS[harnessId];
    const accentHex = dark ? visual.darkInk : visual.ink;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let raf = 0;
    let phase = 0.8;

    const nodes = Array.from({ length: 22 }, (_, i) => ({
      angle: (i / 22) * Math.PI * 2,
      radiusScale: 0.14 + ((i * 37) % 100) / 280,
      speed: (i % 2 === 0 ? 1 : -1) * (0.0007 + (i % 5) * 0.00025),
      size: 1 + (i % 3) * 0.55,
      depth: 0.5 + (i % 4) * 0.25,
    }));

    const resize = () => {
      const rect = host.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, Math.floor(rect.width));
      height = Math.max(1, Math.floor(rect.height));
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const drawFrame = (t: number) => {
      const p = pointerRef.current;
      p.x += (p.tx - p.x) * 0.065;
      p.y += (p.ty - p.y) * 0.065;

      if (hostRef.current) {
        hostRef.current.style.setProperty("--px", ((p.x - 0.5) * 26).toFixed(2));
        hostRef.current.style.setProperty("--py", ((p.y - 0.42) * 20).toFixed(2));
      }

      ctx.clearRect(0, 0, width, height);

      const minDim = Math.min(width, height);
      const cx = width * (0.5 + (p.x - 0.5) * 0.06);
      const cy = height * (0.4 + (p.y - 0.42) * 0.06);

      // Ambient refractive caustic glow anchored to Harness spectrum
      const glowRadius = minDim * (0.44 * intensity);
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius);
      glow.addColorStop(0, hexToRgba(accentHex, (dark ? 0.16 : 0.1) * intensity));
      glow.addColorStop(0.5, hexToRgba(accentHex, (dark ? 0.05 : 0.03) * intensity));
      glow.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);

      // Parametric architectural hairline ribbons
      const ribbonCount = 3;
      for (let r = 0; r < ribbonCount; r++) {
        ctx.beginPath();
        const baseY = cy + (r - 1) * minDim * 0.042;
        const amp = minDim * (0.026 + r * 0.011);
        const freq = 0.0055 + r * 0.0014;
        const speed = t * (0.38 + r * 0.12) + r * 1.3;
        const influenceX = p.x * width;
        const influenceY = p.y * height;

        for (let x = 0; x <= width; x += 12) {
          const dx = x - influenceX;
          const dist = Math.hypot(dx, baseY - influenceY);
          const pull =
            Math.exp(-(dist * dist) / (minDim * minDim * 0.14)) * (influenceY - baseY) * 0.24;
          const edgeFade = Math.sin((x / width) * Math.PI);
          const y =
            baseY +
            Math.sin(x * freq + speed) * amp * edgeFade +
            Math.cos(x * freq * 0.5 - speed * 0.7) * (amp * 0.35) * edgeFade +
            pull * edgeFade;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }

        const strokeAlpha = (dark ? 0.14 - r * 0.03 : 0.095 - r * 0.022) * intensity;
        ctx.strokeStyle =
          r === 0
            ? hexToRgba(accentHex, strokeAlpha * 1.45)
            : dark
              ? `rgba(244, 244, 246, ${strokeAlpha})`
              : `rgba(17, 19, 23, ${strokeAlpha})`;
        ctx.lineWidth = r === 0 ? 1.1 : 0.8;
        ctx.stroke();
      }

      // Precision architectural concentric arcs
      const ringAlpha = (dark ? 0.07 : 0.055) * intensity;
      ctx.lineWidth = 0.75;
      for (let k = 0; k < 2; k++) {
        const radius = minDim * (0.19 + k * 0.12);
        const start = t * (k === 0 ? 0.14 : -0.1) + k * 1.4;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, start, start + Math.PI * 1.35);
        ctx.strokeStyle =
          k === 0
            ? hexToRgba(accentHex, ringAlpha * 1.8)
            : dark
              ? `rgba(255, 255, 255, ${ringAlpha})`
              : `rgba(17, 19, 23, ${ringAlpha})`;
        ctx.stroke();
      }

      // Laminar optical nodes
      for (const n of nodes) {
        n.angle += n.speed * (reducedMotion ? 0 : 1);
        const rx = minDim * n.radiusScale * 1.45;
        const ry = minDim * n.radiusScale * 0.72;
        const nx = cx + Math.cos(n.angle + t * 0.05 * n.depth) * rx;
        const ny = cy + Math.sin(n.angle + t * 0.05 * n.depth) * ry;
        const alpha = (dark ? 0.28 : 0.18) * intensity * n.depth;
        ctx.beginPath();
        ctx.arc(nx, ny, n.size, 0, Math.PI * 2);
        ctx.fillStyle =
          n.depth > 0.9
            ? hexToRgba(accentHex, alpha * 1.3)
            : dark
              ? `rgba(255, 255, 255, ${alpha})`
              : `rgba(17, 19, 23, ${alpha})`;
        ctx.fill();
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      pointerRef.current.tx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      pointerRef.current.ty = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      pointerRef.current.active = true;
    };

    const onPointerLeave = () => {
      pointerRef.current.tx = 0.5;
      pointerRef.current.ty = 0.42;
      pointerRef.current.active = false;
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    host.addEventListener("pointermove", onPointerMove, { passive: true });
    host.addEventListener("pointerleave", onPointerLeave, { passive: true });

    if (reducedMotion) {
      drawFrame(phase);
    } else {
      let last = performance.now();
      const tick = (now: number) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        phase += dt;
        drawFrame(phase);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }

    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerleave", onPointerLeave);
    };
  }, [harnessId, dark, intensity]);

  const visual = HARNESS_VISUALS[harnessId];
  const imgSrc = dark ? "/art/prism-obsidian.jpg" : "/art/prism-alabaster.jpg";

  return (
    <div
      ref={hostRef}
      className="canvas-aura"
      aria-hidden="true"
      style={{ "--aura-accent": dark ? visual.darkInk : visual.ink } as React.CSSProperties}
    >
      {imgReady && (
        <img
          src={imgSrc}
          alt=""
          className="canvas-aura__sculpture"
          onError={() => setImgReady(false)}
          decoding="async"
        />
      )}
      <canvas ref={canvasRef} className="canvas-aura__canvas" />
      <div className="canvas-aura__grain" />
      <span className="canvas-aura__tick canvas-aura__tick--tl" />
      <span className="canvas-aura__tick canvas-aura__tick--tr" />
      <span className="canvas-aura__tick canvas-aura__tick--bl" />
      <span className="canvas-aura__tick canvas-aura__tick--br" />
    </div>
  );
}
