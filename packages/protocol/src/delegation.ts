import { z } from "zod";
import type { HarnessId, Supervision } from "./index.js";

export type WorktreeLifecycleState = "preparing" | "ready" | "failed" | "deleting" | "archived";
export type WorktreeDependencyMode = "none" | "junction" | "prepare-command";
export type DelegationStatus =
  "provisioning" | "running" | "awaiting-review" | "completed" | "blocked" | "cancelled" | "failed";
export type DelegationProvisioningStep =
  "step_0_ticket" | "step_1_worktree" | "step_2_session" | "step_3_watch" | "step_4_send" | "ready";
export type DelegationIsolation = "worktree" | "shared" | "auto";
export type DelegationWaitPolicy = "any" | "all";
export type BackgroundJobStatus = "running" | "exited" | "killed" | "lost";

export interface WorkspaceWorktree {
  workspaceId: string;
  parentWorkspaceId: string;
  projectId: string | null;
  rootPath: string;
  branchName: string;
  baseRef: string | null;
  baseCommit: string | null;
  lifecycleState: WorktreeLifecycleState;
  dependencyMode: WorktreeDependencyMode;
  linkedNodeModules: boolean;
  copiedEnvFiles: string[];
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DelegationMandate {
  grantScope?: "project" | "worker";
  initiator: "user" | "rule";
  projectId: string;
  allowedWorkspaceId: string | null;
  worktreeBranch: string | null;
  isolation: "worktree" | "shared";
  allowedOperations: string[];
  projectGrantRevision: number;
  projectGrantGeneration: number;
  limits: Supervision["limits"];
}

export interface DelegationReport {
  ticketId: string;
  workerSessionId: string;
  harnessId: HarnessId;
  branchName: string | null;
  isolation: "worktree" | "shared";
  fallbackNote?: string | null;
  /** Deterministic facts computed directly by Host via Git */
  gitFacts: {
    git: boolean;
    baseCommit: string | null;
    headCommit: string | null;
    dirtyCount: number;
    diffStat: { filesChanged: number; insertions: number; deletions: number; paths: string[] };
  };
  /** Authoritative checks executed by Host (goal.check) — ONLY these prove verification */
  hostVerifications: { id: string; command: string; exitCode: number; passed: boolean }[];
  /** Untrusted worker output summary — NEVER treated as verified completion */
  workerClaim: {
    verification: "unverified-worker-claim";
    nativeStatus: string;
    lastOutcome: string | null;
    lastError: string | null;
    replyExcerpt: string | null;
    openInteractions: number;
  };
}

export interface DelegationTicket {
  id: string;
  batchId: string | null;
  controllerSessionId: string;
  workerSessionId: string | null;
  watchId: string | null;
  goalId: string | null;
  title: string;
  harnessId: HarnessId;
  status: DelegationStatus;
  waitPolicy: DelegationWaitPolicy;
  mandate: DelegationMandate;
  provisioningStep: DelegationProvisioningStep;
  report: DelegationReport | null;
  fallbackNote?: string | null;
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BackgroundJob {
  id: string;
  sessionId: string;
  workspaceId: string | null;
  cwd: string;
  command: string;
  pid: number | null;
  status: BackgroundJobStatus;
  exitCode: number | null;
  signal: string | null;
  notifyOnExit: boolean;
  outputBytes: number;
  truncated: boolean;
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
}

export interface ProjectWorktreePolicy {
  worktreeRootPath?: string | null;
  dependencyMode: WorktreeDependencyMode;
  prepareCommand?: string | null;
  envFileWhitelist: string[];
}

export const projectWorktreePolicySchema = z
  .object({
    worktreeRootPath: z.string().trim().min(1).max(4096).nullable().optional(),
    dependencyMode: z.enum(["none", "junction", "prepare-command"]).default("none"),
    prepareCommand: z.string().trim().min(1).max(2000).nullable().optional(),
    envFileWhitelist: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
  })
  .strict();

export const createWorktreeSchema = z
  .object({
    rootPath: z.string().trim().min(1).max(4096).optional(),
    branchName: z.string().trim().min(1).max(200).optional(),
    slug: z.string().trim().min(1).max(80).optional(),
    baseRef: z.string().trim().min(1).max(200).optional(),
    dependencyMode: z.enum(["none", "junction", "prepare-command"]).optional(),
    prepareCommand: z.string().trim().min(1).max(2000).optional(),
    envFileWhitelist: z.array(z.string().trim().min(1).max(200)).max(30).optional(),
  })
  .strict();
