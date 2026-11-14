import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Session } from "@kodo/protocol";
import type { AdapterContext, Wire } from "../src/harnesses/adapter.js";
import { readClaudeTree } from "../src/harnesses/claude-history.js";
import { claudeAdapterWithQuery } from "../src/harnesses/claude-code.js";

test("installed Claude SDK restores isolated synthetic subagent logs without model calls or replayed billing", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "kooyu-claude-tree-")));
  const home = join(dir, "isolated"),
    cwd = join(dir, "workspace"),
    id = randomUUID();
  await mkdir(cwd);
  // Match the SDK's native realpath, including Windows runner 8.3 temp paths.
  const canonicalCwd = await realpath(cwd);
  const project = join(home, "projects", canonicalCwd.replace(/[^a-zA-Z0-9]/g, "-"));
  const children = join(project, id, "subagents");
  const message = (text: string, role = "assistant") => ({
    type: role,
    uuid: randomUUID(),
    parentUuid: null,
    sessionId: id,
    cwd: canonicalCwd,
    timestamp: new Date().toISOString(),
    message: { role, content: [{ type: "text", text }] as Wire[] },
  });
  const events: { type: string; payload: Wire; key?: string }[] = [];
  const original = process.env.CLAUDE_CONFIG_DIR;
  await mkdir(children, { recursive: true });
  const root = message("root stored prompt", "user");
  await writeFile(join(project, id + ".jsonl"), JSON.stringify(root) + "\n");
  const child = message("child saved output");
  child.message.content.push({
    type: "tool_use",
    id: "saved-read",
    name: "Read",
    input: { file_path: "marker.txt" },
  });
  for (const [agent, row, meta] of [
    ["child", child, { toolUseId: "toolu_child" }],
    [
      "grandchild",
      message("grandchild saved output"),
      { parentAgentId: "child", toolUseId: "toolu_grandchild" },
    ],
  ] as const) {
    await writeFile(join(children, "agent-" + agent + ".jsonl"), JSON.stringify(row) + "\n");
    await writeFile(join(children, "agent-" + agent + ".meta.json"), JSON.stringify(meta));
  }
  // The SDK enumerates this empty file; it must remain an explicit incomplete child.
  await writeFile(join(children, "agent-empty.jsonl"), "");
  const ctx: AdapterContext = {
    cwd: canonicalCwd,
    dataDir: dir,
    env: { ...process.env, CLAUDE_CONFIG_DIR: home },
    launch: { command: "claude-sdk", args: [] },
    emit: (type, payload, key) => events.push({ type, payload: payload as Wire, key }),
    interact: async () => assert.fail("offline history must not ask approval"),
  };
  const adapter = claudeAdapterWithQuery((() =>
    assert.fail("history must not call query")) as never);
  try {
    const history = (await adapter.standaloneRead!(
      { nativeSessionId: id } as Session,
      ctx,
    )) as Wire;
    assert.match(JSON.stringify(history.messages), /root stored prompt/);
    assert.match(JSON.stringify(history.subagents), /child saved output/);
    assert.equal(history.complete, false);
    assert.match(history.subagents.find((c: Wire) => c.agentId === "empty").error, /为空/);
    assert.equal(events.length, 0);
    const runtime = await adapter.connect({ nativeSessionId: id } as Session, ctx);
    try {
      assert.equal(process.env.CLAUDE_CONFIG_DIR, original);
      const saved = events.filter((e) => e.type === "subagent");
      assert.ok(
        saved.some(
          (e) =>
            e.payload.agentId === "toolu_grandchild" && e.payload.parentAgentId === "toolu_child",
        ),
      );
      assert.match(JSON.stringify(saved), /grandchild saved output/);
      assert.ok(
        saved.some(
          (e) =>
            e.payload.event?.type === "tool" && e.payload.event.payload.toolCallId === "saved-read",
        ),
      );
      assert.ok(!events.some((e) => ["usage", "turn-ended", "disconnected"].includes(e.type)));
      assert.ok(saved.every((e) => !["usage", "turn-ended"].includes(e.payload.event?.type)));
      const keys = saved.filter((e) => e.key).map((e) => e.key);
      const length = events.length;
      await runtime.read!();
      assert.deepEqual(
        events
          .slice(length)
          .filter((e) => e.key)
          .map((e) => e.key),
        keys,
      );
    } finally {
      await runtime.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Claude history validates parentage, foreign identities, repeated pages and byte limits", async () => {
  const row = (uuid: string, parent: string | null = null) => ({
    type: "assistant" as const,
    uuid,
    session_id: "root",
    parent_agent_id: parent,
    parent_tool_use_id: null,
    message: { role: "assistant", content: "saved" },
  });
  const sdk = {
    getSessionMessages: async () => [row("root-message")],
    listSubagents: async () => ["child", "grandchild"],
    getSubagentMessages: async (_id: string, agent: string) => [
      row(agent, agent === "child" ? "grandchild" : "child"),
    ],
  };
  await assert.rejects(readClaudeTree(sdk, "root", tmpdir()), /存在环/);
  await assert.rejects(
    readClaudeTree({ ...sdk, listSubagents: async () => ["../foreign"] }, "root", tmpdir()),
    /身份无效/,
  );
  await assert.rejects(
    readClaudeTree(
      { ...sdk, getSessionMessages: async () => [{ ...row("a"), session_id: "foreign" }] },
      "root",
      tmpdir(),
    ),
    /身份不匹配/,
  );
  const repeated = Array.from({ length: 500 }, (_, i) => row(String(i)));
  await assert.rejects(
    readClaudeTree({ ...sdk, getSessionMessages: async () => repeated }, "root", tmpdir()),
    /重复/,
  );
  await assert.rejects(
    readClaudeTree(
      {
        ...sdk,
        getSessionMessages: async () => [
          { ...row("a"), message: { content: "x".repeat(8 * 1024 * 1024) } },
        ],
      },
      "root",
      tmpdir(),
    ),
    /读取上限/,
  );
  const incomplete = await readClaudeTree(
    {
      ...sdk,
      getSubagentMessages: async (_id, agent) => [{ ...row(agent), session_id: "foreign" }],
    },
    "root",
    tmpdir(),
  );
  assert.equal(incomplete.complete, false);
  assert.ok(incomplete.subagents.every((child) => child.error && !child.messages));
  await assert.rejects(
    readClaudeTree(
      {
        ...sdk,
        getSubagentMessages: async (_id, agent) => [
          { ...row(agent), parent_tool_use_id: "same-tool" },
        ],
      },
      "root",
      tmpdir(),
    ),
    /工具身份冲突/,
  );
});
