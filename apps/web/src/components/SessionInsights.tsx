import type { Command, RuntimeEvent, Session, Snapshot, Usage } from "@kodo/protocol";
import { HARNESS_NAMES, formatDate, shortModelLabel } from "../lib/harnesses";
import { messageText } from "./TurnCard";
import { toolSummary } from "./TranscriptView";

type Wire = Record<string, any>;

export interface TurnSummary {
  id: string;
  prompt: string;
  startedAt: string;
  endedAt?: string;
  outcome: "running" | "completed" | "failed" | "interrupted" | "unknown";
  error?: string;
  tools: number;
  failedTools: number;
  toolNames: string[];
  thought: boolean;
  replyChars: number;
  anchorId: string;
}

/** Fold the raw event log into one entry per user turn. */
export function summarizeTurns(events: RuntimeEvent[]): TurnSummary[] {
  const turns: TurnSummary[] = [];
  let current: TurnSummary | undefined;
  const seenTools = new Map<string, boolean>();
  for (const e of events) {
    const p = (e.payload ?? {}) as Wire;
    if (e.type === "message" && (p.role ?? "assistant") === "user") {
      current = {
        id: e.id,
        prompt: messageText(p).replace(/\s+/g, " ").trim(),
        startedAt: e.createdAt,
        outcome: "running",
        tools: 0,
        failedTools: 0,
        toolNames: [],
        thought: false,
        replyChars: 0,
        anchorId: `message-${p.id ? `message:${p.id}` : e.id}`,
      };
      turns.push(current);
      seenTools.clear();
      continue;
    }
    if (!current) continue;
    if (e.type === "tool" && !["userMessage", "reasoning"].includes(p.type)) {
      const key = String(p.toolCallId ?? p.id ?? e.id);
      const s = toolSummary(p);
      if (!seenTools.has(key)) {
        current.tools++;
        if (!current.toolNames.includes(s.title)) current.toolNames.push(s.title);
      }
      const failed = s.status === "失败";
      if (failed && !seenTools.get(key)) current.failedTools++;
      seenTools.set(key, failed || Boolean(seenTools.get(key)));
    } else if (e.type === "text-delta") {
      if (p.channel === "thought") current.thought = true;
      else current.replyChars += String(p.text ?? "").length;
    } else if (e.type === "message") {
      current.replyChars = Math.max(current.replyChars, messageText(p).length);
    } else if (e.type === "turn-ended" || (e.type === "settled" && current.outcome === "running")) {
      current.endedAt = e.createdAt;
      const o = String(p.outcome ?? "completed");
      current.outcome =
        o === "failed"
          ? "failed"
          : o === "interrupted" || o === "cancelled"
            ? "interrupted"
            : "completed";
      if (o === "failed")
        current.error = String(
          p.error?.underlyingErrorMessage ?? p.error?.message ?? p.message ?? "失败",
        );
    } else if (e.type === "error" || e.type === "disconnected") {
      current.endedAt = e.createdAt;
      current.outcome = "failed";
      current.error = String(p.message ?? "连接中断");
    }
  }
  return turns;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)} s`;
  const m = Math.floor(s / 60);
  return `${m} 分 ${Math.round(s % 60)} 秒`;
}

const OUTCOME: Record<TurnSummary["outcome"], string> = {
  running: "进行中",
  completed: "完成",
  failed: "失败",
  interrupted: "已中断",
  unknown: "未知",
};

export function TurnTimeline({ events, running }: { events: RuntimeEvent[]; running: boolean }) {
  const turns = summarizeTurns(events);
  if (turns.length === 0) return <div className="detail-empty-note">还没有对话回合</div>;
  return (
    <ol className="turn-timeline">
      {[...turns].reverse().map((t, i) => {
        const index = turns.length - i;
        const outcome = t.outcome === "running" && !running ? "unknown" : t.outcome;
        const duration = t.endedAt
          ? Date.parse(t.endedAt) - Date.parse(t.startedAt)
          : running && i === 0
            ? Date.now() - Date.parse(t.startedAt)
            : NaN;
        return (
          <li key={t.id} className={`turn-timeline__item is-${outcome}`}>
            <button
              type="button"
              className="turn-timeline__jump"
              onClick={() =>
                document
                  .getElementById(t.anchorId)
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
            >
              <div className="turn-timeline__head">
                <span className="turn-timeline__index">#{index}</span>
                <span className={`turn-timeline__outcome is-${outcome}`}>{OUTCOME[outcome]}</span>
                <span className="turn-timeline__time">{formatDate(t.startedAt)}</span>
              </div>
              <p className="turn-timeline__prompt">{t.prompt || "（空消息）"}</p>
              <div className="turn-timeline__facts">
                <span>耗时 {formatDuration(duration)}</span>
                {t.tools > 0 && (
                  <span>
                    工具 {t.tools}
                    {t.failedTools > 0 && <em> · {t.failedTools} 失败</em>}
                  </span>
                )}
                {t.thought && <span>含思考</span>}
                {t.replyChars > 0 && <span>回复 {t.replyChars.toLocaleString()} 字</span>}
              </div>
              {t.toolNames.length > 0 && (
                <div className="turn-timeline__tools">
                  {t.toolNames.slice(0, 4).map((name) => (
                    <span key={name} className="turn-timeline__tool-chip">
                      {name}
                    </span>
                  ))}
                  {t.toolNames.length > 4 && (
                    <span className="turn-timeline__tool-chip">+{t.toolNames.length - 4}</span>
                  )}
                </div>
              )}
              {t.error && <div className="turn-timeline__error">{t.error}</div>}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** The facts worth knowing about a session at a glance. */
export function SessionOverview({
  session: s,
  snapshot,
  events,
  commands,
  usage,
}: {
  session: Session;
  snapshot: Snapshot;
  events: RuntimeEvent[];
  commands: Command[];
  usage: Usage[];
}) {
  const turns = summarizeTurns(events);
  const workspace = snapshot.workspaces.find((w) => w.id === s.workspaceId);
  const project = snapshot.projects.find((p) => p.id === s.projectId);
  const harness = snapshot.harnesses.find((h) => h.id === s.harnessId);
  const binding = snapshot.bindings.find((b) => b.id === s.bindingId);
  const model =
    s.model ??
    binding?.model ??
    usage.findLast((u) => u.model)?.model ??
    harness?.nativeDefaults?.model;
  const mine = usage.filter((u) => u.sessionId === s.id);
  const turnRecords = mine.filter((u) => u.scope === "turn");
  const counted = turnRecords.length
    ? turnRecords
    : mine.filter((u) => u.scope === "session").slice(-1);
  const tokensIn = counted.reduce((n, u) => n + (u.input ?? 0) + (u.cacheRead ?? 0), 0);
  const tokensOut = counted.reduce((n, u) => n + (u.output ?? 0), 0);
  const cost = counted.reduce((n, u) => n + (u.costUsd ?? 0), 0);
  const estimated = counted.some((u) => u.costKind === "estimate");
  const tools = turns.reduce((n, t) => n + t.tools, 0);
  const failedTools = turns.reduce((n, t) => n + t.failedTools, 0);
  const failedTurns = turns.filter((t) => t.outcome === "failed").length;
  const finished = turns.filter((t) => t.endedAt);
  const totalMs = finished.reduce(
    (n, t) => n + (Date.parse(t.endedAt!) - Date.parse(t.startedAt)),
    0,
  );
  const queued = commands.filter((c) => c.kind === "send" && c.status === "accepted").length;
  const contextWindow = (() => {
    const last = [...events]
      .reverse()
      .find((e) => e.type === "usage" && (e.payload as Wire)?.contextWindow);
    return last ? Number((last.payload as Wire).contextWindow) : undefined;
  })();
  const lastInput = [...counted].reverse().find((u) => u.input !== null);
  const contextUsed = lastInput ? (lastInput.input ?? 0) + (lastInput.cacheRead ?? 0) : undefined;

  const fmt = (n: number) =>
    n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(2)}M`
      : n >= 1000
        ? `${(n / 1000).toFixed(1)}k`
        : String(n);

  const contextPct =
    contextUsed !== undefined && contextWindow
      ? Math.min(100, Math.round((contextUsed / contextWindow) * 100))
      : undefined;

  return (
    <div className="session-overview">
      <div className="session-overview__stats">
        <div>
          <span>回合</span>
          <strong>{turns.length}</strong>
          {failedTurns > 0 && <small className="is-bad">{failedTurns} 失败</small>}
        </div>
        <div>
          <span>工具调用</span>
          <strong>{tools}</strong>
          {failedTools > 0 && <small className="is-bad">{failedTools} 失败</small>}
        </div>
        <div>
          <span>Token 入 / 出</span>
          <strong>
            {fmt(tokensIn)} / {fmt(tokensOut)}
          </strong>
        </div>
        <div>
          <span>费用</span>
          <strong>{cost > 0 ? `$${cost.toFixed(cost < 0.1 ? 4 : 2)}` : "—"}</strong>
          {cost > 0 && estimated && <small>估算</small>}
        </div>
        <div>
          <span>执行总耗时</span>
          <strong>{finished.length ? formatDuration(totalMs) : "—"}</strong>
        </div>
        <div>
          <span>上下文占用</span>
          <strong>
            {contextPct !== undefined
              ? `${contextPct}%`
              : contextUsed !== undefined
                ? fmt(contextUsed)
                : "—"}
          </strong>
          {contextPct !== undefined && (
            <div className="session-overview__meter" aria-hidden="true">
              <div
                className={`session-overview__meter-fill ${contextPct >= 80 ? "is-high" : ""}`}
                style={{ width: `${contextPct}%` }}
              />
            </div>
          )}
          {contextWindow ? <small>/ {fmt(contextWindow)}</small> : null}
        </div>
      </div>
      <dl className="session-facts">
        <dt>Harness</dt>
        <dd>{HARNESS_NAMES[s.harnessId]}</dd>
        <dt>模型</dt>
        <dd>
          {model ? shortModelLabel(model) : "原生默认"}
          {s.reasoning ? ` · ${s.reasoning}` : ""}
          {binding ? ` · 绑定 ${binding.name}` : !s.model ? " · 原生配置" : ""}
        </dd>
        <dt>项目</dt>
        <dd>{project?.name ?? "未归属"}</dd>
        <dt>工作目录</dt>
        <dd className="mono-value">{workspace?.rootPath ?? "未绑定"}</dd>
        <dt>状态</dt>
        <dd className="session-facts__status">
          <span className={`session-fact-pill is-${s.runState}`}>
            <i aria-hidden="true" />
            {s.runState === "running" ? "执行中" : s.runState === "idle" ? "空闲" : "运行未知"}
          </span>
          <span className={`session-fact-pill ${s.connectionState === "connected" ? "is-ok" : ""}`}>
            {s.connectionState === "connected" ? "已连接" : "未连接"}
          </span>
          {queued > 0 && <span className="session-fact-pill">排队 {queued}</span>}
        </dd>
        <dt>创建</dt>
        <dd>{formatDate(s.createdAt)}</dd>
        {turns.length > 0 && (
          <>
            <dt>最近活动</dt>
            <dd>{formatDate(turns.at(-1)!.endedAt ?? turns.at(-1)!.startedAt)}</dd>
          </>
        )}
        <dt>原生会话 ID</dt>
        <dd className="mono-value">{s.nativeSessionId ?? "尚未创建"}</dd>
      </dl>
    </div>
  );
}
