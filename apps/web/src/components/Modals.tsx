import { useState } from "react";
import { FolderOpen } from "lucide-react";
import type { Project, Snapshot, Workspace } from "@kodo/protocol";
import { api } from "../lib/host-client";
import { DirectoryPicker } from "./DirectoryPicker";
import { Modal } from "./Motion";

type Action = (work: () => Promise<unknown>) => Promise<void>;

export function ProjectModal({
  act,
  onClose,
  onCreated,
}: {
  act: Action;
  onClose: () => void;
  onCreated: (id: string, workspaceId?: string) => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [pickingDirectory, setPickingDirectory] = useState(false);

  if (pickingDirectory)
    return (
      <DirectoryPicker
        initialPath={path || undefined}
        onClose={() => setPickingDirectory(false)}
        onSelect={(selected) => {
          setPath(selected);
          if (!name.trim()) setName(selected.split(/[\\/]/).filter(Boolean).pop() ?? selected);
          setPickingDirectory(false);
        }}
      />
    );

  return (
    <Modal title="创建项目" onClose={onClose}>
      <form
        className="ios-form"
        onSubmit={(e) => {
          e.preventDefault();
          void act(async () => {
            const p = await api<{ id: string }>("/projects", "POST", {
              name,
              ...(path ? { rootPath: path } : {}),
            });
            const workspaceId = path
              ? (await api<Snapshot>("/snapshot")).workspaces.find((w) => w.projectId === p.id)?.id
              : undefined;
            await onCreated(p.id, workspaceId);
          });
        }}
      >
        <div className="ios-inset-group">
          <label className="ios-field-row">
            <span>项目名称</span>
            <input
              autoFocus
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：Atlas 工作台"
            />
          </label>
          <div className="ios-field-row">
            <span>工作目录（可选）</span>
            <button
              type="button"
              className="directory-choice"
              onClick={() => setPickingDirectory(true)}
            >
              <FolderOpen size={16} aria-hidden="true" />
              <span>{path || "选择文件夹"}</span>
            </button>
          </div>
        </div>
        <div className="form-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="primary" disabled={!name.trim()}>
            创建项目
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function ProjectEditModal({
  project,
  workspaces,
  act,
  onClose,
}: {
  project: Project;
  workspaces: Workspace[];
  act: Action;
  onClose: () => void;
}) {
  const [name, setName] = useState(project.name);
  const [path, setPath] = useState("");
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  if (picking)
    return (
      <DirectoryPicker
        onClose={() => setPicking(false)}
        onSelect={(selected) => {
          setPath(selected);
          setPicking(false);
        }}
      />
    );
  return (
    <Modal title="编辑项目" onClose={busy ? () => {} : onClose}>
      <form
        className="ios-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || !name.trim()) return;
          setBusy(true);
          void act(async () => {
            await api("/projects/" + project.id, "PATCH", {
              name: name.trim(),
              ...(path ? { rootPath: path } : {}),
            });
            onClose();
          }).finally(() => setBusy(false));
        }}
      >
        <div className="ios-inset-group">
          <label className="ios-field-row">
            <span>项目名称</span>
            <input
              autoFocus
              required
              maxLength={200}
              aria-label="项目名称"
              value={name}
              disabled={busy}
              onFocus={(event) => event.target.select()}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <div className="project-edit-directories">
            <span>工作目录</span>
            {workspaces.map((workspace) => (
              <code key={workspace.id}>{workspace.rootPath}</code>
            ))}
            {!workspaces.length && <p>尚未绑定工作目录</p>}
            <button
              type="button"
              className="directory-choice"
              disabled={busy}
              onClick={() => setPicking(true)}
            >
              <FolderOpen size={16} aria-hidden="true" />
              <span>{path || "添加工作目录"}</span>
            </button>
            <p>添加目录后可在新对话中选择，已有会话的执行位置保持不变。</p>
          </div>
        </div>
        <div className="form-actions">
          <button type="button" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            type="submit"
            className="primary"
            disabled={busy || !name.trim() || (name.trim() === project.name && !path)}
          >
            {busy ? "正在保存…" : "保存修改"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Confirm removing a project or deleting a conversation from the sidebar. */
export function DeleteDialog({
  target,
  onClose,
  onConfirm,
}: {
  target:
    { kind: "project"; name: string; sessionCount: number } | { kind: "session"; title: string };
  onClose: () => void;
  onConfirm: (deleteSessions: boolean) => void | Promise<void>;
}) {
  const [withSessions, setWithSessions] = useState(false);
  const [busy, setBusy] = useState(false);
  const project = target.kind === "project";
  return (
    <Modal title={project ? "移除项目" : "删除会话"} onClose={onClose}>
      <form
        className="ios-form delete-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          void Promise.resolve(onConfirm(withSessions)).finally(() => setBusy(false));
        }}
      >
        <p className="delete-dialog__text">
          {project ? (
            <>
              从侧边栏移除项目 <strong>{target.name}</strong>。
              {withSessions
                ? "项目下的会话也会一并删除。"
                : "会话会保留，下次再打开这个文件夹时，项目和之前的会话都会回来。"}
            </>
          ) : (
            <>
              删除会话 <strong>{target.title}</strong>？它会从列表和搜索中移除。
            </>
          )}
        </p>
        {project && target.sessionCount > 0 && (
          <label className="delete-dialog__check">
            <input
              type="checkbox"
              checked={withSessions}
              onChange={(e) => setWithSessions(e.target.checked)}
            />
            <span>同时删除项目下的 {target.sessionCount} 个会话</span>
          </label>
        )}
        <p className="delete-dialog__note">原生 harness 的历史记录和工作目录里的文件不会被删除。</p>
        <div className="form-actions">
          <button type="button" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button type="submit" className="danger" disabled={busy}>
            {project ? (withSessions ? "移除并删除会话" : "移除项目") : "删除"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
