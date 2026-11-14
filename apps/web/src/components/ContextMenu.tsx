import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type MenuAction = {
  id: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  onSelect: () => void;
};

export function ContextMenu({
  x,
  y,
  label,
  actions,
  onClose,
  restoreFocus,
}: {
  x: number;
  y: number;
  label: string;
  actions: MenuAction[];
  onClose: () => void;
  restoreFocus?: HTMLElement;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    isTop?: boolean;
    isRight?: boolean;
  }>({ left: x, top: y });

  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    const viewport = window.visualViewport;
    const width = viewport?.width ?? innerWidth;
    const height = viewport?.height ?? innerHeight;

    const triggerRect = restoreFocus?.getBoundingClientRect();
    let resolvedTop = y;
    let isTop = false;

    if (triggerRect) {
      const spaceBelow = height - triggerRect.bottom;
      const spaceAbove = triggerRect.top;
      if (spaceBelow < rect.height + 8 && spaceAbove > spaceBelow) {
        resolvedTop = triggerRect.top - rect.height - 4;
        isTop = true;
      } else {
        resolvedTop = triggerRect.bottom + 4;
      }
    } else {
      if (y + rect.height > height - 8) {
        resolvedTop = Math.max(8, height - rect.height - 8);
        isTop = true;
      }
    }

    const resolvedLeft = Math.max(8, Math.min(x, width - rect.width - 8));
    const isRight = resolvedLeft + rect.width >= width - 20;

    setPosition({
      left: resolvedLeft,
      top: Math.max(8, Math.min(resolvedTop, height - rect.height - 8)),
      isTop,
      isRight,
    });

    menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });

    const outside = (event: PointerEvent) => {
      if (!menu.contains(event.target as Node) && !restoreFocus?.contains(event.target as Node))
        onClose();
    };
    const dismiss = (event: Event) => {
      if (!menu.contains(event.target as Node)) onClose();
    };

    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [x, y, onClose, restoreFocus]);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className={[
        "sidebar-context-menu",
        position.isTop ? "is-top" : "",
        position.isRight ? "is-right" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ left: position.left, top: position.top }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        const buttons = [
          ...ref.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
        ];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? buttons.length - 1
                : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
          buttons[next]?.focus();
        } else if (event.key === "Escape" || event.key === "Tab") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
          restoreFocus?.focus();
        }
      }}
    >
      {actions.map((action) => (
        <Fragment key={action.id}>
          {action.separator && <div role="separator" className="sidebar-context-menu__separator" />}
          <button
            type="button"
            role="menuitem"
            disabled={action.disabled}
            className={[
              "sidebar-context-menu__item",
              action.danger ? "is-danger" : "",
              action.separator ? "has-separator" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => {
              onClose();
              restoreFocus?.focus();
              action.onSelect();
            }}
          >
            <span className="sidebar-context-menu__icon" aria-hidden="true">
              {action.icon}
            </span>
            <span className="sidebar-context-menu__label">{action.label}</span>
          </button>
        </Fragment>
      ))}
    </div>,
    document.body,
  );
}
