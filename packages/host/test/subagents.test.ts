import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Session } from "@kodo/protocol";
import type { AdapterContext, Wire } from "../src/harnesses/adapter.js";
import { NativeSubagents } from "../src/harnesses/subagents.js";
import { grokWorkspaceContext } from "../src/harnesses/grok-build.js";
import { acpHarness } from "../src/harnesses/acp.js";
import { codexAdapter } from "../src/harnesses/codex.js";
import { deepSeekAdapter } from "../src/harnesses/deepseek-harness.js";
import { claudeAdapterWithQuery } from "../src/harnesses/claude-code.js";
import { opencodeAdapter } from "../src/harnesses/opencode.js";
import { zcodeAdapter } from "../src/harnesses/zcode.js";

const peer = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
function setup(args: string[] = [], env: NodeJS.ProcessEnv = {}) {
  const events: { type: string; payload: Wire; key?: string }[] = [];
  const ctx: AdapterContext = {
    cwd: tmpdir(),
    dataDir: tmpdir(),
    env: { ...process.env, ...env },
    launch: { command: process.execPath, args },
    interact: async () => ({}),
    emit: (type, payload, key) => events.push({ type, payload: payload as Wire, key }),
  };
  return { events, ctx };
}

test("child envelopes preserve lineage, dedup identity and final status without touching root", () => {
  const { events, ctx } = setup();
  const children = new NativeSubagents(ctx, () => "root");
  assert.equal(children.register("foreign", "other"), false);
  assert.equal(children.register("child", "root", { status: "running" }), true);
  assert.equal(children.register("grandchild", "child"), true);
  assert.equal(children.register("child", "grandchild"), false);
  children.emit("child", "turn-ended", { outcome: "completed" }, "same");
  children.emit("grandchild", "turn-ended", { outcome: "failed" }, "same");
  children.emit("child", "usage", { output: 3 });
  assert.equal(events.at(-1)!.payload.status, "completed");
  assert.equal(new Set(events.filter((e) => e.key).map((e) => e.key)).size, 2);
  assert.ok(events.every((e) => e.type === "subagent"));
});

test("Windows Grok gets private scratch and no stale leader without changing user environment", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodo-grok-context-"));
  try {
    const { ctx } = setup(["grok.js", "agent", "stdio"]);
    ctx.dataDir = dir;
    ctx.launch.env = { TMP: "broken", GROK_HOME: "keep-home" };
    const fixed = await grokWorkspaceContext(ctx, "win32");
    assert.deepEqual(fixed.launch.args, ["grok.js", "agent", "--no-leader", "stdio"]);
    assert.equal(fixed.launch.env!.GROK_HOME, "keep-home");
    assert.equal(fixed.launch.env!.TMP, fixed.launch.env!.TEMP);
    assert.ok((await stat(fixed.launch.env!.TMP!)).isDirectory());
    assert.equal(ctx.launch.env.TMP, "broken");
    assert.deepEqual((await grokWorkspaceContext(fixed, "win32")).launch.args, fixed.launch.args);
    assert.equal(await grokWorkspaceContext(ctx, "linux"), ctx);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

for (const mode of ["acp", "cursor", "dsh", "codex"] as const)
  test(`${mode} routes descendant output and ignores unrelated sessions`, async () => {
    const { events, ctx } = setup([peer("subagent-peer.mjs"), mode]);
    if (mode === "dsh")
      ctx.configuration = {
        id: "fixture",
        revision: 1,
        name: "fixture",
        provider: "synthetic",
        model: "synthetic",
        credentialRef: null,
      };
    const adapter =
      mode === "acp"
        ? acpHarness("grok-build", "Grok")
        : mode === "cursor"
          ? acpHarness("cursor", "Cursor")
          : mode === "dsh"
            ? deepSeekAdapter
            : codexAdapter;
    const runtime = await adapter.connect({ nativeSessionId: null } as Session, ctx);
    try {
      await runtime.send("synthetic", "command", "new");
      const children = events.filter((e) => e.type === "subagent");
      assert.match(JSON.stringify(children), /child output/);
      assert.match(JSON.stringify(children), /grandchild output/);
      assert.match(JSON.stringify(children), /child final output/);
      assert.doesNotMatch(JSON.stringify(events), /foreign output/);
      assert.doesNotMatch(
        JSON.stringify(events.filter((e) => e.type !== "subagent")),
        /grandchild output|child output/,
      );
      assert.equal(events.filter((e) => e.type === "turn-ended").length, 1);
    } finally {
      await runtime.close();
    }
  });

for (const mode of ["acp", "cursor"] as const)
  test(`${mode} restores child identity without replaying historical output`, async () => {
    const { events, ctx } = setup([peer("subagent-peer.mjs"), mode]);
    const adapter = acpHarness(mode === "acp" ? "grok-build" : "cursor", mode);
    const runtime = await adapter.connect({ nativeSessionId: "root-agent" } as Session, ctx);
    try {
      assert.ok(
        events.some((e) => e.type === "subagent" && e.payload.agentId === "replayed-child"),
      );
      assert.doesNotMatch(JSON.stringify(events), /historical replay content/);
    } finally {
      await runtime.close();
    }
  });

test("Claude forwards full child text and task lifecycle separately from root", async () => {
  const { events, ctx } = setup();
  ctx.launch.command = "claude-sdk";
  let forwarded = false;
  const runQuery = (({ options }: Wire) => {
    forwarded = options.forwardSubagentText === true;
    return {
      async *[Symbol.asyncIterator]() {
        yield { type: "system", subtype: "init", session_id: options.sessionId };
        yield {
          type: "assistant",
          uuid: "spawn",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "child-tool",
                name: "Agent",
                input: { description: "Child test" },
              },
            ],
          },
        };
        yield {
          type: "system",
          subtype: "task_started",
          task_id: "task",
          tool_use_id: "child-tool",
          task_type: "local_agent",
        };
        yield {
          type: "stream_event",
          parent_tool_use_id: "child-tool",
          event: {
            type: "content_block_delta",
            delta: { type: "text_delta", text: "child output" },
          },
        };
        yield {
          type: "assistant",
          parent_tool_use_id: "child-tool",
          uuid: "child-message",
          message: { role: "assistant", content: [{ type: "text", text: "child output" }] },
        };
        yield {
          type: "system",
          subtype: "task_notification",
          task_id: "task",
          tool_use_id: "child-tool",
          status: "completed",
          summary: "child summary",
        };
        yield { type: "result", uuid: "root-result", is_error: false, usage: {} };
      },
      close() {},
    };
  }) as unknown as Parameters<typeof claudeAdapterWithQuery>[0];
  const runtime = await claudeAdapterWithQuery(runQuery).connect(
    { nativeSessionId: null } as Session,
    ctx,
  );
  try {
    await runtime.send("test", "command", "new");
    assert.equal(forwarded, true);
    assert.match(
      JSON.stringify(events.filter((e) => e.type === "subagent")),
      /child output|child summary/,
    );
    assert.doesNotMatch(
      JSON.stringify(events.filter((e) => e.type !== "subagent")),
      /child output|child summary/,
    );
    assert.equal(events.filter((e) => e.type === "turn-ended").length, 1);
    assert.equal(events.filter((e) => e.type === "subagent").at(-1)!.payload.status, "completed");
  } finally {
    await runtime.close();
  }
});

for (const kind of ["opencode", "zcode"] as const)
  test(`${kind} exposes child output without ending parent twice`, async () => {
    const { events, ctx } = setup(
      kind === "opencode" ? [peer("opencode-peer.mjs")] : [peer("native-peer.mjs"), "zcode"],
      { SYNTHETIC_SUBAGENTS: "1" },
    );
    const adapter = kind === "opencode" ? opencodeAdapter : zcodeAdapter;
    const runtime = await adapter.connect(
      { nativeSessionId: null, hostId: "test" } as Session,
      ctx,
    );
    try {
      await runtime.send("test", "command", "new");
      for (
        let n = 0;
        n < 100 &&
        !events.some(
          (e) => e.type === "subagent" && JSON.stringify(e.payload).includes("child output"),
        );
        n++
      )
        await new Promise((r) => setTimeout(r, 20));
      assert.match(JSON.stringify(events.filter((e) => e.type === "subagent")), /child output/);
      assert.doesNotMatch(
        JSON.stringify(events.filter((e) => e.type !== "subagent")),
        /child output|foreign output/,
      );
      assert.equal(events.filter((e) => e.type === "turn-ended").length, 1);
    } finally {
      await runtime.close();
    }
  });
