import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KodoError } from "@kodo/protocol";
import type { Store } from "../storage/store.js";

export interface GitCheckpointRecord {
  id: string;
  workspaceId: string | null;
  workspaceRoot: string;
  sessionId: string | null;
  label: string;
  treeSha: string;
  commitSha: string;
  ref: string;
  changedFiles: string[];
  createdAt: string;
}

function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = process.env): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd, env, windowsHide: true, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new KodoError(
              "UNAVAILABLE",
              `Git Checkpoint 操作失败（git ${args[0]}）：${String(stderr || error.message)
                .trim()
                .slice(0, 300)}`,
            ),
          );
          return;
        }
        resolve(String(stdout ?? "").trim());
      },
    );
  });
}

/**
 * Git Checkpoints ("Undo Time Machine").
 *
 * Captures working-tree snapshots (tracked + untracked files) using an isolated
 * temporary GIT_INDEX_FILE and stores them under hidden `refs/kooyu/checkpoints/<id>`,
 * leaving the user's real Git index, stash stack, branch, and `git log` 100% untouched.
 */
export class GitCheckpointService {
  constructor(private readonly store: Store) {}

  list(filter: { workspaceId?: string; sessionId?: string } = {}): GitCheckpointRecord[] {
    return this.store
      .records<GitCheckpointRecord>("git-checkpoint")
      .filter(
        (cp) =>
          (!filter.workspaceId || cp.workspaceId === filter.workspaceId) &&
          (!filter.sessionId || cp.sessionId === filter.sessionId),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async capture(input: {
    workspaceRoot: string;
    label: string;
    workspaceId?: string | null;
    sessionId?: string | null;
  }): Promise<GitCheckpointRecord> {
    const root = input.workspaceRoot;
    if (!existsSync(root)) {
      throw new KodoError("INVALID_INPUT", `工作区目录不存在：${root}`);
    }
    const inside = await git(root, ["rev-parse", "--is-inside-work-tree"]).catch(() => "false");
    if (inside !== "true") {
      throw new KodoError("UNSUPPORTED", `目录不是 Git 仓库，无法创建 Checkpoint：${root}`);
    }

    const gitDir = await git(root, ["rev-parse", "--absolute-git-dir"]);
    const statusRaw = await git(root, ["status", "--porcelain"]);
    const changedFiles = statusRaw
      ? statusRaw
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => line.slice(3).trim())
      : [];

    const tempDir = mkdtempSync(join(tmpdir(), "kooyu-cp-idx-"));
    const tempIndex = join(tempDir, "index");
    try {
      const realIndex = join(gitDir, "index");
      if (existsSync(realIndex)) {
        copyFileSync(realIndex, tempIndex);
      }
      const env = { ...process.env, GIT_INDEX_FILE: tempIndex };
      await git(root, ["add", "-A"], env);
      const treeSha = await git(root, ["write-tree"], env);

      const headSha = await git(root, ["rev-parse", "HEAD"]).catch(() => "");
      const commitArgs = [
        "commit-tree",
        treeSha,
        ...(headSha ? ["-p", headSha] : []),
        "-m",
        `kooyu-checkpoint: ${input.label}`,
      ];
      const commitEnv = {
        ...process.env,
        GIT_AUTHOR_NAME: "Kooyu Checkpoint",
        GIT_AUTHOR_EMAIL: "checkpoint@kooyu.local",
        GIT_COMMITTER_NAME: "Kooyu Checkpoint",
        GIT_COMMITTER_EMAIL: "checkpoint@kooyu.local",
      };
      const commitSha = await git(root, commitArgs, commitEnv);
      const id = randomUUID();
      const ref = `refs/kooyu/checkpoints/${id}`;
      await git(root, ["update-ref", ref, commitSha]);

      const record: GitCheckpointRecord = {
        id,
        workspaceId: input.workspaceId ?? null,
        workspaceRoot: root,
        sessionId: input.sessionId ?? null,
        label: input.label.trim().slice(0, 160) || "工作区快照",
        treeSha,
        commitSha,
        ref,
        changedFiles: changedFiles.slice(0, 200),
        createdAt: new Date().toISOString(),
      };
      this.store.put("git-checkpoint", id, record);
      return record;
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  /**
   * Restores the workspace working tree back to a captured checkpoint.
   * Automatically captures a pre-restore safety checkpoint first so even an undo is reversible.
   */
  async restore(id: string): Promise<{
    restored: GitCheckpointRecord;
    safetyCheckpoint: GitCheckpointRecord;
  }> {
    const target = this.store.record<GitCheckpointRecord>("git-checkpoint", id);
    if (!target) throw new KodoError("NOT_FOUND", `未找到 Checkpoint：${id}`);
    const root = target.workspaceRoot;

    // 1. Capture a safety snapshot before restoring so rollback itself is reversible
    const safetyCheckpoint = await this.capture({
      workspaceRoot: root,
      workspaceId: target.workspaceId,
      sessionId: target.sessionId,
      label: `回退前自动保护快照（目标：${target.label}）`,
    });

    // 2. Restore files from target tree without altering HEAD branch or commits
    const tempDir = mkdtempSync(join(tmpdir(), "kooyu-cp-restore-"));
    const tempIndex = join(tempDir, "index");
    try {
      const env = { ...process.env, GIT_INDEX_FILE: tempIndex };
      // Identify untracked files currently in working tree that didn't exist in target tree
      const currentUntracked = await git(root, ["ls-files", "--others", "--exclude-standard"]);
      await git(root, ["read-tree", target.treeSha], env);
      const targetFilesRaw = await git(root, ["ls-files"], env);
      const targetSet = new Set(
        targetFilesRaw ? targetFilesRaw.split(/\r?\n/).filter(Boolean) : [],
      );

      // Remove untracked files created after the checkpoint
      for (const file of currentUntracked ? currentUntracked.split(/\r?\n/).filter(Boolean) : []) {
        if (!targetSet.has(file)) {
          rmSync(join(root, file), { force: true });
        }
      }
      // Checkout exact snapshot contents to working tree using the temporary index
      await git(root, ["checkout-index", "-a", "-f"], env);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }

    return { restored: target, safetyCheckpoint };
  }
}
