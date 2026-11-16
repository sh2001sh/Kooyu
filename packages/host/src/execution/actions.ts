import { createHash } from "node:crypto";
import { KodoError } from "@kodo/protocol";
import type { Store } from "../storage/store.js";
import type { LifecycleGate } from "../lifecycle/gate.js";

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value) ?? "null";
}
export const digest = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
export interface ActionIdentity {
  sessionId: string;
  turnId: string;
  toolCallId: string;
  actor: string;
  executorId?: string;
  grantId?: string;
  grantRevision?: number;
  generation?: number;
}
export interface ToolActionReceipt extends ActionIdentity {
  id: string;
  fingerprint: string;
  status: "accepted" | "dispatched" | "confirmed" | "failed" | "unknown";
  result?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
}
export class ActionJournal {
  private readonly running = new Map<string, Promise<unknown>>();
  constructor(
    private readonly store: Store,
    private readonly gate: LifecycleGate,
  ) {
    store.db
      .prepare(
        "UPDATE tool_action_receipts SET status='unknown',data=json_set(data,'$.status','unknown','$.error','Host 重启，动作结果未知，未重做。') WHERE status='dispatched'",
      )
      .run();
  }
  list(): ToolActionReceipt[] {
    return this.store.db
      .prepare("SELECT data FROM tool_action_receipts ORDER BY rowid")
      .all()
      .map((r) => JSON.parse(String(r.data)));
  }
  async drain(): Promise<void> {
    await Promise.allSettled([...this.running.values()]);
  }
  private save(r: ToolActionReceipt) {
    this.store.db
      .prepare(
        "INSERT INTO tool_action_receipts(id,session_id,status,data) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,data=excluded.data",
      )
      .run(r.id, r.sessionId, r.status, JSON.stringify(r));
  }
  async run<T>(
    identity: ActionIdentity,
    args: unknown,
    operation: () => Promise<T>,
    authorize: () => void = () => {},
  ): Promise<T> {
    const id = digest({
        sessionId: identity.sessionId,
        turnId: identity.turnId,
        toolCallId: identity.toolCallId,
        actor: identity.actor,
      }),
      fingerprint = digest(args);
    const row = this.store.db.prepare("SELECT data FROM tool_action_receipts WHERE id=?").get(id);
    const previous: ToolActionReceipt | undefined = row ? JSON.parse(String(row.data)) : undefined;
    if (previous && previous.fingerprint !== fingerprint)
      throw new KodoError("CONFLICT", "工具调用身份已用于不同参数。");
    // Replaying a result must not bypass a revoked grant or stale browser lease.
    authorize();
    if (previous?.status === "confirmed") return previous.result as T;
    const running = this.running.get(id);
    if (running) return running as Promise<T>;
    if (previous?.status === "unknown" || previous?.status === "dispatched")
      throw new KodoError("CONFLICT", "该动作结果未知，需要先对账，不能自动重做。");
    if (previous?.status === "failed")
      throw new KodoError("CONFLICT", previous.error ?? "该工具调用已失败，请使用新的调用身份。");
    authorize();
    const leave = this.gate.enter();
    const now = new Date().toISOString();
    const receipt: ToolActionReceipt = previous ?? {
      ...identity,
      id,
      fingerprint,
      status: "accepted",
      createdAt: now,
      updatedAt: now,
    };
    this.save(receipt);
    // Install the in-process promise before the first await and freeze intent first.
    const job = Promise.resolve().then(async () => {
      try {
        authorize();
        this.gate.assertOpen();
        receipt.status = "dispatched";
        receipt.updatedAt = new Date().toISOString();
        this.save(receipt);
        const result = await operation();
        receipt.status = "confirmed";
        receipt.result = result;
        return result;
      } catch (e) {
        receipt.status = receipt.status === "accepted" ? "failed" : "unknown";
        // A thrown error after dispatch does not prove the remote action did not occur.
        receipt.error = e instanceof Error ? e.message.slice(0, 1000) : "动作失败";
        throw e;
      } finally {
        receipt.updatedAt = new Date().toISOString();
        this.save(receipt);
        this.running.delete(id);
        leave();
      }
    });
    this.running.set(id, job);
    return job;
  }
  reconcile(id: string, resolution: "confirmed" | "failed", evidence: string) {
    const r = this.list().find((r) => r.id === id);
    if (!r || r.status !== "unknown" || !evidence.trim())
      throw new KodoError("CONFLICT", "仅可对账未知动作并提供依据。");
    this.save({
      ...r,
      status: resolution,
      result: { reconciled: true, evidence },
      updatedAt: new Date().toISOString(),
    });
  }
}
