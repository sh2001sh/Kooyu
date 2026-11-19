import assert from "node:assert/strict";
import { test } from "node:test";
import type { RuntimeEvent } from "@kodo/protocol";
import { editedFiles, completedTurnFiles } from "../../../apps/web/src/lib/turn-files.js";
const ev = (type: string, payload: unknown, id = "event") =>
  ({ type, payload, id }) as RuntimeEvent;

test("edit evidence merges native receipts, excludes read/failed/unconfirmed tools and deduplicates files", () => {
  const events = [
    ev("tool", {
      type: "tool_use",
      id: "write",
      name: "Write",
      input: { file_path: "docs/方案.md" },
      lifecycle: "started",
    }),
    ev("tool", { type: "tool_result", toolCallId: "write", status: "completed" }),
    ev("tool", {
      id: "edit",
      name: "Edit",
      input: { file_path: "docs/方案.md" },
      status: "completed",
    }),
    ev("tool", { id: "read", name: "Read", input: { file_path: "read.md" }, status: "completed" }),
    ev("tool", {
      id: "failed",
      name: "Write",
      input: { file_path: "failed.md" },
      is_error: true,
      status: "completed",
    }),
    ev("tool", {
      id: "waiting",
      name: "Write",
      input: { file_path: "waiting.md" },
      lifecycle: "started",
    }),
    ev("tool", {
      id: "patch",
      type: "fileChange",
      status: "completed",
      changes: [{ path: "src/a.ts", diff: "@@ -1 +1 @@\n-old\n+new\n+another" }],
    }),
    ev("tool", {
      id: "oc",
      tool: "write",
      state: { status: "completed", input: { filePath: "src/oc.ts" } },
    }),
    ev("tool", {
      id: "pi",
      toolName: "edit",
      args: { path: "src/pi.ts" },
      type: "tool_execution_end",
    }),
    ev("tool", {
      id: "acp",
      kind: "edit",
      status: "completed",
      content: [{ type: "diff", path: "src/acp.ts", newText: "value" }],
    }),
    ev("subagent", {
      agentId: "child",
      event: {
        type: "tool",
        payload: {
          id: "write",
          name: "Write",
          input: { file_path: "child.md" },
          status: "completed",
        },
      },
    }),
  ];
  assert.deepEqual(editedFiles(events), [
    { path: "docs/方案.md" },
    { path: "src/a.ts", added: 2, removed: 1 },
    { path: "src/oc.ts" },
    { path: "src/pi.ts" },
    { path: "src/acp.ts" },
    { path: "child.md" },
  ]);
});

test("per-turn summaries never carry edits over to another turn or duplicate settled", () => {
  const user = ev("message", { role: "user", text: "write" });
  const write = (path: string) =>
    ev("tool", { name: "write", input: { path }, status: "completed" });
  const summaries = completedTurnFiles([
    user,
    write("first.md"),
    ev("turn-ended", {}, "end1"),
    ev("settled", {}, "settled1"),
    user,
    ev("turn-ended", {}, "end2"),
    user,
    write("third.md"),
    ev("turn-ended", { outcome: "failed" }, "end3"),
    user,
    write("running.md"),
  ]);
  assert.deepEqual(
    [...summaries],
    [
      ["end1", [{ path: "first.md" }]],
      ["end3", [{ path: "third.md" }]],
    ],
  );
});

test("apply patch records literal affected filenames, never command guesses", () => {
  assert.deepEqual(
    editedFiles([
      ev("tool", {
        name: "apply_patch",
        input:
          "*** Begin Patch\n*** Update File: src/a.ts\n@@\n-a\n+b\n*** Add File: docs/new.md\n+new\n*** End Patch",
        status: "completed",
      }),
      ev("tool", { type: "commandExecution", command: "echo output > unknown.txt", exitCode: 0 }),
    ]),
    [{ path: "src/a.ts" }, { path: "docs/new.md" }],
  );
});
