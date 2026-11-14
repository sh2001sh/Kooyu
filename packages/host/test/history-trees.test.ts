import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { zstdCompressSync } from "node:zlib";
import type { Session } from "@kodo/protocol";
import type { AdapterContext, Wire } from "../src/harnesses/adapter.js";
import { codexAdapter } from "../src/harnesses/codex.js";
import { opencodeAdapter } from "../src/harnesses/opencode.js";
import { deepSeekAdapter } from "../src/harnesses/deepseek-harness.js";
import { readOpenCodeTree } from "../src/harnesses/opencode-history.js";
import { readCodexTree } from "../src/harnesses/codex-history.js";
import { inspectDshFiles } from "../src/harnesses/session-presence.js";
import { zcodeAdapter } from "../src/harnesses/zcode.js";

const peer = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
function context(args: string[] = [], env: NodeJS.ProcessEnv = {}) {
  const events: { type: string; payload: Wire; key?: string }[] = [];
  const ctx: AdapterContext = {
    cwd: tmpdir(),
    dataDir: tmpdir(),
    env: { ...process.env, ...env },
    launch: { command: process.execPath, args },
    interact: async () => assert.fail("history asked permission"),
    emit: (type, payload, key) => events.push({ type, payload: payload as Wire, key }),
  };
  return { ctx, events };
}

for (const kind of ["codex", "opencode"] as const) {
  const adapter = kind === "codex" ? codexAdapter : opencodeAdapter;
  const nativeSessionId = kind === "codex" ? "root" : "synthetic-opencode-session";
  const setup = (env = {}) =>
    context([peer(kind === "codex" ? "codex-history-peer.mjs" : "opencode-peer.mjs")], {
      SYNTHETIC_RECOVER_CHILDREN: "1",
      ...env,
    });
  test(`${kind} offline history includes stored descendants without creating or resuming sessions`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "kodo-history-tree-")),
      log = join(dir, "calls.jsonl");
    const { ctx, events } = setup({ SYNTHETIC_WIRE_LOG: log });
    try {
      const history = (await adapter.standaloneRead!({ nativeSessionId } as Session, ctx)) as Wire;
      assert.equal(history.complete, true);
      assert.deepEqual(
        history.subagents.map((child: Wire) => [child.agentId, child.parentAgentId]),
        [
          ["child", nativeSessionId],
          ["grandchild", "child"],
        ],
      );
      assert.match(JSON.stringify(history), /grandchild saved output/);
      assert.equal(events.length, 0);
      const calls = (await readFile(log, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.ok(
        calls.every((call) =>
          kind === "codex"
            ? ["initialize", "initialized", "thread/read", "thread/list"].includes(call.method)
            : call.method === "GET",
        ),
      );
      assert.doesNotMatch(JSON.stringify(calls), /threadId":"foreign/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  test(`${kind} reconnect restores nested output without replaying root completion or billing`, async () => {
    const { ctx, events } = setup();
    const runtime = await adapter.connect({ nativeSessionId } as Session, ctx);
    try {
      const children = events.filter((event) => event.type === "subagent");
      assert.match(JSON.stringify(children), /grandchild saved output/);
      if (kind === "opencode") {
        const thoughts = children.filter((e) => e.payload.event?.payload?.channel === "thought");
        assert.equal(thoughts.length, 2);
        assert.match(JSON.stringify(thoughts), /grandchild saved reasoning/);
      }
      assert.ok(
        children.every((event) => !["turn-ended", "usage"].includes(event.payload.event?.type)),
      );
      assert.equal(
        events.filter((event) => ["turn-ended", "usage"].includes(event.type)).length,
        0,
      );
      assert.equal(events.filter((event) => event.type === "error").length, 0);
      const keys = children.filter((event) => event.key).map((event) => event.key);
      await runtime.read!();
      assert.deepEqual(
        events
          .filter((event) => event.type === "subagent" && event.key)
          .slice(keys.length)
          .map((event) => event.key),
        keys,
      );
    } finally {
      await runtime.close();
    }
  });
}

test("missing Codex child retains explicit incomplete history and readable descendants", async () => {
  const { ctx } = context([peer("codex-history-peer.mjs")], { SYNTHETIC_MISSING_CHILD: "1" });
  const history = (await codexAdapter.standaloneRead!(
    { nativeSessionId: "root" } as Session,
    ctx,
  )) as Wire;
  assert.equal(history.complete, false);
  assert.match(history.subagents[0].error, /unavailable/);
  assert.match(JSON.stringify(history.subagents[1]), /grandchild saved output/);
});

test("Codex rejects a foreign history root before scanning descendants", async () => {
  await assert.rejects(
    readCodexTree(async () => ({ thread: { id: "foreign" } }), "root"),
    /身份不匹配/,
  );
});

test("OpenCode refuses forged child lineage and cyclic graphs", async () => {
  for (const child of [
    { id: "foreign", parentID: "other" },
    { id: "root", parentID: "root" },
  ])
    await assert.rejects(
      readOpenCodeTree(
        async (path) => (path.endsWith("/children") ? [child] : ([] as unknown as Wire)),
        "root",
      ),
      /身份或父级/,
    );
});

test("ZCode reads native session index without creating or resuming a conversation", async () => {
  const { ctx, events } = context([peer("native-peer.mjs"), "zcode"]);
  const result = (await zcodeAdapter.standaloneList!({} as Session, ctx)) as Wire;
  assert.equal(result.sessions[0].sessionId, "saved-session");
  assert.equal(result.coverage, "native-index-window");
  assert.equal(result.complete, false);
  assert.equal(events.length, 0);
  ctx.env.SYNTHETIC_ZCODE_FOREIGN_INDEX = "1";
  await assert.rejects(zcodeAdapter.standaloneList!({} as Session, ctx), /工作区/);
});

async function dshFixture(run: (ctx: AdapterContext, path: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "kodo-dsh-history-"));
  const path = join(dir, "sessions", "--workspace--", "session-a");
  await mkdir(path, { recursive: true });
  const { ctx } = context([], { DSH_HOME: dir });
  // A history inspection must work with an unusable launcher and no provider configuration.
  ctx.launch.command = "must-not-start-a-runtime";
  try {
    await run(ctx, path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const log = (version: number, text = "saved output", id = "session-a") =>
  JSON.stringify({
    type: "session",
    version,
    id,
    createdAt: 123,
    cwd: tmpdir(),
    isSeeded: false,
    delegationDepth: 0,
  }) +
  "\n" +
  JSON.stringify({
    type: "assistant/message",
    seq: 0,
    data: { message: { role: "assistant", content: text } },
  }) +
  "\n";

test("DSH independently reads latest compressed generation and lists validated identities without writes", async () =>
  dshFixture(async (ctx, path) => {
    await writeFile(join(path, "session.jsonl"), log(3, "retired output"));
    const data = zstdCompressSync(log(4));
    await writeFile(join(path, "session.v4.jsonl.zstd"), data);
    await writeFile(join(path, "session.v04.jsonl"), "temporary noncanonical file");
    const history = (await deepSeekAdapter.standaloneRead!(
      { nativeSessionId: "session-a" } as Session,
      ctx,
    )) as Wire;
    assert.match(JSON.stringify(history), /saved output/);
    assert.doesNotMatch(JSON.stringify(history), /retired output/);
    assert.deepEqual(await deepSeekAdapter.standaloneList!({} as Session, ctx), [
      { ...history.header },
    ]);
    assert.deepEqual(await readFile(join(path, "session.v4.jsonl.zstd")), data);
    assert.equal(
      (
        await inspectDshFiles(
          [{ nativeSessionId: "session-a" } as Session],
          ctx.env.DSH_HOME!,
          true,
        )
      )["session-a"],
      "present",
    );
  }));

test("DSH refuses unsupported newer generations instead of falling back to stale history", async () =>
  dshFixture(async (ctx, path) => {
    await writeFile(join(path, "session.v4.jsonl"), log(4));
    await writeFile(join(path, "session.v5.jsonl"), log(5));
    await assert.rejects(
      deepSeekAdapter.standaloneRead!({ nativeSessionId: "session-a" } as Session, ctx),
      /版本不兼容/,
    );
  }));

test("DSH reads appended Zstandard frames and refuses a torn or corrupt later frame", async () =>
  dshFixture(async (ctx, path) => {
    const lines = log(4).trimEnd().split("\n");
    const header = zstdCompressSync(lines[0]! + "\n"),
      event = zstdCompressSync(lines[1]! + "\n");
    const filename = join(path, "session.v4.jsonl.zstd"),
      session = { nativeSessionId: "session-a" } as Session;
    await writeFile(filename, Buffer.concat([header, event, event]));
    const history = (await deepSeekAdapter.standaloneRead!(session, ctx)) as Wire;
    assert.equal(history.events.length, 2);
    assert.match(JSON.stringify(history.events), /saved output/);
    await writeFile(filename, Buffer.concat([header, event.subarray(0, event.length - 1)]));
    await assert.rejects(deepSeekAdapter.standaloneRead!(session, ctx), /未完整/);
    await writeFile(filename, Buffer.concat([header, Buffer.from("invalid frame")]));
    await assert.rejects(deepSeekAdapter.standaloneRead!(session, ctx), /帧损坏/);
  }));

test("DSH preserves legacy v0 logs as raw evidence without migrating them", async () =>
  dshFixture(async (ctx, path) => {
    const data = zstdCompressSync(log(0, "legacy saved output"));
    await writeFile(join(path, "session.jsonl.zstd"), data);
    const history = (await deepSeekAdapter.standaloneRead!(
      { nativeSessionId: "session-a" } as Session,
      ctx,
    )) as Wire;
    assert.equal(history.header.version, 0);
    assert.match(JSON.stringify(history.events), /legacy saved output/);
    assert.deepEqual(await readFile(join(path, "session.jsonl.zstd")), data);
  }));

test("DSH checks native identity, traversal and complete JSONL corruption", async () =>
  dshFixture(async (ctx, path) => {
    await writeFile(join(path, "session.v4.jsonl"), log(4, "foreign output", "other"));
    await assert.rejects(
      deepSeekAdapter.standaloneRead!({ nativeSessionId: "session-a" } as Session, ctx),
      /身份/,
    );
    await assert.rejects(
      deepSeekAdapter.standaloneRead!({ nativeSessionId: "../session-a" } as Session, ctx),
      /ID 无效/,
    );
    await writeFile(join(path, "session.v4.jsonl"), log(4) + "{broken}\n");
    await assert.rejects(
      deepSeekAdapter.standaloneRead!({ nativeSessionId: "session-a" } as Session, ctx),
      /损坏记录/,
    );
    await writeFile(join(path, "session.v4.jsonl"), log(4) + "{unfinished");
    const history = (await deepSeekAdapter.standaloneRead!(
      { nativeSessionId: "session-a" } as Session,
      ctx,
    )) as Wire;
    assert.equal(history.events.length, 1);
  }));

test("DSH bounds decompression size and rejects ambiguous physical generations", async () =>
  dshFixture(async (ctx, path) => {
    await writeFile(
      join(path, "session.v4.jsonl.zstd"),
      zstdCompressSync(log(4, "x".repeat(8 * 1024 * 1024))),
    );
    await assert.rejects(
      deepSeekAdapter.standaloneRead!({ nativeSessionId: "session-a" } as Session, ctx),
    );
    // Listing only decodes the header, so one large transcript cannot hide all sessions.
    assert.equal(((await deepSeekAdapter.standaloneList!({} as Session, ctx)) as Wire[]).length, 1);
    await writeFile(join(path, "session.v4.jsonl"), log(4));
    await assert.rejects(
      deepSeekAdapter.standaloneRead!({ nativeSessionId: "session-a" } as Session, ctx),
      /世代不明确/,
    );
  }));
