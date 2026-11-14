import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { Session } from "@kodo/protocol";
import type { AdapterContext, Wire } from "../src/harnesses/adapter.js";
import { listAcpSessions } from "../src/harnesses/acp-sessions.js";
import { cursorAdapter, listCursorSessions } from "../src/harnesses/cursor.js";
import { grokBuildAdapter } from "../src/harnesses/grok-build.js";
import { geminiAdapter } from "../src/harnesses/gemini.js";
const peer = fileURLToPath(new URL("./fixtures/acp-list-peer.mjs", import.meta.url));
function context(cwd: string, mode: string): AdapterContext {
  return {
    cwd,
    dataDir: cwd,
    env: { ...process.env, ACP_LIST_CASE: mode },
    launch: { command: process.execPath, args: [peer] },
    emit: () => assert.fail("inspection emitted live state"),
    interact: async () => assert.fail("inspection requested approval"),
  };
}
test("Cursor and Grok use paginated ACP discovery without creating or loading a session", async () => {
  const root = await mkdtemp(join(tmpdir(), "kodo-acp-list-"));
  try {
    for (const adapter of [cursorAdapter, grokBuildAdapter]) {
      const ctx = context(root, "pages");
      ctx.env.ACP_LIST_LOG = join(root, adapter.descriptor.id + ".jsonl");
      const result = (await adapter.standaloneList!({} as Session, ctx)) as Wire[];
      assert.deepEqual(
        result.map((item) => item.id),
        ["first", "second"],
      );
      const calls = (await readFile(ctx.env.ACP_LIST_LOG, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.deepEqual(
        calls.map((call) => call.method),
        ["initialize", "session/list", "session/list"],
      );
      assert.deepEqual(calls[2].params, { cwd: root, cursor: "page-two" });
    }
    assert.deepEqual(await listAcpSessions(context(root, "empty")), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("ACP list falls back only on explicit unsupported capability or initial method", async () => {
  for (const mode of ["absent", "method"])
    assert.equal(await listAcpSessions(context(tmpdir(), mode)), null);
  for (const mode of ["auth", "late-method", "version"])
    await assert.rejects(listAcpSessions(context(tmpdir(), mode)));
});
test("ACP list rejects repeated cursors, malformed identity and oversized lists", async () => {
  for (const [mode, error] of [
    ["repeat", /游标重复/],
    ["invalid", /原生 ID/],
    ["limit", /上限/],
  ] as const)
    await assert.rejects(listAcpSessions(context(tmpdir(), mode)), error);
});
test("Gemini new workspaces list empty history without masking corrupt storage", async () => {
  const root = await mkdtemp(join(tmpdir(), "kodo-gemini-empty-"));
  const ctx = context(root, "unused");
  ctx.env.GEMINI_CLI_HOME = root;
  const list = () => geminiAdapter.standaloneList!({} as Session, ctx);
  try {
    assert.deepEqual(await list(), []);
    await mkdir(join(root, ".gemini"));
    assert.deepEqual(await list(), []);
    const mapping = join(root, ".gemini", "projects.json");
    await writeFile(mapping, JSON.stringify({ projects: {} }));
    assert.deepEqual(await list(), []);
    await writeFile(mapping, JSON.stringify({ projects: { [root]: "project" } }));
    assert.deepEqual(await list(), []);
    await assert.rejects(
      geminiAdapter.standaloneRead!({ nativeSessionId: "missing" } as Session, ctx),
      /没有此会话/,
    );
    await writeFile(mapping, "corrupt");
    await assert.rejects(list(), SyntaxError);
    await writeFile(mapping, JSON.stringify({ projects: { [root]: "../outside" } }));
    await assert.rejects(list(), /项目映射/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("Cursor local metadata fallback ignores paths escaping the session root", async () => {
  const root = await mkdtemp(join(tmpdir(), "kodo-cursor-path-"));
  try {
    const sessions = join(root, "sessions"),
      external = join(root, "outside");
    await mkdir(sessions);
    await mkdir(external);
    await writeFile(
      join(external, "meta.json"),
      JSON.stringify({ schemaVersion: 1, cwd: root, title: "outside" }),
    );
    await symlink(
      external,
      join(sessions, randomUUID()),
      process.platform === "win32" ? "junction" : "dir",
    );
    assert.deepEqual(await listCursorSessions(sessions, root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
