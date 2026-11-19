import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/storage/store.js";
import { SessionService } from "../src/session-service.js";
import { agentTranscript, sessionActivity } from "../src/session-activity.js";

test("status-only agents open without errors; old projections rebuild failed native tool status", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kooyu-agent-pages-"));
  const store = new Store(":memory:");
  const service = new SessionService(store, { dataDir: dir });
  const session = service.createDraft({
    title: "Synthetic agent",
    harnessId: "claude-code",
    kind: "direct",
  });
  try {
    service.ingest(session.id, "subagent", {
      agentId: "tool-agent",
      toolCallId: "tool-agent",
      status: "running",
    });
    assert.deepEqual(agentTranscript(store, session.id, "tool-agent").events, []);
    service.ingest(session.id, "subagent", {
      agentId: "tool-agent",
      status: "running",
      event: {
        type: "tool",
        payload: {
          type: "tool_result",
          tool_use_id: "tool-agent",
          is_error: true,
          content: "InputValidationError: malformed JSON",
        },
      },
    });
    store.put("session-activity", session.id, {
      cursor: store.latestSequence(),
      root: { calls: {} },
      agents: {
        "tool-agent": { agentId: "tool-agent", status: "running", tasks: { calls: {} } },
      },
    });
    assert.equal(sessionActivity(store, session.id).agents[0]?.status, "failed");
    const page = agentTranscript(store, session.id, "tool-agent");
    assert.equal(page.events.length, 1);
    assert.equal((page.events[0]?.payload as { status: string }).status, "failed");
    assert.equal((page.events[0]?.payload as { toolCallId: string }).toolCallId, "tool-agent");
    service.ingest(session.id, "subagent", {
      agentId: "other-agent",
      status: "running",
      event: {
        type: "tool",
        payload: { type: "tool_result", tool_use_id: "internal-tool", is_error: true },
      },
    });
    assert.equal(
      sessionActivity(store, session.id).agents.find((a) => a.agentId === "other-agent")?.status,
      "running",
    );
  } finally {
    await service.dispose();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("agent history pagination counts transcript events, independently of status-only notices", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kooyu-agent-pages-"));
  const store = new Store(":memory:");
  const service = new SessionService(store, { dataDir: dir });
  const session = service.createDraft({
    title: "Synthetic agent pages",
    harnessId: "pi",
    kind: "direct",
  });
  try {
    for (let i = 0; i < 305; i++) {
      service.ingest(session.id, "subagent", { agentId: "reader", status: "running" });
      service.ingest(session.id, "subagent", {
        agentId: "reader",
        event: { type: "message", payload: { role: "assistant", text: `answer ${i}` } },
      });
    }
    service.ingest(session.id, "subagent", { agentId: "empty", status: "running" });
    const tail = agentTranscript(store, session.id, "reader");
    assert.equal(tail.events.length, 300);
    assert.ok(tail.olderCursor);
    const earlier = agentTranscript(store, session.id, "reader", tail.olderCursor!);
    assert.equal(earlier.events.length, 5);
    assert.equal(earlier.olderCursor, null);
    assert.equal(new Set([...earlier.events, ...tail.events].map((e) => e.sequence)).size, 305);
    assert.throws(() => agentTranscript(store, session.id, "missing"), /没有该子代理/);
  } finally {
    await service.dispose();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
