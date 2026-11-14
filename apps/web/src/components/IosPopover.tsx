import { useEffect, useId, useRef, type ReactNode } from "react";

interface IosPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side?: "top" | "bottom";
  align?: "start" | "end";
  wide?: boolean;
  role?: "listbox" | "dialog";
  trigger: (props: {
    id: string;
    onClick: () => void;
    "aria-expanded": boolean;
    "aria-haspopup": "listbox" | "dialog";
    "aria-controls": string;
  }) => ReactNode;
  children: ReactNode;
}

/**
 * Lightweight frosted iOS popover menu anchored to a pill trigger.
 * Keeps focus predictable (Escape returns focus to trigger) and dismisses on outside click.
 */
export function IosPopover({
  open,
  onOpenChange,
  side = "top",
  align = "start",
  wide = false,
  role = "listbox",
  trigger,
  children,
}: IosPopoverProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerId = useId();
  const panelId = useId();

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        onOpenChange(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onOpenChange(false);
        const btn = document.getElementById(triggerId);
        btn?.focus();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onOpenChange, triggerId]);

  return (
    <div ref={rootRef} className={`ios-popover-anchor ${open ? "is-open" : ""}`}>
      {trigger({
        id: triggerId,
        onClick: () => onOpenChange(!open),
        "aria-expanded": open,
        "aria-haspopup": role,
        "aria-controls": panelId,
      })}

      {open && (
        <div
          id={panelId}
          role={role}
          aria-labelledby={triggerId}
          className={`ios-popover ios-popover--${side} ios-popover--align-${align} ${wide ? "ios-popover--wide" : ""}`}
        >
          {children}
        </div>
      )}
    </div>
  );
}
