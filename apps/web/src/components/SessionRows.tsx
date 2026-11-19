import React, { useState } from "react";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Folder,
  Inbox,
  Layers,
  LayoutList,
  MessageSquare,
  Pin,
  Plus,
  Search,
  X,
} from "lucide-react";
import { HARNESS_IDS } from "@kodo/protocol/client";
import type { HarnessId, Project, Session, Supervision } from "@kodo/protocol";
import { HARNESS_NAMES, formatRelativeDate, shortModelLabel } from "../lib/harnesses";
import { useT } from "../lib/i18n";
import { HarnessBadge, KodoMark } from "./KodoBrand";
import { SegmentedControl } from "./SegmentedControl";
import { StatusBadge, sessionStatusTone } from "./StatusBadge";
import { useSidebarActions } from "./useSidebarActions";

type SearchHit = { sessionId: string; eventId?: string; snippet?: string };

export type SidebarViewMode = "recent" | "project" | "harness";

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
  onOpenWorkbench: () => void;
  onOpenInbox: () => void;
  onCreateMaster: (text?: string) => void;
  onCreateProject: () => void;
  onCreateInProject: (projectId: string | null) => void;
  onCreateWithHarness: (harnessId: HarnessId) => void;
  onDeleteSession?: (session: Session) => void;
  onDeleteProject?: (project: Project) => void;
  onEditProject: (project: Project) => void;
  onOpenProjectOverview?: (projectId: string) => void;
  onOpenCommandPalette?: () => void;
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
  onOpenWorkbench,
  onOpenInbox,
  onCreateMaster,
  onCreateProject,
  onCreateInProject,
  onCreateWithHarness,
  onDeleteSession,
  onDeleteProject,
  onEditProject,
  onOpenProjectOverview,
  onOpenCommandPalette,
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
    const tone = sessionStatusTone(s);
    // Second line stays short: in project view the badge already names the harness, so show the
    // model; in harness view show which project the session belongs to; in recent view show project + model.
    const modelTag = s.model ? shortModelLabel(s.model) : HARNESS_NAMES[s.harnessId];
    const detail =
      mode === "project"
        ? modelTag
        : mode === "recent"
          ? projName
            ? `${projName} · ${modelTag}`
            : modelTag
          : (projName ?? "未归属");

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
                  <span className="row-date">{formatRelativeDate(s.createdAt)}</span>
                </div>
                <div className="session-meta">
                  <StatusBadge tone={tone} className="session-state-text" />
                  <span className="session-meta__sep" aria-hidden="true">
                    ·
                  </span>
                  <span className="harness-label">{detail}</span>
                  {supervised && <span className="session-model-tag">托管中</span>}
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
          {project && onOpenProjectOverview && (
            <button
              type="button"
              className="tree-group__add"
              aria-label={`查看${project.name}项目概览`}
              title="项目概览"
              onClick={() => onOpenProjectOverview(project.id)}
            >
              <LayoutList size={13} />
            </button>
          )}
        </div>
        {isOpen && items.length > 0 && (
          <div className="tree-group__rows">{items.map((s) => renderSessionRow(s, viewMode))}</div>
        )}
      </section>
    );
  };

  const t = useT();
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
            placeholder={t("sidebar.searchPlaceholder")}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
          />
          {query ? (
            <button
              type="button"
              className="search__clear"
              aria-label="清除搜索"
              onClick={() => onQueryChange("")}
            >
              <X size={12} />
            </button>
          ) : (
            onOpenCommandPalette && (
              <button
                type="button"
                className="search-kbd-trigger desktop-only"
                aria-label="打开命令面板"
                title="命令面板 (⌘K / Ctrl+K)"
                onClick={onOpenCommandPalette}
              >
                <kbd>{navigator.userAgent.includes("Mac") ? "⌘K" : "Ctrl K"}</kbd>
              </button>
            )
          )}
        </div>
      </div>

      {/* Unified flat nav (工作 + 待处理 grouped under search) + L0 Kooyu Masters */}
      <div className="sidebar__section">
        <button
          type="button"
          className={`nav-row desktop-only ${scope === "workbench" ? "selected" : ""}`}
          aria-label="工作"
          title="工作与成果"
          onClick={onOpenWorkbench}
          aria-current={scope === "workbench" ? "page" : undefined}
        >
          <Layers size={14} className="nav-row__icon" aria-hidden="true" />
          <span className="nav-row__title">工作</span>
        </button>

        <button
          type="button"
          className={`nav-row session-rows-inbox-btn desktop-only ${scope === "inbox" ? "selected" : ""}`}
          aria-label="待处理"
          title="查看待处理通知与交互"
          onClick={onOpenInbox}
        >
          <Inbox size={14} className="nav-row__icon" aria-hidden="true" />
          <span className="nav-row__title">待处理</span>
          {pendingCount > 0 && <span className="nav-row__badge">{pendingCount}</span>}
        </button>

        {/* L0 pinned commander card: Kooyu 主对话 sits above every project group (deduplicated when empty). */}
        <div className="l0-card">
          {masters.length > 0 ? (
            <>
              <div className="l0-card__head desktop-only-flex">
                <span className="l0-card__mark" aria-hidden="true">
                  <KodoMark size={16} />
                </span>
                <span className="l0-card__title">Kooyu 主对话</span>
                <button
                  type="button"
                  className="tree-group__add"
                  aria-label="新建主对话"
                  title="开启 Kooyu 全局主对话"
                  onClick={() => onCreateMaster()}
                >
                  <Plus size={13} />
                </button>
              </div>
              <div className="pinned-masters__list">
                {masters.map((m) => {
                  const activeCount = supervisions.filter(
                    (w) => w.controllerSessionId === m.id && w.state === "active",
                  ).length;
                  if (actions.renamingId === m.id)
                    return <div key={m.id}>{actions.renameForm(m)}</div>;
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
                        onKeyDown={(event) =>
                          actions.keyboard(event, { kind: "session", value: m })
                        }
                        aria-haspopup="menu"
                      >
                        <span className="master-row__mark" aria-hidden="true">
                          <KodoMark size={15} />
                        </span>
                        <div className="master-row__content">
                          <div className="master-row__title">
                            <span>{m.title}</span>
                            <span className="mobile-master-tag mobile-only">全局主控</span>
                            {m.unread && <span className="session-unread" aria-label="未读" />}
                            {m.pinned && <Pin size={11} />}
                            <span className="row-date">{formatRelativeDate(m.createdAt)}</span>
                          </div>
                          <div className="master-row__meta">
                            <StatusBadge tone={sessionStatusTone(m)} />
                            <span className="session-meta__sep" aria-hidden="true">
                              ·
                            </span>
                            <span className="master-row__summary">
                              {activeCount > 0
                                ? `正在统筹 ${activeCount} 个会话`
                                : "统筹项目进展与自动计划"}
                            </span>
                          </div>
                        </div>
                      </button>
                      {actions.more({ kind: "session", value: m })}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <button
              type="button"
              className="nav-row nav-row--subtle master-empty-row"
              aria-label="开启 Kooyu 主对话"
              title="开启 Kooyu 全局主对话"
              onClick={() => onCreateMaster()}
            >
              <span className="master-row__mark" aria-hidden="true">
                <KodoMark size={15} />
              </span>
              <span className="nav-row__title">
                <span className="desktop-only">Kooyu 主对话</span>
                <span className="mobile-only">Kooyu 主对话 · 点击开启全局统筹</span>
              </span>
              <Plus size={14} className="nav-row__trailing" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {/* Mobile compact filter pills (全部对话 | 按项目 | 按引擎 | 已归档) */}
      <div className="mobile-filter-pills mobile-only-flex" role="group" aria-label="会话筛选视角">
        {(
          [
            ["recent", t("sidebar.tab.all")],
            ["project", t("sidebar.tab.projects")],
            ["harness", t("sidebar.tab.engines")],
          ] as Array<[SidebarViewMode, string]>
        ).map(([mode, label]) => {
          const active = !showArchived && viewMode === mode;
          return (
            <button
              type="button"
              key={mode}
              aria-pressed={active}
              className={`mobile-filter-pill ${active ? "is-active" : ""}`}
              onClick={() => {
                if (showArchived) onToggleArchived();
                onViewModeChange(mode);
              }}
            >
              {label}
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={showArchived}
          aria-label="显示归档"
          title={showArchived ? "返回进行中的会话" : "显示归档"}
          className={`mobile-filter-pill ${showArchived ? "is-active" : ""}`}
          onClick={onToggleArchived}
        >
          {t("sidebar.tab.archived")}
        </button>
      </div>

      {/* Desktop sliding segmented switcher: 按项目 | 按 Harness | 归档 */}
      <div className="sidebar__tabs-wrap desktop-only">
        <SegmentedControl<SidebarViewMode | "archived">
          className="sidebar-tabs"
          ariaLabel="列表分组视角"
          value={showArchived ? "archived" : viewMode === "recent" ? "project" : viewMode}
          options={[
            { value: "project", label: t("sidebar.tab.projects") },
            { value: "harness", label: t("sidebar.tab.harness") },
            {
              value: "archived",
              label: (
                <>
                  <Archive size={12} aria-hidden="true" />
                  {t("sidebar.tab.archivedShort")}
                </>
              ),
              ariaLabel: "显示归档",
              title: showArchived ? "返回进行中的会话" : "显示归档",
            },
          ]}
          onChange={(next) => {
            if (next === "archived") {
              onToggleArchived();
              return;
            }
            if (showArchived) onToggleArchived();
            onViewModeChange(next);
          }}
        />
      </div>

      {/* Session stream (flat chronological on mobile 'recent', or collapsible 3-tier tree) */}
      <div className="session-rows">
        {viewMode === "recent" ? (
          sortGroupSessions(list).length > 0 ? (
            <div className="tree-group">
              <div className="tree-group__rows">
                {sortGroupSessions(list).map((s) => renderSessionRow(s, "recent"))}
              </div>
            </div>
          ) : (
            <div className="list-empty list-empty--compact">
              <span className="list-empty__icon" aria-hidden="true">
                <MessageSquare size={20} />
              </span>
              <strong>
                {searching ? "无匹配结果" : showArchived ? "暂无归档会话" : "暂无会话"}
              </strong>
              {!searching && !showArchived && (
                <p className="list-empty__hint mobile-only-block">
                  点击右上角「新建」选择引擎或项目即可开始对话
                </p>
              )}
            </div>
          )
        ) : viewMode === "project" ? (
          <>
            {[...projects]
              .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)))
              .map((p) => {
                const items = sortGroupSessions(list.filter((s) => s.projectId === p.id));
                if ((searching || showArchived) && items.length === 0) return null;
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

            {(showArchived ? list.length === 0 : projects.length === 0 && list.length === 0) && (
              <div className="list-empty list-empty--compact">
                <span className="list-empty__icon" aria-hidden="true">
                  <MessageSquare size={20} />
                </span>
                <strong>
                  {searching ? "无匹配结果" : showArchived ? "暂无归档会话" : "暂无会话"}
                </strong>
                {!searching && !showArchived && (
                  <p className="list-empty__hint mobile-only-block">
                    上方可一键唤起任意引擎，或先创建项目归档管理代码工作区
                  </p>
                )}
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
                <strong>
                  {searching ? "无匹配结果" : showArchived ? "暂无归档会话" : "暂无会话"}
                </strong>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
