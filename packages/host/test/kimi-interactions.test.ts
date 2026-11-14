import assert from "node:assert/strict";
import { test } from "node:test";
import { kimiInteractionResponse } from "../src/harnesses/kimi-interactions.js";

test("Kimi preserves native approval feedback and normalizes decisions", () => {
  assert.deepEqual(
    kimiInteractionResponse("approval", {
      decision: "accept",
      scope: "session",
      feedback: "allowed",
      selected_label: "Read",
      injected: true,
    }),
    {
      kind: "approval",
      decision: "approved",
      scope: "session",
      feedback: "allowed",
      selected_label: "Read",
    },
  );
  assert.deepEqual(kimiInteractionResponse("approval", { decision: "decline" }), {
    kind: "approval",
    decision: "rejected",
  });
  assert.deepEqual(kimiInteractionResponse("approval", { decision: "accept", cancelled: true }), {
    kind: "approval",
    decision: "cancelled",
  });
  assert.throws(() => kimiInteractionResponse("approval", { decision: "anything" }), /格式无效/);
  assert.throws(
    () => kimiInteractionResponse("approval", { decision: "approved", scope: "global" }),
    /格式无效/,
  );
});

test("Kimi preserves all documented native question variants and strips extra fields", () => {
  const answers = {
    single: { kind: "single", option_id: "one" },
    multi: { kind: "multi", option_ids: ["one", "two"] },
    other: { kind: "other", text: "free text" },
    combined: { kind: "multi_with_other", option_ids: ["one"], other_text: "also" },
    skipped: { kind: "skipped" },
  };
  const supplied = Object.fromEntries(
    Object.entries(answers).map(([id, value]) => [id, { ...value, injected: true }]),
  );
  assert.deepEqual(
    kimiInteractionResponse("question", {
      kind: "approval",
      decision: "approved",
      answers: supplied,
      method: "click",
      note: "user choice",
    }),
    { kind: "question", answers, method: "click", note: "user choice" },
  );
  assert.deepEqual(kimiInteractionResponse("question", { cancelled: true }), {
    kind: "question",
    dismissed: true,
  });
  assert.deepEqual(kimiInteractionResponse("question", { dismissed: true }), {
    kind: "question",
    dismissed: true,
  });
});

test("Kimi rejects malformed question responses before native submission", () => {
  for (const value of [
    null,
    [],
    {},
    { answers: [], dismissed: true },
    { answers: {}, dismissed: true },
    { dismissed: false },
    { answers: { q: { kind: "single", option_id: "" } } },
    { answers: { q: { kind: "multi", option_ids: [] } } },
    { answers: { q: { kind: "multi_with_other", option_ids: [1], other_text: "bad" } } },
    { answers: { q: { kind: "other", text: 1 } } },
    { answers: {}, method: "unknown" },
  ])
    assert.throws(() => kimiInteractionResponse("question", value), /格式无效/);
});
