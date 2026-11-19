import assert from "node:assert/strict";
import { test } from "node:test";
import type { Command, RuntimeEvent } from "@kodo/protocol";
import {
  completedCommandIds,
  reconcileCompletedCommands,
} from "../../../apps/web/src/lib/command-completion.js";

test("a failed turn confirms only its delivery, keeping unrelated queued and uncertain commands", () => {
  const events = [
    { type: "message", payload: { role: "user", commandId: "first" } },
    { type: "turn-ended", payload: { outcome: "failed", commandId: "first" } },
    { type: "settled", payload: {} },
  ] as RuntimeEvent[];
  const commands = [
    { id: "first", kind: "send", status: "dispatched" },
    { id: "second", kind: "send", status: "accepted" },
    { id: "unknown", kind: "send", status: "unknown" },
  ] as Command[];
  const reconciled = reconcileCompletedCommands(commands, completedCommandIds(events));
  assert.deepEqual(
    reconciled.map((c) => c.status),
    ["confirmed", "accepted", "unknown"],
  );
  assert.equal(commands[0]!.status, "dispatched");
  assert.equal(reconcileCompletedCommands(reconciled, completedCommandIds(events)), reconciled);
});

test("uncorrelated native terminals follow the dispatched user message, never child or error text", () => {
  const events = [
    { type: "message", payload: { role: "user", commandId: "first" } },
    { type: "message", payload: { role: "assistant", text: "An error happened" } },
    { type: "subagent", payload: { event: { type: "turn-ended" } } },
  ] as RuntimeEvent[];
  assert.equal(completedCommandIds(events).size, 0);
  assert.deepEqual(
    [
      ...completedCommandIds([
        ...events,
        { type: "turn-ended", payload: { outcome: "failed" } } as RuntimeEvent,
      ]),
    ],
    ["first"],
  );
  assert.equal(
    completedCommandIds([{ type: "turn-ended", payload: {} }] as RuntimeEvent[]).size,
    0,
  );
});
