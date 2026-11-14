import React, { useState } from "react";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Folder,
  Inbox,
  Layers,
  MessageSquare,
  Pin,
  Plus,
  Search,
  X,
} from "lucide-react";
import { HARNESS_IDS } from "@kodo/protocol/client";
import type { HarnessId, Project, Session, Supervision } from "@kodo/protocol";
import {
  HARNESS_NAMES,
  RUN_STATE_LABELS,
  formatRelativeDate,
  shortModelLabel,
} from "../lib/harnesses";
import { HarnessBadge, KodoMark } from "./KodoBrand";
import { useSidebarActions } from "./useSidebarActions";

type SearchHit = { sessionId: string; eventId?: string; snippet?: string };

export type SidebarViewMode = "project" | "harness";

export interface SessionRowsProps {
  viewMode: SidebarViewMode;
  onViewModeChange: (mode: SidebarViewMode) => void;
  scope: string;
  masters: Session[];
  list: Session[];
  projects: Project[];
  selected: string | null;
  query: string;
  showArchived: boolean;
  pendingCount: number;
  searchHits: SearchHit[];
  supervisions: Supervision[];
  projectNames: Map<string, string>;
  onQueryChange: (q: string) => void;
  onToggleArchived: () => void;
  onSelectSession: (id: string, eventId?: string) => void;
  onOpenInbox: () => void;
  onCreateMaster: () => void;
  onCreateProject: () => void;
  onCreateInProject: (projectId: string | null) => void;
  onCreateWithHarness: (harnessId: HarnessId) => void;
  onDeleteSession?: (session: Session) => void;
  onDeleteProject?: (project: Project) => void;
  onEditProject: (project: Project) => void;
  act: (work: () => Promise<unknown>) => Promise<void>;
}

function sortGroupSessions(items: Session[]): Session[] {
  return [...items].sort(
    (a, b) =>
      Number(b.kind === "supervisor") - Number(a.kind === "supervisor") ||
      Number(b.pinned) - Number(a.pinned) ||
      b.createdAt.localeCompare(a.createdAt),
  );
}

/**
 * Three-tier flattened sidebar body:
 * 1) Search + archive bar
 * 2) L0 pinned Kodo global masters (+ quick Inbox pill)
 * 3) 2-tab "按项目 | 按 Harness" view switcher + collapsible tree
 */
export function SessionRows({
  viewMode,
  onViewModeChange,
  scope,
  masters,
  list,
  projects,
  selected,
  query,
  showArchived,
  pendingCount,
  searchHits,
  supervisions,
  projectNames,
  onQueryChange,
  onToggleArchived,
  onSelectSession,
  onOpenInbox,
  onCreateMaster,
  onCreateProject,
  onCreateInProject,
  onCreateWithHarness,
  onDeleteSession,
  onDeleteProject,
  onEditProject,
  act,
}: SessionRowsProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const actions = useSidebarActions({
    sessions: [...masters, ...list],
    projects,
    act,
    onDeleteSession,
    onDeleteProject,
    onEditProject,
  });
  const searching = query.trim().length > 0;

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const renderSessionRow = (s: Session, mode: SidebarViewMode) => {
    const supervised = supervisions.some(
      (w) => w.targetSessionId === s.id && w.state === "active" && w.mode === "continue",
    );
    const hit = searching ? searchHits.find((h) => h.sessionId === s.id) : undefined;
    const projName = s.projectId ? projectNames.get(s.projectId) : undefined;
    const stateText =
      s.kind === "supervisor"
        ? "项目主对话"
        : s.phase === "draft"
          ? "尚未启动"
          : RUN_STATE_LABELS[s.runState];

    return (
      <div
        className="session-row-wrap"
        key={s.id}
        onContextMenu={(event) => actions.open(event, { kind: "session", value: s })}
      >
        {actions.renamingId === s.id ? (
          actions.renameForm(s)
        ) : (
          <>
            <button
              type="button"
              title={s.title}
              className={`session-row ${selected === s.id ? "selected" : ""} ${
                s.archived ? "is-archived" : ""
              }`}
              aria-current={selected === s.id ? "true" : undefined}
              onClick={() => onSelectSession(s.id, hit?.eventId)}
              onKeyDown={(event) => actions.keyboard(event, { kind: "session", value: s })}
              aria-haspopup="menu"
            >
              <HarnessBadge harnessId={s.harnessId} size="xs" tone="mono" />
              <div className="session-row__content">
                <div className="session-title">
                  <span>{s.title}</span>
                  {s.unread && <span className="session-unread" aria-label="未读" />}
                  {s.kind === "supervisor" && (
                    <span className="mini-pill mini-pill--subtle">主对话</span>
                  )}
                  {s.pinned && <Pin size={11} className="session-row__pin" />}
                  {(s.runState === "running" || s.runState === "waiting-input") && (
                    <span className={`status-dot ${s.runState}`} />
                  )}
                </div>
                <div className="session-meta">
                  <span className="harness-label">
                    {mode === "project" ? HARNESS_NAMES[s.harnessId] : (projName ?? "未归属")}
                  </span>
                  <span className="session-meta__sep" aria-hidden="true">
                    ·
                  </span>
                  <span className={`session-state-text is-${s.runState}`}>{stateText}</span>
                  {s.model && <span className="session-model-tag">{shortModelLabel(s.model)}</span>}
                  {supervised && <span className="session-model-tag">托管中</span>}
                  <span className="row-date">{formatRelativeDate(s.createdAt)}</span>
                </div>
                {hit?.snippet && <div className="search-snippet">{hit.snippet}</div>}
              </div>
            </button>
            {actions.more({ kind: "session", value: s })}
          </>
        )}
      </div>
    );
  };

  const renderGroup = ({
    groupKey,
    title,
    icon,
    items,
    addLabel,
    onAdd,
    project,
  }: {
    groupKey: string;
    title: string;
    icon: React.ReactNode;
    items: Session[];
    addLabel: string;
    onAdd: () => void;
    project?: Project;
  }) => {
    const isOpen = searching || !collapsedGroups.has(groupKey);
    return (
      <section className="tree-group" key={groupKey}>
        <div
          className="tree-group__header"
          onContextMenu={
            project
              ? (event) => actions.open(event, { kind: "project", value: project })
              : undefined
          }
        >
          <button
            type="button"
            className="tree-group__toggle"
            aria-expanded={isOpen}
            onClick={() => toggleGroup(groupKey)}
            onKeyDown={
              project
                ? (event) => actions.keyboard(event, { kind: "project", value: project })
                : undefined
            }
          >
            {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            <span className="tree-group__icon" aria-hidden="true">
              {icon}
            </span>
            <span className="tree-group__name">{title}</span>
            {project?.pinned && <Pin size={11} aria-label="已置顶" />}
            <span className="tree-group__count">{items.length}</span>
          </button>
          <button
            type="button"
            className="tree-group__add"
            aria-label={addLabel}
            title={addLabel}
            onClick={onAdd}
          >
            <Plus size={13} />
          </button>
          {project && actions.more({ kind: "project", value: project })}
        </div>
        {isOpen && items.length > 0 && (
          <div className="tree-group__rows">{items.map((s) => renderSessionRow(s, viewMode))}</div>
        )}
      </section>
    );
  };

  const unassigned = sortGroupSessions(list.filter((s) => !s.projectId));

  return (
    <>
      {actions.menu}
      {actions.notice && (
        <p role="status" className="sidebar-action-notice">
          {actions.notice}
        </p>
      )}
      <div className="list-controls">
        <div className="search">
          <Search size={14} />
          <input
            aria-label="搜索历史"
            placeholder="搜索对话…"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
          />
          {query && (
            <button
              type="button"
              className="search__clear"
              aria-label="清除搜索"
              onClick={() => onQueryChange("")}
            >
              <X size={12} />
            </button>
          )}
        </div>

        <button
          type="button"
          className={`filter-icon-btn ${showArchived ? "active" : ""}`}
          title="显示归档"
          aria-label="显示归档"
          aria-pressed={showArchived}
          onClick={onToggleArchived}
        >
          <Archive size={14} />
        </button>
      </div>

      {/* Unified flat nav + L0 Kodo Masters (no boxed card banner) */}
      <div className="sidebar__section">
        <button
          type="button"
          className={`nav-row ${scope === "inbox" ? "selected" : ""}`}
          aria-label="待处理"
          title="查看待处理通知与交互"
          onClick={onOpenInbox}
        >
          <Inbox size={14} className="nav-row__icon" aria-hidden="true" />
          <span className="nav-row__title">待处理</span>
          {pendingCount > 0 && <span className="nav-row__badge">{pendingCount}</span>}
        </button>

        <div className="sidebar__section-head">
          <span className="sidebar__section-label">主对话</span>
          <button
            type="button"
            className="tree-group__add"
            aria-label="新建主对话"
            title="开启 Kooyu 全局主对话"
            onClick={onCreateMaster}
          >
            <Plus size={13} />
          </button>
        </div>

        {masters.length > 0 ? (
          <div className="pinned-masters__list">
            {masters.map((m) => {
              const activeCount = supervisions.filter(
                (w) => w.controllerSessionId === m.id && w.state === "active",
              ).length;
              if (actions.renamingId === m.id) return <div key={m.id}>{actions.renameForm(m)}</div>;
              return (
                <div
                  className="session-row-wrap"
                  key={m.id}
                  onContextMenu={(event) => actions.open(event, { kind: "session", value: m })}
                >
                  <button
                    type="button"
                    key={m.id}
                    title={m.title}
                    className={`master-row ${selected === m.id ? "selected" : ""} ${
                      m.archived ? "is-archived" : ""
                    }`}
                    aria-current={selected === m.id ? "true" : undefined}
                    onClick={() => onSelectSession(m.id)}
                    onKeyDown={(event) => actions.keyboard(event, { kind: "session", value: m })}
                    aria-haspopup="menu"
                  >
                    <span className="master-row__mark" aria-hidden="true">
                      <KodoMark size={15} />
                    </span>
                    <div className="master-row__content">
                      <div className="master-row__title">
                        <span>{m.title}</span>
                        {m.unread && <span className="session-unread" aria-label="未读" />}
                        {m.pinned && <Pin size={11} />}
                        {(m.runState === "running" || m.runState === "waiting-input") && (
                          <span className={`status-dot ${m.runState}`} />
                        )}
                      </div>
                      <div className="master-row__meta">
                        <span>
                          {activeCount > 0 ? `正在统筹 ${activeCount} 个会话` : "跨项目主对话"}
                        </span>
                        <span className="row-date">{formatRelativeDate(m.createdAt)}</span>
                      </div>
                    </div>
                  </button>
                  {actions.more({ kind: "session", value: m })}
                </div>
              );
            })}
          </div>
        ) : (
          <button type="button" className="nav-row nav-row--subtle" onClick={onCreateMaster}>
            <span className="master-row__mark" aria-hidden="true">
              <KodoMark size={14} />
            </span>
            <span className="nav-row__title">开启 Kooyu 主对话</span>
            <Plus size={13} className="nav-row__trailing" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Minimalist 2-tab View Switcher: 按项目 | 按 Harness (DeepSeek-style clean underline tabs) */}
      <div className="sidebar__tabs-wrap">
        <div
          className="sidebar-tabs"
          data-active-index={viewMode === "project" ? "0" : "1"}
          role="group"
          aria-label="列表分组视角"
        >
          <button
            type="button"
            className={viewMode === "project" ? "active" : ""}
            aria-pressed={viewMode === "project"}
            onClick={() => onViewModeChange("project")}
          >
            按项目
          </button>
          <button
            type="button"
            className={viewMode === "harness" ? "active" : ""}
            aria-pressed={viewMode === "harness"}
            onClick={() => onViewModeChange("harness")}
          >
            按 Harness
          </button>
        </div>
      </div>

      {/* Collapsible 3-tier tree */}
      <div className="session-rows">
        {viewMode === "project" ? (
          <>
            {[...projects]
              .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)))
              .map((p) => {
                const items = sortGroupSessions(list.filter((s) => s.projectId === p.id));
                if (searching && items.length === 0) return null;
                return renderGroup({
                  groupKey: `project:${p.id}`,
                  title: p.name,
                  icon: <Folder size={13} />,
                  items,
                  addLabel: `在 ${p.name} 新建会话`,
                  onAdd: () => onCreateInProject(p.id),
                  project: p,
                });
              })}

            {unassigned.length > 0 &&
              renderGroup({
                groupKey: "project:unassigned",
                title: "未归属对话",
                icon: <Layers size={13} />,
                items: unassigned,
                addLabel: "新建未归属会话",
                onAdd: () => onCreateInProject(null),
              })}

            {projects.length === 0 && list.length === 0 && (
              <div className="list-empty list-empty--compact">
                <span className="list-empty__icon" aria-hidden="true">
                  <MessageSquare size={20} />
                </span>
                <strong>{searching ? "无匹配结果" : "暂无会话"}</strong>
              </div>
            )}

            <button
              type="button"
              className="tree-new-project"
              aria-label="创建项目"
              onClick={onCreateProject}
            >
              <Plus size={14} />
              <span>创建项目</span>
            </button>
          </>
        ) : (
          <>
            {HARNESS_IDS.map((hId) => {
              const items = sortGroupSessions(list.filter((s) => s.harnessId === hId));
              if (items.length === 0) return null;
              return renderGroup({
                groupKey: `harness:${hId}`,
                title: HARNESS_NAMES[hId],
                icon: <HarnessBadge harnessId={hId} size="xs" tone="mono" />,
                items,
                addLabel: `新建 ${HARNESS_NAMES[hId]} 会话`,
                onAdd: () => onCreateWithHarness(hId),
              });
            })}

            {list.length === 0 && (
              <div className="list-empty list-empty--compact">
                <span className="list-empty__icon" aria-hidden="true">
                  <MessageSquare size={20} />
                </span>
                <strong>{searching ? "无匹配结果" : "暂无会话"}</strong>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
