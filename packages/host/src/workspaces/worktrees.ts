import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants, existsSync, lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { copyFile, lstat, mkdir, realpath, rmdir, symlink, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import {
  KodoError,
  createWorktreeSchema,
  projectWorktreePolicySchema,
  type DelegationReport,
  type ProjectWorktreePolicy,
  type Workspace,
  type WorkspaceWorktree,
  type WorktreeDependencyMode,
  type WorktreeLifecycleState,
} from "@kodo/protocol";
import type { Store } from "../storage/store.js";
import type { BackgroundJobManager } from "../execution/background-jobs.js";
import { runCheck } from "../goals/workspace.js";

const exec = promisify(execFile);

function slugify(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "wt";
}

function within(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel);
}

async function git(
  rootPath: string,
  args: string[],
  timeout = 20_000,
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const res = await exec("git", ["-C", rootPath, "-c", "core.quotepath=off", ...args], {
      windowsHide: true,
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    });
    return { code: 0, stdout: String(res.stdout), stderr: String(res.stderr) };
  } catch (error: any) {
    return {
      code: typeof error?.code === "number" ? error.code : 1,
      stdout: String(error?.stdout ?? ""),
      stderr: String(error?.stderr ?? error?.message ?? ""),
    };
  }
}

export async function inspectGitWorkspace(rootPath: string): Promise<{
  git: boolean;
  hasHead: boolean;
  headCommit: string | null;
  branch: string | null;
}> {
  if (!existsSync(rootPath)) return { git: false, hasHead: false, headCommit: null, branch: null };
  const inside = await git(rootPath, ["rev-parse", "--is-inside-work-tree"], 8_000);
  if (inside.code !== 0 || inside.stdout.trim() !== "true")
    return { git: false, hasHead: false, headCommit: null, branch: null };
  const [head, branch] = await Promise.all([
    git(rootPath, ["rev-parse", "--verify", "HEAD"], 8_000),
    git(rootPath, ["branch", "--show-current"], 8_000),
  ]);
  return {
    git: true,
    hasHead: head.code === 0 && Boolean(head.stdout.trim()),
    headCommit: head.code === 0 ? head.stdout.trim() || null : null,
    branch: branch.code === 0 ? branch.stdout.trim() || null : null,
  };
}

/**
 * Detect whether a repository root is a workspace/monorepo whose `node_modules`
 * would alias internal workspace packages back to the primary repository if junctioned.
 */
export async function detectMonorepo(
  rootPath: string,
): Promise<{ monorepo: boolean; reason: string | null }> {
  const pkgPath = join(rootPath, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { workspaces?: unknown };
      if (pkg.workspaces) return { monorepo: true, reason: "package.json 包含 workspaces 声明" };
    } catch {}
  }
  if (existsSync(join(rootPath, "pnpm-workspace.yaml")))
    return { monorepo: true, reason: "存在 pnpm-workspace.yaml" };
  if (existsSync(join(rootPath, "lerna.json")))
    return { monorepo: true, reason: "存在 lerna.json" };

  const nm = join(rootPath, "node_modules");
  if (existsSync(nm)) {
    try {
      const realRoot = await realpath(rootPath);
      const realNm = await realpath(nm);
      const checkLink = async (candidate: string): Promise<boolean> => {
        const st = lstatSync(candidate);
        if (!st.isSymbolicLink()) return false;
        const target = await realpath(candidate).catch(() => null);
        return Boolean(target && within(realRoot, target) && !within(realNm, target));
      };
      for (const entry of readdirSync(nm, { withFileTypes: true })) {
        const full = join(nm, entry.name);
        if (entry.name.startsWith("@") && entry.isDirectory()) {
          for (const scoped of readdirSync(full, { withFileTypes: true })) {
            if (await checkLink(join(full, scoped.name)))
              return {
                monorepo: true,
                reason: `node_modules/${entry.name}/${scoped.name} 指向仓内工作区包`,
              };
          }
        } else if (await checkLink(full)) {
          return { monorepo: true, reason: `node_modules/${entry.name} 指向仓内工作区包` };
        }
      }
    } catch {}
  }
  return { monorepo: false, reason: null };
}

/** Deterministic Git facts computed directly by Host for DelegationReport. */
export async function computeGitFacts(
  rootPath: string,
  baseCommit?: string | null,
): Promise<DelegationReport["gitFacts"]> {
  const info = await inspectGitWorkspace(rootPath);
  if (!info.git) {
    return {
      git: false,
      baseCommit: baseCommit ?? null,
      headCommit: null,
      dirtyCount: 0,
      diffStat: { filesChanged: 0, insertions: 0, deletions: 0, paths: [] },
    };
  }
  const ref = baseCommit && info.hasHead ? baseCommit : info.hasHead ? "HEAD" : null;
  const [statusRes, diffRes] = await Promise.all([
    git(rootPath, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], 10_000),
    ref
      ? git(rootPath, ["diff", "--numstat", ref, "--"], 10_000)
      : Promise.resolve({ code: 0, stdout: "", stderr: "" }),
  ]);

  const statusEntries = statusRes.code === 0 ? statusRes.stdout.split("\0").filter(Boolean) : [];
  let dirtyCount = 0;
  const untrackedPaths: string[] = [];
  for (let i = 0; i < statusEntries.length; i++) {
    const rec = statusEntries[i]!;
    if (rec.length < 4) continue;
    dirtyCount++;
    const xy = rec.slice(0, 2);
    const file = rec.slice(3);
    if (xy === "??") untrackedPaths.push(file);
    if (xy[0] === "R" || xy[0] === "C") i++;
  }

  let insertions = 0;
  let deletions = 0;
  const pathSet = new Set<string>();
  if (diffRes.code === 0) {
    for (const line of diffRes.stdout.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const parts = line.split("\t");
      if (parts.length < 3) continue;
      const add = Number.parseInt(parts[0]!, 10);
      const del = Number.parseInt(parts[1]!, 10);
      if (Number.isFinite(add)) insertions += add;
      if (Number.isFinite(del)) deletions += del;
      pathSet.add(parts.slice(2).join("\t"));
    }
  }
  for (const p of untrackedPaths) pathSet.add(p);

  return {
    git: true,
    baseCommit: baseCommit ?? info.headCommit,
    headCommit: info.headCommit,
    dirtyCount,
    diffStat: {
      filesChanged: pathSet.size,
      insertions,
      deletions,
      paths: [...pathSet].slice(0, 100),
    },
  };
}

/**
 * Safely remove ONLY a symlink/junction created by Kooyu, never deleting the target directory.
 */
async function safeUnlinkDirectoryLink(linkPath: string): Promise<void> {
  if (!existsSync(linkPath)) return;
  let st;
  try {
    st = await lstat(linkPath);
  } catch (err: any) {
    if (err?.code === "ENOENT") return;
    throw err;
  }
  if (!st.isSymbolicLink()) return;
  try {
    await unlink(linkPath);
  } catch {
    await rmdir(linkPath);
  }
}

export class WorkspaceMutex {
  private readonly chains = new Map<string, Promise<unknown>>();

  runMany<T>(workspaceIds: string[], op: () => Promise<T>): Promise<T> {
    const ordered = [...new Set(workspaceIds)].sort();
    const lock = (index: number): Promise<T> => {
      const id = ordered[index];
      return id === undefined ? op() : this.run(id, () => lock(index + 1));
    };
    return lock(0);
  }

  async run<T>(workspaceId: string, op: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(workspaceId) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((done) => {
      release = done;
    });
    const tail = prev.catch(() => {}).then(() => next);
    this.chains.set(workspaceId, tail);
    try {
      await prev.catch(() => {});
      return await op();
    } finally {
      release();
      if (this.chains.get(workspaceId) === tail) this.chains.delete(workspaceId);
    }
  }
}

export interface WorktreeServiceDeps {
  store: Store;
  addWorkspace: (projectId: string | null, rootPath: string) => Workspace;
  jobs: () => BackgroundJobManager;
  hasActiveSession: (workspaceId: string) => boolean;
}

export class WorktreeService {
  readonly mutex = new WorkspaceMutex();

  constructor(private readonly deps: WorktreeServiceDeps) {}

  private get store(): Store {
    return this.deps.store;
  }

  private persist(wt: WorkspaceWorktree): WorkspaceWorktree {
    this.store.db
      .prepare(
        `INSERT INTO workspace_worktrees(
           workspace_id, parent_workspace_id, project_id, branch_name, base_ref, base_commit,
           lifecycle_state, last_error, created_at, updated_at, data
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(workspace_id) DO UPDATE SET
           project_id = excluded.project_id,
           branch_name = excluded.branch_name,
           base_ref = excluded.base_ref,
           base_commit = excluded.base_commit,
           lifecycle_state = excluded.lifecycle_state,
           last_error = excluded.last_error,
           updated_at = excluded.updated_at,
           data = excluded.data`,
      )
      .run(
        wt.workspaceId,
        wt.parentWorkspaceId,
        wt.projectId,
        wt.branchName,
        wt.baseRef,
        wt.baseCommit,
        wt.lifecycleState,
        wt.lastError,
        wt.createdAt,
        wt.updatedAt,
        JSON.stringify(wt),
      );
    return wt;
  }

  get(workspaceId: string): WorkspaceWorktree | undefined {
    const row = this.store.db
      .prepare("SELECT data FROM workspace_worktrees WHERE workspace_id=?")
      .get(workspaceId);
    return row ? (JSON.parse(String(row.data)) as WorkspaceWorktree) : undefined;
  }

  list(
    filter: { parentWorkspaceId?: string; projectId?: string; includeArchived?: boolean } = {},
  ): WorkspaceWorktree[] {
    const rows = this.store.db
      .prepare("SELECT data FROM workspace_worktrees ORDER BY created_at DESC")
      .all();
    return rows
      .map((r) => JSON.parse(String(r.data)) as WorkspaceWorktree)
      .filter(
        (wt) =>
          (!filter.parentWorkspaceId || wt.parentWorkspaceId === filter.parentWorkspaceId) &&
          (!filter.projectId || wt.projectId === filter.projectId) &&
          (filter.includeArchived || wt.lifecycleState !== "archived"),
      );
  }

  projectPolicy(projectId: string | null): ProjectWorktreePolicy {
    if (!projectId) return { dependencyMode: "none", envFileWhitelist: [] };
    const saved = this.store.record<ProjectWorktreePolicy>("project-worktree-policy", projectId);
    return saved
      ? projectWorktreePolicySchema.parse(saved)
      : { dependencyMode: "none", envFileWhitelist: [] };
  }

  saveProjectPolicy(projectId: string, value: unknown): ProjectWorktreePolicy {
    if (!this.store.projects().some((p) => p.id === projectId))
      throw new KodoError("NOT_FOUND", "项目不存在。");
    const policy = projectWorktreePolicySchema.parse(value);
    if (policy.worktreeRootPath && !isAbsolute(policy.worktreeRootPath))
      throw new KodoError("INVALID_INPUT", "Worktree 根目录必须是绝对路径。");
    this.store.put("project-worktree-policy", projectId, policy);
    return policy;
  }

  defaultWorktreePath(
    parentRootPath: string,
    slug?: string,
    customRootPath?: string | null,
  ): string {
    const cleanRoot = normalize(parentRootPath).replace(/[\\/]+$/, "");
    const baseRoot = customRootPath
      ? normalize(customRootPath)
      : join(dirname(cleanRoot), ".kooyu-wt");
    const shortId = randomUUID().replace(/-/g, "").slice(0, 8);
    const prefix = slugify(slug ?? basename(cleanRoot)).slice(0, 16);
    return resolve(baseRoot, `${prefix}-${shortId}`);
  }

  async create(
    parentWorkspace: Workspace,
    rawInput: unknown = {},
    options: {
      allowSharedFallback?: boolean;
      detached?: boolean;
      onReserved?: (worktree: WorkspaceWorktree) => void;
    } = {},
  ): Promise<
    | { kind: "worktree"; workspace: Workspace; worktree: WorkspaceWorktree }
    | { kind: "shared-fallback"; workspace: Workspace; reason: string }
  > {
    const input = createWorktreeSchema.parse(rawInput ?? {});
    const policy = this.projectPolicy(parentWorkspace.projectId);
    const dependencyMode: WorktreeDependencyMode = input.dependencyMode ?? policy.dependencyMode;
    const prepareCommand = input.prepareCommand ?? policy.prepareCommand ?? null;
    const envFileWhitelist = input.envFileWhitelist ?? policy.envFileWhitelist;

    const gitInfo = await inspectGitWorkspace(parentWorkspace.rootPath);
    if (!gitInfo.git) {
      if (options.allowSharedFallback)
        return {
          kind: "shared-fallback",
          workspace: parentWorkspace,
          reason: "当前工作区不是 Git 仓库，已回退为共享工作区执行。",
        };
      throw new KodoError(
        "INVALID_INPUT",
        "当前目录不是 Git 仓库，请先执行 git init 后再创建隔离 Worktree。",
      );
    }
    if (!gitInfo.hasHead) {
      if (options.allowSharedFallback)
        return {
          kind: "shared-fallback",
          workspace: parentWorkspace,
          reason: "Git 仓库尚无初始提交（HEAD 不存在），已回退为共享工作区执行。",
        };
      throw new KodoError(
        "INVALID_INPUT",
        "Git 仓库尚无初始提交（HEAD 不存在），无法创建隔离 Worktree。",
      );
    }

    if (dependencyMode === "junction") {
      const mono = await detectMonorepo(parentWorkspace.rootPath);
      if (mono.monorepo) {
        throw new KodoError(
          "UNSUPPORTED",
          `检测到 Monorepo 仓库（${mono.reason}），为防止依赖串库与污染主仓库已强制禁止 node_modules junction；请改用 none 或 prepare-command 策略。`,
        );
      }
    }

    const shortId = randomUUID().replace(/-/g, "").slice(0, 8);
    const slug = slugify(input.slug ?? basename(parentWorkspace.rootPath)).slice(0, 24);
    const branchName = options.detached
      ? `detached-${shortId}`
      : (input.branchName ?? `kooyu/${slug}-${shortId}`);
    const baseRef = input.baseRef ?? gitInfo.branch ?? "HEAD";
    const targetPath = input.rootPath
      ? normalize(input.rootPath)
      : this.defaultWorktreePath(parentWorkspace.rootPath, input.slug, policy.worktreeRootPath);

    if (!isAbsolute(targetPath))
      throw new KodoError("INVALID_INPUT", "Worktree 路径必须是绝对路径。");
    if (normalize(targetPath).toLowerCase() === normalize(parentWorkspace.rootPath).toLowerCase())
      throw new KodoError("INVALID_INPUT", "Worktree 路径不能与主工作区相同。");
    if (existsSync(targetPath))
      throw new KodoError("CONFLICT", `目标 Worktree 路径已存在：${targetPath}`);

    await mkdir(dirname(targetPath), { recursive: true });

    const gitArgs = options.detached
      ? ["worktree", "add", "--detach", targetPath, input.baseRef ?? "HEAD"]
      : ["worktree", "add", "-b", branchName, targetPath, input.baseRef ?? "HEAD"];
    await mkdir(targetPath);
    let reservation;
    try {
      reservation = this.store.transaction(() => {
        const ws = this.deps.addWorkspace(parentWorkspace.projectId, targetPath);
        const now = new Date().toISOString();
        const record = this.persist({
          workspaceId: ws.id,
          parentWorkspaceId: parentWorkspace.id,
          projectId: parentWorkspace.projectId,
          rootPath: ws.rootPath,
          branchName,
          baseRef,
          baseCommit: gitInfo.headCommit,
          lifecycleState: "preparing",
          dependencyMode,
          linkedNodeModules: false,
          copiedEnvFiles: [],
          lastError: null,
          createdAt: now,
          updatedAt: now,
        });

        options.onReserved?.(record);
        return { ws, record };
      });
    } catch (error) {
      await rmdir(targetPath).catch(() => {});
      throw error;
    }
    const { ws } = reservation;
    let { record } = reservation;
    try {
      const added = await git(parentWorkspace.rootPath, gitArgs, 30_000);
      if (added.code !== 0) {
        throw new KodoError(
          "UNAVAILABLE",
          "创建 Git Worktree 失败：" + (added.stderr || added.stdout).trim().slice(0, 500),
        );
      }
      const copiedEnvFiles: string[] = [];
      const realParent = await realpath(parentWorkspace.rootPath);
      const realTarget = await realpath(targetPath);

      for (const relFile of envFileWhitelist) {
        if (!relFile || relFile !== basename(relFile) || relFile === ".." || relFile === ".")
          throw new KodoError("INVALID_INPUT", "仅允许复制项目根目录中明确指定的文件。");
        const src = resolve(realParent, relFile);
        const dst = resolve(realTarget, relFile);
        if (!within(realParent, src) || !within(realTarget, dst)) continue;
        if (!existsSync(src) || !statSync(src).isFile()) continue;
        const realSrc = await realpath(src);
        if (!within(realParent, realSrc)) continue;
        await mkdir(dirname(dst), { recursive: true });
        await copyFile(realSrc, dst, constants.COPYFILE_EXCL);
        copiedEnvFiles.push(relFile);
      }

      let linkedNodeModules = false;
      if (dependencyMode === "junction") {
        const srcNm = join(realParent, "node_modules");
        const dstNm = join(realTarget, "node_modules");
        if (existsSync(srcNm) && statSync(srcNm).isDirectory() && !existsSync(dstNm)) {
          await symlink(srcNm, dstNm, process.platform === "win32" ? "junction" : "dir");
          linkedNodeModules = true;
        }
      } else if (dependencyMode === "prepare-command" && prepareCommand) {
        const res = await runCheck(prepareCommand, targetPath, 300_000);
        if (res.exitCode !== 0) {
          throw new KodoError(
            "UNAVAILABLE",
            `Worktree 环境准备命令失败（exit ${res.exitCode ?? "timeout"}）：${(res.stderr || res.stdout).slice(-400)}`,
          );
        }
      }

      record = this.persist({
        ...record,
        lifecycleState: "ready",
        linkedNodeModules,
        copiedEnvFiles,
        lastError: null,
        updatedAt: new Date().toISOString(),
      });
      return { kind: "worktree", workspace: ws, worktree: record };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.persist({
        ...record,
        lifecycleState: "failed",
        lastError: message.slice(0, 1000),
        updatedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  async cleanup(
    workspaceId: string,
    options: { force?: boolean; deleteBranch?: boolean } = {},
  ): Promise<{ worktree: WorkspaceWorktree; deferred: boolean }> {
    return this.mutex.run(workspaceId, async () => {
      const wt = this.get(workspaceId);
      if (!wt) throw new KodoError("NOT_FOUND", "Worktree 记录不存在。");
      if (wt.lifecycleState === "archived") return { worktree: wt, deferred: false };

      if (!options.force) {
        if (this.deps.hasActiveSession(workspaceId))
          throw new KodoError("CONFLICT", "该 Worktree 仍有运行中的会话，请先停止会话后再清理。");
        if (this.deps.jobs().runningForWorkspace(workspaceId).length > 0)
          throw new KodoError("CONFLICT", "该 Worktree 仍有运行中的后台作业，请先终止后再清理。");
      } else {
        await this.deps.jobs().stopWorkspace(workspaceId);
      }

      const current = this.persist({
        ...wt,
        lifecycleState: "deleting",
        updatedAt: new Date().toISOString(),
      });

      return this.attemptPhysicalRemoval(current, options.deleteBranch ?? false);
    });
  }

  private async attemptPhysicalRemoval(
    wt: WorkspaceWorktree,
    deleteBranch: boolean,
  ): Promise<{ worktree: WorkspaceWorktree; deferred: boolean }> {
    const parent = this.store.workspaces().find((w) => w.id === wt.parentWorkspaceId);
    try {
      // Unlink junction/symlink FIRST so nothing can traverse into the primary repo's node_modules.
      if (wt.linkedNodeModules) {
        await safeUnlinkDirectoryLink(join(wt.rootPath, "node_modules"));
      }
      if (parent && existsSync(parent.rootPath)) {
        if (existsSync(wt.rootPath)) {
          const removed = await git(
            parent.rootPath,
            ["worktree", "remove", "--force", wt.rootPath],
            20_000,
          );
          if (removed.code !== 0) {
            // A crash can leave the reserved empty directory before Git registers it.
            await rmdir(wt.rootPath).catch(() => {
              throw new Error(removed.stderr || "Git worktree removal failed");
            });
          }
        }
        await git(parent.rootPath, ["worktree", "prune"], 10_000);
        if (deleteBranch && wt.branchName && !wt.branchName.startsWith("detached-")) {
          await git(parent.rootPath, ["branch", "-D", wt.branchName], 10_000);
        }
      }
      if (existsSync(wt.rootPath)) {
        await rmdir(wt.rootPath);
      }
      const archived = this.persist({
        ...wt,
        lifecycleState: "archived",
        lastError: null,
        updatedAt: new Date().toISOString(),
      });
      return { worktree: archived, deferred: false };
    } catch (error: any) {
      const code = String(error?.code ?? "");
      const message = error instanceof Error ? error.message : String(error);
      const retryable =
        ["EBUSY", "EPERM", "EACCES", "ENOTEMPTY"].includes(code) ||
        /EBUSY|EPERM|locked|used by another process/i.test(message);
      const nextState: WorktreeLifecycleState =
        retryable || existsSync(wt.rootPath) ? "deleting" : "archived";
      const updated = this.persist({
        ...wt,
        lifecycleState: nextState,
        lastError: nextState === "deleting" ? message.slice(0, 1000) : null,
        updatedAt: new Date().toISOString(),
      });
      return { worktree: updated, deferred: nextState === "deleting" };
    }
  }

  /** Periodic background GC for worktrees that hit Windows EBUSY/EPERM during removal. */
  async sweepDeleting(): Promise<{ checked: number; archived: number; remaining: number }> {
    const pending = this.list({ includeArchived: false }).filter(
      (wt) => wt.lifecycleState === "deleting",
    );
    let archived = 0;
    for (const wt of pending) {
      const res = await this.mutex.run(wt.workspaceId, () => {
        const current = this.get(wt.workspaceId);
        if (
          current?.lifecycleState !== "deleting" ||
          this.deps.hasActiveSession(wt.workspaceId) ||
          this.deps.jobs().runningForWorkspace(wt.workspaceId).length
        )
          return Promise.resolve(null);
        return this.attemptPhysicalRemoval(current, false);
      });
      if (res && !res.deferred) archived++;
    }
    return { checked: pending.length, archived, remaining: pending.length - archived };
  }

  detachProject(projectId: string): void {
    const now = new Date().toISOString();
    for (const wt of this.list({ projectId, includeArchived: true })) {
      this.persist({ ...wt, projectId: null, updatedAt: now });
    }
  }
}
