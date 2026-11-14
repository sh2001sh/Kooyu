import { z } from "zod";
import { homedir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { nativeStorageEnvironment } from "./harnesses/session-presence.js";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { basename, isAbsolute, join, normalize } from "node:path";
import {
  createProjectSchema,
  createSessionSchema,
  modelSettingsSchema,
  pendingMessageSchema,
  sendSchema,
  watchSchema,
  projectGrantSchema,
  bindingDefaultsSchema,
  projectDefaultsSchema,
  HARNESS_IDS,
  KodoError,
  PROTOCOL_VERSION,
  type BindingDefaults,
  type Project,
  type Session,
  type Snapshot,
  type Workspace,
  type RuntimeEvent,
  type Command,
  type Supervision,
  type InboxItem,
  type HarnessBinding,
  type BindingRuntime,
  type Usage,
  type HarnessId,
  type HarnessModelOption,
  type ProjectGrant,
} from "@kodo/protocol";
import { adapters, getAdapter } from "./harnesses/registry.js";
import type { AdapterContext, HarnessAdapter, NativeRuntime, Wire } from "./harnesses/adapter.js";
import { executable, RpcRejected } from "./harnesses/rpc.js";
import { nativeClaudeExecutable } from "./harnesses/claude-code.js";
import { desktopInstallationGeneration } from "./harnesses/desktop-installations.js";
import {
  getKodoBuiltinCatalog,
  getKodoConfiguredCatalog,
  mergeModelOptions,
  readKodoNativeModels,
} from "./harnesses/models.js";
import {
  acpModelOptions,
  validateReasoning,
  zcodeModelOptions,
} from "./harnesses/model-options.js";
import { validateDraft, validateSupervision } from "./domain/session-rules.js";
import {
  nativeLaunch,
  inspectInstallation,
  resolveInstallationModes,
  instanceEnv,
  collectProviderCredentials,
} from "./configuration/config.js";
import { ProviderService, type ProviderVault } from "./providers/service.js";
import { EngineManager } from "./configuration/engines.js";
import { appSettings } from "./configuration/preferences.js";
import { boundModelOption } from "./providers/model-option.js";
import { DSH_FALLBACK_MODEL, readDshNativeConfig } from "./harnesses/dsh-native.js";
import { nativeConfigLocations, nativeDefaults } from "./harnesses/native-defaults.js";
import { createHarnessTools } from "./kodo/tools.js";
import type { Store } from "./storage/store.js";

type Wake = {
  id: string;
  watchId: string;
  generation: number;
  eventId: string;
  sequence: number;
  controllerId: string;
  targetId: string;
  commandId: string;
};
type LocalDeletion = {
  status: "deleted-locally";
  nativeDeleted: false;
  nativeMissing?: true;
  at: string;
};
type NativeSyncResult = { checked: number; removed: string[]; unknown: number };
export interface SessionProgress {
  sessionId: string;
  title: string;
  harnessId: HarnessId;
  projectId: string | null;
  /** Derived for reporting; "turn-ended" never means the user's goal is complete. */
  status: "draft" | "idle" | "running" | "waiting-input" | "failed" | "turn-ended";
  runState: Session["runState"];
  archived: boolean;
  lastActivityAt: string;
  lastRequest: string | null;
  lastReply: string | null;
  lastOutcome: string | null;
  lastError: string | null;
  openInteractions: number;
  pendingInputs: number;
  controlledBy: string | null;
  cursor: number;
}
export interface ServiceOptions {
  dataDir?: string;
  adapters?: HarnessAdapter[];
  onFatal?: (error: unknown) => void;
  providerVault?: ProviderVault;
  providerFetch?: typeof fetch;
}
export class SessionService {
  readonly notifications = new EventEmitter();
  readonly dataDir: string;
  readonly providers: ProviderService;
  readonly engines: EngineManager;
  private runtimeModels = new Map<string, string>();
  private runtime = new Map<string, NativeRuntime>();
  private opening = new Map<string, Promise<NativeRuntime>>();
  private modelDiscovery = new Map<HarnessId, Promise<HarnessModelOption[]>>();
  private pumping = new Set<string>();
  private interactions = new Map<
    string,
    { resolve: (answer: unknown) => void; sessionId: string }
  >();
  private disposed = false;
  private failed = new Set<string>();
  private connections = new Map<string, number>();
  private textBuffers = new Map<
    string,
    {
      text: string;
      payload: Wire;
      ids: Set<string>;
      runId: string | null;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly deadlineTimer: ReturnType<typeof setInterval>;
  private readonly maintenanceTimer: ReturnType<typeof setInterval>;
  private readonly nativeSyncTimer: ReturnType<typeof setInterval>;
  private nativeSyncJob?: Promise<NativeSyncResult>;
  private nativeSyncOffset = 0;
  private readonly implementations: HarnessAdapter[];
  private installationHealth?: {
    key: string;
    at: number;
    values: Map<HarnessId, Snapshot["harnesses"][number]["health"]>;
  };
  private readonly onFatal?: (error: unknown) => void;
  constructor(
    readonly store: Store,
    options: ServiceOptions = {},
  ) {
    this.dataDir =
      options.dataDir ?? join(process.env.LOCALAPPDATA ?? process.cwd(), "Kodo", "host");
    this.providers = new ProviderService(store, {
      vault: options.providerVault,
      fetcher: options.providerFetch,
    });
    this.engines = new EngineManager(store, this.dataDir);
    this.implementations = options.adapters ?? adapters;
    this.onFatal = options.onFatal;
    mkdirSync(this.dataDir, { recursive: true });
    this.deadlineTimer = setInterval(() => {
      try {
        this.enforceDeadlines();
      } catch (error) {
        this.failClosed(error);
      }
    }, 1000);
    this.deadlineTimer.unref();
    this.maintenanceTimer = setInterval(() => {
      void this.maintenance().catch((error) =>
        console.error(`Maintenance failed: ${this.errorText(error)}`),
      );
    }, 3600000);
    this.maintenanceTimer.unref();
    this.nativeSyncTimer = setInterval(() => {
      void this.syncNativeSessions().catch((error) =>
        console.error("Native history sync failed:", this.errorText(error)),
      );
    }, 60000);
    this.nativeSyncTimer.unref();
    try {
      this.attachOrphanedSessions();
      this.backfillUsageModels();
    } catch (error) {
      console.error(`Session project attachment failed: ${this.errorText(error)}`);
    }
  }
  private adapter(id: HarnessId): HarnessAdapter {
    return this.implementations.find((a) => a.descriptor.id === id) ?? getAdapter(id);
  }
  snapshot(): Snapshot {
    const installationHealth = this.snapshotInstallationHealth();
    return {
      protocolVersion: PROTOCOL_VERSION,
      eventCursor: this.store.latestSequence(),
      hostId: this.store.hostId,
      stage: "development",
      ...(() => {
        const removed = this.removedProjects();
        return {
          projects: this.store.projects().filter((p) => !removed.has(p.id)),
          workspaces: this.store
            .workspaces()
            .filter((w) => !w.projectId || !removed.has(w.projectId)),
          sessions: this.store.sessions().filter((s) => !s.projectId || !removed.has(s.projectId)),
        };
      })(),
      harnesses: this.implementations.map((a) => {
        const configFileLocations = nativeConfigLocations(
          a.descriptor.id,
          process.env,
          join(this.dataDir, "kodo"),
        );
        return {
          ...a.descriptor,
          nativeDefaults: nativeDefaults(a.descriptor.id, process.env, join(this.dataDir, "kodo")),
          configFiles: configFileLocations.filter((file) => file.exists).map((file) => file.path),
          configFileLocations,
          models: this.cachedHarnessModels(a.descriptor.id),
          health: installationHealth.get(a.descriptor.id)!,
        };
      }),
      supervisions: this.store.watches(),
      bindings: this.store.records<HarnessBinding>("harness-binding"),
      inbox: this.store
        .records<InboxItem>("inbox")
        .filter((i) => !this.store.record("deleted-session", i.sessionId)),
      devices: this.store.records("device-public"),
      projectGrants: this.store.records<ProjectGrant>("project-grant"),
      bindingDefaults: this.bindingDefaults(),
    };
  }
  /** Cache machine scans only; session state, models and native configuration stay live. */
  private snapshotInstallationHealth() {
    let signature = "missing";
    try {
      const stat = statSync(join(this.dataDir, "installations.json"));
      signature = [stat.mtimeMs, stat.ctimeMs, stat.size, stat.ino].join(":");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const key = JSON.stringify([
      signature,
      desktopInstallationGeneration(),
      process.cwd(),
      ...[
        "PATH",
        "LOCALAPPDATA",
        "ProgramFiles",
        "ProgramFiles(x86)",
        "ProgramData",
        "USERNAME",
        "HOME",
        "USERPROFILE",
      ].map((name) => process.env[name]),
    ]);
    const now = Date.now();
    if (this.installationHealth?.key === key && now - this.installationHealth.at < 10000)
      return this.installationHealth.values;
    const values = new Map<HarnessId, Snapshot["harnesses"][number]["health"]>();
    for (const { descriptor } of this.implementations) {
      const installation = inspectInstallation(this.dataDir, descriptor.id);
      const launch = installation.launch;
      const path =
        descriptor.id === "claude-code" && launch.command === "claude-sdk"
          ? nativeClaudeExecutable()
          : executable(launch.command);
      const sdk = ["kodo-sdk", "claude-sdk"].includes(launch.command);
      values.set(descriptor.id, {
        installed: installation.ready || installation.desktops.length > 0,
        launchable: installation.ready,
        modes: resolveInstallationModes(descriptor.id, installation.desktops),
        source: launch.source ?? null,
        desktops: installation.desktops,
        executable: path ?? (sdk ? launch.command : null),
        version:
          launch.source === "desktop-bundled" ? (installation.desktops[0]?.version ?? null) : null,
        authentication: "unknown",
        ...(installation.reason ? { error: installation.reason } : {}),
      });
    }
    this.installationHealth = { key, at: Date.now(), values };
    return values;
  }
  createProject(value: unknown): Project {
    const parsed = createProjectSchema.safeParse(value);
    if (!parsed.success)
      throw new KodoError("INVALID_INPUT", "请填写项目名称，以及可选的完整工作目录。");
    const input = parsed.data;
    this.checkDirectory(input.rootPath);
    const project: Project = {
      id: randomUUID(),
      name: input.name,
      createdAt: new Date().toISOString(),
    };
    const workspace: Workspace | undefined = input.rootPath
      ? {
          id: randomUUID(),
          projectId: project.id,
          hostId: this.store.hostId,
          rootPath: normalize(input.rootPath),
        }
      : undefined;
    this.store.addProject(project, workspace);
    return project;
  }
  updateProject(id: string, value: unknown): Project {
    const input = z
      .object({
        name: z.string().trim().min(1).max(200).optional(),
        pinned: z.boolean().optional(),
        archiveSessions: z.literal(true).optional(),
        rootPath: z.string().trim().min(1).max(4096).optional(),
      })
      .strict()
      .refine((data) => Object.keys(data).length > 0, "请选择要修改的项目内容。")
      .parse(value);
    this.checkDirectory(input.rootPath);
    return this.store.transaction(() => {
      if (!this.store.projects().some((project) => project.id === id))
        throw new KodoError("NOT_FOUND", "项目不存在。");
      if (input.name !== undefined)
        this.store.db.prepare("UPDATE projects SET name=? WHERE id=?").run(input.name, id);
      if (input.pinned !== undefined)
        this.store.put("project-sidebar", id, { pinned: input.pinned });
      if (
        input.rootPath &&
        !this.store
          .workspaces()
          .some(
            (workspace) =>
              workspace.projectId === id &&
              normalize(workspace.rootPath) === normalize(input.rootPath!),
          )
      )
        this.addWorkspace(id, input.rootPath);
      if (input.archiveSessions)
        for (const session of this.store.sessions().filter((session) => session.projectId === id))
          this.store.saveSession({ ...session, archived: true });
      return this.store.projects().find((project) => project.id === id)!;
    });
  }
  private checkDirectory(path?: string): void {
    if (path && (!isAbsolute(path) || !existsSync(path) || !statSync(path).isDirectory()))
      throw new KodoError("INVALID_INPUT", "工作目录必须是当前主机存在的绝对目录。");
  }
  private validatePermissionMode(
    harnessId: HarnessId,
    mode: import("@kodo/protocol").PermissionMode | null,
  ): void {
    if (!mode) return;
    if (harnessId === "kimi-code" && ["kimi:manual", "kimi:auto", "kimi:yolo"].includes(mode))
      return;
    if (["gemini", "cursor", "kimi-code", "grok-build"].includes(harnessId)) {
      if (mode.startsWith("acp:")) return;
      throw new KodoError("UNSUPPORTED", "此 ACP 会话只能选择原生声明的运行模式。");
    }
    const supported =
      harnessId === "codex"
        ? ["read-only", "workspace-write", "full-access"]
        : harnessId === "claude-code"
          ? ["accept-edits", "bypass-permissions"]
          : harnessId === "zcode"
            ? ["plan", "build", "edit", "yolo", "guarded"]
            : harnessId === "opencode"
              ? ["opencode-ask", "opencode-deny", "opencode-allow"]
              : harnessId === "pi" || harnessId === "kodo"
                ? ["kodo-tools-read", "kodo-tools-none"]
                : [];
    if (!supported.includes(mode))
      throw new KodoError("UNSUPPORTED", "此 Harness 不支持所选的会话权限模式。");
  }
  addWorkspace(projectId: string | null, rootPath: string): Workspace {
    this.checkDirectory(rootPath);
    if (projectId && !this.store.projects().some((p) => p.id === projectId))
      throw new KodoError("NOT_FOUND", "项目不存在。");
    const w: Workspace = {
      id: randomUUID(),
      projectId,
      hostId: this.store.hostId,
      rootPath: normalize(rootPath),
    };
    this.store.db
      .prepare("INSERT INTO workspaces VALUES (?,?,?,?)")
      .run(w.id, w.projectId, w.hostId, w.rootPath);
    return w;
  }
  /**
   * Project owning a workspace folder. Reuses a project that already has this path,
   * otherwise creates one named after the folder and attaches the workspace to it.
   */
  private projectForWorkspace(workspaceId: string): string | null {
    const workspaces = this.store.workspaces();
    const w = workspaces.find((item) => item.id === workspaceId);
    if (!w) return null;
    const restore = (projectId: string) => {
      if (this.store.record("removed-project", projectId))
        this.store.remove("removed-project", projectId);
      return projectId;
    };
    if (w.projectId) return restore(w.projectId);
    const key = (path: string) =>
      process.platform === "win32" ? normalize(path).toLowerCase() : normalize(path);
    const owner = workspaces.find(
      (item) => item.projectId && item.id !== w.id && key(item.rootPath) === key(w.rootPath),
    )?.projectId;
    if (owner) restore(owner);
    const projectId = owner ?? randomUUID();
    this.store.transaction(() => {
      if (!owner)
        this.store.db
          .prepare("INSERT INTO projects VALUES (?, ?, ?)")
          .run(
            projectId,
            basename(normalize(w.rootPath).replace(/[\\/]+$/, "")) || w.rootPath,
            new Date().toISOString(),
          );
      this.store.db.prepare("UPDATE workspaces SET project_id=? WHERE id=?").run(projectId, w.id);
    });
    return projectId;
  }
  /** Usage recorded before model attribution existed: fill in the session's model. */
  private backfillUsageModels(): void {
    const sessions = new Map(this.store.sessions().map((s) => [s.id, s]));
    this.store.transaction(() => {
      for (const u of this.store.records<Usage>("usage")) {
        if (u.model) continue;
        const s = sessions.get(u.sessionId);
        const model = s
          ? (s.model ??
            this.store.record<{ model: string }>("session-current-model", s.id)?.model ??
            nativeDefaults(s.harnessId, process.env, join(this.dataDir, "kodo")).model)
          : null;
        if (model) this.store.put("usage", u.id, { ...u, model });
      }
    });
  }
  /** Earlier drafts stored the folder without its project; attach them once. */
  private attachOrphanedSessions(): void {
    for (const s of this.store.sessions()) {
      if (s.projectId || !s.workspaceId || s.kind === "supervisor") continue;
      const projectId = this.projectForWorkspace(s.workspaceId);
      if (projectId)
        this.store.transaction(() =>
          this.store.saveSession({ ...this.store.session(s.id), projectId, scope: "project" }),
        );
    }
  }
  createDraft(value: unknown): Session {
    const parsed = createSessionSchema.safeParse(value);
    if (!parsed.success) throw new KodoError("INVALID_INPUT", "会话信息不完整或包含无效选项。");
    const input = parsed.data;
    // Direct conversations follow their folder. Kodo can explicitly stay global
    // while using a folder; null is an intentional scope, not an omitted default.
    if (
      input.workspaceId &&
      (input.projectId === undefined || (input.projectId === null && input.harnessId !== "kodo"))
    )
      input.projectId = this.projectForWorkspace(input.workspaceId) ?? undefined;
    this.validatePermissionMode(input.harnessId, input.permissionMode ?? null);
    if (input.permissionMode?.startsWith("acp:"))
      throw new KodoError("CONFLICT", "请先连接 ACP 会话，再选择原生声明的模式。");
    if (input.projectId && !this.store.projects().some((p) => p.id === input.projectId))
      throw new KodoError("NOT_FOUND", "项目不存在。");
    if (input.harnessId === "kodo" && input.projectId && !input.workspaceId) {
      const workspaces = this.store.workspaces().filter((w) => w.projectId === input.projectId);
      const latest = this.store
        .sessions()
        .filter(
          (s) => s.projectId === input.projectId && workspaces.some((w) => w.id === s.workspaceId),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      input.workspaceId = latest?.workspaceId ?? workspaces[0]?.id ?? null;
    }
    validateDraft(
      input,
      this.store.workspaces().find((w) => w.id === input.workspaceId),
      this.store.hostId,
    );
    const project = this.store.projects().find((p) => p.id === input.projectId),
      defaults = this.bindingDefaults();
    // Omitted means inherit; explicit null means use this harness's native login/config.
    const bindingId =
      input.bindingId !== undefined
        ? input.bindingId
        : project?.bindingDefaults?.[input.harnessId] !== undefined
          ? project.bindingDefaults[input.harnessId]
          : (defaults.harnessBindingIds[input.harnessId] ?? null);
    const binding = bindingId
      ? this.store.record<HarnessBinding>("harness-binding", bindingId)
      : undefined;
    if (binding && binding.harnessId !== input.harnessId)
      throw new KodoError("UNSUPPORTED", "此绑定属于另一个 Harness，请创建对应绑定。");
    if (
      binding &&
      binding.selectionMode !== "provider" &&
      input.model &&
      ![binding.model, `kodo-${binding.providerId}/${binding.model}`].includes(input.model)
    )
      throw new KodoError("UNSUPPORTED", "绑定固定模型身份，切换模型请使用新的绑定会话。");
    if (bindingId && !binding) throw new KodoError("NOT_FOUND", "绑定不存在。");
    if (binding?.selectionMode === "provider") this.providers.bindingModel(binding, input.model);
    // Per-harness new-chat defaults from settings fill whatever the request left open.
    const preset = appSettings(this.store).harnessDefaults?.[input.harnessId];
    if (preset && !binding) {
      if (input.model === undefined && preset.model) input.model = preset.model;
      if (input.reasoning === undefined && preset.reasoning) input.reasoning = preset.reasoning;
    }
    if (input.permissionMode === undefined && preset?.permissionMode) {
      try {
        this.validatePermissionMode(
          input.harnessId,
          preset.permissionMode as import("@kodo/protocol").PermissionMode,
        );
        input.permissionMode = preset.permissionMode as import("@kodo/protocol").PermissionMode;
      } catch {
        // A stale default for a mode the harness no longer offers is ignored.
      }
    }
    const session: Session = {
      id: randomUUID(),
      title: input.title,
      harnessId: input.harnessId,
      kind: input.kind,
      scope: input.projectId ? "project" : "global",
      projectId: input.projectId ?? null,
      workspaceId: input.workspaceId ?? null,
      hostId: this.store.hostId,
      nativeSessionId: null,
      phase: "draft",
      createdAt: new Date().toISOString(),
      instanceId: `${input.harnessId}:${binding ? `${binding.id}:${binding.revision}` : "native"}`,
      bindingId: binding?.id ?? null,
      bindingRevision: binding?.revision ?? null,
      personalInstructions: appSettings(this.store).personalInstructions,
      model: input.model ?? null,
      reasoning: input.reasoning !== undefined ? input.reasoning : (binding?.reasoning ?? null),
      permissionMode: input.permissionMode ?? null,
      settingsRevision: 0,
      ownerEpoch: 0,
      runState: "idle",
      executionState: "unknown",
      connectionState: "offline",
      archived: false,
      pinned: false,
    };
    this.store.transaction(() => this.store.addSession(session));
    return session;
  }
  private binding(s: Session): HarnessBinding | undefined {
    const binding = s.bindingId
      ? this.store.record<HarnessBinding>(
          "harness-binding-revision",
          `${s.bindingId}:${s.bindingRevision}`,
        )
      : undefined;
    return binding ? this.providers.bindingModel(binding, s.model) : undefined;
  }
  async openNative(sessionId: string): Promise<Session> {
    await this.connect(sessionId);
    return this.store.session(sessionId);
  }
  private async connect(id: string): Promise<NativeRuntime> {
    if (this.disposed || this.failed.has(id))
      throw new KodoError("CONFLICT", "会话已隔离，请重启 Host 并核对原生状态。");
    const pending = this.opening.get(id);
    if (pending) return pending;
    const existing = this.runtime.get(id);
    const session = this.store.session(id),
      binding = this.binding(session);
    if (
      existing &&
      binding?.selectionMode === "provider" &&
      session.runState === "idle" &&
      this.runtimeModels.get(id) !== binding.model
    ) {
      this.runtime.delete(id);
      this.connections.set(id, (this.connections.get(id) ?? 0) + 1);
      const task = (async () => {
        await existing.close();
        return this.connectNative(id);
      })();
      this.opening.set(id, task);
      try {
        return await task;
      } finally {
        this.opening.delete(id);
      }
    }
    if (existing) return existing;
    if (this.store.commands(id).some((c) => c.kind === "open" && c.status === "unknown"))
      throw new KodoError("CONFLICT", "此前创建原生会话结果未知，请先核对原生历史，未重复创建。");
    const task = this.connectNative(id);
    this.opening.set(id, task);
    try {
      return await task;
    } finally {
      this.opening.delete(id);
    }
  }
  private async connectNative(id: string): Promise<NativeRuntime> {
    const connection = (this.connections.get(id) ?? 0) + 1;
    this.connections.set(id, connection);
    const session = this.store.session(id),
      frozenBinding = this.binding(session),
      workspace = this.store.workspaces().find((w) => w.id === session.workspaceId),
      priorCommands = this.store.commands(id);
    if (session.bindingUnavailable)
      throw new KodoError("CONFLICT", "旧会话的模型配置未能映射到 Harness 绑定，需创建新会话。");
    if (session.harnessId === "kodo" && session.projectId && !workspace && !session.nativeSessionId)
      throw new KodoError("INVALID_INPUT", "项目主对话尚未选择工作位置，请先为草稿选择项目目录。");
    if (workspace) this.checkDirectory(workspace.rootPath);
    if (frozenBinding && frozenBinding.harnessId !== session.harnessId)
      throw new KodoError("UNSUPPORTED", "Harness 与绑定不匹配。");
    const { configuration: boundConfiguration, apiKey } =
      await this.providers.runtime(frozenBinding);
    let configuration: BindingRuntime | undefined = boundConfiguration;
    if (!configuration && session.harnessId === "deepseek-harness") {
      // Without a binding, use the chosen provider/model route or the user's DSH default.
      const fallback = readDshNativeConfig().defaultModel ?? DSH_FALLBACK_MODEL;
      const route = session.model ?? `${fallback.provider}/${fallback.model}`;
      const slash = route.indexOf("/");
      if (slash <= 0 || slash === route.length - 1)
        throw new KodoError("INVALID_INPUT", "DeepSeek 原生模型需要 provider/model 格式。");
      configuration = {
        id: session.id,
        revision: session.settingsRevision ?? 0,
        name: "原生模型",
        provider: route.slice(0, slash),
        model: route.slice(slash + 1),
        protocol: "native",
        credentialRef: null,
      };
    }
    const launch = nativeLaunch(this.dataDir, session.harnessId),
      env = await instanceEnv(
        session.harnessId,
        configuration,
        this.dataDir,
        apiKey,
        appSettings(this.store).harnessDefaults?.[session.harnessId]?.modelMap,
      );
    if (configuration && ["kodo", "pi"].includes(session.harnessId) && apiKey !== undefined)
      env.KODO_PROVIDER_KEY = apiKey;
    const receipt: Command = {
      id: randomUUID(),
      kind: "open",
      sessionId: id,
      origin: "user",
      controllerId: null,
      generation: session.ownerEpoch,
      bindingRevision: session.bindingRevision,
      status: "dispatched",
      nativeRunId: null,
      body: { resume: session.nativeSessionId },
      createdAt: new Date().toISOString(),
    };
    this.store.saveCommand(receipt);
    try {
      const handle = await this.adapter(session.harnessId).connect(session, {
        cwd: workspace?.rootPath ?? null,
        dataDir: this.dataDir,
        configuration,
        model:
          session.harnessId === "deepseek-harness" && !frozenBinding
            ? configuration?.model
            : (session.model ?? undefined),
        reasoning: session.reasoning ?? undefined,
        permissionMode: () => this.store.session(id).permissionMode ?? null,
        launch,
        env,
        recreateEmptyNativeDraft:
          session.harnessId === "zcode" &&
          Boolean(session.nativeSessionId) &&
          priorCommands.some(
            (c) => c.kind === "open" && c.status === "confirmed" && c.body.resume === null,
          ) &&
          priorCommands.every((c) => c.kind === "open"),
        emit: (type, payload, eventId, runId) => {
          if (this.connections.get(id) === connection)
            this.receive(id, type, payload, eventId, runId);
        },
        interact: (requestId, payload) => {
          if (this.disposed || this.failed.has(id) || this.connections.get(id) !== connection)
            return Promise.reject(new KodoError("CONFLICT", "原生交互连接已失效。"));
          return this.interact(id, requestId, payload);
        },
        resolveInteraction: (requestId, reason) => {
          if (!this.disposed && this.connections.get(id) === connection)
            this.resolveNativeInteraction(id, requestId, reason);
        },
        tools: session.kind === "supervisor" ? createHarnessTools(this, session) : undefined,
        sdkSessionOwners: () =>
          Object.fromEntries(
            this.store
              .sessions()
              .filter((s) => s.nativeSessionId && ["kodo", "pi"].includes(s.harnessId))
              .map((s) => [s.nativeSessionId, s.harnessId]),
          ),
        assertSendAllowed: (commandId) => {
          const command = this.store.command(commandId);
          const fence = this.store.record<{ revision: number }>("send-fence", id)?.revision ?? 0;
          if (
            !command ||
            command.status !== "dispatched" ||
            command.body.sendFence !== fence ||
            (command.origin === "supervisor" &&
              command.generation !== this.store.session(id).ownerEpoch)
          )
            throw new KodoError("CONFLICT", "模型配置期间会话已停止或控制权已改变，消息未发送。");
        },
      });
      if (this.failed.has(id) || this.connections.get(id) !== connection || this.disposed) {
        await handle.close();
        throw new Error("原生握手已失效，需要核对原生会话。");
      }
      // Do not replace concurrent user pauses with the copy captured before handshake.
      this.store.transaction(() => {
        this.store.saveSession({
          ...this.store.session(id),
          nativeSessionId: handle.nativeSessionId,
          nativeCapabilities: handle.capabilities ?? {},
          phase: "native",
          connectionState: "connected",
        });
        this.store.saveCommand({ ...receipt, status: "confirmed" });
        this.store.put("native-inspection-environment", id, {
          nativeSessionId: handle.nativeSessionId,
          env: nativeStorageEnvironment(session.harnessId, {
            ...env,
            ...launch.env,
          }),
        });
        if (session.harnessId === "codex")
          this.store.put("native-inspection-home", id, {
            nativeSessionId: handle.nativeSessionId,
            home: env.CODEX_HOME ?? process.env.CODEX_HOME ?? join(homedir(), ".codex"),
          });
      });
      this.runtime.set(id, handle);
      if (frozenBinding) this.runtimeModels.set(id, frozenBinding.model);
      return handle;
    } catch (error) {
      this.store.saveCommand({
        ...receipt,
        status: error instanceof KodoError || error instanceof RpcRejected ? "rejected" : "unknown",
        error: this.errorText(error),
      });
      throw error;
    }
  }
  private errorText(error: unknown): string {
    return (error instanceof Error ? error.message : "原生连接失败。")
      .replace(/(?:sk-|Bearer\s+)[A-Za-z0-9_\-.]{8,}/g, "[redacted]")
      .slice(0, 2000);
  }
  private sessionCapability(session: Session, capability: import("@kodo/protocol").Capability) {
    return (
      session.nativeCapabilities?.[capability] ??
      this.adapter(session.harnessId).descriptor.capabilities[capability]
    );
  }
  // Native callbacks must never propagate database/consumer failures into SDK loops.
  private receive(
    id: string,
    type: RuntimeEvent["type"],
    payload: unknown,
    eventId?: string,
    runId: string | null = null,
  ): void {
    if (this.disposed || this.failed.has(id)) return;
    try {
      const p = payload as Wire;
      if (type === "text-delta" && typeof p?.text === "string") {
        if (
          eventId &&
          (this.store.hasEvent(id, eventId) || this.textBuffers.get(id)?.ids.has(eventId))
        )
          return;
        const prior = this.textBuffers.get(id);
        if (
          prior &&
          (prior.runId !== runId ||
            prior.payload.channel !== p.channel ||
            prior.payload.itemId !== p.itemId)
        )
          this.flushText(id);
        let buffer = this.textBuffers.get(id);
        if (!buffer) {
          const timer = setTimeout(() => {
            try {
              this.flushText(id);
            } catch (error) {
              this.isolate(id, error);
            }
          }, 100);
          timer.unref();
          buffer = { text: "", payload: p, ids: new Set(), runId, timer };
          this.textBuffers.set(id, buffer);
        }
        buffer.text += p.text;
        if (eventId) buffer.ids.add(eventId);
        if (buffer.text.length >= 8192) this.flushText(id);
      } else {
        this.flushText(id);
        this.ingest(id, type, payload, eventId, runId);
      }
    } catch (error) {
      this.isolate(id, error);
    }
  }
  private flushText(id: string): void {
    const buffer = this.textBuffers.get(id);
    if (!buffer) return;
    clearTimeout(buffer.timer);
    this.textBuffers.delete(id);
    this.store.transaction(() => {
      this.ingest(
        id,
        "text-delta",
        { ...buffer.payload, text: buffer.text },
        undefined,
        buffer.runId,
      );
      for (const eventId of buffer.ids) this.store.rememberEvent(id, eventId);
    });
  }
  private isolate(id: string, error: unknown): void {
    this.failed.add(id);
    const buffer = this.textBuffers.get(id);
    if (buffer) clearTimeout(buffer.timer);
    this.textBuffers.delete(id);
    console.error(`Native ingestion isolated (${id}): ${this.errorText(error)}`);
    try {
      this.store.transaction(() => {
        this.pauseTargetInside(id, "原生事件处理失败，已隔离", true);
        for (const w of this.store
          .watches()
          .filter((w) => w.controllerSessionId === id && w.state === "active"))
          this.changeWatch(w.id, "paused");
        this.store.saveSession({
          ...this.store.session(id),
          runState: "unknown",
          executionState: "unknown",
          connectionState: "offline",
        });
        this.inbox(`ingest:${id}`, id, "error", { message: this.errorText(error), isolated: true });
      });
    } catch (failure) {
      this.failClosed(failure);
    }
    const runtime = this.runtime.get(id);
    this.runtime.delete(id);
    if (runtime) void runtime.close().catch((e) => console.error(this.errorText(e)));
  }
  // Also used by the process-level fatal handler before exiting for recovery.
  failClosed(error: unknown): void {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.deadlineTimer);
    console.error(`Host automation halted: ${this.errorText(error)}`);
    for (const buffer of this.textBuffers.values()) clearTimeout(buffer.timer);
    try {
      this.store.transaction(() => {
        for (const s of this.store.sessions())
          this.pauseTargetInside(s.id, "Host 异常，等待人工核对", true);
      });
    } catch (failure) {
      console.error(`Failed to persist pause: ${this.errorText(failure)}`);
    }
    this.onFatal?.(error);
  }
  private scrub(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((v) => this.scrub(v));
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [
          k,
          /(api.?key|access.?token|refresh.?token|authorization|password|secret|credential)/i.test(
            k,
          )
            ? "[redacted]"
            : this.scrub(v),
        ]),
      );
    if (typeof value === "string")
      return value.replace(/(?:sk-|Bearer\s+)[A-Za-z0-9_\-.]{8,}/g, "[redacted]");
    return value;
  }
  ingest(
    sessionId: string,
    type: RuntimeEvent["type"],
    payload: unknown,
    nativeEventId?: string,
    runId: string | null = null,
  ): RuntimeEvent | undefined {
    if (this.store.record("deleted-session", sessionId)) return;
    let event: RuntimeEvent | undefined;
    this.store.transaction(() => {
      event = this.store.append({
        id: nativeEventId ?? randomUUID(),
        sessionId,
        nativeRunId: runId,
        type,
        payload: this.scrub(payload),
        source: this.store.session(sessionId).harnessId,
        createdAt: new Date().toISOString(),
      });
      if (!event) return;
      const session = this.store.session(sessionId),
        p = (payload ?? {}) as Wire;
      if (type === "disconnected") {
        this.connections.set(sessionId, (this.connections.get(sessionId) ?? 0) + 1);
        this.runtime.delete(sessionId);
        this.pauseTargetInside(sessionId, "原生连接中断，等待核对", true);
        this.pauseControllerInside(sessionId);
        session.ownerEpoch = this.store.session(sessionId).ownerEpoch;
        session.connectionState = "offline";
        session.runState = "unknown";
        session.executionState = "unknown";
        for (const [id, pending] of this.interactions)
          if (pending.sessionId === sessionId) {
            pending.resolve({ cancelled: true });
            this.interactions.delete(id);
            const item = this.store.record<InboxItem>("inbox", id);
            if (item) this.store.put("inbox", id, { ...item, resolved: true, stale: true });
          }
      } else if (type === "turn-ended") {
        session.runState = "idle";
        // ACP prompts cannot retain client operations beyond their terminal response.
        // Other protocols can have independently running child interactions.
        this.cancelProtocolRequests(sessionId, "acp");
      } else if (type === "settled") {
        session.runState = "idle";
        session.executionState = "settled";
      } else if (type === "interaction") session.runState = "waiting-input";
      else if (type === "state" && ["running", "idle"].includes(p.runState))
        session.runState = p.runState;
      if (type === "state" && Array.isArray(p.models?.availableModels)) {
        const discovered: HarnessModelOption[] = p.models.availableModels
          .filter((m: Wire) => typeof m?.modelId === "string" && m.modelId)
          .map((m: Wire) => ({
            id: String(m.modelId),
            ...(typeof m.name === "string" && m.name ? { name: m.name } : {}),
            source: "discovered" as const,
          }));
        if (discovered.length > 0) {
          const prev = this.store.record<{ models: HarnessModelOption[] }>(
            "harness-models",
            session.harnessId,
          )?.models;
          this.store.put("harness-models", session.harnessId, {
            models: mergeModelOptions(discovered, prev ?? []).slice(0, 60),
          });
        }
      }
      if (type === "state" && Array.isArray(p.configOptions)) {
        const models = acpModelOptions(p.configOptions, p.models);
        if (models.length) this.store.put("harness-models", session.harnessId, { models });
      }
      if (type === "state" && session.harnessId === "zcode") {
        const config = p.nativeState?.config;
        if (typeof config?.provider === "string" && typeof config?.model === "string") {
          this.store.put("session-current-model", sessionId, {
            model: `${config.provider}/${config.model}`,
          });
          const current = zcodeModelOptions(config);
          const previous = this.cachedHarnessModels("zcode");
          this.store.put("harness-models", "zcode", {
            models: mergeModelOptions(current, previous).slice(0, 60),
          });
        }
      }
      if (type === "error") {
        session.runState = "unknown";
        this.inbox(`error:${event.id}`, sessionId, "error", event.payload);
      }
      if (type === "usage") this.usage(session, event, p);
      this.store.saveSession(session);
      for (const watch of this.store
        .watches()
        .filter((w) => w.targetSessionId === sessionId && w.state === "active"))
        this.consume(watch, event);
    });
    if (event) {
      const committed = event;
      this.store.afterCommit(() => {
        for (const listener of this.notifications.rawListeners("event")) {
          try {
            listener.call(this.notifications, committed);
          } catch (error) {
            console.error(`Event subscriber failed: ${this.errorText(error)}`);
          }
        }
        this.schedule(sessionId);
        this.drainWakes();
      });
    }
    return event;
  }
  events(id?: string, after = 0): RuntimeEvent[] {
    return this.store.events(id, after);
  }
  /**
   * Compact per-session progress for Kodo reports: last user request, last reply excerpt,
   * last turn outcome and open interactions. Reads only the newest events.
   */
  progress(id: string): SessionProgress {
    const session = this.store.session(id);
    const recent = this.store.recentEvents(id, ["message", "turn-ended", "error"], 30);
    const text = (p: Wire): string => {
      if (typeof p?.text === "string") return p.text;
      if (typeof p?.content === "string") return p.content;
      if (Array.isArray(p?.content))
        return p.content
          .filter((c: Wire) => c?.type === "text" || c?.type === "output_text")
          .map((c: Wire) => c.text)
          .join("\n");
      return p?.message ? text(p.message) : "";
    };
    const clip = (value: string, n: number) =>
      value.length > n ? `${value.slice(0, n).trimEnd()}…` : value;
    const lastUser = recent.find(
      (e) => e.type === "message" && (e.payload as Wire)?.role === "user",
    );
    const lastReply = recent.find(
      (e) =>
        e.type === "message" &&
        (e.payload as Wire)?.role !== "user" &&
        text(e.payload as Wire).trim(),
    );
    const turn = recent.find((e) => e.type === "turn-ended");
    const turnPayload = (turn?.payload ?? {}) as Wire;
    const error = turnPayload.error ?? (recent.find((e) => e.type === "error")?.payload as Wire);
    const openInteractions = this.store
      .records<InboxItem>("inbox")
      .filter((i) => i.sessionId === id && i.type === "interaction" && !i.resolved).length;
    const pendingInputs = this.store
      .commands(id)
      .filter((c) => c.kind === "send" && c.status === "accepted").length;
    const controller = this.store
      .watches()
      .find((w) => w.targetSessionId === id && w.mode === "continue" && w.state === "active");
    const status: SessionProgress["status"] =
      openInteractions > 0
        ? "waiting-input"
        : session.runState === "running"
          ? "running"
          : turnPayload.outcome === "failed"
            ? "failed"
            : turn
              ? "turn-ended"
              : session.phase === "draft"
                ? "draft"
                : "idle";
    return {
      sessionId: id,
      title: session.title,
      harnessId: session.harnessId,
      projectId: session.projectId,
      status,
      runState: session.runState,
      archived: session.archived,
      lastActivityAt: recent[0]?.createdAt ?? session.createdAt,
      lastRequest: lastUser ? clip(text(lastUser.payload as Wire), 200) : null,
      lastReply: lastReply ? clip(text(lastReply.payload as Wire), 400) : null,
      lastOutcome: (turnPayload.outcome as string | undefined) ?? null,
      lastError:
        turnPayload.outcome === "failed" || (!turn && error)
          ? clip(
              String(
                error?.underlyingErrorMessage ??
                  error?.message ??
                  (typeof error === "string" ? error : "") ??
                  "",
              ),
              300,
            ) || null
          : null,
      openInteractions,
      pendingInputs,
      controlledBy: controller?.controllerSessionId ?? null,
      cursor: this.store.latestSequence(id),
    };
  }
  read(id: string, after = 0) {
    return {
      session: this.store.session(id),
      events: this.events(id, after),
      commands: this.store.commands(id),
    };
  }
  readPage(id: string, before?: number, eventId?: string) {
    const session = this.store.session(id);
    if (eventId?.startsWith("native-history:")) {
      const history = this.store.record<{ history: unknown; eventId?: string }>(
        "native-history",
        id,
      );
      const currentId =
        history &&
        (history.eventId ??
          `native-history:${createHash("sha256").update(JSON.stringify(history.history)).digest("hex")}`);
      if (!history || currentId !== eventId)
        throw new KodoError("NOT_FOUND", "原生历史快照已更新或不可用，请重新搜索。");
      return {
        session,
        events: [],
        olderCursor: null,
        commands: this.store.commands(id),
        nativeHistory: history.history,
      };
    }
    return {
      session,
      ...(eventId ? this.store.eventAround(id, eventId) : this.store.eventPage(id, before)),
      commands: this.store.commands(id),
    };
  }
  withdrawCommand(sessionId: string, commandId: string): Command {
    return this.store.transaction(() => {
      this.store.session(sessionId);
      const c = this.store.command(commandId);
      if (!c || c.sessionId !== sessionId || c.kind !== "send" || c.origin !== "user")
        throw new KodoError("NOT_FOUND", "待发消息不存在。");
      if (c.status === "cancelled") return c;
      if (c.status !== "accepted")
        throw new KodoError(
          "CONFLICT",
          "消息已交给原生 harness 或结果未知，不能撤回；请停止当前轮或先对账。",
        );
      const next = { ...c, status: "cancelled" as const, error: "用户撤回待发消息" };
      this.store.saveCommand(next);
      this.ingest(sessionId, "state", { withdrawnCommandId: commandId });
      return next;
    });
  }
  changePendingMessage(sessionId: string, commandId: string, value: unknown): Command {
    const parsed = pendingMessageSchema.safeParse(value);
    if (!parsed.success)
      throw new KodoError("INVALID_INPUT", "待发消息操作无效，请填写正文和有效版本。");
    const input = parsed.data;
    return this.store.transaction(() => {
      const session = this.store.session(sessionId);
      const prior = this.store.record<{
        sessionId: string;
        commandId: string;
        input: unknown;
        result: Command;
      }>("pending-request", input.requestId);
      if (prior) {
        if (
          prior.sessionId !== sessionId ||
          prior.commandId !== commandId ||
          JSON.stringify(prior.input) !== JSON.stringify(input)
        )
          throw new KodoError("CONFLICT", "请求 ID 已用于其他待发消息操作。");
        return prior.result;
      }
      const c = this.store.command(commandId);
      if (!c || c.sessionId !== sessionId || c.kind !== "send" || c.origin !== "user")
        throw new KodoError("NOT_FOUND", "待发消息不存在。");
      if (c.status !== "accepted")
        throw new KodoError(
          "CONFLICT",
          "消息已递送、撤回或结果未知，请重新读取状态；未修改或重复发送。",
        );
      if (Number(c.body.pendingRevision ?? 0) !== input.expectedRevision)
        throw new KodoError("CONFLICT", "待发消息已在另一客户端修改，请重新读取。");
      let mode = c.body.mode;
      if (input.action === "send-now") {
        if (this.store.commands(sessionId).some((c) => c.status === "unknown"))
          throw new KodoError("CONFLICT", "此前递送结果未知，请先对账。");
        if (session.runState === "running") {
          if (this.sessionCapability(session, "steer") !== "supported")
            throw new KodoError(
              "UNSUPPORTED",
              "此 harness 不支持运行中插话；可继续排队或在原生回合结束后发送。",
            );
          mode = "steer";
        } else if (session.runState === "idle") mode = "new";
        else
          throw new KodoError(
            "CONFLICT",
            "会话正在等待原生输入或运行状态未知，请先处理后再立即发送。",
          );
      }
      if (!this.store.record("send-request", c.id))
        this.store.put("send-request", c.id, { body: { text: c.body.text, mode: c.body.mode } });
      this.pauseTargetInside(
        sessionId,
        input.action === "send-now" ? "用户立即发送" : "用户修改待发消息",
      );
      const next = {
        ...c,
        generation: this.store.session(sessionId).ownerEpoch,
        body: {
          ...c.body,
          ...(input.text !== undefined ? { text: input.text } : {}),
          mode,
          pendingRevision: input.expectedRevision + 1,
          ...(input.action === "send-now" ? { sendNow: true } : {}),
        },
      };
      this.store.saveCommand(next);
      this.store.put("pending-request", input.requestId, {
        sessionId,
        commandId,
        input,
        result: next,
      });
      this.ingest(sessionId, "state", {
        pendingCommandId: commandId,
        action: input.action,
        revision: next.body.pendingRevision,
      });
      return next;
    });
  }
  pendingMessageReceipt(sessionId: string, commandId: string, requestId: string): Command {
    this.store.session(sessionId);
    const prior = this.store.record<{ sessionId: string; commandId: string; result: Command }>(
      "pending-request",
      requestId,
    );
    if (!prior || prior.sessionId !== sessionId || prior.commandId !== commandId)
      throw new KodoError("NOT_FOUND", "尚未找到此待发消息操作的回执。");
    return prior.result;
  }
  /** Projects the user removed without deleting their conversations. */
  private removedProjects(): Set<string> {
    return new Set(this.store.records<{ id: string }>("removed-project").map((r) => r.id));
  }
  /**
   * Remove a project from the sidebar. With `sessions: "delete"` its conversations are
   * deleted locally too; otherwise they stay with the project, hidden, and come back when
   * the same folder is opened again. Native harness history and files are never touched.
   */
  async deleteProject(
    id: string,
    sessions: "keep" | "delete" = "keep",
  ): Promise<{ removed: true; sessionsDeleted: number; sessionsKept: number }> {
    if (!this.store.projects().some((p) => p.id === id))
      throw new KodoError("NOT_FOUND", "项目不存在。");
    await this.syncNativeSessions(
      this.store
        .sessions()
        .filter((s) => s.projectId === id)
        .map((s) => s.id),
    );
    const members = this.store.sessions().filter((s) => s.projectId === id);
    for (const s of members) {
      const missing = this.store.record<{
        nativeSessionId: string;
        bindingId: string | null;
        bindingRevision: number | null;
        contextKey: string;
        checkedAt: number;
      }>("native-missing-confirmation", s.id);
      const confirmedMissing =
        missing?.nativeSessionId === s.nativeSessionId &&
        missing.bindingId === s.bindingId &&
        missing.bindingRevision === s.bindingRevision &&
        missing.contextKey === this.nativeInspectionKey(s) &&
        Date.now() - missing.checkedAt < 30000 &&
        !this.nativeInspectionBlocked(s);
      if (
        !confirmedMissing &&
        (s.runState !== "idle" ||
          this.opening.has(s.id) ||
          this.store.commands(s.id).some((c) => ["dispatched", "unknown"].includes(c.status)))
      )
        throw new KodoError("CONFLICT", `会话「${s.title}」正在运行，请先停止再移除项目。`);
    }
    if (sessions === "keep") {
      // Close live connections; the conversations themselves are kept as they are.
      for (const s of members) {
        const runtime = this.runtime.get(s.id);
        this.runtime.delete(s.id);
        await runtime?.close().catch(() => {});
      }
      this.store.put("removed-project", id, { id, at: new Date().toISOString() });
      return { removed: true, sessionsDeleted: 0, sessionsKept: members.length };
    }
    for (const s of members) await this.deleteSession(s.id);
    this.store.transaction(() => {
      // Deleted conversations keep their rows; release them from the project being removed.
      this.store.db
        .prepare("UPDATE sessions SET project_id=NULL, scope='global' WHERE project_id=?")
        .run(id);
      this.store.db.prepare("UPDATE workspaces SET project_id=NULL WHERE project_id=?").run(id);
      this.store.remove("project-binding-defaults", id);
      this.store.remove("removed-project", id);
      for (const grant of this.store.records<{ projectId?: string; controllerSessionId?: string }>(
        "project-grant",
      ))
        if (grant.projectId === id && grant.controllerSessionId)
          this.store.remove("project-grant", `${grant.controllerSessionId}:${id}`);
      this.store.db.prepare("DELETE FROM projects WHERE id=?").run(id);
    });
    return { removed: true, sessionsDeleted: members.length, sessionsKept: 0 };
  }
  async deleteSession(id: string): Promise<LocalDeletion> {
    const previous = this.store.record<LocalDeletion>("deleted-session", id);
    if (previous) return previous;
    const session = this.store.session(id);
    if (
      this.adapter(session.harnessId).inspectSessions &&
      session.nativeSessionId &&
      !this.runtime.has(id) &&
      !this.opening.has(id) &&
      (session.runState !== "idle" ||
        this.store
          .commands(id)
          .some((command) => ["dispatched", "unknown"].includes(command.status)))
    ) {
      await this.syncNativeSessions([id]);
      const reconciled = this.store.record<LocalDeletion>("deleted-session", id);
      if (reconciled) return reconciled;
      const missing = this.store.record<{
        nativeSessionId: string;
        contextKey: string;
        checkedAt: number;
      }>("native-missing-confirmation", id);
      const current = this.store.session(id);
      if (
        current.nativeSessionId === session.nativeSessionId &&
        current.bindingId === session.bindingId &&
        current.bindingRevision === session.bindingRevision &&
        missing?.nativeSessionId === session.nativeSessionId &&
        missing.contextKey === this.nativeInspectionKey(current) &&
        Date.now() - missing.checkedAt < 30000
      )
        return this.deleteLocalSession(id, true);
    }
    return this.deleteLocalSession(id);
  }
  private async deleteLocalSession(id: string, confirmedMissing = false): Promise<LocalDeletion> {
    const previous = this.store.record<LocalDeletion>("deleted-session", id);
    if (previous) return previous;
    this.store.transaction(() => {
      const s = this.store.session(id);
      if (
        (confirmedMissing ? this.nativeInspectionBlocked(s) : s.runState !== "idle") ||
        this.opening.has(id) ||
        (!confirmedMissing &&
          this.store.commands(id).some((c) => ["dispatched", "unknown"].includes(c.status)))
      )
        throw new KodoError("CONFLICT", "请先停止运行并核对未知命令，再删除会话。");
      this.pauseTargetInside(id, "删除本地会话", true);
      for (const w of this.store
        .watches()
        .filter((w) => w.controllerSessionId === id || w.targetSessionId === id))
        this.changeWatch(w.id, "revoked");
      this.ingest(id, "state", { deleted: true });
      this.store.put("deleted-session", id, {
        status: "deleted-locally",
        nativeDeleted: false,
        ...(confirmedMissing ? { nativeMissing: true } : {}),
        at: new Date().toISOString(),
      });
    });
    this.connections.set(id, (this.connections.get(id) ?? 0) + 1);
    const runtime = this.runtime.get(id);
    this.runtime.delete(id);
    await runtime
      ?.close()
      .catch((error) =>
        console.error(`Deleted session connection close: ${this.errorText(error)}`),
      );
    return this.store.record<LocalDeletion>("deleted-session", id)!;
  }
  search(query: string) {
    return {
      sessions: this.store
        .sessions()
        .filter((s) => s.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())),
      hits: this.store.search(query),
    };
  }
  private nativeInspectionKey(session: Session): string {
    const saved = this.store.record<{ nativeSessionId: string; env: Record<string, string> }>(
      "native-inspection-environment",
      session.id,
    );
    const legacy = this.store.record<{ nativeSessionId: string; home: string }>(
      "native-inspection-home",
      session.id,
    );
    return JSON.stringify([
      session.harnessId,
      session.workspaceId,
      this.store.workspaces().find((workspace) => workspace.id === session.workspaceId)?.rootPath,
      session.bindingId,
      session.bindingRevision,
      saved?.nativeSessionId === session.nativeSessionId ? saved.env : null,
      legacy?.nativeSessionId === session.nativeSessionId ? legacy.home : null,
    ]);
  }
  private nativeInspectionBlocked(session: Session): boolean {
    return (
      this.opening.has(session.id) ||
      (this.runtime.has(session.id) &&
        (session.runState !== "idle" ||
          this.store
            .commands(session.id)
            .some((command) => ["dispatched", "unknown"].includes(command.status))))
    );
  }
  syncNativeSessions(sessionIds?: readonly string[]): Promise<NativeSyncResult> {
    if (this.nativeSyncJob)
      return sessionIds
        ? this.nativeSyncJob.then(() => this.syncNativeSessions(sessionIds))
        : this.nativeSyncJob;
    this.nativeSyncJob = this.syncNativeSessionsInside(sessionIds).finally(() => {
      this.nativeSyncJob = undefined;
    });
    return this.nativeSyncJob;
  }
  private async syncNativeSessionsInside(
    sessionIds?: readonly string[],
  ): Promise<NativeSyncResult> {
    const result: NativeSyncResult = { checked: 0, removed: [], unknown: 0 };
    if (this.disposed) return result;
    const eligible = this.store
      .sessions()
      .filter(
        (session) =>
          session.nativeSessionId &&
          (!sessionIds || sessionIds.includes(session.id)) &&
          this.adapter(session.harnessId).inspectSessions &&
          !this.nativeInspectionBlocked(session),
      );
    if (!eligible.length) return result;
    const offset = sessionIds ? 0 : this.nativeSyncOffset % eligible.length;
    const batch = sessionIds
      ? eligible
      : [...eligible.slice(offset), ...eligible.slice(0, offset)].slice(0, 200);
    if (!sessionIds) this.nativeSyncOffset = (offset + batch.length) % eligible.length;
    const groups = new Map<string, Session[]>();
    for (const session of batch) {
      const key = this.nativeInspectionKey(session);
      groups.set(key, [...(groups.get(key) ?? []), session]);
    }
    for (const [contextKey, sessions] of groups) {
      if (this.disposed) break;
      const adapter = this.adapter(sessions[0]!.harnessId);
      let states: Record<string, "present" | "missing" | "unknown">;
      try {
        states = await adapter.inspectSessions!(
          sessions,
          await this.inspectionContext(sessions[0]!),
        );
      } catch {
        for (const session of sessions)
          this.store.remove("native-missing-confirmation", session.id);
        result.unknown += sessions.length;
        continue;
      }
      if (this.disposed) break;
      for (const original of sessions) {
        if (this.store.record("deleted-session", original.id)) continue;
        const session = this.store.session(original.id);
        if (
          this.nativeInspectionBlocked(session) ||
          session.nativeSessionId !== original.nativeSessionId ||
          session.bindingId !== original.bindingId ||
          session.bindingRevision !== original.bindingRevision ||
          this.nativeInspectionKey(session) !== contextKey
        )
          continue;
        result.checked++;
        const state = states[session.nativeSessionId!];
        const previousMissing = this.store.record<{
          nativeSessionId: string;
          contextKey: string;
          firstMissingAt: number;
          checkedAt: number;
        }>("native-missing-confirmation", session.id);
        const firstMissingAt =
          previousMissing?.nativeSessionId === session.nativeSessionId &&
          previousMissing.contextKey === contextKey &&
          Number.isFinite(previousMissing.firstMissingAt)
            ? previousMissing.firstMissingAt
            : Date.now();
        if (state === "missing")
          this.store.put("native-missing-confirmation", session.id, {
            nativeSessionId: session.nativeSessionId,
            bindingId: session.bindingId,
            bindingRevision: session.bindingRevision,
            contextKey,
            firstMissingAt,
            checkedAt: Date.now(),
          });
        else this.store.remove("native-missing-confirmation", session.id);
        if (state === "present") {
          this.store.put("native-storage-seen", session.id, { at: new Date().toISOString() });
          continue;
        }
        // A newly opened blank thread may not have a rollout yet. Require evidence
        // that native history existed, or a send left the local queue, before cleanup.
        const persisted =
          this.store.record("native-storage-seen", session.id) ||
          this.store.record("native-history", session.id) ||
          this.store
            .commands(session.id)
            .some(
              (command) =>
                command.kind === "send" &&
                ["dispatched", "confirmed", "unknown"].includes(command.status),
            );
        if (state !== "missing" || !persisted || Date.now() - firstMissingAt < 5000) {
          result.unknown++;
          continue;
        }
        await this.deleteLocalSession(session.id, true);
        result.removed.push(session.id);
      }
    }
    return result;
  }
  private async inspectionContext(session: Session): Promise<AdapterContext> {
    const workspace = this.store.workspaces().find((item) => item.id === session.workspaceId);
    const env = await instanceEnv(session.harnessId, undefined, this.dataDir);
    if (session.bindingId && session.bindingRevision != null) {
      const home = join(
        this.dataDir,
        "instances",
        session.harnessId,
        session.bindingId,
        String(session.bindingRevision),
      );
      if (session.harnessId === "gemini") env.GEMINI_CLI_HOME = home;
      if (session.harnessId === "kimi-code") env.KIMI_CODE_HOME = home;
      if (session.harnessId === "grok-build") env.GROK_HOME = home;
      if (session.harnessId === "codex") env.CODEX_HOME = home;
      if (session.harnessId === "claude-code") env.CLAUDE_CONFIG_DIR = home;
      if (session.harnessId === "deepseek-harness") env.DSH_HOME = home;
      if (session.harnessId === "zcode") env.ZCODE_DATA_BASE_DIR = home;
      if (session.harnessId === "opencode") env.OPENCODE_CONFIG_DIR = home;
    }
    const nativeHome = this.store.record<{ nativeSessionId: string; home: string }>(
      "native-inspection-home",
      session.id,
    );
    if (session.harnessId === "codex" && nativeHome?.nativeSessionId === session.nativeSessionId)
      env.CODEX_HOME = nativeHome.home;
    const saved = this.store.record<{ nativeSessionId: string; env: Record<string, string> }>(
      "native-inspection-environment",
      session.id,
    );
    const launch = nativeLaunch(this.dataDir, session.harnessId);
    if (saved?.nativeSessionId === session.nativeSessionId) Object.assign(env, saved.env);
    return {
      cwd: workspace?.rootPath ?? null,
      dataDir: this.dataDir,
      env,
      launch:
        saved?.nativeSessionId === session.nativeSessionId
          ? { ...launch, env: { ...launch.env, ...saved.env } }
          : launch,
      emit: () => {},
      interact: async () => ({}),
      sdkSessionOwners: () =>
        Object.fromEntries(
          this.store
            .sessions()
            .filter((item) => item.nativeSessionId && ["kodo", "pi"].includes(item.harnessId))
            .map((item) => [item.nativeSessionId, item.harnessId]),
        ),
    };
  }
  async nativeRead(id: string) {
    const session = this.store.session(id);
    if (!session.nativeSessionId) return { nativeSessionId: null, messages: [] };
    const adapter = this.adapter(session.harnessId);
    let raw: unknown;
    const live = this.runtime.get(id);
    if (
      !live?.read &&
      !adapter.standaloneRead &&
      adapter.descriptor.capabilities.historyRead === "unsupported"
    )
      throw new KodoError("UNSUPPORTED", "该适配器不提供原生历史读取；未启动原生会话。");
    if (live?.read) raw = await live.read();
    else if (session.nativeSessionId && adapter.standaloneRead)
      raw = await adapter.standaloneRead(session, await this.inspectionContext(session));
    else {
      const runtime = await this.connect(id);
      if (!runtime.read) throw new KodoError("UNSUPPORTED", "该适配器不提供原生历史读取。");
      raw = await runtime.read();
    }
    const history = this.scrub(raw);
    const hash = createHash("sha256").update(JSON.stringify(history)).digest("hex");
    // Historical imports are searchable evidence; they never become completion
    // events or usage deltas and cannot wake a controller.
    this.store.db
      .prepare("DELETE FROM search_index WHERE session_id=? AND event_id LIKE 'native-history:%'")
      .run(id);
    this.store.db
      .prepare(
        "INSERT INTO search_index(session_id,event_id,text) SELECT ?,?,? WHERE NOT EXISTS (SELECT 1 FROM search_index WHERE session_id=? AND event_id=?)",
      )
      .run(id, `native-history:${hash}`, JSON.stringify(history), id, `native-history:${hash}`);
    this.store.put("native-history", id, {
      sessionId: id,
      eventId: `native-history:${hash}`,
      history,
      readAt: new Date().toISOString(),
    });
    return history;
  }
  async nativeList(id: string) {
    const session = this.store.session(id);
    const adapter = this.adapter(session.harnessId);
    if (adapter.standaloneList)
      return this.scrub(
        await adapter.standaloneList(session, await this.inspectionContext(session)),
      );
    if (!session.nativeSessionId && !this.runtime.has(id))
      throw new KodoError(
        "UNSUPPORTED",
        "该适配器尚不提供独立历史列表；不会为了查看历史创建原生会话。",
      );
    const runtime = await this.connect(id);
    if (!runtime.list) throw new KodoError("UNSUPPORTED", "该适配器不提供原生历史列表。");
    return this.scrub(await runtime.list());
  }
  async quota(id: string) {
    const live = this.runtime.get(id);
    if (live?.quota) return this.scrub(await live.quota());
    if (this.sessionCapability(this.store.session(id), "quota") !== "supported")
      return { status: "unknown", reason: "无已验证的官方额度接口；未启动原生会话。" };
    if (!this.store.session(id).nativeSessionId && !this.runtime.has(id))
      return { status: "unknown", reason: "草稿尚无原生会话；额度查询不会创建会话。" };
    const runtime = await this.connect(id);
    return runtime.quota
      ? this.scrub(await runtime.quota())
      : { status: "unknown", reason: "无已验证的官方额度接口。" };
  }
  reconcile(
    id: string,
    input: {
      commandId: string;
      resolution: "confirmed" | "rejected";
      note: string;
      nativeSessionId?: string;
      idleConfirmed: boolean;
    },
  ) {
    const s = this.store.session(id),
      c = this.store.command(input.commandId);
    if (!c || c.sessionId !== id || c.status !== "unknown")
      throw new KodoError("CONFLICT", "只允许对账本会话中结果未知的命令。");
    if (!input.note.trim())
      throw new KodoError("INVALID_INPUT", "请记录原生历史或状态的核对依据。");
    if (c.kind === "open" && input.resolution === "confirmed" && !input.nativeSessionId)
      throw new KodoError("INVALID_INPUT", "创建结果对账需要准确的原生会话 ID。");
    this.store.transaction(() => {
      this.pauseTargetInside(id, "人工对账", false);
      this.store.saveCommand({ ...c, status: input.resolution, error: undefined });
      const current = this.store.session(id);
      this.store.saveSession({
        ...current,
        ...(input.nativeSessionId
          ? { nativeSessionId: input.nativeSessionId, phase: "native" as const }
          : {}),
        runState: input.idleConfirmed ? "idle" : "unknown",
      });
      this.store.put("reconciliation", c.id, {
        commandId: c.id,
        note: input.note,
        at: new Date().toISOString(),
        resolution: input.resolution,
        nativeSessionId: input.nativeSessionId ?? s.nativeSessionId,
      });
      if (c.body.wake)
        this.store.db
          .prepare("UPDATE wakes SET state=? WHERE id=?")
          .run(input.resolution, (c.body.wake as Wire).id);
    });
    this.ingest(id, "state", { reconciledCommandId: c.id, resolution: input.resolution });
    this.schedule(id);
    return this.store.command(c.id);
  }
  attachNative(id: string, nativeSessionId: string, externalStopped: boolean): Session {
    const s = this.store.session(id);
    if (
      s.nativeSessionId ||
      s.phase !== "draft" ||
      this.store.commands(id).some((c) => c.status !== "rejected" && c.status !== "cancelled")
    )
      throw new KodoError("CONFLICT", "只能把原生身份绑定到未执行的草稿。");
    if (!externalStopped)
      throw new KodoError("CONFLICT", "请先在原应用结束外部执行，再恢复；当前不提供外部运行接管。");
    if (this.adapter(s.harnessId).descriptor.capabilities.resume === "unsupported")
      throw new KodoError("UNSUPPORTED", "该 harness 不支持恢复。");
    const bound = { ...s, nativeSessionId, phase: "native" as const };
    this.store.transaction(() => this.store.saveSession(bound));
    return bound;
  }
  acceptSend(sessionId: string, value: unknown, controllerId: string | null = null): Command {
    const input = sendSchema.parse(value),
      body = { text: input.text, mode: input.mode },
      previous = this.store.command(input.requestId);
    if (previous) {
      if (
        previous.sessionId !== sessionId ||
        previous.kind !== "send" ||
        previous.controllerId !== controllerId ||
        JSON.stringify(
          this.store.record<{ body: unknown }>("send-request", previous.id)?.body ?? {
            text: previous.body.text,
            mode: previous.body.mode,
          },
        ) !== JSON.stringify(body)
      )
        throw new KodoError("CONFLICT", "请求 ID 已用于不同内容。");
      return previous;
    }
    if (this.disposed || this.failed.has(sessionId))
      throw new KodoError("CONFLICT", "会话已隔离或 Host 已停止，请重启并对账。");
    const command = this.store.transaction(() => {
      const s = this.store.session(sessionId);
      if (controllerId) this.requireControl(controllerId, s);
      else this.pauseTargetInside(s.id, "用户接管");
      const fresh = this.store.session(sessionId);
      if (input.mode === "steer" && this.sessionCapability(fresh, "steer") !== "supported")
        throw new KodoError("UNSUPPORTED", "该 harness 不支持当前轮直接引导，请使用排队发送。");
      if (input.mode === "steer" && fresh.runState !== "running")
        throw new KodoError("CONFLICT", "只有正在运行的回合可以直接引导。");
      if (input.mode === "new" && fresh.runState !== "idle")
        throw new KodoError("CONFLICT", "当前会话非空闲，请排队或使用已支持的 steer。");
      const c: Command = {
        id: input.requestId,
        sessionId,
        kind: "send",
        origin: controllerId ? "supervisor" : "user",
        controllerId,
        generation: fresh.ownerEpoch,
        bindingRevision: fresh.bindingRevision,
        status: "accepted",
        nativeRunId: null,
        body,
        createdAt: new Date().toISOString(),
      };
      this.store.saveCommand(c);
      this.store.put("send-request", c.id, { body });
      return c;
    });
    this.ingest(sessionId, "state", { acceptedCommandId: command.id });
    this.schedule(sessionId);
    return command;
  }
  private schedule(id: string): void {
    if (this.disposed || this.failed.has(id) || this.store.record("deleted-session", id)) return;
    queueMicrotask(() => {
      void this.pump(id).catch((e) => {
        if (!this.disposed) this.isolate(id, e);
      });
    });
  }
  private async pump(id: string): Promise<void> {
    if (
      this.pumping.has(id) ||
      this.disposed ||
      this.failed.has(id) ||
      this.store.record("deleted-session", id)
    )
      return;
    this.pumping.add(id);
    try {
      while (!this.disposed && !this.failed.has(id)) {
        const s = this.store.session(id);
        const commands = this.store.commands(id);
        if (commands.some((c) => c.status === "unknown")) return;
        const accepted = commands.filter((c) => c.kind === "send" && c.status === "accepted");
        let c =
          s.runState === "running"
            ? accepted.find((c) => c.body.mode === "steer")
            : (accepted.find((c) => c.body.sendNow) ?? accepted[0]);
        if (!c) return;
        if (c.body.mode === "steer" && s.runState !== "running") {
          if (c.body.sendNow && s.runState === "idle") {
            this.store.saveCommand({ ...c, body: { ...c.body, mode: "new" } });
            continue;
          }
          this.store.saveCommand({
            ...c,
            status: "rejected",
            error: "原生回合已结束，直接引导未发送。",
          });
          continue;
        }
        if (s.runState !== "idle" && c.body.mode !== "steer") return;
        if (
          c.body.mode !== "steer" &&
          commands.some((c) => c.kind === "send" && c.status === "dispatched")
        )
          return;
        if (c.generation !== s.ownerEpoch) {
          this.store.saveCommand({ ...c, status: "cancelled" });
          continue;
        }
        if (c.controllerId) {
          try {
            this.requireControl(c.controllerId, s, c.id);
          } catch {
            this.store.saveCommand({ ...c, status: "cancelled" });
            continue;
          }
        }
        let runtime: NativeRuntime;
        // Starting a native process can take seconds; show the user's message and the
        // running state now. The event id matches the one ingested at dispatch.
        if (c.body.mode === "new" && !this.runtime.has(id) && !c.controllerId) {
          this.store.transaction(() => {
            this.store.saveSession({
              ...this.store.session(id),
              runState: "running",
            });
          });
          this.ingest(
            id,
            "message",
            {
              role: "user",
              text: c.body.text,
              origin: c.origin,
              controllerId: c.controllerId,
              commandId: c.id,
            },
            `command:${c.id}`,
          );
        }
        const activeCommand = c;
        try {
          runtime = await this.connect(id);
        } catch (e) {
          this.store.transaction(() => {
            this.store.saveCommand({
              ...activeCommand,
              status: "rejected",
              error: this.errorText(e),
            });
            this.store.saveSession({ ...this.store.session(id), runState: "idle" });
          });
          this.ingest(id, "error", { message: this.errorText(e) });
          return;
        }
        // Re-check after asynchronous connect; a stop may have invalidated this command.
        if (
          this.store.command(c.id)?.status !== "accepted" ||
          this.store.session(id).ownerEpoch !== this.store.command(c.id)?.generation
        )
          continue;
        // Pending edits and promotion may have committed while connect was awaiting native IO.
        c = this.store.command(c.id)!;
        if (this.store.session(id).runState === "idle") {
          const priority = this.store
            .commands(id)
            .find(
              (item) => item.kind === "send" && item.status === "accepted" && item.body.sendNow,
            );
          if (priority && priority.id !== c.id) continue;
        }
        if (c.body.mode === "steer" && this.store.session(id).runState !== "running") {
          if (c.body.sendNow && this.store.session(id).runState === "idle") {
            this.store.saveCommand({ ...c, body: { ...c.body, mode: "new" } });
            continue;
          }
          this.store.saveCommand({
            ...c,
            status: "rejected",
            error: "原生回合已结束，立即引导未发送。",
          });
          continue;
        }
        if (c.body.wake) {
          const w = this.store.watches().find((w) => w.id === (c.body.wake as Wire).watchId);
          if (!w || w.state !== "active" || w.generation !== (c.body.wake as Wire).generation) {
            this.store.saveCommand({ ...c, status: "cancelled" });
            continue;
          }
          const reason = this.limitReason(w);
          if (reason) {
            this.changeWatch(w.id, "paused");
            this.inbox(`limit:${c.id}`, w.targetSessionId, "limit", { reason });
            continue;
          }
        }
        const current = this.store.session(id);
        const settings = {
          model: current.model ?? this.binding(current)?.model ?? null,
          reasoning: current.reasoning ?? null,
          revision: current.settingsRevision ?? 0,
        };
        // Freeze the settings at dispatch. Steer always stays on the active turn's settings.
        c.body = {
          ...c.body,
          sendFence: this.store.record<{ revision: number }>("send-fence", id)?.revision ?? 0,
          ...(c.body.mode !== "steer" ? { settings } : {}),
        };
        this.store.transaction(() => {
          this.store.saveCommand({ ...c, status: "dispatched" });
          this.store.saveSession({
            ...this.store.session(id),
            runState: "running",
            executionState: "unknown",
          });
        });
        this.ingest(
          id,
          "message",
          {
            role: "user",
            text: c.body.text,
            origin: c.origin,
            controllerId: c.controllerId,
            commandId: c.id,
          },
          `command:${c.id}`,
        );
        // A native steer must not wait behind an SDK prompt that spans a whole turn.
        void this.deliver(id, c, runtime)
          .finally(() => this.schedule(id))
          .catch((error) => {
            if (!this.disposed) this.isolate(id, error);
          });
        return;
      }
    } finally {
      this.pumping.delete(id);
    }
  }
  private async deliver(id: string, c: Command, runtime: NativeRuntime): Promise<void> {
    try {
      const instructions = this.store.session(id).personalInstructions;
      const firstMessage =
        instructions &&
        c.body.mode !== "steer" &&
        !this.store
          .commands(id)
          .some(
            (command) =>
              command.id !== c.id &&
              command.kind === "send" &&
              ["dispatched", "confirmed", "unknown"].includes(command.status),
          );
      const result = await runtime.send(
        firstMessage
          ? `用户个人指令：\n${instructions}\n\n本条消息：\n${String(c.body.text)}`
          : String(c.body.text),
        c.id,
        c.body.mode as "new" | "queue" | "steer",
        c.body.settings as import("@kodo/protocol").ModelSettings | undefined,
      );
      this.store.transaction(() => {
        this.store.saveCommand({ ...c, status: "confirmed", nativeRunId: result.nativeRunId });
        if (c.body.settings)
          this.store.saveSession({
            ...this.store.session(id),
            appliedSettingsRevision: (c.body.settings as import("@kodo/protocol").ModelSettings)
              .revision,
          });
        if (c.controllerId) {
          const w = this.store
            .watches()
            .find(
              (w) =>
                w.controllerSessionId === c.controllerId &&
                w.targetSessionId === id &&
                w.state === "active",
            );
          if (w) {
            w.continuations = (w.continuations ?? 0) + 1;
            this.store.saveWatch(w);
          }
        }
        if (c.body.wake)
          this.store.db
            .prepare("UPDATE wakes SET state='confirmed' WHERE id=?")
            .run((c.body.wake as Wire).id);
      });
    } catch (e) {
      const rejected = e instanceof RpcRejected || e instanceof KodoError;
      this.store.saveCommand({
        ...c,
        status: rejected ? "rejected" : "unknown",
        error: this.errorText(e),
      });
      if (rejected && c.body.mode !== "steer" && this.store.session(id).ownerEpoch === c.generation)
        this.store.saveSession({ ...this.store.session(id), runState: "idle" });
      if (rejected)
        this.inbox(`rejected:${c.id}`, id, "error", {
          message: this.errorText(e),
          commandId: c.id,
        });
      this.ingest(id, "error", {
        message: this.errorText(e),
        commandId: c.id,
        result: rejected ? "rejected" : "unknown",
      });
      return;
    }
  }
  private inbox(id: string, sessionId: string, type: string, payload: unknown): void {
    if (!this.store.record("inbox", id))
      this.store.put("inbox", id, {
        id,
        sessionId,
        type,
        payload,
        createdAt: new Date().toISOString(),
        resolved: false,
      } satisfies InboxItem);
  }
  async confirmManagement(sessionId: string, requestId: string, params: unknown): Promise<boolean> {
    const session = this.store.session(sessionId);
    if (session.kind !== "supervisor" || session.harnessId !== "kodo")
      throw new KodoError("UNAUTHORIZED", "只有 Kooyu 主对话可以请求管理操作。");
    const prior = this.store.record<{ answer: { decision?: string } }>(
      "interaction-answer",
      `${sessionId}:${requestId}`,
    );
    const answer =
      prior?.answer ??
      (await this.interact(sessionId, requestId, {
        protocol: "kodo",
        method: "approval/request",
        params,
      }));
    return (
      !!answer && typeof answer === "object" && "decision" in answer && answer.decision === "accept"
    );
  }
  private cancelProtocolRequests(sessionId: string, protocol: "kodo" | "acp"): void {
    for (const [id, pending] of this.interactions) {
      const item = this.store.record<InboxItem>("inbox", id);
      if (
        pending.sessionId !== sessionId ||
        (item?.payload as Wire | undefined)?.protocol !== protocol
      )
        continue;
      pending.resolve({ cancelled: true });
      this.interactions.delete(id);
      if (item) this.store.put("inbox", id, { ...item, resolved: true, stale: true });
    }
  }
  private resolveNativeInteraction(
    sessionId: string,
    requestId: string,
    reason: "resolved" | "withdrawn" = "resolved",
  ): void {
    const id = sessionId + ":" + requestId;
    const pending = this.interactions.get(id);
    if (!pending) return;
    const item = this.store.record<InboxItem>("inbox", id);
    if (item) this.store.put("inbox", id, { ...item, resolved: true, stale: true });
    this.interactions.delete(id);
    pending.resolve({ cancelled: true });
    const resume =
      reason === "resolved" &&
      this.store.session(sessionId).runState === "waiting-input" &&
      ![...this.interactions.values()].some((item) => item.sessionId === sessionId);
    this.receive(sessionId, "state", {
      interactionResolved: id,
      ...(resume ? { runState: "running" } : {}),
    });
  }
  private interact(sessionId: string, requestId: string, payload: unknown): Promise<unknown> {
    const id = `${sessionId}:${requestId}`;
    this.store.put("interaction-state", id, { sessionId, requestId });
    this.ingest(
      sessionId,
      "interaction",
      { requestId: id, nativeRequestId: requestId, ...(payload as object) },
      `interaction:${requestId}`,
    );
    this.inbox(id, sessionId, "interaction", this.scrub(payload));
    return new Promise((resolve) => this.interactions.set(id, { resolve, sessionId }));
  }
  answerInteraction(id: string, answer: unknown, requestId: string): { status: string } {
    const prior = this.store.record<{ requestId: string; answer: unknown }>(
      "interaction-answer",
      id,
    );
    if (prior) {
      if (JSON.stringify(prior.answer) === JSON.stringify(answer))
        return { status: "already-processed" };
      throw new KodoError("CONFLICT", "该原生请求已由另一客户端处理。");
    }
    const pending = this.interactions.get(id);
    if (!pending) throw new KodoError("CONFLICT", "原生请求已失效或连接已重启，请先重新读取会话。");
    this.store.transaction(() => {
      this.store.put("interaction-answer", id, { requestId, answer });
      const item = this.store.record<InboxItem>("inbox", id);
      if (item) this.store.put("inbox", id, { ...item, resolved: true });
    });
    pending.resolve(answer);
    this.interactions.delete(id);
    this.ingest(pending.sessionId, "state", { interactionResolved: id, runState: "running" });
    return { status: "processed" };
  }
  private pauseTargetInside(id: string, reason: string, cancelUser = false): void {
    const session = this.store.session(id);
    session.ownerEpoch++;
    this.store.saveSession(session);
    if (cancelUser)
      this.store.put("send-fence", id, {
        revision: (this.store.record<{ revision: number }>("send-fence", id)?.revision ?? 0) + 1,
      });
    for (const w of this.store
      .watches()
      .filter((w) => w.targetSessionId === id && w.mode === "continue" && w.state === "active")) {
      w.state = "paused";
      w.generation++;
      this.store.saveWatch(w);
      this.store.db
        .prepare("UPDATE wakes SET state='cancelled' WHERE watch_id=? AND state='pending'")
        .run(w.id);
    }
    for (const c of this.store.commands())
      if (c.status === "accepted") {
        if (c.sessionId === id) {
          if (c.origin === "user" && !cancelUser)
            this.store.saveCommand({ ...c, generation: session.ownerEpoch });
          else this.store.saveCommand({ ...c, status: "cancelled", error: reason });
        } else if ((c.body.wake as Wire | undefined)?.targetId === id) {
          this.store.saveCommand({ ...c, status: "cancelled", error: reason });
          this.store.db
            .prepare("UPDATE wakes SET state='cancelled' WHERE id=?")
            .run((c.body.wake as Wire).id);
        }
      }
    this.store.put("pause", id, { reason, at: new Date().toISOString() });
  }
  private pauseControllerInside(id: string): void {
    this.store.afterCommit(() => this.cancelProtocolRequests(id, "kodo"));
    for (const watch of this.store
      .watches()
      .filter((w) => w.controllerSessionId === id && w.mode === "continue" && w.state === "active"))
      this.changeWatch(watch.id, "paused");
  }
  async stop(
    id: string,
    pause = true,
    requestId: string = randomUUID(),
    controllerId: string | null = null,
  ): Promise<{ status: string; cancel: string }> {
    const previous = this.store.command(requestId);
    if (previous) {
      if (
        previous.sessionId !== id ||
        previous.kind !== "stop" ||
        previous.body.pause !== pause ||
        previous.controllerId !== controllerId
      )
        throw new KodoError("CONFLICT", "请求 ID 已用于不同停止操作。");
      return (
        this.store.record("stop-receipt", requestId) ?? {
          status: pause ? "paused" : "unchanged",
          cancel: "unconfirmed: previous stop result requires reconciliation; not resent",
        }
      );
    }
    const command = this.store.transaction(() => {
      this.store.session(id);
      if (pause) {
        this.pauseTargetInside(id, "停止并暂停托管", true);
        this.pauseControllerInside(id);
      }
      const s = this.store.session(id),
        c: Command = {
          id: requestId,
          sessionId: id,
          kind: "stop",
          origin: controllerId ? "supervisor" : "user",
          controllerId,
          generation: s.ownerEpoch,
          bindingRevision: s.bindingRevision,
          status: "dispatched",
          nativeRunId: null,
          body: { pause },
          createdAt: new Date().toISOString(),
        };
      this.store.saveCommand(c);
      return c;
    });
    const finish = (cancel: string, status: Command["status"]) => {
      const receipt = { status: pause ? "paused" : "unchanged", cancel };
      this.store.transaction(() => {
        this.store.saveCommand({ ...command, status, body: { ...command.body, receipt } });
        this.store.put("stop-receipt", requestId, receipt);
      });
      return receipt;
    };
    this.ingest(id, "supervision", { action: pause ? "stop-and-pause" : "cancel-turn" });
    const runtime = this.runtime.get(id);
    if (!runtime) return finish("unconfirmed: native connection offline", "unknown");
    try {
      await runtime.cancel();
      return finish("requested; await native event", "confirmed");
    } catch (e) {
      return finish(
        this.errorText(e),
        e instanceof RpcRejected || e instanceof KodoError ? "rejected" : "unknown",
      );
    }
  }
  watch(value: unknown, actor: "user" | "model" = "user"): Supervision {
    const input = watchSchema.parse(value),
      controller = this.store.session(input.controllerSessionId),
      target = this.store.session(input.targetSessionId);
    if (this.disposed || this.failed.has(controller.id) || this.failed.has(target.id))
      throw new KodoError("CONFLICT", "会话已隔离，不能启用托管。");
    const existing = this.store
      .watches()
      .find((w) => w.controllerSessionId === controller.id && w.targetSessionId === target.id);
    validateSupervision(controller, target, input.mode, this.store.watches());
    if (
      input.mode === "continue" &&
      this.adapter(target.harnessId).descriptor.implementation !== "implemented"
    )
      throw new KodoError("UNSUPPORTED", "该适配器协议尚不完整，暂不开放自动继续。");
    if (actor === "model") {
      this.requireGrant(controller, target);
      if (
        input.mode === "continue" &&
        (!existing || existing.state !== "active" || existing.mode !== "continue")
      )
        throw new KodoError("UNAUTHORIZED", "自动继续需要用户显式启用，模型不能恢复已暂停的托管。");
      if (existing?.mode === "continue") {
        if (input.mode !== "continue")
          throw new KodoError("CONFLICT", "请先撤销原自动关系，再建立观察关系。");
        // Re-registering cannot reset a consumed event, generation or user limits.
        return existing;
      }
    }
    const w: Supervision = {
      id: existing?.id ?? randomUUID(),
      controllerSessionId: controller.id,
      targetSessionId: target.id,
      mode: input.mode,
      state: "active",
      generation: (existing?.generation ?? 0) + 1,
      cursor: String(input.cursor),
      goal: input.goal,
      runId: input.runId,
      continuous: input.continuous,
      trigger: input.trigger,
      limits: actor === "model" && existing ? existing.limits : input.limits,
      continuations: actor === "model" ? (existing?.continuations ?? 0) : 0,
      failures: actor === "model" ? (existing?.failures ?? 0) : 0,
    };
    this.store.transaction(() => {
      this.store.saveWatch(w);
      if (actor === "user") this.grantTarget(controller.id, target.id);
      this.store.db
        .prepare("UPDATE wakes SET state='cancelled' WHERE watch_id=? AND state='pending'")
        .run(w.id);
      let cursor = input.cursor,
        events: RuntimeEvent[];
      do {
        events = this.store.events(target.id, cursor, 1000);
        for (const e of events) this.consume(w, e);
        cursor = events.at(-1)?.sequence ?? cursor;
      } while (events.length === 1000);
    });
    this.ingest(target.id, "supervision", {
      action: "watch",
      controllerId: controller.id,
      mode: w.mode,
    });
    this.drainWakes();
    return w;
  }
  changeWatch(id: string, state: "paused" | "revoked"): Supervision {
    const w = this.store.watches().find((w) => w.id === id);
    if (!w) throw new KodoError("NOT_FOUND", "管理关系不存在。");
    this.store.transaction(() => {
      w.state = state;
      w.generation++;
      this.store.saveWatch(w);
      this.store.db
        .prepare("UPDATE wakes SET state='cancelled' WHERE watch_id=? AND state='pending'")
        .run(w.id);
      if (w.mode === "continue") this.pauseTargetInside(w.targetSessionId, "管理关系暂停");
    });
    return w;
  }
  transferControl(value: unknown): Supervision {
    const input = watchSchema.parse(value);
    if (input.mode !== "continue")
      throw new KodoError("INVALID_INPUT", "控制权转交需要自动继续模式。");
    // Validate scope before mutating the current lease. Rebinding never sends
    // native input; old accepted commands and queued wakes lose their epoch.
    validateSupervision(
      this.store.session(input.controllerSessionId),
      this.store.session(input.targetSessionId),
      "observe",
      this.store.watches(),
    );
    return this.store.transaction(() => {
      this.pauseTargetInside(input.targetSessionId, "用户转交控制权");
      return this.watch({ ...input, cursor: this.store.latestSequence(input.targetSessionId) });
    });
  }
  private consume(w: Supervision, e: RuntimeEvent): void {
    if (e.sequence <= Number(w.cursor ?? 0) || w.state !== "active") return;
    w.cursor = String(e.sequence);
    this.store.saveWatch(w);
    if (
      !w.continuous &&
      this.store.record<{ generation: number }>("watch-fired", w.id)?.generation === w.generation
    )
      return;
    if (e.type !== (w.trigger ?? "turn-ended") || (w.runId && w.runId !== e.nativeRunId)) return;
    const payload = e.payload as Wire;
    if (payload.outcome === "failed") w.failures = (w.failures ?? 0) + 1;
    else w.failures = 0;
    if (w.mode === "continue") {
      const reason = this.limitReason(w);
      if (reason) {
        w.state = "paused";
        w.generation++;
        this.inbox(`limit:${w.id}:${w.generation}`, w.targetSessionId, "limit", { reason });
      } else {
        const wake: Wake = {
          id: `${w.id}:${w.generation}:${e.id}`,
          watchId: w.id,
          generation: w.generation,
          eventId: e.id,
          sequence: e.sequence,
          controllerId: w.controllerSessionId,
          targetId: w.targetSessionId,
          commandId: randomUUID(),
        };
        this.store.db
          .prepare("INSERT OR IGNORE INTO wakes VALUES (?,?,?,?,?)")
          .run(wake.id, w.id, w.generation, "pending", JSON.stringify(wake));
      }
    } else if (w.mode === "notify")
      this.inbox(`notice:${w.id}:${e.id}`, e.sessionId, "notification", {
        eventId: e.id,
        type: e.type,
        runId: e.nativeRunId,
      });
    if (!w.continuous) w.runId = e.nativeRunId ?? w.runId;
    // A one-shot watch consumes one matching event. Pending wake retains its authority until delivery.
    if (!w.continuous) this.store.put("watch-fired", w.id, { generation: w.generation });
    this.store.saveWatch(w);
  }
  private limitReason(w: Supervision): string | null {
    const l = w.limits ?? {};
    if (l.endAt && Date.now() >= Date.parse(l.endAt)) return "已到结束时间";
    if (l.maxContinuations !== undefined && (w.continuations ?? 0) >= l.maxContinuations)
      return "达到自动续聊次数";
    if (l.maxFailures !== undefined && (w.failures ?? 0) >= l.maxFailures)
      return "达到连续失败阈值";
    if (l.budgetUsd !== undefined) {
      const ids = [w.targetSessionId, w.controllerSessionId],
        usage = this.store.records<Usage>("usage").filter((u) => ids.includes(u.sessionId));
      if (usage.some((u) => u.costUsd === null)) return "费用未知，无法核对托管预算";
      if (usage.reduce((n, u) => n + (u.costUsd ?? 0), 0) >= l.budgetUsd) return "达到托管预算";
    }
    for (const b of this.store.records<{ projectId?: string; bindingId?: string; usd: number }>(
      "budget",
    )) {
      const target = this.store.session(w.targetSessionId),
        controller = this.store.session(w.controllerSessionId);
      if (
        (b.projectId && [target.projectId, controller.projectId].includes(b.projectId)) ||
        (b.bindingId && [target.bindingId, controller.bindingId].includes(b.bindingId))
      ) {
        const usage = this.store
          .records<Usage>("usage")
          .filter((u) => (b.projectId ? u.projectId === b.projectId : u.bindingId === b.bindingId));
        if (usage.some((u) => u.costUsd === null)) return "费用未知，无法核对预算";
        if (usage.reduce((n, u) => n + (u.costUsd ?? 0), 0) >= b.usd) return "达到本地预算";
      }
    }
    return null;
  }
  private enforceDeadlines(): void {
    if (this.disposed) return;
    for (const w of this.store.watches())
      if (
        w.state === "active" &&
        w.mode === "continue" &&
        w.limits?.endAt &&
        Date.now() >= Date.parse(w.limits.endAt)
      ) {
        this.changeWatch(w.id, "paused");
        this.inbox(`deadline:${w.id}:${w.generation}`, w.targetSessionId, "limit", {
          reason: "已到结束时间",
        });
        this.ingest(w.targetSessionId, "supervision", { action: "deadline-paused", watchId: w.id });
      }
  }
  private drainWakes(): void {
    if (this.disposed) return;
    const wakes = this.store.db
      .prepare("SELECT data FROM wakes WHERE state='pending'")
      .all()
      .map((r) => JSON.parse(r.data as string) as Wake);
    for (const wake of wakes) {
      const w = this.store.watches().find((w) => w.id === wake.watchId);
      if (!w || w.state !== "active" || w.mode !== "continue" || w.generation !== wake.generation) {
        this.store.db.prepare("UPDATE wakes SET state='cancelled' WHERE id=?").run(wake.id);
        continue;
      }
      const limit = this.limitReason(w);
      if (limit) {
        this.changeWatch(w.id, "paused");
        this.inbox(`limit:${wake.id}`, w.targetSessionId, "limit", { reason: limit });
        continue;
      }
      const controller = this.store.session(w.controllerSessionId);
      this.store.transaction(() => {
        const target = this.progress(wake.targetId);
        const command: Command = {
          id: wake.commandId,
          sessionId: controller.id,
          kind: "send",
          origin: "wake",
          controllerId: null,
          generation: controller.ownerEpoch,
          bindingRevision: controller.bindingRevision,
          status: "accepted",
          nativeRunId: null,
          body: {
            text: JSON.stringify({
              type: "harness-event",
              eventId: wake.eventId,
              sessionId: wake.targetId,
              cursor: wake.sequence,
              goal: w.goal,
              target: {
                title: target.title,
                harnessId: target.harnessId,
                status: target.status,
                lastOutcome: target.lastOutcome,
                lastError: target.lastError,
                lastReply: target.lastReply,
                openInteractions: target.openInteractions,
              },
              supervision: {
                continuations: w.continuations ?? 0,
                failures: w.failures ?? 0,
                limits: w.limits ?? {},
              },
              note: "原生回合结束不代表用户目标已完成。对照 goal 判断：需要细节时 harness_read，必要时自行核验文件或测试；未完成则 harness_send 下一步，需要用户时说明原因并停止续聊，已完成则 harness_watch revoke 并附证据汇报。",
            }),
            mode: "queue",
            wake,
          },
          createdAt: new Date().toISOString(),
        };
        if (!this.store.command(command.id)) this.store.saveCommand(command);
        this.store.db.prepare("UPDATE wakes SET state='dispatched' WHERE id=?").run(wake.id);
      });
      this.schedule(controller.id);
    }
  }
  grantTarget(controllerId: string, targetId: string): void {
    const grant = this.store.record<{ targets: string[]; projects: string[] }>(
      "grant",
      controllerId,
    ) ?? { targets: [], projects: [] };
    if (!grant.targets.includes(targetId)) grant.targets.push(targetId);
    this.store.put("grant", controllerId, grant);
  }
  grantProject(controllerId: string, projectId: string, options: Wire = {}): void {
    const input = projectGrantSchema.parse({ ...options, projectId }),
      c = this.store.session(controllerId);
    if (
      c.kind !== "supervisor" ||
      (c.projectId && c.projectId !== projectId) ||
      !this.store.projects().some((p) => p.id === projectId)
    )
      throw new KodoError("INVALID_INPUT", "项目授权范围无效。");
    this.store.transaction(() => {
      const grant = this.store.record<{ targets: string[]; projects: string[] }>(
          "grant",
          controllerId,
        ) ?? { targets: [], projects: [] },
        key = `${controllerId}:${projectId}`;
      if (input.mode === "revoke") {
        grant.projects = grant.projects.filter((id) => id !== projectId);
        this.store.remove("project-grant", key);
      } else {
        if (!grant.projects.includes(projectId)) grant.projects.push(projectId);
        this.store.put("project-grant", key, { ...input, controllerSessionId: controllerId });
      }
      this.store.put("grant", controllerId, grant);
    });
    this.ingest(controllerId, "supervision", { action: "project-grant", ...input });
  }
  createManagedDraft(controllerId: string, requestId: string, input: Wire): Session {
    const normalized = createSessionSchema.parse({ ...input, kind: "direct" }),
      c = this.store.session(controllerId),
      projectId = normalized.projectId,
      grant = this.store.record<{ projects: string[] }>("grant", controllerId);
    const previous = this.store.record<{
      sessionId: string;
      controllerSessionId?: string;
      input?: unknown;
    }>("tool-open", requestId);
    if (previous) {
      if (
        (previous.controllerSessionId && previous.controllerSessionId !== controllerId) ||
        (previous.input && JSON.stringify(previous.input) !== JSON.stringify(normalized))
      )
        throw new KodoError("CONFLICT", "请求 ID 已用于不同会话内容。");
      const s = this.store.session(previous.sessionId);
      this.requireGrant(c, s);
      return s;
    }
    if (
      !projectId ||
      !grant?.projects.includes(projectId) ||
      (c.projectId && c.projectId !== projectId)
    )
      throw new KodoError("UNAUTHORIZED", "新建会话需要用户授权项目范围。");
    return this.store.transaction(() => {
      const s = this.createDraft(normalized);
      this.grantTarget(controllerId, s.id);
      const policy = this.store.record<ProjectGrant>(
        "project-grant",
        `${controllerId}:${projectId}`,
      );
      if (policy?.mode === "create-and-control")
        this.watch({
          controllerSessionId: controllerId,
          targetSessionId: s.id,
          mode: "continue",
          goal: policy.goal,
          limits: policy.limits,
          continuous: true,
        });
      this.store.put("tool-open", requestId, {
        sessionId: s.id,
        controllerSessionId: controllerId,
        input: normalized,
      });
      return s;
    });
  }
  requireGrant(controller: Session, target: Session): void {
    const g = this.store.record<{ targets: string[]; projects: string[] }>("grant", controller.id);
    if (
      !g?.targets.includes(target.id) &&
      !(target.projectId && g?.projects.includes(target.projectId))
    )
      throw new KodoError("UNAUTHORIZED", "目标不在用户选定的管理范围。");
    if (controller.projectId && controller.projectId !== target.projectId)
      throw new KodoError("UNAUTHORIZED", "目标超出项目范围。");
  }
  requireControl(controllerId: string, target: Session, excludeCommandId?: string): void {
    const controller = this.store.session(controllerId);
    this.requireGrant(controller, target);
    const w = this.store
      .watches()
      .find(
        (w) =>
          w.controllerSessionId === controllerId &&
          w.targetSessionId === target.id &&
          w.mode === "continue" &&
          w.state === "active",
      );
    if (!w) throw new KodoError("UNAUTHORIZED", "目标自动继续未启用或已被用户暂停。");
    const reason = this.limitReason(w);
    if (reason) throw new KodoError("CONFLICT", reason);
    const pending = this.store
      .commands(target.id)
      .filter(
        (c) =>
          c.controllerId === controllerId &&
          c.id !== excludeCommandId &&
          c.generation === target.ownerEpoch &&
          ["accepted", "dispatched", "unknown"].includes(c.status),
      ).length;
    if (
      w.limits?.maxContinuations !== undefined &&
      (w.continuations ?? 0) + pending >= w.limits.maxContinuations
    )
      throw new KodoError("CONFLICT", "自动续聊次数已由待处理命令占用。");
  }
  private usage(s: Session, e: RuntimeEvent, p: Wire): void {
    const total = p.total ?? p,
      number = (...values: unknown[]) => {
        const n = values.find((v) => typeof v === "number" && Number.isFinite(v) && v >= 0);
        return typeof n === "number" ? n : null;
      };
    const scope = p.scope === "session" ? "session" : "turn",
      id = `${s.id}:${scope}:${p.sourceId ?? (scope === "session" ? (s.nativeSessionId ?? s.id) : e.id)}`;
    const sends = this.store
      .commands(s.id)
      .filter(
        (c) =>
          c.kind === "send" &&
          c.body.mode !== "steer" &&
          ["dispatched", "confirmed"].includes(c.status),
      );
    const active = e.nativeRunId
      ? (sends.findLast((c) => c.nativeRunId === e.nativeRunId) ??
        (sends.filter((c) => c.status === "dispatched").length === 1
          ? sends.find((c) => c.status === "dispatched")
          : undefined))
      : sends.at(-1);
    // Cumulative session totals may span models. A desired setting or binding default
    // cannot identify the model that produced an earlier turn's usage.
    // When Kodo did not choose a model, attribute it to the model the harness reported
    // for this session, or failing that its configured native default.
    const fallbackModel =
      s.model ??
      this.store.record<{ model: string }>("session-current-model", s.id)?.model ??
      this.binding(s)?.model ??
      nativeDefaults(s.harnessId, process.env, join(this.dataDir, "kodo")).model;
    const usedModel =
      scope === "session"
        ? // A total may span models once Kodo switched models; only attribute it otherwise.
          (p.model ?? (s.model || s.settingsRevision ? null : fallbackModel))
        : (p.model ?? (active?.body.settings as Wire)?.model ?? fallbackModel);
    // Native SDK prices describe their catalog, not an arbitrary bound endpoint's bill.
    const cost = this.binding(s) ? null : number(p.costUsd, total.cost?.total);
    const usage: Usage = {
      id,
      sessionId: s.id,
      projectId: s.projectId,
      bindingId: s.bindingId,
      source: s.harnessId,
      scope,
      input: number(total.input, total.inputTokens, total.input_tokens),
      output: number(total.output, total.outputTokens, total.output_tokens),
      cacheRead: number(total.cacheRead, total.cachedInputTokens, total.cache_read_input_tokens),
      cacheWrite: number(total.cacheWrite, total.cache_creation_input_tokens),
      costUsd: cost,
      costKind:
        cost === null
          ? "unknown"
          : ["kodo", "pi"].includes(s.harnessId) || p.estimated
            ? "estimate"
            : "actual",
      model: usedModel,
      createdAt: e.createdAt,
    };
    const prior = this.store.record<Usage>("usage", id);
    if (scope === "session" && prior) {
      for (const key of ["input", "output", "cacheRead", "cacheWrite", "costUsd"] as const)
        if (prior[key] !== null && (usage[key] === null || usage[key]! < prior[key]!))
          usage[key] = prior[key];
    }
    // No native price: estimate turn cost from the public catalog list price.
    if (usage.costUsd === null && scope === "turn" && usage.model) {
      const requests = number(p.requests, total.requests);
      const binding = this.binding(s);
      const selected =
        binding?.selectionMode === "provider"
          ? this.providers.bindingModel(binding, usage.model)
          : binding;
      const estimate =
        !binding || selected?.parameters.pricing
          ? this.providers.estimateCost(
              s.harnessId,
              usage.model,
              {
                ...usage,
                requests:
                  requests !== null && Number.isSafeInteger(requests) ? requests : undefined,
              },
              selected?.parameters.pricing,
            )
          : null;
      if (estimate !== null) {
        usage.costUsd = estimate;
        usage.costKind = "estimate";
      }
    }
    this.store.put("usage", id, usage);
  }
  private cachedHarnessModels(id: HarnessId): HarnessModelOption[] {
    const discovered =
      this.store.record<{ models: HarnessModelOption[] }>("harness-models", id)?.models ?? [];
    const recentSessions = this.store
      .sessions()
      .filter((s) => s.harnessId === id && typeof s.model === "string" && s.model)
      .map((s): HarnessModelOption => ({ id: s.model!, source: "recent" }));
    const recentUsage = this.store
      .records<Usage>("usage")
      .filter((u) => u.source === id && typeof u.model === "string" && u.model)
      .map((u): HarnessModelOption => ({ id: u.model!, source: "recent" }));
    return mergeModelOptions(discovered, recentSessions, recentUsage).slice(0, 60);
  }
  async harnessModels(id: HarnessId, discover = false) {
    if (!HARNESS_IDS.includes(id)) throw new KodoError("NOT_FOUND", "找不到该 harness。");
    const desc = this.adapter(id).descriptor;
    const base = this.cachedHarnessModels(id);
    let defaultModel: { provider?: string; model: string } | null = null;
    let extra: HarnessModelOption[] = [];
    if (id === "kodo" || id === "pi") {
      const root = id === "kodo" ? join(this.dataDir, "kodo") : undefined;
      const label = id === "kodo" ? "Kooyu 独立本机配置" : "pi 本机原生配置";
      const local = readKodoNativeModels(root, label);
      defaultModel = local.defaultModel;
      const builtin = await getKodoBuiltinCatalog();
      extra = mergeModelOptions(await getKodoConfiguredCatalog(root, label), local.models, builtin);
    }
    const adapter = this.adapter(id);
    if (discover && adapter.discoverModels) {
      if (!this.modelDiscovery.has(id))
        this.modelDiscovery.set(
          id,
          (async () => {
            try {
              const models = await adapter.discoverModels!({
                cwd: null,
                dataDir: this.dataDir,
                launch: nativeLaunch(this.dataDir, id),
                env: await instanceEnv(id, undefined, this.dataDir),
                emit: () => {},
                interact: async () => {
                  throw new KodoError("UNSUPPORTED", "读取模型目录不处理交互。");
                },
              });
              this.store.put("harness-models", id, { models });
              return models;
            } catch {
              return [];
            }
          })().finally(() => this.modelDiscovery.delete(id)),
        );
      extra = mergeModelOptions(extra, await this.modelDiscovery.get(id)!);
    }
    // Prices and limits come from the public catalog; refresh it in the background when stale.
    if (appSettings(this.store).autoRefreshModels) this.providers.refreshIfStale();
    // The user's own config decides what the harness runs; a catalog's "default" flag
    // only applies when nothing is configured.
    const configured = nativeDefaults(id, process.env, join(this.dataDir, "kodo"));
    if (!defaultModel && configured.model) {
      const slash = configured.model.indexOf("/");
      defaultModel =
        slash > 0 && ["zcode", "opencode", "deepseek-harness"].includes(id)
          ? { provider: configured.model.slice(0, slash), model: configured.model.slice(slash + 1) }
          : { model: configured.model };
    }
    const reportedDefault =
      extra.find((model) => model.isDefault) ?? base.find((model) => model.isDefault);
    if (!defaultModel && reportedDefault)
      defaultModel = { provider: reportedDefault.provider, model: reportedDefault.id };
    return {
      harnessId: id,
      modelSupport: desc.modelSupport ?? "binding-or-model",
      defaultModel,
      nativeDefaults: configured,
      models: this.providers.enrichModelOptions(id, mergeModelOptions(extra, base)),
    };
  }
  async sessionModelOptions(id: string, refresh = false, discover = false) {
    const session = this.store.session(id);
    const bound = this.binding(session);
    if (bound)
      return {
        modelSupport: "binding-or-model" as const,
        session,
        models: this.providers.enrichModelOptions(
          session.harnessId,
          bound.selectionMode === "provider"
            ? this.providers.providerModelOptions(bound)
            : [boundModelOption(bound)],
        ),
        nativeCatalog: false,
        defaultModel: null,
        effectiveModel: bound.model,
        binding: bound,
      };
    const runtime = refresh ? await this.connect(id) : this.runtime.get(id);
    if (runtime?.models) {
      const models = await runtime.models();
      this.store.put("session-models", id, { models });
    }
    const base = await this.harnessModels(session.harnessId, discover);
    const native = this.store.record<{ models: HarnessModelOption[] }>("session-models", id);
    const models = native?.models ?? base.models;
    const currentModel = native?.models.find((model) => model.isCurrent);
    const defaultModel =
      native?.models.find((model) => model.isDefault) ??
      base.models.find((model) => model.isDefault);
    return {
      ...base,
      defaultModel:
        base.defaultModel ??
        (defaultModel ? { provider: defaultModel.provider, model: defaultModel.id } : null),
      session: this.store.session(id),
      models: this.providers.enrichModelOptions(
        session.harnessId,
        mergeModelOptions(models, base.models),
      ),
      nativeCatalog: Boolean(native),
      effectiveModel:
        this.store.record<{ model: string }>("session-current-model", id)?.model ??
        (currentModel
          ? `${currentModel.provider ? `${currentModel.provider}/` : ""}${currentModel.id}`
          : null),
    };
  }
  async setModelSettings(id: string, value: unknown): Promise<Session> {
    this.store.session(id);
    const parsed = modelSettingsSchema.safeParse(value);
    if (!parsed.success) throw new KodoError("INVALID_INPUT", "模型设置或请求 ID 无效。");
    const input = parsed.data;
    const prior = this.store.record<{ sessionId: string; input: unknown; result: Session }>(
      "model-settings-request",
      input.requestId,
    );
    if (prior) {
      if (prior.sessionId !== id || JSON.stringify(prior.input) !== JSON.stringify(input))
        throw new KodoError("CONFLICT", "请求 ID 已被其他模型设置使用。");
      return prior.result;
    }
    const options = await this.sessionModelOptions(id);
    if (options.modelSupport === "native-only")
      throw new KodoError("UNSUPPORTED", "此原生安装尚未提供模型设置。");
    const session = this.store.session(id);
    const bound = this.binding(session);
    if (
      bound &&
      bound.selectionMode !== "provider" &&
      input.model &&
      ![bound.model, `kodo-${bound.providerId}/${bound.model}`].includes(input.model)
    )
      throw new KodoError(
        "UNSUPPORTED",
        "此会话固定模型绑定；更换 Provider 或模型请创建新的绑定会话。",
      );
    const effectiveModel = input.model ?? bound?.model ?? null;
    if (bound?.selectionMode === "provider") this.providers.bindingModel(bound, input.model);
    validateReasoning(effectiveModel, input.reasoning, options.models);
    if (
      ["zcode", "opencode", "deepseek-harness"].includes(session.harnessId) &&
      !bound &&
      input.model &&
      !input.model.includes("/")
    )
      throw new KodoError("INVALID_INPUT", "此 harness 的模型需要 provider/model 格式。");
    return this.store.transaction(() => {
      const duplicate = this.store.record<{ sessionId: string; input: unknown; result: Session }>(
        "model-settings-request",
        input.requestId,
      );
      if (duplicate) {
        if (duplicate.sessionId !== id || JSON.stringify(duplicate.input) !== JSON.stringify(input))
          throw new KodoError("CONFLICT", "请求 ID 已被使用。");
        return duplicate.result;
      }
      const current = this.store.session(id);
      if ((current.settingsRevision ?? 0) !== input.expectedRevision)
        throw new KodoError("CONFLICT", "模型设置已被另一客户端修改，请重新打开选择器。");
      const next = {
        ...current,
        model: input.model,
        reasoning: input.reasoning,
        settingsRevision: input.expectedRevision + 1,
      };
      this.store.saveSession(next);
      this.store.put("model-settings-request", input.requestId, {
        sessionId: id,
        input,
        result: next,
      });
      this.ingest(
        id,
        "state",
        {
          modelSettings: {
            model: input.model,
            reasoning: input.reasoning,
            revision: next.settingsRevision,
          },
          effective: "next-turn",
        },
        `settings:${input.requestId}`,
      );
      return next;
    });
  }
  modelSettingsReceipt(id: string, requestId: string): Session {
    this.store.session(id);
    const receipt = this.store.record<{ sessionId: string; result: Session }>(
      "model-settings-request",
      requestId,
    );
    if (!receipt || receipt.sessionId !== id)
      throw new KodoError("NOT_FOUND", "尚未找到该模型设置请求的回执。");
    return receipt.result;
  }
  usageSummary() {
    return {
      records: this.store.records<Usage>("usage"),
      budgets: this.store.records("budget"),
      quota: { status: "unknown" },
      note: "执行会话与 Kooyu 主对话各计一次；独立 pi 会话单列，未知不按零处理。",
    };
  }
  saveBudget(id: string, budget: { projectId?: string; bindingId?: string; usd: number }) {
    if (!Number.isFinite(budget.usd) || budget.usd <= 0 || (!budget.projectId && !budget.bindingId))
      throw new KodoError("INVALID_INPUT", "预算需要项目或绑定和正金额。");
    this.store.put("budget", id, budget);
  }
  bindingDefaults(): BindingDefaults {
    return (
      this.store.record<BindingDefaults>("binding-defaults", "global") ?? {
        harnessBindingIds: {},
        revision: 0,
      }
    );
  }
  private checkHarnessDefaults(defaults: Partial<Record<HarnessId, string | null>>): void {
    for (const [harness, id] of Object.entries(defaults)) {
      const binding = id ? this.store.record<HarnessBinding>("harness-binding", id) : undefined;
      if (id && !binding) throw new KodoError("NOT_FOUND", "默认配置引用的绑定不存在。");
      if (binding && binding.harnessId !== harness)
        throw new KodoError("INVALID_INPUT", "默认绑定属于另一个 Harness。");
    }
  }
  updateBindingDefaults(value: unknown): BindingDefaults {
    const input = bindingDefaultsSchema.parse(value);
    return this.store.transaction(() => {
      const current = this.bindingDefaults();
      if (current.revision !== input.expectedRevision)
        throw new KodoError("CONFLICT", "默认配置已更新，请刷新后重试。");
      this.checkHarnessDefaults(input.harnessBindingIds);
      const next = {
        harnessBindingIds: input.harnessBindingIds,
        revision: current.revision + 1,
      };
      this.store.put("binding-defaults", "global", next);
      return next;
    });
  }
  updateProjectDefaults(id: string, value: unknown): Project {
    const input = projectDefaultsSchema.parse(value);
    return this.store.transaction(() => {
      const project = this.store.projects().find((p) => p.id === id);
      if (!project) throw new KodoError("NOT_FOUND", "项目不存在。");
      if ((project.configRevision ?? 0) !== input.expectedRevision)
        throw new KodoError("CONFLICT", "项目默认配置已更新，请刷新后重试。");
      this.checkHarnessDefaults(input.bindingDefaults);
      this.store.put("project-binding-defaults", id, {
        bindingDefaults: input.bindingDefaults,
        configRevision: (project.configRevision ?? 0) + 1,
      });
      return this.store.projects().find((p) => p.id === id)!;
    });
  }
  updateSession(
    id: string,
    value: {
      archived?: boolean;
      pinned?: boolean;
      unread?: boolean;
      title?: string;
      projectId?: string | null;
      workspaceId?: string | null;
      permissionMode?: import("@kodo/protocol").PermissionMode | null;
    },
  ) {
    const s = this.store.session(id);
    if (value.title?.length === 0 || (value.title && value.title.length > 200))
      throw new KodoError("INVALID_INPUT", "标题无效。");
    if (value.projectId && !this.store.projects().some((p) => p.id === value.projectId))
      throw new KodoError("NOT_FOUND", "项目不存在。");
    if (value.workspaceId !== undefined && value.workspaceId !== s.workspaceId) {
      if (s.phase !== "draft")
        throw new KodoError(
          "CONFLICT",
          "原生会话的执行位置不能随项目整理改变，请使用新会话或交接。",
        );
      if (value.workspaceId && !this.store.workspaces().some((w) => w.id === value.workspaceId))
        throw new KodoError("NOT_FOUND", "工作位置不存在。");
    }
    if (
      s.harnessId === "kimi-code" &&
      s.nativeSessionId &&
      !s.nativeSessionId.startsWith("session_") &&
      value.permissionMode?.startsWith("kimi:")
    )
      throw new KodoError("UNSUPPORTED", "旧 Kimi ACP 会话不支持 Server 权限模式。");
    if (
      s.harnessId === "kimi-code" &&
      s.nativeSessionId?.startsWith("session_") &&
      value.permissionMode?.startsWith("acp:")
    )
      throw new KodoError("UNSUPPORTED", "Kimi Server 会话不支持 ACP 权限模式。");
    if (value.permissionMode !== undefined)
      this.validatePermissionMode(s.harnessId, value.permissionMode);
    const next = { ...s, ...value },
      moved = value.projectId !== undefined && value.projectId !== s.projectId;
    next.scope = next.projectId ? "project" : "global";
    this.store.transaction(() => {
      if (moved) {
        this.pauseTargetInside(id, "项目归属调整");
        next.ownerEpoch = this.store.session(id).ownerEpoch;
        for (const w of this.store
          .watches()
          .filter((w) => w.controllerSessionId === id && w.state === "active"))
          this.store.saveWatch({ ...w, state: "paused", generation: w.generation + 1 });
      }
      this.store.saveSession(next);
    });
    return next;
  }
  async sessionPermissionOptions(id: string) {
    const session = this.store.session(id);
    if (!["gemini", "cursor", "kimi-code", "grok-build"].includes(session.harnessId)) return null;
    return (await this.runtime.get(id)?.permissionOptions?.()) ?? null;
  }
  async updatePermissionMode(id: string, value: Parameters<SessionService["updateSession"]>[1]) {
    const session = this.store.session(id);
    const mode = value.permissionMode;
    if (mode === undefined) return this.updateSession(id, value);
    if (Object.keys(value).some((key) => key !== "permissionMode"))
      throw new KodoError("INVALID_INPUT", "权限模式请单独更新。");
    this.validatePermissionMode(session.harnessId, mode);
    if (session.runState !== "idle")
      throw new KodoError("CONFLICT", "会话正在运行，结束后再切换权限模式。");
    const native = this.runtime.get(id);
    if (session.connectionState === "connected" && native?.setPermissionMode)
      await native.setPermissionMode(mode);
    else if (mode?.startsWith("acp:"))
      throw new KodoError("CONFLICT", "ACP 会话未连接，无法核对原生可选模式。");
    return this.updateSession(id, value);
  }
  async handoff(id: string, input: Wire) {
    const source = this.store.session(id),
      requestId = typeof input.requestId === "string" ? input.requestId : undefined,
      fingerprint = JSON.stringify({ sourceId: id, ...input }),
      prior = requestId
        ? this.store.record<{ fingerprint: string; sessionId: string }>(
            "handoff-request",
            requestId,
          )
        : undefined;
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        throw new KodoError("CONFLICT", "交接请求 ID 已用于不同内容。");
      return this.store.session(prior.sessionId);
    }
    return this.store.transaction(() => {
      const target = this.createDraft({
        title: input.title ?? `交接 · ${source.title}`,
        harnessId: input.harnessId,
        kind: "direct",
        projectId: input.projectId ?? source.projectId,
        workspaceId: input.workspaceId ?? source.workspaceId,
        bindingId: input.bindingId,
      });
      if (requestId)
        this.store.put("handoff-request", requestId, { fingerprint, sessionId: target.id });
      this.store.put("session-link", target.id, {
        fromSessionId: id,
        toSessionId: target.id,
        type: "handoff",
        createdAt: new Date().toISOString(),
      });
      this.ingest(target.id, "handoff", { fromSessionId: id });
      if (input.text)
        this.acceptSend(target.id, { requestId: input.requestId, text: input.text, mode: "queue" });
      return target;
    });
  }
  resumeWork(): void {
    this.drainWakes();
    for (const c of this.store.commands()) if (c.status === "accepted") this.schedule(c.sessionId);
  }
  async maintenance() {
    if (this.disposed) return;
    const events = this.store.collect();
    const credentials = await collectProviderCredentials(this.store);
    if (this.store.records("provider").length && appSettings(this.store).autoRefreshModels)
      await this.providers.refreshCatalog(false).catch(() => {});
    return { events, credentials };
  }
  async dispose(): Promise<void> {
    for (const id of this.textBuffers.keys()) {
      try {
        this.flushText(id);
      } catch (error) {
        console.error(this.errorText(error));
      }
    }
    this.disposed = true;
    clearInterval(this.deadlineTimer);
    clearInterval(this.maintenanceTimer);
    clearInterval(this.nativeSyncTimer);
    await this.nativeSyncJob;
    for (const i of this.interactions.values()) i.resolve({ cancelled: true });
    this.interactions.clear();
    await Promise.allSettled([...this.runtime.values()].map((r) => r.close()));
    this.runtime.clear();
    await this.providers.close();
    await this.engines.close();
  }
}
