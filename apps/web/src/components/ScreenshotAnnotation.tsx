import { useEffect, useRef, useState, type PointerEvent } from "react";
import {
  ArrowUpRight,
  Circle,
  Download,
  Pencil,
  RotateCcw,
  Send,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useT } from "../lib/i18n";

type Point = { x: number; y: number };
type ToolKind = "pen" | "arrow" | "rect" | "ellipse";
type Mark =
  | { tool: "pen"; color: string; points: Point[] }
  | { tool: "arrow" | "rect" | "ellipse"; color: string; start: Point; end: Point };

const SWATCHES = ["#e6533c", "#16a34a", "#d97706", "#141518", "#ffffff"];

function drawArrow(ctx: CanvasRenderingContext2D, start: Point, end: Point, width: number) {
  const head = Math.max(10, width * 4);
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(
    end.x - head * Math.cos(angle - Math.PI / 6),
    end.y - head * Math.sin(angle - Math.PI / 6),
  );
  ctx.lineTo(
    end.x - head * Math.cos(angle + Math.PI / 6),
    end.y - head * Math.sin(angle + Math.PI / 6),
  );
  ctx.closePath();
  ctx.fill();
}

function drawMarks(ctx: CanvasRenderingContext2D, marks: Mark[]) {
  const lineWidth = Math.max(3, ctx.canvas.width / 280);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = lineWidth;
  for (const mark of marks) {
    ctx.strokeStyle = mark.color;
    ctx.fillStyle = mark.color;
    if (mark.tool === "pen") {
      if (mark.points.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(mark.points[0]!.x, mark.points[0]!.y);
      for (let i = 1; i < mark.points.length; i++) {
        ctx.lineTo(mark.points[i]!.x, mark.points[i]!.y);
      }
      ctx.stroke();
    } else if (mark.tool === "arrow") {
      drawArrow(ctx, mark.start, mark.end, lineWidth);
    } else if (mark.tool === "rect") {
      ctx.strokeRect(
        Math.min(mark.start.x, mark.end.x),
        Math.min(mark.start.y, mark.end.y),
        Math.abs(mark.end.x - mark.start.x),
        Math.abs(mark.end.y - mark.start.y),
      );
    } else {
      ctx.beginPath();
      ctx.ellipse(
        (mark.start.x + mark.end.x) / 2,
        (mark.start.y + mark.end.y) / 2,
        Math.abs(mark.end.x - mark.start.x) / 2,
        Math.abs(mark.end.y - mark.start.y) / 2,
        0,
        0,
        2 * Math.PI,
      );
      ctx.stroke();
    }
  }
}

export function ScreenshotAnnotation({
  frame,
  fileName = "kooyu-annotated.png",
  close,
  onAttach,
}: {
  frame: string;
  fileName?: string;
  close: () => void;
  onAttach?: (file: File) => void | Promise<void>;
}) {
  const t = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [picture, setPicture] = useState<HTMLImageElement>();
  const [tool, setTool] = useState<ToolKind>("rect");
  const [color, setColor] = useState(SWATCHES[0]!);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [pending, setPending] = useState<Mark>();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const image = new Image();
    image.onload = () => setPicture(image);
    image.onerror = () => setError("无法读取截图。");
    image.src = frame;
    return () => {
      image.onload = null;
      image.onerror = null;
    };
  }, [frame]);

  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!picture || !ctx) return;
    ctx.clearRect(0, 0, canvas.current!.width, canvas.current!.height);
    ctx.drawImage(picture, 0, 0);
    drawMarks(ctx, pending ? [...marks, pending] : marks);
  }, [marks, pending, picture]);

  function point(e: PointerEvent<HTMLCanvasElement>): Point {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    return {
      x: el.width * clamp((e.clientX - rect.left) / rect.width),
      y: el.height * clamp((e.clientY - rect.top) / rect.height),
    };
  }

  const exportBlob = (): Promise<Blob | null> =>
    new Promise((resolve) => {
      canvas.current?.toBlob((blob) => resolve(blob), "image/png");
    });

  const handleAttach = async () => {
    if (!onAttach || !picture || pending) return;
    setSaving(true);
    try {
      const blob = await exportBlob();
      if (!blob) {
        setError("截图导出失败，请重试。");
        return;
      }
      const nextName = fileName.replace(/\.[^.]+$/, "") + "-annotated.png";
      await onAttach(new File([blob], nextName, { type: "image/png" }));
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDownload = async () => {
    const blob = await exportBlob();
    if (!blob) {
      setError("截图导出失败，请重试。");
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <section className="nx-annotate-panel" aria-label={t("annotate.title")}>
      <div className="nx-annotate-toolbar">
        <div className="nx-segmented" role="group" aria-label={t("annotate.title")}>
          {(
            [
              ["pen", Pencil, t("annotate.pen")],
              ["arrow", ArrowUpRight, t("annotate.arrow")],
              ["rect", Square, t("annotate.rect")],
              ["ellipse", Circle, t("annotate.ellipse")],
            ] as const
          ).map(([id, Icon, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={tool === id}
              title={label}
              onClick={() => setTool(id)}
              style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
            >
              <Icon size={12} />
              <span>{label}</span>
            </button>
          ))}
        </div>

        <div className="nx-swatch-group" aria-label="批注颜色">
          {SWATCHES.map((swatch) => (
            <button
              key={swatch}
              type="button"
              className={`nx-swatch ${color === swatch ? "is-active" : ""}`}
              style={{ background: swatch }}
              aria-label={swatch}
              onClick={() => setColor(swatch)}
            />
          ))}
        </div>

        <div className="delegation-card__actions">
          <button
            type="button"
            className="nx-btn nx-btn--sm"
            disabled={!marks.length}
            onClick={() => setMarks((m) => m.slice(0, -1))}
          >
            <RotateCcw size={12} />
            {t("annotate.undo")}
          </button>
          <button
            type="button"
            className="nx-btn nx-btn--sm"
            disabled={!marks.length}
            onClick={() => setMarks([])}
          >
            <Trash2 size={12} />
            {t("annotate.clear")}
          </button>
          {onAttach && (
            <button
              type="button"
              className="nx-btn nx-btn--sm nx-btn--coral"
              disabled={!picture || !!pending || saving}
              onClick={() => void handleAttach()}
            >
              <Send size={12} />
              {t("annotate.attach")}
            </button>
          )}
          <button
            type="button"
            className="nx-btn nx-btn--sm"
            disabled={!picture || !!pending}
            onClick={() => void handleDownload()}
          >
            <Download size={12} />
            {t("annotate.save")}
          </button>
          <button type="button" className="nx-btn nx-btn--sm nx-btn--ghost" onClick={close}>
            <X size={13} />
          </button>
        </div>
      </div>

      <div className="nx-annotate-canvas-wrap">
        {picture && (
          <canvas
            ref={canvas}
            aria-label={t("annotate.title")}
            width={picture.naturalWidth}
            height={picture.naturalHeight}
            onPointerDown={(e) => {
              if (!e.isPrimary || e.button !== 0) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              const start = point(e);
              setPending(
                tool === "pen"
                  ? { tool: "pen", color, points: [start] }
                  : { tool, color, start, end: start },
              );
            }}
            onPointerMove={(e) => {
              if (!e.isPrimary || !pending) return;
              const next = point(e);
              setPending(
                pending.tool === "pen"
                  ? { ...pending, points: [...pending.points, next] }
                  : { ...pending, end: next },
              );
            }}
            onPointerUp={(e) => {
              if (!e.isPrimary || !pending) return;
              const end = point(e);
              if (pending.tool === "pen") {
                if (pending.points.length >= 2)
                  setMarks((prev) => [...prev, { ...pending, points: [...pending.points, end] }]);
              } else if (
                Math.abs(end.x - pending.start.x) > 2 ||
                Math.abs(end.y - pending.start.y) > 2
              ) {
                setMarks((prev) => [...prev, { ...pending, end }]);
              }
              setPending(undefined);
            }}
            onPointerCancel={() => setPending(undefined)}
          />
        )}
      </div>

      {error && (
        <p className="nx-feedback nx-feedback--error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
