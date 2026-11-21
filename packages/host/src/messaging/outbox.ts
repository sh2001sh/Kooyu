import { randomUUID } from "node:crypto";
import { z } from "zod";
import { KodoError } from "@kodo/protocol";
import type { SessionService } from "../session-service.js";
import { DomainTable } from "../storage/self-hosted.js";
import { digest } from "../execution/actions.js";
export interface OutboundMessage {
  id: string;
  goalId: string;
  controllerSessionId: string;
  connectionId: string;
  grantId: string;
  resource: string;
  operation: string;
  arguments: Record<string, unknown>;
  status: "pending" | "sending" | "sent" | "unknown" | "withdrawn";
  fingerprint: string;
  createdAt: string;
  result?: unknown;
  questionId?: string;
  questionRevision?: number;
}
export class Outbox {
  readonly messages: DomainTable<OutboundMessage>;
  private scanning = false;
  constructor(private readonly service: SessionService) {
    this.messages = new DomainTable(service.store, "outbound_messages");
    for (const m of this.messages.all())
      if (m.status === "sending") this.messages.put({ ...m, status: "unknown" });
  }
  enqueue(value: unknown, controllerId: string) {
    const p = z
      .object({
        requestId: z.string().uuid(),
        goalId: z.string().uuid(),
        connectionId: z.string().uuid(),
        grantId: z.string().uuid(),
        resource: z.string().min(1).max(1000),
        operation: z.enum([
          "github.comments.create",
          "github.issues.create",
          "slack.messages.create",
          "telegram.messages.create",
          "wecom.messages.create",
          "feishu.messages.create",
          "weixin.messages.create",
        ]),
        arguments: z.record(z.string(), z.unknown()),
        questionId: z.string().optional(),
        questionRevision: z.number().int().positive().optional(),
      })
      .strict()
      .parse(value);
    const goal = this.service.goals.owned(p.goalId, controllerId);
    if (["completed", "cancelled"].includes(goal.status))
      throw new KodoError("CONFLICT", "目标已结束。");
    this.service.permissions.require(p.grantId, {
      controllerSessionId: controllerId,
      operation: p.operation,
      resource: p.resource,
      connectionId: p.connectionId,
      goalId: p.goalId,
    });
    const fingerprint = digest(p),
      previous = this.messages.find(p.requestId);
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new KodoError("CONFLICT", "业务回复 ID 冲突。");
      return previous;
    }
    return this.service.store.transaction(() =>
      this.messages.put({
        id: p.requestId,
        goalId: p.goalId,
        controllerSessionId: controllerId,
        connectionId: p.connectionId,
        grantId: p.grantId,
        resource: p.resource,
        operation: p.operation,
        arguments: p.arguments,
        status: "pending",
        fingerprint,
        createdAt: new Date().toISOString(),
        questionId: p.questionId,
        questionRevision: p.questionRevision,
      }),
    );
  }
  withdraw(id: string) {
    const m = this.messages.get(id);
    if (m.status !== "pending")
      throw new KodoError("CONFLICT", "消息已发送或结果未知，不能声称撤回远端消息。");
    return this.messages.put({ ...m, status: "withdrawn" });
  }
  async scan() {
    if (this.scanning || this.service.lifecycle.status().frozen) return;
    this.scanning = true;
    try {
      const blocked = new Set<string>();
      for (const m of this.messages.all()) {
        const key = m.goalId + ":" + m.connectionId + ":" + m.resource;
        if (["unknown", "sending"].includes(m.status)) {
          blocked.add(key);
          continue;
        }
        if (m.status !== "pending" || blocked.has(key)) continue;
        const goal = this.service.goals.get(m.goalId);
        if (goal.status === "cancelled") {
          this.withdraw(m.id);
          continue;
        }
        const c = this.service.applications.connections.get(m.connectionId);
        if (!c.enabled || goal.status === "blocked") {
          blocked.add(key);
          continue;
        }
        if (m.questionId) {
          const q = this.service.store.record<{ revision: number; resolved: boolean }>(
            "outbound-question",
            m.questionId,
          );
          if (!q || q.resolved || q.revision !== m.questionRevision) {
            this.withdraw(m.id);
            continue;
          }
        }
        try {
          this.service.permissions.require(m.grantId, {
            controllerSessionId: m.controllerSessionId,
            operation: m.operation,
            resource: m.resource,
            connectionId: m.connectionId,
            goalId: m.goalId,
          });
        } catch {
          blocked.add(key);
          continue;
        }
        this.messages.put({ ...m, status: "sending" });
        try {
          const result = await this.service.applications.call({
            connectionId: m.connectionId,
            grantId: m.grantId,
            controllerSessionId: m.controllerSessionId,
            goalId: m.goalId,
            operation: m.operation,
            resource: m.resource,
            arguments: m.arguments,
            identity: {
              sessionId: m.controllerSessionId,
              turnId: "outbox",
              toolCallId: m.id,
              actor: "user-rule",
            },
          });
          this.messages.put({ ...m, status: "sent", result });
        } catch {
          this.messages.put({ ...m, status: "unknown" });
          blocked.add(key);
        }
      }
    } finally {
      this.scanning = false;
    }
  }
  reconcile(id: string, resolution: "sent" | "withdrawn", evidence: string) {
    const m = this.messages.get(id);
    if (m.status !== "unknown" || !evidence.trim())
      throw new KodoError("CONFLICT", "需要对账未知消息并记录依据。");
    return this.messages.put({
      ...m,
      status: resolution,
      result: { reconciled: true, evidence, at: new Date().toISOString(), id: randomUUID() },
    });
  }
}
