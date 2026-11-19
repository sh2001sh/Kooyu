import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HARNESS_IDS, KodoError, conversationEvents, type Session } from "@kodo/protocol";
import { Store } from "../src/storage/store.js";
import { SessionService } from "../src/session-service.js";
import { descriptor, type AdapterContext, type Wire } from "../src/harnesses/adapter.js";
import { OpenCodeEvents } from "../src/harnesses/opencode-events.js";
import { adapters } from "../src/harnesses/registry.js";
import { RpcRejected } from "../src/harnesses/rpc.js";
import { fileURLToPath } from "node:url";

async function until(check: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(check(), "expected state did not arrive");
}

for (const harnessId of ["opencode", "gemini", "cursor", "grok-build"] as const)
  test(`${harnessId}: real adapter classifies explicit native rejection`, async () => {
    const events: { type: string; payload: Wire }[] = [];
    const runtime = await adapters
      .find((a) => a.descriptor.id === harnessId)!
      .connect({ id: randomUUID(), nativeSessionId: null } as Session, {
        cwd: tmpdir(),
        dataDir: tmpdir(),
        env: { ...process.env, SYNTHETIC_PROMPT_REJECT: "1" },
        launch: {
          command: process.execPath,
          args:
            harnessId === "opencode"
              ? [fileURLToPath(new URL("./fixtures/opencode-peer.mjs", import.meta.url))]
              : [fileURLToPath(new URL("./fixtures/native-peer.mjs", import.meta.url)), "acp"],
        },
        emit: (type, payload) => {
          events.push({ type, payload: payload as Wire });
        },
        interact: async () => ({}),
      });
    try {
      await assert.rejects(runtime.send("synthetic", randomUUID(), "new"), RpcRejected);
      if (harnessId !== "opencode")
        assert.ok(events.some((e) => e.type === "turn-ended" && e.payload.outcome === "failed"));
    } finally {
      await runtime.close();
    }
  });

for (const harnessId of HARNESS_IDS) {
  for (const failure of ["rejected", "terminal-then-disconnect", "unknown"] as const)
    test(`${harnessId}: ${failure} preserves known delivery and queue recovery`, async () => {
      const dir = mkdtempSync(join(tmpdir(), "kooyu-recovery-"));
      const store = new Store(":memory:");
      let calls = 0;
      const service = new SessionService(store, {
        dataDir: dir,
        adapters: [
          {
            descriptor: descriptor(
              harnessId,
              "Fixture",
              "sdk",
              ["send"],
              "synthetic",
              "implemented",
            ),
            connect: async () => ({
              nativeSessionId: randomUUID(),
              async send(_text, commandId) {
                calls++;
                if (calls === 1) {
                  if (failure === "rejected")
                    throw new KodoError("UNAVAILABLE", "API 503 synthetic");
                  if (failure === "terminal-then-disconnect")
                    service.ingest(session.id, "turn-ended", {
                      outcome: "failed",
                      commandId,
                      errors: ["API 503 synthetic"],
                    });
                  service.ingest(session.id, "disconnected", {
                    message: "synthetic transport closed",
                  });
                  throw new Error("synthetic transport closed");
                }
                service.ingest(session.id, "turn-ended", { outcome: "completed", commandId });
                return { nativeRunId: null };
              },
              async cancel() {},
              async close() {},
            }),
          },
        ],
      });
      const session = service.createDraft({
        title: "Recovery",
        harnessId,
        kind: harnessId === "kodo" ? "supervisor" : "direct",
        bindingId: null,
      });
      try {
        const idleStopId = randomUUID();
        const idleStop = await service.stop(session.id, true, idleStopId);
        assert.equal(store.command(idleStopId)?.status, "rejected");
        assert.equal(idleStop.cancel, "not delivered: native connection offline");
        assert.equal(store.session(session.id).runState, "idle");
        const first = service.acceptSend(session.id, {
          requestId: randomUUID(),
          text: "first",
          mode: "new",
        });
        await until(() =>
          ["rejected", "confirmed", "unknown"].includes(store.command(first.id)!.status),
        );
        const stopId = randomUUID();
        const stopped = await service.stop(session.id, true, stopId);
        assert.ok(["confirmed", "rejected"].includes(store.command(stopId)!.status));
        assert.ok(!stopped.cancel.includes("unconfirmed"));
        const next = service.acceptSend(session.id, {
          requestId: randomUUID(),
          text: "second",
          mode: "queue",
        });
        if (failure === "unknown") {
          assert.equal(store.session(session.id).runState, "unknown");
          assert.equal(store.command(first.id)!.status, "unknown");
          assert.throws(() =>
            service.changePendingMessage(session.id, next.id, {
              requestId: randomUUID(),
              expectedRevision: 0,
              action: "send-now",
            }),
          );
          assert.equal(calls, 1);
        } else {
          assert.equal(store.session(session.id).runState, "idle");
          service.changePendingMessage(session.id, next.id, {
            requestId: randomUUID(),
            expectedRevision: 0,
            action: "send-now",
          });
          await until(() => store.command(next.id)?.status === "confirmed");
          assert.equal(calls, 2);
          assert.equal(store.session(session.id).runState, "idle");
        }
      } finally {
        await service.dispose();
        store.close();
        rmSync(dir, { recursive: true, force: true });
      }
    });
}

test("inline variants retain history, isolate native context, resume either path, and survive reload", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kooyu-variants-"));
  const store = new Store(join(dir, "test.sqlite"));
  const sends: { text: string; nativeId: string }[] = [];
  const options = {
    dataDir: dir,
    adapters: [
      {
        descriptor: descriptor(
          "codex",
          "Fixture",
          "sdk",
          ["send", "resume"],
          "synthetic",
          "implemented",
        ),
        connect: async (session: Session, ctx: AdapterContext) => {
          const nativeId = session.nativeSessionId ?? randomUUID();
          return {
            nativeSessionId: nativeId,
            async send(text: string, commandId: string) {
              sends.push({ text, nativeId });
              ctx.emit("message", { role: "assistant", text: `reply ${sends.length}` });
              ctx.emit("turn-ended", { outcome: "completed", commandId });
              return { nativeRunId: null };
            },
            async cancel() {},
            async close() {
              ctx.emit("disconnected", { reason: "closed" });
            },
          };
        },
      },
    ],
  };
  let service = new SessionService(store, options);
  const source = service.createDraft({
    title: "Same conversation",
    harnessId: "codex",
    kind: "direct",
    bindingId: null,
  });
  const send = async (text: string) => {
    const c = service.acceptSend(source.id, { requestId: randomUUID(), text, mode: "new" });
    await until(() => store.command(c.id)?.status === "confirmed");
    return `command:${c.id}`;
  };
  try {
    const first = await send("shared prefix");
    const original = await send("original message");
    await send("future must stay on original path");
    const originalNative = store.session(source.id).nativeSessionId;
    const requestId = randomUUID();
    const edited = await service.messageBranch(source.id, {
      action: "edit",
      requestId,
      eventId: original,
      text: "edited message",
    });
    await until(() => store.command(requestId)?.status === "confirmed");
    assert.equal(store.sessions().length, 1);
    assert.equal(edited.id, source.id);
    assert.notEqual(store.session(source.id).nativeSessionId, originalNative);
    assert.match(sends.at(-1)!.text, /shared prefix/);
    assert.doesNotMatch(sends.at(-1)!.text, /original message|future must stay/);
    assert.deepEqual(
      conversationEvents(store.events(source.id), store.session(source.id).conversation)
        .filter((e) => e.type === "message" && (e.payload as Wire).role === "user")
        .map((e) => (e.payload as Wire).text),
      ["shared prefix", "edited message"],
    );
    await service.messageBranch(source.id, {
      action: "edit",
      requestId,
      eventId: original,
      text: "edited message",
    });
    assert.equal(sends.length, 4);
    await assert.rejects(
      service.messageBranch(source.id, {
        action: "edit",
        requestId,
        eventId: original,
        text: "different",
      }),
      /不同内容/,
    );
    const editedNative = store.session(source.id).nativeSessionId;
    await service.messageBranch(source.id, {
      action: "select",
      requestId: randomUUID(),
      branchId: "root",
    });
    assert.equal(store.session(source.id).nativeSessionId, originalNative);
    assert.ok(service.readPage(source.id).events.some((e) => e.id === original));
    await send("continue original");
    assert.equal(sends.at(-1)!.nativeId, originalNative);
    await service.dispose();
    service = new SessionService(store, options);
    await service.messageBranch(source.id, {
      action: "select",
      requestId: randomUUID(),
      branchId: requestId,
    });
    assert.equal(store.session(source.id).nativeSessionId, editedNative);
    await send("continue variant");
    assert.equal(sends.at(-1)!.nativeId, editedNative);
    const nested = randomUUID();
    await service.messageBranch(source.id, {
      action: "edit",
      requestId: nested,
      eventId: first,
      text: "new beginning",
    });
    await until(() => store.command(nested)?.status === "confirmed");
    assert.doesNotMatch(
      sends.at(-1)!.text,
      /shared prefix|edited message|continue variant|original message/,
    );
    assert.equal(store.sessions().length, 1);
  } finally {
    await service.dispose();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("native retry counters persist and clear on progress and terminal events", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kooyu-retries-"));
  const store = new Store(":memory:");
  const service = new SessionService(store, { dataDir: dir });
  const session = service.createDraft({
    title: "Retries",
    harnessId: "claude-code",
    kind: "direct",
  });
  try {
    for (const payload of [
      { subtype: "api_retry", attempt: 2, max_retries: 5, retry_delay_ms: 3000 },
      { type: "auto_retry_start", attempt: 2, maxAttempts: 5, delayMs: 3000 },
      { retry: { type: "retry", attempt: 2 } },
      { willRetry: true },
      { sessionUpdate: "retrying", attempt: 2, maxAttempts: 5 },
    ]) {
      service.ingest(session.id, "state", payload);
      assert.equal(store.session(session.id).runState, "running");
      assert.ok(store.session(session.id).retry);
      assert.equal(
        store.session(session.id).retry?.attempt,
        (payload as Wire).willRetry ? undefined : 2,
      );
      service.ingest(session.id, "text-delta", { text: "resumed" });
      assert.equal(store.session(session.id).retry, undefined);
    }
    const translator = new OpenCodeEvents((type, payload) => {
      service.ingest(session.id, type, payload);
    });
    translator.accept("session.status", { status: { type: "retry", attempt: 3 } });
    assert.equal(store.session(session.id).retry?.attempt, 3);
    translator.accept("session.idle", {});
    assert.equal(store.session(session.id).retry, undefined);
    assert.equal(store.session(session.id).runState, "idle");
  } finally {
    await service.dispose();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
