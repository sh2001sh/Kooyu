import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Session } from "@kodo/protocol";
import type { AdapterContext } from "../src/harnesses/adapter.js";
import { readZCodeHistory } from "../src/harnesses/zcode-history.js";
import { readSdkHistory, listSdkHistory } from "../src/harnesses/sdk-history.js";

test("ZCode reads all pages in ascending order with exclusive cursors", async () => {
  const cursors: unknown[] = [];
  const result = await readZCodeHistory(async (params) => {
    cursors.push(params.beforeRowId);
    assert.equal(params.limit, 200);
    const before = params.beforeRowId ?? 451;
    return {
      rows: Array.from({ length: Math.min(200, before - 1) }, (_, i) => ({
        rowId: Math.max(1, before - 200) + i,
      })),
      hasMore: before > 201,
      atSeq: 500,
      atRevision: 7,
      atLogEpoch: "epoch",
    };
  });
  assert.deepEqual(cursors, [undefined, 251, 51]);
  assert.equal(result.rows.length, 450);
  assert.equal(result.rows[0]?.rowId, 1);
  assert.equal(result.rows[449]?.rowId, 450);
  assert.equal(result.hasMore, false);
});

test("ZCode rejects changing history, invalid pages and non-progressing cursors", async () => {
  const base = {
    rows: [{ rowId: 2 }],
    hasMore: true,
    atSeq: 5,
    atRevision: 1,
    atLogEpoch: "epoch",
  };
  for (const bad of [
    { ...base, atRevision: 2 },
    { ...base, atSeq: 6 },
    { ...base, atLogEpoch: "other" },
    { ...base, rows: [] },
    { ...base, rows: [{ rowId: 2 }] },
    { ...base, rows: [{ rowId: 1 }, { rowId: 0 }] },
  ]) {
    let count = 0;
    await assert.rejects(readZCodeHistory(async () => (count++ ? bad : base)));
    assert.equal(count, 2);
  }
  await assert.rejects(
    readZCodeHistory(async () => ({ ...base, rows: "invalid" })),
    /响应无效/,
  );
});

test("SDK history reads without opening credentials, creating sessions or rewriting logs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kodo-sdk-history-"));
  const session = { id: "product", harnessId: "pi", nativeSessionId: "native" } as Session;
  const context: AdapterContext = {
    cwd: dir,
    dataDir: dir,
    env: {},
    launch: { command: "never-run", args: [] },
    emit: () => assert.fail("history replayed as live event"),
    interact: async () => assert.fail("history asked permission"),
  };
  try {
    const root = join(dir, "pi", "sessions");
    await mkdir(root, { recursive: true });
    const path = join(root, "native.jsonl");
    const records = [
      { type: "session", version: 3, id: "native", cwd: dir, timestamp: "2026-11-13T00:00:00Z" },
      {
        type: "message",
        id: "m1",
        parentId: null,
        timestamp: "2026-11-13T00:00:01Z",
        message: { role: "user", content: "history", timestamp: 1 },
      },
      {
        type: "message",
        id: "m2",
        parentId: "m1",
        timestamp: "2026-11-13T00:00:02Z",
        message: { role: "assistant", content: [{ type: "text", text: "reply" }], timestamp: 2 },
      },
    ];
    const original = records.map((record) => JSON.stringify(record)).join("\n") + "\n";
    await writeFile(path, original);
    await writeFile(join(root, "product.json"), JSON.stringify({ path }));
    const history = await readSdkHistory(session, context);
    assert.equal(history.length, 2);
    assert.equal(history[0]?.role, "user");
    assert.equal(history[0]?.role === "user" && history[0].content, "history");
    assert.equal(await readFile(path, "utf8"), original);
    assert.deepEqual((await readdir(root)).sort(), ["native.jsonl", "product.json"]);
    await assert.rejects(
      readSdkHistory({ ...session, nativeSessionId: "wrong" }, context),
      /身份不匹配/,
    );
    assert.equal((await listSdkHistory(session, context)).length, 1);
    context.sdkSessionOwners = () => ({ native: "kodo" });
    assert.equal((await listSdkHistory(session, context)).length, 0);
    const legacy = { ...session, harnessId: "kodo" } as Session;
    assert.equal((await readSdkHistory(legacy, context)).length, 2);
    assert.equal((await listSdkHistory(legacy, context)).length, 1);
    await writeFile(path, "");
    await assert.rejects(readSdkHistory(session, context), /身份不匹配/);
    assert.equal(await readFile(path, "utf8"), "");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
