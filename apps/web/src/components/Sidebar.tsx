import type { ReactNode } from "react";
import { Moon, PanelLeft, Plus, Settings2, SquarePen, Sun, X } from "lucide-react";
import type { HarnessId, InboxItem } from "@kodo/protocol";
import { KodoMark } from "./KodoBrand";
import { KooyuWordmark } from "./KooyuWordmark";
import { useT } from "../lib/i18n";

export interface SidebarProps {
  scope: string;
  scopeName: string;
  pending: InboxItem[];
  connected: boolean;
  dark: boolean;
  collapsed: boolean;
  resizing: boolean;
  settingsMode?: boolean;
  settingsHeader?: ReactNode;
  onToggleDark: () => void;
  onToggleCollapsed: () => void;
  onNavigate: (next: string) => void;
  onCreateSession: (preset?: { projectId?: string | null; harnessId?: HarnessId }) => void;
  onOpenNav: () => void;
  onCloseNav: () => void;
  navOpen: boolean;
  /** Search controls, pinned masters, 2-tab switcher and collapsible tree rows, or settings nav. */
  children: ReactNode;
}

// Usage and devices are sections of Settings now; one entry point opens them all.
const TOOL_SCOPES = [{ id: "health", key: "settings.title", Icon: Settings2 }] as const;

/**
 * Compact 2-column sidebar chrome inspired by DeepSeek Harness & Codeg:
 * Top brand row -> dedicated full-width "新对话" pill button -> scrollable 3-tier list
 * -> bottom 3-up utility toolbar + Host connection bar.
 */
export function Sidebar({
  scope,
  scopeName,
  pending,
  connected,
  dark,
  collapsed,
  resizing,
  settingsMode = false,
  settingsHeader,
  onToggleDark,
  onToggleCollapsed,
  onNavigate,
  onCreateSession,
  onOpenNav,
  onCloseNav,
  navOpen,
  children,
}: SidebarProps) {
  const t = useT();
  const shortcut = navigator.userAgent.includes("Mac") ? "⌘N" : "Ctrl N";

  return (
    <aside
      className={`sidebar ${collapsed ? "is-collapsed" : ""} ${resizing ? "is-resizing" : ""} ${
        settingsMode ? "is-settings" : ""
      }`}
      aria-label={settingsMode ? "配置侧边栏" : "导航与会话"}
      data-nav-open={navOpen ? "true" : "false"}
    >
      {/* Mobile top bar: keeps search, pinned masters and project/harness tree front and center. */}
      <div className="sidebar__mobilebar">
        <button type="button" className="icon-button" aria-label="打开导航" onClick={onOpenNav}>
          <PanelLeft size={19} />
        </button>
        <h1>{scopeName}</h1>
        <button
          type="button"
          className="icon-button icon-button--tinted"
          aria-label="新建会话"
          title="新对话"
          onClick={() => onCreateSession()}
        >
          <Plus size={18} />
        </button>
      </div>

      <div className="sidebar__chrome">
        {settingsMode && settingsHeader ? (
          settingsHeader
        ) : (
          <>
            <div className="brand">
              <span className="brand-mark" aria-hidden="true">
                <KodoMark size={18} />
              </span>
              {!collapsed && <KooyuWordmark className="brand-title brand-wordmark" />}
              <div className="brand-actions">
                <button
                  type="button"
                  className="new-conversation"
                  aria-label="新建会话"
                  title={`新对话 (${shortcut})`}
                  onClick={() => onCreateSession()}
                >
                  <SquarePen size={13} strokeWidth={2} />
                  {!collapsed && <span>新对话</span>}
                </button>
                <button
                  type="button"
                  className="icon-button sidebar__collapse"
                  aria-label={collapsed ? "展开侧边栏" : "折叠侧边栏"}
                  aria-pressed={collapsed}
                  title={collapsed ? "展开侧边栏" : "折叠侧边栏"}
                  onClick={onToggleCollapsed}
                >
                  <PanelLeft size={15} />
                </button>
                <button
                  type="button"
                  className="icon-button sidebar__navclose"
                  aria-label="关闭导航"
                  onClick={onCloseNav}
                >
                  <X size={17} />
                </button>
              </div>
            </div>

            {/* Mobile slide-over drawer summary shortcuts */}
            <div className="sidebar__drawer-actions">
              <button
                type="button"
                className={`drawer-inbox-btn ${scope === "inbox" ? "active" : ""}`}
                onClick={() => onNavigate("inbox")}
              >
                <span>待处理通知</span>
                {pending.length > 0 && (
                  <span className="mini-pill mini-pill--coral">{pending.length}</span>
                )}
              </button>
            </div>
          </>
        )}
      </div>

      <div className="sidebar__list">{children}</div>

      <div className="sidebar__bottom">
        <nav className="sidebar__tools" aria-label="系统工具">
          {TOOL_SCOPES.map(({ id, key, Icon }) => {
            const label = t(key);
            const short = label;
            const active = ["health", "usage", "devices"].includes(scope);
            return (
              <button
                type="button"
                key={id}
                className={active ? "active" : ""}
                title={label}
                aria-label={label}
                aria-pressed={active}
                onClick={() => onNavigate(id)}
              >
                <Icon size={15} />
                {!collapsed && <span>{short}</span>}
              </button>
            );
          })}
        </nav>

        <div className="connection">
          <span className={`status-dot ${connected ? "online" : "unknown"}`} />
          {!collapsed && (
            <span className="connection__label">
              {connected ? "Host 已连接" : "桌面 Host 未连接"}
            </span>
          )}
          <button
            type="button"
            className="theme-toggle"
            aria-label={dark ? "浅色主题" : "深色主题"}
            title={dark ? "切换浅色主题" : "切换深色主题"}
            onClick={onToggleDark}
          >
            {dark ? <Sun size={14} /> : <Moon size={14} />}
          </button>
        </div>
      </div>
    </aside>
  );
}
