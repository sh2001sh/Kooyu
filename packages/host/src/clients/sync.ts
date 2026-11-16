import { createHash, randomUUID } from "node:crypto";
import type { NativeSyncPage } from "@kodo/protocol";

type State = NonNullable<NativeSyncPage["snapshot"]>;
const collectionKey = (name: string, row: Record<string, unknown>) =>
  name === "projectGrants" ? `${row.controllerSessionId}:${row.projectId}` : String(row.id);
/** Bounded network delta cache. Lost/evicted cursors reset; it never replaces the durable event log. */
export class NativeSync {
  private readonly epoch = randomUUID();
  private readonly history = new Map<string, { state: State; bytes: number }>();
  private bytes = 0;
  constructor(
    private readonly maxEntries = 32,
    private readonly maxBytes = 16 * 1024 * 1024,
  ) {}
  read(state: State, previous?: string): NativeSyncPage {
    const serialized = JSON.stringify(state);
    const cursor = createHash("sha256").update(this.epoch).update(serialized).digest("hex");
    const base = previous ? this.history.get(previous)?.state : undefined;
    if (!this.history.has(cursor)) {
      const bytes = Buffer.byteLength(serialized);
      if (bytes <= this.maxBytes) {
        this.history.set(cursor, { state: JSON.parse(serialized), bytes });
        this.bytes += bytes;
        while (this.history.size > this.maxEntries || this.bytes > this.maxBytes) {
          const first = this.history.keys().next().value!;
          this.bytes -= this.history.get(first)!.bytes;
          this.history.delete(first);
        }
      }
    }
    const common = { hostId: state.hostId, protocolVersion: state.protocolVersion, cursor };
    if (!base || base.hostId !== state.hostId)
      return { ...common, baseCursor: null, resetRequired: true, snapshot: state };
    const collections: NonNullable<NativeSyncPage["collections"]> = {};
    const values: Record<string, unknown> = {};
    for (const [key, current] of Object.entries(state)) {
      const prior = (base as unknown as Record<string, unknown>)[key];
      if (JSON.stringify(current) === JSON.stringify(prior)) continue;
      if (Array.isArray(current) && Array.isArray(prior)) {
        const before = new Map(prior.map((row) => [collectionKey(key, row), JSON.stringify(row)]));
        const order = current.map((row) => collectionKey(key, row));
        const present = new Set(order);
        collections[key] = {
          upsert: current.filter(
            (row) => before.get(collectionKey(key, row)) !== JSON.stringify(row),
          ),
          remove: [...before.keys()].filter((id) => !present.has(id)),
          order,
        };
      } else values[key] = current;
    }
    return { ...common, baseCursor: previous!, resetRequired: false, collections, values };
  }
}
