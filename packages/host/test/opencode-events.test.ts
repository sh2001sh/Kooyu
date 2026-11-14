import assert from "node:assert/strict";
import { test } from "node:test";
import { OpenCodeEvents } from "../src/harnesses/opencode-events.js";

test("OpenCode role metadata prevents user echo from being presented as an assistant reply", () => {
  const output: any[] = [];
  const events = new OpenCodeEvents((type, payload) => output.push({ type, payload }));
  events.start();
  events.accept("message.part.updated", {
    part: { id: "user-part", messageID: "user", type: "text", text: "marker-in-prompt" },
  });
  events.accept("message.part.delta", { messageID: "user", partID: "user-part", delta: "echo" });
  events.accept("message.updated", { info: { id: "user", role: "user" } });
  assert.equal(output.length, 0);
  events.accept("message.part.updated", {
    part: {
      id: "assistant-part",
      messageID: "assistant",
      type: "text",
      text: "actual native answer",
    },
  });
  events.accept("message.updated", { info: { id: "assistant", role: "assistant" } });
  const messages = output.filter((e) => e.type === "message");
  assert.equal(messages.length, 1);
  assert.equal(messages[0].payload.role, "assistant");
  assert.equal(messages[0].payload.text, "actual native answer");
  events.accept("message.part.delta", {
    messageID: "assistant",
    partID: "assistant-part",
    field: "text",
    delta: " more",
  });
  assert.equal(output.at(-1).type, "text-delta");
});

test("OpenCode idle after a native error never becomes a successful turn; the next turn resets the error", () => {
  const output: any[] = [];
  const events = new OpenCodeEvents((type, payload) => output.push({ type, payload }));
  events.start();
  events.accept("session.error", { error: { name: "APIError", data: { statusCode: 503 } } });
  events.accept("session.idle", {});
  assert.equal(output.at(-1).payload.outcome, "failed");
  events.start();
  events.accept("session.idle", {});
  assert.equal(output.at(-1).payload.outcome, "completed");
  events.start();
  events.accept("message.updated", {
    info: { id: "aborted", role: "assistant", error: { name: "MessageAbortedError" } },
  });
  events.accept("session.idle", {});
  assert.equal(output.at(-1).payload.outcome, "cancelled");
});

test("OpenCode reasoning snapshots restore thought text and retain the live delta channel", () => {
  const output: { type: string; payload: any; key?: string }[] = [];
  const events = new OpenCodeEvents((type, payload, key) => output.push({ type, payload, key }));
  const part = {
    id: "thought",
    messageID: "assistant",
    type: "reasoning",
    text: "stored reasoning",
  };
  // Snapshot can arrive before the role metadata, just like a buffered SSE event.
  events.accept("message.part.updated", { part });
  events.accept("message.updated", { info: { id: "assistant", role: "assistant" } });
  const saved = output.find((e) => e.type === "message")!;
  assert.equal(saved.payload.channel, "thought");
  assert.equal(saved.payload.text, "stored reasoning");
  events.accept("message.part.delta", {
    messageID: "assistant",
    partID: "thought",
    field: "text",
    delta: " more",
  });
  assert.equal(output.at(-1)!.payload.channel, "thought");
  events.accept("message.part.updated", { part });
  assert.equal(output.at(-1)!.key, saved.key);
  assert.ok(!output.some((e) => e.type === "turn-ended"));
});
