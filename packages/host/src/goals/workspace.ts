import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { GoalBaseline, GoalChange, GoalChangeReport, Workspace } from "@kodo/protocol";

const MAX_HASHED = 500;
const MAX_HASH_BYTES = 5 * 1024 * 1024;

function git(root: string, args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((done) => {
    execFile(
      "git",
      ["-C", root, "-c", "core.quotepath=off", ...args],
      { maxBuffer: 16 * 1024 * 1024, timeout: 20000, windowsHide: true },
      (error, stdout) => {
        const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
        done({ code, stdout: String(stdout) });
      },
    );
  });
}

/** Parse `git status --porcelain=v1 -z`; renames carry the old path as the next field. */
export function parsePorcelain(output: string): { path: string; status: string }[] {
  const fields = output.split("\0");
  const entries: { path: string; status: string }[] = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]!;
    if (field.length < 4) continue;
    const status = field.slice(0, 2);
    entries.push({ path: field.slice(3), status: status.trim() || status });
    if (status[0] === "R" || status[0] === "C") i++;
  }
  return entries;
}

async function sha256(path: string): Promise<string | null> {
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > MAX_HASH_BYTES) return null;
  } catch {
    return null;
  }
  return new Promise((done) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", () => done(null))
      .on("end", () => done(hash.digest("hex")));
  });
}

/** Snapshot HEAD and already-dirty files; never stages, commits or touches the tree. */
export async function captureBaseline(workspace: Workspace): Promise<GoalBaseline> {
  const base: GoalBaseline = {
    workspaceId: workspace.id,
    rootPath: workspace.rootPath,
    capturedAt: new Date().toISOString(),
    git: false,
    head: null,
    dirty: [],
    truncated: false,
  };
  const inside = await git(workspace.rootPath, ["rev-parse", "--is-inside-work-tree"]);
  if (inside.code !== 0 || inside.stdout.trim() !== "true") return base;
  const head = await git(workspace.rootPath, ["rev-parse", "HEAD"]);
  const status = await git(workspace.rootPath, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  if (status.code !== 0)
    return { ...base, git: true, error: "无法读取 git status，未建立改动基线。" };
  const entries = parsePorcelain(status.stdout);
  const dirty = [];
  for (const entry of entries.slice(0, MAX_HASHED))
    dirty.push({ ...entry, sha256: await sha256(resolve(workspace.rootPath, entry.path)) });
  return {
    ...base,
    git: true,
    head: head.code === 0 ? head.stdout.trim() : null,
    dirty,
    truncated: entries.length > MAX_HASHED,
  };
}

/** Compare the tree with its baseline. Unchanged pre-existing edits are never credited. */
export async function compareBaseline(baseline: GoalBaseline): Promise<GoalChangeReport> {
  const report: GoalChangeReport = {
    workspaceId: baseline.workspaceId,
    rootPath: baseline.rootPath,
    comparedTo: baseline.head,
    changes: [],
    preexistingUnchanged: 0,
    coverage: "",
  };
  if (!baseline.git || baseline.error) {
    report.coverage = baseline.error ?? "非 Git 目录：无法可靠列出改动，请以交付物和验证记录为准。";
    return report;
  }
  const status = await git(baseline.rootPath, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  if (status.code !== 0) {
    report.coverage = "无法读取当前 git status。";
    report.error = "git status failed";
    return report;
  }
  const before = new Map(baseline.dirty.map((d) => [d.path, d]));
  const changes = new Map<string, GoalChange>();
  const head = await git(baseline.rootPath, ["rev-parse", "HEAD"]);
  const currentHead = head.code === 0 ? head.stdout.trim() : null;
  if (baseline.head && currentHead && currentHead !== baseline.head) {
    const committed = await git(baseline.rootPath, [
      "diff",
      "--name-only",
      "-z",
      baseline.head,
      currentHead,
    ]);
    for (const path of committed.stdout.split("\0").filter(Boolean))
      changes.set(path, {
        path,
        status: "committed",
        attribution: before.has(path) ? "preexisting-modified" : "introduced",
      });
  }
  const seen = new Set<string>();
  for (const entry of parsePorcelain(status.stdout)) {
    seen.add(entry.path);
    const prior = before.get(entry.path);
    if (!prior) {
      changes.set(entry.path, { ...entry, attribution: "introduced" });
      continue;
    }
    const now = await sha256(resolve(baseline.rootPath, entry.path));
    if (prior.sha256 !== null && now === prior.sha256 && prior.status === entry.status) {
      if (!changes.has(entry.path)) report.preexistingUnchanged++;
      continue;
    }
    changes.set(entry.path, { ...entry, attribution: "preexisting-modified" });
  }
  for (const prior of baseline.dirty)
    if (!seen.has(prior.path) && !changes.has(prior.path))
      changes.set(prior.path, {
        path: prior.path,
        status: "clean-now",
        attribution: "preexisting-modified",
      });
  report.changes = [...changes.values()].sort((a, b) => a.path.localeCompare(b.path));
  report.coverage = [
    `对比目标开始时的 HEAD ${baseline.head?.slice(0, 12) ?? "(空仓库)"} 与当前工作区。`,
    "共享目录中的其他写入者无法区分；开始前已有改动且又变化的文件标为归属未知。",
    baseline.truncated ? "基线文件数超过上限，部分既有改动未逐一记录。" : "",
  ]
    .filter(Boolean)
    .join("");
  return report;
}

/** Resolve a workspace-relative file without following links outside the root. */
export function containedPath(root: string, path: string): string | null {
  if (isAbsolute(path)) return null;
  const target = resolve(root, path);
  const rel = relative(root, target);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  try {
    const real = realpathSync(target),
      realRoot = realpathSync(root),
      realRel = relative(realRoot, real);
    if (realRel.startsWith("..") || isAbsolute(realRel)) return null;
    return real;
  } catch {
    return null;
  }
}

export { sha256 as fileSha256 };

const SECRET_ENV = /^(KODO|KOOYU)_.*(KEY|TOKEN|SECRET)/i;
const TAIL = 8 * 1024;

export interface CheckResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  error?: string;
}

/**
 * Run one check in the workspace and report the real exit status. Host secrets are
 * removed from the environment; output is kept as bounded tails.
 */
export function runCheck(command: string, cwd: string, timeoutMs: number): Promise<CheckResult> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !SECRET_ENV.test(name)),
  );
  const started = Date.now();
  return new Promise((done) => {
    let stdout = "",
      stderr = "",
      timedOut = false,
      settled = false;
    const child = spawn(command, {
      cwd,
      env,
      shell: true,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const keep = (current: string, chunk: Buffer) => (current + chunk.toString()).slice(-TAIL);
    child.stdout.on("data", (chunk: Buffer) => (stdout = keep(stdout, chunk)));
    child.stderr.on("data", (chunk: Buffer) => (stderr = keep(stderr, chunk)));
    const kill = () => {
      if (!child.pid) return;
      try {
        if (process.platform === "win32")
          spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
        else process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    const finish = (result: Omit<CheckResult, "durationMs" | "stdout" | "stderr" | "timedOut">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      done({ ...result, stdout, stderr, timedOut, durationMs: Date.now() - started });
    };
    child.on("error", (error) => finish({ exitCode: null, error: error.message }));
    child.on("close", (code) => finish({ exitCode: timedOut ? null : code }));
  });
}
