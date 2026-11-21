import { KodoError } from "@kodo/protocol";

const INTERACTIVE_PRIORITY = 10;

/**
 * Dual-pool execution capacity with an interactive fast-lane.
 * Reserve synchronously, before starting asynchronous process/model IO.
 *
 * - `limit`: max concurrent background executions (automations, wakes, sub-workers).
 * - `interactiveReserve`: guaranteed fast-lane slots exclusively available to
 *   interactive human-initiated turns (`priority >= 10`) so background work can
 *   never starve foreground responsiveness.
 */
export class ExecutionCapacity {
  private readonly held = new Map<string, { executor: string; interactive: boolean }>();
  private readonly waiting = new Map<
    string,
    { priority: number; order: number; ready: () => void }
  >();
  private order = 0;

  constructor(
    readonly limit = 4,
    readonly interactiveReserve = 0,
  ) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 128)
      throw new KodoError("INVALID_INPUT", "执行容量必须为 1–128。");
    if (
      !Number.isSafeInteger(interactiveReserve) ||
      interactiveReserve < 0 ||
      interactiveReserve > 64
    )
      throw new KodoError("INVALID_INPUT", "交互预留槽位必须为 0–64。");
  }

  get totalLimit(): number {
    return this.limit + this.interactiveReserve;
  }

  private backgroundHeldCount(): number {
    let count = 0;
    for (const entry of this.held.values()) if (!entry.interactive) count++;
    return count;
  }

  private canAcquire(priority: number): boolean {
    if (this.held.size >= this.totalLimit) return false;
    if (priority >= INTERACTIVE_PRIORITY) return true;
    return this.backgroundHeldCount() < this.limit;
  }

  acquire(id: string, executor: string, priority: number, ready: () => void): boolean {
    if (this.held.has(id)) return true;
    const queued = this.waiting.get(id);
    if (!queued) this.waiting.set(id, { priority, order: this.order++, ready });
    else if (priority > queued.priority) queued.priority = priority;
    const effective = this.waiting.get(id)!;
    if (!this.canAcquire(effective.priority)) return false;
    const eligible = [...this.waiting]
      .filter(([, w]) => this.canAcquire(w.priority))
      .sort((a, b) => b[1].priority - a[1].priority || a[1].order - b[1].order);
    if (eligible[0]?.[0] !== id) return false;
    this.waiting.delete(id);
    this.held.set(id, { executor, interactive: effective.priority >= INTERACTIVE_PRIORITY });
    return true;
  }

  release(id: string): void {
    this.held.delete(id);
    this.waiting.delete(id);
    this.wake();
  }

  private wake(): void {
    let remainingTotal = Math.max(0, this.totalLimit - this.held.size);
    if (remainingTotal === 0) return;
    let remainingBackground = Math.max(0, this.limit - this.backgroundHeldCount());
    const ordered = [...this.waiting].sort(
      (a, b) => b[1].priority - a[1].priority || a[1].order - b[1].order,
    );
    for (const [, entry] of ordered) {
      if (remainingTotal <= 0) break;
      const isInteractive = entry.priority >= INTERACTIVE_PRIORITY;
      if (!isInteractive) {
        if (remainingBackground <= 0) continue;
        remainingBackground--;
      }
      remainingTotal--;
      queueMicrotask(entry.ready);
    }
  }

  snapshot() {
    const active = [...this.held.keys()];
    const interactiveActive: string[] = [];
    const backgroundActive: string[] = [];
    for (const [id, entry] of this.held) {
      if (entry.interactive) interactiveActive.push(id);
      else backgroundActive.push(id);
    }
    return {
      limit: this.limit,
      interactiveReserve: this.interactiveReserve,
      totalLimit: this.totalLimit,
      active,
      interactiveActive,
      backgroundActive,
      queued: [...this.waiting.keys()],
    };
  }
}
