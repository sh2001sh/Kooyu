import {
  CAPABILITIES,
  KodoError,
  type HarnessDescriptor,
  type HarnessId,
  type HarnessModelSupport,
  type HarnessModelOption,
  type ModelSettings,
  type PermissionMode,
  type BindingRuntime,
  type RuntimeEvent,
  type Session,
  type TransportKind,
} from "@kodo/protocol";
import type { NativeLaunch } from "./launch-types.js";
// Untrusted native wire values stay at this translation boundary.
export type Wire = Record<string, any>;
export interface AdapterContext {
  cwd: string | null;
  dataDir: string;
  configuration?: BindingRuntime;
  model?: string;
  reasoning?: string;
  permissionMode?: () => PermissionMode | null;
  env: NodeJS.ProcessEnv;
  launch: NativeLaunch;
  /** Opt-in local diagnostics; never forwarded into transcript or persisted by Host. */
  onStderr?: (text: string) => void;
  /** Opt-in protocol inspection for local verification only. */
  onNativeNotification?: (method: string, params: Wire) => void;
  emit(
    type: RuntimeEvent["type"],
    payload: unknown,
    nativeEventId?: string,
    runId?: string | null,
  ): void;
  interact(id: string, payload: unknown): Promise<unknown>;
  /** Invalidate a native request answered elsewhere or withdrawn by its transport. */
  resolveInteraction?: (id: string, reason?: "resolved" | "withdrawn") => void;
  tools?: import("@earendil-works/pi-coding-agent").ToolDefinition[];
  sdkSessionOwners?: () => Record<string, "kodo" | "pi">;
  assertSendAllowed?: (commandId: string) => void;
  recreateEmptyNativeDraft?: boolean;
}
export interface NativeRuntime {
  nativeSessionId: string;
  capabilities?: Session["nativeCapabilities"];
  send(
    text: string,
    commandId: string,
    mode: "new" | "queue" | "steer",
    settings?: ModelSettings,
  ): Promise<{ nativeRunId: string | null }>;
  models?(): Promise<HarnessModelOption[]>;
  permissionOptions?(): Promise<{
    current: PermissionMode | null;
    options: { value: PermissionMode; label: string; detail?: string }[];
  }>;
  setPermissionMode?(mode: PermissionMode | null): Promise<void>;
  cancel(): Promise<void>;
  read?(): Promise<unknown>;
  list?(): Promise<unknown>;
  quota?(): Promise<unknown>;
  close(): Promise<void>;
}
export interface HarnessAdapter {
  readonly descriptor: HarnessDescriptor;
  connect(session: Session, context: AdapterContext): Promise<NativeRuntime>;
  discoverModels?(context: AdapterContext): Promise<HarnessModelOption[]>;
  standaloneRead?(session: Session, context: AdapterContext): Promise<unknown>;
  standaloneList?(session: Session, context: AdapterContext): Promise<unknown>;
  inspectSessions?(
    sessions: Session[],
    context: AdapterContext,
  ): Promise<Record<string, "present" | "missing" | "unknown">>;
}
export function descriptor(
  id: HarnessId,
  name: string,
  transport: TransportKind,
  supported: string[],
  evidence: string,
  implementation: HarnessDescriptor["implementation"],
  modelSupport: HarnessModelSupport = "binding-or-model",
): HarnessDescriptor {
  return {
    id,
    name,
    transport,
    implementation,
    modelSupport,
    evidence,
    capabilities: Object.fromEntries(
      CAPABILITIES.map((k) => [
        k,
        supported.includes(k) ? "supported" : k === "observeExternal" ? "unsupported" : "unknown",
      ]),
    ) as HarnessDescriptor["capabilities"],
  };
}
export function needCwd(ctx: AdapterContext): string {
  if (!ctx.cwd)
    throw new KodoError("INVALID_INPUT", "该 harness 需要明确的工作位置。请在新建会话时选择目录。");
  return ctx.cwd;
}
export function unsupported(message: string): never {
  throw new KodoError("UNSUPPORTED", message);
}
