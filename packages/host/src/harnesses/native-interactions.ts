import type { AdapterContext } from "./adapter.js";

/** Keep one owner per native request, including snapshot/stream replay races. */
export class NativeInteractions {
  private requests = new Map<string, "pending" | "settled">();
  private closed = false;
  constructor(private ctx: AdapterContext) {}

  ask(id: string, payload: unknown, reply: (answer: unknown) => Promise<unknown>): void {
    if (this.closed || this.requests.has(id)) return;
    this.requests.set(id, "pending");
    void (async () => {
      try {
        const answer = await this.ctx.interact(id, payload);
        if (this.closed || this.requests.get(id) !== "pending") return;
        await reply(answer);
        this.resolve(id);
      } catch (error) {
        if (this.closed || this.requests.get(id) !== "pending") return;
        this.resolve(id, "withdrawn");
        this.ctx.emit("error", {
          message: error instanceof Error ? error.message : "原生交互响应失败，请重新核对会话。",
        });
      }
    })();
  }

  resolve(id: string, reason: "resolved" | "withdrawn" = "resolved"): void {
    if (this.closed) return;
    const pending = this.requests.get(id) === "pending";
    // A resolution may precede an older pending snapshot; keep its tombstone.
    this.requests.set(id, "settled");
    if (pending) this.ctx.resolveInteraction?.(id, reason);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const [id, state] of this.requests)
      if (state === "pending") this.ctx.resolveInteraction?.(id, "withdrawn");
    this.requests.clear();
  }
}
