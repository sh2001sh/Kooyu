import { useCallback, useState, type MouseEvent, type KeyboardEvent } from "react";
import {
  Archive,
  Check,
  Copy,
  Eye,
  MoreHorizontal,
  Pencil,
  Pin,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import type { Project, Session } from "@kodo/protocol";
import { api } from "../lib/host-client";
import { ContextMenu, type MenuAction } from "./ContextMenu";

type Target = { kind: "session"; value: Session } | { kind: "project"; value: Project };
type Options = {
  sessions: Session[];
  projects: Project[];
  act: (work: () => Promise<unknown>) => Promise<void>;
  onEditProject: (project: Project) => void;
  onDeleteSession?: (session: Session) => void;
  onDeleteProject?: (project: Project) => void;
};
export function useSidebarActions({
  sessions,
  projects,
  act,
  onEditProject,
  onDeleteSession,
  onDeleteProject,
}: Options) {
  const [menu, setMenu] = useState<{
    target: Target;
    x: number;
    y: number;
    trigger: HTMLElement;
  } | null>(null);
  const close = useCallback(() => setMenu(null), []);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [savingName, setSavingName] = useState(false);
  const [notice, setNotice] = useState("");
  const open = (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>, target: Target) => {
    event.preventDefault();
    event.stopPropagation();
    setNotice("");
    if (
      event.type === "click" &&
      menu?.target.kind === target.kind &&
      menu.target.value.id === target.value.id
    ) {
      close();
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const pointer = "clientX" in event && event.type === "contextmenu";
    setMenu({
      target,
      x: pointer ? event.clientX : rect.left,
      y: pointer ? event.clientY : rect.bottom + 4,
      trigger:
        event.currentTarget instanceof HTMLButtonElement
          ? event.currentTarget
          : (event.currentTarget.querySelector<HTMLButtonElement>("button") ?? event.currentTarget),
    });
  };
  const keyboard = (event: KeyboardEvent<HTMLElement>, target: Target) => {
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) open(event, target);
  };
  const update = (
    session: Session,
    patch: Partial<Pick<Session, "pinned" | "archived" | "unread">>,
  ) => void act(() => api("/sessions/" + session.id, "PATCH", patch));
  const actions = (): MenuAction[] => {
    if (!menu) return [];
    if (menu.target.kind === "session") {
      const session =
        sessions.find((item) => item.id === menu.target.value.id) ?? menu.target.value;
      return [
        {
          id: "rename",
          label: "重命名",
          icon: <Pencil size={15} />,
          onSelect: () => setRenaming({ id: session.id, title: session.title }),
        },
        {
          id: "pin",
          label: session.pinned ? "取消置顶" : "置顶",
          icon: <Pin size={15} />,
          onSelect: () => update(session, { pinned: !session.pinned }),
        },
        {
          id: "unread",
          label: session.unread ? "标记为已读" : "标记为未读",
          icon: <Eye size={15} />,
          onSelect: () => update(session, { unread: !session.unread }),
        },
        {
          id: "copy-title",
          label: "复制会话名称",
          icon: <Copy size={15} />,
          separator: true,
          onSelect: () => {
            void act(() => navigator.clipboard.writeText(session.title));
          },
        },
        {
          id: "copy-id",
          label: "复制会话 ID",
          icon: <Copy size={15} />,
          onSelect: () => {
            void act(() => navigator.clipboard.writeText(session.id));
          },
        },
        {
          id: "archive",
          label: session.archived ? "取消归档" : "归档",
          icon: <Archive size={15} />,
          separator: true,
          onSelect: () => update(session, { archived: !session.archived }),
        },
        ...(session.nativeSessionId
          ? [
              {
                id: "native-sync",
                label: "同步原生状态",
                icon: <RefreshCw size={15} />,
                onSelect: () => {
                  void act(async () => {
                    const result = await api<{ removed: string[]; unknown: number }>(
                      "/sessions/native-sync",
                      "POST",
                      {},
                    );
                    setNotice(
                      result.removed.length
                        ? "已移除 " + result.removed.length + " 个原生已删除会话。"
                        : result.unknown
                          ? "部分原生状态暂时无法确认，已保留本地会话。"
                          : "原生状态已核对。",
                    );
                  });
                },
              },
            ]
          : []),
        ...(onDeleteSession
          ? [
              {
                id: "delete",
                label: "删除会话",
                danger: true,
                icon: <Trash2 size={15} />,
                onSelect: () => onDeleteSession(session),
              },
            ]
          : []),
      ];
    }
    const project = projects.find((item) => item.id === menu.target.value.id) ?? menu.target.value;
    return [
      {
        id: "pin",
        label: project.pinned ? "取消置顶" : "置顶",
        icon: <Pin size={15} />,
        onSelect: () => {
          void act(() => api("/projects/" + project.id, "PATCH", { pinned: !project.pinned }));
        },
      },
      {
        id: "edit",
        label: "编辑项目",
        icon: <Pencil size={15} />,
        onSelect: () => onEditProject(project),
      },
      {
        id: "archive",
        label: "归档项目会话",
        icon: <Archive size={15} />,
        separator: true,
        onSelect: () => {
          if (
            window.confirm(
              "归档「" + project.name + "」下的全部会话？运行中的任务会继续，可通过显示归档找回。",
            )
          )
            void act(() => api("/projects/" + project.id, "PATCH", { archiveSessions: true }));
        },
      },
      ...(onDeleteProject
        ? [
            {
              id: "remove",
              label: "移除项目",
              icon: <Trash2 size={15} />,
              separator: true,
              danger: true,
              onSelect: () => onDeleteProject(project),
            },
          ]
        : []),
    ];
  };
  const more = (target: Target) => (
    <button
      type="button"
      className={
        target.kind === "session" ? "session-row__more" : "tree-group__add tree-group__more"
      }
      aria-label={
        target.kind === "session"
          ? "会话菜单 " + target.value.title
          : "项目菜单 " + target.value.name
      }
      title={target.kind === "session" ? "会话操作" : "项目操作"}
      aria-haspopup="menu"
      aria-expanded={menu?.target.kind === target.kind && menu.target.value.id === target.value.id}
      onClick={(event) => open(event, target)}
    >
      <MoreHorizontal size={16} />
    </button>
  );
  const renameForm = (session: Session) => (
    <form
      className="sidebar-rename"
      onSubmit={(event) => {
        event.preventDefault();
        if (!renaming?.title.trim() || savingName) return;
        setSavingName(true);
        void act(async () => {
          await api("/sessions/" + session.id, "PATCH", { title: renaming.title.trim() });
          setRenaming(null);
        }).finally(() => setSavingName(false));
      }}
    >
      <input
        autoFocus
        aria-label="会话名称"
        maxLength={200}
        value={renaming?.title ?? ""}
        disabled={savingName}
        onFocus={(event) => event.target.select()}
        onChange={(event) => setRenaming({ id: session.id, title: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            setRenaming(null);
          }
        }}
      />
      <button
        type="submit"
        aria-label="保存会话名称"
        disabled={savingName || !renaming?.title.trim()}
      >
        <Check size={14} />
      </button>
      <button
        type="button"
        aria-label="取消重命名"
        disabled={savingName}
        onClick={() => setRenaming(null)}
      >
        <X size={14} />
      </button>
    </form>
  );
  return {
    open,
    keyboard,
    more,
    renameForm,
    renamingId: renaming?.id,
    notice,
    menu: menu ? (
      <ContextMenu
        x={menu.x}
        y={menu.y}
        label={menu.target.kind === "session" ? "会话操作" : "项目操作"}
        actions={actions()}
        onClose={close}
        restoreFocus={menu.trigger}
      />
    ) : null,
  };
}
