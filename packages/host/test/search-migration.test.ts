import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/storage/store.js";
import { SCHEMA_V1, SCHEMA_V2, SCHEMA_V3 } from "../src/storage/schema.js";
test("v3 unicode61 search index migrates without losing Chinese history or event references", () => {
  const dir = mkdtempSync(join(tmpdir(), "kodo-search-migration-")),
    path = join(dir, "state.sqlite");
  const db = new DatabaseSync(path);
  db.exec(SCHEMA_V1 + SCHEMA_V2 + SCHEMA_V3);
  db.prepare("INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,?)").run(
    "s",
    "合成迁移测试",
    "pi",
    "direct",
    "global",
    null,
    null,
    "test",
    "2020-01-01",
  );
  db.prepare("INSERT INTO search_index VALUES (?,?,?)").run(
    "s",
    "native-history:synthetic",
    "已经修复中文搜索功能",
  );
  db.close();
  const store = new Store(path);
  try {
    assert.equal(store.db.prepare("PRAGMA user_version").get()!.user_version, 10);
    assert.equal(store.search("中文")[0]?.eventId, "native-history:synthetic");
    assert.equal(store.search("中文搜索")[0]?.sessionId, "s");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
