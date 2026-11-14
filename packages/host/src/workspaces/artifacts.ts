import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpath, readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { KodoError, type Workspace } from "@kodo/protocol";
const exec = promisify(execFile);
export async function artifacts(workspace: Workspace) {
  const git = async (args: string[]) => {
    try {
      return (
        await exec("git", ["-C", workspace.rootPath, ...args], {
          windowsHide: true,
          maxBuffer: 2 * 1024 * 1024,
          timeout: 10000,
        })
      ).stdout;
    } catch {
      return null;
    }
  };
  const [status, diff, branch, worktrees] = await Promise.all([
    git(["status", "--short"]),
    git(["diff", "--no-ext-diff", "--no-textconv", "HEAD", "--"]),
    git(["branch", "--show-current"]),
    git(["worktree", "list", "--porcelain"]),
  ]);
  return {
    hostId: workspace.hostId,
    workspaceId: workspace.id,
    rootPath: workspace.rootPath,
    attribution: "workspace changes; authorship unknown in a shared directory",
    baseline: "HEAD",
    status,
    diff,
    branch: branch?.trim(),
    worktrees,
    note: status === null ? "此目录不是可读取的 Git 工作区。" : null,
  };
}
export async function workspaceContext(workspace: Workspace) {
  try {
    const { stdout } = await exec("git", ["-C", workspace.rootPath, "branch", "--show-current"], {
      windowsHide: true,
      maxBuffer: 64 * 1024,
      timeout: 5000,
    });
    return {
      workspaceId: workspace.id,
      hostId: workspace.hostId,
      branch: stdout.trim() || null,
      git: true,
    };
  } catch {
    return { workspaceId: workspace.id, hostId: workspace.hostId, branch: null, git: false };
  }
}
export async function preview(workspace: Workspace, path: string) {
  const root = await realpath(workspace.rootPath),
    file = await realpath(resolve(root, path)),
    rel = relative(root, file);
  if (rel.startsWith("..") || isAbsolute(rel))
    throw new KodoError("INVALID_INPUT", "文件超出当前工作位置。");
  const info = await stat(file);
  if (!info.isFile() || info.size > 512 * 1024)
    throw new KodoError("INVALID_INPUT", "只预览小于 512 KiB 的普通文件。");
  return { hostId: workspace.hostId, path: file, text: await readFile(file, "utf8") };
}
export async function createWorktree(workspace: Workspace, path: string) {
  if (!isAbsolute(path)) throw new KodoError("INVALID_INPUT", "worktree 需要绝对路径。");
  await exec("git", ["-C", workspace.rootPath, "worktree", "add", "--detach", path, "HEAD"], {
    windowsHide: true,
    maxBuffer: 256 * 1024,
    timeout: 30000,
  });
  return path;
}
