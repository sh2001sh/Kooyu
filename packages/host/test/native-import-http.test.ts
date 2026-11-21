import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { descriptor, type HarnessAdapter } from "../src/harnesses/adapter.js";
import { createHostServer } from "../src/http/server.js";
import { SessionService } from "../src/session-service.js";
import { Store } from "../src/storage/store.js";

test("native import HTTP routes discover, selectively import, hydrate and skip duplicates", async () => {
  // Also exercise the exact installed distribution before restarting a detached Host.
  const dist = process.env.KOOYU_IMPORT_TEST_DIST;
  const implementation = dist
    ? {
        ...(await import(pathToFileURL(join(dist, "session-service.js")).href)),
        ...(await import(pathToFileURL(join(dist, "storage/store.js")).href)),
        ...(await import(pathToFileURL(join(dist, "http/server.js")).href)),
      }
    : { SessionService, Store, createHostServer };
  const directory = mkdtempSync(join(tmpdir(), "kooyu-import-http-"));
  const adapter: HarnessAdapter = {
    descriptor: descriptor(
      "codex",
      "Codex",
      "app-server",
      ["directChat", "historyRead"],
      "test",
      "implemented",
    ),
    async connect() {
      throw new Error("Import must not start a model turn");
    },
    async standaloneList() {
      return { data: ["chosen", "untouched"].map((id) => ({ id, title: id, cwd: directory })) };
    },
    async standaloneRead(session) {
      return {
        thread: {
          id: session.nativeSessionId,
          turns: [
            {
              items: [
                { type: "userMessage", content: [{ type: "text", text: "Existing user message" }] },
                { type: "agentMessage", text: "Existing answer" },
              ],
            },
          ],
        },
      };
    },
  };
  const store = new implementation.Store(":memory:");
  const service = new implementation.SessionService(store, {
    dataDir: directory,
    adapters: [adapter],
  });
  const options = { port: 0, webRoot: directory };
  const server = implementation.createHostServer(service, options);
  try {
    const project = service.createProject({ name: "Import HTTP regression" });
    service.addWorkspace(project.id, directory);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as { port: number }).port;
    options.port = port;
    const call = (path: string, body?: unknown) =>
      fetch(`http://127.0.0.1:${port}/api${path}`, {
        method: body ? "POST" : "GET",
        headers: body ? { "content-type": "application/json" } : {},
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const path = `/native-imports?projectId=${project.id}&harnessId=codex`;
    assert.equal((await call("/native-imports")).status, 400);
    const scan = await call(path);
    assert.equal(scan.status, 200);
    const discovery = await scan.json();
    assert.deepEqual(
      discovery.candidates.map((c: { nativeSessionId: string }) => c.nativeSessionId).sort(),
      ["chosen", "untouched"],
    );
    assert.equal(store.sessions().length, 0, "Scanning must not import conversations");
    const body = {
      projectId: project.id,
      items: [{ harnessId: "codex", nativeSessionId: "chosen", cwd: directory }],
    };
    const imported = await call("/native-imports", body);
    assert.equal(imported.status, 201);
    const result = await imported.json();
    assert.equal(result.errors.length, 0);
    assert.equal(result.imported.length, 1);
    assert.equal(result.imported[0].nativeSessionId, "chosen");
    assert.equal(service.events(result.imported[0].id).length, 2);
    const after = await (await call(path)).json();
    assert.equal(
      after.candidates.find((c: { nativeSessionId: string }) => c.nativeSessionId === "chosen")
        .alreadyImported,
      true,
    );
    assert.equal(
      after.candidates.find((c: { nativeSessionId: string }) => c.nativeSessionId === "untouched")
        .alreadyImported,
      false,
    );
    const duplicate = await (await call("/native-imports", body)).json();
    assert.equal(duplicate.imported.length, 0);
    assert.equal(duplicate.skipped.length, 1);
    assert.equal(store.sessions().length, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await service.dispose();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
