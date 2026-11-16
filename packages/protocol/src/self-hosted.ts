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
