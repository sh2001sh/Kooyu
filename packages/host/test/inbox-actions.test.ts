import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { InboxItem } from "@kodo/protocol";
import { createHostServer } from "../src/http/server.js";
import { SessionService } from "../src/session-service.js";
import { Store } from "../src/storage/store.js";

test("inbox HTTP routes support marking read, bulk mark-all-read, and deleting stuck error or interaction items", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kooyu-inbox-actions-"));
  const store = new Store(":memory:");
  const service = new SessionService(store, { dataDir: dir });
  const options = { port: 0, webRoot: dir };
  const server = createHostServer(service, options);
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as { port: number }).port;
    options.port = port;

    const session = service.createDraft({
      title: "Inbox actions",
      harnessId: "kodo",
      kind: "supervisor",
    });
    const seed = (id: string, type: InboxItem["type"], message: string) => {
      store.put("inbox", id, {
        id,
        sessionId: session.id,
        type,
        payload: { message, result: "unknown" },
        createdAt: new Date().toISOString(),
        resolved: false,
      } satisfies InboxItem);
    };

    seed("err-1", "error", "Claude Code returned an error result");
    seed("err-2", "error", "Second transient error");
    seed("err-3", "error", "Third error to delete");
    seed("stale-int", "interaction", "Orphaned interaction after restart");

    const snapBefore = await (await fetch(`http://127.0.0.1:${port}/api/native/snapshot`)).json();
    assert.equal(snapBefore.inbox.filter((i: InboxItem) => !i.resolved).length, 4);

    // 1. Mark a single error item read -> resolves it so mobile & workbench both drop it.
    const r1 = await fetch(`http://127.0.0.1:${port}/api/inbox/err-1/read`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(r1.status, 200);
    const body1 = await r1.json();
    assert.equal(body1.status, "read");
    assert.equal(body1.resolved, true);

    const wbAfterRead = await (await fetch(`http://127.0.0.1:${port}/api/workbench`)).json();
    assert.equal(
      wbAfterRead.inbox.some((i: InboxItem) => i.id === "err-1"),
      false,
    );
    assert.equal(wbAfterRead.inbox.length, 3);

    // 2. Delete an item outright -> completely removed from store.
    const rDel = await fetch(`http://127.0.0.1:${port}/api/inbox/err-3`, {
      method: "DELETE",
    });
    assert.equal(rDel.status, 200);
    assert.equal((await rDel.json()).deleted, true);
    assert.equal(store.record("inbox", "err-3"), undefined);

    // 3. Mark all remaining dismissible items (err-2 + stale orphaned interaction) read in one shot.
    const rAll = await fetch(`http://127.0.0.1:${port}/api/inbox/read-all`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(rAll.status, 200);
    const allBody = await rAll.json();
    assert.equal(allBody.count, 2);

    const snapAfter = await (await fetch(`http://127.0.0.1:${port}/api/native/snapshot`)).json();
    assert.equal(snapAfter.inbox.filter((i: InboxItem) => !i.resolved && !i.read).length, 0);
  } finally {
    server.closeAllConnections();
    server.close();
    await service.dispose();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
