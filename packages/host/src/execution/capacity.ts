import { KodoError } from "@kodo/protocol";

/** Reserve synchronously, before starting asynchronous process/model IO. */
export class ExecutionCapacity {
  private readonly held = new Map<string, string>();
  private readonly waiting = new Map<
    string,
    { priority: number; order: number; ready: () => void }
  >();
  private order = 0;
  constructor(readonly limit = 4) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 128)
      throw new KodoError("INVALID_INPUT", "执行容量必须为 1–128。");
  }
  acquire(id: string, executor: string, priority: number, ready: () => void): boolean {
    if (this.held.has(id)) return true;
    const queued = this.waiting.get(id);
    if (!queued) this.waiting.set(id, { priority, order: this.order++, ready });
    else if (priority > queued.priority) queued.priority = priority;
    const next = [...this.waiting].sort(
      (a, b) => b[1].priority - a[1].priority || a[1].order - b[1].order,
    )[0];
    if (this.held.size >= this.limit || next?.[0] !== id) return false;
    this.waiting.delete(id);
    this.held.set(id, executor);
    return true;
  }
  release(id: string): void {
    this.held.delete(id);
    this.waiting.delete(id);
    this.wake();
  }
  private wake(): void {
    const free = this.limit - this.held.size;
    for (const [, entry] of [...this.waiting]
      .sort((a, b) => b[1].priority - a[1].priority || a[1].order - b[1].order)
      .slice(0, free))
      queueMicrotask(entry.ready);
  }
  snapshot() {
    return { limit: this.limit, active: [...this.held.keys()], queued: [...this.waiting.keys()] };
  }
}
