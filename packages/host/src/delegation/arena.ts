import { exec, execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { KodoError, type HarnessId } from "@kodo/protocol";
import type { SessionService } from "../session-service.js";
import { stripAmbientSecrets } from "../execution/clean-env.js";

export interface ArenaCompetitor {
  harnessId: HarnessId;
  ticketId: string;
  sessionId: string;
  worktreePath: string | null;
  branchName: string | null;
}

export interface ArenaRunRecord {
  id: string;
  controllerSessionId: string;
  title: string;
  task: string;
  projectId: string | null;
  workspaceId: string | null;
  checkCommand: string | null;
  competitors: ArenaCompetitor[];
  status: "running" | "compared" | "accepted";
  winnerTicketId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ArenaScorecardEntry {
  harnessId: HarnessId;
  ticketId: string;
  sessionId: string;
  sessionStatus: string;
  branchName: string | null;
  worktreePath: string | null;
  filesChanged: number;
  diffStat: string;
  checkPassed: boolean | null;
  checkExitCode: number | null;
  checkOutput: string | null;
  lastReply: string | null;
}

function execText(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs = 60_000,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
        env: stripAmbientSecrets(process.env),
      },
      (error, stdout, stderr) => {
        const code =
          error && typeof (error as { code?: unknown }).code === "number"
            ? Number((error as { code: number }).code)
            : error
              ? 1
              : 0;
        resolve({
          exitCode: code,
          stdout: String(stdout ?? "")
            .trim()
            .slice(0, 4000),
          stderr: String(stderr ?? "")
            .trim()
            .slice(0, 1200),
        });
      },
    );
  });
}

function runShellCheck(
  command: string,
  cwd: string,
): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve) => {
    exec(
      command,
      {
        cwd,
        timeout: 120_000,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
        env: stripAmbientSecrets(process.env),
      },
      (error, stdout, stderr) => {
        const exitCode =
          error && typeof (error as { code?: unknown }).code === "number"
            ? Number((error as { code: number }).code)
            : error
              ? 1
              : 0;
        resolve({
          exitCode,
          output: [String(stdout ?? "").trim(), String(stderr ?? "").trim()]
            .filter(Boolean)
            .join("\n")
            .slice(0, 4000),
        });
      },
    );
  });
}

/**
 * Multi-Harness Arena Service (Kooyu Signature Feature).
 *
 * Launches 2-3 different Harnesses in parallel isolated Git Worktrees on the exact same
 * task, runs the same deterministic verification command against every contender, and
 * produces a side-by-side Diff + Test Scorecard for one-click winner acceptance.
 */
export class MultiHarnessArenaService {
  constructor(private readonly service: SessionService) {}

  list(controllerSessionId?: string): ArenaRunRecord[] {
    return this.service.store
      .records<ArenaRunRecord>("harness-arena")
      .filter((a) => !controllerSessionId || a.controllerSessionId === controllerSessionId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): ArenaRunRecord {
    const run = this.service.store.record<ArenaRunRecord>("harness-arena", id);
    if (!run) throw new KodoError("NOT_FOUND", `未找到竞技场记录：${id}`);
    return run;
  }

  async launch(input: {
    controllerSessionId: string;
    callId: string;
    title: string;
    task: string;
    harnesses: HarnessId[];
    projectId?: string;
    workspaceId?: string;
    checkCommand?: string;
  }): Promise<ArenaRunRecord> {
    const uniqueHarnesses = [...new Set(input.harnesses)];
    if (uniqueHarnesses.length < 2 || uniqueHarnesses.length > 3) {
      throw new KodoError("INVALID_INPUT", "多引擎竞技场需要选择 2 到 3 款不同的 Harness。");
    }
    const batch = await this.service.delegations.delegateBatch({
      controllerSessionId: input.controllerSessionId,
      callId: input.callId,
      waitPolicy: "all",
      tasks: uniqueHarnesses.map((harnessId) => ({
        harnessId,
        title: `[竞技场] ${input.title} · ${harnessId}`,
        task: input.task,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        isolation: "worktree",
      })),
    });

    const now = new Date().toISOString();
    const record: ArenaRunRecord = {
      id: randomUUID(),
      controllerSessionId: input.controllerSessionId,
      title: input.title.trim(),
      task: input.task.trim(),
      projectId: input.projectId ?? null,
      workspaceId: input.workspaceId ?? null,
      checkCommand: input.checkCommand?.trim() || null,
      competitors: batch.delegations.map((item) => ({
        harnessId: item.session.harnessId,
        ticketId: item.ticket.id,
        sessionId: item.session.id,
        worktreePath: item.worktree?.rootPath ?? null,
        branchName: item.worktree?.branchName ?? null,
      })),
      status: "running",
      winnerTicketId: null,
      createdAt: now,
      updatedAt: now,
    };
    this.service.store.put("harness-arena", record.id, record);
    return record;
  }

  async compare(
    arenaId: string,
    overrideCheckCommand?: string,
  ): Promise<{
    arena: ArenaRunRecord;
    scorecard: ArenaScorecardEntry[];
  }> {
    const arena = this.get(arenaId);
    const checkCmd = overrideCheckCommand?.trim() || arena.checkCommand;
    const scorecard: ArenaScorecardEntry[] = [];

    for (const c of arena.competitors) {
      const progress = this.service.progress(c.sessionId);
      let diffStat = "";
      let filesChanged = 0;
      let checkPassed: boolean | null = null;
      let checkExitCode: number | null = null;
      let checkOutput: string | null = null;

      if (c.worktreePath) {
        const statRes = await execText("git", ["status", "--porcelain"], c.worktreePath);
        const lines = statRes.stdout ? statRes.stdout.split(/\r?\n/).filter(Boolean) : [];
        filesChanged = lines.length;
        const diffRes = await execText("git", ["diff", "--stat"], c.worktreePath);
        diffStat = diffRes.stdout || (filesChanged ? `${filesChanged} 个文件变更` : "无文件改动");

        if (checkCmd) {
          const checkRes = await runShellCheck(checkCmd, c.worktreePath);
          checkExitCode = checkRes.exitCode;
          checkPassed = checkRes.exitCode === 0;
          checkOutput = checkRes.output;
        }
      }

      scorecard.push({
        harnessId: c.harnessId,
        ticketId: c.ticketId,
        sessionId: c.sessionId,
        sessionStatus: progress.status,
        branchName: c.branchName,
        worktreePath: c.worktreePath,
        filesChanged,
        diffStat,
        checkPassed,
        checkExitCode,
        checkOutput,
        lastReply: progress.lastReply ?? null,
      });
    }

    const updated: ArenaRunRecord = {
      ...arena,
      status: arena.status === "accepted" ? "accepted" : "compared",
      updatedAt: new Date().toISOString(),
    };
    this.service.store.put("harness-arena", updated.id, updated);
    return { arena: updated, scorecard };
  }

  acceptWinner(arenaId: string, winnerTicketId: string): ArenaRunRecord {
    const arena = this.get(arenaId);
    const winner = arena.competitors.find((c) => c.ticketId === winnerTicketId);
    if (!winner) throw new KodoError("NOT_FOUND", "指定的胜出方案不属于该竞技场。");
    const updated: ArenaRunRecord = {
      ...arena,
      status: "accepted",
      winnerTicketId: winner.ticketId,
      updatedAt: new Date().toISOString(),
    };
    this.service.store.put("harness-arena", updated.id, updated);
    return updated;
  }
}
