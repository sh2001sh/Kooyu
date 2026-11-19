import assert from "node:assert/strict";
import { test } from "node:test";
import type { Usage } from "@kodo/protocol";
import { SessionService } from "../src/session-service.js";
import { Store } from "../src/storage/store.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("usage records live firstTokenMs and durationMs and preserves native timing fields", async () => {
  const store = new Store(":memory:");
  const service = new SessionService(store);
  try {
    const session = service.createDraft({
      kind: "direct",
      harnessId: "claude-code",
      title: "Timing test",
    });
    service.ingest(session.id, "message", { role: "user", text: "hi" });
    await sleep(25);
    service.ingest(session.id, "text-delta", { text: "hello" });
    await sleep(30);
    service.ingest(session.id, "usage", {
      scope: "turn",
      sourceId: "turn-live-1",
      input: 120,
      output: 40,
    });
    service.ingest(session.id, "turn-ended", { outcome: "completed" });

    // Second turn with explicit native timing fields
    service.ingest(session.id, "message", { role: "user", text: "second" });
    service.ingest(session.id, "usage", {
      scope: "turn",
      sourceId: "turn-native-2",
      input: 50,
      output: 20,
      firstTokenMs: 420,
      duration_ms: 1850,
    });
    service.ingest(session.id, "turn-ended", { outcome: "completed" });

    const records = service.usageSummary().records;
    const live = records.find((r) => r.id.endsWith(":turn-live-1"));
    assert.ok(live, "live turn usage should exist");
    assert.equal(typeof live.firstTokenMs, "number");
    assert.equal(typeof live.durationMs, "number");
    assert.ok(live.firstTokenMs! >= 10, `expected firstTokenMs >= 10, got ${live.firstTokenMs}`);
    assert.ok(
      live.durationMs! >= live.firstTokenMs!,
      `expected durationMs (${live.durationMs}) >= firstTokenMs (${live.firstTokenMs})`,
    );

    const native = records.find((r) => r.id.endsWith(":turn-native-2"));
    assert.ok(native, "native turn usage should exist");
    assert.equal(native.firstTokenMs, 420);
    assert.equal(native.durationMs, 1850);
  } finally {
    await service.dispose();
    store.close();
  }
});

test("backfillUsageTimings reconstructs historical firstTokenMs and durationMs from events", async () => {
  const store = new Store(":memory:");
  const first = new SessionService(store);
  const session = first.createDraft({
    kind: "direct",
    harnessId: "claude-code",
    title: "Legacy timing",
  });
  await first.dispose();

  // Seed historical events + legacy usage record without firstTokenMs/durationMs
  const t0 = Date.parse("2026-11-18T10:00:00.000Z");
  store.append({
    id: "ev-user-1",
    sessionId: session.id,
    nativeRunId: null,
    type: "message",
    payload: { role: "user", text: "analyze project" },
    source: "claude-code",
    createdAt: new Date(t0).toISOString(),
  });
  store.append({
    id: "ev-delta-1",
    sessionId: session.id,
    nativeRunId: null,
    type: "text-delta",
    payload: { text: "Sure..." },
    source: "claude-code",
    createdAt: new Date(t0 + 1350).toISOString(),
  });
  store.append({
    id: "ev-usage-1",
    sessionId: session.id,
    nativeRunId: null,
    type: "usage",
    payload: { scope: "turn", sourceId: "legacy-u1", input: 500, output: 120 },
    source: "claude-code",
    createdAt: new Date(t0 + 6420).toISOString(),
  });
  store.append({
    id: "ev-end-1",
    sessionId: session.id,
    nativeRunId: null,
    type: "turn-ended",
    payload: { outcome: "completed" },
    source: "claude-code",
    createdAt: new Date(t0 + 6500).toISOString(),
  });

  const legacyTurn: Usage = {
    id: `${session.id}:turn:legacy-u1`,
    sessionId: session.id,
    projectId: null,
    bindingId: null,
    source: "claude-code",
    scope: "turn",
    input: 500,
    output: 120,
    cacheRead: null,
    cacheWrite: null,
    costUsd: 0.002,
    costKind: "estimate",
    model: "gemini-4-argon",
    createdAt: new Date(t0 + 6420).toISOString(),
  };
  const legacySession: Usage = {
    ...legacyTurn,
    id: `${session.id}:session:${session.id}`,
    scope: "session",
  };
  store.put("usage", legacyTurn.id, legacyTurn);
  store.put("usage", legacySession.id, legacySession);

  const reopened = new SessionService(store);
  try {
    const records = reopened.usageSummary().records;
    const backfilled = records.find((r) => r.id === legacyTurn.id)!;
    assert.equal(backfilled.firstTokenMs, 1350);
    assert.equal(backfilled.durationMs, 6420);

    const snapshot = records.find((r) => r.id === legacySession.id)!;
    assert.equal(snapshot.firstTokenMs, undefined);
    assert.equal(snapshot.durationMs, undefined);
  } finally {
    await reopened.dispose();
    store.close();
  }
});
