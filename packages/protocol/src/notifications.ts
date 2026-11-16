/**
 * A NotificationItem records that something happened which may need the user.
 * It is separate from InboxItem (the request that must be handled) and from any
 * delivery attempt. Read, delivered and handled are three different facts.
 */
export const NOTIFICATION_KINDS = [
  "approval-required",
  "question",
  "goal-blocked",
  "limit-paused",
  "goal-awaiting-review",
  "goal-completed",
  "supervision-notice",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Public channel metadata. Provider signing keys and device tokens are Vault-only. */
export interface NotificationChannel {
  id: string;
  deviceId: string;
  kind: "bark" | "client" | "apns";
  revision: number;
  enabled: boolean;
  preview: boolean;
  providerRevision?: number | null;
  unavailableReason?: string | null;
}

export interface NotificationItem {
  /** Stable per fact; replaying the same fact never creates a second item. */
  id: string;
  /** Monotonic Host cursor for resumable reads. */
  sequence: number;
  kind: NotificationKind;
  /** Lock-screen safe text; never contains tool output, tokens or credentials. */
  title: string;
  /** Opt-in preview shown only where the user enabled previews. */
  preview: string | null;
  sessionId: string | null;
  goalId: string | null;
  inboxItemId: string | null;
  /** Deep link target; clients re-verify the Host and fetch current state. */
  link: {
    hostId: string;
    sessionId: string | null;
    goalId: string | null;
    inboxItemId: string | null;
  };
  createdAt: string;
  readAt: string | null;
}

export interface NotificationPage {
  items: NotificationItem[];
  cursor: number;
  /**
   * The requested cursor is older than the retention window. `items` then holds the
   * current unread snapshot; clients rebuild instead of treating history as new.
   */
  resetRequired: boolean;
}
