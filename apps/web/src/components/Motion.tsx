import React, { useEffect, useId, useRef, useState } from "react";
import { Check, Copy, X } from "lucide-react";

/**
 * Native <dialog>-backed sheet modal: centered iOS floating card on desktop,
 * grabber-topped Bottom Sheet on narrow screens (<=760px).
 */
export function Modal({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className="ios-sheet"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="ios-sheet__grabber" aria-hidden="true" />
      <div className="modal-header">
        <div className="modal-header__titles">
          <h2 id={titleId}>{title}</h2>
          {subtitle && <p className="modal-header__subtitle">{subtitle}</p>}
        </div>
        <button type="button" aria-label="关闭" className="ios-close-pill" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <div className="ios-sheet__body">{children}</div>
    </dialog>
  );
}

/** Tactile copy button with spring checkmark confirmation. */
export function CopyButton({ text, label = "复制" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard API may be unavailable in insecure contexts; ignore silently.
    }
  };

  return (
    <button
      type="button"
      className={`ios-copy-btn ${copied ? "is-copied" : ""}`}
      onClick={() => void handleCopy()}
      aria-label={copied ? "已复制" : label}
      title={copied ? "已复制" : label}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      <span>{copied ? "已复制" : label}</span>
    </button>
  );
}
