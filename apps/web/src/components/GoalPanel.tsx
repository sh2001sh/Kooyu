import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, ExternalLink, Plus, Target } from "lucide-react";
import type {
  Artifact,
  Goal,
  GoalHistoryEntry,
  GoalStatus,
  RuntimeEvent,
  Session,
  Snapshot,
  Verification,
  VerificationStatus,
} from "@kodo/protocol";
import { api, apiPath, remoteClient } from "../lib/host-client";
import { formatDate } from "../lib/harnesses";

type Action = (work: () => Promise<unknown>) => Promise<void>;

export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  draft: "草稿",
  active: "进行中",
  blocked: "等你处理",
  "awaiting-review": "待验收",
  completed: "已完成",
  cancelled: "已取消",
};
export const VERIFICATION_LABELS: Record<VerificationStatus, string> = {
  unverified: "未验证",
  passed: "检查通过",
  failed: "检查失败",
  "not-applicable": "无需验证",
};
const RECORDED_BY: Record<Verification["recordedBy"], string> = {
  host: "Host 执行",
  user: "你记录",
  model: "Kooyu 自评（不计入验证）",
};
const PRIORITY: GoalStatus[] = ["awaiting-review", "blocked", "active", "draft"];
const closed = (goal: Goal) => goal.status === "completed" || goal.status === "cancelled";

/** Goals owned by a Kooyu main conversation, refreshed when goal events arrive. */
export function useGoals(session: Session | null | undefined, events: RuntimeEvent[]) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const sessionId = session?.kind === "supervisor" ? session.id : null;
  const marker = useMemo(() => {
    let last = "";
    for (const event of events)
      if (event.type === "supervision" && (event.payload as { action?: string })?.action === "goal")
        last = event.id;
    return last;
  }, [events]);
  const reload = useCallback(async () => {
    if (!sessionId) return setGoals([]);
    setGoals(
      await api<Goal[]>(`/goals?controllerSessionId=${sessionId}&includeClosed=1`).catch(() => []),
    );
  }, [sessionId]);
  useEffect(() => {
    void reload();
  }, [reload, marker]);
  return { goals, reload };
}

/** The goal that most needs attention, shown above the conversation. */
export function currentGoal(goals: Goal[]): Goal | undefined {
  for (const status of PRIORITY) {
    const goal = goals.find((g) => g.status === status);
    if (goal) return goal;
  }
  return undefined;
}

export function GoalPill({ goals, onOpen }: { goals: Goal[]; onOpen: () => void }) {
  const goal = currentGoal(goals);
  if (!goal) return null;
  const open = goals.filter((g) => !closed(g)).length;
  return (
    <button
      type="button"
      className={`runtime-pill goal-pill goal-pill--${goal.status}`}
      onClick={onOpen}
      title={`当前目标：${goal.title}`}
    >
      <Target size={12} aria-hidden="true" />
      <span className="goal-pill__title">{goal.title}</span>
      <span className="goal-pill__status">{GOAL_STATUS_LABELS[goal.status]}</span>
      {open > 1 && <span className="goal-pill__more">+{open - 1}</span>}
    </button>
  );
}

export function GoalPanel({
  session,
  snapshot,
  goals,
  reload,
  act,
}: {
  session: Session;
  snapshot: Snapshot;
  goals: Goal[];
  reload: () => Promise<void>;
  act: Action;
}) {
  const [creating, setCreating] = useState(false);
  const open = goals.filter((g) => !closed(g));
  const ended = goals.filter(closed);
  const run: Action = (work) =>
    act(async () => {
      await work();
      await reload();
    });
  return (
    <div className="detail-stack goal-panel">
      <div className="goal-panel__head">
        <p className="workspace-browser__note">
          目标记录 Kooyu 要交付的工作。Kooyu 只能提交待验收；检查由 Host
          执行并保存真实结果，最终由你接受。
        </p>
        <button type="button" className="detail-sub-btn" onClick={() => setCreating((v) => !v)}>
          <Plus size={14} aria-hidden="true" /> 新建目标
        </button>
      </div>
      {creating && <CreateGoal session={session} run={run} onDone={() => setCreating(false)} />}
      {!open.length && !creating && (
        <p className="workspace-browser__note">
          暂无进行中的目标。把带交付物或验收要求的工作交给 Kooyu 时，它会在这里登记。
        </p>
      )}
      {open.map((goal) => (
        <GoalCard key={goal.id} goal={goal} snapshot={snapshot} run={run} />
      ))}
      {ended.length > 0 && (
        <details className="goal-panel__ended">
          <summary>已结束 {ended.length}</summary>
          {ended.map((goal) => (
            <GoalCard key={goal.id} goal={goal} snapshot={snapshot} run={run} />
          ))}
        </details>
      )}
    </div>
  );
}

function CreateGoal({
  session,
  run,
  onDone,
}: {
  session: Session;
  run: Action;
  onDone: () => void;
}) {
  const [title, setTitle] = useState("");
  const [criteria, setCriteria] = useState("");
  const [description, setDescription] = useState("");
  const [requestId] = useState(() => crypto.randomUUID());
  return (
    <form
      className="ios-inset-group detail-card"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await api("/goals", "POST", {
            requestId,
            controllerSessionId: session.id,
            title,
            description,
            acceptanceCriteria: criteria
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean),
          });
          onDone();
        });
      }}
    >
      <label className="detail-field">
        <span className="detail-section__label">目标</span>
        <input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="detail-field">
        <span className="detail-section__label">说明（可选）</span>
        <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label className="detail-field">
        <span className="detail-section__label">验收标准（每行一条）</span>
        <textarea rows={3} value={criteria} onChange={(e) => setCriteria(e.target.value)} />
      </label>
      <div className="goal-actions">
        <button type="submit">保存目标</button>
        <button type="button" className="detail-sub-btn" onClick={onDone}>
          取消
        </button>
      </div>
    </form>
  );
}

export function GoalCard({
  goal,
  snapshot,
  run,
  initiallyExpanded = false,
  onReview,
  disabled = false,
}: {
  goal: Goal;
  snapshot: Snapshot;
  run: Action;
  initiallyExpanded?: boolean;
  onReview?: (body: Record<string, unknown>) => Promise<unknown>;
  disabled?: boolean;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded || goal.status === "awaiting-review");
  const [detail, setDetail] = useState<{
    verifications: Verification[];
    history: GoalHistoryEntry[];
    artifacts: Artifact[];
  } | null>(null);
  useEffect(() => {
    if (!expanded) return;
    let live = true;
    void Promise.all([
      api<{ verifications: Verification[]; history: GoalHistoryEntry[] }>(`/goals/${goal.id}`),
      api<Artifact[]>(`/artifacts?goalId=${goal.id}`),
    ])
      .then(([d, artifacts]) => live && setDetail({ ...d, artifacts }))
      .catch(() => live && setDetail(null));
    return () => {
      live = false;
    };
  }, [expanded, goal.id, goal.revision]);
  const sessions = goal.sessionIds
    .map((id) => snapshot.sessions.find((s) => s.id === id))
    .filter((s): s is Session => Boolean(s));
  return (
    <section className={`ios-inset-group detail-card goal-card goal-card--${goal.status}`}>
      <button
        type="button"
        className="goal-card__summary"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <strong>{goal.title}</strong>
        <span className="goal-chips">
          <span className={`goal-chip goal-chip--${goal.status}`}>
            {GOAL_STATUS_LABELS[goal.status]}
          </span>
          <span className={`goal-chip goal-chip--verify-${goal.verificationStatus}`}>
            {VERIFICATION_LABELS[goal.verificationStatus]}
          </span>
        </span>
      </button>
      {goal.status === "blocked" && goal.blockedReason && (
        <p className="goal-blocked">受阻原因：{goal.blockedReason}</p>
      )}
      {expanded && (
        <div className="goal-card__body">
          {goal.description && <p className="goal-text">{goal.description}</p>}
          {goal.acceptanceCriteria.length > 0 && (
            <div>
              <span className="detail-section__label">验收标准</span>
              <ul className="goal-list">
                {goal.acceptanceCriteria.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}
          {sessions.length > 0 && (
            <p className="goal-meta">执行会话：{sessions.map((s) => s.title).join("、")}</p>
          )}
          {goal.result && <GoalResultView goal={goal} />}
          {detail && detail.artifacts.length > 0 && (
            <div>
              <span className="detail-section__label">成果</span>
              <ul className="goal-artifacts">
                {detail.artifacts.map((a) => (
                  <li key={a.id}>
                    <span>
                      {a.title}
                      <small>
                        {a.displayName} · v{a.version} · {formatBytes(a.size)}
                      </small>
                    </span>
                    <span className="goal-artifacts__links">
                      <a
                        href={apiPath(`/files/${a.fileId}/content`)}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`打开 ${a.displayName}`}
                      >
                        <ExternalLink size={14} />
                      </a>
                      <a
                        href={apiPath(`/files/${a.fileId}/content?download=1`)}
                        aria-label={`下载 ${a.displayName}`}
                      >
                        <Download size={14} />
                      </a>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {detail && detail.verifications.length > 0 && (
            <div>
              <span className="detail-section__label">检查记录</span>
              {detail.verifications.map((v) => (
                <details key={v.id} className="goal-check">
                  <summary>
                    <span className={`goal-chip goal-chip--outcome-${v.outcome}`}>
                      {v.outcome === "passed" ? "通过" : v.outcome === "failed" ? "失败" : "无结论"}
                    </span>
                    {["command", "test", "build"].includes(v.kind) ? (
                      <code>{v.method}</code>
                    ) : (
                      <span className="goal-check__method">{v.method}</span>
                    )}
                    <small>
                      {RECORDED_BY[v.recordedBy]}
                      {v.exitCode !== null ? ` · 退出码 ${v.exitCode}` : ""}
                      {v.scopeRevision !== goal.scopeRevision ? " · 目标范围已改变，不再计入" : ""}
                    </small>
                  </summary>
                  {v.evidence && <pre>{v.evidence}</pre>}
                  <small>
                    {v.location ?? "无执行位置"} · {formatDate(v.createdAt)}
                  </small>
                </details>
              ))}
            </div>
          )}
          {goal.notes.length > 0 && (
            <div>
              <span className="detail-section__label">备注</span>
              <ul className="goal-list">
                {goal.notes.map((n, i) => (
                  <li key={i}>
                    {n.text} <small>· {formatDate(n.at)}</small>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {goal.acceptedBy && (
            <p className="goal-meta">
              你于 {formatDate(goal.acceptedBy.at)} 接受（当时验证状态：
              {VERIFICATION_LABELS[goal.acceptedBy.verificationStatus]}）
              {goal.acceptedBy.remainingUncertainty
                ? `；保留的不确定事项：${goal.acceptedBy.remainingUncertainty}`
                : ""}
            </p>
          )}
          {!closed(goal) && (
            <GoalActions goal={goal} run={run} onReview={onReview} disabled={disabled} />
          )}
        </div>
      )}
    </section>
  );
}

function GoalResultView({ goal }: { goal: Goal }) {
  const result = goal.result!;
  const changes = result.changes ?? [];
  const introduced = changes.flatMap((c) =>
    c.changes.filter((x) => x.attribution === "introduced"),
  );
  const unknown = changes.flatMap((c) =>
    c.changes.filter((x) => x.attribution === "preexisting-modified"),
  );
  return (
    <div className="goal-result">
      <span className="detail-section__label">提交的结果 · {formatDate(result.reportedAt)}</span>
      <p className="goal-text">{result.summary}</p>
      {result.deliverables.length > 0 && (
        <ul className="goal-list">
          {result.deliverables.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      )}
      {result.limitations.length > 0 && (
        <>
          <span className="detail-section__label">已知限制</span>
          <ul className="goal-list">
            {result.limitations.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </>
      )}
      {changes.length > 0 && (
        <details className="goal-check">
          <summary>
            改动：新增/修改 {introduced.length} 个文件
            {unknown.length ? `，归属未知 ${unknown.length} 个` : ""}
          </summary>
          {changes.map((report) => (
            <div key={report.workspaceId}>
              <small>{report.coverage}</small>
              <ul className="goal-list">
                {report.changes.map((c) => (
                  <li key={c.path}>
                    <code>{c.path}</code>{" "}
                    <small>
                      {c.attribution === "introduced" ? c.status : `${c.status} · 归属未知`}
                    </small>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

function GoalActions({
  goal,
  run,
  onReview,
  disabled = false,
}: {
  goal: Goal;
  run: Action;
  onReview?: (body: Record<string, unknown>) => Promise<unknown>;
  disabled?: boolean;
}) {
  const [note, setNote] = useState("");
  const [command, setCommand] = useState("");
  const review = (decision: string, extra: Record<string, unknown> = {}) =>
    disabled
      ? Promise.resolve()
      : run(() =>
          onReview
            ? onReview({ expectedRevision: goal.revision, decision, ...extra })
            : api(`/goals/${goal.id}/review`, "POST", {
                requestId: crypto.randomUUID(),
                expectedRevision: goal.revision,
                decision,
                ...extra,
              }),
        );
  const unverified =
    goal.verificationStatus !== "passed" && goal.verificationStatus !== "not-applicable";
  return (
    <div className="goal-actions-block">
      <label className="detail-field">
        <span className="detail-section__label">
          {goal.status === "awaiting-review"
            ? "修改意见或保留的不确定事项"
            : "备注（取消原因等，可选）"}
        </span>
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {goal.status === "awaiting-review" && unverified && (
        <p className="goal-meta">
          当前验证状态为“{VERIFICATION_LABELS[goal.verificationStatus]}”。接受将如实记录这一点。
        </p>
      )}
      <div className="goal-actions">
        {goal.status === "awaiting-review" && (
          <>
            <button
              type="button"
              onClick={() =>
                void review("accept", note.trim() ? { remainingUncertainty: note.trim() } : {})
              }
            >
              接受结果
            </button>
            <button
              type="button"
              className="detail-sub-btn"
              disabled={!note.trim()}
              title={note.trim() ? undefined : "请先填写修改意见"}
              onClick={() => void review("request-changes", { note: note.trim() })}
            >
              要求修改
            </button>
          </>
        )}
        <button
          type="button"
          className="detail-sub-btn goal-danger"
          onClick={() => {
            if (
              window.confirm(
                `取消目标「${goal.title}」？关联的自动继续会先暂停，再请求停止运行中的会话。`,
              )
            )
              void review("cancel", {
                stopSessions: true,
                ...(note.trim() ? { note: note.trim() } : {}),
              });
          }}
        >
          取消目标
        </button>
      </div>
      {!remoteClient && goal.workspaceIds.length > 0 && (
        <form
          className="goal-check-form"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await api(`/goals/${goal.id}/checks`, "POST", {
                requestId: crypto.randomUUID(),
                command,
              });
              setCommand("");
            });
          }}
        >
          <label className="detail-field">
            <span className="detail-section__label">
              在目标工作区运行检查（本机执行，保存真实退出码）
            </span>
            <input
              required
              placeholder="例如 npm test"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
            />
          </label>
          <button type="submit" className="detail-sub-btn">
            运行检查
          </button>
        </form>
      )}
    </div>
  );
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
