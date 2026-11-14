import { useT, type MessageKey } from "../lib/i18n";
import {
  Activity,
  ArrowLeft,
  Cpu,
  PanelLeft,
  Server,
  Settings2,
  SlidersHorizontal,
  Smartphone,
  X,
  type LucideIcon,
} from "lucide-react";

export type SettingsSectionId =
  "general" | "harnesses" | "providers" | "usage" | "devices" | "advanced";

export interface SettingsSectionMeta {
  id: SettingsSectionId;
  label: string;
  short: string;
  group: string;
  Icon: LucideIcon;
}

export const SETTINGS_SECTIONS: Record<SettingsSectionId, SettingsSectionMeta> = {
  general: { id: "general", label: "通用", short: "通用", group: "偏好", Icon: Settings2 },
  harnesses: { id: "harnesses", label: "引擎", short: "引擎", group: "引擎与模型", Icon: Cpu },
  providers: {
    id: "providers",
    label: "模型来源",
    short: "模型来源",
    group: "引擎与模型",
    Icon: Server,
  },
  usage: { id: "usage", label: "用量", short: "用量", group: "数据与设备", Icon: Activity },
  devices: {
    id: "devices",
    label: "手机连接",
    short: "手机",
    group: "数据与设备",
    Icon: Smartphone,
  },
  advanced: {
    id: "advanced",
    label: "高级",
    short: "高级",
    group: "数据与设备",
    Icon: SlidersHorizontal,
  },
};

/** i18n keys for section labels and group titles. */
export const SETTINGS_LABEL_KEYS: Record<SettingsSectionId, MessageKey> = {
  general: "nav.general",
  harnesses: "nav.engines",
  providers: "nav.providers",
  usage: "nav.usage",
  devices: "nav.devices",
  advanced: "nav.advanced",
};

export const SETTINGS_GROUPS: Array<{ title: MessageKey; items: SettingsSectionId[] }> = [
  { title: "nav.group.preferences", items: ["general"] },
  { title: "nav.group.models", items: ["harnesses", "providers"] },
  { title: "nav.group.account", items: ["usage", "devices", "advanced"] },
];

export type SettingsCounts = Partial<Record<SettingsSectionId, string | number>>;

export function SettingsSidebarChrome({
  collapsed,
  onBack,
  onToggleCollapsed,
  onCloseNav,
}: {
  collapsed: boolean;
  onBack: () => void;
  onToggleCollapsed: () => void;
  onCloseNav: () => void;
}) {
  const t = useT();
  return (
    <div className="settings-chrome">
      <div className="settings-chrome__row">
        <button
          type="button"
          className="settings-back-btn"
          aria-label="返回对话"
          title="返回对话"
          onClick={onBack}
        >
          <ArrowLeft size={14} strokeWidth={2} />
          {!collapsed && <span>{t("settings.back")}</span>}
        </button>
        <div className="settings-chrome__actions">
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
      {!collapsed && (
        <div className="settings-chrome__title">
          <strong>{t("settings.title")}</strong>
        </div>
      )}
    </div>
  );
}

export function SettingsSidebarNav({
  active,
  collapsed,
  counts,
  onSelect,
}: {
  active: SettingsSectionId;
  collapsed: boolean;
  counts?: SettingsCounts;
  onSelect: (next: SettingsSectionId) => void;
}) {
  const t = useT();
  let itemOrder = 0;

  return (
    <nav className="settings-nav" aria-label="配置导航">
      {SETTINGS_GROUPS.map((group) => (
        <div className="settings-nav__group" key={group.title}>
          {!collapsed && <div className="settings-nav__label">{t(group.title)}</div>}
          <div className="settings-nav__items">
            {group.items.map((id) => {
              const { Icon } = SETTINGS_SECTIONS[id];
              const label = t(SETTINGS_LABEL_KEYS[id]);
              const count = counts?.[id];
              const isActive = active === id;
              const style = { "--i": itemOrder++ } as React.CSSProperties;
              return (
                <button
                  type="button"
                  key={id}
                  className={`settings-nav__item ${isActive ? "active" : ""}`}
                  style={style}
                  title={label}
                  aria-label={label}
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => onSelect(id)}
                >
                  <span className="settings-nav__icon" aria-hidden="true">
                    <Icon size={15} />
                  </span>
                  {!collapsed && <span className="settings-nav__text">{label}</span>}
                  {!collapsed && count !== undefined && (
                    <span className="settings-nav__badge">{count}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function SettingsMobileNav({
  active,
  counts,
  onSelect,
}: {
  active: SettingsSectionId;
  counts?: SettingsCounts;
  onSelect: (next: SettingsSectionId) => void;
}) {
  const ordered: SettingsSectionId[] = [
    "general",
    "harnesses",
    "providers",
    "usage",
    "devices",
    "advanced",
  ];
  const t = useT();
  return (
    <nav className="settings-mobile-nav" aria-label="配置页面">
      {ordered.map((id) => {
        const short = t(SETTINGS_LABEL_KEYS[id]);
        const count = counts?.[id];
        const isActive = active === id;
        return (
          <button
            type="button"
            key={id}
            className={`settings-mobile-nav__pill ${isActive ? "active" : ""}`}
            aria-label={short}
            aria-current={isActive ? "page" : undefined}
            onClick={() => onSelect(id)}
          >
            <span>{short}</span>
            {count !== undefined && (
              <span className="settings-mobile-nav__count" aria-hidden="true">
                {count}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
