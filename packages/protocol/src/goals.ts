import { z } from "zod";

/**
 * A Goal is one piece of acceptable work owned by a Kooyu main conversation.
 * Native turns ending, or the model saying "done", never completes a goal:
 * the model can only move it to awaiting-review; the user accepts it.
 */
export const GOAL_STATUSES = [
  "draft",
  "active",
  "blocked",
  "awaiting-review",
  "completed",
  "cancelled",
] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];
export const VERIFICATION_STATUSES = ["unverified", "passed", "failed", "not-applicable"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/** Git state captured when a goal starts, so final changes can be attributed honestly. */
export interface GoalBaseline {
  workspaceId: string;
  rootPath: string;
  capturedAt: string;
  git: boolean;
  head: string | null;
  /** Files already dirty (staged/unstaged/untracked) when the goal started. */
  dirty: { path: string; status: string; sha256: string | null }[];
  truncated: boolean;
  error?: string;
}

export interface GoalChange {
  path: string;
  /**
   * introduced: clean at baseline, changed since (agent or another writer in a shared tree);
   * preexisting-modified: already dirty at baseline and changed again (attribution unknown).
   */
  attribution: "introduced" | "preexisting-modified";
  status: string;
}

export interface GoalChangeReport {
  workspaceId: string;
  rootPath: string;
  comparedTo: string | null;
  changes: GoalChange[];
  /** Files dirty at baseline and unchanged since; listed so they are not credited to the goal. */
  preexistingUnchanged: number;
  coverage: string;
  error?: string;
}

export interface GoalResult {
  summary: string;
  deliverables: string[];
  limitations: string[];
  reportedAt: string;
  reportedBy: "model" | "user";
  changes?: GoalChangeReport[];
}

export interface GoalAcceptance {
  actor: "user";
  at: string;
  verificationStatus: VerificationStatus;
  remainingUncertainty: string | null;
}

export interface Goal {
  id: string;
  projectId: string | null;
  controllerSessionId: string;
  revision: number;
  /** Increments when the description or acceptance criteria change; older checks no longer count. */
  scopeRevision: number;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  workspaceIds: string[];
  sessionIds: string[];
  status: GoalStatus;
  blockedReason: string | null;
  verificationStatus: VerificationStatus;
  artifactIds: string[];
  verificationIds: string[];
  baselines: GoalBaseline[];
  result: GoalResult | null;
  acceptedBy: GoalAcceptance | null;
  /** User takeover/cancellation facts; the goal itself is kept. */
  notes: { at: string; actor: "user" | "model" | "host"; text: string }[];
  createdAt: string;
  updatedAt: string;
}

export const VERIFICATION_KINDS = [
  "command",
  "test",
  "build",
  "review",
  "source-check",
  "manual",
  "other",
] as const;
export interface Verification {
  id: string;
  goalId: string;
  goalRevision: number;
  scopeRevision: number;
  kind: (typeof VERIFICATION_KINDS)[number];
  /** Command line or short description of the method. */
  method: string;
  /** Where the check ran (host + workspace path), null for attestations. */
  location: string | null;
  exitCode: number | null;
  outcome: "passed" | "failed" | "inconclusive";
  /** host: Kooyu executed it and recorded the real exit code. model/user: attestation. */
  recordedBy: "host" | "model" | "user";
  evidence: string;
  durationMs: number | null;
  timedOut?: boolean;
  /** Hashes of files the check relied on, taken right after it ran. */
  fileHashes?: { path: string; sha256: string | null }[];
  createdAt: string;
}

export interface GoalHistoryEntry {
  goalId: string;
  revision: number;
  status: GoalStatus;
  verificationStatus: VerificationStatus;
  actor: "user" | "model" | "host";
  change: string;
  at: string;
}

const text = (max: number) => z.string().trim().max(max);
const criteria = z.array(text(2000).min(1)).max(50);
export const createGoalSchema = z
  .object({
    requestId: z.string().uuid(),
    controllerSessionId: z.string().uuid(),
    title: text(200).min(1),
    description: text(20000).default(""),
    acceptanceCriteria: criteria.default([]),
    workspaceIds: z.array(z.string().uuid()).max(20).default([]),
    sessionIds: z.array(z.string().uuid()).max(100).default([]),
    status: z.enum(["draft", "active"]).default("active"),
  })
  .strict();
export const updateGoalSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedRevision: z.number().int().positive(),
    title: text(200).min(1).optional(),
    description: text(20000).optional(),
    acceptanceCriteria: criteria.optional(),
    status: z.enum(["draft", "active", "blocked"]).optional(),
    blockedReason: text(2000).min(1).nullable().optional(),
    addSessionIds: z.array(z.string().uuid()).max(100).optional(),
    addWorkspaceIds: z.array(z.string().uuid()).max(20).optional(),
    note: text(4000).min(1).optional(),
  })
  .strict()
  .refine((v) => v.status !== "blocked" || Boolean(v.blockedReason), {
    message: "目标受阻需要说明原因。",
  });
export const recordVerificationSchema = z
  .object({
    requestId: z.string().uuid(),
    kind: z.enum(VERIFICATION_KINDS),
    method: text(4000).min(1),
    outcome: z.enum(["passed", "failed", "inconclusive"]),
    evidence: text(20000).default(""),
  })
  .strict();
export const runCheckSchema = z
  .object({
    requestId: z.string().uuid(),
    kind: z.enum(["command", "test", "build"]).default("command"),
    command: text(4000).min(1),
    workspaceId: z.string().uuid().optional(),
    timeoutSeconds: z.number().int().min(1).max(1800).default(300),
    /** Workspace-relative files to hash after the check, e.g. a generated report. */
    hashFiles: z.array(text(1000).min(1)).max(50).default([]),
  })
  .strict();
export const completeGoalSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedRevision: z.number().int().positive(),
    summary: text(20000).min(1),
    deliverables: z.array(text(2000).min(1)).max(100).default([]),
    limitations: z.array(text(2000).min(1)).max(100).default([]),
  })
  .strict();
export const reviewGoalSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedRevision: z.number().int().positive(),
    decision: z.enum(["accept", "request-changes", "not-applicable", "cancel"]),
    note: text(4000).min(1).optional(),
    remainingUncertainty: text(4000).min(1).optional(),
    /** cancel only: also request cancellation of running linked native turns. */
    stopSessions: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.decision !== "request-changes" || Boolean(v.note), {
    message: "要求修改需要说明原因。",
  });
export type CreateGoal = z.infer<typeof createGoalSchema>;
export type UpdateGoal = z.infer<typeof updateGoalSchema>;
