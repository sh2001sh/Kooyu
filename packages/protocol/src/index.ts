import { z } from "zod";
export { conversationEvents, conversationMessageIndex } from "./conversation.js";
export type { ConversationMark } from "./conversation.js";
export * from "./providers.js";
export * from "./settings.js";
export * from "./onboarding.js";
export * from "./skills.js";
export * from "./workspace-files.js";
export * from "./goals.js";
export * from "./notifications.js";
export * from "./web.js";
export * from "./files.js";
export * from "./activity.js";
import type { HarnessBinding, ModelParameters } from "./providers.js";

import { HARNESS_IDS } from "./client.js";
export { HARNESS_IDS, NATIVE_HARNESS_IDS, PROTOCOL_VERSION } from "./client.js";
export type HarnessId = (typeof HARNESS_IDS)[number];
export type PermissionMode =
  | "read-only"
  | "workspace-write"
  | "full-access"
  | "accept-edits"
  | "bypass-permissions"
  | "plan"
  | "build"
  | "edit"
  | "yolo"
  | "guarded"
  | "opencode-ask"
  | "opencode-deny"
  | "opencode-allow"
  | "dsh:ask"
  | "dsh:allow"
  | "dsh:deny"
  | "kodo-tools-read"
  | "kodo-tools-none"
  | "kimi:manual"
  | "kimi:auto"
  | "kimi:yolo"
  | `acp:${string}`;
export type TransportKind = "sdk" | "app-server" | "http" | "acp";
export const CAPABILITIES = [
  "directChat",
  "historyRead",
  "resume",
  "observeLive",
  "observeExternal",
  "steer",
  "cancel",
  "interaction",
  "usage",
  "quota",
] as const;
export type Capability = (typeof CAPABILITIES)[number];
export type CapabilitySupport = "supported" | "unsupported" | "unknown";

export type HarnessModelSupport =
  "binding-or-model" | "binding-required" | "native-models" | "native-only";
export interface ModelParameterSource {
  kind:
    | "native-catalog"
    | "native-runtime"
    | "native-config"
    | "user"
    | "endpoint"
    | "remote-catalog"
    | "bundled-catalog";
  label: string;
  reference?: string;
  version?: string;
}
export type ModelParameter =
  "contextWindow" | "maxInputTokens" | "maxOutputTokens" | "reasoning" | "pricing";
/** USD / 1M tokens; perRequest is USD / API request. */
export interface ModelPricing {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number;
  perRequest?: number;
  billingMode?: "tokens" | "request" | "hybrid";
  /** Ordered context brackets, selected using total input including cache tokens. */
  tiers?: (Omit<ModelPricing, "tiers" | "billingMode"> & { upToInputTokens?: number })[];
}
export interface HarnessModelOption {
  id: string;
  name?: string;
  provider?: string;
  /** Exact canonical ID reported by the native harness for an alias, never inferred. */
  resolvedModel?: string;
  source: "discovered" | "native-catalog" | "recent";
  /** Explicitly marked by the native catalog or current session snapshot. */
  isDefault?: boolean;
  isCurrent?: boolean;
  /** Native values, not a universal low/medium/high scale. */
  reasoning?: string[];
  /** Explicit input modalities from this exact configured route. */
  input?: ("text" | "image")[];
  /** Token limits are independent. Absence means unreported, never a product default. */
  contextWindow?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  pricing?: ModelPricing;
  parameterSources?: Partial<Record<ModelParameter, ModelParameterSource>>;
}

export interface ModelSettings {
  model: string | null;
  reasoning: string | null;
  revision: number;
}
export const permissionModeSchema = z.union([
  z.enum([
    "read-only",
    "workspace-write",
    "full-access",
    "accept-edits",
    "bypass-permissions",
    "plan",
    "build",
    "edit",
    "yolo",
    "guarded",
    "opencode-ask",
    "opencode-deny",
    "opencode-allow",
    "dsh:ask",
    "dsh:allow",
    "dsh:deny",
    "kodo-tools-read",
    "kodo-tools-none",
    "kimi:manual",
    "kimi:auto",
    "kimi:yolo",
  ]),
  z.templateLiteral(["acp:", z.string().regex(/^[^\r\n]{1,100}$/)]),
]);
export const modelSettingsSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    model: z.string().trim().min(1).max(200).nullable(),
    reasoning: z.string().trim().min(1).max(100).nullable(),
  })
  .strict();

export interface HarnessDescriptor {
  id: HarnessId;
  name: string;
  transport: TransportKind;
  implementation: "implemented" | "partial" | "pending";
  capabilities: Record<Capability, CapabilitySupport>;
  modelSupport?: HarnessModelSupport;
  /** Values the harness uses when Kodo does not override them, from its own config. */
  nativeDefaults?: { model: string | null; reasoning: string | null; permission: string | null };
  /** Existing native configuration files, resolved on the host. */
  configFiles?: string[];
  configFileLocations?: { path: string; exists: boolean }[];
  models?: HarnessModelOption[];
  defaultModel?: { provider?: string; model: string } | null;
  evidence?: string;
  health?: {
    installed: boolean;
    launchable?: boolean;
    modes?: {
      cliOnly: { launchable: boolean; source: "sdk" | "cli" | null; reason?: string };
      desktopOnly: {
        launchable: boolean;
        source: "sdk" | "desktop-bundled" | null;
        reason?: string;
      };
    };
    source?: "sdk" | "cli" | "desktop-bundled" | "configured" | null;
    desktops?: { name: string; path: string; version: string | null }[];
    executable: string | null;
    version: string | null;
    authentication: "unknown" | "configured";
    error?: string;
  };
}

export type HarnessBindingDefaults = Partial<Record<HarnessId, string | null>>;
export interface BindingDefaults {
  harnessBindingIds: HarnessBindingDefaults;
  revision: number;
}
export interface Project {
  id: string;
  name: string;
  createdAt: string;
  pinned?: boolean;
  bindingDefaults?: HarnessBindingDefaults;
  configRevision?: number;
}
export interface Workspace {
  id: string;
  projectId: string | null;
  hostId: string;
  rootPath: string;
}
export type SessionKind = "direct" | "supervisor";
export interface Session {
  id: string;
  title: string;
  harnessId: HarnessId;
  kind: SessionKind;
  scope: "global" | "project";
  projectId: string | null;
  workspaceId: string | null;
  executorId?: string;
  hostId: string;
  nativeSessionId: string | null;
  phase: "draft" | "native";
  createdAt: string;
  instanceId: string;
  bindingId: string | null;
  bindingRevision: number | null;
  bindingUnavailable?: boolean;
  personalInstructions?: string;
  model?: string | null;
  reasoning?: string | null;
  permissionMode?: PermissionMode | null;
  settingsRevision?: number;
  appliedSettingsRevision?: number;
  /** Capabilities confirmed by this session's transport, refreshed on reconnect. */
  nativeCapabilities?: Partial<Record<Capability, CapabilitySupport>>;
  ownerEpoch: number;
  runState: "idle" | "running" | "waiting-input" | "unknown";
  retry?: { attempt?: number; maxAttempts?: number; delayMs?: number; since: string };
  executionState: "settled" | "unknown";
  connectionState: "connected" | "offline" | "reconnecting";
  archived: boolean;
  pinned: boolean;
  unread?: boolean;
  /** Inline message variants share one sidebar conversation and retain separate native contexts. */
  conversation?: {
    activeId: string;
    branches: {
      id: string;
      rootEventId: string;
      userEventId: string;
      originalBranchId: string;
      prefixEventIds: string[];
    }[];
  };
}

export interface Supervision {
  id: string;
  controllerSessionId: string;
  targetSessionId: string;
  mode: "observe" | "notify" | "continue";
  state: "active" | "paused" | "revoked";
  generation: number;
  cursor: string | null;
  goal?: string;
  /** Exact goal this relation works toward; wakes carry it so results never cross goals. */
  goalId?: string | null;
  runId?: string | null;
  continuous?: boolean;
  trigger?: "turn-ended" | "settled";
  /** Numeric limits use 0 (or omission) for unlimited. */
  limits?: { endAt?: string; maxContinuations?: number; maxFailures?: number; budgetUsd?: number };
  continuations?: number;
  failures?: number;
}

export interface RuntimeEvent {
  conversationBranchId?: string;
  id: string;
  sessionId: string;
  nativeRunId: string | null;
  sequence: number;
  type:
    | "message"
    | "text-delta"
    | "tool"
    | "todo"
    | "subagent"
    | "interaction"
    | "turn-ended"
    | "settled"
    | "disconnected"
    | "state"
    | "usage"
    | "supervision"
    | "handoff"
    | "error";
  payload: unknown;
  createdAt: string;
  source: string;
}

/** Child execution is observable without changing the parent run's state or usage. */
export interface SubagentEvent {
  agentId: string;
  parentAgentId?: string;
  name?: string;
  status?: string;
  toolCallId?: string;
  event?: { type: Exclude<RuntimeEvent["type"], "subagent">; payload: unknown };
}

/** Ephemeral adapter input derived from a pinned Harness binding. */
export interface BindingRuntime {
  id: string;
  revision: number;
  name: string;
  provider: string;
  model: string;
  baseUrl?: string;
  credentialRef: string | null;
  protocol?:
    | "native"
    | "openai-completions"
    | "openai-responses"
    | "anthropic-messages"
    | "google-generative-ai";
  modelParameters?: ModelParameters;
  binding?: HarnessBinding;
}

export const createProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    rootPath: z.string().trim().min(1).max(4096).optional(),
  })
  .strict();
export const createSessionSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    harnessId: z.enum(HARNESS_IDS),
    kind: z.enum(["direct", "supervisor"]),
    projectId: z.string().uuid().nullable().optional(),
    workspaceId: z.string().uuid().nullable().optional(),
    executorId: z.string().max(100).optional(),
    bindingId: z.string().uuid().nullable().optional(),
    model: z.string().trim().min(1).max(200).nullable().optional(),
    reasoning: z.string().trim().min(1).max(100).nullable().optional(),
    permissionMode: permissionModeSchema.nullable().optional(),
  })
  .strict();
export type CreateProject = z.infer<typeof createProjectSchema>;
export type CreateSession = z.infer<typeof createSessionSchema>;

export interface Snapshot {
  protocolVersion: number;
  eventCursor?: number;
  hostId: string;
  stage: "development";
  projects: Project[];
  workspaces: Workspace[];
  sessions: Session[];
  harnesses: HarnessDescriptor[];
  supervisions: Supervision[];
  bindings: HarnessBinding[];
  inbox: InboxItem[];
  devices: { id: string; name: string; createdAt: string; expiresAt?: string }[];
  projectGrants: ProjectGrant[];
  bindingDefaults: BindingDefaults;
}
export interface ProjectGrant {
  controllerSessionId: string;
  projectId: string;
  mode: "create-only" | "create-and-control";
  goal: string;
  limits: Supervision["limits"];
}

export interface Command {
  id: string;
  sessionId: string;
  kind: "open" | "send" | "stop" | "interaction";
  origin: "user" | "supervisor" | "wake" | "automation";
  controllerId: string | null;
  generation: number;
  bindingRevision: number | null;
  status: "accepted" | "dispatched" | "confirmed" | "unknown" | "rejected" | "cancelled";
  nativeRunId: string | null;
  body: Record<string, unknown>;
  createdAt: string;
  error?: string;
}
export interface InboxItem {
  id: string;
  sessionId: string;
  type: string;
  payload: unknown;
  createdAt: string;
  resolved: boolean;
  read?: boolean;
}
export interface Usage {
  id: string;
  sessionId: string;
  projectId: string | null;
  bindingId: string | null;
  source: string;
  scope: "turn" | "session";
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  costUsd: number | null;
  costKind: "actual" | "estimate" | "unknown";
  model: string | null;
  firstTokenMs?: number | null;
  durationMs?: number | null;
  createdAt: string;
}
export const MAX_MESSAGE_ATTACHMENTS = 10;
export const sendSchema = z
  .object({
    requestId: z.string().uuid(),
    text: z.string().max(200000),
    mode: z.enum(["new", "queue", "steer"]).default("queue"),
    /** Managed files uploaded beforehand; resolved per harness capability at dispatch. */
    attachmentIds: z.array(z.string().uuid()).max(MAX_MESSAGE_ATTACHMENTS).optional(),
    /** Replaces a prior user message in the same conversation after an inline edit. */
    replaceEventId: z.string().min(1).max(1000).optional(),
  })
  .strict()
  .refine((v) => v.text.trim().length > 0 || Boolean(v.attachmentIds?.length), {
    message: "消息需要正文或附件。",
  });
export const pendingMessageSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    action: z.enum(["edit", "send-now"]),
    text: z.string().trim().min(1).max(200000).optional(),
  })
  .strict()
  .refine((v) => v.action !== "edit" || v.text !== undefined, {
    message: "修改待发消息需要正文。",
  });
export const watchSchema = z
  .object({
    controllerSessionId: z.string().uuid(),
    targetSessionId: z.string().uuid(),
    mode: z.enum(["observe", "notify", "continue"]),
    goal: z.string().max(10000).default(""),
    goalId: z.string().uuid().nullable().optional(),
    cursor: z.number().int().min(0).default(0),
    runId: z.string().nullable().optional(),
    continuous: z.boolean().default(false),
    trigger: z.enum(["turn-ended", "settled"]).default("turn-ended"),
    limits: z
      .object({
        endAt: z.iso.datetime().optional(),
        maxContinuations: z.number().int().nonnegative().optional(),
        maxFailures: z.number().int().nonnegative().optional(),
        budgetUsd: z.number().nonnegative().optional(),
      })
      .default({}),
  })
  .strict();
export const projectGrantSchema = z
  .object({
    projectId: z.string().uuid(),
    mode: z.enum(["create-only", "create-and-control", "revoke"]).default("create-only"),
    goal: z.string().max(10000).default(""),
    limits: watchSchema.shape.limits,
  })
  .strict();
export const harnessBindingDefaultsSchema = z.partialRecord(
  z.enum(HARNESS_IDS),
  z.string().uuid().nullable(),
);
export const bindingDefaultsSchema = z
  .object({
    expectedRevision: z.number().int().min(0),
    harnessBindingIds: harnessBindingDefaultsSchema,
  })
  .strict();
export const projectDefaultsSchema = z
  .object({
    expectedRevision: z.number().int().min(0),
    bindingDefaults: harnessBindingDefaultsSchema,
  })
  .strict();
export interface NativeImportCandidate {
  harnessId: HarnessId;
  nativeSessionId: string;
  title: string;
  cwd: string | null;
  projectId: string | null;
  workspaceId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  model: string | null;
  messageCount: number | null;
  alreadyImported: boolean;
  existingSessionId: string | null;
}

export interface NativeImportDiscovery {
  candidates: NativeImportCandidate[];
  warnings: Array<{ harnessId: HarnessId; message: string }>;
}

export const nativeImportItemSchema = z
  .object({
    harnessId: z.enum(HARNESS_IDS),
    nativeSessionId: z.string().trim().min(1).max(500),
    title: z.string().trim().max(240).optional(),
    cwd: z.string().trim().max(2000).nullable().optional(),
    projectId: z.string().uuid().nullable().optional(),
    workspaceId: z.string().uuid().nullable().optional(),
    model: z.string().trim().max(200).nullable().optional(),
    createdAt: z.string().max(100).nullable().optional(),
  })
  .strict();

export const nativeImportSchema = z
  .object({
    items: z.array(nativeImportItemSchema).min(1).max(100),
    projectId: z.string().uuid().nullable().optional(),
    workspaceId: z.string().uuid().nullable().optional(),
  })
  .strict();

export interface NativeImportResult {
  imported: Session[];
  skipped: Array<{ harnessId: HarnessId; nativeSessionId: string; reason: string }>;
  errors: Array<{ harnessId: HarnessId; nativeSessionId: string; message: string }>;
}

export interface VoiceProviderOption {
  providerId: string;
  providerName: string;
  endpointId: string;
  protocol: string;
  baseUrl: string;
  hasCredential: boolean;
}

export interface VoiceStatus {
  providerAvailable: boolean;
  providers: VoiceProviderOption[];
  configuredProviderId: string | null;
  activeProviderId: string | null;
  model: string;
  engine: "auto" | "browser" | "provider";
  language: "auto" | "zh-CN" | "en-US" | "ja-JP";
  autoSend: boolean;
}

export interface VoiceTranscriptionResult {
  text: string;
  providerId: string;
  providerName: string;
  model: string;
  durationMs: number;
}

export type AppUpdateAssetPlatform =
  | "windows"
  | "macos-arm64"
  | "macos-x64"
  | "linux-appimage"
  | "linux-deb"
  | "android"
  | "ios"
  | "other";

export interface AppUpdateAsset {
  name: string;
  downloadUrl: string;
  size: number;
  sha256: string | null;
  platform: AppUpdateAssetPlatform;
}

export interface AppUpdateRelease {
  tag: string;
  version: string;
  buildNumber: number | null;
  prerelease: boolean;
  title: string;
  notes: string;
  publishedAt: string | null;
  htmlUrl: string;
  assets: AppUpdateAsset[];
  recommendedAsset: AppUpdateAsset | null;
  androidAsset: AppUpdateAsset | null;
}

export interface AppUpdateDownloadState {
  state: "idle" | "downloading" | "verifying" | "ready" | "installing" | "error";
  tag: string | null;
  assetName: string | null;
  downloadedBytes: number;
  totalBytes: number | null;
  localPath: string | null;
  sha256Verified: boolean;
  error: string | null;
}

export interface AppUpdateStatus {
  currentVersion: string;
  platform: string;
  arch: string;
  channel: "stable" | "preview";
  autoCheck: boolean;
  repository: string;
  state: "idle" | "checking" | "available" | "up-to-date" | "error";
  checkedAt: string | null;
  updateAvailable: boolean;
  latest: AppUpdateRelease | null;
  error: string | null;
  download: AppUpdateDownloadState;
}

export type ErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "CONFLICT"
  | "NOT_IMPLEMENTED"
  | "UNSUPPORTED"
  | "UNAVAILABLE"
  | "UNAUTHORIZED"
  | "INTERNAL_ERROR";
export interface ApiError {
  error: { code: ErrorCode; message: string };
}
export class KodoError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "KodoError";
  }
}

export * from "./self-hosted.js";
export * from "./automation-schedule.js";
export * from "./clients.js";
