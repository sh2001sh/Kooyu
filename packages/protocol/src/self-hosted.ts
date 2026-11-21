import { z } from "zod";

export const globalMemorySettingsSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    enabled: z.boolean().default(true),
    automaticSaving: z.boolean().default(true),
  })
  .strict();
export type GlobalMemorySettings = z.infer<typeof globalMemorySettingsSchema>;
export const globalMemorySettingsInputSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    enabled: z.boolean(),
    automaticSaving: z.boolean(),
  })
  .strict();

export const memoryInputSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedRevision: z.number().int().positive().optional(),
    scope: z.enum(["user", "project"]),
    projectId: z.string().uuid().nullable().default(null),
    subject: z.string().trim().min(1).max(200),
    content: z.string().trim().min(1).max(12000),
    sourceRefs: z.array(z.string().max(1000)).min(1).max(30),
    status: z.enum(["proposed", "confirmed", "deleted"]).default("proposed"),
  })
  .strict();
export const AGENT_DOC_NAMES = [
  "SOUL.md",
  "USER.md",
  "MEMORY.md",
  "RULES.md",
  "HEARTBEAT.md",
  "AGENTS.md",
  "ROUTING.md",
] as const;
export const agentDocNameSchema = z.enum(AGENT_DOC_NAMES);
export type AgentDocName = z.infer<typeof agentDocNameSchema>;

export const curatedSkillFileSchema = z
  .object({
    path: z.string().trim().min(1).max(200),
    content: z.string().max(200 * 1024),
  })
  .strict();

export const sedimentSkillInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9-]{1,47}$/, "技能标识需为 2-48 位小写字母、数字或连字符。"),
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(240),
    body: z.string().trim().min(1).max(20000),
    scripts: z.array(curatedSkillFileSchema).max(20).optional(),
    references: z.array(curatedSkillFileSchema).max(20).optional(),
    fromSessionId: z.string().max(120).optional(),
    fromHarnessId: z.string().max(60).optional(),
    distributeToShared: z.boolean().default(true),
  })
  .strict();
export type SedimentSkillInput = z.infer<typeof sedimentSkillInputSchema>;

export interface CuratedSkillRecord {
  name: string;
  title: string;
  description: string;
  version: number;
  historyVersions: number[];
  path: string;
  sharedPath?: string | null;
  fromSessionId?: string | null;
  fromHarnessId?: string | null;
  uses: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ConsolidationProposal {
  id: string;
  targetDoc: "MEMORY.md" | "AGENTS.md";
  title: string;
  content: string;
  sources: string[];
  status: "pending" | "approved" | "dismissed";
  createdAt: string;
  resolvedAt?: string | null;
}

export const knowledgeMountInputSchema = z
  .object({
    requestId: z.string().uuid(),
    label: z.string().trim().min(1).max(120),
    path: z.string().trim().min(1).max(1000),
  })
  .strict();
export type KnowledgeMountInput = z.infer<typeof knowledgeMountInputSchema>;

export interface KnowledgeMount {
  id: string;
  label: string;
  path: string;
  createdAt: string;
}

export interface KnowledgeSearchHit {
  mountId: string;
  mountLabel: string;
  relativePath: string;
  absolutePath: string;
  line: number;
  snippet: string;
  score: number;
}

export interface InteractivePageRecord {
  id: string;
  sessionId: string | null;
  title: string;
  summary: string;
  path: string;
  url: string;
  createdAt: string;
}

export const ruleModeSchema = z.enum(["ask", "allow"]);
export type RuleMode = z.infer<typeof ruleModeSchema>;

export const alwaysRuleSpecSchema = z
  .object({
    mode: ruleModeSchema,
    text: z.string().trim().min(1).max(300),
  })
  .strict();
export type AlwaysRuleSpec = z.infer<typeof alwaysRuleSpecSchema>;

export const askUserOptionSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(160),
    description: z.string().trim().max(400).optional(),
    alwaysRule: alwaysRuleSpecSchema.optional(),
  })
  .strict();
export type AskUserOption = z.infer<typeof askUserOptionSchema>;

export const askUserQuestionSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    question: z.string().trim().min(1).max(500),
    body: z.string().trim().max(1200).optional(),
    multi_select: z.boolean().default(false),
    allow_other: z.boolean().default(true),
    options: z.array(askUserOptionSchema).max(6).default([]),
  })
  .strict();
export type AskUserQuestion = z.infer<typeof askUserQuestionSchema>;

export const askUserInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    detail: z.string().trim().max(2000).optional(),
    questions: z.array(askUserQuestionSchema).min(1).max(8),
  })
  .strict();
export type AskUserInput = z.infer<typeof askUserInputSchema>;

export interface HeartbeatAnomaly {
  fingerprint: string;
  kind: "stalled-session" | "stale-interaction" | "blocked-goal" | "check-script";
  severity: "info" | "warning" | "error";
  title: string;
  detail: string;
  sessionId?: string | null;
  goalId?: string | null;
  onHit?: "notify" | "wake";
}

export interface HeartbeatStatus {
  enabled: boolean;
  intervalMinutes: number;
  stallMinutes: number;
  lastCheckedAt: string | null;
  lastOutcome: "idle" | "quiet" | "hit" | "error";
  activeAnomalies: HeartbeatAnomaly[];
  lastError: string | null;
}

export const automationCheckScriptSchema = z
  .object({
    command: z.string().trim().min(1).max(2000),
    cwd: z.string().trim().min(1).max(1000).optional(),
    timeoutSec: z.number().int().min(5).max(120).default(60),
    mode: z
      .enum(["non-empty-stdout-is-hit", "exit-zero-is-hit"])
      .default("non-empty-stdout-is-hit"),
    onHit: z.enum(["wake", "notify"]).default("wake"),
  })
  .strict();
export type AutomationCheckScript = z.infer<typeof automationCheckScriptSchema>;

export interface AgentDoc {
  name: AgentDocName;
  path: string;
  content: string;
  revision: string;
  updatedAt: string;
  sizeBytes: number;
  isDefault: boolean;
}

export const agentDocUpdateInputSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedRevision: z.string().min(1).max(128).optional(),
    content: z.string().max(32000),
  })
  .strict();

export interface MemoryEntry {
  id: string;
  scope: "user" | "project";
  projectId: string | null;
  subject: string;
  content: string;
  sourceRefs: string[];
  status: "proposed" | "confirmed" | "superseded" | "deleted";
  revision: number;
  updatedAt: string;
}
export const automationInputSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedRevision: z.number().int().positive().optional(),
    name: z.string().trim().min(1).max(200),
    controllerSessionId: z.string().uuid(),
    promptTemplate: z.string().trim().min(1).max(20000),
    trigger: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("once"), at: z.string().datetime({ offset: true }) }).strict(),
      z.object({ kind: z.literal("cron"), expression: z.string().min(5).max(100) }).strict(),
      z
        .object({
          kind: z.literal("calendar"),
          frequency: z.enum(["once", "daily", "weekdays", "weekly", "monthly"]),
          time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
          date: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
          weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
          dayOfMonth: z.number().int().min(1).max(31).optional(),
        })
        .strict(),
      z
        .object({
          kind: z.literal("interval"),
          every: z.number().int().min(1).max(525600),
          unit: z.enum(["minutes", "hours", "days"]),
          startAt: z.string().datetime({ offset: true }),
        })
        .strict(),
      z.object({ kind: z.literal("webhook") }).strict(),
    ]),
    timeZone: z.string().min(1).max(100),
    misfirePolicy: z.enum(["skip", "coalesce"]).default("coalesce"),
    executorId: z.string().default("local"),
    grantId: z.string().uuid(),
    enabled: z.boolean().default(true),
    checkScript: automationCheckScriptSchema.optional(),
    limits: z
      .object({
        maxRuns: z.number().int().nonnegative().max(100000).optional(),
        maxCostUsd: z.number().nonnegative().optional(),
      })
      .strict()
      .default({}),
  })
  .strict();
export type AutomationInput = z.infer<typeof automationInputSchema>;
export interface Automation extends Omit<AutomationInput, "requestId" | "expectedRevision"> {
  id: string;
  revision: number;
  dispatchGeneration: number;
  effectiveAt: string;
  nextDueAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface Activation {
  id: string;
  automationId: string;
  definitionRevision: number;
  definition: Automation;
  logicalOccurrenceKey: string;
  scheduledFor: string;
  receivedAt: string;
  status:
    "accepted" | "deferred" | "dispatched" | "confirmed" | "unknown" | "cancelled" | "observed";
  goalId: string | null;
  sessionId: string | null;
  commandId: string | null;
  attempt: number;
  lastError: string | null;
  payloadDigest?: string;
}
export interface AuthorizationGrant {
  id: string;
  actor: "user";
  connectionId: string | null;
  applicationId: string | null;
  applicationVersion: string | null;
  controllerSessionId: string;
  projectId: string | null;
  goalId: string | null;
  operations: string[];
  resources: string[];
  expiresAt: string | null;
  revision: number;
  generation: number;
  revoked: boolean;
  createdAt: string;
}
export interface NotificationDelivery {
  id: string;
  notificationId: string;
  deviceId: string;
  channel: string;
  channelRevision: number;
  status: "pending" | "sending" | "accepted" | "failed" | "cancelled" | "suppressed";
  attempts: number;
  dueAt: string;
  expiresAt: string;
  lastError: string | null;
}
