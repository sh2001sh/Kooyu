import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { descriptor, type AdapterContext, type HarnessAdapter } from "../src/harnesses/adapter.js";
import { LocalMcpPool } from "../src/applications/local-mcp.js";
import { SessionService } from "../src/session-service.js";
import { Store } from "../src/storage/store.js";
import { AppUpdater } from "../src/updater.js";
import { PreviewService } from "../src/workspaces/preview.js";

const cleanupDir = (dir: string) =>
  rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });

test("kodo supervisor with workspace receives background job tools and stop() cleans up running jobs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kooyu-p0-bg-"));
  const store = new Store(join(dir, "kodo.sqlite"));
  let capturedTools: AdapterContext["tools"];
  const fakeKodo: HarnessAdapter = {
    descriptor: descriptor("kodo", "Kooyu", "sdk", [], "test peer", "implemented"),
    connect: async (_session, ctx) => {
      capturedTools = ctx.tools;
      return {
        nativeSessionId: "kodo-bg-test",
        send: async () => ({ nativeRunId: null }),
        cancel: async () => {},
        close: async () => {},
      };
    },
  };
  const service = new SessionService(store, { dataDir: dir, adapters: [fakeKodo] });
  try {
    const project = service.createProject({ name: "BG Test", rootPath: dir });
    const workspace = store.workspaces().find((w) => w.projectId === project.id)!;
    const session = service.createDraft({
      harnessId: "kodo",
      kind: "supervisor",
      title: "Supervisor with CWD",
      projectId: project.id,
      workspaceId: workspace.id,
    });
    await service.openNative(session.id);
    const toolNames = (capturedTools ?? []).map((t) => t.name);
    for (const name of ["shell_exec", "job_status", "job_output", "job_kill"]) {
      assert.ok(
        toolNames.includes(name),
        `Expected supervisor with workspace to have tool ${name}`,
      );
    }

    // Start a long-running background job via BackgroundJobManager and verify stop() terminates it
    const started = await service.backgroundJobs.exec({
      sessionId: session.id,
      workspaceId: workspace.id,
      cwd: dir,
      command: `"${process.execPath}" -e "console.log('ready'); setTimeout(() => {}, 30000)"`,
      background: true,
      notifyOnExit: false,
    });
    assert.equal(started.status, "running");
    assert.equal(service.backgroundJobs.runningForSession(session.id).length, 1);
    const readyDeadline = Date.now() + 10_000;
    while (
      !service.backgroundJobs.output(started.jobId).output.includes("ready") &&
      Date.now() < readyDeadline
    ) {
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.match(service.backgroundJobs.output(started.jobId).output, /ready/);

    await service.stop(session.id, true);
    assert.equal(service.backgroundJobs.runningForSession(session.id).length, 0);
    const after = service.backgroundJobs.get(started.jobId);
    assert.equal(after.status, "killed");
  } finally {
    await service.dispose();
    store.close();
    cleanupDir(dir);
  }
});

test("supervision budgetUsd fails closed when usage has unknown cost (costUsd === null)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kooyu-p0-budget-"));
  const store = new Store(join(dir, "kodo.sqlite"));
  const service = new SessionService(store, { dataDir: dir, adapters: [] });
  try {
    const controller = service.createDraft({
      harnessId: "kodo",
      kind: "supervisor",
      title: "Ctrl",
    });
    const worker = service.createDraft({
      harnessId: "codex",
      kind: "direct",
      title: "Worker",
    });
    const watch = service.watch({
      controllerSessionId: controller.id,
      targetSessionId: worker.id,
      mode: "continue",
      limits: { budgetUsd: 5 },
    });
    store.put("usage", "u-unknown", {
      id: "u-unknown",
      sessionId: worker.id,
      projectId: null,
      bindingId: null,
      source: "codex",
      model: "custom-relay-model",
      input: 100,
      output: 50,
      cacheRead: 0,
      cacheWrite: 0,
      costUsd: null,
      createdAt: new Date().toISOString(),
    });
    const reason = (
      service as unknown as { checkSupervisionLimits: (w: typeof watch) => string | null }
    ).checkSupervisionLimits(watch);
    assert.equal(reason, "费用未知，无法核对托管预算");
  } finally {
    await service.dispose();
    store.close();
    cleanupDir(dir);
  }
});

test("pauseTargetInside cancels or prunes plural coalesced batch wakes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kooyu-p0-wakes-"));
  const store = new Store(join(dir, "kodo.sqlite"));
  const service = new SessionService(store, { dataDir: dir, adapters: [] });
  try {
    const controller = service.createDraft({
      harnessId: "kodo",
      kind: "supervisor",
      title: "Ctrl",
    });
    const workerA = service.createDraft({ harnessId: "codex", kind: "direct", title: "A" });
    const workerB = service.createDraft({ harnessId: "claude-code", kind: "direct", title: "B" });
    const watchA = service.watch({
      controllerSessionId: controller.id,
      targetSessionId: workerA.id,
      mode: "continue",
    });
    const watchB = service.watch({
      controllerSessionId: controller.id,
      targetSessionId: workerB.id,
      mode: "continue",
    });
    const wakeA = {
      id: "wake-a",
      watchId: watchA.id,
      targetId: workerA.id,
      generation: watchA.generation,
    };
    const wakeB = {
      id: "wake-b",
      watchId: watchB.id,
      targetId: workerB.id,
      generation: watchB.generation,
    };
    store.db
      .prepare("INSERT INTO wakes(id, watch_id, generation, state, data) VALUES (?,?,?,?,?)")
      .run(wakeA.id, watchA.id, watchA.generation, "dispatched", JSON.stringify(wakeA));
    store.db
      .prepare("INSERT INTO wakes(id, watch_id, generation, state, data) VALUES (?,?,?,?,?)")
      .run(wakeB.id, watchB.id, watchB.generation, "dispatched", JSON.stringify(wakeB));
    const batchCmdId = crypto.randomUUID();
    store.saveCommand({
      id: batchCmdId,
      sessionId: controller.id,
      kind: "send",
      origin: "wake",
      controllerId: null,
      generation: controller.ownerEpoch,
      bindingRevision: controller.bindingRevision,
      status: "accepted",
      nativeRunId: null,
      createdAt: new Date().toISOString(),
      body: {
        mode: "queue",
        wakes: [wakeA, wakeB],
        text: JSON.stringify({
          type: "harness-batch-report",
          reports: [{ workerSessionId: workerA.id }, { workerSessionId: workerB.id }],
        }),
      },
    });

    // Stopping workerA should cancel wakeA and prune it from the batch command while preserving workerB
    await service.stop(workerA.id, true);
    const wakeARow = store.db.prepare("SELECT state FROM wakes WHERE id=?").get(wakeA.id);
    const wakeBRow = store.db.prepare("SELECT state FROM wakes WHERE id=?").get(wakeB.id);
    assert.equal(wakeARow?.state, "cancelled");
    assert.equal(wakeBRow?.state, "dispatched");
    const cmdAfterA = store.command(batchCmdId)!;
    assert.equal(cmdAfterA.status, "accepted");
    assert.equal((cmdAfterA.body.wakes as Array<{ id: string }>).length, 1);
    assert.equal((cmdAfterA.body.wakes as Array<{ id: string }>)[0]!.id, wakeB.id);

    // Stopping workerB now leaves no wakes in the batch command, so the entire batch command is cancelled
    await service.stop(workerB.id, true);
    assert.equal(store.command(batchCmdId)?.status, "cancelled");
    assert.equal(
      store.db.prepare("SELECT state FROM wakes WHERE id=?").get(wakeB.id)?.state,
      "cancelled",
    );
  } finally {
    await service.dispose();
    store.close();
    cleanupDir(dir);
  }
});

test("ExecutionCapacity reserves 2 interactive slots by default and SCHEMA_V10 creates secure_requests", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kooyu-p0-cap-"));
  const store = new Store(join(dir, "kodo.sqlite"));
  const service = new SessionService(store, { dataDir: dir, adapters: [] });
  try {
    // secure_requests table must already exist via SCHEMA_V10 without runtime DDL
    const table = store.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='secure_requests'")
      .get();
    assert.equal(table?.name, "secure_requests");

    assert.equal(service.capacity.limit, 4);
    assert.equal(service.capacity.interactiveReserve, 2);
    assert.equal(service.capacity.totalLimit, 6);

    // Saturate all 4 background slots
    for (let i = 1; i <= 4; i++) {
      assert.equal(
        service.capacity.acquire(`bg-${i}`, "local", 0, () => {}),
        true,
      );
    }
    let bg5Woken = false;
    assert.equal(
      service.capacity.acquire("bg-5", "local", 0, () => {
        bg5Woken = true;
      }),
      false,
      "5th background worker must wait",
    );

    // 2 interactive human sessions (priority 10) still acquire immediately with 0 wait
    assert.equal(
      service.capacity.acquire("int-1", "local", 10, () => {}),
      true,
    );
    assert.equal(
      service.capacity.acquire("int-2", "local", 10, () => {}),
      true,
    );
    assert.equal(service.capacity.snapshot().active.length, 6);
    assert.equal(service.capacity.snapshot().interactiveActive.length, 2);
    assert.equal(service.capacity.snapshot().backgroundActive.length, 4);
    assert.equal(bg5Woken, false);

    // Release 1 background slot -> bg-5 gets woken
    service.capacity.release("bg-1");
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(bg5Woken, true);
    for (const id of ["bg-2", "bg-3", "bg-4", "bg-5", "int-1", "int-2"]) {
      service.capacity.release(id);
    }
  } finally {
    await service.dispose();
    store.close();
    cleanupDir(dir);
  }
});

test("LocalMcpPool evicts failed connect attempts immediately instead of poisoning cache", async () => {
  const pool = new LocalMcpPool();
  try {
    await assert.rejects(
      pool.use("broken", "__nonexistent_kooyu_mcp_binary__", [], async () => "ok"),
    );
    // Entry must have been evicted so a second attempt runs fresh instead of returning cached rejection
    const entries = (pool as unknown as { entries: Map<string, unknown> }).entries;
    assert.equal(entries.size, 0);
  } finally {
    await pool.dispose();
  }
});

test("PreviewService.openPort forwards POST/non-200 statuses while preserving sandbox CSP", async () => {
  const previews = new PreviewService();
  const upstream = createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/echo") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      res
        .writeHead(201, { "content-type": "application/json" })
        .end(JSON.stringify({ received: Buffer.concat(chunks).toString("utf8") }));
      return;
    }
    if (req.url === "/not-modified") {
      res.writeHead(304).end();
      return;
    }
    res.writeHead(200, { "content-type": "text/plain" }).end("ok");
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  try {
    const port = (upstream.address() as AddressInfo).port;
    const { url } = await previews.openPort(port, undefined);
    const parsed = new URL(url);
    const sendReq = (method: string, path: string, body?: string) =>
      new Promise<{
        status: number;
        headers: Record<string, string | string[] | undefined>;
        body: string;
      }>((resolve, reject) => {
        const req = httpRequest(
          {
            hostname: "127.0.0.1",
            port: Number(parsed.port),
            method,
            path,
            headers: {
              host: parsed.host,
              ...(body
                ? { "content-type": "text/plain", "content-length": Buffer.byteLength(body) }
                : {}),
            },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (c: Buffer) => chunks.push(c));
            res.on("end", () =>
              resolve({
                status: res.statusCode ?? 0,
                headers: res.headers,
                body: Buffer.concat(chunks).toString("utf8"),
              }),
            );
          },
        );
        req.on("error", reject);
        req.end(body);
      });

    const postRes = await sendReq("POST", "/echo", "hello-hmr");
    assert.equal(postRes.status, 201);
    assert.deepEqual(JSON.parse(postRes.body), { received: "hello-hmr" });
    assert.match(String(postRes.headers["content-security-policy"] ?? ""), /sandbox allow-scripts/);

    const res304 = await sendReq("GET", "/not-modified");
    assert.equal(res304.status, 304);
  } finally {
    previews.dispose();
    upstream.closeAllConnections();
    await new Promise<void>((r) => upstream.close(() => r()));
  }
});

test("AppUpdater skips prepareInstall on macOS and rolls back prepareInstall if win32 launcher throws", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kooyu-p0-updater-"));
  const store = new Store(":memory:");
  try {
    const updatesDir = join(dir, "updates");
    const dmgPath = join(updatesDir, "Kooyu-0.3.0.dmg");
    const exePath = join(updatesDir, "Kooyu-Setup-0.3.0.exe");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(updatesDir, { recursive: true });
    writeFileSync(dmgPath, "dmg");
    writeFileSync(exePath, "exe");

    let macPrepared = false;
    store.put("app-update", "state", {
      checkedAt: new Date().toISOString(),
      latest: null,
      downloadedPath: dmgPath,
      downloadedTag: "v0.3.0",
      downloadedAssetName: "Kooyu-0.3.0.dmg",
      sha256Verified: true,
    });
    const macUpdater = new AppUpdater(store, dir, {
      platform: "darwin",
      prepareInstall: async () => {
        macPrepared = true;
      },
      launcher: () => {},
    });
    await macUpdater.install();
    assert.equal(macPrepared, false, "macOS DMG open must not freeze Host dispatch");

    let winPrepared = false;
    let winRolledBack = false;
    store.put("app-update", "state", {
      checkedAt: new Date().toISOString(),
      latest: null,
      downloadedPath: exePath,
      downloadedTag: "v0.3.0",
      downloadedAssetName: "Kooyu-Setup-0.3.0.exe",
      sha256Verified: true,
    });
    const winUpdater = new AppUpdater(store, dir, {
      platform: "win32",
      prepareInstall: async () => {
        winPrepared = true;
      },
      rollbackInstall: () => {
        winRolledBack = true;
      },
      launcher: () => {
        throw new Error("spawn EACCES");
      },
    });
    await assert.rejects(winUpdater.install(), /spawn EACCES/);
    assert.equal(winPrepared, true);
    assert.equal(winRolledBack, true, "Failed win32 installer launch must resume Host dispatch");
  } finally {
    store.close();
    cleanupDir(dir);
  }
});
