import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { Store } from "../src/storage/store.js";
import { SessionService } from "../src/session-service.js";
import { descriptor, type AdapterContext, type HarnessAdapter } from "../src/harnesses/adapter.js";
import type { ModelSettings } from "@kodo/protocol";
import { acpModelOptions, validateReasoning } from "../src/harnesses/model-options.js";

const tick = () => new Promise((r) => setTimeout(r, 25));
function setup(sendGate?: Promise<void>) {
  const store = new Store(":memory:");
  let context!: AdapterContext;
  const sends: { text: string; mode: string; settings?: ModelSettings }[] = [];
  const adapter: HarnessAdapter = {
    descriptor: descriptor(
      "codex",
      "Isolated synthetic model test",
      "app-server",
      ["directChat", "steer"],
      "No model execution",
      "partial",
    ),
    async connect(s, ctx) {
      context = ctx;
      return {
        nativeSessionId: s.nativeSessionId ?? "synthetic-stable-native-id",
        async models() {
          return [{ id: "model-b", reasoning: ["native-deep"], source: "discovered" }];
        },
        async send(text, _id, mode, settings) {
          sends.push({ text, mode, settings });
          await sendGate;
          return { nativeRunId: "synthetic-run" };
        },
        async cancel() {},
        async close() {},
      };
    },
  };
  const service = new SessionService(store, { adapters: [adapter] });
  const s = service.createDraft({
    title: "Synthetic model boundary",
    kind: "direct",
    harnessId: "codex",
    model: "model-a",
  });
  return {
    store,
    service,
    s,
    sends,
    context: () => context,
    close: async () => {
      await service.dispose();
      store.close();
    },
  };
}

test("model settings are idempotent, use compare-and-swap, and preserve native/profile identity", async () => {
  const f = setup();
  try {
    const native = await f.service.openNative(f.s.id);
    await f.service.sessionModelOptions(f.s.id, true);
    const input = {
      requestId: randomUUID(),
      expectedRevision: 0,
      model: "model-b",
      reasoning: "native-deep",
    };
    const [a, b] = await Promise.all([
      f.service.setModelSettings(f.s.id, input),
      f.service.setModelSettings(f.s.id, input),
    ]);
    assert.deepEqual(a, b);
    assert.equal(a.settingsRevision, 1);
    assert.equal(a.nativeSessionId, native.nativeSessionId);
    assert.equal(a.bindingId, native.bindingId);
    assert.equal(f.sends.length, 0, "settings never generate a user/model message");
    await assert.rejects(
      f.service.setModelSettings(f.s.id, { ...input, model: "other" }),
      /请求 ID/,
    );
    await assert.rejects(
      f.service.setModelSettings(f.s.id, { ...input, requestId: randomUUID() }),
      /另一客户端/,
    );
    assert.equal(f.store.events(f.s.id).filter((e) => (e.payload as any).modelSettings).length, 1);
  } finally {
    await f.close();
  }
});

test("running model changes apply at next queued dispatch; steer retains the active turn settings", async () => {
  const f = setup();
  try {
    f.service.acceptSend(f.s.id, { requestId: randomUUID(), text: "first", mode: "new" });
    await tick();
    const nativeId = f.store.session(f.s.id).nativeSessionId;
    assert.equal(f.sends[0]?.settings?.model, "model-a");
    const queued = f.service.acceptSend(f.s.id, {
      requestId: randomUUID(),
      text: "queued",
      mode: "queue",
    });
    await f.service.sessionModelOptions(f.s.id, true);
    await f.service.setModelSettings(f.s.id, {
      requestId: randomUUID(),
      expectedRevision: 0,
      model: "model-b",
      reasoning: "native-deep",
    });
    f.service.acceptSend(f.s.id, { requestId: randomUUID(), text: "guide", mode: "steer" });
    await tick();
    assert.equal(f.sends.length, 2);
    assert.equal(f.sends[1]?.mode, "steer");
    assert.equal(f.sends[1]?.settings, undefined);
    f.context().emit("turn-ended", { outcome: "completed" });
    await tick();
    assert.deepEqual(f.sends[2]?.settings, {
      model: "model-b",
      reasoning: "native-deep",
      revision: 1,
    });
    assert.equal((f.store.command(queued.id)?.body.settings as ModelSettings).revision, 1);
    assert.equal(f.store.session(f.s.id).nativeSessionId, nativeId);
  } finally {
    await f.close();
  }
});

test("unsupported model efforts fail before persistence and do not silently map to common levels", async () => {
  const f = setup();
  try {
    await f.service.sessionModelOptions(f.s.id, true);
    await assert.rejects(
      f.service.setModelSettings(f.s.id, {
        requestId: randomUUID(),
        expectedRevision: 0,
        model: "model-b",
        reasoning: "high",
      }),
      /未声明/,
    );
    assert.equal(f.store.session(f.s.id).settingsRevision, 0);
    assert.equal(f.sends.length, 0);
  } finally {
    await f.close();
  }
});

test("a stop during asynchronous native configuration fences the pending message", async () => {
  let release!: () => void;
  const f = setup(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  try {
    await f.service.openNative(f.s.id);
    const command = f.service.acceptSend(f.s.id, {
      requestId: randomUUID(),
      text: "not authorized after stop",
    });
    await tick();
    f.context().assertSendAllowed!(command.id);
    f.service.acceptSend(f.s.id, { requestId: randomUUID(), text: "another user message" });
    f.context().assertSendAllowed!(command.id);
    await f.service.stop(f.s.id, true);
    assert.throws(() => f.context().assertSendAllowed!(command.id), /停止|控制权/);
  } finally {
    release();
    await tick();
    await f.close();
  }
});

test("ACP effort capabilities belong to the current model only, including grouped model choices", () => {
  const options = acpModelOptions([
    {
      category: "model",
      type: "select",
      currentValue: "a",
      options: [{ name: "native provider", options: [{ value: "a" }, { value: "b" }] }],
    },
    { category: "thought_level", type: "select", options: [{ value: "native-deep" }] },
  ]);
  assert.deepEqual(options[0]?.reasoning, ["native-deep"]);
  assert.equal(options[1]?.reasoning, undefined);
  assert.doesNotThrow(() =>
    validateReasoning("a", "native-deep", [{ id: "a", source: "recent" }, ...options]),
  );
  assert.throws(() => validateReasoning("b", "native-deep", options), /未声明/);
});

test("usage follows the dispatched turn rather than a newer desired model; cumulative totals stay unassigned", async () => {
  const f = setup();
  try {
    f.service.acceptSend(f.s.id, { requestId: randomUUID(), text: "first" });
    await tick();
    await f.service.sessionModelOptions(f.s.id, true);
    await f.service.setModelSettings(f.s.id, {
      requestId: randomUUID(),
      expectedRevision: 0,
      model: "model-b",
      reasoning: "native-deep",
    });
    f.service.ingest(f.s.id, "usage", { input: 10 }, "old-turn-usage", "synthetic-run");
    f.service.ingest(f.s.id, "usage", { input: 10, scope: "session" }, "session-total");
    const usage = f.store.records<{ scope: string; model: string | null }>("usage");
    assert.equal(usage.find((u) => u.scope === "turn")?.model, "model-a");
    assert.equal(usage.find((u) => u.scope === "session")?.model, null);
  } finally {
    await f.close();
  }
});
