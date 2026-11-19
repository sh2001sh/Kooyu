import { useState, type ReactNode } from "react";
import {
  ChevronDown,
  Inbox,
  Moon,
  PanelLeft,
  Settings2,
  Smartphone,
  SquarePen,
  Sun,
} from "lucide-react";
import type { HarnessId } from "@kodo/protocol";
import { KodoMark } from "./KodoBrand";
import { KooyuWordmark } from "./KooyuWordmark";
import { Modal } from "./Motion";
import { useT } from "../lib/i18n";

export interface SidebarProps {
  scope: string;
  hostName?: string;
  connected: boolean;
  dark: boolean;
  collapsed: boolean;
  resizing: boolean;
  settingsMode?: boolean;
  settingsHeader?: ReactNode;
  runningCount?: number;
  pendingCount?: number;
  projectCount?: number;
  onToggleDark: () => void;
  onToggleCollapsed: () => void;
  onNavigate: (next: string) => void;
  onOpenDevices?: () => void;
  onOpenCommandPalette?: () => void;
  onCreateSession: (preset?: {
    projectId?: string | null;
    harnessId?: HarnessId;
    text?: string;
  }) => void;
  /** Search controls, pinned masters, 2-tab switcher and collapsible tree rows, or settings nav. */
  children: ReactNode;
}

const TOOL_SCOPES = [{ id: "health", key: "settings.title", Icon: Settings2 }] as const;

/**
 * Navigation sidebar on desktop (2-column frosted island rail) and full-bleed
 * Phone Home screen at <=760px with Apple HIG top bar ([Host ▾] + [New]).
 */
export function Sidebar({
  scope,
  hostName = "本机桌面",
  connected,
  dark,
  collapsed,
  resizing,
  settingsMode = false,
  settingsHeader,
  runningCount: _runningCount = 0,
  pendingCount = 0,
  projectCount: _projectCount = 0,
  onToggleDark,
  onToggleCollapsed,
  onNavigate,
  onOpenDevices,
  onCreateSession,
  children,
}: SidebarProps) {
  const t = useT();
  const isMac = navigator.userAgent.includes("Mac");
  const shortcut = isMac ? "⌘N" : "Ctrl N";
  const [hostSheetOpen, setHostSheetOpen] = useState(false);

  return (
    <aside
      className={`sidebar ${collapsed ? "is-collapsed" : ""} ${resizing ? "is-resizing" : ""} ${
        settingsMode ? "is-settings" : ""
      }`}
      aria-label={settingsMode ? "配置侧边栏" : "导航与会话"}
    >
      {/* Phone Home top bar (<=760px): flagship status capsule + search + coral compose pill. */}
      {!settingsMode && (
        <div className="sidebar__homebar mobile-only">
          <div className="sidebar__homebar-left">
            <h1 className="sidebar__homebar-title">{t("dock.chats")}</h1>
            <button
              type="button"
              className="home-host-pill"
              aria-label="Host 连接状态与快捷设置"
              onClick={() => setHostSheetOpen(true)}
            >
              <span className={`status-dot ${connected ? "online" : "unknown"}`} />
              <span className="home-host-pill__name">{hostName}</span>
              <ChevronDown size={12} aria-hidden="true" />
            </button>
          </div>
          <div className="sidebar__homebar-actions">
            <button
              type="button"
              className={`icon-button home-bar-icon-btn home-bar-inbox-btn ${pendingCount > 0 ? "has-badge" : ""}`}
              aria-label="待办收件箱"
              title={pendingCount > 0 ? `待办收件箱（${pendingCount} 项待处理）` : "待办收件箱"}
              onClick={() => onNavigate("inbox")}
            >
              <Inbox size={16} />
              {pendingCount > 0 && (
                <span className="home-bar-badge" aria-hidden="true">
                  {pendingCount > 99 ? "99+" : pendingCount}
                </span>
              )}
            </button>
            <button
              type="button"
              className="home-compose-cta"
              aria-label="新建会话"
              title={t("sidebar.newChat")}
              onClick={() => onCreateSession()}
            >
              <SquarePen size={14} strokeWidth={2.2} />
              <span>{t("sidebar.newShort")}</span>
            </button>
          </div>
        </div>
      )}

      <div className="sidebar__chrome">
        {settingsMode && settingsHeader ? (
          settingsHeader
        ) : (
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
                title={`${t("sidebar.newChat")} (${shortcut})`}
                onClick={() => onCreateSession()}
              >
                <SquarePen size={13} strokeWidth={2} />
                {!collapsed && <span>{t("sidebar.newChat")}</span>}
              </button>
              <button
                type="button"
                className="icon-button sidebar__collapse"
                aria-label={collapsed ? "展开侧边栏" : "折叠侧边栏"}
                aria-pressed={collapsed}
                title={`${collapsed ? "展开" : "折叠"}侧边栏 (${isMac ? "⌘B" : "Ctrl B"})`}
                onClick={onToggleCollapsed}
              >
                <PanelLeft size={15} />
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="sidebar__list">{children}</div>

      <div className="sidebar__bottom">
        <nav className="sidebar__tools" aria-label="系统工具">
          {TOOL_SCOPES.map(({ id, key, Icon }) => {
            const label = t(key);
            const active = ["health", "usage", "devices", "work"].includes(scope);
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
                {!collapsed && <span>{label}</span>}
              </button>
            );
          })}
        </nav>

        <div className="connection">
          <span className={`status-dot ${connected ? "online" : "unknown"}`} />
          {!collapsed && (
            <span className="connection__label">
              {connected ? t("sidebar.hostConnected") : t("sidebar.hostOffline")}
            </span>
          )}
          <button
            type="button"
            className="theme-toggle"
            aria-label={dark ? t("sidebar.lightTheme") : t("sidebar.darkTheme")}
            title={dark ? t("sidebar.switchToLight") : t("sidebar.switchToDark")}
            onClick={onToggleDark}
          >
            {dark ? <Sun size={14} /> : <Moon size={14} />}
          </button>
        </div>
      </div>

      {hostSheetOpen && (
        <Modal
          title={hostName}
          subtitle={connected ? t("sidebar.hostConnected") : t("sidebar.hostOffline")}
          onClose={() => setHostSheetOpen(false)}
        >
          <div className="ios-inset-group">
            <button
              type="button"
              className="ios-sheet-action-row"
              onClick={() => {
                onToggleDark();
                setHostSheetOpen(false);
              }}
            >
              {dark ? <Sun size={17} /> : <Moon size={17} />}
              <span>{dark ? t("sidebar.switchToLight") : t("sidebar.switchToDark")}</span>
            </button>
            {onOpenDevices && (
              <button
                type="button"
                className="ios-sheet-action-row"
                onClick={() => {
                  setHostSheetOpen(false);
                  onOpenDevices();
                }}
              >
                <Smartphone size={17} />
                <span>{t("sidebar.manageDevices")}</span>
              </button>
            )}
          </div>
        </Modal>
      )}
    </aside>
  );
}
