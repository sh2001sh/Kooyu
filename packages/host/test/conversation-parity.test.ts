import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID, createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/storage/store.js";
import { SessionService } from "../src/session-service.js";
import { descriptor, type NativeInput } from "../src/harnesses/adapter.js";
import { createAgentSession } from "@earendil-works/pi-coding-agent";
import { createKodoKernel } from "../src/kodo/kernel.js";
import type { HarnessBinding, Session } from "@kodo/protocol";
import { officialModelReasoning } from "../src/providers/model-reasoning.js";

test("branch copies only selected history, pins route, deduplicates, and passes original images on first send", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kooyu-branch-"));
  const store = new Store(":memory:");
  const sends: { text: string; input?: NativeInput }[] = [];
  const service = new SessionService(store, {
    dataDir: dir,
    adapters: [
      {
        descriptor: descriptor("codex", "Fixture", "sdk", ["send"], "synthetic", "implemented"),
        connect: async (_s, ctx) => ({
          nativeSessionId: randomUUID(),
          supportsImages: () => true,
          async send(text, _id, _mode, _settings, input) {
            sends.push({ text, input });
            ctx.emit("settled", { outcome: "completed", backgroundState: "settled" });
            return { nativeRunId: null };
          },
          async cancel() {},
          async close() {},
        }),
      },
    ],
  });
  try {
    const source = service.createDraft({
      title: "Original",
      harnessId: "codex",
      kind: "direct",
      bindingId: null,
    });
    const png = Buffer.from("synthetic-png");
    const up = service.files.createUpload({
      requestId: randomUUID(),
      sessionId: source.id,
      displayName: "image.png",
      mediaType: "image/png",
      size: png.length,
      sha256: createHash("sha256").update(png).digest("hex"),
    });
    service.files.appendChunk(up.id, 0, png);
    const file = await service.files.completeUpload(up.id);
    const attachment = service.files.attachmentFor(file.id, [source.id]);
    const emit = (id: string, role: string, text: string, attachments?: unknown[]) =>
      store.append({
        id,
        sessionId: source.id,
        type: "message",
        source: "native",
        nativeRunId: null,
        createdAt: new Date().toISOString(),
        payload: { role, text, ...(attachments ? { attachments } : {}) },
      });
    emit("u1", "user", "describe image", [attachment]);
    emit("a1", "assistant", "answer");
    emit("u2", "user", "future must not leak");
    const requestId = randomUUID();
    const fork = service.branch(source.id, { requestId, eventId: "a1" });
    assert.equal(service.branch(source.id, { requestId, eventId: "a1" }).id, fork.id);
    assert.throws(() => service.branch(source.id, { requestId, eventId: "u1" }), /不同内容/);
    assert.equal(fork.nativeSessionId, null);
    assert.equal(store.events(source.id).length, 3);
    assert.equal(store.events(fork.id).filter((e) => e.type === "message").length, 2);
    assert.ok(
      !store
        .record<{ context: string }>("branch-context", fork.id)!
        .context.includes("future must not leak"),
    );
    const edited = service.branch(source.id, {
      requestId: randomUUID(),
      eventId: "u2",
      edit: true,
    });
    assert.equal(store.events(edited.id).filter((e) => e.type === "message").length, 2);
    assert.throws(
      () => service.branch(source.id, { requestId: randomUUID(), eventId: "a1", edit: true }),
      /用户消息/,
    );
    assert.throws(
      () => service.branch(fork.id, { requestId: randomUUID(), eventId: "u2" }),
      /不可用/,
    );
    service.acceptSend(fork.id, { requestId: randomUUID(), text: "continue", mode: "new" });
    for (let i = 0; i < 100 && !sends.length; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(sends.length, 1);
    assert.match(sends[0]!.text, /describe image/);
    assert.doesNotMatch(sends[0]!.text, /future must not leak/);
    assert.equal(sends[0]!.input!.images![0]!.data, png.toString("base64"));
    // A branch retains a frozen route even if the current binding was removed or revised.
    store.saveSession({
      ...store.session(source.id),
      bindingId: "old-binding",
      bindingRevision: 7,
      instanceId: "old-instance",
    });
    const pinned = service.branch(source.id, { requestId: randomUUID(), eventId: "a1" });
    assert.equal(pinned.bindingId, "old-binding");
    assert.equal(pinned.bindingRevision, 7);
    assert.equal(pinned.instanceId, "old-instance");
  } finally {
    await service.dispose();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real pi SDK applies max and high, resets default, and accepts provider-qualified bound image input", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kooyu-pi-modal-"));
  const parameters = {
    contextWindow: 1000000,
    maxOutputTokens: 128000,
    input: ["text", "image"] as ("text" | "image")[],
    ...officialModelReasoning("deepseek-v4.1-flash", "openai-responses"),
  };
  const binding = {
    id: randomUUID(),
    model: "deepseek-v4.1-flash",
    harnessId: "pi",
    parameters,
  } as HarnessBinding;
  const calls: { level: string; images: unknown }[] = [];
  const events: unknown[] = [];
  const runtime = await createKodoKernel(
    {
      id: randomUUID(),
      harnessId: "pi",
      nativeSessionId: null,
      permissionMode: "kodo-tools-read",
    } as Session,
    {
      cwd: dir,
      dataDir: dir,
      env: {},
      launch: { command: "kodo-sdk", args: [] },
      reasoning: "max",
      configuration: {
        id: binding.id,
        revision: 1,
        name: "synthetic",
        provider: "synthetic",
        model: binding.model,
        protocol: "openai-responses",
        baseUrl: "https://example.invalid/v1",
        credentialRef: null,
        binding,
        modelParameters: parameters,
      },
      emit: (_type, payload) => events.push(payload),
      interact: async () => ({}),
      toolAction: async (_callId, _args, operation) => operation(),
    },
    async (options) => {
      const result = await createAgentSession(options);
      result.session.prompt = async (_text, opts) => {
        calls.push({ level: result.session.thinkingLevel, images: opts?.images });
      };
      return result;
    },
  );
  try {
    // Journaled write/edit/shell tools override built-ins; names must be unique.
    await runtime.setPermissionMode!(null);
    assert.equal(await runtime.supportsImages!("synthetic/deepseek-v4.1-flash"), true);
    const image = {
      type: "image" as const,
      data: "cG5n",
      mimeType: "image/png",
      path: join(dir, "image.png"),
    };
    await runtime.send(
      "describe",
      randomUUID(),
      "new",
      { model: "synthetic/deepseek-v4.1-flash", reasoning: "max", revision: 1 },
      { images: [image] },
    );
    await runtime.send("high", randomUUID(), "new", {
      model: binding.model,
      reasoning: "high",
      revision: 2,
    });
    await runtime.send("default", randomUUID(), "new", {
      model: binding.model,
      reasoning: null,
      revision: 3,
    });
    assert.equal(calls[0]!.level, "max");
    assert.deepEqual(calls[0]!.images, [image]);
    assert.equal(calls[1]!.level, "high");
    assert.notEqual(calls[2]!.level, "max");
    assert.ok(
      events.some((p) => (p as { effectiveReasoning?: string }).effectiveReasoning === "max"),
    );
  } finally {
    await runtime.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
