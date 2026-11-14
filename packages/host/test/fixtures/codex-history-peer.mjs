// Stored tree fixture: archived grandchild precedes parent, plus an unrelated thread.
import { createInterface } from "node:readline";
import { appendFileSync } from "node:fs";
const source = (parent) => ({ subagent: { thread_spawn: { parent_thread_id: parent } } });
for await (const line of createInterface({ input: process.stdin })) {
  const r = JSON.parse(line);
  if (process.env.SYNTHETIC_WIRE_LOG)
    appendFileSync(process.env.SYNTHETIC_WIRE_LOG, JSON.stringify(r) + "\n");
  if (r.id === undefined) continue;
  let result;
  if (r.method === "initialize") result = {};
  else if (r.method === "thread/resume") result = { thread: { id: "root", turns: [] } };
  else if (r.method === "thread/list") {
    if (!r.params.sourceKinds?.includes("subAgentThreadSpawn") || r.params.modelProviders.length)
      throw new Error("Filtered listing loses descendants");
    result = r.params.archived
      ? { data: [{ id: "grandchild", source: source("child") }], nextCursor: null }
      : r.params.cursor
        ? { data: [{ id: "child", source: source("root") }], nextCursor: null }
        : { data: [{ id: "foreign", source: source("other-root") }], nextCursor: "next" };
  } else if (r.method === "thread/read") {
    const id = r.params.threadId;
    if (id === "foreign") throw new Error("Unrelated thread read");
    if (id === "child" && process.env.SYNTHETIC_MISSING_CHILD) {
      process.stdout.write(
        JSON.stringify({
          id: r.id,
          error: { code: -32000, message: "child history unavailable" },
        }) + "\n",
      );
      continue;
    }
    result = {
      thread: {
        id,
        ...(id === "root" ? {} : { source: source(id === "child" ? "root" : "child") }),
        turns: [
          {
            id: id + "-turn",
            status: "completed",
            items: [
              { id: id + "-message", type: "agentMessage", text: id + " saved output" },
              { id: id + "-tool", type: "commandExecution", command: "historical command" },
            ],
          },
        ],
      },
    };
  } else throw new Error("Unexpected method " + r.method);
  process.stdout.write(JSON.stringify({ id: r.id, result }) + "\n");
}
