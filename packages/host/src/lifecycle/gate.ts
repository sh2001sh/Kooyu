import { randomUUID } from "node:crypto";
import { KodoError } from "@kodo/protocol";
import type { Store } from "../storage/store.js";

/** Synchronous dispatch fence. Observations and cancellation remain available. */
export class LifecycleGate {
  readonly processIdentity = randomUUID();
  private generation = 0;
  private frozen = false;
  private active = 0;
  constructor(private readonly store: Store) {
    const saved = store.record<{ generation: number; frozen: boolean }>("lifecycle", "gate");
    this.generation = (saved?.generation ?? 0) + 1;
    this.frozen = saved?.frozen ?? false;
    this.save();
  }
  close(): void {
    this.frozen = true;
  }
  assertOpen(): void {
    if (this.frozen) throw new KodoError("CONFLICT", "Host 已冻结新执行，请先恢复运行。");
  }
  enter(): () => void {
    this.assertOpen();
    this.active++;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.active--;
      }
    };
  }
  quiesce() {
    if (!this.frozen) {
      this.frozen = true;
      this.generation++;
      this.save();
    }
    return this.status();
  }
  resume(identity: string, generation: number) {
    if (identity !== this.processIdentity || generation !== this.generation)
      throw new KodoError("CONFLICT", "进程身份或排空代次已改变，请重新查询。");
    this.frozen = false;
    this.generation++;
    this.save();
    return this.status();
  }
  private save() {
    this.store.put("lifecycle", "gate", { generation: this.generation, frozen: this.frozen });
  }
  status() {
    return {
      hostId: this.store.hostId,
      processIdentity: this.processIdentity,
      pid: process.pid,
      generation: this.generation,
      frozen: this.frozen,
      inFlight: this.active,
    };
  }
}
