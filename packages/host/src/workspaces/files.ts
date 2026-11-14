import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { open, readdir, realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve, sep } from "node:path";
import {
  KodoError,
  type Workspace,
  type WorkspaceFileList,
  type WorkspaceFilePreview,
  type WorkspaceChange,
  type WorkspaceChanges,
  type WorkspaceFileDiff,
} from "@kodo/protocol";

const exec = promisify(execFile);
const TEXT_LIMIT = 512 * 1024;
const BINARY_LIMIT = 32 * 1024 * 1024;
const images: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};
const slash = (path: string) => path.split(sep).join("/");
function within(root: string, file: string): boolean {
  const rel = relative(root, file);
  return rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel);
}
export async function workspacePath(workspace: Workspace, path: string) {
  const root = await realpath(workspace.rootPath);
  const lexical = resolve(root, path || ".");
  if (!within(root, lexical)) throw new KodoError("INVALID_INPUT", "文件超出当前工作位置。");
  let file: string;
  try {
    file = await realpath(lexical);
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? ""))
      throw new KodoError("NOT_FOUND", "文件已不存在，请刷新文件列表。");
    throw new KodoError("INVALID_INPUT", "无法读取文件，请检查访问权限。");
  }
  if (!within(root, file)) throw new KodoError("INVALID_INPUT", "文件链接指向当前工作位置之外。");
  return { root, file, path: slash(relative(root, lexical)) };
}
export async function listWorkspaceFiles(
  workspace: Workspace,
  path = "",
): Promise<WorkspaceFileList> {
  const target = await workspacePath(workspace, path);
  if (!(await stat(target.file)).isDirectory())
    throw new KodoError("INVALID_INPUT", "请选择文件夹。");
  const entries = (await readdir(target.file, { withFileTypes: true }))
    .filter((entry) => entry.name !== ".git" && (entry.isDirectory() || entry.isFile()))
    .sort(
      (a, b) =>
        Number(b.isDirectory()) - Number(a.isDirectory()) ||
        a.name.localeCompare(b.name, "zh-CN", { numeric: true }),
    );
  return {
    path: target.path,
    entries: entries.slice(0, 1000).map((entry) => ({
      name: entry.name,
      path: [target.path, entry.name].filter(Boolean).join("/"),
      kind: entry.isDirectory() ? "directory" : "file",
    })),
    truncated: entries.length > 1000,
  };
}
async function readBounded(file: string, limit: number): Promise<Buffer> {
  const handle = await open(file, "r");
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new KodoError("INVALID_INPUT", "只能查看普通文件。");
    if (info.size > limit) throw new KodoError("INVALID_INPUT", "文件过大，无法在侧栏加载。");
    const bytes = Buffer.alloc(Math.min(info.size + 1, limit + 1));
    let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, length);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (length > limit) throw new KodoError("INVALID_INPUT", "文件过大，无法在侧栏加载。");
    return bytes.subarray(0, length);
  } finally {
    await handle.close();
  }
}
export async function previewWorkspaceFile(
  workspace: Workspace,
  path: string,
): Promise<WorkspaceFilePreview> {
  const target = await workspacePath(workspace, path);
  const info = await stat(target.file);
  if (!info.isFile()) throw new KodoError("INVALID_INPUT", "请选择普通文件。");
  const ext = extname(target.file).toLowerCase();
  const mime = images[ext] ?? (ext === ".pdf" ? "application/pdf" : "application/octet-stream");
  const base = {
    path: target.path,
    name: basename(target.file),
    size: info.size,
    modifiedAt: info.mtime.toISOString(),
    mime,
  };
  if (images[ext] || ext === ".pdf")
    return info.size <= BINARY_LIMIT
      ? { ...base, kind: ext === ".pdf" ? "pdf" : "image" }
      : { ...base, kind: "unsupported", reason: "文件超过 32 MiB，暂不在侧栏预览。" };
  if (info.size > TEXT_LIMIT)
    return { ...base, kind: "unsupported", reason: "文本超过 512 KiB，暂不在侧栏预览。" };
  const data = await readBounded(target.file, TEXT_LIMIT);
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
    if (text.includes("\0")) throw new Error("binary");
    return { ...base, mime: "text/plain; charset=utf-8", kind: "text", text };
  } catch {
    return { ...base, kind: "unsupported", reason: "暂不支持此文件格式的预览，可下载后查看。" };
  }
}
export async function workspaceFileContent(workspace: Workspace, path: string) {
  const target = await workspacePath(workspace, path);
  const bytes = await readBounded(target.file, BINARY_LIMIT);
  const ext = extname(target.file).toLowerCase();
  return {
    bytes,
    name: basename(target.file),
    mime: images[ext] ?? (ext === ".pdf" ? "application/pdf" : "application/octet-stream"),
  };
}
async function git(workspace: Workspace, args: string[]) {
  return (
    await exec("git", ["-C", workspace.rootPath, ...args], {
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    })
  ).stdout;
}
export async function workspaceChanges(workspace: Workspace): Promise<WorkspaceChanges> {
  try {
    await git(workspace, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    return { git: false, branch: null, baseline: "HEAD", files: [], attribution: "workspace" };
  }
  const baseline = await git(workspace, ["rev-parse", "--verify", "HEAD"]).then(
    () => "HEAD" as const,
    () => "empty" as const,
  );
  const branch = await git(workspace, ["branch", "--show-current"]).then(
    (v) => v.trim() || null,
    () => null,
  );
  let raw: string;
  const prefix = await git(workspace, ["rev-parse", "--show-prefix"]);
  const rootPrefix = prefix.trim();
  try {
    raw = await git(workspace, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--",
      ".",
    ]);
  } catch {
    return {
      git: true,
      branch,
      baseline,
      files: [],
      attribution: "workspace",
      error: "无法读取完整改动列表，请稍后刷新。",
    };
  }
  const records = raw.split("\0"),
    files: WorkspaceChange[] = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;
    if (!record) continue;
    const xy = record.slice(0, 2),
      fullPath = record.slice(3);
    const previousFullPath = /[RC]/.test(xy) ? records[++i] : undefined;
    if (rootPrefix && !fullPath.startsWith(rootPrefix)) continue;
    const path = rootPrefix ? fullPath.slice(rootPrefix.length) : fullPath;
    const previousPath =
      previousFullPath && (!rootPrefix || previousFullPath.startsWith(rootPrefix))
        ? previousFullPath.slice(rootPrefix.length)
        : undefined;
    const status: WorkspaceChange["status"] =
      xy === "??"
        ? "untracked"
        : xy.includes("U") || xy === "AA" || xy === "DD"
          ? "conflict"
          : xy.includes("R")
            ? "renamed"
            : xy.includes("D")
              ? "deleted"
              : xy.includes("A")
                ? "added"
                : "modified";
    files.push({ path, status, ...(previousPath ? { previousPath } : {}) });
  }
  return { git: true, branch, baseline, files, attribution: "workspace" };
}
export async function workspaceFileDiff(
  workspace: Workspace,
  path: string,
): Promise<WorkspaceFileDiff> {
  const changes = await workspaceChanges(workspace);
  const change = changes.files.find((entry) => entry.path === path);
  if (!change) throw new KodoError("NOT_FOUND", "该文件已不在改动列表，请刷新。");
  if (change.status === "untracked" || changes.baseline === "empty") {
    const file = await previewWorkspaceFile(workspace, path);
    return {
      path,
      text: file.kind === "text" ? "新文件\n" + file.text : "二进制或大文件，请切换到文件预览。",
    };
  }
  try {
    const text = await git(workspace, [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-color",
      "HEAD",
      "--",
      ":(literal)" + path,
      ...(change.previousPath ? [":(literal)" + change.previousPath] : []),
    ]);
    return { path, text: text || "没有相对 HEAD 的文本差异。" };
  } catch {
    throw new KodoError("INVALID_INPUT", "无法加载差异，文件可能过大，请使用文件预览。");
  }
}
