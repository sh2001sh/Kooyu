import type { InboxItem, Snapshot } from "@kodo/protocol";

export interface NativeAction {
  label: string;
  answer: Record<string, unknown>;
  destructive?: boolean;
}

/** Share the same native answers as the web UI; never infer missing capabilities. */
export function nativeActions(item: InboxItem): NativeAction[] {
  if (item.resolved || item.type !== "interaction") return [];
  const p = item.payload as Record<string, any> | null;
  if (!p || typeof p !== "object") return [];
  if (p.protocol === "acp") {
    const options = Array.isArray(p.options) ? p.options : [];
    return [
      ...options
        .filter((o: any) => o && typeof o.optionId === "string" && typeof o.name === "string")
        .map((o: any) => ({
          label: o.name,
          answer: { outcome: { outcome: "selected", optionId: o.optionId } },
        })),
      { label: "取消请求", answer: { outcome: { outcome: "cancelled" } }, destructive: true },
    ];
  }
  if (
    p.toolName === "AskUserQuestion" ||
    p.method === "item/tool/requestUserInput" ||
    p.type === "question.asked" ||
    p.method === "question/request"
  )
    return [];
  const approval =
    p.protocol === "claude" ||
    String(p.method ?? "").includes("requestApproval") ||
    p.method === "approval/request" ||
    p.type === "permission.asked";
  if (!approval) return [];
  const answers: Record<string, [Record<string, unknown>, Record<string, unknown>]> = {
    claude: [{ behavior: "allow" }, { behavior: "deny" }],
    opencode: [{ reply: "once" }, { reply: "reject" }],
    dsh: [{ outcome: "allowed-once" }, { outcome: "rejected" }],
    codex: [{ decision: "accept" }, { decision: "decline" }],
    kodo: [{ decision: "accept" }, { decision: "decline" }],
  };
  const pair = Object.hasOwn(answers, p.protocol) ? answers[p.protocol] : undefined;
  return pair
    ? [
        { label: "允许本次", answer: pair[0] },
        { label: "拒绝", answer: pair[1], destructive: true },
      ]
    : [];
}

export function nativeSnapshot(snapshot: Snapshot) {
  return {
    ...snapshot,
    inbox: snapshot.inbox.map((item) => ({ ...item, actions: nativeActions(item) })),
  };
}
