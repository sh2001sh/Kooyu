import type { Session } from "@kodo/protocol";

/** Visual states for "The State Has Words" rule (§2.3): every dot carries a Chinese word. */
export type StatusTone = "running" | "waiting-input" | "idle" | "done" | "unknown" | "draft";

export const STATUS_WORDS: Record<StatusTone, string> = {
  running: "运行中",
  "waiting-input": "需确认",
  idle: "就绪",
  done: "已完成",
  unknown: "异常",
  draft: "尚未启动",
};

/** Maps a session onto the shared status vocabulary. An idle session with an unseen result reads 已完成. */
export function sessionStatusTone(
  session: Pick<Session, "phase" | "runState" | "unread">,
): StatusTone {
  if (session.phase === "draft") return "draft";
  if (session.runState === "idle") return session.unread ? "done" : "idle";
  return session.runState;
}

export function StatusBadge({
  tone,
  label,
  className = "",
}: {
  tone: StatusTone;
  /** Overrides the default word; still rendered next to the dot, never instead of it. */
  label?: string;
  className?: string;
}) {
  return (
    <span className={`status-badge is-${tone} ${className}`.trim()}>
      <span className={`status-dot ${tone}`} aria-hidden="true" />
      <span className="status-badge__word">{label ?? STATUS_WORDS[tone]}</span>
    </span>
  );
}
