import type { RuntimeEvent, Session } from "./index.js";

export interface ConversationMark {
  id: string;
  eventId: string;
  sequence: number;
  label: string;
}

/** A compact directory of user turns; independent of the loaded event window. */
export function conversationMessageIndex(
  events: RuntimeEvent[],
  conversation?: Session["conversation"],
) {
  const path = conversationEvents(events, conversation);
  const replaced = new Set(
    path.map((e) => (e.payload as { replaceEventId?: string })?.replaceEventId),
  );
  const marks = new Map<string, ConversationMark>();
  for (const event of path) {
    const p = event.payload as {
      role?: string;
      id?: string;
      text?: unknown;
      content?: unknown;
      attachments?: unknown[];
    };
    if (event.type !== "message" || p?.role !== "user" || replaced.has(event.id)) continue;
    const text =
      typeof p.text === "string"
        ? p.text
        : typeof p.content === "string"
          ? p.content
          : Array.isArray(p.content)
            ? p.content.map((part) => (typeof part?.text === "string" ? part.text : "")).join("\n")
            : "";
    if (!text && !p.attachments?.length) continue;
    const id = `message-${p.id ? `message:${p.id}` : event.id}`;
    const previous = marks.get(id);
    marks.set(id, {
      id,
      eventId: previous?.eventId ?? event.id,
      sequence: previous?.sequence ?? event.sequence,
      label: text.replace(/\s+/g, " ").trim().slice(0, 80) || "附件消息",
    });
  }
  return [...marks.values()];
}

/** The immutable event log retains every variant; only the chosen path is rendered/sent. */
export function conversationEvents(events: RuntimeEvent[], conversation?: Session["conversation"]) {
  if (!conversation) return events;
  const branch = conversation.branches.find((item) => item.id === conversation.activeId);
  const prefix = new Set(branch?.prefixEventIds ?? []);
  return events.filter(
    (event) =>
      prefix.has(event.id) || (event.conversationBranchId ?? "root") === conversation.activeId,
  );
}
