import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { KodoError, type BackgroundJob, type Session } from "@kodo/protocol";
import type { Store } from "../storage/store.js";
import type { Wire } from "../harnesses/adapter.js";

const SECRET_ENV = /^(KODO|KOOYU)_.*(KEY|TOKEN|SECRET)/i;
const RING_BUFFER_MAX_BYTES = 256 * 1024;
const DEFAULT_YIELD_MS = 12_000;
const MIN_YIELD_MS = 500;
const MAX_YIELD_MS = 60_000;
const INLINE_OUTPUT_PREVIEW_BYTES = 16 * 1024;

export interface BackgroundJobExitEvent {
  job: BackgroundJob;
  recentOutput: string;
}

interface LiveJob {
  record: BackgroundJob;
  child: ChildProcess;
  chunks: Buffer[];
  totalBytes: number;
  backgrounded: boolean;
  exited: Promise<void>;
  killing?: Promise<void>;
}

export function killProcessTree(pid: number): Promise<void> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return Promise.resolve();
  if (process.platform === "win32") {
    return new Promise((done) => {
      execFile(
        "taskkill",
        ["/PID", String(pid), "/T", "/F"],
        { windowsHide: true, timeout: 10_000 },
        () => done(),
      );
    });
  }
  return new Promise((done) => {
    let group = true;
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      group = false;
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        done();
        return;
      }
    }
    const isAlive = () => {
      try {
        process.kill(group ? -pid : pid, 0);
        return true;
      } catch (error) {
        return (error as NodeJS.ErrnoException).code === "EPERM";
      }
    };
    const deadline = Date.now() + 800;
    const poll = setInterval(() => {
      if (!isAlive()) {
        clearInterval(poll);
        done();
        return;
      }
      if (Date.now() >= deadline) {
        clearInterval(poll);
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          try {
            process.kill(pid, "SIGKILL");
          } catch {}
        }
        done();
      }
    }, 25);
  });
}

function appendRing(live: LiveJob, chunk: Buffer): void {
  if (!chunk.length) return;
  live.chunks.push(chunk);
  live.totalBytes += chunk.length;
  while (live.totalBytes > RING_BUFFER_MAX_BYTES && live.chunks.length > 0) {
    const excess = live.totalBytes - RING_BUFFER_MAX_BYTES;
    const head = live.chunks[0]!;
    if (head.length <= excess) {
      live.chunks.shift();
      live.totalBytes -= head.length;
    } else {
      live.chunks[0] = head.subarray(excess);
      live.totalBytes -= excess;
    }
    live.record.truncated = true;
  }
  live.record.outputBytes = live.totalBytes;
}

function readRingTail(live: LiveJob, tailBytes: number): string {
  const combined = Buffer.concat(live.chunks);
  const slice =
    combined.length > tailBytes ? combined.subarray(combined.length - tailBytes) : combined;
  return slice.toString("utf8");
}

/**
 * Host-managed non-blocking shell execution for Kooyu supervisor turns (`noWait`).
 *
 * - Commands finishing within `yieldMs` (default 12s) return their exit code and output directly.
 * - Long-running commands yield cleanly to the background, persist to `background_jobs`,
 *   retain a 256 KiB output ring buffer, and optionally trigger a single completion wake (`notifyOnExit`).
 * - On Host startup, any persisted `running` jobs from a prior process are immediately marked `lost`
 *   and their stale PIDs are NEVER killed (avoiding Windows PID reuse hazards).
 */
export class BackgroundJobManager {
  private readonly live = new Map<string, LiveJob>();
  private readonly outputArchive = new Map<string, string>();
  private disposed = false;

  constructor(
    private readonly store: Store,
    private readonly onBackgroundExit?: (event: BackgroundJobExitEvent) => void,
  ) {
    const now = new Date().toISOString();
    this.store.db
      .prepare(
        `UPDATE background_jobs
         SET status = 'lost',
             updated_at = ?,
             data = json_set(data, '$.status', 'lost', '$.updatedAt', ?, '$.endedAt', ?)
         WHERE status = 'running'`,
      )
      .run(now, now, now);
  }

  private persist(job: BackgroundJob): void {
    this.store.db
      .prepare(
        `INSERT INTO background_jobs(id, session_id, workspace_id, status, created_at, updated_at, data)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           updated_at = excluded.updated_at,
           data = excluded.data`,
      )
      .run(
        job.id,
        job.sessionId,
        job.workspaceId,
        job.status,
        job.createdAt,
        job.updatedAt,
        JSON.stringify(job),
      );
  }

  get(jobId: string): BackgroundJob {
    const row = this.store.db.prepare("SELECT data FROM background_jobs WHERE id=?").get(jobId);
    if (!row) throw new KodoError("NOT_FOUND", "后台作业不存在。");
    return JSON.parse(String(row.data)) as BackgroundJob;
  }

  list(
    filter: { sessionId?: string; workspaceId?: string; status?: string } = {},
  ): BackgroundJob[] {
    const rows = this.store.db
      .prepare("SELECT data FROM background_jobs ORDER BY created_at DESC")
      .all();
    return rows
      .map((r) => JSON.parse(String(r.data)) as BackgroundJob)
      .filter(
        (j) =>
          (!filter.sessionId || j.sessionId === filter.sessionId) &&
          (!filter.workspaceId || j.workspaceId === filter.workspaceId) &&
          (!filter.status || j.status === filter.status),
      );
  }

  runningForWorkspace(workspaceId: string): BackgroundJob[] {
    return this.list({ workspaceId, status: "running" }).filter((j) => this.live.has(j.id));
  }

  runningForSession(sessionId: string): BackgroundJob[] {
    return this.list({ sessionId, status: "running" }).filter((j) => this.live.has(j.id));
  }

  drainExitNotifications(): void {
    if (!this.onBackgroundExit || this.disposed) return;
    for (const event of this.store.records<BackgroundJobExitEvent>("pending-job-exit")) {
      this.store.transaction(() => {
        this.onBackgroundExit!(event);
        this.store.remove("pending-job-exit", event.job.id);
      });
    }
  }

  async exec(input: {
    sessionId: string;
    workspaceId: string | null;
    cwd: string;
    command: string;
    background?: boolean;
    yieldMs?: number;
    notifyOnExit?: boolean;
  }): Promise<
    | {
        status: "exited";
        jobId: string;
        exitCode: number | null;
        signal: string | null;
        output: string;
        truncated: boolean;
      }
    | {
        status: "running";
        jobId: string;
        pid: number | null;
        recentOutput: string;
        notifyOnExit: boolean;
      }
  > {
    if (this.disposed) throw new KodoError("UNAVAILABLE", "宿主已关闭，无法启动命令。");
    const command = input.command.trim();
    if (!command) throw new KodoError("INVALID_INPUT", "命令不能为空。");
    if (!isAbsolute(input.cwd) || !existsSync(input.cwd) || !statSync(input.cwd).isDirectory())
      throw new KodoError("INVALID_INPUT", "工作目录无效或不存在。");

    const background = Boolean(input.background);
    const yieldMs = background
      ? 0
      : Math.max(
          MIN_YIELD_MS,
          Math.min(MAX_YIELD_MS, Math.round(input.yieldMs ?? DEFAULT_YIELD_MS)),
        );
    const notifyOnExit = typeof input.notifyOnExit === "boolean" ? input.notifyOnExit : !background;

    const env = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !SECRET_ENV.test(name)),
    );
    const child = spawn(command, {
      cwd: input.cwd,
      env,
      shell: true,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });

    const now = new Date().toISOString();
    const record: BackgroundJob = {
      id: randomUUID(),
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      cwd: input.cwd,
      command,
      pid: child.pid ?? null,
      status: "running",
      exitCode: null,
      signal: null,
      notifyOnExit,
      outputBytes: 0,
      truncated: false,
      createdAt: now,
      updatedAt: now,
      endedAt: null,
    };

    let resolveExited!: () => void;
    const exited = new Promise<void>((done) => {
      resolveExited = done;
    });
    const live: LiveJob = {
      record,
      child,
      chunks: [],
      totalBytes: 0,
      backgrounded: false,
      exited,
    };
    this.live.set(record.id, live);

    child.stdout?.on("data", (chunk: Buffer) => appendRing(live, chunk));
    child.stderr?.on("data", (chunk: Buffer) => appendRing(live, chunk));

    const finalize = (exitCode: number | null, signal: string | null, spawnError?: string) => {
      if (record.status !== "running") {
        resolveExited();
        return;
      }
      if (spawnError) appendRing(live, Buffer.from(`\n[spawn error] ${spawnError}\n`, "utf8"));
      const ended = new Date().toISOString();
      record.status = live.killing ? "killed" : "exited";
      record.exitCode = exitCode;
      record.signal = signal;
      record.updatedAt = ended;
      record.endedAt = ended;
      const tail = readRingTail(live, RING_BUFFER_MAX_BYTES);
      this.outputArchive.set(record.id, tail);
      if (this.outputArchive.size > 200) {
        const oldest = this.outputArchive.keys().next().value;
        if (oldest) this.outputArchive.delete(oldest);
      }
      if (live.backgrounded) {
        this.store.transaction(() => {
          this.persist(record);
          if (record.notifyOnExit && !live.killing && !this.disposed && this.onBackgroundExit) {
            this.store.put("pending-job-exit", record.id, {
              job: record,
              recentOutput: tail.slice(-INLINE_OUTPUT_PREVIEW_BYTES),
            });
          }
        });
      }
      this.live.delete(record.id);
      resolveExited();
      if (live.backgrounded && record.notifyOnExit && !live.killing && !this.disposed) {
        try {
          this.drainExitNotifications();
        } catch (error) {
          console.error("后台作业通知留待重试", error);
        }
      }
    };

    child.on("error", (err) => finalize(null, null, err.message));
    child.on("close", (code, sig) => finalize(code, sig));

    if (yieldMs === 0) {
      live.backgrounded = true;
      this.persist(record);
      return {
        status: "running",
        jobId: record.id,
        pid: record.pid,
        recentOutput: readRingTail(live, INLINE_OUTPUT_PREVIEW_BYTES),
        notifyOnExit: record.notifyOnExit,
      };
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const yielded = await Promise.race([
      exited.then(() => false),
      new Promise<boolean>((done) => {
        timer = setTimeout(() => done(true), yieldMs);
        timer.unref();
      }),
    ]);
    if (timer) clearTimeout(timer);

    if (!yielded && record.status !== "running") {
      return {
        status: "exited",
        jobId: record.id,
        exitCode: record.exitCode,
        signal: record.signal,
        output: this.outputArchive.get(record.id) ?? readRingTail(live, RING_BUFFER_MAX_BYTES),
        truncated: record.truncated,
      };
    }

    live.backgrounded = true;
    this.persist(record);
    return {
      status: "running",
      jobId: record.id,
      pid: record.pid,
      recentOutput: readRingTail(live, INLINE_OUTPUT_PREVIEW_BYTES),
      notifyOnExit: record.notifyOnExit,
    };
  }

  output(
    jobId: string,
    tailBytes = 16 * 1024,
  ): {
    job: BackgroundJob;
    output: string;
    truncated: boolean;
  } {
    const job = this.get(jobId);
    const limit = Math.max(256, Math.min(RING_BUFFER_MAX_BYTES, Math.round(tailBytes)));
    const live = this.live.get(jobId);
    if (live) {
      return {
        job: { ...live.record },
        output: readRingTail(live, limit),
        truncated: live.record.truncated || live.totalBytes > limit,
      };
    }
    const archived = this.outputArchive.get(jobId) ?? "";
    return {
      job,
      output: archived.length > limit ? archived.slice(archived.length - limit) : archived,
      truncated: job.truncated || archived.length > limit,
    };
  }

  async kill(jobId: string): Promise<BackgroundJob> {
    const job = this.get(jobId);
    const live = this.live.get(jobId);
    if (!live) {
      // Never kill stale PIDs that do not belong to a live process spawned by this Host instance.
      if (job.status === "running") {
        const now = new Date().toISOString();
        const lost: BackgroundJob = { ...job, status: "lost", updatedAt: now, endedAt: now };
        this.persist(lost);
        return lost;
      }
      return job;
    }
    if (!live.killing) {
      live.killing = (async () => {
        if (live.record.pid) await killProcessTree(live.record.pid);
        else live.child.kill("SIGKILL");
        let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          live.exited,
          new Promise<void>((done) => {
            fallbackTimer = setTimeout(done, 3000);
          }),
        ]);
        if (fallbackTimer) clearTimeout(fallbackTimer);
      })();
    }
    await live.killing;
    return this.get(jobId);
  }

  async stopSession(sessionId: string): Promise<number> {
    const running = [...this.live.values()].filter((j) => j.record.sessionId === sessionId);
    await Promise.allSettled(running.map((j) => this.kill(j.record.id)));
    return running.length;
  }

  async stopWorkspace(workspaceId: string): Promise<number> {
    const running = [...this.live.values()].filter((j) => j.record.workspaceId === workspaceId);
    await Promise.allSettled(running.map((j) => this.kill(j.record.id)));
    return running.length;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const ids = [...this.live.keys()];
    await Promise.allSettled(ids.map((id) => this.kill(id)));
  }
}

export const BACKGROUND_JOB_TOOL_NAMES = [
  "shell_exec",
  "job_status",
  "job_output",
  "job_kill",
] as const;

export function createBackgroundJobTools(
  manager: BackgroundJobManager,
  session: Session,
  defaultCwd: string,
  toolAction?: <T>(callId: string, args: unknown, operation: () => Promise<T>) => Promise<T>,
): ToolDefinition[] {
  const reply = (value: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    details: {},
  });
  const owned = (jobId: string) => {
    const job = manager.get(jobId);
    if (job.sessionId !== session.id)
      throw new KodoError("UNAUTHORIZED", "该后台作业不属于当前主对话。");
    return job;
  };
  const resolveCwd = (requested?: string): string => {
    if (!requested) return defaultCwd;
    const resolved = isAbsolute(requested) ? requested : resolve(defaultCwd, requested);
    if (!existsSync(resolved) || !statSync(resolved).isDirectory())
      throw new KodoError("INVALID_INPUT", "指定工作目录不存在。");
    return resolved;
  };

  return [
    {
      name: "shell_exec",
      label: "shell_exec",
      description:
        "Run a local shell command with a non-blocking foreground guardrail (default 12s). Commands finishing within yieldMs return their full exitCode and output directly. Longer commands automatically yield to a Host-managed background job so this main conversation stays responsive; notifyOnExit defaults to true for auto-yielded commands and false for explicit background=true services. Use job_status, job_output, and job_kill to inspect or stop background jobs.",
      parameters: Type.Object({
        command: Type.String({ minLength: 1, maxLength: 16000 }),
        cwd: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })),
        background: Type.Optional(Type.Boolean()),
        yieldMs: Type.Optional(Type.Integer({ minimum: 500, maximum: 60000 })),
        notifyOnExit: Type.Optional(Type.Boolean()),
      }),
      async execute(callId, input) {
        const p = input as Wire;
        const cwd = resolveCwd(typeof p.cwd === "string" ? p.cwd : undefined);
        const run = async () => {
          const result = await manager.exec({
            sessionId: session.id,
            workspaceId: session.workspaceId,
            cwd,
            command: String(p.command),
            background: typeof p.background === "boolean" ? p.background : undefined,
            yieldMs: typeof p.yieldMs === "number" ? p.yieldMs : undefined,
            notifyOnExit: typeof p.notifyOnExit === "boolean" ? p.notifyOnExit : undefined,
          });
          return result.status === "running" ? { ...result, spawnedJobId: result.jobId } : result;
        };
        const value = toolAction
          ? await toolAction(callId, { tool: "shell_exec", command: p.command, cwd }, run)
          : await run();
        return reply(value);
      },
    },
    {
      name: "job_status",
      label: "job_status",
      description:
        "Check status of one Host-managed background job or list jobs for this conversation.",
      parameters: Type.Object({
        jobId: Type.Optional(Type.String()),
      }),
      async execute(_callId, input) {
        const p = input as Wire;
        if (typeof p.jobId === "string" && p.jobId) return reply(owned(p.jobId));
        return reply({ jobs: manager.list({ sessionId: session.id }) });
      },
    },
    {
      name: "job_output",
      label: "job_output",
      description:
        "Read bounded tail output from a Host-managed background job owned by this conversation.",
      parameters: Type.Object({
        jobId: Type.String(),
        tailBytes: Type.Optional(Type.Integer({ minimum: 256, maximum: 262144 })),
      }),
      async execute(_callId, input) {
        const p = input as Wire;
        owned(String(p.jobId));
        return reply(
          manager.output(String(p.jobId), typeof p.tailBytes === "number" ? p.tailBytes : 16384),
        );
      },
    },
    {
      name: "job_kill",
      label: "job_kill",
      description: "Terminate a running Host-managed background job and its child process tree.",
      parameters: Type.Object({
        jobId: Type.String(),
      }),
      async execute(_callId, input) {
        const p = input as Wire;
        owned(String(p.jobId));
        return reply(await manager.kill(String(p.jobId)));
      },
    },
  ];
}
