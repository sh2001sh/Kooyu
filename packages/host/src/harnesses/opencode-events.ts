import { createHash } from "node:crypto";
import type { AdapterContext, Wire } from "./adapter.js";

/** Preserve native message roles: a user's prompt echo is never an assistant reply. */
export class OpenCodeEvents {
  private reasoningParts = new Set<string>();
  private roles = new Map<string, string>();
  private pending = new Map<string, Wire[]>();
  private error: unknown;
  constructor(private emit: AdapterContext["emit"]) {}
  start() {
    this.error = undefined;
  }
  accept(type: string, p: Wire): boolean {
    if (type === "todo.updated") {
      this.emit("todo", { items: p.todos });
    } else if (type === "message.updated") {
      const info = p.info;
      if (!info?.id || !info.role) return true;
      this.roles.set(info.id, info.role);
      for (const event of this.pending.get(info.id) ?? []) this.part(event.type, event.payload);
      this.pending.delete(info.id);
      if (info.role === "assistant") {
        if (info.error) this.error = info.error;
        const durationMs =
          typeof info.time?.created === "number" &&
          typeof info.time?.completed === "number" &&
          info.time.completed >= info.time.created
            ? Math.round(info.time.completed - info.time.created)
            : undefined;
        this.emit(
          "usage",
          {
            input: info.tokens?.input,
            output: info.tokens?.output,
            cacheRead: info.tokens?.cache?.read,
            cacheWrite: info.tokens?.cache?.write,
            costUsd: info.cost,
            model: info.modelID,
            ...(durationMs !== undefined ? { durationMs } : {}),
            scope: "turn",
            sourceId: info.id,
          },
          `usage:${info.id}:${JSON.stringify(info.tokens)}`,
        );
      }
    } else if (["message.part.updated", "message.part.delta"].includes(type)) {
      const id = p.messageID ?? p.part?.messageID;
      if (id && !this.roles.has(id)) {
        const queue = this.pending.get(id) ?? [];
        if (this.pending.size >= 128 || queue.length >= 512)
          throw new Error("OpenCode 消息角色未到达，请恢复原生连接并对账。");
        queue.push({ type, payload: p });
        this.pending.set(id, queue);
      } else this.part(type, p);
    } else if (type === "session.status") {
      if (p.status?.type === "retry") this.emit("state", { retry: p.status });
      else if (p.status?.type === "busy") this.emit("state", { retry: null, runState: "running" });
    } else if (type === "session.error") {
      this.error = p.error ?? p;
      this.emit("error", p);
    } else if (type === "session.idle") {
      this.emit("turn-ended", {
        outcome: this.error
          ? (this.error as Wire).name === "MessageAbortedError"
            ? "cancelled"
            : "failed"
          : "completed",
        ...(this.error ? { error: this.error } : {}),
        backgroundState: "unknown",
      });
      // Message identities are only needed while this turn's parts are streaming.
      this.roles.clear();
      this.pending.clear();
      this.reasoningParts.clear();
    } else return false;
    return true;
  }
  private part(type: string, p: Wire) {
    const id = p.messageID ?? p.part?.messageID;
    const role = this.roles.get(id);
    if (role !== "assistant") return;
    if (type === "message.part.delta") {
      if (this.reasoningParts.has(p.partID))
        this.emit("text-delta", { text: p.delta, itemId: p.partID, role, channel: "thought" });
      else if (p.field === undefined || p.field === "text")
        this.emit("text-delta", { text: p.delta, itemId: p.partID, role });
    } else {
      const part = p.part;
      if (part.type === "reasoning") {
        this.reasoningParts.add(part.id);
        if (typeof part.text === "string" && part.text)
          this.emit(
            "message",
            { ...part, role, channel: "thought" },
            `${part.id}:${createHash("sha256").update(JSON.stringify(part)).digest("hex")}`,
          );
        return;
      }
      this.emit(
        part.type === "tool" ? "tool" : "message",
        { ...part, role },
        `${part.id}:${createHash("sha256").update(JSON.stringify(part)).digest("hex")}`,
      );
    }
  }
}
