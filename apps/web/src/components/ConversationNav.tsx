import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { ConversationMark } from "@kodo/protocol";

interface Mark {
  id: string;
  label: string;
  eventId?: string;
  sequence?: number;
}

/**
 * Floating index rail beside the transcript: one node per user turn,
 * showing current scroll progress, active turn badge, and hover jump cards.
 */
export function ConversationNav({
  scrollRef,
  version,
  messageIndex = [],
  onLoadMessage,
  loading = false,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Changes whenever the transcript content changes. */
  version: unknown;
  messageIndex?: ConversationMark[];
  onLoadMessage?: (mark: ConversationMark) => Promise<void>;
  loading?: boolean;
}) {
  const [marks, setMarks] = useState<Mark[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const lockUntilRef = useRef(0);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const nodes = [...root.querySelectorAll<HTMLElement>("[data-nav-user]")];
    const all = new Map<string, Mark>(messageIndex.map((mark) => [mark.id, mark]));
    for (const node of nodes.filter((n) => n.id))
      if (!all.has(node.id))
        all.set(node.id, { id: node.id, label: node.dataset.navLabel || "消息" });
    setMarks([...all.values()]);
  }, [scrollRef, version, messageIndex]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || marks.length === 0) return;
    const update = () => {
      if (Date.now() < lockUntilRef.current) return;
      const atBottom =
        root.scrollTop > 4 && root.scrollTop + root.clientHeight >= root.scrollHeight - 16;
      if (atBottom) {
        setActive(marks.at(-1)?.id ?? null);
        return;
      }
      const top = root.getBoundingClientRect().top + 112;
      let current: string | null = null;
      for (const m of marks) {
        const el = document.getElementById(m.id);
        if (el && current === null) current = m.id;
        if (el && el.getBoundingClientRect().top <= top) current = m.id;
      }
      setActive(current);
    };
    const releaseLock = () => {
      lockUntilRef.current = 0;
    };
    update();
    root.addEventListener("scroll", update, { passive: true });
    root.addEventListener("wheel", releaseLock, { passive: true });
    root.addEventListener("touchstart", releaseLock, { passive: true });
    root.addEventListener("pointerdown", releaseLock, { passive: true });
    return () => {
      root.removeEventListener("scroll", update);
      root.removeEventListener("wheel", releaseLock);
      root.removeEventListener("touchstart", releaseLock);
      root.removeEventListener("pointerdown", releaseLock);
    };
  }, [scrollRef, marks]);

  if (marks.length < 2) return null;

  const activeIdx = Math.max(
    0,
    marks.findIndex((m) => m.id === active),
  );
  const jumpToIndex = (idx: number) => {
    const target = marks[Math.max(0, Math.min(marks.length - 1, idx))];
    if (!target) return;
    lockUntilRef.current = Date.now() + 750;
    setActive(target.id);
    const element = document.getElementById(target.id);
    if (element) element.scrollIntoView({ behavior: "smooth", block: "start" });
    else if (target.eventId && target.sequence !== undefined)
      void onLoadMessage?.(target as ConversationMark).then(() => {
        lockUntilRef.current = Date.now() + 750;
        setActive(target.id);
        document.getElementById(target.id)?.scrollIntoView({ block: "start" });
      });
  };

  return (
    <nav className="conversation-nav" aria-label="对话导航" aria-busy={loading}>
      <div className="conversation-nav__shell">
        <div className="conversation-nav__counter" aria-hidden="true">
          <span>{String(activeIdx + 1).padStart(2, "0")}</span>
          <i>/</i>
          <span>{String(marks.length).padStart(2, "0")}</span>
        </div>
        <button
          type="button"
          className="conversation-nav__step"
          aria-label="上一条消息"
          disabled={loading || activeIdx <= 0}
          onClick={() => jumpToIndex(activeIdx - 1)}
        >
          <ChevronUp size={12} aria-hidden="true" />
        </button>
        <ol className="conversation-nav__track">
          {marks.map((m, index) => (
            <li key={m.id}>
              <button
                type="button"
                className={`conversation-nav__item ${m.id === active ? "is-active" : ""}`}
                aria-label={`跳到第 ${index + 1} 条消息：${m.label}`}
                aria-current={m.id === active ? "location" : undefined}
                disabled={loading}
                onClick={() => jumpToIndex(index)}
              >
                <span className="conversation-nav__tick" aria-hidden="true" />
                <span className="conversation-nav__label">
                  <span className="conversation-nav__index">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="conversation-nav__text">{m.label}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
        <button
          type="button"
          className="conversation-nav__step"
          aria-label="下一条消息"
          disabled={loading || activeIdx >= marks.length - 1}
          onClick={() => jumpToIndex(activeIdx + 1)}
        >
          <ChevronDown size={12} aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}
