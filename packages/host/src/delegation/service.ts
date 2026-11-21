import {
  KodoError,
  type DelegationIsolation,
  type DelegationMandate,
  type DelegationProvisioningStep,
  type DelegationReport,
  type DelegationStatus,
  type DelegationTicket,
  type DelegationWaitPolicy,
  type HarnessId,
  type ProjectGrant,
  type Session,
  type Supervision,
  type WorkspaceWorktree,
} from "@kodo/protocol";
import type { SessionService } from "../session-service.js";
import { computeGitFacts, WorkspaceMutex } from "../workspaces/worktrees.js";
import { digest } from "../execution/actions.js";
import { stableRequestId } from "../kodo/tools.js";

interface StoredMandateEnvelope {
  mandate: DelegationMandate;
  title: string;
  harnessId: HarnessId;
  fallbackNote?: string | null;
  lastError?: string | null;
}

export interface DelegateTaskInput {
  harnessId: HarnessId;
  title?: string;
  task: string;
  goal?: string;
  goalId?: string | null;
  projectId?: string;
  workspaceId?: string;
  workerSessionId?: string;
  isolation?: DelegationIsolation;
  branchName?: string;
  baseRef?: string;
  limits?: Supervision["limits"];
  executorId?: string;
  model?: string | null;
  reasoning?: string | null;
  readOnly?: boolean;
}

export interface DelegateBatchInput {
  controllerSessionId: string;
  callId: string;
  tasks: DelegateTaskInput[];
  waitPolicy?: DelegationWaitPolicy;
  initiator?: "user" | "rule";
  confirmGrant?: (projectId: string, projectName: string) => Promise<void>;
}

export interface DelegateTaskResult {
  ticket: DelegationTicket;
  session: Session;
  watch: Supervision;
  worktree: WorkspaceWorktree | null;
  fallbackNote: string | null;
}

function parseEnvelope(raw: string): StoredMandateEnvelope {
  const parsed = JSON.parse(raw) as Partial<StoredMandateEnvelope> & DelegationMandate;
  if (parsed && typeof parsed === "object" && "mandate" in parsed && parsed.mandate) {
    return {
      mandate: parsed.mandate,
      title: String(parsed.title ?? "委派任务"),
      harnessId: (parsed.harnessId ?? "codex") as HarnessId,
      fallbackNote: parsed.fallbackNote ?? null,
      lastError: parsed.lastError ?? null,
    };
  }
  return {
    mandate: parsed as DelegationMandate,
    title: "委派任务",
    harnessId: "codex",
    fallbackNote: null,
    lastError: null,
  };
}

function rowToTicket(row: Record<string, unknown>): DelegationTicket {
  const env = parseEnvelope(String(row.mandate));
  return {
    id: String(row.id),
    batchId: row.batch_id ? String(row.batch_id) : null,
    controllerSessionId: String(row.controller_session_id),
    workerSessionId: row.worker_session_id ? String(row.worker_session_id) : null,
    watchId: row.watch_id ? String(row.watch_id) : null,
    goalId: row.goal_id ? String(row.goal_id) : null,
    title: env.title,
    harnessId: env.harnessId,
    status: String(row.status) as DelegationStatus,
    waitPolicy: (String(row.wait_policy || "all") === "any"
      ? "any"
      : "all") as DelegationWaitPolicy,
    mandate: env.mandate,
    provisioningStep: String(row.provisioning_step) as DelegationProvisioningStep,
    report: row.report ? (JSON.parse(String(row.report)) as DelegationReport) : null,
    fallbackNote: env.fallbackNote ?? null,
    lastError: env.lastError ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class DelegationService {
  private readonly calls = new WorkspaceMutex();
  constructor(private readonly service: SessionService) {}

  private get store() {
    return this.service.store;
  }

  save(ticket: DelegationTicket): DelegationTicket {
    const envelope: StoredMandateEnvelope = {
      mandate: ticket.mandate,
      title: ticket.title,
      harnessId: ticket.harnessId,
      fallbackNote: ticket.fallbackNote ?? null,
      lastError: ticket.lastError ?? null,
    };
    this.store.db
      .prepare(
        `INSERT INTO delegation_tickets(
           id, batch_id, controller_session_id, worker_session_id, watch_id, goal_id,
           status, wait_policy, mandate, provisioning_step, report, created_at, updated_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           batch_id = excluded.batch_id,
           worker_session_id = excluded.worker_session_id,
           watch_id = excluded.watch_id,
           goal_id = excluded.goal_id,
           status = excluded.status,
           wait_policy = excluded.wait_policy,
           mandate = excluded.mandate,
           provisioning_step = excluded.provisioning_step,
           report = excluded.report,
           updated_at = excluded.updated_at`,
      )
      .run(
        ticket.id,
        ticket.batchId,
        ticket.controllerSessionId,
        ticket.workerSessionId,
        ticket.watchId,
        ticket.goalId,
        ticket.status,
        ticket.waitPolicy,
        JSON.stringify(envelope),
        ticket.provisioningStep,
        ticket.report ? JSON.stringify(ticket.report) : null,
        ticket.createdAt,
        ticket.updatedAt,
      );
    return ticket;
  }

  get(id: string): DelegationTicket {
    const row = this.store.db.prepare("SELECT * FROM delegation_tickets WHERE id=?").get(id) as
      Record<string, unknown> | undefined;
    if (!row) throw new KodoError("NOT_FOUND", "委派工单不存在。");
    return rowToTicket(row);
  }

  find(id: string): DelegationTicket | undefined {
    const row = this.store.db.prepare("SELECT * FROM delegation_tickets WHERE id=?").get(id) as
      Record<string, unknown> | undefined;
    return row ? rowToTicket(row) : undefined;
  }

  findByWatchId(watchId: string): DelegationTicket | undefined {
    const row = this.store.db
      .prepare("SELECT * FROM delegation_tickets WHERE watch_id=? ORDER BY updated_at DESC LIMIT 1")
      .get(watchId) as Record<string, unknown> | undefined;
    return row ? rowToTicket(row) : undefined;
  }

  findActiveByWorker(workerSessionId: string): DelegationTicket | undefined {
    const row = this.store.db
      .prepare(
        `SELECT * FROM delegation_tickets
         WHERE worker_session_id=? AND status IN ('provisioning', 'running', 'awaiting-review')
         LIMIT 1`,
      )
      .get(workerSessionId) as Record<string, unknown> | undefined;
    return row ? rowToTicket(row) : undefined;
  }

  list(
    filter: {
      controllerSessionId?: string;
      workerSessionId?: string;
      batchId?: string;
      goalId?: string;
      activeOnly?: boolean;
    } = {},
  ): DelegationTicket[] {
    const rows = this.store.db
      .prepare("SELECT * FROM delegation_tickets ORDER BY created_at DESC")
      .all() as Record<string, unknown>[];
    return rows
      .map(rowToTicket)
      .filter(
        (t) =>
          (!filter.controllerSessionId || t.controllerSessionId === filter.controllerSessionId) &&
          (!filter.workerSessionId || t.workerSessionId === filter.workerSessionId) &&
          (!filter.batchId || t.batchId === filter.batchId) &&
          (!filter.goalId || t.goalId === filter.goalId) &&
          (!filter.activeOnly || ["provisioning", "running", "awaiting-review"].includes(t.status)),
      );
  }

  /**
   * Reconcile stranded `provisioning` tickets after a Host restart without silently
   * repeating ambiguous external side effects.
   */
  reconcileOnStartup(): void {
    const stranded = this.list().filter((t) => t.status === "provisioning");
    const now = new Date().toISOString();
    for (const ticket of stranded) {
      const sendCmdId = stableRequestId(ticket.id, "send");
      const cmd = this.store.command(sendCmdId);
      const watch = ticket.watchId
        ? this.store.watches().find((w) => w.id === ticket.watchId)
        : undefined;
      if (
        cmd &&
        ["accepted", "dispatched", "confirmed"].includes(cmd.status) &&
        cmd.sessionId === ticket.workerSessionId &&
        watch?.state === "active" &&
        this.revalidateMandate(ticket).ok
      ) {
        this.save({
          ...ticket,
          status: "running",
          provisioningStep: "ready",
          updatedAt: now,
        });
        continue;
      }
      if (
        ticket.mandate.isolation === "worktree" &&
        ticket.mandate.allowedWorkspaceId &&
        ticket.mandate.worktreeBranch &&
        ticket.provisioningStep === "step_1_worktree"
      ) {
        const wt = this.service.worktrees.get(ticket.mandate.allowedWorkspaceId);
        if (wt && wt.lifecycleState === "preparing") {
          void this.service.worktrees.cleanup(wt.workspaceId, { force: true }).catch(() => {});
        }
      }
      const opened = this.store.record<{ sessionId: string; controllerSessionId?: string }>(
        "tool-open",
        stableRequestId(ticket.id, "open"),
      );
      const workerSessionId =
        ticket.workerSessionId ??
        (opened?.controllerSessionId === ticket.controllerSessionId ? opened.sessionId : null);
      if (watch?.state === "active") this.service.changeWatch(watch.id, "paused");
      this.save({
        ...ticket,
        status: "failed",
        workerSessionId,
        lastError: "Host 重启时委派工单尚未完成准备，已安全终止并等待主控确认。",
        updatedAt: now,
      });
    }
  }

  /** Revalidate immutable Mandate against live project-grant revision/generation and limits. */
  revalidateMandate(ticket: DelegationTicket): { ok: true } | { ok: false; reason: string } {
    let controller: Session;
    try {
      controller = this.store.session(ticket.controllerSessionId);
    } catch {
      return { ok: false, reason: "主控会话已不存在。" };
    }
    if (controller.kind !== "supervisor")
      return { ok: false, reason: "控制者不再是 Kooyu 主对话。" };
    if (
      controller.projectId &&
      ticket.mandate.projectId &&
      controller.projectId !== ticket.mandate.projectId
    )
      return { ok: false, reason: "项目范围已变更，与工单授权契约不一致。" };

    if (ticket.mandate.projectId && ticket.mandate.grantScope !== "worker") {
      const grantKey = `${ticket.controllerSessionId}:${ticket.mandate.projectId}`;
      const grant = this.store.record<ProjectGrant>("project-grant", grantKey);
      if (!grant || grant.revoked === true)
        return { ok: false, reason: "项目托管授权已撤销，已安全挂起工单。" };
      if (grant.mode !== "create-and-control")
        return { ok: false, reason: "项目授权已降级，不再允许自动控制。" };
      const currentGen = grant.generation ?? 1;
      if (currentGen !== ticket.mandate.projectGrantGeneration)
        return { ok: false, reason: "项目授权代次已更新，旧工单需人工重新确认。" };
    } else if (ticket.workerSessionId) {
      try {
        this.service.requireGrant(controller, this.store.session(ticket.workerSessionId));
      } catch {
        return { ok: false, reason: "目标会话授权已失效，已安全挂起工单。" };
      }
    }

    if (ticket.goalId) {
      try {
        const goal = this.service.goals.get(ticket.goalId);
        if (["completed", "cancelled"].includes(goal.status))
          return { ok: false, reason: "关联目标已结束，不再继续自动委派。" };
      } catch {
        return { ok: false, reason: "关联目标已不存在。" };
      }
    }

    if (ticket.watchId) {
      const watch = this.store.watches().find((w) => w.id === ticket.watchId);
      if (!watch || watch.state !== "active" || watch.mode !== "continue")
        return { ok: false, reason: "关联托管关系已暂停或撤销。" };
      const limit = this.service.checkSupervisionLimits(watch);
      if (limit) return { ok: false, reason: limit };
    }
    return { ok: true };
  }

  /** Build compact structured DelegationReport separating deterministic Host facts from worker claims. */
  async buildReport(ticket: DelegationTicket): Promise<DelegationReport> {
    if (!ticket.workerSessionId) throw new KodoError("CONFLICT", "委派工单尚未绑定 Worker 会话。");
    const worker = this.store.session(ticket.workerSessionId);
    const ws = worker.workspaceId
      ? this.store.workspaces().find((w) => w.id === worker.workspaceId)
      : undefined;
    const wt = worker.workspaceId ? this.service.worktrees.get(worker.workspaceId) : undefined;
    const gitFacts = ws
      ? await computeGitFacts(ws.rootPath, wt?.baseCommit ?? null)
      : {
          git: false,
          baseCommit: null,
          headCommit: null,
          dirtyCount: 0,
          diffStat: { filesChanged: 0, insertions: 0, deletions: 0, paths: [] },
        };

    const hostVerifications = ticket.goalId
      ? this.service.goals
          .verifications(ticket.goalId)
          .filter(
            (v) =>
              v.recordedBy === "host" &&
              ["command", "test", "build"].includes(v.kind) &&
              v.exitCode !== null,
          )
          .slice(-10)
          .map((v) => ({
            id: v.id,
            command: v.method,
            exitCode: v.exitCode!,
            passed: v.outcome === "passed" && v.exitCode === 0,
          }))
      : [];

    const progress = this.service.progress(worker.id);
    const report: DelegationReport = {
      ticketId: ticket.id,
      workerSessionId: worker.id,
      harnessId: worker.harnessId,
      branchName: wt?.branchName ?? ticket.mandate.worktreeBranch ?? null,
      isolation: ticket.mandate.isolation,
      ...(ticket.fallbackNote ? { fallbackNote: ticket.fallbackNote } : {}),
      gitFacts,
      hostVerifications,
      workerClaim: {
        verification: "unverified-worker-claim",
        nativeStatus: progress.status,
        lastOutcome: progress.lastOutcome,
        lastError: progress.lastError,
        replyExcerpt: progress.lastReply ? progress.lastReply.slice(0, 1200) : null,
        openInteractions: progress.openInteractions,
      },
    };
    this.save({
      ...this.get(ticket.id),
      report,
      updatedAt: new Date().toISOString(),
    });
    return report;
  }

  /**
   * Execute 4-stage idempotent delegation for one or more tasks (sharing `batchId` when batched).
   * Pre-authorization MUST complete before persisting any `provisioning` ticket.
   */
  delegateBatch(input: DelegateBatchInput) {
    const key = stableRequestId(input.controllerSessionId, input.callId);
    return this.calls.run(key, () => this.delegateBatchInside(input, key));
  }

  private async delegateBatchInside(
    input: DelegateBatchInput,
    key: string,
  ): Promise<{
    batchId: string | null;
    waitPolicy: DelegationWaitPolicy;
    delegations: DelegateTaskResult[];
  }> {
    if (!input.tasks.length || input.tasks.length > 8)
      throw new KodoError("INVALID_INPUT", "每次委派需要 1–8 个子任务。");
    const controller = this.store.session(input.controllerSessionId);
    if (controller.kind !== "supervisor")
      throw new KodoError("UNAUTHORIZED", "仅 Kooyu 主对话可以发起委派工单。");

    const waitPolicy: DelegationWaitPolicy = input.waitPolicy ?? "all";
    const fingerprint = digest({
      tasks: input.tasks,
      waitPolicy,
      initiator: input.initiator ?? "user",
    });
    const prior = this.store.record<string>("delegation-request", key);
    if (prior && prior !== fingerprint)
      throw new KodoError("CONFLICT", "委派请求 ID 已用于不同任务。");
    const batchId =
      input.tasks.length > 1
        ? stableRequestId(`${controller.id}:delegate-batch`, input.callId)
        : null;

    // Resolve and validate all project scopes & pre-authorize BEFORE writing any provisioning row.
    const resolvedProjects = new Map<number, string>();
    const projectIdsToAuthorize = new Set<string>();
    for (let i = 0; i < input.tasks.length; i++) {
      const task = input.tasks[i]!;
      const projectId = task.projectId ?? controller.projectId ?? undefined;
      if (!projectId)
        throw new KodoError("INVALID_INPUT", "委派任务必须指定所属项目（projectId）。");
      if (controller.projectId && controller.projectId !== projectId)
        throw new KodoError("UNAUTHORIZED", "项目超出当前主对话管理范围。");
      const project = this.store.projects().find((p) => p.id === projectId);
      if (!project) throw new KodoError("NOT_FOUND", "指定项目不存在。");
      if (task.goalId) this.service.goals.owned(task.goalId, controller.id);
      if (task.readOnly && !["codex", "claude-code"].includes(task.harnessId))
        throw new KodoError("UNSUPPORTED", "此 Harness 尚未支持只读委派。");
      if (task.workerSessionId) {
        const worker = this.store.session(task.workerSessionId);
        if (
          worker.projectId !== projectId ||
          worker.harnessId !== task.harnessId ||
          (task.readOnly && worker.permissionMode !== "read-only")
        )
          throw new KodoError("INVALID_INPUT", "Worker 的项目、Harness 或只读权限与委派不符。");
      }
      resolvedProjects.set(i, projectId);

      const grantKey = `${controller.id}:${projectId}`;
      const existingGrant = this.store.record<ProjectGrant>("project-grant", grantKey);
      if (
        !existingGrant ||
        existingGrant.revoked === true ||
        existingGrant.mode !== "create-and-control"
      ) {
        projectIdsToAuthorize.add(projectId);
      }
    }

    for (const projectId of projectIdsToAuthorize) {
      const project = this.store.projects().find((p) => p.id === projectId)!;
      if (!input.confirmGrant)
        throw new KodoError("UNAUTHORIZED", `项目「${project.name}」尚未授予自动创建与控制权限。`);
      await input.confirmGrant(projectId, project.name);
    }

    const results: DelegateTaskResult[] = [];
    if (!prior) this.store.put("delegation-request", key, fingerprint);
    for (let i = 0; i < input.tasks.length; i++) {
      const task = input.tasks[i]!;
      const projectId = resolvedProjects.get(i)!;
      const ticketKey = input.tasks.length === 1 ? input.callId : `${input.callId}:${i}`;
      const ticketId = stableRequestId(`${controller.id}:delegate`, ticketKey);
      results.push(
        await this.delegateSingle({
          ticketId,
          batchId,
          waitPolicy,
          controllerId: controller.id,
          projectId,
          initiator: input.initiator ?? "user",
          task,
        }),
      );
    }
    return { batchId, waitPolicy, delegations: results };
  }

  private async delegateSingle(params: {
    ticketId: string;
    batchId: string | null;
    waitPolicy: DelegationWaitPolicy;
    controllerId: string;
    projectId: string;
    initiator: "user" | "rule";
    task: DelegateTaskInput;
  }): Promise<DelegateTaskResult> {
    const { ticketId, batchId, waitPolicy, controllerId, projectId, initiator, task } = params;
    const existing = this.find(ticketId);
    if (existing) {
      if (
        ["running", "awaiting-review", "completed"].includes(existing.status) &&
        existing.workerSessionId &&
        existing.watchId
      ) {
        const session = this.store.session(existing.workerSessionId);
        const watch = this.store.watches().find((w) => w.id === existing.watchId)!;
        const worktree = session.workspaceId
          ? (this.service.worktrees.get(session.workspaceId) ?? null)
          : null;
        return {
          ticket: existing,
          session,
          watch,
          worktree,
          fallbackNote: existing.fallbackNote ?? null,
        };
      }
      if (["blocked", "failed", "cancelled"].includes(existing.status)) {
        throw new KodoError(
          "CONFLICT",
          existing.lastError ?? "该委派工单此前已失败或取消，请使用新的调用发起。",
        );
      }
    }

    const grantKey = `${controllerId}:${projectId}`;
    const grant = this.store.record<ProjectGrant>("project-grant", grantKey);
    if (!grant || grant.revoked === true || grant.mode !== "create-and-control")
      throw new KodoError("UNAUTHORIZED", "项目缺少有效的自动创建与控制授权。");

    // Resolve parent workspace
    const projectWorkspaces = this.store.workspaces().filter((w) => w.projectId === projectId);
    const controller = this.store.session(controllerId);
    if (
      task.workspaceId &&
      !projectWorkspaces.some((w) => w.id === task.workspaceId && w.hostId === this.store.hostId)
    )
      throw new KodoError("UNAUTHORIZED", "工作区不在项目的本机授权范围。");
    const parentWorkspace =
      (task.workspaceId
        ? this.store.workspaces().find((w) => w.id === task.workspaceId)
        : undefined) ??
      (controller.workspaceId
        ? projectWorkspaces.find((w) => w.id === controller.workspaceId)
        : undefined) ??
      projectWorkspaces.find((w) => !this.service.worktrees.get(w.id)) ??
      projectWorkspaces[0];

    const requestedIsolation: DelegationIsolation = task.workerSessionId
      ? "shared"
      : (task.isolation ?? "auto");

    const now = new Date().toISOString();
    const effectiveLimits = { ...grant.limits, ...task.limits };
    for (const key of ["maxFailures", "maxContinuations", "budgetUsd", "maxTotalTokens"] as const) {
      const ceiling = grant.limits?.[key];
      if (ceiling && (!(effectiveLimits[key] ?? 0) || effectiveLimits[key]! > ceiling))
        effectiveLimits[key] = ceiling;
    }
    if (
      grant.limits?.endAt &&
      (!effectiveLimits.endAt || Date.parse(effectiveLimits.endAt) > Date.parse(grant.limits.endAt))
    )
      effectiveLimits.endAt = grant.limits.endAt;
    let ticket: DelegationTicket =
      existing ??
      this.save({
        id: ticketId,
        batchId,
        controllerSessionId: controllerId,
        workerSessionId: task.workerSessionId ?? null,
        watchId: null,
        goalId: task.goalId ?? null,
        title: task.title?.trim() || `${task.harnessId} 委派任务`,
        harnessId: task.harnessId,
        status: "provisioning",
        waitPolicy,
        mandate: {
          initiator,
          projectId,
          allowedWorkspaceId: parentWorkspace?.id ?? null,
          worktreeBranch: null,
          isolation: requestedIsolation === "shared" ? "shared" : "worktree",
          allowedOperations: ["harness.send", "harness.watch", "workspace.read"],
          projectGrantRevision: grant.revision ?? 1,
          projectGrantGeneration: grant.generation ?? 1,
          limits: effectiveLimits,
        },
        provisioningStep: "step_0_ticket",
        report: null,
        fallbackNote: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      });

    let targetWorkspace = parentWorkspace;
    let createdWorktree: WorkspaceWorktree | null = null;
    let fallbackNote: string | null = ticket.fallbackNote ?? null;

    try {
      // Step 1: Worktree provisioning (if requested & not reusing an existing worker session)
      if (
        !task.workerSessionId &&
        (requestedIsolation === "worktree" || requestedIsolation === "auto")
      ) {
        if (existing && ticket.mandate.worktreeBranch && ticket.mandate.allowedWorkspaceId) {
          const priorWt = this.service.worktrees.get(ticket.mandate.allowedWorkspaceId);
          if (priorWt && priorWt.lifecycleState === "ready") {
            createdWorktree = priorWt;
            targetWorkspace = this.store.workspaces().find((w) => w.id === priorWt.workspaceId);
          }
        }
        if (!createdWorktree) {
          ticket = this.save({
            ...ticket,
            provisioningStep: "step_1_worktree",
            updatedAt: new Date().toISOString(),
          });
          if (!parentWorkspace) {
            if (requestedIsolation === "worktree")
              throw new KodoError(
                "INVALID_INPUT",
                "该项目尚未绑定本地工作目录，无法创建隔离 Worktree。",
              );
            fallbackNote = "项目尚未绑定工作目录，已回退为无隔离目录模式。";
            ticket = this.save({
              ...ticket,
              mandate: { ...ticket.mandate, isolation: "shared" },
              fallbackNote,
              updatedAt: new Date().toISOString(),
            });
          } else {
            const wtRes = await this.service.worktrees.create(
              parentWorkspace,
              {
                slug: task.title ?? task.harnessId,
                ...(task.branchName ? { branchName: task.branchName } : {}),
                ...(task.baseRef ? { baseRef: task.baseRef } : {}),
              },
              {
                allowSharedFallback: requestedIsolation === "auto",
                onReserved: (worktree) => {
                  ticket = this.save({
                    ...ticket,
                    mandate: {
                      ...ticket.mandate,
                      allowedWorkspaceId: worktree.workspaceId,
                      worktreeBranch: worktree.branchName,
                    },
                  });
                },
              },
            );
            if (wtRes.kind === "worktree") {
              createdWorktree = wtRes.worktree;
              targetWorkspace = wtRes.workspace;
              ticket = this.save({
                ...ticket,
                mandate: {
                  ...ticket.mandate,
                  allowedWorkspaceId: wtRes.workspace.id,
                  worktreeBranch: wtRes.worktree.branchName,
                  isolation: "worktree",
                },
                updatedAt: new Date().toISOString(),
              });
            } else {
              fallbackNote = wtRes.reason;
              targetWorkspace = wtRes.workspace;
              ticket = this.save({
                ...ticket,
                mandate: {
                  ...ticket.mandate,
                  allowedWorkspaceId: wtRes.workspace.id,
                  worktreeBranch: null,
                  isolation: "shared",
                },
                fallbackNote,
                updatedAt: new Date().toISOString(),
              });
            }
          }
        }
      } else {
        ticket = this.save({
          ...ticket,
          mandate: {
            ...ticket.mandate,
            allowedWorkspaceId: targetWorkspace?.id ?? null,
            isolation: "shared",
          },
          updatedAt: new Date().toISOString(),
        });
      }

      // Step 2: Idempotent worker session creation (skipAutoWatch=true) or reuse
      const beforeOpen = this.revalidateMandate(ticket);
      if (!beforeOpen.ok) throw new KodoError("UNAUTHORIZED", beforeOpen.reason);
      ticket = this.save({
        ...ticket,
        provisioningStep: "step_2_session",
        updatedAt: new Date().toISOString(),
      });

      let worker: Session;
      if (task.workerSessionId) {
        worker = this.store.session(task.workerSessionId);
        this.service.requireGrant(this.store.session(controllerId), worker);
        const existingActive = this.findActiveByWorker(worker.id);
        if (existingActive && existingActive.id !== ticket.id)
          throw new KodoError(
            "CONFLICT",
            "该 Worker 会话已有进行中的委派工单，请先结束或交还后再重新委派。",
          );
        if (worker.workspaceId) {
          createdWorktree = this.service.worktrees.get(worker.workspaceId) ?? null;
          targetWorkspace = this.store.workspaces().find((w) => w.id === worker.workspaceId);
        }
      } else {
        worker = this.service.createManagedDraft(
          controllerId,
          stableRequestId(ticketId, "open"),
          {
            title: ticket.title,
            harnessId: task.harnessId,
            projectId,
            workspaceId: targetWorkspace?.id ?? null,
            executorId: task.executorId,
            ...(task.readOnly ? { permissionMode: "read-only" } : {}),
            ...(task.model ? { model: task.model } : {}),
            ...(task.reasoning ? { reasoning: task.reasoning } : {}),
            ...(task.executorId && task.executorId !== "local" ? { bindingId: null } : {}),
          },
          { skipAutoWatch: true },
        );
      }

      const valid = this.revalidateMandate(ticket);
      if (!valid.ok) throw new KodoError("UNAUTHORIZED", valid.reason);
      // Step 3: Activate authoritative Watch + link Goal + bind Ticket atomically
      ticket = this.save({
        ...ticket,
        workerSessionId: worker.id,
        provisioningStep: "step_3_watch",
        updatedAt: new Date().toISOString(),
      });

      const supportsSettled =
        this.service.harnessCapabilities(worker.harnessId)?.settled === "supported";
      const watch = this.store.transaction(() => {
        const w = this.service.watch(
          {
            controllerSessionId: controllerId,
            targetSessionId: worker.id,
            mode: "continue",
            goal: task.goal?.trim() || ticket.title,
            goalId: task.goalId ?? null,
            cursor: this.store.latestSequence(worker.id),
            continuous: true,
            trigger: supportsSettled ? "settled" : "turn-ended",
            limits: effectiveLimits,
          },
          "user",
        );
        ticket = this.save({
          ...ticket,
          workerSessionId: worker.id,
          watchId: w.id,
          provisioningStep: "step_4_send",
          updatedAt: new Date().toISOString(),
        });
        return w;
      });

      if (task.goalId) {
        const goal = this.service.goals.get(task.goalId);
        if (
          !goal.sessionIds.includes(worker.id) &&
          !["completed", "cancelled"].includes(goal.status)
        ) {
          await this.service.goals.update(
            goal.id,
            {
              requestId: stableRequestId(ticketId, "goal-link"),
              expectedRevision: goal.revision,
              addSessionIds: [worker.id],
              ...(targetWorkspace && !goal.workspaceIds.includes(targetWorkspace.id)
                ? { addWorkspaceIds: [targetWorkspace.id] }
                : {}),
            },
            "model",
            controllerId,
          );
        }
      }

      // Step 4: Idempotent prompt dispatch to worker
      const beforeSend = this.revalidateMandate(ticket);
      if (!beforeSend.ok) throw new KodoError("UNAUTHORIZED", beforeSend.reason);
      const promptParts = [task.task.trim()];
      if (createdWorktree?.linkedNodeModules) {
        promptParts.push(
          "\n[Host 环境提示] 当前 Worktree 的 node_modules 为只读共享链接（Junction）。如需增删依赖包，请先移除该软链后再独立安装，切勿直接运行覆盖主仓依赖的命令。",
        );
      }
      this.service.acceptSend(
        worker.id,
        {
          requestId: stableRequestId(ticketId, "send"),
          text: promptParts.join("\n"),
          mode: "queue",
        },
        controllerId,
      );

      ticket = this.save({
        ...ticket,
        status: "running",
        provisioningStep: "ready",
        updatedAt: new Date().toISOString(),
      });

      this.service.ingest(controllerId, "supervision", {
        action: "delegation-started",
        ticketId: ticket.id,
        batchId: ticket.batchId,
        workerSessionId: worker.id,
        harnessId: worker.harnessId,
        branchName: createdWorktree?.branchName ?? null,
        isolation: ticket.mandate.isolation,
      });

      return {
        ticket,
        session: this.store.session(worker.id),
        watch,
        worktree: createdWorktree,
        fallbackNote,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const current = this.get(ticket.id);
      if (current.status === "cancelled" || current.status === "blocked") throw error;
      if (ticket.watchId) this.service.changeWatch(ticket.watchId, "paused");
      this.save({
        ...ticket,
        status: "failed",
        lastError: message.slice(0, 1000),
        updatedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  onWatchChanged(watchId: string, state: "paused" | "revoked", reason?: string): void {
    const ticket = this.findByWatchId(watchId);
    if (!ticket || !["provisioning", "running", "awaiting-review"].includes(ticket.status)) return;
    const nextStatus: DelegationStatus = state === "paused" ? "blocked" : "cancelled";
    this.save({
      ...ticket,
      status: nextStatus,
      lastError: state === "paused" ? (reason ?? "托管已暂停（可能已由人工接管）。") : null,
      updatedAt: new Date().toISOString(),
    });
  }

  /** Resume a paused/blocked delegation ticket and return control back to the Kooyu supervisor. */
  handback(ticketId: string): { ticket: DelegationTicket; watch: Supervision } {
    const ticket = this.get(ticketId);
    if (!ticket.workerSessionId || !ticket.watchId)
      throw new KodoError("CONFLICT", "该工单尚未绑定 Worker 会话与托管关系。");
    if (ticket.status !== "blocked") throw new KodoError("CONFLICT", "仅可交还已暂停的工单。");
    const existingWatch = this.store.watches().find((w) => w.id === ticket.watchId);
    if (!existingWatch) throw new KodoError("NOT_FOUND", "关联托管关系不存在。");
    const controller = this.store.session(ticket.controllerSessionId);
    let grant: ProjectGrant | undefined;
    if (ticket.mandate.projectId && ticket.mandate.grantScope !== "worker") {
      const grantKey = `${controller.id}:${ticket.mandate.projectId}`;
      grant = this.store.record<ProjectGrant>("project-grant", grantKey);
      if (!grant || grant.revoked === true || grant.mode !== "create-and-control")
        throw new KodoError("UNAUTHORIZED", "项目托管授权已失效，无法交还主控。");
    } else {
      this.service.requireGrant(controller, this.store.session(ticket.workerSessionId));
    }

    const updated = this.store.transaction(() => {
      const resumed = this.service.watch(
        {
          controllerSessionId: existingWatch.controllerSessionId,
          targetSessionId: existingWatch.targetSessionId,
          mode: "continue",
          goal: existingWatch.goal ?? ticket.title,
          goalId: existingWatch.goalId ?? ticket.goalId ?? null,
          cursor: this.store.latestSequence(existingWatch.targetSessionId),
          continuous: existingWatch.continuous ?? true,
          trigger: existingWatch.trigger ?? "turn-ended",
          limits: existingWatch.limits ?? ticket.mandate.limits ?? {},
        },
        "user",
      );
      const nextTicket = this.save({
        ...ticket,
        watchId: resumed.id,
        status: "running",
        mandate: {
          ...ticket.mandate,
          projectGrantRevision: grant?.revision ?? ticket.mandate.projectGrantRevision,
          projectGrantGeneration: grant?.generation ?? ticket.mandate.projectGrantGeneration,
        },
        lastError: null,
        updatedAt: new Date().toISOString(),
      });
      return { ticket: nextTicket, watch: resumed };
    });
    this.service.ingest(ticket.controllerSessionId, "supervision", {
      action: "delegation-handback",
      ticketId: ticket.id,
      workerSessionId: ticket.workerSessionId,
    });
    return updated;
  }

  /** Escalate any standalone direct session into a Kooyu-managed delegation in one click. */
  escalateDirectSession(input: {
    workerSessionId: string;
    controllerSessionId?: string;
    goal?: string;
  }): { ticket: DelegationTicket; watch: Supervision; controller: Session } {
    const worker = this.store.session(input.workerSessionId);
    if (worker.kind !== "direct")
      throw new KodoError("INVALID_INPUT", "只能将独立执行会话交由 Kooyu 主控盯跑。");

    const existingActive = this.findActiveByWorker(worker.id);
    if (existingActive) {
      if (
        input.controllerSessionId &&
        existingActive.controllerSessionId !== input.controllerSessionId
      )
        throw new KodoError("CONFLICT", "该会话已由其他主控托管。");
      const watch = this.store.watches().find((w) => w.id === existingActive.watchId);
      if (!watch || watch.state !== "active")
        throw new KodoError("CONFLICT", "该会话已有关联工单，请从工单交还主控。");
      return {
        ticket: existingActive,
        watch,
        controller: this.store.session(existingActive.controllerSessionId),
      };
    }

    let controller: Session | undefined = input.controllerSessionId
      ? this.store.session(input.controllerSessionId)
      : (this.store
          .sessions()
          .find(
            (s) =>
              s.kind === "supervisor" &&
              !s.archived &&
              (worker.projectId ? s.projectId === worker.projectId : s.scope === "global"),
          ) ??
        this.store
          .sessions()
          .find((s) => s.kind === "supervisor" && !s.archived && s.scope === "global"));

    if (!controller) {
      controller = this.service.createDraft({
        title: worker.projectId ? "Kooyu 项目主控" : "Kooyu 全局主控",
        harnessId: "kodo",
        kind: "supervisor",
        projectId: worker.projectId,
        workspaceId: worker.workspaceId,
      });
    }
    if (controller.kind !== "supervisor")
      throw new KodoError("INVALID_INPUT", "目标控制者必须是 Kooyu 主对话。");
    if (controller.projectId && controller.projectId !== worker.projectId)
      throw new KodoError("UNAUTHORIZED", "所选项目主控与当前会话不属于同一项目。");

    const projectId = worker.projectId ?? "";
    const wt = worker.workspaceId ? this.service.worktrees.get(worker.workspaceId) : undefined;
    const goalText = input.goal?.trim() || `盯跑并完成：${worker.title}`;
    const now = new Date().toISOString();

    const { ticket, watch } = this.store.transaction(() => {
      const w = this.service.watch(
        {
          controllerSessionId: controller!.id,
          targetSessionId: worker.id,
          mode: "continue",
          goal: goalText,
          cursor: this.store.latestSequence(worker.id),
          continuous: true,
        },
        "user",
      );
      const t = this.save({
        id: stableRequestId(`${controller!.id}:escalate`, `${worker.id}:${w.generation}`),
        batchId: null,
        controllerSessionId: controller!.id,
        workerSessionId: worker.id,
        watchId: w.id,
        goalId: null,
        title: worker.title,
        harnessId: worker.harnessId,
        status: "running",
        waitPolicy: "all",
        mandate: {
          initiator: "user",
          projectId,
          allowedWorkspaceId: worker.workspaceId,
          worktreeBranch: wt?.branchName ?? null,
          isolation: wt ? "worktree" : "shared",
          allowedOperations: ["harness.send", "harness.watch", "workspace.read"],
          grantScope: "worker",
          projectGrantRevision: 1,
          projectGrantGeneration: 1,
          limits: w.limits ?? {},
        },
        provisioningStep: "ready",
        report: null,
        fallbackNote: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      });
      return { ticket: t, watch: w };
    });

    this.service.ingest(controller.id, "supervision", {
      action: "delegation-escalated",
      ticketId: ticket.id,
      workerSessionId: worker.id,
    });
    return { ticket, watch, controller };
  }

  onProjectDeleted(projectId: string): void {
    const now = new Date().toISOString();
    for (const ticket of this.list({ activeOnly: true })) {
      if (ticket.mandate.projectId === projectId) {
        this.save({
          ...ticket,
          status: "cancelled",
          lastError: "所属项目已删除。",
          updatedAt: now,
        });
      }
    }
  }
}
