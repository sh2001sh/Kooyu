import assert from "node:assert/strict";
import { test } from "node:test";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Session } from "@kodo/protocol";
import type { AdapterContext, Wire } from "../src/harnesses/adapter.js";
import { deepSeekAdapter } from "../src/harnesses/deepseek-harness.js";
import { opencodeAdapter } from "../src/harnesses/opencode.js";
import { codexAdapter } from "../src/harnesses/codex.js";
import { zcodeAdapter } from "../src/harnesses/zcode.js";
import { claudeAdapterWithQuery } from "../src/harnesses/claude-code.js";
const claudeAdapter = claudeAdapterWithQuery();

const peer = (name: string) => fileURLToPath(new URL("./fixtures/" + name, import.meta.url));
const context = (
  args: string[],
  env: NodeJS.ProcessEnv,
  emit: AdapterContext["emit"],
): AdapterContext => ({
  cwd: tmpdir(),
  dataDir: tmpdir(),
  env: { ...process.env, ...env },
  launch: { command: process.execPath, args },
  emit,
  interact: async () => ({}),
});

test("independent native inspections do not create sessions, subscribe or send prompts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodo-native-inspect-"));
  try {
    for (const [adapter, name, args] of [
      [opencodeAdapter, "opencode", [peer("opencode-peer.mjs")]],
      [codexAdapter, "codex", [peer("native-peer.mjs"), "codex"]],
      [zcodeAdapter, "zcode", [peer("native-peer.mjs"), "zcode"]],
    ] as const) {
      const path = join(dir, name + ".jsonl");
      const ctx = context([...args], { SYNTHETIC_WIRE_LOG: path }, () =>
        assert.fail("inspection emitted a live event"),
      );
      if (adapter.standaloneList) {
        const list = (await adapter.standaloneList(
          { nativeSessionId: null } as Session,
          ctx,
        )) as Wire;
        if (name === "codex")
          assert.deepEqual(
            list.data.map((item: Wire) => item.id),
            ["first", "second"],
          );
      }
      await adapter.standaloneRead!(
        {
          nativeSessionId: name === "opencode" ? "synthetic-opencode-session" : "existing",
        } as Session,
        ctx,
      );
      const calls = (await readFile(path, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.ok(calls.length);
      assert.ok(
        calls.every((call) =>
          name === "opencode"
            ? call.method === "GET"
            : [
                "initialize",
                "initialized",
                "thread/list",
                "thread/read",
                "v4/conversation/rowsRange",
                "v4/conversation/subscribe",
              ].includes(call.method),
        ),
      );
    }
    const ctx = context(
      [peer("native-peer.mjs"), "codex"],
      { SYNTHETIC_CODEX_REPEAT_CURSOR: "1" },
      () => {},
    );
    await assert.rejects(codexAdapter.standaloneList!({} as Session, ctx), /游标重复/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Claude standalone history uses the binding home without changing Host environment", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodo-claude-history-"));
  const original = process.env.CLAUDE_CONFIG_DIR;
  const id = randomUUID();
  try {
    const cwd = join(dir, "workspace");
    const home = join(dir, "isolated");
    const project = join(home, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
    await mkdir(cwd);
    await mkdir(project, { recursive: true });
    const message = {
      type: "user",
      uuid: randomUUID(),
      parentUuid: null,
      sessionId: id,
      cwd,
      timestamp: "2026-11-13T00:00:00.000Z",
      message: { role: "user", content: "isolated transcript" },
    };
    await writeFile(join(project, id + ".jsonl"), JSON.stringify(message) + "\n");
    const ctx = { ...context([], { CLAUDE_CONFIG_DIR: home }, () => {}), cwd };
    const history = await claudeAdapter.standaloneRead!({ nativeSessionId: id } as Session, ctx);
    assert.match(JSON.stringify(history), /isolated transcript/);
    assert.equal(process.env.CLAUDE_CONFIG_DIR, original);
    const listing = await claudeAdapter.standaloneList!({} as Session, ctx);
    assert.match(JSON.stringify(listing), new RegExp(id));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("OpenCode cancelled questions use the native rejection endpoint", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodo-opencode-question-"));
  const path = join(dir, "calls.jsonl");
  let ended!: () => void;
  const done = new Promise<void>((resolve) => {
    ended = resolve;
  });
  const ctx = context(
    [peer("opencode-peer.mjs")],
    { SYNTHETIC_WIRE_LOG: path, SYNTHETIC_OPENCODE_INTERACTION: "1" },
    (type) => {
      if (type === "turn-ended") ended();
    },
  );
  ctx.interact = async () => ({ cancelled: true });
  const runtime = await opencodeAdapter.connect({ nativeSessionId: null } as Session, ctx);
  try {
    await runtime.send("ask", randomUUID(), "new");
    await done;
    const calls = (await readFile(path, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.ok(
      calls.some((call) => call.path === "/question/question-1/reject" && call.data === null),
    );
    assert.ok(!calls.some((call) => call.path === "/question/question-1/reply"));
  } finally {
    await runtime.close();
    await rm(dir, { recursive: true, force: true });
  }
});

for (const ending of ["answer", "external", "close"] as const) {
  test(
    "OpenCode restores pending interactions and fences " + ending,
    { timeout: 10000 },
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "kodo-opencode-recover-"));
      const path = join(dir, "calls.jsonl");
      const answers = new Map<string, (value: unknown) => void>();
      const resolved = new Set<string>();
      const events: string[] = [];
      let allResolved!: () => void;
      const done = new Promise<void>((resolve) => {
        allResolved = resolve;
      });
      const ctx = context(
        [peer("opencode-peer.mjs")],
        {
          SYNTHETIC_WIRE_LOG: path,
          SYNTHETIC_OPENCODE_RECOVER: "1",
          ...(ending === "external" ? { SYNTHETIC_OPENCODE_RESOLVE: "1" } : {}),
        },
        (type) => events.push(type),
      );
      let asked = 0;
      ctx.interact = (id) => {
        asked++;
        return new Promise((resolve) => {
          answers.set(id, resolve);
        });
      };
      ctx.resolveInteraction = (id) => {
        resolved.add(id);
        if (resolved.size === 2) allResolved();
      };
      const runtime = await opencodeAdapter.connect(
        { nativeSessionId: "synthetic-opencode-session" } as Session,
        ctx,
      );
      try {
        assert.equal(asked, 2);
        if (ending === "external") {
          await runtime.list!();
          await done;
        }
        if (ending === "close") {
          await runtime.close();
          await done;
        }
        answers.get("permission-1")!({ reply: "once" });
        answers.get("question-1")!({ answers: [["Yes"]] });
        if (ending === "answer") await done;
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(asked, 2);
        const calls = (await readFile(path, "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        assert.equal(
          calls.filter((call) => call.method === "POST" && call.path.endsWith("/reply")).length,
          ending === "answer" ? 2 : 0,
        );
        assert.equal(
          calls.filter(
            (call) =>
              call.path.endsWith("/prompt_async") ||
              (call.path === "/session" && call.method === "POST"),
          ).length,
          0,
        );
        assert.ok(!events.includes("error"));
      } finally {
        await runtime.close();
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
}

test("DSH waits for native descendant completion and does not use enqueue ID as turn identity", async () => {
  const events: { type: string; payload: Wire }[] = [];
  const ctx = context(
    [peer("native-peer.mjs"), "dsh"],
    { SYNTHETIC_DSH_STATUS: "1" },
    (type, payload) => events.push({ type, payload: payload as Wire }),
  );
  ctx.configuration = {
    id: randomUUID(),
    revision: 1,
    name: "test",
    provider: "synthetic",
    model: "synthetic",
    protocol: "native",
    credentialRef: null,
  };
  const runtime = await deepSeekAdapter.connect({ nativeSessionId: null } as Session, ctx);
  try {
    await assert.rejects(runtime.cancel(), /没有活动/);
    assert.equal((await runtime.send("test", randomUUID(), "new")).nativeRunId, null);
    assert.equal(events.find((e) => e.type === "turn-ended")?.payload.outcome, "cancelled");
    assert.equal(events.filter((e) => e.type === "settled").length, 0);
    for (let i = 0; i < 100 && !events.some((e) => e.type === "settled"); i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.equal(events.filter((e) => e.type === "settled").length, 1);
    await assert.rejects(runtime.cancel(), /没有活动/);
  } finally {
    await runtime.close();
  }
});

test("OpenCode preserves split CRLF events and treats unexpected SSE EOF as disconnection", async () => {
  const events: { type: string; payload: Wire }[] = [];
  const ctx = context([peer("opencode-peer.mjs")], { SYNTHETIC_SSE_SPLIT: "1" }, (type, payload) =>
    events.push({ type, payload: payload as Wire }),
  );
  const runtime = await opencodeAdapter.connect({ nativeSessionId: null } as Session, ctx);
  try {
    await runtime.send("test", randomUUID(), "new");
    for (let i = 0; i < 100 && !events.some((e) => e.type === "disconnected"); i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.equal(events.find((e) => e.type === "text-delta")?.payload.text, "split CRLF");
    assert.ok(events.some((e) => e.type === "disconnected"));
    assert.ok(!events.some((e) => e.type === "settled" || e.type === "turn-ended"));
  } finally {
    await runtime.close();
  }
});
