import { z } from "zod";
import type {
  ErrorCode,
  Snapshot,
  Session,
  Workspace,
  InboxItem,
  HarnessId,
  PermissionMode,
  HarnessModelOption,
  BindingDefaults,
  HarnessBindingDefaults,
} from "./index.js";
import type { AppSettings } from "./settings.js";
import type { Goal, GoalHistoryEntry, Verification } from "./goals.js";
import type { Artifact, ManagedFile } from "./files.js";
import type { NotificationItem } from "./notifications.js";
import type { Automation, Activation, MemoryEntry } from "./self-hosted.js";

export interface WorkbenchOverview {
  hostId: string;
  projectId: string | null;
  project: Snapshot["projects"][number] | null;
  projects: Snapshot["projects"];
  sessions: Session[];
  workspaces: Workspace[];
  harnesses: Snapshot["harnesses"];
  inbox: InboxItem[];
  goals: Goal[];
  artifacts: GoalDetail["artifacts"];
  plans: Automation[];
  activations: Activation[];
  memories: MemoryEntry[];
  actions: Record<string, ClientOperationAccess>;
  coverage: { artifactsLimit: number; activationLimit: number };
}

/** Explicit local-admin delegation; never includes installation, secrets or device administration. */
export const delegatedOperations = ["goals.check"] as const;
export type DelegatedOperation = (typeof delegatedOperations)[number];
export interface DeviceAccess {
  deviceId: string;
  revision: number;
  operations: DelegatedOperation[];
}
export const deviceAccessSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    operations: z.array(z.enum(delegatedOperations)).max(delegatedOperations.length),
  })
  .strict();
export interface ClientOperationAccess {
  supported: boolean;
  allowed: boolean;
  available: boolean;
  reason: string | null;
  requirement: "paired-device" | "local-administrator" | "explicit-delegation" | "unsupported";
}
export interface ClientCapabilities {
  protocolVersion: number;
  contractVersion: 1;
  hostId: string;
  localAdministrator: boolean;
  accessRevision: number;
  /** Retained for existing clients. Values indicate protocol support, not availability. */
  capabilities: Record<string, number>;
  unsupported: string[];
  operations: Record<string, ClientOperationAccess>;
  limits: { maxUploadBytes: number; maxChunkBytes: number; syncHistoryEntries: number };
}
export interface GoalDetail {
  goal: Goal;
  verifications: Verification[];
  history: GoalHistoryEntry[];
  controller: Session;
  sessions: Session[];
  workspaces: Workspace[];
  artifacts: {
    artifact: Artifact;
    file: ManagedFile | null;
    available: boolean;
    reason: string | null;
  }[];
  inbox: ClientInboxItem[];
  missingSessionIds: string[];
  missingWorkspaceIds: string[];
  missingArtifactIds: string[];
  actions: Record<string, ClientOperationAccess>;
}
export interface NotificationContext {
  notification: NotificationItem;
  hostId: string;
  target: { kind: "inbox" | "goal" | "session"; id: string } | null;
  state: "actionable" | "resolved" | "unavailable";
  session: Session | null;
  inbox: ClientInboxItem | null;
  goal: GoalDetail | null;
}
export const clientMutationSchema = z
  .object({
    requestId: z.string().uuid(),
    method: z.enum(["POST", "PATCH", "DELETE"]),
    path: z.string().min(1).max(300),
    body: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type ClientMutation = z.infer<typeof clientMutationSchema>;
/** Separate from native input command receipts; only management writes use this contract. */
export interface ClientMutationReceipt {
  requestId: string;
  deviceId: string;
  method: ClientMutation["method"];
  path: string;
  status: "pending" | "confirmed" | "failed" | "unknown";
  retryable: false;
  result?: unknown;
  error?: { code: ErrorCode; message: string };
  createdAt: string;
  updatedAt: string;
}
export interface NativeSyncPage {
  hostId: string;
  protocolVersion: number;
  cursor: string;
  baseCursor: string | null;
  resetRequired: boolean;
  snapshot?: Snapshot & { goals: Goal[]; inbox: ClientInboxItem[] };
  /** Array members use stable IDs; projectGrants use controllerSessionId:projectId. */
  collections?: Record<string, { upsert: unknown[]; remove: string[]; order: string[] }>;
  values?: Record<string, unknown>;
}
export interface ClientAction {
  label: string;
  answer: Record<string, unknown>;
  destructive?: boolean;
}
export interface ClientInboxItem extends InboxItem {
  actions: ClientAction[];
}
export interface SessionConfiguration {
  schemaVersion: 1;
  sessionId: string;
  harnessId: HarnessId;
  settingsRevision: number;
  configurationRevision: string;
  binding: {
    id: string | null;
    revision: number | null;
    source: "session-snapshot";
    available: boolean;
  };
  model: {
    selected: string | null;
    observed: string | null;
    effective: string | null;
    source: "session" | "binding" | "runtime" | "native-default" | "unresolved";
    support: string;
    options: HarnessModelOption[];
  };
  permissions: {
    selected: PermissionMode | null;
    current: PermissionMode | null;
    /** Only a live runtime report; null also means unreported. See source. */
    observed: PermissionMode | null;
    source: "runtime" | "host-catalog" | "unresolved";
    options: { value: PermissionMode; label: string; detail?: string }[];
    canChange: boolean;
    reason: string | null;
  };
  newSessionDefaults: {
    host: BindingDefaults;
    project: HarnessBindingDefaults | null;
    harness: AppSettings["harnessDefaults"][HarnessId] | null;
  };
}
export interface ManagedFileAccess {
  fileId: string;
  size: number;
  sha256: string;
  mediaType: string;
  preview: { available: boolean; reason: string | null; contentUrl: string };
  downloadUrl: string;
  etag: string;
  supportsRanges: true;
  maxUploadBytes: number;
}
