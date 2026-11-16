import type { EventEmitter } from "node:events";
import {
  KodoError,
  type NotificationItem,
  type NotificationKind,
  type NotificationPage,
} from "@kodo/protocol";
import type { Store } from "../storage/store.js";

/** Lock-screen text per kind. Body text and tool output stay out of the title. */
const TITLES: Record<NotificationKind, string> = {
  "approval-required": "Kooyu 需要你批准一项操作",
  question: "Kooyu 需要你回答一个问题",
  "goal-blocked": "目标受阻，需要你处理",
  "limit-paused": "托管已因限制暂停",
  "goal-awaiting-review": "目标已提交，等待你验收",
  "goal-completed": "目标已完成",
  "supervision-notice": "你关注的会话有新进展",
};

export interface PublishInput {
  id: string;
  kind: NotificationKind;
  preview?: string | null;
  sessionId?: string | null;
  goalId?: string | null;
  inboxItemId?: string | null;
}

const RETAIN_READ_DAYS = 30;
const RETAIN_UNREAD_DAYS = 180;

/**
 * Durable notification facts with a monotonic cursor. Items are written inside the
 * caller's transaction and announced only after commit; delivery channels (system
 * push, APNs, Bark) attach to this feed later and keep their own attempt records.
 */
export class NotificationService {
  onPublish?: (item: NotificationItem) => void;
  constructor(
    private readonly store: Store,
    private readonly emitter: EventEmitter,
  ) {}

  publish(input: PublishInput): NotificationItem | undefined {
    const createdAt = new Date().toISOString();
    const body = {
      id: input.id,
      kind: input.kind,
      title: TITLES[input.kind],
      preview: input.preview ? input.preview.slice(0, 280) : null,
      sessionId: input.sessionId ?? null,
      goalId: input.goalId ?? null,
      inboxItemId: input.inboxItemId ?? null,
      link: {
        hostId: this.store.hostId,
        sessionId: input.sessionId ?? null,
        goalId: input.goalId ?? null,
        inboxItemId: input.inboxItemId ?? null,
      },
      createdAt,
    };
    const result = this.store.db
      .prepare("INSERT OR IGNORE INTO notification_items(id,created_at,data) VALUES (?,?,?)")
      .run(input.id, createdAt, JSON.stringify(body));
    if (!result.changes) return undefined;
    const item: NotificationItem = {
      ...body,
      sequence: Number(result.lastInsertRowid),
      readAt: null,
    };
    this.onPublish?.(item);
    this.store.afterCommit(() => {
      for (const listener of this.emitter.rawListeners("notification")) {
        try {
          listener.call(this.emitter, item);
        } catch (error) {
          console.error(
            `Notification subscriber failed: ${error instanceof Error ? error.message : error}`,
          );
        }
      }
    });
    return item;
  }

  private row(r: Record<string, unknown>): NotificationItem {
    return {
      ...(JSON.parse(String(r.data)) as Omit<NotificationItem, "sequence" | "readAt">),
      sequence: Number(r.sequence),
      readAt: r.read_at === null || r.read_at === undefined ? null : String(r.read_at),
    };
  }

  latest(): number {
    return Number(
      this.store.db
        .prepare(
          "SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name='notification_items'),0) AS value",
        )
        .get()!.value,
    );
  }

  /** Items after the cursor; a cursor older than the retained window returns a reset snapshot. */
  list(after = 0, limit = 100): NotificationPage {
    if (!Number.isSafeInteger(after) || after < 0)
      throw new KodoError("INVALID_INPUT", "通知游标无效。");
    if (!Number.isSafeInteger(limit) || limit < 1)
      throw new KodoError("INVALID_INPUT", "通知分页大小无效。");
    const size = Math.min(Math.max(1, limit), 500);
    const floor = this.store.record<{ sequence: number }>("notification-retention", "floor");
    if (floor && after < floor.sequence) {
      const items = this.store.db
        .prepare(
          "SELECT sequence,read_at,data FROM notification_items WHERE read_at IS NULL ORDER BY sequence LIMIT ?",
        )
        .all(size)
        .map((r) => this.row(r));
      return {
        items,
        cursor: items.length ? items.at(-1)!.sequence : floor.sequence,
        resetRequired: true,
      };
    }
    const items = this.store.db
      .prepare(
        "SELECT sequence,read_at,data FROM notification_items WHERE sequence>? ORDER BY sequence LIMIT ?",
      )
      .all(after, size)
      .map((r) => this.row(r));
    return {
      items,
      cursor: items.length ? items[items.length - 1]!.sequence : Math.max(after, 0),
      resetRequired: false,
    };
  }

  get(id: string): NotificationItem {
    const row = this.store.db
      .prepare("SELECT sequence,read_at,data FROM notification_items WHERE id=?")
      .get(id);
    if (!row) throw new KodoError("NOT_FOUND", "通知不存在。");
    return this.row(row);
  }

  /** Reading a notification never resolves the underlying inbox request. */
  markRead(id: string): NotificationItem {
    this.get(id);
    this.store.db
      .prepare("UPDATE notification_items SET read_at=COALESCE(read_at,?) WHERE id=?")
      .run(new Date().toISOString(), id);
    return this.get(id);
  }

  /** Read notifications are kept 30 days, unread ones 180; the floor drives resetRequired. */
  collect(now = Date.now()): number {
    return this.store.transaction(() => {
      const readCutoff = new Date(now - RETAIN_READ_DAYS * 86400000).toISOString(),
        unreadCutoff = new Date(now - RETAIN_UNREAD_DAYS * 86400000).toISOString();
      const doomed = this.store.db
        .prepare(
          "SELECT MAX(sequence) AS top, COUNT(*) AS n FROM notification_items WHERE (read_at IS NOT NULL AND created_at<?) OR created_at<?",
        )
        .get(readCutoff, unreadCutoff)!;
      const removed = Number(doomed.n);
      if (!removed) return 0;
      this.store.db
        .prepare(
          "DELETE FROM notification_items WHERE (read_at IS NOT NULL AND created_at<?) OR created_at<?",
        )
        .run(readCutoff, unreadCutoff);
      const previous = this.store.record<{ sequence: number }>("notification-retention", "floor");
      this.store.put("notification-retention", "floor", {
        sequence: Math.max(previous?.sequence ?? 0, Number(doomed.top)),
      });
      return removed;
    });
  }
}
