import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import {
  completeGoalSchema,
  createGoalSchema,
  KodoError,
  recordVerificationSchema,
  reviewGoalSchema,
  runCheckSchema,
  updateGoalSchema,
  type Goal,
  type GoalHistoryEntry,
  type GoalStatus,
  type Session,
  type Verification,
  type Artifact,
  type VerificationStatus,
  type Workspace,
} from "@kodo/protocol";
import type { SessionService } from "../session-service.js";
import type { NotificationService } from "../notifications/service.js";
import {
  captureBaseline,
  compareBaseline,
  containedPath,
  fileSha256,
  runCheck,
} from "./workspace.js";

export type GoalActor = "user" | "model";
const CLOSED: GoalStatus[] = ["completed", "cancelled"];
const unique = <T>(values: T[]) => [...new Set(values)];

/**
 * Goals record what a main conversation is trying to deliver, which sessions work
 * on it, and the facts that justify calling it done. The Host stores facts; it does
 * not decide completion from keywords, and a model report alone is never "passed".
 */
export class GoalService {
  private pending = new Map<string, { fingerprint: string; value: Promise<unknown> }>();
  constructor(
    private readonly sessions: SessionService,
    private readonly notifications: NotificationService,
  ) {}
  private get store() {
    return this.sessions.store;
  }

  // ---------- reads ----------
  list(
    filter: { controllerSessionId?: string; sessionId?: string; includeClosed?: boolean } = {},
  ): Goal[] {
    const rows = this.store.db
      .prepare(
        `SELECT data FROM goals ${filter.controllerSessionId ? "WHERE controller_session_id=?" : ""} ORDER BY updated_at DESC, id`,
      )
      .all(...(filter.controllerSessionId ? [filter.controllerSessionId] : []));
    return rows
      .map((r) => JSON.parse(String(r.data)) as Goal)
      .filter(
        (g) =>
          !this.store.record("deleted-session", g.controllerSessionId) &&
          (filter.includeClosed || !CLOSED.includes(g.status)) &&
          (!filter.sessionId ||
            g.sessionIds.includes(filter.sessionId) ||
            g.controllerSessionId === filter.sessionId),
      );
  }
  get(id: string): Goal {
    const row = this.store.db.prepare("SELECT data FROM goals WHERE id=?").get(id);
    if (!row) throw new KodoError("NOT_FOUND", "目标不存在。");
    return JSON.parse(String(row.data)) as Goal;
  }
  verifications(goalId: string): Verification[] {
    return this.store.db
      .prepare("SELECT data FROM verifications WHERE goal_id=? ORDER BY created_at, rowid")
      .all(goalId)
      .map((r) => JSON.parse(String(r.data)) as Verification);
  }
  history(goalId: string): GoalHistoryEntry[] {
    return this.store.db
      .prepare("SELECT data FROM goal_history WHERE goal_id=? ORDER BY revision")
      .all(goalId)
      .map((r) => JSON.parse(String(r.data)) as GoalHistoryEntry);
  }
  /** Full record for a detail view or a model read: goal, checks and state history. */
  detail(id: string) {
    return { goal: this.get(id), verifications: this.verifications(id), history: this.history(id) };
  }

  // ---------- idempotency ----------
  private receipt(scope: string, requestId: string) {
    return `${scope}:${requestId}`;
  }
  private prior<T>(key: string, fingerprint: string): T | undefined {
    const prior = this.store.record<{ fingerprint: string; value: T }>("goal-request", key);
    if (prior && prior.fingerprint !== fingerprint)
      throw new KodoError("CONFLICT", "请求 ID 已用于不同的目标操作。");
    return prior?.value;
  }
  /** Run once per request ID; concurrent duplicates share the same in-flight work. */
  private async once<T>(
    key: string,
    input: unknown,
    run: (fingerprint: string) => Promise<T>,
  ): Promise<T> {
    const fingerprint = JSON.stringify(input);
    const prior = this.prior<T>(key, fingerprint);
    if (prior !== undefined) return prior;
    const pending = this.pending.get(key);
    if (pending) {
      if (pending.fingerprint !== fingerprint)
        throw new KodoError("CONFLICT", "请求 ID 已用于不同的目标操作。");
      return pending.value as Promise<T>;
    }
    const value = run(fingerprint);
    this.pending.set(key, { fingerprint, value });
    try {
      return await value;
    } finally {
      this.pending.delete(key);
    }
  }

  // ---------- scope ----------
  private controller(id: string): Session {
    const session = this.store.session(id);
    if (session.kind !== "supervisor" || this.store.record("deleted-session", id))
      throw new KodoError("INVALID_INPUT", "目标只能由 Kooyu 主对话持有。");
    return session;
  }
  private checkSession(controller: Session, id: string, actor: GoalActor): Session {
    if (this.store.record("deleted-session", id)) throw new KodoError("NOT_FOUND", "会话不存在。");
    const session = this.store.session(id);
    if (session.id === controller.id)
      throw new KodoError("INVALID_INPUT", "主对话本身不作为目标的执行会话。");
    if (controller.projectId && session.projectId !== controller.projectId)
      throw new KodoError("UNAUTHORIZED", "会话超出项目主对话的范围。");
    if (actor === "model") this.sessions.requireGrant(controller, session);
    return session;
  }
  private checkWorkspace(
    controller: Session,
    id: string,
    sessionIds: string[],
    actor: GoalActor,
  ): Workspace {
    const workspace = this.store.workspaces().find((w) => w.id === id);
    if (!workspace) throw new KodoError("NOT_FOUND", "工作区不存在。");
    if (controller.projectId && workspace.projectId !== controller.projectId)
      throw new KodoError("UNAUTHORIZED", "工作区超出项目主对话的范围。");
    const grant = this.store.record<{ projects: string[] }>("grant", controller.id);
    const allowed =
      workspace.id === controller.workspaceId ||
      sessionIds.some((s) => this.store.session(s).workspaceId === workspace.id) ||
      (workspace.projectId !== null &&
        (workspace.projectId === controller.projectId ||
          Boolean(grant?.projects.includes(workspace.projectId)))) ||
      (actor === "user" && !controller.projectId);
    if (!allowed) throw new KodoError("UNAUTHORIZED", "工作区不在用户授权的范围内。");
    return workspace;
  }
  /** Model access is limited to goals owned by the same main conversation. */
  owned(goalId: string, controllerId: string): Goal {
    const goal = this.get(goalId);
    if (goal.controllerSessionId !== controllerId)
      throw new KodoError("UNAUTHORIZED", "该目标属于另一个主对话。");
    return goal;
  }

  // ---------- persistence ----------
  private derive(goal: Goal): VerificationStatus {
    if (goal.verificationStatus === "not-applicable") return "not-applicable";
    // Only Host-executed or user-recorded checks for the current scope count.
    const facts = this.verifications(goal.id).filter(
      (v) =>
        v.scopeRevision === goal.scopeRevision &&
        v.recordedBy !== "model" &&
        v.outcome !== "inconclusive",
    );
    const latest = new Map<string, Verification>();
    for (const v of facts) latest.set(`${v.kind}:${v.method}`, v);
    const values = [...latest.values()];
    if (values.some((v) => v.outcome === "failed")) return "failed";
    if (values.some((v) => v.outcome === "passed")) return "passed";
    return "unverified";
  }
  private save(
    next: Goal,
    actor: GoalHistoryEntry["actor"],
    change: string,
    previous?: Goal,
  ): Goal {
    next.verificationStatus = this.derive(next);
    next.updatedAt = new Date().toISOString();
    if (previous) {
      const result = this.store.db
        .prepare(
          "UPDATE goals SET status=?,revision=?,updated_at=?,data=? WHERE id=? AND revision=?",
        )
        .run(
          next.status,
          next.revision,
          next.updatedAt,
          JSON.stringify(next),
          next.id,
          previous.revision,
        );
      if (!result.changes) throw new KodoError("CONFLICT", "目标已被修改，请刷新后重试。");
    } else
      this.store.db
        .prepare(
          "INSERT INTO goals(id,controller_session_id,status,revision,updated_at,data) VALUES (?,?,?,?,?,?)",
        )
        .run(
          next.id,
          next.controllerSessionId,
          next.status,
          next.revision,
          next.updatedAt,
          JSON.stringify(next),
        );
    const entry: GoalHistoryEntry = {
      goalId: next.id,
      revision: next.revision,
      status: next.status,
      verificationStatus: next.verificationStatus,
      actor,
      change,
      at: next.updatedAt,
    };
    this.store.db
      .prepare("INSERT INTO goal_history VALUES (?,?,?)")
      .run(next.id, next.revision, JSON.stringify(entry));
    this.sessions.ingest(
      next.controllerSessionId,
      "supervision",
      {
        action: "goal",
        goalId: next.id,
        title: next.title,
        revision: next.revision,
        status: next.status,
        verificationStatus: next.verificationStatus,
        change,
      },
      `goal:${next.id}:${next.revision}`,
    );
    this.announce(next, previous);
    return next;
  }
  private announce(goal: Goal, previous?: Goal) {
    if (previous?.status === goal.status && previous.blockedReason === goal.blockedReason) return;
    const kind =
      goal.status === "blocked"
        ? "goal-blocked"
        : goal.status === "awaiting-review"
          ? "goal-awaiting-review"
          : goal.status === "completed"
            ? "goal-completed"
            : null;
    if (!kind) return;
    this.notifications.publish({
      id: `goal:${goal.id}:${goal.revision}:${kind}`,
      kind,
      preview: goal.status === "blocked" ? `${goal.title}：${goal.blockedReason}` : goal.title,
      sessionId: goal.controllerSessionId,
      goalId: goal.id,
    });
  }

  /** Prepare filesystem evidence outside SQLite, then commit with an Activation and command. */
  async prepareScheduled(controllerId: string, title: string, description: string): Promise<Goal> {
    const controller = this.controller(controllerId);
    const workspace = this.store.workspaces().find((w) => w.id === controller.workspaceId);
    const now = new Date().toISOString();
    return {
      id: randomUUID(),
      projectId: controller.projectId,
      controllerSessionId: controllerId,
      revision: 1,
      scopeRevision: 1,
      title,
      description,
      acceptanceCriteria: ["按保存的计划交付成果并记录来源与验证"],
      workspaceIds: workspace ? [workspace.id] : [],
      sessionIds: [],
      status: "active",
      blockedReason: null,
      verificationStatus: "unverified",
      artifactIds: [],
      verificationIds: [],
      baselines: workspace?.hostId === this.store.hostId ? [await captureBaseline(workspace)] : [],
      result: null,
      acceptedBy: null,
      notes: [{ at: now, actor: "host", text: "由用户预先授权的计划创建。" }],
      createdAt: now,
      updatedAt: now,
    };
  }
  commitScheduled(goal: Goal): Goal {
    if (!this.store.db.isTransaction)
      throw new Error("Scheduled goal requires an atomic activation transaction");
    return this.save(goal, "host", "automation-created");
  }

  // ---------- mutations ----------
  async create(value: unknown, actor: GoalActor): Promise<Goal> {
    const input = createGoalSchema.parse(value);
    const key = this.receipt(`create:${input.controllerSessionId}`, input.requestId);
    return this.once(key, input, async (fingerprint) => {
      const controller = this.controller(input.controllerSessionId);
      const sessionIds = unique(input.sessionIds);
      for (const id of sessionIds) this.checkSession(controller, id, actor);
      const workspaces = unique([
        ...input.workspaceIds,
        ...(controller.workspaceId ? [controller.workspaceId] : []),
      ]).map((id) => this.checkWorkspace(controller, id, sessionIds, actor));
      const baselines = await Promise.all(
        workspaces.filter((w) => w.hostId === this.store.hostId).map((w) => captureBaseline(w)),
      );
      return this.store.transaction(() => {
        const replay = this.prior<Goal>(key, fingerprint);
        if (replay) return replay;
        const now = new Date().toISOString();
        const goal = this.save(
          {
            id: randomUUID(),
            projectId: controller.projectId,
            controllerSessionId: controller.id,
            revision: 1,
            scopeRevision: 1,
            title: input.title,
            description: input.description,
            acceptanceCriteria: input.acceptanceCriteria,
            workspaceIds: workspaces.map((w) => w.id),
            sessionIds,
            status: input.status,
            blockedReason: null,
            verificationStatus: "unverified",
            artifactIds: [],
            verificationIds: [],
            baselines,
            result: null,
            acceptedBy: null,
            notes: [],
            createdAt: now,
            updatedAt: now,
          },
          actor,
          "created",
        );
        this.store.put("goal-request", key, { fingerprint, value: goal });
        return goal;
      });
    });
  }

  async update(id: string, value: unknown, actor: GoalActor, controllerId?: string): Promise<Goal> {
    const input = updateGoalSchema.parse(value);
    const key = this.receipt(`update:${id}`, input.requestId);
    return this.once(key, input, async (fingerprint) => {
      const current = controllerId ? this.owned(id, controllerId) : this.get(id);
      if (CLOSED.includes(current.status))
        throw new KodoError("CONFLICT", "目标已结束，不能再修改；需要继续时请创建新目标。");
      if (current.revision !== input.expectedRevision)
        throw new KodoError("CONFLICT", "目标已被修改，请读取最新版本后重试。");
      const controller = this.controller(current.controllerSessionId);
      const addSessions = unique(input.addSessionIds ?? []).filter(
        (s) => !current.sessionIds.includes(s),
      );
      for (const s of addSessions) this.checkSession(controller, s, actor);
      const sessionIds = [...current.sessionIds, ...addSessions];
      const addWorkspaces = unique(input.addWorkspaceIds ?? [])
        .filter((w) => !current.workspaceIds.includes(w))
        .map((w) => this.checkWorkspace(controller, w, sessionIds, actor));
      const baselines = await Promise.all(
        addWorkspaces.filter((w) => w.hostId === this.store.hostId).map((w) => captureBaseline(w)),
      );
      return this.store.transaction(() => {
        const replay = this.prior<Goal>(key, fingerprint);
        if (replay) return replay;
        const latest = this.get(id);
        if (latest.revision !== current.revision)
          throw new KodoError("CONFLICT", "目标已被修改，请读取最新版本后重试。");
        const scopeChanged =
          (input.description !== undefined && input.description !== latest.description) ||
          (input.acceptanceCriteria !== undefined &&
            JSON.stringify(input.acceptanceCriteria) !== JSON.stringify(latest.acceptanceCriteria));
        const status =
          input.status ??
          (latest.status === "blocked" && input.blockedReason === null ? "active" : latest.status);
        const changes: string[] = [];
        if (input.title !== undefined && input.title !== latest.title) changes.push("title");
        if (scopeChanged) changes.push("scope");
        if (status !== latest.status) changes.push(`status:${status}`);
        if (addSessions.length) changes.push(`sessions+${addSessions.length}`);
        if (addWorkspaces.length) changes.push(`workspaces+${addWorkspaces.length}`);
        if (input.note) changes.push("note");
        const next: Goal = {
          ...latest,
          revision: latest.revision + 1,
          scopeRevision: latest.scopeRevision + (scopeChanged ? 1 : 0),
          title: input.title ?? latest.title,
          description: input.description ?? latest.description,
          acceptanceCriteria: input.acceptanceCriteria ?? latest.acceptanceCriteria,
          status,
          blockedReason:
            status === "blocked" ? (input.blockedReason ?? latest.blockedReason) : null,
          sessionIds,
          workspaceIds: [...latest.workspaceIds, ...addWorkspaces.map((w) => w.id)],
          baselines: [...latest.baselines, ...baselines],
          // A scope change or resumed work invalidates an earlier submission.
          result: status === "awaiting-review" && !scopeChanged ? latest.result : null,
          verificationStatus:
            scopeChanged && latest.verificationStatus === "not-applicable"
              ? "unverified"
              : latest.verificationStatus,
          notes: input.note
            ? [...latest.notes, { at: new Date().toISOString(), actor, text: input.note }]
            : latest.notes,
        };
        if (status === "awaiting-review" && scopeChanged) next.status = "active";
        const saved = this.save(next, actor, changes.join(",") || "unchanged", latest);
        this.store.put("goal-request", key, { fingerprint, value: saved });
        return saved;
      });
    });
  }

  /** Attestations (review, source check) are kept but never make a goal "passed". */
  recordVerification(
    id: string,
    value: unknown,
    actor: GoalActor,
    controllerId?: string,
  ): Promise<Verification> {
    const input = recordVerificationSchema.parse(value);
    const key = this.receipt(`verify:${id}`, input.requestId);
    return this.once(key, input, async (fingerprint) => {
      const goal = controllerId ? this.owned(id, controllerId) : this.get(id);
      if (CLOSED.includes(goal.status)) throw new KodoError("CONFLICT", "目标已结束。");
      return this.store.transaction(() => {
        const replay = this.prior<Verification>(key, fingerprint);
        if (replay) return replay;
        const latest = this.get(id);
        const verification: Verification = {
          id: randomUUID(),
          goalId: id,
          goalRevision: latest.revision,
          scopeRevision: latest.scopeRevision,
          kind: input.kind,
          method: input.method,
          location: null,
          exitCode: null,
          outcome: input.outcome,
          recordedBy: actor,
          evidence: input.evidence,
          durationMs: null,
          createdAt: new Date().toISOString(),
        };
        this.insertVerification(latest, verification, actor);
        this.store.put("goal-request", key, { fingerprint, value: verification });
        return verification;
      });
    });
  }
  /** Record a published artifact on its goal; called inside the publishing transaction. */
  attachArtifact(goalId: string, artifact: Artifact, actor: GoalActor) {
    const goal = this.get(goalId);
    if (CLOSED.includes(goal.status)) throw new KodoError("CONFLICT", "目标已结束。");
    this.save(
      { ...goal, revision: goal.revision + 1, artifactIds: [...goal.artifactIds, artifact.id] },
      actor,
      `artifact:${artifact.displayName}@v${artifact.version}`,
      goal,
    );
  }
  private insertVerification(goal: Goal, verification: Verification, actor: GoalActor) {
    this.store.db
      .prepare("INSERT INTO verifications VALUES (?,?,?,?)")
      .run(verification.id, goal.id, verification.createdAt, JSON.stringify(verification));
    this.save(
      {
        ...goal,
        revision: goal.revision + 1,
        verificationIds: [...goal.verificationIds, verification.id],
      },
      verification.recordedBy === "host" ? "host" : actor,
      `verification:${verification.outcome}:${verification.recordedBy}`,
      goal,
    );
  }

  /**
   * Execute a check in one of the goal's workspaces and store the real exit status.
   * A crash mid-run leaves the receipt "running": the retry reports unknown instead
   * of executing a possibly side-effecting command twice.
   */
  async runCheck(id: string, value: unknown, actor: GoalActor, controllerId?: string) {
    const release = this.sessions.lifecycle.enter();
    try {
      return await this.runCheckInside(id, value, actor, controllerId);
    } finally {
      release();
    }
  }
  private runCheckInside(id: string, value: unknown, actor: GoalActor, controllerId?: string) {
    const input = runCheckSchema.parse(value);
    const key = this.receipt(`check:${id}`, input.requestId);
    return this.once(key, input, async (fingerprint) => {
      const running = this.store.record<{ fingerprint: string; state: string }>(
        "goal-check-intent",
        key,
      );
      if (running) {
        if (running.fingerprint !== fingerprint)
          throw new KodoError("CONFLICT", "请求 ID 已用于不同的检查。");
        throw new KodoError(
          "CONFLICT",
          "该检查此前已开始执行但结果未落盘（结果未知）；未自动重跑，请用新的请求重新检查。",
        );
      }
      const goal = controllerId ? this.owned(id, controllerId) : this.get(id);
      if (CLOSED.includes(goal.status)) throw new KodoError("CONFLICT", "目标已结束。");
      const workspaceId = input.workspaceId ?? goal.workspaceIds[0];
      if (!workspaceId || !goal.workspaceIds.includes(workspaceId))
        throw new KodoError(
          "INVALID_INPUT",
          "检查需要目标关联的工作区；当前目标没有可执行检查的位置。",
        );
      const workspace = this.store.workspaces().find((w) => w.id === workspaceId);
      if (!workspace || workspace.hostId !== this.store.hostId)
        throw new KodoError("UNAVAILABLE", "该工作区不在当前 Host 上，未执行检查。");
      this.store.put("goal-check-intent", key, { fingerprint, state: "running" });
      const result = await runCheck(input.command, workspace.rootPath, input.timeoutSeconds * 1000);
      const fileHashes: { path: string; sha256: string | null }[] = [];
      for (const path of input.hashFiles) {
        const real = containedPath(workspace.rootPath, path);
        fileHashes.push({ path, sha256: real ? await fileSha256(real) : null });
      }
      return this.store.transaction(() => {
        const latest = this.get(id);
        const evidence = [
          result.error
            ? `启动失败：${result.error}`
            : `退出码：${result.exitCode ?? "无（超时或被终止）"}`,
          result.timedOut ? `超时：${input.timeoutSeconds}s 后终止。` : "",
          result.stdout ? `--- stdout（末尾） ---\n${result.stdout}` : "",
          result.stderr ? `--- stderr（末尾） ---\n${result.stderr}` : "",
        ]
          .filter(Boolean)
          .join("\n");
        const verification: Verification = {
          id: randomUUID(),
          goalId: id,
          goalRevision: latest.revision,
          scopeRevision: latest.scopeRevision,
          kind: input.kind,
          method: input.command,
          location: `${hostname()}:${workspace.rootPath}`,
          exitCode: result.exitCode,
          outcome:
            result.exitCode === 0 ? "passed" : result.exitCode === null ? "inconclusive" : "failed",
          recordedBy: "host",
          evidence: this.redact(evidence),
          durationMs: result.durationMs,
          timedOut: result.timedOut,
          ...(fileHashes.length ? { fileHashes } : {}),
          createdAt: new Date().toISOString(),
        };
        this.insertVerification(latest, verification, actor);
        this.store.put("goal-request", key, { fingerprint, value: verification });
        this.store.remove("goal-check-intent", key);
        return verification;
      });
    });
  }
  private redact(text: string) {
    return text.replace(/(?:sk-|Bearer\s+)[A-Za-z0-9_\-.]{8,}/g, "[redacted]");
  }

  /** The model submits a result; the goal waits for the user. It never self-completes. */
  complete(id: string, value: unknown, actor: GoalActor, controllerId?: string): Promise<Goal> {
    const input = completeGoalSchema.parse(value);
    const key = this.receipt(`complete:${id}`, input.requestId);
    return this.once(key, input, async (fingerprint) => {
      const current = controllerId ? this.owned(id, controllerId) : this.get(id);
      if (CLOSED.includes(current.status)) throw new KodoError("CONFLICT", "目标已结束。");
      if (current.revision !== input.expectedRevision)
        throw new KodoError("CONFLICT", "目标已被修改，请读取最新版本后重试。");
      const changes = await Promise.all(current.baselines.map((b) => compareBaseline(b)));
      return this.store.transaction(() => {
        const replay = this.prior<Goal>(key, fingerprint);
        if (replay) return replay;
        const latest = this.get(id);
        if (latest.revision !== current.revision)
          throw new KodoError("CONFLICT", "目标已被修改，请读取最新版本后重试。");
        const saved = this.save(
          {
            ...latest,
            revision: latest.revision + 1,
            status: "awaiting-review",
            blockedReason: null,
            result: {
              summary: input.summary,
              deliverables: input.deliverables,
              limitations: input.limitations,
              reportedAt: new Date().toISOString(),
              reportedBy: actor,
              changes,
            },
          },
          actor,
          "submitted-for-review",
          latest,
        );
        this.store.put("goal-request", key, { fingerprint, value: saved });
        return saved;
      });
    });
  }

  /** User decisions: accept (even unverified, recorded as such), send back, or cancel. */
  review(id: string, value: unknown): Promise<Goal> {
    const input = reviewGoalSchema.parse(value);
    const key = this.receipt(`review:${id}`, input.requestId);
    return this.once(key, input, async (fingerprint) => {
      const current = this.get(id);
      if (CLOSED.includes(current.status)) throw new KodoError("CONFLICT", "目标已结束。");
      if (current.revision !== input.expectedRevision)
        throw new KodoError("CONFLICT", "目标已被修改，请刷新后重试。");
      if (input.decision === "request-changes" && current.status !== "awaiting-review")
        throw new KodoError("CONFLICT", "只有待验收的目标可以要求修改。");
      const saved = this.store.transaction(() => {
        const replay = this.prior<Goal>(key, fingerprint);
        if (replay) return replay;
        const latest = this.get(id);
        if (latest.revision !== current.revision)
          throw new KodoError("CONFLICT", "目标已被修改，请刷新后重试。");
        const now = new Date().toISOString();
        const notes = input.note
          ? [...latest.notes, { at: now, actor: "user" as const, text: input.note }]
          : latest.notes;
        let next: Goal = { ...latest, revision: latest.revision + 1, notes };
        if (input.decision === "accept")
          next = {
            ...next,
            status: "completed",
            blockedReason: null,
            acceptedBy: {
              actor: "user",
              at: now,
              verificationStatus: this.derive(latest),
              remainingUncertainty: input.remainingUncertainty ?? null,
            },
          };
        else if (input.decision === "request-changes")
          next = { ...next, status: "active", result: null };
        else if (input.decision === "not-applicable")
          next = { ...next, verificationStatus: "not-applicable" };
        else {
          next = { ...next, status: "cancelled", blockedReason: null };
          // Freeze automatic dispatch toward this goal before any native cancel.
          for (const w of this.store.watches())
            if (
              w.state === "active" &&
              w.controllerSessionId === latest.controllerSessionId &&
              (w.goalId === latest.id ||
                (!w.goalId && latest.sessionIds.includes(w.targetSessionId)))
            )
              this.sessions.changeWatch(w.id, "paused");
        }
        const result = this.save(next, "user", `review:${input.decision}`, latest);
        this.store.put("goal-request", key, { fingerprint, value: result });
        return result;
      });
      if (input.decision === "cancel" && input.stopSessions) {
        const outcomes: string[] = [];
        for (const sessionId of saved.sessionIds) {
          const session = this.store.session(sessionId);
          if (session.runState === "idle") continue;
          const stop = await this.sessions
            .stop(sessionId, true, deterministicId(`goal-cancel:${saved.id}:${sessionId}`))
            .catch((error: unknown) => ({
              status: "unknown",
              cancel: error instanceof Error ? error.message : String(error),
            }));
          outcomes.push(`${session.title}: ${stop.cancel}`);
        }
        if (outcomes.length) {
          const latest = this.get(id);
          return this.store.transaction(() =>
            this.save(
              {
                ...latest,
                revision: latest.revision + 1,
                notes: [
                  ...latest.notes,
                  {
                    at: new Date().toISOString(),
                    actor: "host",
                    text: `取消目标时请求停止关联会话（结果以原生事件为准）：${outcomes.join("；")}`,
                  },
                ],
              },
              "host",
              "stop-requested",
              latest,
            ),
          );
        }
      }
      return saved;
    });
  }

  /** Text injected into wake messages so the controller judges the right goal. */
  wakeContext(goalId: string | null | undefined) {
    if (!goalId) return null;
    try {
      const goal = this.get(goalId);
      return {
        id: goal.id,
        revision: goal.revision,
        title: goal.title,
        status: goal.status,
        acceptanceCriteria: goal.acceptanceCriteria,
        verificationStatus: goal.verificationStatus,
      };
    } catch {
      return null;
    }
  }
}

function deterministicId(value: string): string {
  const h = createHash("sha256").update(value).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
