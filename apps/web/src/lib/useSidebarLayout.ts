import { useCallback, useEffect, useRef, useState } from "react";

const MIN_WIDTH = 248;
const MAX_WIDTH = 460;
const DEFAULT_WIDTH = 320;
const COLLAPSED_WIDTH = 76;
const STORAGE_KEY = "kodo.sidebarWidth";
const STORAGE_COLLAPSED = "kodo.sidebarCollapsed";

function clamp(value: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value));
}

function readStoredWidth(): number {
  if (typeof localStorage === "undefined") return DEFAULT_WIDTH;
  const raw = Number(localStorage.getItem(STORAGE_KEY));
  return Number.isFinite(raw) && raw > 0 ? clamp(raw) : DEFAULT_WIDTH;
}

export interface SidebarLayout {
  width: number;
  collapsed: boolean;
  resizing: boolean;
  setWidth: (next: number, persist?: boolean) => void;
  toggleCollapsed: () => void;
  resetWidth: () => void;
  beginResize: (event: React.PointerEvent<HTMLElement>) => void;
  onResizerKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  /** Kept so callers can render a mobile drawer without a second state source. */
  open: boolean;
  setOpen: (next: boolean) => void;
}

/**
 * Owns the two-column shell geometry: a persisted, draggable sidebar width plus a
 * collapsed rail. Pointer capture keeps the drag alive outside the handle without
 * a window-level listener per move.
 */
export function useSidebarLayout(): SidebarLayout {
  const [width, setWidthState] = useState(readStoredWidth);
  const [collapsed, setCollapsed] = useState(() =>
    typeof localStorage === "undefined" ? false : localStorage.getItem(STORAGE_COLLAPSED) === "1",
  );
  const [resizing, setResizing] = useState(false);
  const [open, setOpen] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const setWidth = useCallback((next: number, persist = true) => {
    const clamped = clamp(next);
    setWidthState(clamped);
    if (persist && typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, String(Math.round(clamped)));
    }
  }, []);

  const resetWidth = useCallback(() => {
    setWidthState(DEFAULT_WIDTH);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, String(DEFAULT_WIDTH));
    }
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(STORAGE_COLLAPSED, next ? "1" : "0");
      }
      return next;
    });
  }, []);

  const beginResize = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      const target = event.currentTarget;
      dragRef.current = { startX: event.clientX, startWidth: width };
      setResizing(true);
      target.setPointerCapture(event.pointerId);

      const move = (moveEvent: PointerEvent) => {
        const drag = dragRef.current;
        if (!drag) return;
        setWidth(drag.startWidth + (moveEvent.clientX - drag.startX), false);
      };
      const finish = () => {
        const drag = dragRef.current;
        dragRef.current = null;
        setResizing(false);
        if (drag) setWidth(drag.startWidth, true);
        target.removeEventListener("pointermove", move);
        target.removeEventListener("pointerup", finish);
        target.removeEventListener("pointercancel", finish);
        document.body.classList.remove("is-resizing");
      };
      target.addEventListener("pointermove", move);
      target.addEventListener("pointerup", finish);
      target.addEventListener("pointercancel", finish);
      document.body.classList.add("is-resizing");
    },
    [setWidth, width],
  );

  const onResizerKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      const step = event.shiftKey ? 32 : 12;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setWidth(width - step);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setWidth(width + step);
      } else if (event.key === "Home") {
        event.preventDefault();
        setWidth(MIN_WIDTH);
      } else if (event.key === "End") {
        event.preventDefault();
        setWidth(MAX_WIDTH);
      }
    },
    [setWidth, width],
  );

  // Persist the settled width once the drag ends.
  useEffect(() => {
    if (resizing) return;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, String(Math.round(width)));
    }
  }, [resizing, width]);

  return {
    width,
    collapsed,
    resizing,
    setWidth,
    toggleCollapsed,
    resetWidth,
    beginResize,
    onResizerKeyDown,
    open,
    setOpen,
  };
}

export const SIDEBAR_METRICS = { MIN_WIDTH, MAX_WIDTH, DEFAULT_WIDTH, COLLAPSED_WIDTH };
