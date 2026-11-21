import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  NATIVE_HARNESS_IDS,
  KodoError,
  watchSchema,
  projectGrantSchema,
  createProjectSchema,
  type Session,
} from "@kodo/protocol";
import { validateSupervision } from "../domain/session-rules.js";
import type { SessionService } from "../session-service.js";
import type { Wire } from "../harnesses/adapter.js";
const managementRequests = new WeakMap<
  SessionService,
  Map<string, { input: string; value: Promise<unknown> }>
>();
export const HARNESS_TOOL_NAMES = [
  "harness_list",
  "harness_open",
  "harness_read",
  "harness_send",
  "harness_watch",
  "harness_stop",
  "harness_grant",
  "harness_handoff",
  "harness_update",
  "harness_project",
  "harness_delegate",
] as const;
export function stableRequestId(namespace: string, value: string): string {
  const h = createHash("sha256").update(`${namespace}:${value}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export function createHarnessTools(service: SessionService, controller: Session): ToolDefinition[] {
  const make = (
    name: string,
    description: string,
    parameters: any,
    run: (input: Wire, id: string) => unknown | Promise<unknown>,
  ): ToolDefinition => ({
    name,
    label: name,
    description,
    parameters,
    async execute(id, input) {
      const durable = [
        "harness_watch",
        "harness_grant",
        "harness_handoff",
        "harness_project",
      ].includes(name);
      const key = stableRequestId(`${controller.id}:${name}`, id);
      const fingerprint = JSON.stringify(input);
      const prior = durable
        ? service.store.record<{
            input: string;
            value?: unknown;
            error?: { code: KodoError["code"]; message: string };
          }>("management-tool-result", key)
        : undefined;
      if (prior && prior.input !== fingerprint)
        throw new KodoError("CONFLICT", "管理请求 ID 已用于不同内容。");
      if (prior?.error) throw new KodoError(prior.error.code, prior.error.message);
      if (prior)
        return { content: [{ type: "text", text: JSON.stringify(prior.value) }], details: {} };
      let requests = managementRequests.get(service);
      if (!requests) {
        requests = new Map();
        managementRequests.set(service, requests);
      }
      const pending = requests.get(key);
      if (pending && pending.input !== fingerprint)
        throw new KodoError("CONFLICT", "管理请求 ID 已用于不同内容。");
      const perform = async () => {
        try {
          const value = await run(input as Wire, id);
          if (durable)
            service.store.put("management-tool-result", key, { input: fingerprint, value });
          return value;
        } catch (error) {
          if (durable && error instanceof KodoError)
            service.store.put("management-tool-result", key, {
              input: fingerprint,
              error: { code: error.code, message: error.message },
            });
          throw error;
        }
      };
      const valuePromise = pending?.value ?? perform();
      if (!pending) requests.set(key, { input: fingerprint, value: valuePromise });
      let value: unknown;
      try {
        value = await valuePromise;
      } finally {
        if (requests.get(key)?.value === valuePromise) requests.delete(key);
      }
      return { content: [{ type: "text", text: JSON.stringify(value) }], details: {} };
    },
  });
  const target = (id: string) => {
    const session = service.store.session(id);
    service.requireGrant(service.store.session(controller.id), session);
    return session;
  };
  const scopedTarget = (id: string) => {
    const session = service.store.session(id);
    validateSupervision(
      service.store.session(controller.id),
      session,
      "observe",
      service.store.watches(),
    );
    return session;
  };
  const confirm = async (id: string, params: Wire) => {
    const epoch = service.store.session(controller.id).ownerEpoch;
    const requestId = stableRequestId(controller.id, `${id}:${JSON.stringify(params)}`);
    if (!(await service.confirmManagement(controller.id, requestId, params)))
      throw new KodoError("UNAUTHORIZED", "用户未允许此管理操作，未执行。");
    if (service.store.session(controller.id).ownerEpoch !== epoch)
      throw new KodoError("CONFLICT", "确认期间 Kooyu 已停止或管理范围已改变，请重新发起操作。");
  };
  const authorizeTarget = async (id: string, callId: string) => {
    if (id === controller.id) return service.store.session(id);
    const session = scopedTarget(id);
    try {
      service.requireGrant(service.store.session(controller.id), session);
    } catch (error) {
      if (!(error instanceof KodoError) || error.code !== "UNAUTHORIZED") throw error;
      await confirm(callId, {
        action: "授权 Kooyu 读取和连接此会话",
        sessionId: id,
        title: session.title,
      });
      // Scope may have changed while the user was considering the request.
      scopedTarget(id);
      service.grantTarget(controller.id, id);
    }
    return service.store.session(id);
  };
  const limits = Type.Object({
    endAt: Type.Optional(Type.String({ format: "date-time" })),
    maxContinuations: Type.Optional(
      Type.Integer({ minimum: 0, description: "0 means unlimited (default)." }),
    ),
    maxFailures: Type.Optional(
      Type.Integer({ minimum: 0, description: "0 means unlimited (default)." }),
    ),
    budgetUsd: Type.Optional(
      Type.Number({ minimum: 0, description: "0 means unlimited (default)." }),
    ),
    maxTotalTokens: Type.Optional(
      Type.Integer({
        minimum: 0,
        description:
          "0 means unlimited (default). Applies to all providers even when USD price is unknown.",
      }),
    ),
  });
  const delegateTaskSchema = Type.Object({
    harnessId: Type.Union(NATIVE_HARNESS_IDS.map((id) => Type.Literal(id))),
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    task: Type.String({ minLength: 1, maxLength: 200000 }),
    goal: Type.Optional(Type.String({ maxLength: 10000 })),
    goalId: Type.Optional(Type.String()),
    projectId: Type.Optional(Type.String()),
    workspaceId: Type.Optional(Type.String()),
    workerSessionId: Type.Optional(Type.String()),
    readOnly: Type.Optional(
      Type.Boolean({ description: "Restrict Codex or Claude Code to read-only review." }),
    ),
    isolation: Type.Optional(
      Type.Union([Type.Literal("worktree"), Type.Literal("shared"), Type.Literal("auto")]),
    ),
    branchName: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    baseRef: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    limits: Type.Optional(limits),
    executorId: Type.Optional(Type.String()),
    model: Type.Optional(Type.String()),
    reasoning: Type.Optional(Type.String()),
  });
  const workspace =
    controller.workspaceId &&
    service.store.workspaces().find((w) => w.id === controller.workspaceId);
  const jobInput = Type.Object({ jobId: Type.String({ format: "uuid" }) });
  const ownJob = (jobId: string) => {
    const job = service.backgroundJobs.get(jobId);
    if (job.sessionId !== controller.id)
      throw new KodoError("UNAUTHORIZED", "该作业属于其他会话。");
    return job;
  };
  const journal = (callId: string, params: Wire, run: () => Promise<unknown>) =>
    service.actions.run(
      {
        sessionId: controller.id,
        actor: controller.harnessId,
        toolCallId: callId,
        turnId:
          service.store.record<{ id: string }>("active-tool-turn", controller.id)?.id ?? "initial",
      },
      params,
      run,
    );
  return [
    ...(workspace && controller.harnessId === "kodo"
      ? [
          make(
            "shell_exec",
            "Run a project shell command. Returns a job ID if it continues in the background.",
            Type.Object({
              command: Type.String({ minLength: 1 }),
              cwd: Type.Optional(Type.String()),
              yieldMs: Type.Optional(Type.Integer({ minimum: 0 })),
              background: Type.Optional(Type.Boolean()),
              notifyOnExit: Type.Optional(Type.Boolean()),
            }),
            (p, id) =>
              journal(id, { tool: "shell_exec", params: p }, () =>
                service.backgroundJobs.exec({
                  sessionId: controller.id,
                  workspaceId: workspace.id,
                  command: p.command,
                  cwd: resolve(workspace.rootPath, p.cwd ?? "."),
                  yieldMs: p.yieldMs,
                  background: p.background,
                  notifyOnExit: p.notifyOnExit,
                }),
              ),
          ),
          make("job_status", "Inspect a shell job in this conversation.", jobInput, (p) =>
            ownJob(p.jobId),
          ),
          make(
            "job_output",
            "Read recent shell job output.",
            Type.Object({
              jobId: Type.String({ format: "uuid" }),
              tailBytes: Type.Optional(Type.Integer({ minimum: 1, maximum: 262144 })),
            }),
            (p) => service.backgroundJobs.output(ownJob(p.jobId).id, p.tailBytes),
          ),
          make(
            "job_kill",
            "Stop a running process tree owned by this conversation.",
            jobInput,
            (p, id) =>
              journal(id, { tool: "job_kill", params: p }, () =>
                service.backgroundJobs.kill(ownJob(p.jobId).id),
              ),
          ),
        ]
      : []),
    make(
      "harness_project",
      "Create a project from the GLOBAL main conversation after in-conversation user approval. Supply the user's project name and optionally an existing absolute directory. Returns the project and its workspaces. Does not create directories, move this conversation, start execution or grant control. Project-scoped conversations cannot create projects outside their scope. Use harness_grant separately before creating execution sessions.",
      Type.Object({
        name: Type.String({ minLength: 1, maxLength: 200 }),
        rootPath: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })),
      }),
      async (p, id) => {
        const input = createProjectSchema.parse(p);
        const requireGlobal = () => {
          const live = service.store.session(controller.id);
          if (live.kind !== "supervisor" || live.projectId)
            throw new KodoError(
              "UNAUTHORIZED",
              "请在全局主对话中创建项目，项目主对话只能管理当前项目。",
            );
        };
        requireGlobal();
        await confirm(id, { action: "新建项目", ...input });
        requireGlobal();
        const key = stableRequestId(`${controller.id}:harness_project`, id);
        return service.store.transaction(() => {
          const saved = service.store.record("project-tool-created", key);
          if (saved) return saved;
          const project = service.createProject(input);
          const result = {
            project,
            workspaces: service.store.workspaces().filter((w) => w.projectId === project.id),
          };
          service.store.put("project-tool-created", key, result);
          return result;
        });
      },
    ),
    make(
      "harness_list",
      "List sessions, projects, workspaces, instances and capabilities. Use progress=true to get a compact status per session (last request/reply excerpt, last outcome/error, waiting input, controller) for progress reports without reading each session. status filters by derived state. Listing confers no write authority; turn-ended is never goal completion.",
      Type.Object({
        projectId: Type.Optional(Type.String()),
        harnessId: Type.Optional(Type.String()),
        after: Type.Optional(Type.Integer({ minimum: 0 })),
        progress: Type.Optional(Type.Boolean()),
        includeArchived: Type.Optional(Type.Boolean()),
        status: Type.Optional(
          Type.Union([
            Type.Literal("active"),
            Type.Literal("running"),
            Type.Literal("waiting-input"),
            Type.Literal("failed"),
            Type.Literal("managed"),
          ]),
        ),
      }),
      (p) => {
        const s = service.snapshot(),
          inScope = s.sessions.filter(
            (s) =>
              s.id !== controller.id &&
              (!controller.projectId || s.projectId === controller.projectId) &&
              (!p.projectId || s.projectId === p.projectId) &&
              (!p.harnessId || s.harnessId === p.harnessId) &&
              (p.includeArchived || !s.archived),
          );
        const progress =
          p.progress || p.status
            ? new Map(inScope.map((item) => [item.id, service.progress(item.id)]))
            : undefined;
        const visible = inScope
          .filter((item) => {
            if (!p.status) return true;
            const pr = progress!.get(item.id)!;
            if (p.status === "managed") return pr.controlledBy !== null;
            if (p.status === "active")
              return ["running", "waiting-input", "failed"].includes(pr.status);
            return pr.status === p.status;
          })
          .sort((a, b) =>
            progress
              ? progress.get(b.id)!.lastActivityAt.localeCompare(progress.get(a.id)!.lastActivityAt)
              : 0,
          );
        if (p.progress) {
          const page = visible.slice(p.after ?? 0, (p.after ?? 0) + 100);
          const names = new Map(s.projects.map((item) => [item.id, item.name]));
          return {
            total: visible.length,
            next:
              (p.after ?? 0) + page.length < visible.length ? (p.after ?? 0) + page.length : null,
            projects: s.projects
              .filter((item) => !controller.projectId || item.id === controller.projectId)
              .map((item) => ({ id: item.id, name: item.name })),
            sessions: page.map((item) => ({
              ...progress!.get(item.id)!,
              project: item.projectId ? (names.get(item.projectId) ?? null) : null,
            })),
            pendingInbox: s.inbox.filter(
              (i) => !i.resolved && page.some((item) => item.id === i.sessionId),
            ).length,
          };
        }
        return {
          ...s,
          projects: s.projects.filter(
            (p) => !controller.projectId || p.id === controller.projectId,
          ),
          workspaces: s.workspaces.filter(
            (w) =>
              !controller.projectId ||
              w.projectId === controller.projectId ||
              visible.some((s) => s.workspaceId === w.id),
          ),
          sessions: visible.slice(p.after ?? 0, (p.after ?? 0) + 100),
          supervisions: s.supervisions.filter((w) => w.controllerSessionId === controller.id),
          projectGrants: s.projectGrants.filter((g) => g.controllerSessionId === controller.id),
          bindings: s.bindings,
          inbox: [],
          devices: [],
        };
      },
    ),
    make(
      "harness_open",
      "Create an execution session in a user-authorized project (use harness_grant first), or connect a selected session. Missing target access requests confirmation in the conversation. Never changes native identity.",
      Type.Object({
        sessionId: Type.Optional(Type.String()),
        harnessId: Type.Optional(Type.Union(NATIVE_HARNESS_IDS.map((id) => Type.Literal(id)))),
        title: Type.Optional(Type.String()),
        projectId: Type.Optional(Type.String()),
        workspaceId: Type.Optional(Type.String()),
        executorId: Type.Optional(Type.String()),
      }),
      async (p, id) => {
        if (p.sessionId) {
          await authorizeTarget(p.sessionId, id);
          return service.openNative(p.sessionId);
        }
        const session = service.createManagedDraft(
          controller.id,
          stableRequestId(controller.id, id),
          {
            title: p.title ?? "执行会话",
            harnessId: p.harnessId,
            projectId: p.projectId,
            workspaceId: p.workspaceId,
            executorId: p.executorId,
            ...(p.executorId && p.executorId !== "local" ? { bindingId: null } : {}),
          },
        );
        return service.openNative(session.id);
      },
    ),
    make(
      "harness_read",
      "Read session events/receipts, native conversation history, discovered native history, or quota. source=events|native|history|quota. Missing access requests confirmation in chat. Native capabilities may be unsupported; turn-ended is not goal completion.",
      Type.Object({
        sessionId: Type.String(),
        after: Type.Optional(Type.Integer({ minimum: 0 })),
        source: Type.Optional(
          Type.Union([
            Type.Literal("events"),
            Type.Literal("native"),
            Type.Literal("history"),
            Type.Literal("quota"),
          ]),
        ),
      }),
      async (p, id) => {
        const session = await authorizeTarget(p.sessionId, id);
        if ((p.source === "native" || p.source === "history") && !session.nativeSessionId)
          throw new KodoError("CONFLICT", "会话尚未创建原生历史，未为读取历史新建会话。");
        if (p.source === "native") return service.nativeRead(p.sessionId);
        if (p.source === "history") return service.nativeList(p.sessionId);
        if (p.source === "quota") return service.quota(p.sessionId);
        return service.read(p.sessionId, p.after ?? 0);
      },
    ),
    make(
      "harness_send",
      "Submit one durable native input. Returns accepted, never claims completion. Automatic control must be user-enabled.",
      Type.Object({
        sessionId: Type.String(),
        text: Type.String(),
        mode: Type.Optional(
          Type.Union([Type.Literal("new"), Type.Literal("queue"), Type.Literal("steer")]),
        ),
      }),
      (p, id) => {
        target(p.sessionId);
        return service.acceptSend(
          p.sessionId,
          { requestId: stableRequestId(controller.id, id), text: p.text, mode: p.mode ?? "queue" },
          controller.id,
        );
      },
    ),
    make(
      "harness_watch",
      "Manage supervision from conversation: observe/notify/continue, pause, revoke, or transfer control to this Kooyu conversation. Pass goalId to tie the relation to a goal: wakes then carry that exact goal and the session is linked to it. New or changed authority and resuming paused control request explicit user confirmation in chat. Preserve limits and do not infer permission from native output.",
      Type.Object({
        sessionId: Type.String(),
        mode: Type.Optional(
          Type.Union([Type.Literal("observe"), Type.Literal("notify"), Type.Literal("continue")]),
        ),
        goal: Type.Optional(Type.String()),
        goalId: Type.Optional(Type.String()),
        cursor: Type.Optional(Type.Integer({ minimum: 0 })),
        continuous: Type.Optional(Type.Boolean()),
        watchId: Type.Optional(Type.String()),
        revoke: Type.Optional(Type.Boolean()),
        action: Type.Optional(
          Type.Union([
            Type.Literal("set"),
            Type.Literal("pause"),
            Type.Literal("revoke"),
            Type.Literal("transfer"),
          ]),
        ),
        limits: Type.Optional(limits),
      }),
      async (p, id) => {
        const session = scopedTarget(p.sessionId);
        if (p.revoke || p.action === "revoke" || p.action === "pause") {
          target(p.sessionId);
          const w = service.store
            .watches()
            .find(
              (w) =>
                (!p.watchId || w.id === p.watchId) &&
                w.targetSessionId === p.sessionId &&
                w.controllerSessionId === controller.id,
            );
          if (!w) throw new KodoError("NOT_FOUND", "订阅不存在。");
          return service.changeWatch(w.id, p.action === "pause" ? "paused" : "revoked");
        }
        const existing = service.store
          .watches()
          .find(
            (w) => w.controllerSessionId === controller.id && w.targetSessionId === p.sessionId,
          );
        if (p.goalId) service.goals.owned(p.goalId, controller.id);
        const input = watchSchema.parse({
          controllerSessionId: controller.id,
          targetSessionId: p.sessionId,
          mode: p.action === "transfer" ? "continue" : (p.mode ?? existing?.mode ?? "observe"),
          goal: p.goal ?? existing?.goal ?? "",
          goalId: p.goalId ?? existing?.goalId ?? null,
          cursor: p.cursor ?? Number(existing?.cursor ?? service.store.latestSequence(p.sessionId)),
          continuous: p.continuous ?? existing?.continuous ?? true,
          limits: p.limits ?? existing?.limits ?? {},
        });
        if (
          p.action !== "transfer" &&
          existing?.state === "active" &&
          existing.mode === input.mode &&
          existing.goal === input.goal &&
          (existing.goalId ?? null) === (input.goalId ?? null) &&
          Number(existing.cursor) === input.cursor &&
          existing.continuous === input.continuous &&
          JSON.stringify(existing.limits ?? {}) === JSON.stringify(input.limits)
        ) {
          target(p.sessionId);
          return existing;
        }
        const generation = JSON.stringify(
          service.store
            .watches()
            .filter((item) => item.targetSessionId === p.sessionId)
            .map((item) => [item.id, item.generation, item.state]),
        );
        await confirm(id, {
          action: p.action === "transfer" ? "将自动控制交给当前 Kooyu" : "设置会话托管",
          title: session.title,
          ...input,
        });
        scopedTarget(p.sessionId);
        if (
          service.store.session(p.sessionId).ownerEpoch !== session.ownerEpoch ||
          generation !==
            JSON.stringify(
              service.store
                .watches()
                .filter((item) => item.targetSessionId === p.sessionId)
                .map((item) => [item.id, item.generation, item.state]),
            )
        )
          throw new KodoError("CONFLICT", "确认期间目标已停止或托管关系已改变，请重新发起操作。");
        const result =
          p.action === "transfer" ? service.transferControl(input) : service.watch(input, "user");
        if (input.goalId) {
          const goal = service.goals.get(input.goalId);
          if (
            !goal.sessionIds.includes(p.sessionId) &&
            !["completed", "cancelled"].includes(goal.status)
          )
            await service.goals.update(
              goal.id,
              {
                requestId: stableRequestId(controller.id, `goal-link:${id}`),
                expectedRevision: goal.revision,
                addSessionIds: [p.sessionId],
              },
              "model",
              controller.id,
            );
        }
        return result;
      },
    ),
    make(
      "harness_stop",
      "Cancel a selected native turn or stop and pause supervision. Cancellation may be unconfirmed.",
      Type.Object({ sessionId: Type.String(), pause: Type.Optional(Type.Boolean()) }),
      (p, id) => {
        target(p.sessionId);
        const requestId = stableRequestId(controller.id, id);
        if (!service.store.command(requestId))
          service.requireControl(controller.id, service.store.session(p.sessionId));
        return service.stop(p.sessionId, p.pause ?? true, requestId, controller.id);
      },
    ),
    make(
      "harness_grant",
      "Trigger an on-demand authorization request in this conversation to create future execution sessions in a project, optionally auto-control them, or revoke future creation authority. Proactively use before harness_open when the user-requested task needs creation authority; never ask the user to configure a settings form. Use the minimum requested scope: auto-control only for user-requested supervision. Wait for explicit user confirmation; denial must not be retried or bypassed.",
      Type.Object({
        projectId: Type.String(),
        mode: Type.Optional(
          Type.Union([
            Type.Literal("create-only"),
            Type.Literal("create-and-control"),
            Type.Literal("revoke"),
          ]),
        ),
        goal: Type.Optional(Type.String()),
        limits: Type.Optional(limits),
      }),
      async (p, id) => {
        const input = projectGrantSchema.parse(p);
        const project = service.store.projects().find((item) => item.id === input.projectId);
        if (!project || (controller.projectId && controller.projectId !== project.id))
          throw new KodoError("UNAUTHORIZED", "项目超出当前 Kooyu 的管理范围。");
        await confirm(id, { action: "设置项目会话创建权限", project: project.name, ...input });
        service.grantProject(controller.id, input.projectId, {
          mode: input.mode,
          goal: input.goal,
          limits: input.limits,
        });
        return { status: "updated", ...input };
      },
    ),
    make(
      "harness_handoff",
      "Prepare a cross-harness handoff from a selected session. Pass an accurate summary of goals, progress, files, checks and remaining work. After user confirmation creates a linked draft; optional send starts it once. Does not pause or claim completion of the source.",
      Type.Object({
        sessionId: Type.String(),
        harnessId: Type.Union(NATIVE_HARNESS_IDS.map((id) => Type.Literal(id))),
        title: Type.Optional(Type.String()),
        text: Type.String({ minLength: 1, maxLength: 200000 }),
        send: Type.Optional(Type.Boolean()),
      }),
      async (p, id) => {
        const source = scopedTarget(p.sessionId);
        await confirm(id, {
          action: p.send ? "创建交接会话并发送材料" : "创建交接草稿",
          fromTitle: source.title,
          ...p,
        });
        const current = scopedTarget(p.sessionId);
        const next = await service.handoff(p.sessionId, {
          harnessId: p.harnessId,
          title: p.title,
          projectId: current.projectId,
          workspaceId: current.workspaceId,
          requestId: stableRequestId(controller.id, `handoff:${id}`),
          ...(p.send ? { text: p.text } : {}),
        });
        service.store.put("handoff-material", next.id, { fromSessionId: current.id, text: p.text });
        service.grantTarget(controller.id, next.id);
        return { session: next, material: p.text, queued: p.send ?? false };
      },
    ),
    make(
      "harness_update",
      "Organize sessions: rename, archive/unarchive, pin, or move to another project (projectId null = unassigned). Requires user confirmation in chat unless this conversation already manages the session; moving to another project always asks. Never touches native history, cwd, or the controller itself. Use harness_stop to stop work.",
      Type.Object({
        sessionId: Type.String(),
        title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
        archived: Type.Optional(Type.Boolean()),
        pinned: Type.Optional(Type.Boolean()),
        projectId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      }),
      async (p, id) => {
        if (p.sessionId === controller.id)
          throw new KodoError("INVALID_INPUT", "Kooyu 不整理自身会话，请由用户在界面中操作。");
        const session = scopedTarget(p.sessionId);
        const change: Wire = {};
        for (const key of ["title", "archived", "pinned"] as const)
          if (p[key] !== undefined && p[key] !== session[key]) change[key] = p[key];
        if (p.projectId !== undefined && p.projectId !== session.projectId) {
          const scope = service.store.session(controller.id).projectId;
          if (scope && p.projectId !== scope)
            throw new KodoError("UNAUTHORIZED", "项目主对话不能把会话移出本项目。");
          if (p.projectId && !service.store.projects().some((item) => item.id === p.projectId))
            throw new KodoError("NOT_FOUND", "项目不存在。");
          change.projectId = p.projectId;
        }
        if (!Object.keys(change).length) return { status: "unchanged", session };
        let managed = false;
        try {
          service.requireGrant(service.store.session(controller.id), session);
          managed = true;
        } catch (error) {
          if (!(error instanceof KodoError) || error.code !== "UNAUTHORIZED") throw error;
        }
        if (!managed || change.projectId !== undefined || change.archived === true) {
          const projects = service.store.projects();
          await confirm(id, {
            action: "整理会话",
            title: session.title,
            sessionId: session.id,
            ...change,
            ...(change.projectId !== undefined
              ? {
                  fromProject:
                    projects.find((item) => item.id === session.projectId)?.name ?? "未归属",
                  toProject:
                    projects.find((item) => item.id === change.projectId)?.name ?? "未归属",
                }
              : {}),
          });
          scopedTarget(p.sessionId);
        }
        return { status: "updated", session: service.updateSession(p.sessionId, change) };
      },
    ),
    make(
      "harness_delegate",
      "Delegate one task (or a parallel tasks[] batch) to clean-context worker harness session(s) in isolated Git worktree(s), with an immutable Mandate, authoritative Watch, and compact DelegationReport wake-up. Requests project create-and-control approval in chat before provisioning if missing. Pass tasks[] for parallel workers with waitPolicy=all|any (default all) to receive a single coalesced batch report.",
      Type.Object({
        harnessId: Type.Optional(Type.Union(NATIVE_HARNESS_IDS.map((id) => Type.Literal(id)))),
        title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
        task: Type.Optional(Type.String({ minLength: 1, maxLength: 200000 })),
        goal: Type.Optional(Type.String({ maxLength: 10000 })),
        goalId: Type.Optional(Type.String()),
        projectId: Type.Optional(Type.String()),
        workspaceId: Type.Optional(Type.String()),
        workerSessionId: Type.Optional(Type.String()),
        readOnly: Type.Optional(
          Type.Boolean({ description: "Restrict Codex or Claude Code to read-only review." }),
        ),
        isolation: Type.Optional(
          Type.Union([Type.Literal("worktree"), Type.Literal("shared"), Type.Literal("auto")]),
        ),
        branchName: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
        baseRef: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
        limits: Type.Optional(limits),
        executorId: Type.Optional(Type.String()),
        model: Type.Optional(Type.String()),
        reasoning: Type.Optional(Type.String()),
        waitPolicy: Type.Optional(Type.Union([Type.Literal("all"), Type.Literal("any")])),
        tasks: Type.Optional(Type.Array(delegateTaskSchema, { minLength: 1, maxLength: 8 })),
      }),
      async (p, id) => {
        const tasks =
          Array.isArray(p.tasks) && p.tasks.length > 0
            ? p.tasks.map((item: Wire) => ({
                harnessId: item.harnessId,
                title: item.title,
                task: item.task,
                goal: item.goal ?? p.goal,
                goalId: item.goalId ?? p.goalId,
                projectId: item.projectId ?? p.projectId,
                workspaceId: item.workspaceId ?? p.workspaceId,
                workerSessionId: item.workerSessionId,
                readOnly: item.readOnly ?? p.readOnly,
                isolation: item.isolation ?? p.isolation,
                branchName: item.branchName,
                baseRef: item.baseRef ?? p.baseRef,
                limits: item.limits ?? p.limits,
                executorId: item.executorId ?? p.executorId,
                model: item.model,
                reasoning: item.reasoning,
              }))
            : p.harnessId && p.task
              ? [
                  {
                    harnessId: p.harnessId,
                    title: p.title,
                    task: p.task,
                    goal: p.goal,
                    goalId: p.goalId,
                    projectId: p.projectId,
                    workspaceId: p.workspaceId,
                    workerSessionId: p.workerSessionId,
                    readOnly: p.readOnly,
                    isolation: p.isolation,
                    branchName: p.branchName,
                    baseRef: p.baseRef,
                    limits: p.limits,
                    executorId: p.executorId,
                    model: p.model,
                    reasoning: p.reasoning,
                  },
                ]
              : null;
        if (!tasks)
          throw new KodoError(
            "INVALID_INPUT",
            "请提供 harnessId 与 task，或提供非空 tasks[] 委派列表。",
          );
        const batch = await service.delegations.delegateBatch({
          controllerSessionId: controller.id,
          callId: id,
          tasks,
          waitPolicy: p.waitPolicy,
          confirmGrant: async (projectId, projectName) => {
            await confirm(id, {
              action: "授权 Kooyu 在项目中委派并自动控制子 Harness",
              project: projectName,
              projectId,
              mode: "create-and-control",
              tasks: tasks.map((t: Wire) => ({
                harnessId: t.harnessId,
                title: t.title ?? t.harnessId,
                isolation: t.isolation ?? "auto",
              })),
            });
            service.grantProject(controller.id, projectId, {
              mode: "create-and-control",
              goal: p.goal ?? tasks[0]?.goal ?? "",
              limits: p.limits ?? {},
            });
          },
        });
        return {
          batchId: batch.batchId,
          waitPolicy: batch.waitPolicy,
          delegations: batch.delegations.map((d) => ({
            ticketId: d.ticket.id,
            workerSessionId: d.session.id,
            harnessId: d.session.harnessId,
            title: d.session.title,
            watchId: d.watch.id,
            isolation: d.ticket.mandate.isolation,
            branchName: d.worktree?.branchName ?? null,
            worktreePath: d.worktree?.rootPath ?? null,
            fallbackNote: d.fallbackNote,
            status: d.ticket.status,
          })),
        };
      },
    ),
  ];
}
