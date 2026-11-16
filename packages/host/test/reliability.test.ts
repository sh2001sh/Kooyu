import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Store } from "../src/storage/store.js";
import { SessionService } from "../src/session-service.js";
import { descriptor, type HarnessAdapter, type AdapterContext } from "../src/harnesses/adapter.js";
import type { Command, Usage } from "@kodo/protocol";
const turn = () => new Promise((r) => setTimeout(r, 15));
function setup(
  options: {
    connectGate?: Promise<void>;
    sendGate?: Promise<void>;
    sendError?: boolean;
    partial?: boolean;
    steer?: boolean;
    runtimeSteer?: "supported" | "unsupported";
  } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "kodo-domain-")),
    store = new Store(join(dir, "state.sqlite"));
  const sends: string[] = [],
    cancels: string[] = [],
    contexts = new Map<string, AdapterContext>();
  const adapter: HarnessAdapter = {
    descriptor: {
      ...descriptor(
        "pi",
        "ISOLATED SYNTHETIC TEST PEER",
        "sdk",
        options.steer === false ? [] : ["steer"],
        "Domain test fixture; no model calls",
        options.partial ? "partial" : "implemented",
      ),
      implementation: options.partial ? "partial" : "implemented",
    },
    async connect(s, ctx) {
      contexts.set(s.id, ctx);
      await options.connectGate;
      return {
        nativeSessionId: s.nativeSessionId ?? `test-native:${s.id}`,
        capabilities: options.runtimeSteer ? { steer: options.runtimeSteer } : undefined,
        async send(text, _commandId, mode) {
          sends.push(text);
          if (mode === "steer") return { nativeRunId: null };
          await options.sendGate;
          if (options.sendError) throw new Error("connection lost after native write");
          ctx.emit("turn-ended", { outcome: "completed" });
          ctx.emit("settled", { outcome: "completed" });
          return { nativeRunId: null };
        },
        async cancel() {
          cancels.push(s.id);
        },
        async close() {},
      };
    },
  };
  const service = new SessionService(store, {
    dataDir: dir,
    adapters: [
      adapter,
      {
        ...adapter,
        descriptor: { ...adapter.descriptor, id: "kodo", name: "ISOLATED KODO TEST PEER" },
      },
    ],
  });
  const draft = (kind: "direct" | "supervisor" = "direct") =>
    service.createDraft({ title: kind, harnessId: kind === "supervisor" ? "kodo" : "pi", kind });
  const close = async () => {
    await service.dispose();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  };
  return { store, service, dir, sends, cancels, contexts, draft, close };
}
test("stable request IDs deduplicate user input and reject a different payload", async () => {
  const f = setup();
  try {
    const s = f.draft(),
      requestId = randomUUID();
    const a = f.service.acceptSend(s.id, { requestId, text: "synthetic command" });
    const b = f.service.acceptSend(s.id, { requestId, text: "synthetic command" });
    assert.deepEqual(a, b);
    assert.throws(
      () => f.service.acceptSend(s.id, { requestId, text: "different command" }),
      /不同内容/,
    );
    await turn();
    assert.equal(f.sends.length, 1);
    assert.equal(f.store.command(requestId)?.status, "confirmed");
  } finally {
    await f.close();
  }
});

test("queued withdrawal wins an asynchronous connect race and remains idempotent", async () => {
  let release!: () => void;
  const f = setup({
    connectGate: new Promise<void>((r) => {
      release = r;
    }),
  });
  try {
    const s = f.draft(),
      requestId = randomUUID();
    f.service.acceptSend(s.id, { requestId, text: "must never reach native" });
    await turn();
    assert.equal(f.service.withdrawCommand(s.id, requestId).status, "cancelled");
    assert.equal(f.service.withdrawCommand(s.id, requestId).status, "cancelled");
    release();
    await turn();
    assert.deepEqual(f.sends, []);
    assert.equal(f.store.command(requestId)?.status, "cancelled");
  } finally {
    release();
    await f.close();
  }
});

test("native steer overtakes pending FIFO while an SDK prompt is still awaited", async () => {
  let release!: () => void;
  const f = setup({
    sendGate: new Promise<void>((r) => {
      release = r;
    }),
  });
  try {
    const s = f.draft(),
      first = randomUUID(),
      queued = randomUUID(),
      withdrawn = randomUUID(),
      steer = randomUUID();
    f.service.acceptSend(s.id, { requestId: first, text: "first", mode: "new" });
    await turn();
    assert.throws(
      () =>
        f.service.acceptSend(s.id, { requestId: randomUUID(), text: "busy direct", mode: "new" }),
      /非空闲/,
    );
    assert.throws(() => f.service.withdrawCommand(s.id, first), /不能撤回/);
    f.service.acceptSend(s.id, { requestId: queued, text: "queued", mode: "queue" });
    f.service.acceptSend(s.id, { requestId: withdrawn, text: "withdrawn", mode: "queue" });
    f.service.withdrawCommand(s.id, withdrawn);
    f.service.acceptSend(s.id, { requestId: steer, text: "steer", mode: "steer" });
    await turn();
    assert.deepEqual(f.sends, ["first", "steer"]);
    assert.equal(f.store.command(queued)?.status, "accepted");
    assert.equal(f.store.command(steer)?.status, "confirmed");
    release();
    await turn();
    await turn();
    assert.deepEqual(f.sends, ["first", "steer", "queued"]);
  } finally {
    release();
    await f.close();
  }
});

test("local deletion hides search/history, retains native identity and fences late events across restart", async () => {
  const f = setup();
  try {
    const s = f.draft(),
      controller = f.draft("supervisor"),
      requestId = randomUUID();
    f.service.acceptSend(s.id, { requestId, text: "unique-deletion-marker" });
    await turn();
    const nativeId = f.store.session(s.id).nativeSessionId;
    f.service.watch({ controllerSessionId: controller.id, targetSessionId: s.id, mode: "observe" });
    f.service.watch({
      controllerSessionId: controller.id,
      targetSessionId: s.id,
      mode: "continue",
    });
    assert.equal(f.service.search("unique-deletion-marker").hits.length, 1);
    assert.equal((await f.service.deleteSession(s.id))?.status, "deleted-locally");
    assert.deepEqual(await f.service.deleteSession(s.id), f.store.record("deleted-session", s.id));
    assert.throws(() => f.service.read(s.id), /不存在/);
    assert.equal(f.service.search("unique-deletion-marker").hits.length, 0);
    assert.equal(
      f.service
        .events()
        .some(
          (e) => e.sessionId === s.id && (e.payload as { deleted?: boolean })?.deleted === true,
        ),
      true,
    );
    assert.equal(
      f.service.events().some((e) => e.sessionId === s.id && e.type === "message"),
      false,
    );
    assert.equal(
      f.service.snapshot().sessions.some((x) => x.id === s.id),
      false,
    );
    assert.equal(
      f.store.db.prepare("SELECT native_id FROM native_identity WHERE session_id=?").get(s.id)
        ?.native_id,
      nativeId,
    );
    assert.equal(f.service.ingest(s.id, "settled", {}, "late"), undefined);
    assert.ok(f.store.watches().every((w) => w.state === "revoked"));
    f.store.recover();
    f.service.resumeWork();
    await turn();
    assert.equal(f.sends.length, 1);
    assert.equal(f.store.command(requestId)?.status, "confirmed");
  } finally {
    await f.close();
  }
});

test("deletion refuses active and unknown delivery rather than hiding execution", async () => {
  const f = setup();
  try {
    const s = f.draft();
    f.store.saveSession({ ...s, runState: "running" });
    await assert.rejects(f.service.deleteSession(s.id), /先停止/);
    f.store.saveSession({ ...s, runState: "unknown" });
    await assert.rejects(f.service.deleteSession(s.id), /先停止/);
    assert.equal(f.store.sessions().length, 1);
  } finally {
    await f.close();
  }
});

test("search location returns bounded context for an early event and distinguishes native snapshots", async () => {
  const f = setup();
  try {
    const s = f.draft(),
      other = f.draft();
    for (let i = 0; i < 1000; i++) {
      f.service.ingest(
        s.id,
        "message",
        { id: `m-${i}`, role: "assistant", text: i === 10 ? "唯一早期命中" : `line ${i}` },
        `e-${i}`,
      );
      f.service.ingest(other.id, "state", {}, `other-${i}`);
    }
    const hit = f.service.search("早期").hits[0]!;
    assert.equal(hit.eventId, "e-10");
    assert.equal(
      f.service.readPage(s.id).events.some((e) => e.id === hit.eventId),
      false,
    );
    const located = f.service.readPage(s.id, undefined, hit.eventId);
    assert.ok(located.events.length <= 300);
    assert.ok(located.events.some((e) => e.id === hit.eventId));
    assert.equal(located.events[0]!.id, "e-0");
    assert.throws(() => f.service.readPage(other.id, undefined, hit.eventId), /不可用/);
    f.store.put("native-history", s.id, {
      eventId: "native-history:hash",
      history: [{ role: "assistant", text: "native snapshot" }],
    });
    const native = f.service.readPage(s.id, undefined, "native-history:hash");
    assert.equal(native.events.length, 0);
    assert.ok("nativeHistory" in native);
    assert.throws(() => f.service.readPage(s.id, undefined, "native-history:stale"), /重新搜索/);
  } finally {
    await f.close();
  }
});
test("two queued user messages retain order when user takeover invalidates automation", async () => {
  const f = setup();
  try {
    const s = f.draft();
    f.service.acceptSend(s.id, { requestId: randomUUID(), text: "first" });
    f.service.acceptSend(s.id, { requestId: randomUUID(), text: "second" });
    await turn();
    assert.deepEqual(f.sends, ["first", "second"]);
  } finally {
    await f.close();
  }
});
test("watch replays fast completion, deduplicates event and never calls a model for observe/notify", async () => {
  const f = setup();
  try {
    const c = f.draft("supervisor"),
      s = f.draft();
    f.service.ingest(s.id, "turn-ended", { outcome: "completed" }, "native-event-1", "run-1");
    f.service.watch({ controllerSessionId: c.id, targetSessionId: s.id, mode: "notify" });
    f.service.ingest(s.id, "turn-ended", { outcome: "completed" }, "native-event-1", "run-1");
    f.service.ingest(s.id, "turn-ended", { outcome: "completed" }, "native-event-2", "run-2");
    await turn();
    assert.equal(f.sends.length, 0);
    assert.equal(f.store.records("inbox").length, 1);
    assert.equal(f.store.events(s.id).filter((e) => e.id === "native-event-1").length, 1);
  } finally {
    await f.close();
  }
});
test("one automatic controller and multiple observers; user pause fences late events and model reactivation", async () => {
  const f = setup();
  try {
    const c = f.draft("supervisor"),
      other = f.draft("supervisor"),
      s = f.draft();
    f.service.watch({
      controllerSessionId: c.id,
      targetSessionId: s.id,
      mode: "continue",
      continuous: true,
    });
    assert.throws(
      () =>
        f.service.watch({ controllerSessionId: other.id, targetSessionId: s.id, mode: "continue" }),
      /控制者/,
    );
    f.service.watch({ controllerSessionId: other.id, targetSessionId: s.id, mode: "observe" });
    await f.service.stop(s.id, true);
    f.service.ingest(s.id, "turn-ended", { outcome: "completed" }, "late-end");
    f.service.ingest(s.id, "settled", {}, "late-settled");
    assert.throws(
      () =>
        f.service.watch(
          { controllerSessionId: c.id, targetSessionId: s.id, mode: "continue" },
          "model",
        ),
      /显式启用/,
    );
    await turn();
    assert.equal(f.sends.length, 0);
    assert.equal(f.store.watches().find((w) => w.mode === "continue")?.state, "paused");
  } finally {
    await f.close();
  }
});
test("stop during asynchronous handshake cancels accepted input before native write", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => {
      release = r;
    }),
    f = setup({ connectGate: gate });
  try {
    const s = f.draft(),
      id = randomUUID();
    f.service.acceptSend(s.id, { requestId: id, text: "must not be written" });
    await turn();
    await f.service.stop(s.id, true);
    release();
    await turn();
    assert.equal(f.sends.length, 0);
    assert.equal(f.store.command(id)?.status, "cancelled");
  } finally {
    release();
    await f.close();
  }
});
test("unknown native send blocks later input, and recovery never resends it", async () => {
  const f = setup({ sendError: true });
  try {
    const s = f.draft(),
      id = randomUUID();
    f.service.acceptSend(s.id, { requestId: id, text: "write once" });
    await turn();
    assert.equal(f.store.command(id)?.status, "unknown");
    f.service.acceptSend(s.id, { requestId: randomUUID(), text: "do not write" });
    f.service.resumeWork();
    await turn();
    assert.deepEqual(f.sends, ["write once"]);
    f.store.recover();
    assert.equal(f.store.command(id)?.status, "unknown");
    assert.equal(f.store.session(s.id).connectionState, "offline");
  } finally {
    await f.close();
  }
});
test("single matching completion creates one durable wake and stop invalidates queued wake", async () => {
  const f = setup();
  try {
    const c = f.draft("supervisor"),
      s = f.draft();
    f.store.saveSession({ ...c, runState: "running" });
    f.service.watch({ controllerSessionId: c.id, targetSessionId: s.id, mode: "continue" });
    f.service.ingest(s.id, "turn-ended", { outcome: "completed" }, "end-1");
    f.service.ingest(s.id, "turn-ended", { outcome: "completed" }, "end-2");
    assert.equal(f.store.commands(c.id).filter((c) => c.origin === "wake").length, 1);
    await f.service.stop(s.id, true);
    assert.equal(f.store.commands(c.id)[0]?.status, "cancelled");
    f.store.saveSession({ ...f.store.session(c.id), runState: "idle" });
    f.service.resumeWork();
    await turn();
    assert.equal(f.sends.length, 0);
  } finally {
    await f.close();
  }
});
test("native mapping, dispatched commands and wakes survive SQLite restart as unknown", async () => {
  const f = setup();
  try {
    const s = f.draft();
    await f.service.openNative(s.id);
    const id = randomUUID(),
      c: Command = {
        id,
        sessionId: s.id,
        kind: "send",
        origin: "user",
        controllerId: null,
        generation: 0,
        bindingRevision: null,
        status: "dispatched",
        nativeRunId: "real-run-reference",
        body: { text: "test" },
        createdAt: new Date().toISOString(),
      };
    f.store.saveCommand(c);
    f.store.recover();
    assert.equal(f.store.command(id)?.status, "unknown");
    assert.equal(f.store.session(s.id).nativeSessionId, `test-native:${s.id}`);
    assert.equal(f.store.session(s.id).runState, "idle");
  } finally {
    await f.close();
  }
});
test("cumulative usage snapshots replace their source scope; unknown price stays null", async () => {
  const f = setup();
  try {
    const s = f.draft();
    f.service.ingest(
      s.id,
      "usage",
      { scope: "session", sourceId: "native-total", inputTokens: 10, outputTokens: 2 },
      "usage1",
    );
    f.service.ingest(
      s.id,
      "usage",
      { scope: "session", sourceId: "native-total", inputTokens: 15, outputTokens: 4 },
      "usage2",
    );
    f.service.ingest(
      s.id,
      "usage",
      { scope: "session", sourceId: "native-total", inputTokens: 15, outputTokens: 4 },
      "usage2",
    );
    const records = f.store.records<Usage>("usage");
    assert.equal(records.length, 1);
    assert.equal(records[0]?.input, 15);
    assert.equal(records[0]?.costUsd, null);
    assert.equal(records[0]?.cacheRead, null);
  } finally {
    await f.close();
  }
});
test("session totals without source IDs replace earlier updates instead of double billing", async () => {
  const f = setup();
  try {
    const s = f.draft();
    await f.service.openNative(s.id);
    f.service.ingest(s.id, "usage", { scope: "session", input: 10, costUsd: 0.1 }, "first");
    f.service.ingest(s.id, "usage", { scope: "session", input: 20, costUsd: 0.2 }, "second");
    const rows = f.store.records<Usage>("usage");
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.input, 20);
    assert.equal(rows[0]!.costUsd, 0.2);
  } finally {
    await f.close();
  }
});

test("negotiated session steer overrides the generic adapter and rejects unsupported sessions", async () => {
  for (const runtimeSteer of ["supported", "unsupported"] as const) {
    const f = setup({ steer: runtimeSteer !== "supported", runtimeSteer });
    try {
      const s = f.draft();
      await f.service.openNative(s.id);
      assert.equal(f.store.session(s.id).nativeCapabilities?.steer, runtimeSteer);
      f.service.ingest(s.id, "state", { runState: "running" });
      const send = () =>
        f.service.acceptSend(s.id, { requestId: randomUUID(), text: "guide", mode: "steer" });
      if (runtimeSteer === "supported") {
        send();
        for (let i = 0; i < 30 && !f.sends.length; i++) await turn();
        assert.deepEqual(f.sends, ["guide"]);
      } else assert.throws(send, /steer|引导/);
    } finally {
      await f.close();
    }
  }
});

test("native interactions resolve once across devices without granting twice", async () => {
  const f = setup();
  try {
    const s = f.draft();
    await f.service.openNative(s.id);
    let resolved = 0;
    const answer = f.contexts
      .get(s.id)!
      .interact("native-request", { protocol: "synthetic", question: "test only" })
      .then(() => resolved++);
    const id = `${s.id}:native-request`,
      requestId = randomUUID();
    assert.equal(
      f.service.answerInteraction(id, { decision: "decline" }, requestId).status,
      "processed",
    );
    assert.equal(
      f.service.answerInteraction(id, { decision: "decline" }, requestId).status,
      "already-processed",
    );
    assert.throws(
      () => f.service.answerInteraction(id, { decision: "accept" }, randomUUID()),
      /另一客户端/,
    );
    await answer;
    assert.equal(resolved, 1);
  } finally {
    await f.close();
  }
});

test("ACP turn completion expires pending approvals without cancelling other protocols", async () => {
  const f = setup();
  try {
    const session = f.draft();
    await f.service.openNative(session.id);
    const ctx = f.contexts.get(session.id)!;
    const answer = ctx.interact("expired-acp", {
      protocol: "acp",
      method: "session/request_permission",
    });
    const other = ctx.interact("background", { protocol: "synthetic" });
    ctx.emit("turn-ended", { outcome: "completed" });
    assert.deepEqual(await answer, { cancelled: true });
    const id = session.id + ":expired-acp";
    assert.equal(f.store.record<{ stale: boolean }>("inbox", id)?.stale, true);
    assert.throws(
      () =>
        f.service.answerInteraction(
          id,
          { outcome: { outcome: "selected", optionId: "allow" } },
          randomUUID(),
        ),
      /失效/,
    );
    assert.equal(
      f.service.answerInteraction(session.id + ":background", { decision: "decline" }, randomUUID())
        .status,
      "processed",
    );
    await other;
  } finally {
    await f.close();
  }
});

test("native resolution expires only its own pending inbox request", async () => {
  const f = setup();
  try {
    const s = f.draft();
    await f.service.openNative(s.id);
    const ctx = f.contexts.get(s.id)!;
    const expired = ctx.interact("resolved-elsewhere", { protocol: "opencode" });
    const other = ctx.interact("still-pending", { protocol: "opencode" });
    ctx.resolveInteraction!("resolved-elsewhere");
    ctx.resolveInteraction!("resolved-elsewhere");
    assert.deepEqual(await expired, { cancelled: true });
    assert.equal(f.store.session(s.id).runState, "waiting-input");
    const id = s.id + ":resolved-elsewhere";
    assert.equal(f.store.record<{ stale: boolean }>("inbox", id)?.stale, true);
    assert.throws(() => f.service.answerInteraction(id, { reply: "once" }, randomUUID()), /失效/);
    assert.equal(
      f.service.answerInteraction(s.id + ":still-pending", { reply: "reject" }, randomUUID())
        .status,
      "processed",
    );
    assert.deepEqual(await other, { reply: "reject" });
    const last = ctx.interact("last-pending", { protocol: "kimi" });
    ctx.resolveInteraction!("last-pending");
    await last;
    assert.equal(f.store.session(s.id).runState, "running");
    const withdrawn = ctx.interact("transport-closed", { protocol: "kimi" });
    ctx.resolveInteraction!("transport-closed", "withdrawn");
    await withdrawn;
    assert.equal(f.store.session(s.id).runState, "waiting-input");
  } finally {
    await f.close();
  }
});

test("model re-registering a one-shot control cannot replay its consumed completion", async () => {
  const f = setup();
  try {
    const c = f.draft("supervisor"),
      s = f.draft();
    f.store.saveSession({ ...c, runState: "running" });
    const w = f.service.watch({
      controllerSessionId: c.id,
      targetSessionId: s.id,
      mode: "continue",
    });
    f.service.ingest(s.id, "turn-ended", { outcome: "completed" }, "one-end");
    f.service.watch(
      { controllerSessionId: c.id, targetSessionId: s.id, mode: "continue", cursor: 0 },
      "model",
    );
    assert.equal(f.store.watches()[0]?.generation, w.generation);
    assert.equal(f.store.commands(c.id).length, 1);
  } finally {
    await f.close();
  }
});

test("queued automatic commands reserve the continuation limit", async () => {
  const f = setup();
  try {
    const c = f.draft("supervisor"),
      s = f.draft();
    f.service.watch({
      controllerSessionId: c.id,
      targetSessionId: s.id,
      mode: "continue",
      limits: { maxContinuations: 1 },
    });
    f.service.acceptSend(s.id, { requestId: randomUUID(), text: "allowed once" }, c.id);
    assert.throws(
      () =>
        f.service.acceptSend(s.id, { requestId: randomUUID(), text: "would exceed limit" }, c.id),
      /占用/,
    );
    await turn();
    assert.deepEqual(f.sends, ["allowed once"]);
  } finally {
    await f.close();
  }
});

test("zero supervision limits allow continuations, failures and unknown costs without a cap", async () => {
  const f = setup();
  try {
    const c = f.draft("supervisor"),
      s = f.draft();
    const watch = f.service.watch({
      controllerSessionId: c.id,
      targetSessionId: s.id,
      mode: "continue",
      continuous: true,
      limits: { maxContinuations: 0, maxFailures: 0, budgetUsd: 0 },
    });
    f.store.saveWatch({ ...watch, continuations: 1000, failures: 1000 });
    f.service.ingest(s.id, "usage", { input: 10, output: 5, costUsd: null }, "unknown-cost");
    f.service.acceptSend(s.id, { requestId: randomUUID(), text: "unlimited first" }, c.id);
    await turn();
    f.service.acceptSend(s.id, { requestId: randomUUID(), text: "unlimited second" }, c.id);
    await turn();
    assert.deepEqual(
      f.sends.filter((text) => text.startsWith("unlimited")),
      ["unlimited first", "unlimited second"],
    );
    assert.equal(f.store.watches().find((w) => w.id === watch.id)?.state, "active");
    assert.throws(() =>
      f.service.watch({
        controllerSessionId: c.id,
        targetSessionId: s.id,
        mode: "continue",
        limits: { maxContinuations: -1 },
      }),
    );
  } finally {
    await f.close();
  }
});

test("older cumulative snapshots cannot reduce usage or known cost", async () => {
  const f = setup();
  try {
    const s = f.draft();
    f.service.ingest(
      s.id,
      "usage",
      { scope: "session", sourceId: "native", input: 20, output: 5, costUsd: 0.5 },
      "newer",
    );
    f.service.ingest(
      s.id,
      "usage",
      { scope: "session", sourceId: "native", input: 10, output: 2, costUsd: 0.1 },
      "older",
    );
    const u = f.store.records<Usage>("usage")[0]!;
    assert.equal(u.input, 20);
    assert.equal(u.costUsd, 0.5);
  } finally {
    await f.close();
  }
});

test("manual native reconciliation releases a queue without repeating unknown input", async () => {
  const f = setup({ sendError: true });
  try {
    const s = f.draft(),
      id = randomUUID();
    f.service.acceptSend(s.id, { requestId: id, text: "one uncertain native input" });
    await turn();
    assert.equal(f.store.command(id)?.status, "unknown");
    f.service.reconcile(s.id, {
      commandId: id,
      resolution: "confirmed",
      note: "isolated test peer confirmed receipt",
      idleConfirmed: true,
    });
    f.service.resumeWork();
    await turn();
    assert.deepEqual(f.sends, ["one uncertain native input"]);
    assert.equal(f.store.command(id)?.status, "confirmed");
  } finally {
    await f.close();
  }
});

test("moving project attribution pauses automation and preserves native identity and cwd", async () => {
  const f = setup();
  try {
    const a = f.service.createProject({ name: "A", rootPath: f.dir }),
      b = f.service.createProject({ name: "B" }),
      workspace = f.store.workspaces()[0]!,
      c = f.draft("supervisor"),
      s = f.service.createDraft({
        title: "move",
        harnessId: "pi",
        kind: "direct",
        projectId: a.id,
        workspaceId: workspace.id,
      });
    await f.service.openNative(s.id);
    f.service.watch({ controllerSessionId: c.id, targetSessionId: s.id, mode: "continue" });
    const moved = f.service.updateSession(s.id, { projectId: b.id });
    assert.equal(moved.workspaceId, workspace.id);
    assert.equal(moved.nativeSessionId, `test-native:${s.id}`);
    assert.equal(f.store.watches()[0]?.state, "paused");
    assert.equal(
      f.store.db.prepare("SELECT project_id FROM sessions WHERE id=?").get(s.id)?.project_id,
      b.id,
    );
  } finally {
    await f.close();
  }
});

test("project creation policy grants control only to new sessions, and tool replay cannot resume user-paused control", async () => {
  const f = setup();
  try {
    const p = f.service.createProject({ name: "Selected scope" }),
      c = f.draft("supervisor"),
      id = randomUUID(),
      input = { title: "Created once", harnessId: "pi", projectId: p.id };
    assert.throws(() => f.service.createManagedDraft(c.id, id, input), /授权/);
    f.service.grantProject(c.id, p.id);
    const readOnly = f.service.createManagedDraft(c.id, randomUUID(), input);
    assert.throws(
      () =>
        f.service.acceptSend(
          readOnly.id,
          { requestId: randomUUID(), text: "not authorized" },
          c.id,
        ),
      /未启用/,
    );
    f.service.grantProject(c.id, p.id, {
      mode: "create-and-control",
      goal: "Explicit user goal",
      limits: { maxContinuations: 2 },
    });
    const s = f.service.createManagedDraft(c.id, id, input),
      w = f.store.watches()[0]!;
    assert.equal(w.targetSessionId, s.id);
    assert.equal(w.goal, "Explicit user goal");
    assert.equal(w.limits?.maxContinuations, 2);
    f.service.changeWatch(w.id, "paused");
    assert.equal(f.service.createManagedDraft(c.id, id, input).id, s.id);
    assert.equal(f.store.watches()[0]?.state, "paused");
    assert.throws(
      () =>
        f.service.acceptSend(s.id, { requestId: randomUUID(), text: "cannot reactivate" }, c.id),
      /未启用/,
    );
    f.service.grantProject(c.id, p.id, { mode: "revoke" });
    assert.throws(() => f.service.createManagedDraft(c.id, randomUUID(), input), /授权/);
    assert.equal(f.service.snapshot().projectGrants.length, 0);
  } finally {
    await f.close();
  }
});

test("managed draft and request mapping roll back together when automatic scope is invalid", async () => {
  const f = setup({ partial: true });
  try {
    const p = f.service.createProject({ name: "Scope" }),
      c = f.draft("supervisor"),
      id = randomUUID();
    f.service.grantProject(c.id, p.id, { mode: "create-and-control" });
    assert.throws(
      () =>
        f.service.createManagedDraft(c.id, id, {
          title: "Invalid automatic target",
          harnessId: "pi",
          projectId: p.id,
        }),
      /暂不开放/,
    );
    assert.equal(f.store.sessions().length, 1);
    assert.equal(f.store.record("tool-open", id), undefined);
  } finally {
    await f.close();
  }
});

test("atomic control transfer invalidates the old pending input without starting a native turn", async () => {
  const f = setup();
  try {
    const c = f.draft("supervisor"),
      next = f.draft("supervisor"),
      s = f.draft();
    f.service.watch({ controllerSessionId: c.id, targetSessionId: s.id, mode: "continue" });
    const command = f.service.acceptSend(
      s.id,
      { requestId: randomUUID(), text: "old queued input" },
      c.id,
    );
    f.service.transferControl({
      controllerSessionId: next.id,
      targetSessionId: s.id,
      mode: "continue",
      continuous: true,
    });
    await turn();
    assert.equal(f.store.command(command.id)?.status, "cancelled");
    assert.equal(f.sends.length, 0);
    assert.equal(
      f.store.watches().filter((w) => w.mode === "continue" && w.state === "active")[0]
        ?.controllerSessionId,
      next.id,
    );
    f.service.acceptSend(s.id, { requestId: randomUUID(), text: "new explicit control" }, next.id);
    await turn();
    assert.equal(f.sends[0], "new explicit control");
    assert.equal(f.sends.includes("old queued input"), false);
    assert.equal(f.store.commands(next.id).filter((c) => c.origin === "wake").length, 1);
  } finally {
    await f.close();
  }
});

test("rolled-back events never reach subscribers or create automatic work", async () => {
  const f = setup();
  try {
    const c = f.draft("supervisor"),
      s = f.draft();
    f.service.watch({ controllerSessionId: c.id, targetSessionId: s.id, mode: "continue" });
    let observed = 0;
    f.service.notifications.on("event", () => observed++);
    assert.throws(() =>
      f.store.transaction(() => {
        f.service.ingest(s.id, "turn-ended", { outcome: "completed" }, "rolled-back-native-end");
        throw new Error("simulated transaction failure");
      }),
    );
    await turn();
    assert.equal(observed, 0);
    assert.equal(
      f.store.events(s.id).some((e) => e.id === "rolled-back-native-end"),
      false,
    );
    assert.equal(f.store.commands(c.id).length, 0);
    assert.equal(f.sends.length, 0);
  } finally {
    await f.close();
  }
});

test("replayed stop keeps its receipt and never cancels a later native turn", async () => {
  const f = setup();
  try {
    const s = f.draft(),
      id = randomUUID();
    await f.service.openNative(s.id);
    const result = await f.service.stop(s.id, true, id),
      epoch = f.store.session(s.id).ownerEpoch;
    f.store.saveSession({ ...f.store.session(s.id), runState: "running" });
    assert.deepEqual(await f.service.stop(s.id, true, id), result);
    assert.deepEqual(f.cancels, [s.id]);
    assert.equal(f.store.session(s.id).ownerEpoch, epoch);
    assert.equal(f.store.session(s.id).runState, "running");
    await assert.rejects(f.service.stop(s.id, false, id), /不同停止/);
  } finally {
    await f.close();
  }
});

test("offline stop pauses control but never claims native cancellation was confirmed", async () => {
  const f = setup();
  try {
    const s = f.draft(),
      id = randomUUID();
    const result = await f.service.stop(s.id, true, id);
    assert.equal(result.status, "paused");
    assert.match(result.cancel, /unconfirmed/);
    assert.equal(f.store.command(id)?.status, "unknown");
  } finally {
    await f.close();
  }
});

test("a failing subscriber cannot roll back a committed native event or hide it from other subscribers", async () => {
  const f = setup();
  try {
    const s = f.draft();
    let observed = 0;
    f.service.notifications.on("event", () => {
      throw new Error("synthetic subscriber failure");
    });
    f.service.notifications.on("event", () => observed++);
    f.service.ingest(s.id, "message", { text: "isolated test" });
    assert.equal(observed, 1);
    assert.equal(f.store.events(s.id).length, 1);
  } finally {
    await f.close();
  }
});

test("native ingestion failure isolates its session, pauses control and leaves other sessions usable", async () => {
  const f = setup();
  try {
    const s = f.draft(),
      c = f.draft("supervisor"),
      other = f.draft();
    await f.service.openNative(s.id);
    f.service.watch({ controllerSessionId: c.id, targetSessionId: s.id, mode: "continue" });
    const append = f.store.append.bind(f.store);
    f.store.append = () => {
      throw new Error("synthetic persistence failure");
    };
    assert.doesNotThrow(() => f.contexts.get(s.id)!.emit("turn-ended", { outcome: "completed" }));
    f.store.append = append;
    assert.equal(f.store.session(s.id).runState, "unknown");
    assert.equal(f.store.watches()[0]?.state, "paused");
    assert.throws(
      () => f.service.acceptSend(s.id, { requestId: randomUUID(), text: "blocked" }),
      /隔离/,
    );
    f.contexts.get(s.id)!.emit("settled", {});
    assert.equal(f.store.session(s.id).runState, "unknown");
    f.service.acceptSend(other.id, { requestId: randomUUID(), text: "other session" });
    await turn();
    assert.deepEqual(f.sends, ["other session"]);
  } finally {
    await f.close();
  }
});

test("disconnect fences the old native connection and stops its late completion from waking control", async () => {
  const f = setup();
  try {
    const s = f.draft(),
      c = f.draft("supervisor");
    await f.service.openNative(s.id);
    f.service.watch({ controllerSessionId: c.id, targetSessionId: s.id, mode: "continue" });
    const old = f.contexts.get(s.id)!;
    old.emit("disconnected", { reason: "synthetic transport closure" });
    old.emit("settled", {});
    assert.equal(f.store.session(s.id).runState, "unknown");
    assert.equal(f.store.watches()[0]?.state, "paused");
    await f.service.openNative(s.id);
    old.emit("disconnected", {});
    assert.equal(f.store.session(s.id).connectionState, "connected");
    await turn();
    assert.equal(f.sends.length, 0);
  } finally {
    await f.close();
  }
});

test("thousands of native deltas coalesce while preserving channel order and native deduplication", async () => {
  const f = setup();
  try {
    const s = f.draft();
    await f.service.openNative(s.id);
    const ctx = f.contexts.get(s.id)!;
    for (let i = 0; i < 10000; i++) ctx.emit("text-delta", { text: "中" }, `delta:${i}`);
    ctx.emit("text-delta", { text: "中" }, "delta:0");
    ctx.emit("text-delta", { text: "思", channel: "thought" });
    ctx.emit("message", { role: "assistant", text: "终稿" });
    const events = f.store.events(s.id),
      chunks = events.filter((e) => e.type === "text-delta");
    assert.equal(chunks.length, 3);
    assert.equal(chunks.map((e) => (e.payload as any).text).join(""), "中".repeat(10000) + "思");
    assert.equal(events.at(-1)?.type, "message");
    ctx.emit("text-delta", { text: "中" }, "delta:9999");
    ctx.emit("settled", {});
    assert.equal(f.store.events(s.id).filter((e) => e.type === "text-delta").length, 3);
  } finally {
    await f.close();
  }
});

test("CJK searches find substrings, short words and mixed language history without FTS syntax injection", async () => {
  const f = setup();
  try {
    const s = f.draft();
    f.service.ingest(s.id, "message", { text: "已经修复中文搜索功能 SQLite 索引" });
    for (const q of ["中文搜索", "中文", "中", "中文 SQLite", "sqlite"])
      assert.equal(f.store.search(q).length, 1, q);
    assert.deepEqual(f.store.search('" OR *'), []);
  } finally {
    await f.close();
  }
});

test("event pages stay bounded and GC retains unread events, commands, wakes and dedup tombstones", async () => {
  const f = setup();
  try {
    const s = f.draft(),
      c = f.draft("supervisor");
    f.store.transaction(() => {
      for (let i = 0; i < 950; i++)
        f.store.append({
          id: `history:${i}`,
          sessionId: s.id,
          nativeRunId: null,
          source: "pi",
          type: "state",
          payload: { i },
          createdAt: "2020-01-01T00:00:00.000Z",
        });
    });
    const newest = f.service.readPage(s.id),
      older = f.service.readPage(s.id, newest.olderCursor!);
    assert.equal(newest.events.length, 300);
    assert.equal(older.events.length, 300);
    assert.ok(older.events.at(-1)!.sequence < newest.events[0]!.sequence);
    const watch = f.service.watch({
      controllerSessionId: c.id,
      targetSessionId: s.id,
      mode: "continue",
    });
    f.store.saveWatch({ ...watch, cursor: "100" });
    const id = randomUUID();
    f.service.acceptSend(c.id, { requestId: id, text: "pending" });
    assert.equal(f.store.collect(Date.now(), 30).removed, 100);
    assert.ok(f.store.command(id));
    assert.equal(
      f.store.append({
        id: "history:0",
        sessionId: s.id,
        source: "pi",
        type: "state",
        payload: {},
        nativeRunId: null,
        createdAt: new Date().toISOString(),
      }),
      undefined,
    );
    assert.equal(f.store.latestSequence(), 952); // Includes the durable accepted-command notification.
  } finally {
    await f.close();
  }
});

test("identical interaction decisions are idempotent even when another device generated a new UUID", async () => {
  const f = setup();
  try {
    const s = f.draft();
    await f.service.openNative(s.id);
    const result = f.contexts.get(s.id)!.interact("repeat", {});
    const id = `${s.id}:repeat`;
    f.service.answerInteraction(id, { decision: "decline" }, randomUUID());
    assert.equal(
      f.service.answerInteraction(id, { decision: "decline" }, randomUUID()).status,
      "already-processed",
    );
    await result;
  } finally {
    await f.close();
  }
});

test("fatal guard cancels queued work and persists paused control for restart", async () => {
  const f = setup();
  try {
    const s = f.draft(),
      c = f.draft("supervisor"),
      id = randomUUID();
    f.service.watch({ controllerSessionId: c.id, targetSessionId: s.id, mode: "continue" });
    f.service.acceptSend(s.id, { requestId: id, text: "must not start" });
    f.service.failClosed(new Error("synthetic process exception"));
    await turn();
    assert.equal(f.store.command(id)?.status, "cancelled");
    assert.equal(f.store.watches()[0]?.state, "paused");
    assert.equal(f.sends.length, 0);
    assert.throws(
      () => f.service.acceptSend(s.id, { requestId: randomUUID(), text: "blocked" }),
      /隔离|停止/,
    );
  } finally {
    await f.close();
  }
});

test("stopping the Kodo controller pauses its outgoing control and fences later target events", async () => {
  const f = setup();
  try {
    const controller = f.draft("supervisor"),
      target = f.draft();
    await f.service.openNative(controller.id);
    f.service.watch({
      controllerSessionId: controller.id,
      targetSessionId: target.id,
      mode: "continue",
    });
    await f.service.stop(controller.id, true);
    f.service.ingest(
      target.id,
      "turn-ended",
      { outcome: "completed" },
      "late-after-controller-stop",
    );
    await turn();
    assert.equal(f.store.watches()[0]?.state, "paused");
    assert.equal(f.store.commands(controller.id).filter((c) => c.origin === "wake").length, 0);
    assert.equal(f.sends.length, 0);
  } finally {
    await f.close();
  }
});

test("pending edits survive a connect race and immutable send requests still deduplicate after dispatch", async () => {
  let release!: () => void;
  const f = setup({
    connectGate: new Promise<void>((r) => {
      release = r;
    }),
  });
  try {
    const s = f.draft();
    const input = {
      requestId: randomUUID(),
      text: "original pending text",
      mode: "queue" as const,
    };
    f.service.acceptSend(s.id, input);
    await turn();
    const edit = {
      requestId: randomUUID(),
      expectedRevision: 0,
      action: "edit",
      text: "edited pending text",
    };
    const a = f.service.changePendingMessage(s.id, input.requestId, edit);
    assert.deepEqual(f.service.changePendingMessage(s.id, input.requestId, edit), a);
    assert.deepEqual(f.service.pendingMessageReceipt(s.id, input.requestId, edit.requestId), a);
    assert.throws(
      () =>
        f.service.changePendingMessage(s.id, input.requestId, { ...edit, requestId: randomUUID() }),
      /另一客户端/,
    );
    release();
    await turn();
    await turn();
    assert.deepEqual(f.sends, ["edited pending text"]);
    assert.equal(f.service.acceptSend(s.id, input).id, input.requestId);
    assert.equal(f.sends.length, 1);
    assert.throws(
      () =>
        f.service.changePendingMessage(s.id, input.requestId, {
          ...edit,
          requestId: randomUUID(),
          expectedRevision: 1,
        }),
      /已递送/,
    );
  } finally {
    release();
    await f.close();
  }
});

test("send-now promotes an edited pending message to native steer ahead of the normal queue", async () => {
  let release!: () => void;
  const f = setup({
    sendGate: new Promise<void>((r) => {
      release = r;
    }),
  });
  try {
    const s = f.draft();
    f.service.acceptSend(s.id, { requestId: randomUUID(), text: "running", mode: "new" });
    await turn();
    const queued = f.service.acceptSend(s.id, { requestId: randomUUID(), text: "stay queued" });
    const target = f.service.acceptSend(s.id, {
      requestId: randomUUID(),
      text: "original never native",
    });
    const input = {
      requestId: randomUUID(),
      expectedRevision: 0,
      action: "send-now",
      text: "edited immediate steer",
    };
    f.service.changePendingMessage(s.id, target.id, input);
    await turn();
    assert.deepEqual(f.sends, ["running", "edited immediate steer"]);
    assert.equal(f.store.command(queued.id)?.status, "accepted");
    assert.equal(f.store.command(target.id)?.body.mode, "steer");
    assert.equal(
      f.store.command(target.id)?.body.settings,
      undefined,
      "steer keeps active settings",
    );
    f.service.changePendingMessage(s.id, target.id, input);
    assert.equal(f.sends.length, 2, "repeated action does not steer twice");
    release();
    await turn();
    await turn();
    assert.deepEqual(f.sends, ["running", "edited immediate steer", "stay queued"]);
  } finally {
    release();
    await f.close();
  }
});

test("idle send-now priority wins while another queued message is still connecting", async () => {
  let release!: () => void;
  const f = setup({
    connectGate: new Promise<void>((r) => {
      release = r;
    }),
  });
  try {
    const s = f.draft();
    f.service.acceptSend(s.id, { requestId: randomUUID(), text: "ordinary first" });
    await turn();
    const target = f.service.acceptSend(s.id, { requestId: randomUUID(), text: "priority second" });
    f.service.changePendingMessage(s.id, target.id, {
      requestId: randomUUID(),
      expectedRevision: 0,
      action: "send-now",
    });
    release();
    await turn();
    await turn();
    assert.deepEqual(f.sends, ["priority second", "ordinary first"]);
  } finally {
    release();
    await f.close();
  }
});

test("unsupported native steer rejects promotion without losing the editable or withdrawable message", async () => {
  let release!: () => void;
  const f = setup({
    steer: false,
    sendGate: new Promise<void>((r) => {
      release = r;
    }),
  });
  try {
    const s = f.draft();
    f.service.acceptSend(s.id, { requestId: randomUUID(), text: "running" });
    await turn();
    const target = f.service.acceptSend(s.id, { requestId: randomUUID(), text: "waiting" });
    assert.throws(
      () =>
        f.service.changePendingMessage(s.id, target.id, {
          requestId: randomUUID(),
          expectedRevision: 0,
          action: "send-now",
        }),
      /不支持运行中插话/,
    );
    assert.equal(f.store.command(target.id)?.status, "accepted");
    f.service.changePendingMessage(s.id, target.id, {
      requestId: randomUUID(),
      expectedRevision: 0,
      action: "edit",
      text: "still editable",
    });
    f.service.withdrawCommand(s.id, target.id);
    assert.throws(
      () =>
        f.service.changePendingMessage(s.id, target.id, {
          requestId: randomUUID(),
          expectedRevision: 1,
          action: "edit",
          text: "late",
        }),
      /已递送、撤回/,
    );
    release();
    await turn();
    assert.deepEqual(f.sends, ["running"]);
  } finally {
    release();
    await f.close();
  }
});

test("send-now starts a new native turn if the old turn ends before promotion is dispatched", async () => {
  let release!: () => void;
  const f = setup({
    sendGate: new Promise<void>((r) => {
      release = r;
    }),
  });
  try {
    const s = f.draft();
    f.service.acceptSend(s.id, { requestId: randomUUID(), text: "running" });
    await turn();
    const target = f.service.acceptSend(s.id, {
      requestId: randomUUID(),
      text: "immediate after completion",
    });
    f.service.changePendingMessage(s.id, target.id, {
      requestId: randomUUID(),
      expectedRevision: 0,
      action: "send-now",
    });
    f.contexts.get(s.id)!.emit("turn-ended", { outcome: "completed" });
    release();
    await turn();
    await turn();
    assert.deepEqual(f.sends, ["running", "immediate after completion"]);
    assert.equal(f.store.command(target.id)?.body.mode, "new");
  } finally {
    release();
    await f.close();
  }
});
test("wake input carries goal, target status, last reply and limits for Kodo's judgement", async () => {
  const f = setup();
  try {
    const c = f.draft("supervisor"),
      s = f.draft();
    f.store.saveSession({ ...c, runState: "running" });
    f.service.watch({
      controllerSessionId: c.id,
      targetSessionId: s.id,
      mode: "continue",
      goal: "login and tests pass",
      limits: { maxContinuations: 5 },
    });
    f.service.ingest(s.id, "message", { role: "assistant", text: "Tests still failing." }, "m1");
    f.service.ingest(s.id, "turn-ended", { outcome: "completed" }, "end-1");
    const wake = f.store.commands(c.id).find((c) => c.origin === "wake");
    assert.ok(wake);
    const body = JSON.parse(String(wake.body.text));
    assert.equal(body.goal, "login and tests pass");
    assert.equal(body.target.lastReply, "Tests still failing.");
    assert.equal(body.target.status, "turn-ended");
    assert.equal(body.supervision.limits.maxContinuations, 5);
    assert.match(body.note, /不代表用户目标已完成/);
  } finally {
    await f.close();
  }
});
