import type { RuntimeEvent } from "@kodo/protocol";

type Value = Record<string, any>;
export interface TurnFile {
  path: string;
  added?: number;
  removed?: number;
}
const object = (value: unknown): Value => {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" ? (value as Value) : {};
};

/** Completed edit tools only; workspace Git status cannot establish per-turn authorship. */
export function editedFiles(events: RuntimeEvent[]): TurnFile[] {
  const calls = new Map<string, Value>();
  const consume = (event: { type: string; payload: unknown }, owner = "root") => {
    const p = object(event.payload);
    if (event.type === "subagent" && p.event) return consume(p.event, `${owner}/${p.agentId}`);
    if (event.type !== "tool") return;
    const data = object(p.data ?? p);
    const id =
      data.toolCallId ??
      data.tool_use_id ??
      data.tool_call_id ??
      data.callId ??
      data.id ??
      data.frameId;
    const key = `${owner}:${id ?? calls.size}`;
    const previous = calls.get(key) ?? {};
    calls.set(key, { ...previous, ...data, state: { ...previous.state, ...data.state } });
  };
  for (const event of events) consume(event);
  const files = new Map<string, TurnFile>();
  const add = (path: unknown, diff?: unknown) => {
    if (typeof path !== "string" || !path.trim() || path.includes("\n") || path.length > 4096)
      return;
    const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
    const current = files.get(normalized) ?? { path: normalized };
    if (typeof diff === "string" && /^(?:@@|\+\+\+|---)/m.test(diff)) {
      const lines = diff.split("\n");
      current.added =
        (current.added ?? 0) +
        lines.filter((s) => s.startsWith("+") && !s.startsWith("+++")).length;
      current.removed =
        (current.removed ?? 0) +
        lines.filter((s) => s.startsWith("-") && !s.startsWith("---")).length;
    }
    files.set(normalized, current);
  };
  for (const data of calls.values()) {
    const phase = data.status ?? data.state?.status ?? data.lifecycle ?? data.type;
    if (
      data.is_error ||
      data.isError ||
      ["failed", "error", "declined", "cancelled"].includes(phase) ||
      (typeof data.exitCode === "number" && data.exitCode !== 0)
    )
      continue;
    if (
      !["completed", "done", "success", "tool_execution_end", "tool/result", "tool/end"].includes(
        phase,
      ) &&
      data.exitCode !== 0
    )
      continue;
    const input = object(
      data.input ??
        data.args ??
        data.arguments ??
        data.rawInput ??
        data.state?.input ??
        data.function?.arguments,
    );
    const name = String(data.name ?? data.toolName ?? data.tool ?? data.function?.name ?? "")
      .split(/[./]/)
      .at(-1)!
      .replace(/[_-]/g, "")
      .toLowerCase();
    if (data.type === "fileChange") {
      for (const change of data.changes ?? []) add(change.path, change.diff);
    } else if (
      [
        "write",
        "writefile",
        "edit",
        "editfile",
        "multiedit",
        "strreplaceeditor",
        "notebookedit",
        "createfile",
        "replaceinfile",
      ].includes(name)
    ) {
      add(input.file_path ?? input.path ?? input.filePath ?? input.notebook_path);
    } else if (name === "applypatch") {
      const patch =
        typeof data.input === "string"
          ? data.input
          : (input.patch ?? input.input ?? input.patchText);
      if (typeof patch === "string")
        for (const match of patch.matchAll(
          /^\*\*\* (?:Add|Update|Delete) File: (.+)$|^\*\*\* Move to: (.+)$/gm,
        ))
          add(match[1] ?? match[2]);
    }
    // ACP edit tools carry actual old/new content in typed diff blocks.
    if (data.kind === "edit")
      for (const content of data.content ?? []) if (content.type === "diff") add(content.path);
  }
  return [...files.values()];
}

export function completedTurnFiles(events: RuntimeEvent[]): Map<string, TurnFile[]> {
  const summaries = new Map<string, TurnFile[]>();
  let turn: RuntimeEvent[] = [];
  let closed = false;
  for (const event of events) {
    if (event.type === "message" && object(event.payload).role === "user") {
      turn = [];
      closed = false;
    }
    if (closed && !["settled", "state", "usage"].includes(event.type)) {
      turn = [];
      closed = false;
    }
    turn.push(event);
    if (!closed && ["turn-ended", "settled"].includes(event.type)) {
      const files = editedFiles(turn);
      if (files.length) summaries.set(event.id, files);
      closed = true;
    }
  }
  return summaries;
}
