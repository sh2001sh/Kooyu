import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Bell,
  CornerDownLeft,
  FolderPlus,
  Layers,
  MessageSquare,
  PanelLeft,
  PanelRight,
  Plus,
  Search,
  ShieldAlert,
  SunMoon,
} from "lucide-react";
import type { InboxItem, Snapshot } from "@kodo/protocol";
import { HARNESS_NAMES, formatWorkspaceLabel } from "../lib/harnesses";
import { SETTINGS_GROUPS, SETTINGS_SECTIONS, type SettingsSectionId } from "./SettingsNavigation";

interface CommandItem {
  id: string;
  group: "操作" | "待处理" | "最近对话" | "设置";
  label: string;
  subtitle?: string;
  shortcut?: string;
  keywords: string;
  icon: ReactNode;
  run: () => void;
}

/**
 * Apple Spotlight / Linear-style frosted Command Palette (`⌘K` / `Ctrl+K`)
 * for instant jump across sessions, pending inbox items, workbench, and settings.
 */
export function CommandPalette({
  open,
  onClose,
  snapshot,
  pendingInbox,
  sidebarCollapsed,
  inspectorOpen,
  canToggleInspector,
  onOpenSession,
  onNewDraft,
  onNewProject,
  onToggleSidebar,
  onToggleInspector,
  onOpenWorkbench,
  onOpenInbox,
  onOpenSettings,
  onToggleTheme,
}: {
  open: boolean;
  onClose: () => void;
  snapshot: Snapshot;
  pendingInbox: InboxItem[];
  sidebarCollapsed: boolean;
  inspectorOpen: boolean;
  canToggleInspector: boolean;
  onOpenSession: (id: string) => void;
  onNewDraft: (projectId?: string | null) => void;
  onNewProject: () => void;
  onToggleSidebar: () => void;
  onToggleInspector: () => void;
  onOpenWorkbench: () => void;
  onOpenInbox: () => void;
  onOpenSettings: (section: SettingsSectionId) => void;
  onToggleTheme: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      setQuery("");
      setActiveIndex(0);
      if (!dialog.open) dialog.showModal();
      requestAnimationFrame(() => inputRef.current?.focus());
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  const items = useMemo<CommandItem[]>(() => {
    const actions: CommandItem[] = [
      {
        id: "action:new-draft",
        group: "操作",
        label: "新建对话",
        subtitle: "打开空白草稿工作台",
        shortcut: "⌘N",
        keywords: "new chat draft 新建 对话 草稿",
        icon: <Plus size={15} />,
        run: () => onNewDraft(null),
      },
      {
        id: "action:new-project",
        group: "操作",
        label: "新建项目",
        subtitle: "绑定本地仓库目录或创建项目分组",
        keywords: "new project folder directory 新建 项目 目录",
        icon: <FolderPlus size={15} />,
        run: onNewProject,
      },
      {
        id: "action:toggle-sidebar",
        group: "操作",
        label: sidebarCollapsed ? "展开左侧栏" : "折叠左侧栏",
        shortcut: "⌘B",
        keywords: "sidebar toggle panel 侧边栏 折叠 展开",
        icon: <PanelLeft size={15} />,
        run: onToggleSidebar,
      },
      ...(canToggleInspector
        ? [
            {
              id: "action:toggle-inspector",
              group: "操作" as const,
              label: inspectorOpen ? "收起检查器" : "打开检查器",
              shortcut: "⌘I",
              keywords: "inspector files diff changes 检查器 详情 文件 改动",
              icon: <PanelRight size={15} />,
              run: onToggleInspector,
            },
          ]
        : []),
      {
        id: "action:open-workbench",
        group: "操作",
        label: "打开工作中心",
        subtitle: "查看进行中与目标、交付成果和自动计划",
        keywords: "work workbench goals artifacts plans 工作 目标 成果 计划",
        icon: <Layers size={15} />,
        run: onOpenWorkbench,
      },
      {
        id: "action:open-inbox",
        group: "操作",
        label: "打开待办与审批",
        subtitle: pendingInbox.length ? `${pendingInbox.length} 项待处理` : "查看系统动态",
        keywords: "inbox todo approval notifications 待办 审批 通知",
        icon: <Bell size={15} />,
        run: onOpenInbox,
      },
      {
        id: "action:toggle-theme",
        group: "操作",
        label: "切换浅色 / 深色外观",
        keywords: "theme light dark appearance 主题 浅色 深色 外观",
        icon: <SunMoon size={15} />,
        run: onToggleTheme,
      },
    ];

    const inboxItems: CommandItem[] = pendingInbox.slice(0, 8).map((item) => {
      const session = snapshot.sessions.find((s) => s.id === item.sessionId);
      return {
        id: `inbox:${item.id}`,
        group: "待处理",
        label: session?.title ?? "待确认对话",
        subtitle: item.type === "interaction" ? "等待权限或提问确认" : "运行需要关注",
        keywords: `${session?.title ?? ""} ${item.type} approval inbox 审批 待处理`,
        icon: <ShieldAlert size={15} />,
        run: () => onOpenSession(item.sessionId),
      };
    });

    const projectNameMap = new Map(snapshot.projects.map((p) => [p.id, p.name]));
    const workspaceMap = new Map(snapshot.workspaces.map((w) => [w.id, w.rootPath]));
    const sessionItems: CommandItem[] = snapshot.sessions
      .filter((s) => !s.archived)
      .slice()
      .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)))
      .slice(0, 24)
      .map((s) => {
        const proj = s.projectId ? projectNameMap.get(s.projectId) : undefined;
        const ws = s.workspaceId ? formatWorkspaceLabel(workspaceMap.get(s.workspaceId)) : "";
        const sub = [proj, HARNESS_NAMES[s.harnessId], ws].filter(Boolean).join(" · ");
        return {
          id: `session:${s.id}`,
          group: "最近对话",
          label: s.title,
          subtitle: sub,
          keywords: `${s.title} ${sub} ${s.model ?? ""}`,
          icon: <MessageSquare size={15} />,
          run: () => onOpenSession(s.id),
        };
      });

    const settingItems: CommandItem[] = SETTINGS_GROUPS.flatMap((g) => g.items).map((id) => {
      const meta = SETTINGS_SECTIONS[id];
      const Icon = meta.Icon;
      return {
        id: `setting:${id}`,
        group: "设置",
        label: `设置 · ${meta.label}`,
        subtitle: meta.group,
        keywords: `${meta.label} ${meta.short} ${meta.group} ${id} settings 设置`,
        icon: <Icon size={15} />,
        run: () => onOpenSettings(id),
      };
    });

    return [...actions, ...inboxItems, ...sessionItems, ...settingItems];
  }, [
    canToggleInspector,
    inspectorOpen,
    onNewDraft,
    onNewProject,
    onOpenInbox,
    onOpenSession,
    onOpenSettings,
    onOpenWorkbench,
    onToggleInspector,
    onToggleSidebar,
    onToggleTheme,
    pendingInbox,
    sidebarCollapsed,
    snapshot.projects,
    snapshot.sessions,
    snapshot.workspaces,
  ]);

  const filtered = useMemo(() => {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return items;
    return items.filter((item) => {
      const hay = `${item.label} ${item.subtitle ?? ""} ${item.keywords}`.toLocaleLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [items, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (!open) return null;

  const grouped: Array<[CommandItem["group"], CommandItem[]]> = [];
  for (const item of filtered) {
    const last = grouped[grouped.length - 1];
    if (last && last[0] === item.group) last[1].push(item);
    else grouped.push([item.group, [item]]);
  }

  let flatCursor = -1;

  return (
    <dialog
      ref={dialogRef}
      className="cmd-palette"
      aria-label="命令面板"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
    >
      <div className="cmd-palette__search">
        <Search size={16} aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          aria-label="搜索命令、对话、设置"
          placeholder="搜索对话、待办或执行命令…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveIndex((prev) => (filtered.length ? (prev + 1) % filtered.length : 0));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIndex((prev) =>
                filtered.length ? (prev - 1 + filtered.length) % filtered.length : 0,
              );
            } else if (e.key === "Enter" && filtered[activeIndex]) {
              e.preventDefault();
              const chosen = filtered[activeIndex]!;
              onClose();
              chosen.run();
            }
          }}
        />
        <kbd className="cmd-palette__esc">Esc</kbd>
      </div>
      <div className="cmd-palette__results" role="listbox" aria-label="匹配结果">
        {!filtered.length ? (
          <div className="cmd-palette__empty">没有匹配“{query}”的对话或命令</div>
        ) : (
          grouped.map(([group, groupItems]) => (
            <div className="cmd-palette__group" key={group}>
              <div className="cmd-palette__group-title">{group}</div>
              {groupItems.map((item) => {
                flatCursor += 1;
                const idx = flatCursor;
                const selected = idx === activeIndex;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={`cmd-palette__item ${selected ? "is-selected" : ""}`}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => {
                      onClose();
                      item.run();
                    }}
                  >
                    <span className="cmd-palette__item-icon" aria-hidden="true">
                      {item.icon}
                    </span>
                    <span className="cmd-palette__item-text">
                      <strong>{item.label}</strong>
                      {item.subtitle && <small>{item.subtitle}</small>}
                    </span>
                    {item.shortcut ? (
                      <kbd className="cmd-palette__shortcut">{item.shortcut}</kbd>
                    ) : (
                      selected && <CornerDownLeft size={13} className="cmd-palette__return" />
                    )}
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
    </dialog>
  );
}
