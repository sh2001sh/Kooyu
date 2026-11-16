import { randomUUID } from "node:crypto";
import { z } from "zod";
import { KodoError, type AuthorizationGrant } from "@kodo/protocol";
import type { Store } from "../storage/store.js";
import { DomainTable } from "../storage/self-hosted.js";
import { digest } from "../execution/actions.js";
const schema = z
  .object({
    requestId: z.string().uuid(),
    controllerSessionId: z.string().uuid(),
    connectionId: z.string().uuid().nullable().default(null),
    applicationId: z.string().max(100).nullable().default(null),
    applicationVersion: z.string().max(100).nullable().default(null),
    goalId: z.string().uuid().nullable().default(null),
    operations: z.array(z.string().min(1).max(100)).min(1).max(50),
    resources: z.array(z.string().min(1).max(1000)).min(1).max(100),
    expiresAt: z.string().datetime({ offset: true }).nullable().default(null),
  })
  .strict();
export class PermissionService {
  readonly grants: DomainTable<AuthorizationGrant>;
  constructor(private readonly store: Store) {
    this.grants = new DomainTable(store, "authorization_grants");
  }
  create(value: unknown): AuthorizationGrant {
    const p = schema.parse(value),
      fingerprint = digest(p);
    return this.store.transaction(() => {
      const prior = this.store.record<{ fingerprint: string; id: string }>(
        "grant-request",
        p.requestId,
      );
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          throw new KodoError("CONFLICT", "授权请求 ID 冲突。");
        return this.grants.get(prior.id);
      }
      const controller = this.store.session(p.controllerSessionId);
      if (controller.kind !== "supervisor")
        throw new KodoError("INVALID_INPUT", "请选择 Kooyu 主对话。");
      if (p.expiresAt && Date.parse(p.expiresAt) <= Date.now())
        throw new KodoError("INVALID_INPUT", "授权已过期。");
      if (p.goalId) {
        const row = this.store.db
          .prepare("SELECT controller_session_id FROM goals WHERE id=?")
          .get(p.goalId);
        if (row?.controller_session_id !== controller.id)
          throw new KodoError("UNAUTHORIZED", "目标不属于该主对话。");
      }
      const g: AuthorizationGrant = {
        id: randomUUID(),
        actor: "user",
        connectionId: p.connectionId,
        applicationId: p.applicationId,
        applicationVersion: p.applicationVersion,
        controllerSessionId: controller.id,
        projectId: controller.projectId,
        goalId: p.goalId,
        operations: [...new Set(p.operations)],
        resources: [...new Set(p.resources)],
        expiresAt: p.expiresAt,
        revision: 1,
        generation: 1,
        revoked: false,
        createdAt: new Date().toISOString(),
      };
      this.grants.put(g);
      this.store.put("grant-request", p.requestId, { fingerprint, id: g.id });
      return g;
    });
  }
  require(
    id: string,
    scope: {
      controllerSessionId: string;
      operation: string;
      resource: string;
      revision?: number;
      connectionId?: string;
      applicationVersion?: string;
      goalId?: string | null;
    },
  ): AuthorizationGrant {
    const g = this.grants.get(id);
    if (
      g.revoked ||
      (g.expiresAt && Date.parse(g.expiresAt) <= Date.now()) ||
      g.controllerSessionId !== scope.controllerSessionId ||
      (scope.revision !== undefined && g.revision !== scope.revision) ||
      (scope.connectionId !== undefined && g.connectionId !== scope.connectionId) ||
      (scope.applicationVersion !== undefined &&
        g.applicationVersion !== scope.applicationVersion) ||
      (g.goalId && g.goalId !== scope.goalId) ||
      !g.operations.includes(scope.operation) ||
      !g.resources.includes(scope.resource)
    )
      throw new KodoError("UNAUTHORIZED", "授权已失效或操作超出已授予范围。");
    if (g.goalId) {
      const row = this.store.db.prepare("SELECT status FROM goals WHERE id=?").get(g.goalId);
      if (!row || ["cancelled", "completed"].includes(String(row.status)))
        throw new KodoError("UNAUTHORIZED", "授权目标已结束。");
    }
    return g;
  }
  revoke(id: string, expectedRevision: number) {
    return this.store.transaction(() => {
      const g = this.grants.get(id);
      if (g.revision !== expectedRevision) throw new KodoError("CONFLICT", "授权已修改。");
      return this.grants.put({
        ...g,
        revoked: true,
        revision: g.revision + 1,
        generation: g.generation + 1,
      });
    });
  }
}
