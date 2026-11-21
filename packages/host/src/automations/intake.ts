import { createHash, randomUUID } from "node:crypto";
import { KodoError } from "@kodo/protocol";
import type { SessionService } from "../session-service.js";

export type IntakeDisposition = "context-only" | "observed" | "proposed" | "dispatched" | "dropped";

export interface IntakeRecord {
  id: string;
  sourceKind: string;
  sourceId: string;
  externalId: string;
  disposition: IntakeDisposition;
  createdAt: string;
  controllerId: string;
  summary: string;
  sender?: string;
  chat?: string;
  commandId?: string;
}

const CONTEXT_RING_MAX = 50;

function stableUuid(seed: string): string {
  const bytes = createHash("sha256").update(seed).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class IntakeFilter {
  constructor(private readonly service: SessionService) {}

  accept(
    input: {
      sourceKind: string;
      sourceId: string;
      externalId: string;
      fingerprint: string;
      disposition: IntakeDisposition;
      controllerId: string;
      summary: string;
      sender?: string;
      chat?: string;
    },
    apply: () => void,
  ) {
    const store = this.service.store;
    return store.transaction(() => {
      const old = store.db
        .prepare(
          "SELECT id, data FROM intake_events WHERE source_kind=? AND source_id=? AND external_id=?",
        )
        .get(input.sourceKind, input.sourceId, input.externalId);
      if (old) {
        if (JSON.parse(String(old.data)).fingerprint !== input.fingerprint)
          throw new KodoError("CONFLICT", "来源事件 ID 已用于不同内容。");
        return { id: String(old.id), duplicate: true };
      }
      const id = randomUUID();
      const now = new Date().toISOString();
      const boundedSummary = input.summary.slice(0, 4000);
      let effectiveDisposition: IntakeDisposition = input.disposition;
      let dispatchedCommandId: string | undefined;

      if (effectiveDisposition === "dispatched") {
        // Never revive a controller session explicitly paused by the user.
        const cmd = this.service.dispatchAutomatedMessage(
          input.controllerId,
          stableUuid(`intake-auto:${input.sourceKind}:${input.sourceId}:${input.externalId}`),
          `[${input.sourceKind}] ${boundedSummary}`,
        );
        if (!cmd) {
          effectiveDisposition = "proposed";
        } else {
          dispatchedCommandId = cmd.id;
        }
      }

      store.db.prepare("INSERT INTO intake_events VALUES (?,?,?,?,?,?,?)").run(
        id,
        input.sourceKind,
        input.sourceId,
        input.externalId,
        effectiveDisposition,
        now,
        JSON.stringify({
          fingerprint: input.fingerprint,
          controllerId: input.controllerId,
          summary: boundedSummary,
          sender: input.sender,
          chat: input.chat,
          commandId: dispatchedCommandId,
        }),
      );

      if (effectiveDisposition === "context-only") {
        // Maintain a bounded 0-token passive context ring per source.
        store.db
          .prepare(
            `DELETE FROM intake_events
             WHERE source_kind=? AND source_id=? AND disposition='context-only'
               AND id NOT IN (
                 SELECT id FROM intake_events
                 WHERE source_kind=? AND source_id=? AND disposition='context-only'
                 ORDER BY created_at DESC LIMIT ?
               )`,
          )
          .run(
            input.sourceKind,
            input.sourceId,
            input.sourceKind,
            input.sourceId,
            CONTEXT_RING_MAX,
          );
      } else if (effectiveDisposition === "proposed") {
        this.service.inbox("intake:" + id, input.controllerId, "notification", {
          type: "intake-proposal",
          intakeEventId: id,
          sourceKind: input.sourceKind,
          sourceId: input.sourceId,
          externalId: input.externalId,
          summary: boundedSummary,
        });
      }
      apply();
      return {
        id,
        duplicate: false,
        disposition: effectiveDisposition,
        commandId: dispatchedCommandId,
      };
    });
  }

  /** One-click approval for a proposed external intake event (sends once idempotently to controller). */
  approve(eventId: string, overrideText?: string) {
    const store = this.service.store;
    const row = store.db
      .prepare(
        "SELECT id, source_kind, source_id, external_id, disposition, data FROM intake_events WHERE id=?",
      )
      .get(eventId) as
      | {
          id: string;
          source_kind: string;
          source_id: string;
          external_id: string;
          disposition: IntakeDisposition;
          data: string;
        }
      | undefined;
    if (!row) throw new KodoError("NOT_FOUND", "找不到对应的外部接入建议。");
    const parsed = JSON.parse(row.data) as {
      controllerId: string;
      summary?: string;
      commandId?: string;
      [k: string]: unknown;
    };
    if (row.disposition === "dispatched" && parsed.commandId) {
      return { id: row.id, commandId: parsed.commandId, alreadyApproved: true };
    }
    if (row.disposition !== "proposed" && row.disposition !== "observed") {
      throw new KodoError("CONFLICT", "该外部事件状态不支持批准执行。");
    }
    const text = (overrideText?.trim() || parsed.summary || "").trim();
    if (!text) throw new KodoError("INVALID_INPUT", "事件摘要为空，无法派发。");
    const cmd = this.service.acceptSend(parsed.controllerId, {
      requestId: stableUuid(`intake-approve:${row.id}`),
      text: `[${row.source_kind} 批准执行] ${text}`,
      mode: "queue",
    });
    store.db
      .prepare("UPDATE intake_events SET disposition='dispatched', data=? WHERE id=?")
      .run(JSON.stringify({ ...parsed, commandId: cmd.id }), row.id);
    this.service.markInboxRead(`intake:${row.id}`);
    return { id: row.id, commandId: cmd.id, alreadyApproved: false };
  }

  recentContext(
    sourceKind: string,
    sourceId: string,
    limit = 8,
  ): Array<{ sender?: string; summary: string; createdAt: string }> {
    const rows = this.service.store.db
      .prepare(
        `SELECT created_at, data FROM intake_events
         WHERE source_kind=? AND source_id=? AND disposition='context-only'
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(sourceKind, sourceId, Math.max(1, Math.min(50, limit))) as Array<{
      created_at: string;
      data: string;
    }>;
    return rows.reverse().map((r) => {
      const d = JSON.parse(r.data) as { sender?: string; summary?: string };
      return { sender: d.sender, summary: d.summary ?? "", createdAt: r.created_at };
    });
  }

  list(limit = 50): IntakeRecord[] {
    const rows = this.service.store.db
      .prepare(
        "SELECT id, source_kind, source_id, external_id, disposition, created_at, data FROM intake_events ORDER BY created_at DESC LIMIT ?",
      )
      .all(Math.max(1, Math.min(200, limit))) as Array<{
      id: string;
      source_kind: string;
      source_id: string;
      external_id: string;
      disposition: IntakeDisposition;
      created_at: string;
      data: string;
    }>;
    return rows.map((r) => {
      const d = JSON.parse(r.data) as {
        controllerId?: string;
        summary?: string;
        sender?: string;
        chat?: string;
        commandId?: string;
      };
      return {
        id: r.id,
        sourceKind: r.source_kind,
        sourceId: r.source_id,
        externalId: r.external_id,
        disposition: r.disposition,
        createdAt: r.created_at,
        controllerId: d.controllerId ?? "",
        summary: d.summary ?? "",
        sender: d.sender,
        chat: d.chat,
        commandId: d.commandId,
      };
    });
  }

  collect() {
    return this.service.store.db
      .prepare("DELETE FROM intake_events WHERE created_at < ?")
      .run(new Date(Date.now() - 30 * 86400000).toISOString()).changes;
  }
}
