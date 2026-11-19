import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleDashed,
  GitBranch,
  ListTodo,
  Minus,
  RotateCw,
  X,
} from "lucide-react";
import type {
  AgentSummary,
  HarnessId,
  RuntimeEvent,
  SessionActivity,
  TodoList,
} from "@kodo/protocol";
import { api } from "../lib/host-client";
import { AgentNavigationContext } from "../lib/agent-navigation-context";
import { Modal } from "./Motion";
import { Transcript } from "./TranscriptView";
import { FilePreviewContext, FileChangesContext } from "../lib/file-preview-context";

export const agentStatus = (status?: string) =>
  ({
    running: "进行中",
    busy: "进行中",
    pendingInit: "启动中",
    completed: "已完成",
    idle: "空闲",
    failed: "失败",
    errored: "失败",
    cancelled: "已停止",
    stopped: "已停止",
    shutdown: "已停止",
  })[status ?? ""] ??
  status ??
  "状态未知";

export function TodoPanel({ list }: { list?: TodoList }) {
  const [open, setOpen] = useState(() =>
    typeof window !== "undefined" ? !window.matchMedia("(max-width: 760px)").matches : true,
  );
  if (!list?.items.length) return null;
  const completed = list.items.filter((item) => item.status === "completed").length;
  const current = list.items.find((item) => item.status === "in_progress");
  const labels = {
    pending: "待开始",
    in_progress: "进行中",
    completed: "已完成",
    cancelled: "已取消",
    blocked: "受阻",
    unknown: "状态未知",
  };
  return (
    <details
      className="conversation-todos"
      aria-label="任务清单"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        <ListTodo size={16} aria-hidden="true" />
        <strong>任务清单</strong>
        <span className="conversation-todos__count">
          {completed}/{list.items.length}
        </span>
        {current && <span className="conversation-todos__current">{current.text}</span>}
        <ChevronRight size={14} className="conversation-todos__chevron" aria-hidden="true" />
      </summary>
      <div className="conversation-todos__body">
        {list.explanation && <p>{list.explanation}</p>}
        <ul>
          {list.items.map((item) => {
            const Icon =
              item.status === "completed"
                ? Check
                : item.status === "in_progress"
                  ? CircleDashed
                  : item.status === "cancelled"
                    ? Minus
                    : Circle;
            return (
              <li key={item.id} data-status={item.status}>
                <Icon size={15} aria-hidden="true" />
                <span>{item.text}</span>
                <small>{labels[item.status]}</small>
              </li>
            );
          })}
        </ul>
      </div>
    </details>
  );
}

interface AgentPage {
  agent: AgentSummary;
  events: RuntimeEvent[];
  olderCursor: number | null;
}
function AgentConversation({
  sessionId,
  agent,
  version,
  harnessId,
  onReturn,
  positions,
}: {
  sessionId: string;
  agent: AgentSummary;
  version: number;
  harnessId: HarnessId;
  onReturn: () => void;
  positions: Map<string, number>;
}) {
  const [page, setPage] = useState<AgentPage>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const scroll = useRef<HTMLDivElement>(null);
  const following = useRef(!positions.has(agent.agentId));
  const restored = useRef(false);
  const prepend = useRef<{ height: number; top: number } | null>(null);
  const path = `/sessions/${encodeURIComponent(sessionId)}/agents/${encodeURIComponent(agent.agentId)}`;
  useEffect(() => {
    let cancelled = false;
    void api<AgentPage>(path)
      .then((next) => {
        if (cancelled) return;
        setPage((previous) => {
          if (!previous) return next;
          const merged = [
            ...new Map([...previous.events, ...next.events].map((e) => [e.sequence, e])).values(),
          ].sort((a, b) => a.sequence - b.sequence);
          return { ...next, events: merged, olderCursor: previous.olderCursor };
        });
        setError("");
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [path, version, retry]);
  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el || !page) return;
    if (prepend.current) {
      el.scrollTop = prepend.current.top + el.scrollHeight - prepend.current.height;
      prepend.current = null;
    } else if (!restored.current) {
      el.scrollTop = positions.get(agent.agentId) ?? el.scrollHeight;
      restored.current = true;
    } else if (following.current) el.scrollTop = el.scrollHeight;
  }, [page, positions, agent.agentId]);
  useEffect(
    () => () => {
      /* scroll positions are recorded on scroll, before unmount */
    },
    [],
  );
  const loadOlder = async () => {
    if (!page?.olderCursor || loading) return;
    setLoading(true);
    try {
      const next = await api<AgentPage>(path + "?before=" + page.olderCursor);
      const el = scroll.current;
      if (el) prepend.current = { height: el.scrollHeight, top: el.scrollTop };
      setPage((previous) =>
        previous
          ? {
              ...previous,
              olderCursor: next.olderCursor,
              events: [
                ...new Map(
                  [...next.events, ...previous.events].map((e) => [e.sequence, e]),
                ).values(),
              ].sort((a, b) => a.sequence - b.sequence),
            }
          : next,
      );
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <div
      className="chat-body agent-conversation"
      role="tabpanel"
      id="agent-conversation"
      aria-label={`子代理对话 · ${agent.name || agent.agentId}`}
    >
      <div className="conversation">
        <div
          className="transcript"
          ref={scroll}
          onScroll={() => {
            const el = scroll.current;
            if (!el) return;
            positions.set(agent.agentId, el.scrollTop);
            following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          <div className="transcript-inner">
            <header className="agent-conversation__heading">
              <GitBranch size={18} aria-hidden="true" />
              <div>
                <h2>{agent.name || agent.agentId}</h2>
                <span>{agentStatus(agent.status)}</span>
              </div>
            </header>
            {page?.olderCursor && (
              <button type="button" onClick={() => void loadOlder()} disabled={loading}>
                {loading ? "正在加载…" : "更早的子代理记录"}
              </button>
            )}
            {error && (
              <div role="alert" className="agent-conversation__notice">
                {error}
                <button type="button" onClick={() => setRetry((v) => v + 1)}>
                  <RotateCw size={14} />
                  重试
                </button>
              </div>
            )}
            {!page && !error && <p role="status">正在加载子代理对话…</p>}
            {page && !page.events.length && (
              <p className="agent-conversation__empty">
                尚未收到子代理的对话记录，当前仅有状态通知。
              </p>
            )}
            {page && (
              <Transcript
                events={page.events}
                harnessId={harnessId}
                subagent
                running={["running", "busy", "pendingInit"].includes(agent.status ?? "")}
              />
            )}
          </div>
        </div>
        <div className="agent-conversation__footer">
          <span>子代理的执行由主对话管理</span>
          <button type="button" onClick={onReturn}>
            返回主对话
          </button>
        </div>
      </div>
    </div>
  );
}

/** Keep the main composer and reading position mounted while opening a child's own transcript. */
export function ConversationWorkspace({
  sessionId,
  harnessId,
  events,
  children,
  onOpenFile,
  onOpenChanges,
  agentSheetOpen = false,
  onAgentSheetOpenChange,
  onSubagentsSummaryChange,
}: {
  sessionId: string;
  harnessId: HarnessId;
  events: RuntimeEvent[];
  children: ReactNode;
  onOpenFile: (path: string) => void;
  onOpenChanges: () => void;
  agentSheetOpen?: boolean;
  onAgentSheetOpenChange?: (open: boolean) => void;
  onSubagentsSummaryChange?: (summary: { count: number; selectedName: string | null }) => void;
}) {
  const [activity, setActivity] = useState<SessionActivity>();
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const positions = useRef(new Map<string, number>());
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const [collapsed, setCollapsed] = useState(false);
  const main = useRef<HTMLDivElement>(null);
  const mainPosition = useRef<{ top: number; bottom: boolean } | null>(null);
  const tabTrack = useRef<HTMLDivElement>(null);
  const [tabEdges, setTabEdges] = useState({ before: false, after: false });
  const relevant =
    events.filter((e) => ["subagent", "tool", "todo", "state"].includes(e.type)).at(-1)?.sequence ??
    0;
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void api<SessionActivity>(`/sessions/${encodeURIComponent(sessionId)}/activity`)
        .then((next) => {
          if (!cancelled) {
            setActivity(next);
            setError("");
          }
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        });
    }, 100);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sessionId, relevant, retry]);
  const agents = activity?.agents ?? [];
  const visibleAgents = agents.filter((a) => !closed.has(a.agentId));
  const agent = agents.find((a) => a.agentId === selected);
  const selectAgent = (id: string | null) => {
    if (!selected && id) {
      const el = main.current?.querySelector<HTMLElement>(".transcript");
      if (el)
        mainPosition.current = {
          top: el.scrollTop,
          bottom: el.scrollHeight - el.scrollTop - el.clientHeight < 80,
        };
    }
    setSelected(id);
  };
  const openAgent = (id: string) => {
    setClosed((current) => new Set([...current].filter((key) => key !== id)));
    setCollapsed(false);
    selectAgent(id);
    setRetry((v) => v + 1);
  };
  const closeAgent = (id: string) => {
    setClosed((current) => new Set([...current, id]));
    if (selected === id) selectAgent(null);
  };
  useEffect(() => {
    onSubagentsSummaryChange?.({
      count: agents.length,
      selectedName: selected ? agent?.name || selected : null,
    });
  }, [agents.length, selected, agent?.name, onSubagentsSummaryChange]);
  useLayoutEffect(() => {
    if (selected || !mainPosition.current) return;
    const el = main.current?.querySelector<HTMLElement>(".transcript");
    if (el) el.scrollTop = mainPosition.current.bottom ? el.scrollHeight : mainPosition.current.top;
  }, [selected]);
  useLayoutEffect(() => {
    const track = tabTrack.current;
    if (!track) return;
    const update = () =>
      setTabEdges({
        before: track.scrollLeft > 2,
        after: track.scrollLeft + track.clientWidth < track.scrollWidth - 2,
      });
    const selectedTab = track.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!selected) track.scrollLeft = 0;
    else if (selectedTab) {
      const left = selectedTab.offsetLeft - track.offsetLeft;
      if (left < track.scrollLeft) track.scrollLeft = left;
      else if (left + selectedTab.offsetWidth > track.scrollLeft + track.clientWidth)
        track.scrollLeft = left + selectedTab.offsetWidth - track.clientWidth;
    }
    const wheel = (event: WheelEvent) => {
      if (
        Math.abs(event.deltaY) > Math.abs(event.deltaX) &&
        track.scrollWidth > track.clientWidth
      ) {
        event.preventDefault();
        track.scrollLeft += event.deltaY;
      }
    };
    const observer = new ResizeObserver(update);
    observer.observe(track);
    track.addEventListener("scroll", update, { passive: true });
    track.addEventListener("wheel", wheel, { passive: false });
    update();
    return () => {
      observer.disconnect();
      track.removeEventListener("scroll", update);
      track.removeEventListener("wheel", wheel);
    };
  }, [selected, visibleAgents.length, collapsed, agents.length]);
  return (
    <FilePreviewContext.Provider value={onOpenFile}>
      <FileChangesContext.Provider value={onOpenChanges}>
        <AgentNavigationContext.Provider value={openAgent}>
          <div className="conversation-workspace">
            {agents.length > 0 && (
              <div className="agent-navigation desktop-only-flex">
                <div
                  className="conversation-tabs"
                  ref={tabTrack}
                  role="tablist"
                  aria-label="主对话与子代理"
                  onKeyDown={(event) => {
                    const tabs = [
                      ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
                    ];
                    const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
                    if (event.key === "Delete" && index > 0 && selected) {
                      event.preventDefault();
                      closeAgent(selected);
                      return;
                    }
                    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                    event.preventDefault();
                    const next =
                      event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? tabs.length - 1
                          : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
                            tabs.length;
                    tabs[next]?.focus();
                    tabs[next]?.click();
                  }}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={!selected}
                    tabIndex={!selected ? 0 : -1}
                    onClick={() => selectAgent(null)}
                  >
                    主对话
                  </button>
                  {!collapsed &&
                    visibleAgents.map((child) => (
                      <div className="conversation-tab" key={child.agentId}>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={selected === child.agentId}
                          tabIndex={selected === child.agentId ? 0 : -1}
                          onClick={() => openAgent(child.agentId)}
                          title={child.agentId}
                        >
                          <GitBranch size={14} aria-hidden="true" />
                          <span>{child.name || child.agentId}</span>
                          <small>{agentStatus(child.status)}</small>
                        </button>
                        <button
                          type="button"
                          className="conversation-tab__close"
                          aria-label={`关闭子代理标签：${child.name || child.agentId}`}
                          title="仅关闭标签，不停止任务"
                          onClick={() => closeAgent(child.agentId)}
                        >
                          <X size={13} aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                </div>
                <div className="agent-navigation__controls">
                  {!collapsed && (tabEdges.before || tabEdges.after) && (
                    <>
                      <button
                        type="button"
                        aria-label="向前滚动子代理标签"
                        disabled={!tabEdges.before}
                        onClick={() =>
                          tabTrack.current?.scrollBy({ left: -260, behavior: "smooth" })
                        }
                      >
                        <ChevronLeft size={15} />
                      </button>
                      <button
                        type="button"
                        aria-label="向后滚动子代理标签"
                        disabled={!tabEdges.after}
                        onClick={() =>
                          tabTrack.current?.scrollBy({ left: 260, behavior: "smooth" })
                        }
                      >
                        <ChevronRight size={15} />
                      </button>
                    </>
                  )}
                  <select
                    aria-label="全部子代理"
                    value=""
                    onChange={(e) => {
                      if (e.target.value) openAgent(e.target.value);
                    }}
                  >
                    <option value="">全部子代理（{agents.length}）</option>
                    {agents.map((child) => (
                      <option key={child.agentId} value={child.agentId}>
                        {child.name || child.agentId} · {agentStatus(child.status)}
                        {closed.has(child.agentId) ? " · 已关闭标签" : ""}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    aria-label={collapsed ? "展开子代理标签" : "收起子代理标签"}
                    aria-expanded={!collapsed}
                    onClick={() => {
                      setCollapsed(!collapsed);
                      if (!collapsed) selectAgent(null);
                    }}
                  >
                    {collapsed ? "展开" : "收起"}
                  </button>
                </div>
              </div>
            )}
            {error && (
              <div className="agent-conversation__notice" role="alert">
                无法更新任务与子代理：{error}
                <button type="button" onClick={() => setRetry((v) => v + 1)}>
                  重试
                </button>
              </div>
            )}
            {selected && (
              <div className="mobile-subagent-banner mobile-only">
                <button
                  type="button"
                  className="mobile-subagent-banner__back"
                  onClick={() => selectAgent(null)}
                >
                  <ChevronLeft size={15} />
                  <span>返回主对话</span>
                </button>
                <span className="mobile-subagent-banner__title">{agent?.name || selected}</span>
                {agents.length > 0 && onAgentSheetOpenChange && (
                  <button
                    type="button"
                    className="mobile-subagent-banner__switch"
                    onClick={() => onAgentSheetOpenChange(true)}
                  >
                    切换
                  </button>
                )}
              </div>
            )}
            <TodoPanel list={selected ? agent?.todos : activity?.todos} />
            <div className="conversation-main" hidden={Boolean(selected)} ref={main}>
              {children}
            </div>
            {selected &&
              (agent ? (
                <AgentConversation
                  key={selected}
                  sessionId={sessionId}
                  harnessId={harnessId}
                  agent={agent}
                  version={activity?.cursor ?? 0}
                  positions={positions.current}
                  onReturn={() => selectAgent(null)}
                />
              ) : (
                <div className="agent-conversation__notice" role="status">
                  正在读取子代理…
                  <button type="button" onClick={() => selectAgent(null)}>
                    返回主对话
                  </button>
                </div>
              ))}
            {agentSheetOpen && onAgentSheetOpenChange && (
              <Modal
                title="子代理切换"
                subtitle={`${agents.length} 个后台子代理线程`}
                onClose={() => onAgentSheetOpenChange(false)}
              >
                <div className="ios-inset-group">
                  <button
                    type="button"
                    className={`ios-sheet-action-row ${!selected ? "is-selected" : ""}`}
                    onClick={() => {
                      selectAgent(null);
                      onAgentSheetOpenChange(false);
                    }}
                  >
                    <span>主对话</span>
                    {!selected && <Check size={15} className="ios-menu__check" />}
                  </button>
                  {agents.map((child) => (
                    <button
                      type="button"
                      key={child.agentId}
                      className={`ios-sheet-action-row ${selected === child.agentId ? "is-selected" : ""}`}
                      onClick={() => {
                        openAgent(child.agentId);
                        onAgentSheetOpenChange(false);
                      }}
                    >
                      <GitBranch size={15} aria-hidden="true" />
                      <span className="mobile-subagent-option">
                        <strong>{child.name || child.agentId}</strong>
                        <small>{agentStatus(child.status)}</small>
                      </span>
                      {selected === child.agentId && (
                        <Check size={15} className="ios-menu__check" />
                      )}
                    </button>
                  ))}
                </div>
              </Modal>
            )}
          </div>
        </AgentNavigationContext.Provider>
      </FileChangesContext.Provider>
    </FilePreviewContext.Provider>
  );
}
