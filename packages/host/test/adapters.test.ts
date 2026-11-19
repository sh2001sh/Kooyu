import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { adapters } from "../src/harnesses/registry.js";
import type { AdapterContext } from "../src/harnesses/adapter.js";
import { readCompleteJsonLines } from "../src/harnesses/native-history.js";
import { captureNativeCommand } from "../src/harnesses/native-command.js";
import { listCursorSessions } from "../src/harnesses/cursor.js";
import { RpcRejected } from "../src/harnesses/rpc.js";
import type { RuntimeEvent, Session, BindingRuntime } from "@kodo/protocol";
const fixture = fileURLToPath(new URL("./fixtures/native-peer.mjs", import.meta.url));
const grokFixture = fileURLToPath(new URL("./fixtures/grok-cli.mjs", import.meta.url));
const kimiFixture = fileURLToPath(new URL("./fixtures/kimi-cli.mjs", import.meta.url));
const kimiServerFixture = fileURLToPath(
  new URL("./fixtures/@moonshot-ai/kimi-code/dist/main.mjs", import.meta.url),
);
const modelListFixture = fileURLToPath(new URL("./fixtures/model-list-cli.mjs", import.meta.url));

for (const [harness, entry, args] of [
  ["opencode", "opencode-peer.mjs", []],
  ["kimi-code", "@moonshot-ai/kimi-code/dist/main.mjs", ["acp"]],
] as const) {
  test(
    harness + " reports failed native server spawn without an unhandled process error",
    { timeout: 5000 },
    async () => {
      const adapter = adapters.find((item) => item.descriptor.id === harness)!;
      await assert.rejects(
        adapter.connect({ id: randomUUID(), nativeSessionId: null } as Session, {
          cwd: join(tmpdir(), "absent-" + randomUUID()),
          dataDir: tmpdir(),
          env: process.env,
          launch: {
            command: process.execPath,
            args: [fileURLToPath(new URL("./fixtures/" + entry, import.meta.url)), ...args],
          },
          emit: () => {},
          interact: async () => ({}),
        }),
        /ENOENT/,
      );
    },
  );
}

test("Gemini and Cursor discover native model catalogs independently", async () => {
  const context = (mode: string): AdapterContext => ({
    cwd: tmpdir(),
    dataDir: tmpdir(),
    env: process.env,
    launch: { command: process.execPath, args: [modelListFixture, mode] },
    emit: () => {},
    interact: async () => ({}),
  });
  const gemini = adapters.find((adapter) => adapter.descriptor.id === "gemini")!;
  const cursor = adapters.find((adapter) => adapter.descriptor.id === "cursor")!;
  assert.deepEqual(
    (await gemini.discoverModels!(context("--acp"))).map((model) => model.id),
    ["gemini-test"],
  );
  const models = await cursor.discoverModels!(context("acp"));
  assert.deepEqual(
    models.map((model) => model.id),
    ["auto", "model-test"],
  );
  assert.equal(models[0]?.isDefault, true);
  const grok = adapters.find((adapter) => adapter.descriptor.id === "grok-build")!;
  const grokModels = await grok.discoverModels!({
    ...context("agent"),
    env: { ...process.env, SYNTHETIC_GROK_MODELS: "1" },
    launch: { command: process.execPath, args: [modelListFixture, "agent", "stdio"] },
  });
  assert.deepEqual(
    grokModels.map((model) => model.id),
    ["grok-test", "grok-other"],
  );
  assert.equal(grokModels[0]?.isDefault, true);
});

test("Grok lists only bounded local session summaries for the current workspace", async () => {
  const home = mkdtempSync(join(tmpdir(), "kodo-grok-list-"));
  const cwd = join(home, "workspace");
  const root = join(home, "sessions", encodeURIComponent(cwd));
  mkdirSync(cwd);
  const id = randomUUID();
  const other = randomUUID();
  mkdirSync(join(root, id), { recursive: true });
  mkdirSync(join(root, other), { recursive: true });
  writeFileSync(
    join(root, id, "summary.json"),
    JSON.stringify({
      info: { id, cwd },
      generated_title: "Current workspace",
      created_at: "2026-11-12T00:00:00Z",
      updated_at: "2026-11-12T01:00:00Z",
      current_model_id: "grok-test",
      session_summary: "private transcript",
    }),
  );
  writeFileSync(
    join(root, other, "summary.json"),
    JSON.stringify({ info: { id: other, cwd: join(home, "other") } }),
  );
  try {
    const adapter = adapters.find((item) => item.descriptor.id === "grok-build")!;
    const ctx: AdapterContext = {
      cwd,
      dataDir: home,
      env: { ...process.env, GROK_HOME: home },
      launch: { command: process.execPath, args: [grokFixture, "agent", "stdio"] },
      emit: () => {},
      interact: async () => ({}),
    };
    const listing = await adapter.standaloneList!({} as Session, ctx);
    assert.equal((listing as any[]).length, 1);
    assert.equal((listing as any[])[0].id, id);
    assert.equal(JSON.stringify(listing).includes("private transcript"), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("Kimi reads native messages without exposing internal configuration", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kodo-kimi-history-"));
  const sessionDir = join(dir, "sessions", "workspace", "native-acp-test");
  const wireDir = join(sessionDir, "agents", "main");
  mkdirSync(wireDir, { recursive: true });
  writeFileSync(
    join(wireDir, "wire.jsonl"),
    [
      { type: "profile.bind", systemPrompt: "private configuration" },
      {
        type: "agent.message.appended",
        message: { message: { role: "user", content: [{ type: "text", text: "hello" }] } },
      },
      {
        type: "agent.message.appended",
        message: { message: { role: "assistant", content: [{ type: "text", text: "world" }] } },
      },
    ]
      .map((value) => JSON.stringify(value))
      .join("\n") + '\n{"type":',
  );
  const adapter = adapters.find((a) => a.descriptor.id === "kimi-code")!;
  assert.equal(adapter.descriptor.capabilities.historyRead, "supported");
  try {
    const runtime = await adapter.connect(
      { id: randomUUID(), nativeSessionId: "native-acp-test" } as Session,
      {
        cwd: dir,
        dataDir: dir,
        env: { ...process.env, KIMI_CODE_HOME: dir, SYNTHETIC_KIMI_SESSION_DIR: sessionDir },
        launch: { command: process.execPath, args: [kimiFixture, "acp"] },
        emit: () => {},
        interact: async () => ({}),
      },
    );
    try {
      const history = await runtime.read!();
      assert.equal(JSON.stringify(history).includes("private configuration"), false);
      assert.deepEqual(
        (history as any).messages.map((m: any) => m.role),
        ["user", "assistant"],
      );
      const listing = await runtime.list!();
      assert.deepEqual(
        (listing as any[]).map((item) => item.id),
        ["native-acp-test"],
      );
      assert.equal(JSON.stringify(listing).includes("sessionDir"), false);
    } finally {
      await runtime.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Kimi Server permission rejects an installation without a Server entry", async () => {
  const adapter = adapters.find((item) => item.descriptor.id === "kimi-code")!;
  await assert.rejects(
    adapter.connect(
      { id: randomUUID(), nativeSessionId: null, permissionMode: "kimi:manual" } as Session,
      {
        cwd: tmpdir(),
        dataDir: tmpdir(),
        env: process.env,
        launch: { command: process.execPath, args: [kimiFixture, "acp"] },
        emit: () => {},
        interact: async () => ({}),
      },
    ),
    /没有已验证的 Server API 入口/,
  );
});

test("Kimi opens new sessions through the native Server API", async () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  const requests: { url: string; method: string; body?: any }[] = [];
  const events: { type: string; payload: any; eventId?: string }[] = [];
  const nativeSessionId = "session_mock-native";
  const interactionResolvers = new Map<string, (value: unknown) => void>();
  const resolvedInteractions: string[] = [];
  let interactionCount = 0;
  let holdInteractions = false;
  class MockWebSocket extends EventTarget {
    static latest: MockWebSocket | undefined;
    readyState = 0;
    readonly protocol: string;
    constructor(_url: string | URL, protocols?: string | string[]) {
      super();
      this.protocol = Array.isArray(protocols) ? (protocols[0] ?? "") : (protocols ?? "");
      MockWebSocket.latest = this;
      queueMicrotask(() => {
        this.readyState = 1;
        this.dispatchEvent(new Event("open"));
      });
    }
    send(raw: string) {
      const frame = JSON.parse(raw);
      const payload =
        frame.type === "subscribe_v2" ? { accepted: [nativeSessionId], not_found: [] } : {};
      queueMicrotask(() =>
        this.dispatchEvent(
          new MessageEvent("message", {
            data: JSON.stringify({ type: "ack", id: frame.id, code: 0, msg: "success", payload }),
          }),
        ),
      );
    }
    close() {
      this.readyState = 3;
      this.dispatchEvent(new Event("close"));
    }
    push(frame: any) {
      this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(frame) }));
    }
  }
  Object.defineProperty(globalThis, "WebSocket", { value: MockWebSocket, configurable: true });
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    requests.push({ url, method, body });
    if (url.endsWith("/api/v1/healthz")) return new Response(null, { status: 200 });
    if (url.endsWith("/api/v1/models"))
      return Response.json({
        code: 0,
        msg: "success",
        data: {
          items: [
            {
              provider: "test",
              model: "model-a",
              max_context_size: 4096,
              capabilities: ["tool_use", "image_in"],
              support_efforts: ["low", "high", "max"],
              default_effort: "high",
            },
          ],
        },
      });
    if (url.endsWith("/api/v1/sessions") && method === "POST")
      return Response.json({ code: 0, msg: "success", data: { id: nativeSessionId } });
    if (url.endsWith("/api/v1/sessions/" + nativeSessionId) && method === "GET")
      return Response.json({
        code: 0,
        msg: "success",
        data: { id: nativeSessionId, current_prompt_id: "prompt_mock" },
      });
    if (url.endsWith("/profile") && method === "POST")
      return Response.json({
        code: 0,
        msg: "success",
        data: { agent_config: { permission_mode: body.agent_config.permission_mode } },
      });
    if (url.includes("/interactions/") && method === "POST")
      return Response.json({ code: 0, msg: "success", data: { outcome: body.decision } });
    if (url.endsWith("/prompts") && body?.prompt_id === "synthetic-http-rejection")
      return new Response("temporarily unavailable", { status: 503 });
    if (url.endsWith("/prompts") && body?.prompt_id === "synthetic-business-rejection")
      return Response.json({ code: 123, msg: "synthetic rejected" });
    if (url.endsWith("/prompts") && method === "POST")
      return Response.json({
        code: 0,
        msg: "success",
        data: { prompt_id: "prompt_mock", status: "running" },
      });
    if (url.endsWith("/prompts::steer") && method === "POST")
      return Response.json({ code: 0, msg: "success", data: { steered: true } });
    if (url.endsWith("/prompts/prompt_mock:abort") && method === "POST")
      return Response.json({ code: 0, msg: "success", data: { aborted: true } });
    throw new Error(`Unexpected Kimi mock request: ${method} ${url}`);
  };
  try {
    const adapter = adapters.find((a) => a.descriptor.id === "kimi-code")!;
    const runtime = await adapter.connect(
      { id: randomUUID(), title: "Native API test", nativeSessionId: null } as Session,
      {
        cwd: tmpdir(),
        dataDir: tmpdir(),
        env: process.env,
        launch: { command: process.execPath, args: [kimiServerFixture, "acp"] },
        emit: (type, payload, eventId) => events.push({ type, payload, eventId }),
        interact: async (id) => {
          interactionCount++;
          if (!holdInteractions) return { decision: "accept" };
          return new Promise((resolve) => {
            interactionResolvers.set(id, resolve);
          });
        },
        resolveInteraction: (id) => resolvedInteractions.push(id),
      },
    );
    try {
      assert.equal(runtime.nativeSessionId, nativeSessionId);
      await assert.rejects(
        runtime.send("synthetic", "synthetic-http-rejection", "new"),
        RpcRejected,
      );
      await assert.rejects(
        runtime.send("synthetic", "synthetic-business-rejection", "new"),
        RpcRejected,
      );
      assert.equal(runtime.capabilities?.steer, "supported");
      assert.deepEqual(
        (await runtime.models!()).map((model) => [model.id, model.contextWindow]),
        [["test/model-a", 4096]],
      );
      assert.equal(MockWebSocket.latest?.protocol, "kimi-code.bearer.mock-token");
      assert.deepEqual(
        (await runtime.permissionOptions!()).options.map((option) => option.value),
        ["kimi:manual", "kimi:auto", "kimi:yolo"],
      );
      await runtime.setPermissionMode!("kimi:manual");
      assert.equal((await runtime.permissionOptions!()).current, "kimi:manual");
      assert.deepEqual(requests.find((entry) => entry.url.endsWith("/profile"))?.body, {
        agent_config: { permission_mode: "manual" },
      });
      assert.deepEqual(requests.find((entry) => entry.url.endsWith("/api/v1/sessions"))?.body, {
        title: "Native API test",
        metadata: { cwd: tmpdir() },
      });
      const sent = await runtime.send("hello", "command-mock", "queue");
      assert.deepEqual(sent, { nativeRunId: "prompt_mock" });
      assert.deepEqual(requests.find((entry) => entry.body?.prompt_id === "command-mock")?.body, {
        content: [{ type: "text", text: "hello" }],
        prompt_id: "command-mock",
        permission_mode: "manual",
      });
      await runtime.send("follow up", "steer-command", "steer");
      assert.deepEqual(requests.find((entry) => entry.url.endsWith("/prompts::steer"))?.body, {
        prompt_ids: ["prompt_mock"],
      });
      assert.equal(await runtime.supportsImages!("test/model-a"), true);
      assert.equal(await runtime.supportsImages!("test/unknown"), false);
      await runtime.send(
        "",
        "image-command",
        "new",
        { model: "test/model-a", reasoning: "max", revision: 1 },
        {
          images: [
            {
              type: "image",
              data: "aW1hZ2U=",
              mimeType: "image/png",
              path: join(tmpdir(), "image.png"),
            },
          ],
        },
      );
      assert.deepEqual(requests.find((entry) => entry.body?.prompt_id === "image-command")?.body, {
        content: [
          { type: "image", source: { kind: "base64", media_type: "image/png", data: "aW1hZ2U=" } },
        ],
        prompt_id: "image-command",
        model: "test/model-a",
        thinking: "max",
        permission_mode: "manual",
      });
      await runtime.send("default", "default-thinking", "new", {
        model: "test/model-a",
        reasoning: null,
        revision: 2,
      });
      assert.equal(
        requests.find((entry) => entry.body?.prompt_id === "default-thinking")?.body.thinking,
        "high",
      );
      await assert.rejects(
        runtime.send("bad", "bad-thinking", "new", {
          model: "test/model-a",
          reasoning: "ultra",
          revision: 3,
        }),
        /未声明这个思考档位/,
      );
      await assert.rejects(
        runtime.send(
          "x",
          "bad-image",
          "new",
          { model: "test/unknown", reasoning: null, revision: 2 },
          {
            images: [
              {
                type: "image",
                data: "aW1hZ2U=",
                mimeType: "image/png",
                path: join(tmpdir(), "image.png"),
              },
            ],
          },
        ),
        /未声明图片输入/,
      );
      MockWebSocket.latest!.push({
        type: "interaction",
        session_id: nativeSessionId,
        status: "pending",
        kind: "approval",
        interaction_id: "approval-mock",
        request: { tool_name: "Bash", action: "echo hello" },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.deepEqual(
        requests.find((entry) => entry.url.endsWith("/interactions/approval-mock"))?.body,
        { kind: "approval", decision: "approved" },
      );
      MockWebSocket.latest!.push({
        type: "interaction",
        session_id: nativeSessionId,
        status: "pending",
        kind: "approval",
        interaction_id: "approval-mock",
        request: {},
      });
      assert.equal(interactionCount, 1);
      holdInteractions = true;
      const staleApproval = {
        type: "interaction",
        session_id: nativeSessionId,
        status: "pending",
        kind: "approval",
        interaction_id: "expired",
        request: {},
      };
      MockWebSocket.latest!.push(staleApproval);
      MockWebSocket.latest!.push(staleApproval);
      MockWebSocket.latest!.push({ ...staleApproval, status: "ended", outcome: "cancelled" });
      MockWebSocket.latest!.push(staleApproval);
      interactionResolvers.get("expired")!({ decision: "accept" });
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(interactionCount, 2);
      assert.ok(resolvedInteractions.includes("expired"));
      assert.ok(!requests.some((entry) => entry.url.endsWith("/interactions/expired")));
      for (const agent_id of ["child-a", "child-b"]) {
        MockWebSocket.latest!.push({
          type: "transcript.ops",
          session_id: nativeSessionId,
          agent_id,
          payload: {
            seq: 1,
            ops: [
              {
                op: "frame.upsert",
                frame: {
                  kind: "text",
                  role: "assistant",
                  frameId: "turn.f1",
                  text: agent_id + " output",
                },
              },
              {
                op: "turn.upsert",
                turn: {
                  turnId: "turn",
                  state: "completed",
                  triggerPromptId: "prompt_mock",
                  usage: { output: 2 },
                },
              },
            ],
          },
        });
      }
      assert.equal(events.filter((event) => event.type === "turn-ended").length, 0);
      assert.equal(events.filter((event) => event.type === "text-delta").length, 0);
      assert.match(
        JSON.stringify(events.filter((event) => event.type === "subagent")),
        /child-a output/,
      );
      assert.match(
        JSON.stringify(events.filter((event) => event.type === "subagent")),
        /child-b output/,
      );
      const childText = events.filter(
        (event) => event.type === "subagent" && event.payload.event?.type === "text-delta",
      );
      assert.equal(new Set(childText.map((event) => event.eventId)).size, 2);
      assert.equal(
        events.filter((event) => event.type === "subagent").at(-1)?.payload.status,
        "completed",
      );
      MockWebSocket.latest!.push({
        type: "transcript.ops",
        session_id: nativeSessionId,
        payload: {
          seq: 1,
          ops: [
            {
              op: "frame.upsert",
              frame: { kind: "text", role: "assistant", frameId: "turn.f1", text: "" },
            },
            { op: "append", target: { frameId: "turn.f1" }, offset: 0, text: "OK" },
            { op: "append", target: { frameId: "turn.f1" }, offset: 0, text: "OK" },
            { op: "turn.upsert", turn: { turnId: "turn", state: "completed" } },
          ],
        },
      });
      assert.equal(
        events.some((event) => event.type === "text-delta" && event.payload.text === "OK"),
        true,
      );
      assert.equal(events.filter((event) => event.type === "text-delta").length, 1);
      assert.equal(
        events.some((event) => event.type === "turn-ended"),
        true,
      );
      await runtime.cancel();
      assert.equal(
        requests.some((entry) => entry.url.endsWith("/prompts/prompt_mock:abort")),
        true,
      );
      MockWebSocket.latest!.push({ ...staleApproval, interaction_id: "closed" });
      await runtime.close();
      interactionResolvers.get("closed")!({ decision: "accept" });
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.ok(!requests.some((entry) => entry.url.endsWith("/interactions/closed")));
      assert.ok(resolvedInteractions.includes("closed"));
      await assert.rejects(runtime.send("late", "late-command", "new"), /关闭/);
    } finally {
      await runtime.close();
    }
    const firstEventId = events.find((event) => event.type === "turn-ended")?.eventId;
    const resumed = await adapter.connect(
      { id: randomUUID(), nativeSessionId, permissionMode: "kimi:manual" } as Session,
      {
        cwd: tmpdir(),
        dataDir: tmpdir(),
        env: process.env,
        launch: { command: process.execPath, args: [kimiServerFixture, "acp"] },
        emit: (type, payload, eventId) => events.push({ type, payload, eventId }),
        interact: async () => ({}),
      },
    );
    try {
      assert.equal(resumed.nativeSessionId, nativeSessionId);
      assert.equal(
        requests.filter((entry) => entry.url.endsWith("/profile") && entry.method === "POST")
          .length,
        2,
      );
      MockWebSocket.latest!.push({
        type: "transcript.ops",
        session_id: nativeSessionId,
        payload: {
          seq: 1,
          ops: [{ op: "turn.upsert", turn: { turnId: "turn2", state: "completed" } }],
        },
      });
      const turnIds = events
        .filter((event) => event.type === "turn-ended")
        .map((event) => event.eventId);
      assert.equal(turnIds.length, 2);
      assert.notEqual(turnIds[1], firstEventId);
    } finally {
      await resumed.close();
    }
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "WebSocket", {
      value: originalWebSocket,
      configurable: true,
    });
  }
});

test("Native JSONL reader rejects damaged complete records", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kodo-native-history-"));
  const path = join(dir, "broken.jsonl");
  try {
    writeFileSync(path, '{"type":"user"}\n{"type":\n');
    await assert.rejects(readCompleteJsonLines(path), /损坏的完整记录/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Native command closes on output limit and timeout", async () => {
  const ctx = {
    cwd: tmpdir(),
    dataDir: tmpdir(),
    env: process.env,
    launch: { command: process.execPath, args: [] },
    emit: () => {},
    interact: async () => ({}),
  } satisfies AdapterContext;
  await assert.rejects(
    captureNativeCommand(ctx, ["-e", 'process.stdout.write("overflow")'], 4),
    /output exceeded the limit/,
  );
  await assert.rejects(
    captureNativeCommand(ctx, ["-e", "setInterval(() => {}, 1000)"], 1024, 100),
    /timed out/,
  );
});

test("Gemini reads exact native chat without exposing session context or thoughts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kodo-gemini-history-"));
  const home = join(dir, "home");
  const geminiRoot = join(home, ".gemini");
  const chats = join(geminiRoot, "tmp", "workspace", "chats");
  mkdirSync(chats, { recursive: true });
  writeFileSync(
    join(geminiRoot, "projects.json"),
    JSON.stringify({ projects: { [dir]: "workspace" } }),
  );
  writeFileSync(
    join(chats, "session-match.jsonl"),
    [
      { sessionId: "native-acp-test", kind: "main" },
      {
        type: "user",
        content: [{ text: "<session_context>private configuration</session_context>" }],
      },
      { type: "user", content: [{ text: "hello" }] },
      {
        type: "gemini",
        content: "world",
        thoughts: "private reasoning",
        toolCalls: [{ name: "read_file", status: "success", result: "file text" }],
      },
    ]
      .map((record) => JSON.stringify(record))
      .join("\n") + '\n{"type":',
  );
  writeFileSync(
    join(chats, "session-other.jsonl"),
    JSON.stringify({ sessionId: "other-session", kind: "main" }) +
      "\n" +
      JSON.stringify({ type: "user", content: [{ text: "other private conversation" }] }) +
      "\n",
  );
  const adapter = adapters.find((a) => a.descriptor.id === "gemini")!;
  assert.equal(adapter.descriptor.capabilities.historyRead, "supported");
  try {
    const runtime = await adapter.connect(
      { id: randomUUID(), nativeSessionId: "native-acp-test" } as Session,
      {
        cwd: dir,
        dataDir: dir,
        env: { ...process.env, GEMINI_CLI_HOME: home },
        launch: { command: process.execPath, args: [fixture, "acp"] },
        emit: () => {},
        interact: async () => ({}),
      },
    );
    try {
      const history = await runtime.read!();
      assert.deepEqual(
        (history as any).messages.map((message: any) => message.role),
        ["user", "assistant", "tool"],
      );
      assert.equal(JSON.stringify(history).includes("private configuration"), false);
      assert.equal(JSON.stringify(history).includes("private reasoning"), false);
      assert.equal(JSON.stringify(history).includes("other private conversation"), false);
      const listing = await runtime.list!();
      assert.deepEqual(
        (listing as any[]).map((item) => item.id),
        ["native-acp-test", "other-session"],
      );
    } finally {
      await runtime.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Cursor lists only bounded local session metadata for the current workspace", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kodo-cursor-list-"));
  const root = join(dir, "acp-sessions");
  const mine = randomUUID();
  const other = randomUUID();
  mkdirSync(join(root, mine), { recursive: true });
  mkdirSync(join(root, other), { recursive: true });
  writeFileSync(
    join(root, mine, "meta.json"),
    JSON.stringify({ schemaVersion: 1, cwd: dir, title: "My chat" }),
  );
  writeFileSync(
    join(root, other, "meta.json"),
    JSON.stringify({ schemaVersion: 1, cwd: tmpdir(), title: "Other chat" }),
  );
  try {
    assert.deepEqual(
      (await listCursorSessions(root, dir)).map((item) => item.id),
      [mine],
    );
    assert.deepEqual(await listCursorSessions(join(dir, "missing"), dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Grok reads its original transcript through the native CLI export", async () => {
  const adapter = adapters.find((a) => a.descriptor.id === "grok-build")!;
  assert.equal(adapter.descriptor.capabilities.historyRead, "supported");
  const runtime = await adapter.connect(
    { id: randomUUID(), nativeSessionId: "native-acp-test" } as Session,
    {
      cwd: tmpdir(),
      dataDir: tmpdir(),
      env: process.env,
      launch: { command: process.execPath, args: [grokFixture, "agent", "stdio"] },
      emit: () => {},
      interact: async () => ({}),
    },
  );
  try {
    assert.deepEqual(await runtime.read!(), {
      nativeSessionId: "native-acp-test",
      format: "markdown",
      transcript: "## User\n\nSynthetic prompt\n\n## Assistant\n\nSynthetic reply\n",
    });
  } finally {
    await runtime.close();
  }
});

for (const [resume, method] of [
  [true, "session/resume"],
  [false, "session/load"],
] as const)
  test("ACP recovers an existing session with " + method, async () => {
    const dir = mkdtempSync(join(tmpdir(), "kodo-acp-recovery-"));
    const log = join(dir, "wire.jsonl");
    const adapter = adapters.find((a) => a.descriptor.id === "gemini")!;
    assert.equal(adapter.descriptor.capabilities.historyRead, "supported");
    assert.equal(adapter.descriptor.capabilities.steer, "unsupported");
    try {
      const runtime = await adapter.connect(
        { id: randomUUID(), nativeSessionId: "native-acp-test" } as Session,
        {
          cwd: dir,
          dataDir: dir,
          env: {
            ...process.env,
            SYNTHETIC_WIRE_LOG: log,
            ...(resume ? { SYNTHETIC_ACP_RESUME: "1" } : {}),
          },
          launch: { command: process.execPath, args: [fixture, "acp"] },
          emit: () => {},
          interact: async () => ({}),
        },
      );
      try {
        assert.equal(runtime.nativeSessionId, "native-acp-test");
        await runtime.send("after recovery", randomUUID(), "new");
      } finally {
        await runtime.close();
      }
      const wire = readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.ok(wire.some((item) => item.method === method));
      assert.ok(!wire.some((item) => item.method === (resume ? "session/load" : "session/resume")));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

test("Codex reads an empty desktop draft without masking missing nonempty history", async () => {
  const adapter = adapters.find((a) => a.descriptor.id === "codex")!;
  const runtime = await adapter.connect({ id: randomUUID(), nativeSessionId: null } as Session, {
    cwd: tmpdir(),
    dataDir: tmpdir(),
    env: { ...process.env, SYNTHETIC_CODEX_EMPTY_HISTORY: "1" },
    launch: { command: process.execPath, args: [fixture, "codex"] },
    emit: () => {},
    interact: async () => ({}),
  });
  try {
    assert.deepEqual(
      ((await runtime.read!()) as { thread: { turns: unknown[] } }).thread.turns,
      [],
    );
    await runtime.send("synthetic first turn", randomUUID(), "new");
    await assert.rejects(runtime.read!(), /list_turns is not supported yet/);
  } finally {
    await runtime.close();
  }
});

test("ACP preserves an exact current model omitted from the picker and rejects undeclared thought changes", async () => {
  const adapter = adapters.find((a) => a.descriptor.id === "gemini")!;
  const configuration = {
    id: randomUUID(),
    revision: 1,
    model: "current-native-model",
    provider: "synthetic",
    credentialRef: null,
    binding: { harnessId: "gemini", reasoning: "high" },
  } as BindingRuntime;
  const ctx: AdapterContext = {
    cwd: tmpdir(),
    dataDir: tmpdir(),
    configuration,
    model: configuration.model,
    reasoning: "high",
    env: { ...process.env, SYNTHETIC_ACP_CURRENT_ONLY: configuration.model },
    launch: { command: process.execPath, args: [fixture, "acp"] },
    emit: () => {},
    interact: async () => ({ decision: "decline" }),
  };
  const runtime = await adapter.connect(
    { id: randomUUID(), nativeSessionId: null } as Session,
    ctx,
  );
  try {
    await runtime.send("isolated synthetic protocol input", randomUUID(), "new", {
      revision: 0,
      model: configuration.model,
      reasoning: "high",
    });
    await assert.rejects(
      runtime.send("must not dispatch", randomUUID(), "new", {
        revision: 1,
        model: configuration.model,
        reasoning: "low",
      }),
      /未声明思考切换接口/,
    );
  } finally {
    await runtime.close();
  }
  await assert.rejects(
    adapter.connect({ id: randomUUID(), nativeSessionId: null } as Session, {
      ...ctx,
      model: "undeclared-model",
    }),
    /未声明所选模型/,
  );
});
for (const id of [
  "codex",
  "deepseek-harness",
  "zcode",
  "gemini",
  "cursor",
  "kimi-code",
  "grok-build",
] as const)
  test(`${id}: native wire translation against isolated synthetic protocol peer`, async () => {
    const adapter = adapters.find((a) => a.descriptor.id === id)!,
      events: { type: RuntimeEvent["type"]; payload: unknown }[] = [];
    const s = {
      id: randomUUID(),
      harnessId: id,
      kind: "direct",
      hostId: "test-host",
      title: "Synthetic protocol test",
      nativeSessionId: null,
    } as Session;
    const mode = ["codex", "zcode"].includes(id) ? id : id === "deepseek-harness" ? "dsh" : "acp";
    const ctx: AdapterContext = {
      cwd: tmpdir(),
      dataDir: tmpdir(),
      env: process.env,
      launch: {
        command: process.execPath,
        args: id === "grok-build" ? [grokFixture, "agent", "stdio"] : [fixture, mode],
      },
      emit: (type, payload) => events.push({ type, payload }),
      interact: async () => ({ decision: "decline" }),
      ...(id === "deepseek-harness"
        ? {
            configuration: {
              id: randomUUID(),
              revision: 1,
              name: "synthetic",
              provider: "test",
              model: "test",
              credentialRef: null,
            },
          }
        : {}),
    };
    const runtime = await adapter.connect(s, ctx);
    try {
      assert.ok(runtime.nativeSessionId);
      if (id === "codex") await assert.rejects(runtime.cancel(), /没有活动/);
      if (id === "zcode")
        assert.equal(
          events.some((e) => e.type === "turn-ended" || e.type === "settled"),
          false,
        );
      const receipt = await runtime.send("synthetic transport input", randomUUID(), "new");
      assert.equal(receipt.nativeRunId, id === "codex" ? "native-turn-test" : null);
      if (mode === "acp") assert.ok(events.some((e) => e.type === "tool"));
      if (mode === "acp" && !["gemini", "grok-build", "kimi-code", "cursor"].includes(id))
        assert.equal(runtime.read, undefined, "ACP capabilities are not native history");
      if (id === "grok-build")
        assert.ok(JSON.stringify(await runtime.read!()).includes("Synthetic reply"));
      if (id === "zcode") {
        assert.deepEqual(
          events.filter((e) => e.type === "text-delta").map((e) => (e.payload as any).text),
          ["合约 ", "OK"],
        );
        assert.equal(events.filter((e) => e.type === "turn-ended").length, 1);
        assert.equal(
          events.some((e) => e.type === "settled"),
          false,
        );
        assert.equal((events.find((e) => e.type === "usage")?.payload as any).inputTokens, 3);
        await runtime.cancel();
        assert.equal(events.filter((e) => e.type === "settled").length, 1);
        assert.ok(JSON.stringify(await runtime.read!()).includes("合约 OK"));
      }
    } finally {
      await runtime.close();
    }
  });

test("OpenCode V1 headless HTTP and SSE translate tool, usage and idle separately", async () => {
  const adapter = adapters.find((a) => a.descriptor.id === "opencode")!,
    events: { type: string; payload: unknown }[] = [],
    s = {
      id: randomUUID(),
      harnessId: "opencode",
      kind: "direct",
      hostId: "test-host",
      title: "Isolated synthetic HTTP contract",
      nativeSessionId: null,
    } as Session;
  const runtime = await adapter.connect(s, {
    cwd: tmpdir(),
    dataDir: tmpdir(),
    env: process.env,
    launch: {
      command: process.execPath,
      args: [fileURLToPath(new URL("./fixtures/opencode-peer.mjs", import.meta.url))],
    },
    emit: (type, payload) => events.push({ type, payload }),
    interact: async () => ({ reply: "reject" }),
  });
  try {
    await runtime.send("isolated contract", randomUUID(), "new");
    for (let i = 0; i < 50 && !events.some((e) => e.type === "turn-ended"); i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.ok(events.some((e) => e.type === "tool"));
    assert.ok(events.some((e) => e.type === "usage"));
    assert.ok(events.some((e) => e.type === "turn-ended"));
    assert.equal(
      events.some((e) => e.type === "settled"),
      false,
    );
    await runtime.cancel();
    assert.deepEqual(await runtime.read!(), {
      nativeSessionId: runtime.nativeSessionId,
      messages: [],
      subagents: [],
      complete: true,
    });
  } finally {
    await runtime.close();
  }
});

test("DeepSeek prompt waits beyond the RPC handshake timeout and supports cancel", async (t) => {
  const adapter = adapters.find((a) => a.descriptor.id === "deepseek-harness")!;
  const runtime = await adapter.connect({ nativeSessionId: null } as Session, {
    cwd: tmpdir(),
    dataDir: tmpdir(),
    env: { ...process.env, SYNTHETIC_PROMPT_DELAY_MS: "200" },
    launch: { command: process.execPath, args: [fixture, "dsh"] },
    configuration: {
      id: randomUUID(),
      revision: 1,
      name: "isolated",
      provider: "synthetic",
      model: "synthetic",
      protocol: "native",
      credentialRef: null,
    },
    emit: () => {},
    interact: async () => ({}),
  });
  try {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let state = "pending";
    const send = runtime.send("isolated slow prompt", randomUUID(), "new").then(
      (value) => {
        state = "completed";
        return value;
      },
      (error) => {
        state = "failed";
        throw error;
      },
    );
    t.mock.timers.tick(31000);
    await Promise.resolve();
    assert.equal(state, "pending");
    t.mock.timers.reset();
    assert.equal((await send).nativeRunId, null);
    // Cancel restarts the runtime and resumes the same native session.
    await runtime.cancel();
    assert.equal(runtime.nativeSessionId.length > 0, true);
  } finally {
    t.mock.timers.reset();
    await runtime.close();
  }
});
