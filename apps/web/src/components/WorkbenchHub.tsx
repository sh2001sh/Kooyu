import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  Download,
  FileText,
  Folder,
  Layers,
  Monitor,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import type {
  Automation,
  ClientMutationReceipt,
  Goal,
  MemoryEntry,
  Snapshot,
  WorkbenchOverview,
} from "@kodo/protocol";
import { scheduleEditorValue, editorTrigger, describeAutomationSchedule } from "@kodo/protocol";
import { ScheduleFields } from "./ScheduleFields";
import { api, apiPath, hostPath, HostError } from "../lib/host-client";
import { GoalCard, GOAL_STATUS_LABELS, VERIFICATION_LABELS } from "./GoalPanel";
import { HARNESS_NAMES, formatDate } from "../lib/harnesses";
import "../styles/workbench-hub.css";

type Tab = "work" | "artifacts" | "plans" | "project" | "memory" | "capabilities" | "templates";
const tabs: [Tab, string][] = [
  ["work", "工作记录"],
  ["artifacts", "成果"],
  ["plans", "自动计划"],
  ["project", "项目概览"],
  ["memory", "项目约定"],
  ["capabilities", "执行能力"],
  ["templates", "常用任务"],
];
const templates = [
  ["检查项目", "请检查当前项目的结构和运行方式，指出需要优先处理的问题，并给出依据。"],
  ["修复并验证", "请定位并修复以下问题，运行相关检查，并交付修改说明、验证结果和剩余限制：\n"],
  ["整理成果", "请整理本项目当前工作的成果、实际验证记录和待处理事项，并关联来源对话。"],
  [
    "安排计划",
    "请帮我创建一个自动计划。先与我确认工作内容、执行时间、时区、执行设备和次数或预算边界，再请求必要授权。",
  ],
];

const scheduleDescription = describeAutomationSchedule;

export function WorkbenchHub({
  snapshot,
  initialProject = "",
  initialTab = "work",
  onOpenSession,
  onCompose,
  onBack,
}: {
  snapshot: Snapshot;
  initialProject?: string;
  initialTab?: Tab;
  onOpenSession: (id: string) => void;
  onCompose: (projectId: string | null, text: string) => void;
  onBack?: () => void;
}) {
  const [project, setProject] = useState(initialProject);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [data, setData] = useState<WorkbenchOverview>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [attention, setAttention] = useState(false);
  const [goal, setGoal] = useState<Goal>();
  const [plan, setPlan] = useState<Automation>();
  const [preview, setPreview] = useState<WorkbenchOverview["artifacts"][number]>();
  const [memory, setMemory] = useState<MemoryEntry | null>();
  const receiptKey = "kooyu.workbench.receipt:" + hostPath + ":" + snapshot.hostId;
  const [pending, setPending] = useState<string | null>(() => localStorage.getItem(receiptKey));
  const request = useRef(0);
  const reload = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    setError("");
    try {
      const next = await api<WorkbenchOverview>(
        "/workbench" + (project ? "?projectId=" + project : ""),
      );
      if (request.current === id) setData(next);
    } catch (e) {
      if (request.current === id) setError((e as Error).message);
    } finally {
      if (request.current === id) setLoading(false);
    }
  }, [project]);
  useEffect(() => {
    setData(undefined);
    setGoal(undefined);
    setPlan(undefined);
    setPreview(undefined);
    setMemory(undefined);
    void reload();
    return () => {
      request.current++;
    };
  }, [reload]);
  const reconcile = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const receipt = await api<ClientMutationReceipt>("/client/operations/" + pending);
      if (["pending", "unknown"].includes(receipt.status))
        throw new Error(receipt.error?.message ?? "操作仍在核对中，请稍后刷新回执。");
      localStorage.removeItem(receiptKey);
      setPending(null);
      if (receipt.status === "failed") throw new Error(receipt.error?.message ?? "操作未完成。");
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const mutate = async (path: string, method: "POST" | "PATCH", body: unknown) => {
    if (busy || pending) return false;
    const requestId = crypto.randomUUID();
    setBusy(true);
    setError("");
    localStorage.setItem(receiptKey, requestId);
    setPending(requestId);
    try {
      const receipt = await api<ClientMutationReceipt>("/client/operations", "POST", {
        requestId,
        path: "/api" + path,
        method,
        body,
      });
      if (receipt.status !== "confirmed") {
        if (receipt.status === "failed") {
          localStorage.removeItem(receiptKey);
          setPending(null);
        }
        throw new Error(receipt.error?.message ?? "操作结果待核对，不会自动重发。");
      }
      localStorage.removeItem(receiptKey);
      setPending(null);
      await reload();
      return true;
    } catch (e) {
      if (e instanceof HostError) {
        localStorage.removeItem(receiptKey);
        setPending(null);
      }
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const matches = (text: string) =>
    text.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim());
  const openSource = (id: string | null) => {
    if (id && snapshot.sessions.some((s) => s.id === id)) onOpenSession(id);
    else setError("来源会话已移除。");
  };
  const blocked = busy || !!pending;
  const runningSessions =
    data?.sessions.filter(
      (session) =>
        ["running", "waiting-input"].includes(session.runState) &&
        !data.goals.some(
          (g) => g.controllerSessionId === session.id || g.sessionIds.includes(session.id),
        ) &&
        !data.inbox.some((i) => i.sessionId === session.id) &&
        matches(session.title) &&
        (!attention || session.runState === "waiting-input"),
    ) ?? [];
  const capabilityLabels: Record<string, string> = {
    directChat: "对话",
    historyRead: "历史读取",
    resume: "恢复会话",
    observeLive: "执行状态",
    observeExternal: "外部会话",
    steer: "途中补充",
    cancel: "停止",
    interaction: "询问与审批",
    usage: "用量",
    quota: "额度",
  };
  const sourceButton = (id: string | null) => (
    <button type="button" className="hub-link" onClick={() => openSource(id)} disabled={!id}>
      返回来源对话 <ArrowUpRight size={14} />
    </button>
  );
  return (
    <section className="workbench-hub" aria-label="项目与工作">
      <header className="hub-heading">
        <div>
          {onBack && (
            <button type="button" className="hub-link" onClick={onBack}>
              <ArrowLeft size={14} />
              返回对话
            </button>
          )}
          <h2>{data?.project?.name ?? "我的工作"}</h2>
          <p>跟进工作，查看成果，继续下一步。</p>
        </div>
        <div className="hub-actions">
          <label className="hub-scope">
            项目范围
            <select value={project} onChange={(e) => setProject(e.target.value)}>
              <option value="">全部项目</option>
              {snapshot.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="icon-button"
            aria-label="刷新工作记录"
            onClick={() => void reload()}
            disabled={loading}
          >
            <RefreshCw size={17} />
          </button>
        </div>
      </header>
      <nav className="hub-tabs" aria-label="工作视图">
        {tabs.map(([id, label]) => (
          <button
            type="button"
            key={id}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => {
              setTab(id);
              setGoal(undefined);
              setPreview(undefined);
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {error && (
        <p role="alert" className="hub-error">
          {error}
        </p>
      )}
      {pending && (
        <div className="hub-pending" role="status">
          <span>有一项操作等待核对，暂不重复提交。</span>
          <button type="button" onClick={() => void reconcile()} disabled={busy}>
            核对回执
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (confirm("确认已在设备上核对业务对象？清除本机标记不会撤销或重发原操作。")) {
                localStorage.removeItem(receiptKey);
                setPending(null);
                void reload();
              }
            }}
          >
            已核对业务对象
          </button>
        </div>
      )}
      {loading && <p role="status">正在读取设备上的工作…</p>}
      {data && (
        <>
          {["work", "artifacts", "plans"].includes(tab) && (
            <div className="hub-filter">
              <label>
                <Search size={16} />
                <input
                  aria-label="搜索工作与成果"
                  placeholder="搜索名称或内容"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              {tab === "work" && (
                <label className="hub-check">
                  <input
                    type="checkbox"
                    checked={attention}
                    onChange={(e) => setAttention(e.target.checked)}
                  />
                  需要我处理
                </label>
              )}
            </div>
          )}
          <div className={`hub-layout ${goal || preview ? "hub-layout--detail" : ""}`}>
            <div className="hub-content">
              {tab === "work" && (
                <>
                  {data.inbox
                    .filter((item) =>
                      matches(snapshot.sessions.find((s) => s.id === item.sessionId)?.title ?? ""),
                    )
                    .map((item) => (
                      <button
                        type="button"
                        className="hub-row hub-row--action"
                        key={item.id}
                        onClick={() => openSource(item.sessionId)}
                      >
                        <CheckCircle2 size={19} />
                        <span>
                          <strong>
                            {snapshot.sessions.find((s) => s.id === item.sessionId)?.title}
                          </strong>
                          <small>等待回答或权限确认</small>
                        </span>
                        <ArrowUpRight size={16} />
                      </button>
                    ))}
                  {runningSessions.map((s) => (
                    <button
                      type="button"
                      className="hub-row hub-row--action"
                      key={s.id}
                      onClick={() => openSource(s.id)}
                    >
                      <Monitor size={19} />
                      <span>
                        <strong>{s.title}</strong>
                        <small>
                          {s.runState === "running" ? "正在运行" : "等待输入"} ·{" "}
                          {HARNESS_NAMES[s.harnessId]}
                        </small>
                      </span>
                      <ArrowUpRight size={16} />
                    </button>
                  ))}
                  {data.goals
                    .filter(
                      (g) =>
                        matches(g.title + g.description) &&
                        (!attention || ["blocked", "awaiting-review"].includes(g.status)),
                    )
                    .map((g) => (
                      <button
                        type="button"
                        className="hub-row hub-row--action"
                        key={g.id}
                        onClick={() => setGoal(g)}
                      >
                        <Layers size={19} />
                        <span>
                          <strong>{g.title}</strong>
                          <small>
                            {GOAL_STATUS_LABELS[g.status]} ·{" "}
                            {VERIFICATION_LABELS[g.verificationStatus]} · {formatDate(g.updatedAt)}
                          </small>
                        </span>
                        <ArrowUpRight size={16} />
                      </button>
                    ))}
                  {!data.goals.some(
                    (g) =>
                      matches(g.title + g.description) &&
                      (!attention || ["blocked", "awaiting-review"].includes(g.status)),
                  ) &&
                    !runningSessions.length &&
                    !data.inbox.some((i) =>
                      matches(snapshot.sessions.find((s) => s.id === i.sessionId)?.title ?? ""),
                    ) && (
                      <HubEmpty
                        title={attention ? "暂无需要处理的工作" : "还没有工作记录"}
                        text="在主对话中交代目标；过程、成果和验收会汇集到这里。"
                        action="开始对话"
                        onAction={() => onCompose(project || null, "")}
                      />
                    )}
                </>
              )}
              {tab === "artifacts" && (
                <>
                  {data.artifacts
                    .filter(({ artifact: a }) => matches(a.title + a.displayName))
                    .map((entry) => (
                      <article key={entry.artifact.id} className="hub-row">
                        <FileText size={21} />
                        <div className="hub-row-body">
                          <strong>{entry.artifact.title}</strong>
                          <small>
                            {entry.artifact.displayName} · v{entry.artifact.version} ·{" "}
                            {Math.ceil(entry.artifact.size / 1024)} KB
                          </small>
                          <small>
                            {entry.artifact.goalId
                              ? VERIFICATION_LABELS[
                                  data.goals.find((g) => g.id === entry.artifact.goalId)
                                    ?.verificationStatus ?? "unverified"
                                ]
                              : "未关联工作验收"}
                          </small>
                          {!entry.available && <small role="status">{entry.reason}</small>}
                          <div className="hub-actions">
                            <button
                              type="button"
                              className="hub-link"
                              disabled={!entry.available}
                              onClick={() => setPreview(entry)}
                            >
                              预览
                            </button>
                            {entry.available && (
                              <a
                                className="hub-link"
                                href={apiPath(`/files/${entry.artifact.fileId}/content?download=1`)}
                              >
                                <Download size={14} />
                                下载
                              </a>
                            )}
                            {sourceButton(
                              entry.artifact.sessionId ??
                                data.goals.find((g) => g.id === entry.artifact.goalId)
                                  ?.controllerSessionId ??
                                null,
                            )}
                          </div>
                        </div>
                      </article>
                    ))}
                  {!data.artifacts.some(({ artifact: a }) => matches(a.title + a.displayName)) && (
                    <HubEmpty title="暂无匹配成果" text="交付文件会出现在这里，并保留来源对话。" />
                  )}
                  {data.artifacts.length >= data.coverage.artifactsLimit && (
                    <p>
                      显示最近 {data.coverage.artifactsLimit} 项成果；更早的成果可在所属工作中查看。
                    </p>
                  )}
                </>
              )}
              {tab === "plans" && (
                <>
                  <div className="hub-actions">
                    <button
                      type="button"
                      className="hub-link"
                      onClick={() => onCompose(project || null, templates[3]![1]!)}
                    >
                      <Plus size={16} />
                      通过对话创建计划
                    </button>
                  </div>
                  {data.plans
                    .filter((p) => matches(p.name + p.promptTemplate))
                    .map((p) => (
                      <article className="hub-row" key={p.id}>
                        <CalendarClock size={21} />
                        <div className="hub-row-body">
                          <strong>{p.name}</strong>
                          <small>
                            {p.enabled ? "已启用" : "已暂停"} · {scheduleDescription(p.trigger)} ·{" "}
                            {p.timeZone}
                          </small>
                          <small>
                            下次：{p.enabled && p.nextDueAt ? formatDate(p.nextDueAt) : "暂无安排"}{" "}
                            · 执行节点：{p.executorId === "local" ? "当前设备" : p.executorId}
                          </small>
                          <div className="hub-actions">
                            <button type="button" className="hub-link" onClick={() => setPlan(p)}>
                              编辑与运行记录
                            </button>
                            {sourceButton(p.controllerSessionId)}
                          </div>
                        </div>
                      </article>
                    ))}
                  {!data.plans.some((p) => matches(p.name + p.promptTemplate)) && (
                    <HubEmpty
                      title="还没有匹配的自动计划"
                      text="告诉主对话执行什么、何时执行；确认范围后再启用。"
                    />
                  )}
                </>
              )}
              {tab === "project" && (
                <>
                  <h3>{data.project ? "项目目录" : "项目与目录"}</h3>
                  {data.workspaces.map((w) => (
                    <div className="hub-row" key={w.id}>
                      <Folder size={20} />
                      <span>
                        <strong>
                          {data.projects.find((p) => p.id === w.projectId)?.name ?? "未分组目录"}
                        </strong>
                        <code>{w.rootPath}</code>
                      </span>
                    </div>
                  ))}
                  {!data.workspaces.length && <p>尚未关联目录，可在项目管理中选择设备目录。</p>}
                  <h3>最近对话</h3>
                  {[...data.sessions]
                    .filter((s) => !s.archived)
                    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                    .slice(0, 12)
                    .map((s) => (
                      <button
                        type="button"
                        key={s.id}
                        className="hub-row hub-row--action"
                        onClick={() => openSource(s.id)}
                      >
                        <span>
                          <strong>{s.title}</strong>
                          <small>
                            {HARNESS_NAMES[s.harnessId]} ·{" "}
                            {s.runState === "running"
                              ? "正在运行"
                              : s.runState === "waiting-input"
                                ? "等待输入"
                                : "打开对话"}
                          </small>
                        </span>
                        <ArrowUpRight size={16} />
                      </button>
                    ))}
                  <button
                    type="button"
                    className="hub-link"
                    onClick={() => onCompose(project || null, "")}
                  >
                    <Plus size={16} />
                    在此新建对话
                  </button>
                </>
              )}
              {tab === "memory" && (
                <>
                  <div className="hub-actions">
                    <button
                      type="button"
                      className="hub-link"
                      disabled={blocked}
                      onClick={() => setMemory(null)}
                    >
                      <Plus size={16} />
                      新增约定
                    </button>
                  </div>
                  {data.memories.map((m) => (
                    <article key={m.id} className="hub-row">
                      <BookOpen size={19} />
                      <div className="hub-row-body">
                        <strong>{m.subject}</strong>
                        <small>
                          {m.scope === "user"
                            ? "全局"
                            : data.projects.find((p) => p.id === m.projectId)?.name}{" "}
                          · {m.status === "confirmed" ? "已确认" : "待确认"} · 修订 {m.revision}
                        </small>
                        <p>{m.content}</p>
                        <button
                          type="button"
                          className="hub-link"
                          onClick={() => setMemory(m)}
                          disabled={blocked}
                        >
                          查看与编辑
                        </button>
                      </div>
                    </article>
                  ))}
                  {!data.memories.length && (
                    <HubEmpty
                      title="还没有长期约定"
                      text="保存稳定的项目规范；临时进度留在对话中。"
                    />
                  )}
                </>
              )}
              {tab === "capabilities" && (
                <>
                  <p>能力来自当前设备的真实引擎信息；手机连接后由这台设备执行。</p>
                  {data.harnesses.map((h) => (
                    <div className="hub-row" key={h.id}>
                      <Monitor size={20} />
                      <span>
                        <strong>{h.name}</strong>
                        <small>
                          {h.health
                            ? h.health.installed
                              ? "已安装"
                              : "未安装"
                            : "尚未检查安装状态"}{" "}
                          ·{" "}
                          {h.health?.launchable === false
                            ? "当前不可运行"
                            : h.implementation === "partial"
                              ? "部分支持"
                              : "已接入"}
                        </small>
                        <small>
                          {Object.entries(h.capabilities)
                            .filter(([, v]) => v !== "unsupported")
                            .map(
                              ([k, v]) =>
                                (capabilityLabels[k] ?? k) + (v === "unknown" ? "（待确认）" : ""),
                            )
                            .join(" / ") || "暂无已声明能力"}
                        </small>
                      </span>
                    </div>
                  ))}
                </>
              )}
              {tab === "templates" && (
                <>
                  <p>选择后填入草稿，你可以修改后再发送。</p>
                  {templates.map(([title, text]) => (
                    <button
                      type="button"
                      className="hub-row hub-row--action"
                      key={title}
                      onClick={() => onCompose(project || null, text!)}
                    >
                      <span>
                        <strong>{title}</strong>
                        <small>{text}</small>
                      </span>
                      <ArrowUpRight size={16} />
                    </button>
                  ))}
                </>
              )}
            </div>
            {(goal || preview) && (
              <aside className="hub-inspector" aria-label="工作详情">
                <button
                  type="button"
                  className="hub-link"
                  onClick={() => {
                    setGoal(undefined);
                    setPreview(undefined);
                  }}
                >
                  <X size={16} />
                  关闭详情
                </button>
                {goal && (
                  <>
                    {sourceButton(goal.controllerSessionId)}
                    <GoalCard
                      initiallyExpanded
                      goal={data.goals.find((g) => g.id === goal.id) ?? goal}
                      snapshot={snapshot}
                      disabled={blocked}
                      onReview={(body) => mutate(`/goals/${goal.id}/review`, "POST", body)}
                      run={async (work) => {
                        try {
                          await work();
                          await reload();
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    />
                  </>
                )}
                {preview && (
                  <>
                    <h3>{preview.artifact.displayName}</h3>
                    {/^(text\/|image\/(png|jpeg|gif|webp)|application\/(pdf|json))/.test(
                      preview.artifact.mediaType,
                    ) ? (
                      <iframe
                        title="成果预览"
                        sandbox="allow-same-origin"
                        src={apiPath(`/files/${preview.artifact.fileId}/content`)}
                      />
                    ) : (
                      <p>此文件类型请下载后打开。</p>
                    )}
                  </>
                )}
              </aside>
            )}
          </div>
          {plan && (
            <PlanEditor
              key={plan.id + ":" + plan.revision}
              plan={plan}
              runs={data.activations.filter((a) => a.automationId === plan.id)}
              disabled={blocked}
              canRun={data.actions["automations.run"]?.available === true}
              reason={data.actions["automations.run"]?.reason}
              onSave={async (body) => {
                if (await mutate(`/automations/${plan.id}`, "PATCH", body)) setPlan(undefined);
              }}
              onPause={async () => {
                if (
                  await mutate(`/automations/${plan.id}/pause`, "POST", {
                    expectedRevision: plan.revision,
                  })
                )
                  setPlan(undefined);
              }}
              onRun={async () => {
                await mutate(`/automations/${plan.id}/run`, "POST", {});
              }}
              onClose={() => setPlan(undefined)}
              onOpenSession={openSource}
            />
          )}
          {memory !== undefined && (
            <MemoryEditor
              memory={memory}
              project={project}
              disabled={blocked}
              onClose={() => setMemory(undefined)}
              onSave={async (body, deleting) => {
                if (
                  await mutate(
                    memory ? `/memory/${memory.id}` : "/memory",
                    memory ? "PATCH" : "POST",
                    { ...body, status: deleting ? "deleted" : "confirmed" },
                  )
                )
                  setMemory(undefined);
              }}
            />
          )}
        </>
      )}
    </section>
  );
}

function HubEmpty({
  title,
  text,
  action,
  onAction,
}: {
  title: string;
  text: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="hub-empty">
      <Layers size={25} />
      <h3>{title}</h3>
      <p>{text}</p>
      {action && (
        <button type="button" onClick={onAction}>
          {action}
        </button>
      )}
    </div>
  );
}

function PlanEditor({
  plan,
  runs,
  disabled,
  canRun,
  reason,
  onSave,
  onPause,
  onRun,
  onClose,
  onOpenSession,
}: {
  plan: Automation;
  runs: WorkbenchOverview["activations"];
  disabled: boolean;
  canRun: boolean;
  reason?: string | null;
  onSave: (body: unknown) => Promise<void>;
  onPause: () => Promise<void>;
  onRun: () => Promise<void>;
  onClose: () => void;
  onOpenSession: (id: string | null) => void;
}) {
  const [name, setName] = useState(plan.name),
    [prompt, setPrompt] = useState(plan.promptTemplate),
    [zone, setZone] = useState(plan.timeZone);
  const [timing, setTiming] = useState(() => scheduleEditorValue(plan.trigger));
  const [maxRuns, setMaxRuns] = useState(String(plan.limits.maxRuns ?? 0)),
    [maxCost, setMaxCost] = useState(String(plan.limits.maxCostUsd ?? 0));
  const [error, setError] = useState("");
  const [occurrences, setOccurrences] = useState<string[]>([]);
  const body = () => {
    if (!name.trim() || !prompt.trim() || !zone.trim())
      throw new Error("请填写名称、工作内容和时区。");
    if (
      (maxRuns && (!Number.isInteger(Number(maxRuns)) || Number(maxRuns) < 0)) ||
      (maxCost && (!Number.isFinite(Number(maxCost)) || Number(maxCost) < 0))
    )
      throw new Error("次数须为非负整数，预算须为非负数；0 表示不限制。");
    const {
      id: _id,
      revision,
      dispatchGeneration: _d,
      effectiveAt: _e,
      nextDueAt: _n,
      createdAt: _c,
      updatedAt: _u,
      ...input
    } = plan;
    return {
      ...input,
      expectedRevision: revision,
      name,
      promptTemplate: prompt,
      timeZone: zone,
      trigger: editorTrigger(timing),
      enabled: true,
      limits: {
        ...(maxRuns ? { maxRuns: Number(maxRuns) } : {}),
        ...(maxCost ? { maxCostUsd: Number(maxCost) } : {}),
      },
    };
  };
  return (
    <section className="hub-editor" aria-label="计划详情">
      <div className="hub-actions">
        <h3>{plan.name}</h3>
        <button type="button" className="hub-link" onClick={onClose}>
          <X size={16} />
          关闭
        </button>
      </div>
      <p>暂停只影响后续触发；立即执行会新增一次运行，不改变原定时间。</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            void onSave(body());
          } catch (failure) {
            setError((failure as Error).message);
          }
        }}
      >
        <label>
          计划名称
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          工作内容
          <textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} required />
        </label>
        <ScheduleFields
          value={timing}
          onChange={(value) => {
            setTiming(value);
            setOccurrences([]);
          }}
          zone={zone}
          onZoneChange={(value) => {
            setZone(value);
            setOccurrences([]);
          }}
        />
        <details>
          <summary>高级设置</summary>
          <label>
            最多执行次数（0 不限制）
            <input
              type="number"
              min="0"
              step="1"
              value={maxRuns}
              onChange={(e) => setMaxRuns(e.target.value)}
            />
          </label>
          <label>
            最高费用 USD（0 不限制）
            <input
              type="number"
              min="0"
              step="any"
              value={maxCost}
              onChange={(e) => setMaxCost(e.target.value)}
            />
          </label>
        </details>
        <div className="hub-actions">
          <button type="submit" disabled={disabled}>
            保存并启用
          </button>
          <button type="button" disabled={disabled} onClick={onPause}>
            暂停计划
          </button>
          <button
            type="button"
            disabled={disabled || !canRun || !plan.enabled}
            title={reason ?? ""}
            onClick={onRun}
          >
            立即执行
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              try {
                void api<{ occurrences: string[] }>("/automations/preview", "POST", {
                  ...body(),
                  requestId: crypto.randomUUID(),
                })
                  .then((v) => {
                    setOccurrences(v.occurrences);
                    setError("");
                  })
                  .catch((e: Error) => setError(e.message));
              } catch (failure) {
                setError((failure as Error).message);
              }
            }}
          >
            预览时间
          </button>
        </div>
        {error && <p role="alert">{error}</p>}
        {occurrences.map((at) => (
          <p key={at}>
            {formatDate(at)} · {zone}
          </p>
        ))}
      </form>
      <h3>运行记录</h3>
      {!runs.length && <p>暂无运行记录。</p>}
      {runs.map((run) => (
        <div className="hub-row" key={run.id}>
          <span>
            <strong>{formatDate(run.receivedAt)}</strong>
            <small>
              {
                {
                  accepted: "已接收",
                  deferred: "已延后",
                  dispatched: "执行中",
                  confirmed: "已确认",
                  unknown: "待核对",
                  cancelled: "已取消",
                  observed: "已观察",
                }[run.status]
              }
              {run.lastError ? " · " + run.lastError : ""}
            </small>
          </span>
          {run.sessionId && (
            <button type="button" className="hub-link" onClick={() => onOpenSession(run.sessionId)}>
              查看对话
            </button>
          )}
        </div>
      ))}
    </section>
  );
}

function MemoryEditor({
  memory,
  project,
  disabled,
  onSave,
  onClose,
}: {
  memory: MemoryEntry | null;
  project: string;
  disabled: boolean;
  onSave: (body: Record<string, unknown>, deleting?: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const [subject, setSubject] = useState(memory?.subject ?? ""),
    [content, setContent] = useState(memory?.content ?? "");
  const body = {
    subject,
    content,
    scope: memory?.scope ?? (project ? "project" : "user"),
    projectId: memory ? memory.projectId : project || null,
    sourceRefs: memory?.sourceRefs ?? ["user:workbench"],
    ...(memory ? { expectedRevision: memory.revision } : {}),
  };
  return (
    <section className="hub-editor" aria-label="约定编辑">
      <h3>{memory ? "编辑约定" : "新增约定"}</h3>
      <p>{body.scope === "user" ? "作用于全局主对话" : "作用于所属项目"}；确认后下轮生效。</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSave(body);
        }}
      >
        <label>
          约定主题
          <input required value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <label>
          约定内容
          <textarea
            required
            rows={5}
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </label>
        <div className="hub-actions">
          <button type="submit" disabled={disabled}>
            保存并确认
          </button>
          {memory && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                if (confirm("删除这条长期约定？下轮起不再使用。")) void onSave(body, true);
              }}
            >
              删除约定
            </button>
          )}
          <button type="button" onClick={onClose}>
            取消
          </button>
        </div>
      </form>
    </section>
  );
}
