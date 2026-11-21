import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  KodoError,
  type Project,
  type Session,
  type Workspace,
  type RuntimeEvent,
  type Command,
  type Supervision,
  type HarnessBinding,
} from "@kodo/protocol";
import {
  SCHEMA_V1,
  SCHEMA_V2,
  SCHEMA_V3,
  SCHEMA_V4,
  SCHEMA_V7,
  SCHEMA_V8,
  SCHEMA_V9,
  SCHEMA_V10,
} from "./schema.js";

export class Store {
  readonly db: DatabaseSync;
  readonly hostId: string;
  private committedEffects: (() => void)[] = [];

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    try {
      this.db.exec(
        "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;",
      );
      const version = this.db.prepare("PRAGMA user_version").get()?.user_version;
      if (typeof version !== "number" || version > 10)
        throw new Error("Unsupported database schema version.");
      if (path !== ":memory:" && version > 0 && version < 10) {
        // A consistent SQLite snapshot includes committed WAL data. Never migrate without it.
        const backupPath =
          path + ".pre-v" + version + "-" + Date.now() + "-" + randomUUID() + ".sqlite";
        writeFileSync(backupPath, "", { flag: "wx", mode: 0o600 });
        this.db.prepare("VACUUM INTO ?").run(backupPath);
        chmodSync(backupPath, 0o600);
      }
      // SQLite requires foreign_keys to be disabled outside the transaction
      // when rebuilding a referenced table. Validate again before committing.
      if (version < 3) this.db.exec("PRAGMA foreign_keys = OFF");
      this.db.exec("BEGIN IMMEDIATE");
      try {
        if (version === 0) this.db.exec(SCHEMA_V1);
        if (version < 2) this.db.exec(SCHEMA_V2);
        if (version < 3) this.db.exec(SCHEMA_V3);
        if (version < 4) this.db.exec(SCHEMA_V4);
        if (version < 5) this.migrateBindings();
        if (version < 6) this.migrateKernelNames();
        if (version < 7) this.db.exec(SCHEMA_V7);
        if (version < 8) this.db.exec(SCHEMA_V8);
        if (version < 9) this.db.exec(SCHEMA_V9);
        if (version < 10) this.migrateV10();
        else {
          // Ensure pre-release v10 dev databases also have secure_requests without runtime DDL.
          this.db.exec(
            "CREATE TABLE IF NOT EXISTS secure_requests(id TEXT PRIMARY KEY, expires INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS secure_requests_expiry ON secure_requests(expires);",
          );
        }
        if (this.db.prepare("PRAGMA foreign_key_check").all().length)
          throw new Error("Database migration failed foreign key validation.");
        this.db
          .prepare("INSERT OR IGNORE INTO metadata(key, value) VALUES ('host_id', ?)")
          .run(randomUUID());
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
      this.db.exec("PRAGMA foreign_keys = ON");
      this.hostId = this.db.prepare("SELECT value FROM metadata WHERE key = 'host_id'").get()!
        .value as string;
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  /** Install V10 tables and backfill monotonic revision/generation/revoked on project grants. */
  private migrateV10(): void {
    for (const row of this.db
      .prepare("SELECT id,data FROM records WHERE kind='project-grant'")
      .all()) {
      const data = JSON.parse(String(row.data)) as Record<string, unknown>;
      const next = {
        ...data,
        revision: typeof data.revision === "number" ? data.revision : 1,
        generation: typeof data.generation === "number" ? data.generation : 1,
        revoked: typeof data.revoked === "boolean" ? data.revoked : false,
      };
      this.put("project-grant", String(row.id), next);
    }
    this.db.exec(SCHEMA_V10);
  }

  /** The SDK kernel is named Kodo; its tool-restriction modes drop the old pi prefix. */
  private migrateKernelNames(): void {
    for (const row of this.db.prepare("SELECT session_id,data FROM session_state").all()) {
      const data = JSON.parse(String(row.data));
      if (typeof data.permissionMode !== "string" || !data.permissionMode.startsWith("pi-tools-"))
        continue;
      data.permissionMode = data.permissionMode.replace(/^pi-tools-/, "kodo-tools-");
      this.db
        .prepare("UPDATE session_state SET data=? WHERE session_id=?")
        .run(JSON.stringify(data), String(row.session_id));
    }
    this.db.exec("PRAGMA user_version = 6");
  }

  private migrateBindings(): void {
    const bindings = this.records<HarnessBinding & { profileId?: string }>("harness-binding");
    const byProfile = new Map(bindings.filter((b) => b.profileId).map((b) => [b.profileId!, b.id]));
    for (const kind of [
      "harness-binding",
      "harness-binding-revision",
      "provider",
      "provider-revision",
    ]) {
      for (const row of this.db.prepare("SELECT id,data FROM records WHERE kind=?").all(kind)) {
        const data = JSON.parse(String(row.data));
        delete data.profileId;
        delete data.legacyProfileId;
        this.put(kind, String(row.id), data);
      }
    }
    for (const row of this.db.prepare("SELECT session_id,data FROM session_state").all()) {
      const data = JSON.parse(String(row.data));
      if (data.profileId) {
        data.bindingId = byProfile.get(data.profileId) ?? null;
        data.bindingRevision = data.bindingId ? data.profileRevision : null;
        // The old instance directory and native identity used the mirror ID.
        // Preserve history but require a new session before sending again.
        data.bindingUnavailable = true;
      }
      delete data.profileId;
      delete data.profileRevision;
      this.db
        .prepare("UPDATE session_state SET data=? WHERE session_id=?")
        .run(JSON.stringify(data), String(row.session_id));
    }
    for (const row of this.db.prepare("SELECT id,data FROM commands").all()) {
      const data = JSON.parse(String(row.data));
      data.bindingRevision = data.profileRevision ?? null;
      delete data.profileRevision;
      this.db
        .prepare("UPDATE commands SET data=? WHERE id=?")
        .run(JSON.stringify(data), String(row.id));
    }
    for (const row of this.db.prepare("SELECT id,data FROM records WHERE kind='usage'").all()) {
      const data = JSON.parse(String(row.data));
      data.bindingId = byProfile.get(data.profileId) ?? null;
      delete data.profileId;
      this.put("usage", String(row.id), data);
    }
    for (const row of this.db
      .prepare(
        "SELECT id,data FROM records WHERE kind IN ('profile-defaults','project-profile-defaults')",
      )
      .all()) {
      const data = JSON.parse(String(row.data));
      const original = data.harnessProfileIds ?? data.profileDefaults ?? {};
      const defaults = Object.fromEntries(
        Object.entries(original).map(([harness, id]) => [
          harness,
          id === null ? null : (byProfile.get(String(id)) ?? null),
        ]),
      );
      const project = String(row.id) !== "global";
      this.put(
        project ? "project-binding-defaults" : "binding-defaults",
        String(row.id),
        project
          ? { bindingDefaults: defaults, configRevision: data.configRevision ?? 0 }
          : { harnessBindingIds: defaults, revision: data.revision ?? 0 },
      );
    }
    this.db
      .prepare(
        "DELETE FROM records WHERE kind IN ('profile','profile-revision','profile-defaults','project-profile-defaults','provider-legacy')",
      )
      .run();
    this.db.exec("PRAGMA user_version = 5");
  }

  projects(): Project[] {
    const projects = this.db
      .prepare("SELECT id, name, created_at AS createdAt FROM projects ORDER BY created_at, id")
      .all() as unknown as Project[];
    return projects.map((p) => ({
      ...p,
      ...this.record("project-binding-defaults", p.id),
      ...this.record("project-sidebar", p.id),
    }));
  }
  workspaces(): Workspace[] {
    return this.db
      .prepare(
        "SELECT id, project_id AS projectId, host_id AS hostId, root_path AS rootPath FROM workspaces",
      )
      .all() as unknown as Workspace[];
  }
  sessions(): Session[] {
    const rows = this.db
      .prepare(
        `SELECT id, title, harness_id AS harnessId, kind, scope,
      project_id AS projectId, workspace_id AS workspaceId, host_id AS hostId,
      created_at AS createdAt FROM sessions WHERE id NOT IN (SELECT id FROM records WHERE kind='deleted-session') ORDER BY created_at DESC, id`,
      )
      .all();
    return rows.map((row) => ({
      nativeSessionId: null,
      phase: "draft",
      instanceId: String(row.harnessId),
      bindingId: null,
      bindingRevision: null,
      model: null,
      ownerEpoch: 0,
      runState: "idle",
      executionState: "unknown",
      connectionState: "offline",
      archived: false,
      pinned: false,
      ...row,
      ...this.getRecordState(String(row.id)),
    })) as unknown as Session[];
  }
  addProject(project: Project, workspace?: Workspace): void {
    this.transaction(() => {
      this.db
        .prepare("INSERT INTO projects VALUES (?, ?, ?)")
        .run(project.id, project.name, project.createdAt);
      if (workspace)
        this.db
          .prepare("INSERT INTO workspaces VALUES (?, ?, ?, ?)")
          .run(workspace.id, workspace.projectId, workspace.hostId, workspace.rootPath);
    });
  }
  addSession(session: Session): void {
    this.db
      .prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(
        session.id,
        session.title,
        session.harnessId,
        session.kind,
        session.scope,
        session.projectId,
        session.workspaceId,
        session.hostId,
        session.createdAt,
      );
    this.saveSession(session);
  }
  private getRecordState(id: string): object {
    const row = this.db.prepare("SELECT data FROM session_state WHERE session_id=?").get(id);
    return row ? (JSON.parse(row.data as string) as object) : {};
  }
  session(id: string): Session {
    const session = this.sessions().find((s) => s.id === id);
    if (!session) throw new KodoError("NOT_FOUND", "会话不存在。");
    return session;
  }
  saveSession(session: Session): void {
    this.db
      .prepare("UPDATE sessions SET title=?,project_id=?,workspace_id=?,scope=? WHERE id=?")
      .run(session.title, session.projectId, session.workspaceId, session.scope, session.id);
    if (session.nativeSessionId)
      this.db
        .prepare(
          "INSERT INTO native_identity VALUES (?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET native_id=excluded.native_id, instance_id=excluded.instance_id",
        )
        .run(session.harnessId, session.instanceId, session.nativeSessionId, session.id);
    this.db
      .prepare(
        "INSERT INTO session_state VALUES (?,?) ON CONFLICT(session_id) DO UPDATE SET data=excluded.data",
      )
      .run(session.id, JSON.stringify(session));
  }
  transaction<T>(fn: () => T): T {
    // Services compose several synchronous operations under the outer boundary.
    // Nested failures propagate and roll back that whole operation.
    if (this.db.isTransaction) return fn();
    this.db.exec("BEGIN IMMEDIATE");
    let result: T;
    try {
      result = fn();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      this.committedEffects = [];
      throw error;
    }
    const effects = this.committedEffects;
    this.committedEffects = [];
    for (const effect of effects) effect();
    return result;
  }
  afterCommit(effect: () => void): void {
    if (this.db.isTransaction) this.committedEffects.push(effect);
    else effect();
  }
  records<T>(kind: string): T[] {
    return this.db
      .prepare("SELECT data FROM records WHERE kind=? ORDER BY rowid")
      .all(kind)
      .map((r) => JSON.parse(r.data as string) as T);
  }
  record<T>(kind: string, id: string): T | undefined {
    const row = this.db.prepare("SELECT data FROM records WHERE kind=? AND id=?").get(kind, id);
    return row ? (JSON.parse(row.data as string) as T) : undefined;
  }
  put(kind: string, id: string, value: unknown): void {
    this.db
      .prepare(
        "INSERT INTO records VALUES (?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data",
      )
      .run(kind, id, JSON.stringify(value));
  }
  remove(kind: string, id: string): void {
    this.db.prepare("DELETE FROM records WHERE kind=? AND id=?").run(kind, id);
  }
  command(id: string): Command | undefined {
    const row = this.db.prepare("SELECT data FROM commands WHERE id=?").get(id);
    return row ? (JSON.parse(row.data as string) as Command) : undefined;
  }
  commands(sessionId?: string): Command[] {
    return this.db
      .prepare(`SELECT data FROM commands ${sessionId ? "WHERE session_id=?" : ""} ORDER BY rowid`)
      .all(...(sessionId ? [sessionId] : []))
      .map((r) => JSON.parse(r.data as string) as Command);
  }
  saveCommand(command: Command): void {
    this.db
      .prepare(
        "INSERT INTO commands VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,data=excluded.data",
      )
      .run(command.id, command.sessionId, command.status, JSON.stringify(command));
  }
  events(sessionId?: string, after = 0, limit = 500): RuntimeEvent[] {
    return this.db
      .prepare(
        `SELECT sequence,data FROM events WHERE sequence>? ${sessionId ? "AND session_id=?" : ""} AND (session_id NOT IN (SELECT id FROM records WHERE kind='deleted-session') OR (json_extract(data,'$.type')='state' AND json_extract(data,'$.payload.deleted')=1)) ORDER BY sequence LIMIT ?`,
      )
      .all(after, ...(sessionId ? [sessionId] : []), Math.min(limit, 1000))
      .map(
        (r) => ({ ...JSON.parse(r.data as string), sequence: Number(r.sequence) }) as RuntimeEvent,
      );
  }
  /** Newest events of the given types, newest first; bounded for progress summaries. */
  recentEvents(sessionId: string, types: RuntimeEvent["type"][], limit = 20): RuntimeEvent[] {
    if (!types.length) return [];
    return this.db
      .prepare(
        `SELECT sequence,data FROM events WHERE session_id=? AND json_extract(data,'$.type') IN (${types.map(() => "?").join(",")}) ORDER BY sequence DESC LIMIT ?`,
      )
      .all(sessionId, ...types, Math.min(limit, 200))
      .map(
        (r) => ({ ...JSON.parse(r.data as string), sequence: Number(r.sequence) }) as RuntimeEvent,
      );
  }
  eventPage(sessionId: string, before?: number, limit = 300) {
    const rows = this.db
      .prepare(
        `SELECT sequence,data FROM events WHERE session_id=? ${before === undefined ? "" : "AND sequence<?"} ORDER BY sequence DESC LIMIT ?`,
      )
      .all(sessionId, ...(before === undefined ? [] : [before]), Math.min(limit, 500) + 1);
    const more = rows.length > limit;
    const events = rows
      .slice(0, limit)
      .reverse()
      .map(
        (r) => ({ ...JSON.parse(r.data as string), sequence: Number(r.sequence) }) as RuntimeEvent,
      );
    return { events, olderCursor: more ? events[0]!.sequence : null };
  }
  eventAround(sessionId: string, eventId: string) {
    const anchor = this.db
      .prepare("SELECT sequence FROM events WHERE session_id=? AND id=?")
      .get(sessionId, eventId);
    if (!anchor) throw new KodoError("NOT_FOUND", "搜索对应的事件已不可用，请重新搜索。");
    const earlier = this.db
      .prepare(
        "SELECT sequence,data FROM events WHERE session_id=? AND sequence<=? ORDER BY sequence DESC LIMIT 151",
      )
      .all(sessionId, Number(anchor.sequence));
    const later = this.db
      .prepare(
        "SELECT sequence,data FROM events WHERE session_id=? AND sequence>? ORDER BY sequence LIMIT 150",
      )
      .all(sessionId, Number(anchor.sequence));
    const events = [...earlier.slice(0, 150).reverse(), ...later].map(
      (r) => ({ ...JSON.parse(String(r.data)), sequence: Number(r.sequence) }) as RuntimeEvent,
    );
    return {
      events,
      olderCursor: earlier.length > 150 ? events[0]!.sequence : null,
      anchorEventId: eventId,
    };
  }
  collect(now = Date.now(), transientDays = 30, maxTransientPerSession = 20000) {
    const cutoff = new Date(now - transientDays * 86400000).toISOString();
    return this.transaction(() => {
      let removed = 0;
      for (const s of this.sessions()) {
        if (s.runState !== "idle") continue;
        // A lagging live consumer must retain its entire unread interval.
        const cursors = this.watches()
          .filter((w) => w.targetSessionId === s.id && w.state === "active")
          .map((w) => Number(w.cursor ?? 0));
        const safe = cursors.length ? Math.min(...cursors) : this.latestSequence(s.id);
        const rows = this.db
          .prepare(
            `SELECT sequence,id,json_extract(data,'$.createdAt') AS at FROM events WHERE session_id=? AND json_extract(data,'$.type') IN ('text-delta','state') ORDER BY sequence DESC`,
          )
          .all(s.id);
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i]!;
          if (
            Number(row.sequence) > safe ||
            (String(row.at) >= cutoff && i < maxTransientPerSession)
          )
            continue;
          this.db
            .prepare("INSERT OR IGNORE INTO event_tombstones VALUES (?,?)")
            .run(s.id, String(row.id));
          this.db.prepare("DELETE FROM events WHERE sequence=?").run(Number(row.sequence));
          removed++;
        }
      }
      for (const item of this.records<{ id: string; resolved?: boolean; createdAt: string }>(
        "inbox",
      ))
        if (item.resolved && Date.parse(item.createdAt) < now - 90 * 86400000)
          this.remove("inbox", item.id);
      this.put("maintenance", "last-gc", { at: new Date(now).toISOString(), removed });
      return { removed };
    });
  }
  latestSequence(sessionId?: string): number {
    if (!sessionId)
      return Number(
        this.db
          .prepare(
            "SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name='events'),0) AS value",
          )
          .get()!.value,
      );
    return Number(
      this.db
        .prepare(
          `SELECT COALESCE(MAX(sequence),0) AS value FROM events ${sessionId ? "WHERE session_id=?" : ""}`,
        )
        .get(...(sessionId ? [sessionId] : []))!.value,
    );
  }
  append(event: Omit<RuntimeEvent, "sequence">): RuntimeEvent | undefined {
    if (
      this.db
        .prepare("SELECT 1 FROM event_tombstones WHERE session_id=? AND id=?")
        .get(event.sessionId, event.id)
    )
      return undefined;
    const result = this.db
      .prepare("INSERT OR IGNORE INTO events(id,session_id,data) VALUES (?,?,?)")
      .run(event.id, event.sessionId, JSON.stringify(event));
    if (!result.changes) return undefined;
    const stored = { ...event, sequence: Number(result.lastInsertRowid) };
    if (event.type === "message" || event.type === "tool")
      this.db
        .prepare("INSERT INTO search_index VALUES (?,?,?)")
        .run(event.sessionId, event.id, JSON.stringify(event.payload));
    return stored;
  }
  hasEvent(sessionId: string, id: string): boolean {
    return Boolean(
      this.db
        .prepare(
          "SELECT 1 FROM events WHERE session_id=? AND id=? UNION ALL SELECT 1 FROM event_tombstones WHERE session_id=? AND id=? LIMIT 1",
        )
        .get(sessionId, id, sessionId, id),
    );
  }
  rememberEvent(sessionId: string, id: string): void {
    this.db.prepare("INSERT OR IGNORE INTO event_tombstones VALUES (?,?)").run(sessionId, id);
  }
  search(query: string): { sessionId: string; eventId: string; snippet: string }[] {
    if (!query.trim()) return [];
    const terms = query.trim().split(/\s+/);
    // Trigram handles CJK substrings; one/two-character searches need a scan.
    if (terms.some((t) => [...t].length < 3)) {
      return this.db
        .prepare(
          `SELECT session_id AS sessionId,event_id AS eventId,substr(text,1,500) AS snippet FROM search_index WHERE session_id NOT IN (SELECT id FROM records WHERE kind='deleted-session') AND ${terms.map(() => "instr(lower(text),lower(?))>0").join(" AND ")} LIMIT 100`,
        )
        .all(...terms) as unknown as { sessionId: string; eventId: string; snippet: string }[];
    }
    const match = query
      .trim()
      .split(/\s+/)
      .map((s) => `"${s.replaceAll('"', '""')}"`)
      .join(" AND ");
    return this.db
      .prepare(
        "SELECT session_id AS sessionId,event_id AS eventId,snippet(search_index,2,'【','】','…',32) AS snippet FROM search_index WHERE search_index MATCH ? AND session_id NOT IN (SELECT id FROM records WHERE kind='deleted-session') LIMIT 100",
      )
      .all(match) as unknown as { sessionId: string; eventId: string; snippet: string }[];
  }
  watches(): Supervision[] {
    return this.db
      .prepare("SELECT data FROM watches")
      .all()
      .map((r) => JSON.parse(r.data as string) as Supervision);
  }
  saveWatch(w: Supervision): void {
    this.db
      .prepare(
        "INSERT INTO watches VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET mode=excluded.mode,state=excluded.state,data=excluded.data",
      )
      .run(w.id, w.controllerSessionId, w.targetSessionId, w.mode, w.state, JSON.stringify(w));
  }
  recover(): void {
    this.transaction(() => {
      for (const c of this.commands())
        if (c.status === "dispatched") {
          c.status = "unknown";
          c.error = "Host 重启：原生接收结果需要对账，未自动重发。";
          this.saveCommand(c);
        }
      for (const row of this.db
        .prepare("SELECT id,data FROM wakes WHERE state='dispatched'")
        .all()) {
        const wake = JSON.parse(row.data as string),
          command = this.command(wake.commandId);
        const state =
          command?.status === "accepted"
            ? "pending"
            : command?.status === "confirmed"
              ? "confirmed"
              : command?.status === "cancelled"
                ? "cancelled"
                : "unknown";
        this.db.prepare("UPDATE wakes SET state=? WHERE id=?").run(state, String(row.id));
      }
      for (const s of this.sessions())
        if (s.phase === "native") {
          const epoch = s.ownerEpoch + 1;
          this.saveSession({
            ...s,
            connectionState: "offline",
            runState: s.runState === "idle" ? "idle" : "unknown",
            executionState: "unknown",
            ownerEpoch: epoch,
          });
          for (const c of this.commands(s.id))
            if (c.status === "accepted") this.saveCommand({ ...c, generation: epoch });
        }
    });
  }
  close(): void {
    this.db.close();
  }
}
