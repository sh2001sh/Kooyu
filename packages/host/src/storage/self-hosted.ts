import type { Store } from "./store.js";
import { KodoError } from "@kodo/protocol";

/** Internal typed JSON repository. Table names are fixed by the service, never supplied by clients. */
export class DomainTable<T extends { id: string }> {
  constructor(
    private readonly store: Store,
    private readonly table: string,
  ) {
    if (
      ![
        "automations",
        "activations",
        "webhook_connections",
        "webhook_events",
        "authorization_grants",
        "memory_entries",
        "application_versions",
        "app_connections",
        "notification_channels",
        "notification_deliveries",
        "outbound_messages",
        "executors",
        "control_leases",
      ].includes(table)
    )
      throw new Error("Unknown domain table");
  }
  all(): T[] {
    return this.store.db
      .prepare("SELECT data FROM " + this.table + " ORDER BY rowid")
      .all()
      .map((r) => JSON.parse(String(r.data)));
  }
  find(id: string): T | undefined {
    const r = this.store.db.prepare("SELECT data FROM " + this.table + " WHERE id=?").get(id);
    return r ? JSON.parse(String(r.data)) : undefined;
  }
  get(id: string): T {
    const r = this.find(id);
    if (!r) throw new KodoError("NOT_FOUND", "记录不存在。");
    return r;
  }
  put(value: T) {
    this.store.db
      .prepare(
        "INSERT INTO " +
          this.table +
          "(id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(value.id, JSON.stringify(value));
    return value;
  }
}
