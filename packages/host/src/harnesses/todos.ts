import type { TodoItem, TodoList } from "@kodo/protocol";
import type { Wire } from "./adapter.js";

export interface TodoState {
  list?: TodoList;
  calls: Record<string, { name: string; input: Wire }>;
}
const names = new Set([
  "todowrite",
  "writetodos",
  "settodolist",
  "updatetodolist",
  "updateplan",
  "taskcreate",
  "taskupdate",
  "tasklist",
]);
const object = (value: unknown): Wire => {
  if (typeof value === "string") {
    try {
      return object(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Wire) : {};
};
function status(value: unknown): TodoItem["status"] {
  const key = String(value ?? "")
    .replace(/[-\s]/g, "_")
    .toLowerCase();
  if (["completed", "done", "complete"].includes(key)) return "completed";
  if (["in_progress", "inprogress", "running", "active"].includes(key)) return "in_progress";
  if (["pending", "todo", "not_started"].includes(key)) return "pending";
  if (["cancelled", "canceled", "deleted"].includes(key)) return "cancelled";
  if (key === "blocked") return "blocked";
  return "unknown";
}
export function todoItems(value: unknown): TodoItem[] | undefined {
  if (!Array.isArray(value)) return;
  // Reject malformed snapshots rather than erase the last known valid list.
  if (
    value.length > 1000 ||
    value.some(
      (item) =>
        !item ||
        typeof item !== "object" ||
        typeof (item.content ?? item.text ?? item.step ?? item.subject ?? item.title) !== "string",
    )
  )
    return;
  return value.map((item: Wire, index) => ({
    id: String(item.id ?? item.taskId ?? index),
    text: item.content ?? item.text ?? item.step ?? item.subject ?? item.title,
    status: status(item.status ?? item.state),
    ...(typeof item.priority === "string" ? { priority: item.priority } : {}),
  }));
}
function snapshot(value: Wire): TodoItem[] | undefined {
  return todoItems(value.items ?? value.todos ?? value.tasks ?? value.plan ?? value.entries);
}
function complete(state: TodoState, name: string, input: Wire, output: unknown, at: string) {
  const result = object(output);
  if (result.isError || result.is_error || result.error) return;
  const items =
    snapshot(result) ?? snapshot(input) ?? (Array.isArray(output) ? todoItems(output) : undefined);
  if (items) {
    state.list = {
      items,
      updatedAt: at,
      ...(typeof input.explanation === "string" ? { explanation: input.explanation } : {}),
    };
    return;
  }
  if (!["taskcreate", "taskupdate"].includes(name)) return;
  const task = object(result.task);
  const id =
    input.taskId ??
    result.taskId ??
    task.id ??
    result.id ??
    (typeof output === "string"
      ? /Task #?(\d+) created successfully/i.exec(output)?.[1]
      : undefined);
  if (id === undefined) return;
  const previous = state.list?.items ?? [];
  const existing = previous.find((item) => item.id === String(id));
  if (input.status === "deleted") {
    state.list = { items: previous.filter((item) => item.id !== String(id)), updatedAt: at };
    return;
  }
  const text = input.subject ?? task.subject ?? existing?.text;
  if (typeof text !== "string" || !text) return;
  const item: TodoItem = {
    id: String(id),
    text,
    status:
      input.status !== undefined
        ? status(input.status)
        : task.status !== undefined
          ? status(task.status)
          : (existing?.status ?? "pending"),
  };
  state.list = {
    items: existing
      ? previous.map((old) => (old.id === item.id ? item : old))
      : [...previous, item],
    updatedAt: at,
  };
}

/** Interpret only native task notifications and acknowledged task tools, never assistant prose. */
export function acceptTodos(state: TodoState, type: string, raw: unknown, at: string) {
  const p = object(raw);
  if (
    type === "todo" ||
    (type === "state" &&
      (p.sessionUpdate === "plan" ||
        /(?:^|[./])(?:todo(?:s)?(?:[./]updated)?|plan[./]updated)$/.test(
          String(p.method ?? p.type ?? ""),
        )))
  ) {
    const items = snapshot(p);
    if (items)
      state.list = {
        items,
        updatedAt: at,
        ...(typeof p.explanation === "string" ? { explanation: p.explanation } : {}),
      };
    return;
  }
  if (type !== "tool") return;
  if (Array.isArray(p.content)) {
    for (const block of p.content) {
      if (block.type !== "tool_result") continue;
      const call = state.calls[block.tool_use_id];
      if (!call) continue;
      delete state.calls[block.tool_use_id];
      if (block.is_error) continue;
      const output = Array.isArray(block.content)
        ? block.content
            .filter((c: Wire) => c.type === "text")
            .map((c: Wire) => c.text)
            .join("\n")
        : block.content;
      complete(state, call.name, call.input, output, at);
    }
  }
  const data = p.data && typeof p.data === "object" ? p.data : p;
  const rawName = data.name ?? data.toolName ?? data.tool ?? data.function?.name;
  if (typeof rawName !== "string") return;
  const name = rawName.split(/[./]/).at(-1)!.replace(/[_-]/g, "").toLowerCase();
  if (!names.has(name)) return;
  const input = object(
    data.input ??
      data.args ??
      data.arguments ??
      data.state?.input ??
      data.rawInput ??
      data.function?.arguments,
  );
  const id = data.toolCallId ?? data.tool_call_id ?? data.callId ?? data.id ?? data.frameId;
  const phase = data.lifecycle ?? data.status ?? data.state?.status ?? p.type;
  const failed = data.isError || data.is_error || ["failed", "error"].includes(String(phase));
  if (failed) {
    if (id) delete state.calls[id];
    return;
  }
  if (
    ["completed", "done", "success", "tool_execution_end", "tool/result", "tool/end"].includes(
      String(phase),
    )
  ) {
    const call = (id ? state.calls[id] : undefined) ?? { name, input };
    if (id) delete state.calls[id];
    complete(
      state,
      call.name,
      Object.keys(input).length ? input : call.input,
      data.output ?? data.result ?? data.state?.output,
      at,
    );
  } else if (id) {
    state.calls[id] = { name, input };
    // Bound abandoned tool requests; they are never treated as successful updates.
    const keys = Object.keys(state.calls);
    for (const key of keys.slice(0, Math.max(0, keys.length - 256))) delete state.calls[key];
  }
}
