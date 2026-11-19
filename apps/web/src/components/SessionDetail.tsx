import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { FolderPlus, X } from "lucide-react";
import type {
  Command,
  Goal,
  RuntimeEvent,
  Session,
  Snapshot,
  Usage,
  Workspace,
} from "@kodo/protocol";
import { GoalPanel } from "./GoalPanel";
import { SessionOverview } from "./SessionInsights";
import { api } from "../lib/host-client";
import { formatWorkspaceLabel } from "../lib/harnesses";
import { HarnessBadge } from "./KodoBrand";
import { NativeRecovery } from "./NativeRecovery";
import { WorkspacePanel } from "./WorkspacePanel";
import { SessionRunPanel } from "./SessionRunPanel";
import { ProjectModal } from "./Modals";
type Action = (work: () => Promise<unknown>) => Promise<void>;
interface SessionDetailProps {
  detail: string;
  session: Session;
  snapshot: Snapshot;
  events: RuntimeEvent[];
  commands: Command[];
  usage: Usage[];
  act: Action;
  onSelectDetail?: (next: "files" | "changes" | "timeline" | "manage" | "goals") => void;
  goals?: Goal[];
  reloadGoals?: () => Promise<void>;
  onClose: () => void;
  onDeleted: () => void;
  requestedPath?: string;
  requestKey?: number;
  onOpenFile: (path: string) => void;
}
export function SessionDetail({
  detail,
  session,
  snapshot,
  events,
  commands,
  usage,
  act,
  onSelectDetail,
  onClose,
  requestedPath,
  requestKey,
  onOpenFile,
  goals = [],
  reloadGoals = async () => {},
}: SessionDetailProps) {
  const tab = detail === "manage" ? "timeline" : detail;
  const native = !["files", "changes", "timeline", "manage", "goals"].includes(detail);
  const [customWidth, setCustomWidth] = useState<number | null>(null);
  const [resizing, setResizing] = useState(false);
  const paneRef = useRef<HTMLElement>(null);
  const tabs = [
    ...(session.kind === "supervisor" ? ([["goals", "目标"]] as const) : []),
    ["files", "文件"],
    ["changes", "改动"],
    ["timeline", "运行"],
  ] as const;
  const keys = tabs.map(([key]) => key);
  const workspace = snapshot.workspaces.find((w) => w.id === session.workspaceId);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose]);

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !paneRef.current) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = paneRef.current.getBoundingClientRect().width;
    setResizing(true);
    const onMove = (ev: PointerEvent) => {
      const next = Math.max(280, Math.min(720, Math.round(startW + (startX - ev.clientX))));
      setCustomWidth(next);
    };
    const onUp = () => {
      setResizing(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <aside
      ref={paneRef}
      style={
        customWidth
          ? ({ "--inspector-custom-width": `${customWidth}px` } as CSSProperties)
          : undefined
      }
      className={
        "detail-pane" +
        (["files", "changes"].includes(tab) ? " detail-pane--workspace" : "") +
        (resizing ? " is-resizing" : "")
      }
      aria-label="会话检查器"
    >
      <div
        className="detail-pane__resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整检查器宽度"
        title="拖拽调整宽度（双击重置）"
        onPointerDown={startResize}
        onDoubleClick={() => setCustomWidth(null)}
      />
      <div className="detail-pane__header">
        <div className="detail-pane__identity">
          <HarnessBadge harnessId={session.harnessId} size="xs" tone="tinted" />
          {!native ? (
            <div className="detail-pane__tabs" role="tablist" aria-label="检查器视图">
              {tabs.map(([key, label]) => (
                <button
                  key={key}
                  id={"inspector-tab-" + key}
                  type="button"
                  role="tab"
                  aria-controls="inspector-content"
                  aria-selected={tab === key}
                  tabIndex={tab === key ? 0 : -1}
                  onKeyDown={(event) => {
                    const index = keys.indexOf(key);
                    const next =
                      event.key === "ArrowRight"
                        ? keys[(index + 1) % keys.length]
                        : event.key === "ArrowLeft"
                          ? keys[(index + keys.length - 1) % keys.length]
                          : event.key === "Home"
                            ? keys[0]
                            : event.key === "End"
                              ? keys[keys.length - 1]
                              : undefined;
                    if (next) {
                      event.preventDefault();
                      onSelectDetail?.(next);
                      document.getElementById("inspector-tab-" + next)?.focus();
                    }
                  }}
                  className={tab === key ? "is-active" : ""}
                  onClick={() => onSelectDetail?.(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : (
            <strong>原生状态</strong>
          )}
        </div>
        <button type="button" className="icon-button" aria-label="关闭详情" onClick={onClose}>
          <X size={17} />
        </button>
      </div>
      <div
        className="detail-pane__scroll"
        id="inspector-content"
        role={native ? undefined : "tabpanel"}
        aria-labelledby={native ? undefined : "inspector-tab-" + tab}
      >
        {tab === "goals" ? (
          <GoalPanel
            session={session}
            snapshot={snapshot}
            goals={goals}
            reload={reloadGoals}
            act={act}
          />
        ) : tab === "files" || tab === "changes" ? (
          <WorkspacePanel
            key={session.id}
            workspace={workspace}
            mode={tab}
            events={events}
            requestedPath={requestedPath}
            requestKey={requestKey}
            onOpenFile={onOpenFile}
          />
        ) : !native ? (
          <>
            <SessionRunPanel session={session} events={events} commands={commands} />
            <details className="run-panel-details" open={detail === "manage" || undefined}>
              <summary>会话详情与管理</summary>
              <ManagePanel
                key={session.id}
                session={session}
                snapshot={snapshot}
                events={events}
                usage={usage}
                commands={commands}
                act={act}
              />
            </details>
          </>
        ) : (
          <div className="ios-inset-group detail-raw-wrap">
            <pre>{detail}</pre>
          </div>
        )}
      </div>
    </aside>
  );
}
function ManagePanel({
  session: s,
  snapshot,
  events,
  usage,
  commands,
  act,
}: {
  session: Session;
  snapshot: Snapshot;
  events: RuntimeEvent[];
  usage: Usage[];
  commands: Command[];
  act: Action;
}) {
  const [showProjectForm, setShowProjectForm] = useState(false);
  const projectSelectId = useId();

  const workspace = snapshot.workspaces.find((w) => w.id === s.workspaceId);

  return (
    <>
      <div className="detail-stack">
        <div className="ios-inset-group">
          <SessionOverview
            session={s}
            snapshot={snapshot}
            events={events}
            commands={commands}
            usage={usage}
          />
        </div>

        <div className="ios-inset-group detail-card detail-control-card">
          <div className="detail-field">
            <label htmlFor={projectSelectId} className="detail-section__label">
              项目归属
            </label>
            <div className="detail-project-row">
              <select
                id={projectSelectId}
                aria-label="调整项目归属"
                value={s.projectId ?? ""}
                onChange={(e) =>
                  void act(() =>
                    api(`/sessions/${s.id}`, "PATCH", { projectId: e.target.value || null }),
                  )
                }
              >
                <option value="">未归属 / 全局</option>
                {snapshot.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="detail-sub-btn"
                onClick={() => setShowProjectForm(true)}
              >
                <FolderPlus size={14} aria-hidden="true" /> 新建项目
              </button>
            </div>
          </div>

          {s.phase === "draft" && (
            <label className="detail-field">
              <span className="detail-section__label">草稿执行位置</span>
              <select
                aria-label="调整草稿执行位置"
                value={s.workspaceId ?? ""}
                onChange={(e) =>
                  void act(() =>
                    api(`/sessions/${s.id}`, "PATCH", { workspaceId: e.target.value || null }),
                  )
                }
              >
                <option value="">未绑定</option>
                {snapshot.workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {formatWorkspaceLabel(w.rootPath) || w.rootPath}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="ios-inset-group detail-card">
          <NativeRecovery session={s} commands={commands} act={act} />
        </div>

        <div className="detail-section-head">成果与工作位置</div>
        <div className="ios-inset-group detail-card">
          <WorkspaceTools workspace={workspace} act={act} />
        </div>
      </div>
      {showProjectForm && (
        <ProjectModal
          act={act}
          onClose={() => setShowProjectForm(false)}
          onCreated={async (id, workspaceId) => {
            await api(`/sessions/${s.id}`, "PATCH", {
              projectId: id,
              ...(s.phase === "draft" && workspaceId ? { workspaceId } : {}),
            });
            setShowProjectForm(false);
          }}
        />
      )}
    </>
  );
}

function WorkspaceTools({ workspace, act }: { workspace?: Workspace; act: Action }) {
  const [path, setPath] = useState("");
  if (!workspace) return <p className="workspace-browser__note">未绑定工作位置</p>;
  return (
    <details>
      <summary>独立 worktree</summary>
      <p className="workspace-browser__note">创建独立工作目录，不切换当前会话的位置。</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void act(async () => {
            await api("/workspaces/" + workspace.id + "/worktrees", "POST", { rootPath: path });
            setPath("");
          });
        }}
      >
        <label>
          新 worktree 的绝对路径
          <input required value={path} onChange={(event) => setPath(event.target.value)} />
        </label>
        <button type="submit">创建 worktree</button>
      </form>
    </details>
  );
}
