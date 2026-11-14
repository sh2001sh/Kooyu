// Read-only synthetic Codex peer: never creates threads or runs a model.
import { createInterface } from "node:readline";
import { appendFileSync } from "node:fs";
const write = (value) => process.stdout.write(JSON.stringify(value) + "\n");
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (process.env.STATUS_CALL_LOG)
    appendFileSync(process.env.STATUS_CALL_LOG, request.method + "\n");
  if (request.id === undefined) continue;
  if (request.method === "initialize") {
    write({ jsonrpc: "2.0", id: request.id, result: {} });
    continue;
  }
  if (request.method === "thread/list") {
    const params = request.params;
    const valid =
      Array.isArray(params.modelProviders) &&
      params.modelProviders.length === 0 &&
      [
        "cli",
        "vscode",
        "exec",
        "appServer",
        "unknown",
        "subAgent",
        "subAgentReview",
        "subAgentCompact",
        "subAgentThreadSpawn",
        "subAgentOther",
      ].every((kind) => params.sourceKinds?.includes(kind));
    const mode = process.env.STATUS_LIST_MODE;
    if (!valid || mode === "permission") {
      write({
        id: request.id,
        error: { code: -32600, message: "permission denied listing threads" },
      });
    } else if (mode === "malformed") {
      write({ id: request.id, result: { data: [], nextCursor: 17 } });
    } else if (mode === "repeated-cursor") {
      write({ id: request.id, result: { data: [], nextCursor: "again" } });
    } else {
      const ids = params.archived
        ? ["archived", "unloaded-archived"]
        : params.cursor
          ? ["unloaded-present"]
          : ["present"];
      write({
        id: request.id,
        result: {
          data: ids.map((id) => ({ id })),
          nextCursor: params.archived || params.cursor ? null : "second-page",
        },
      });
    }
    continue;
  }
  if (request.method !== "thread/read") {
    write({
      jsonrpc: "2.0",
      id: request.id,
      error: { code: -32601, message: "Unexpected mutation" },
    });
    continue;
  }
  const id = request.params.threadId;
  const message =
    id === "missing"
      ? "no rollout found for thread id missing"
      : id.startsWith("unloaded-")
        ? "thread not loaded: " + id
        : id === "permission"
          ? "permission denied reading thread permission"
          : id === "wrong-id"
            ? "no rollout found for thread id another-id"
            : id === "transport-error"
              ? "storage unavailable for thread transport-error"
              : null;
  write(
    message
      ? { jsonrpc: "2.0", id: request.id, error: { code: -32600, message } }
      : { jsonrpc: "2.0", id: request.id, result: { thread: { id, archived: id === "archived" } } },
  );
}
