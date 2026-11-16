// Real HTTPS worker process and native protocol fixture; no model or cloud account.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { createServer } from "node:https";
import { DatabaseSync } from "node:sqlite";
import { randomUUID, createHash } from "node:crypto";
import { Store } from "../packages/host/dist/storage/store.js";
import { SessionService } from "../packages/host/dist/session-service.js";
import { createHostHandler } from "../packages/host/dist/http/server.js";
const temp = mkdtempSync(join(tmpdir(), "kooyu-worker-acceptance-"));
let child,
  server,
  service,
  store,
  diagnostics = "";
const waitFor = async (check) => {
  const until = Date.now() + 30000;
  while (!check()) {
    if (Date.now() > until)
      throw new Error("Worker acceptance timed out: " + diagnostics.slice(-4000));
    await new Promise((r) => setTimeout(r, 100));
  }
};
const stop = async () => {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, "exit");
  if (process.platform === "win32")
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
  else child.kill("SIGTERM");
  await exited;
  child = null;
};
try {
  const openssl =
    process.env.OPENSSL_BINARY ??
    (process.platform === "win32" && existsSync("C:/Program Files/Git/usr/bin/openssl.exe")
      ? "C:/Program Files/Git/usr/bin/openssl.exe"
      : "openssl");
  const cert = join(temp, "cert.pem"),
    key = join(temp, "key.pem");
  const generated = spawnSync(
    openssl,
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      key,
      "-out",
      cert,
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1",
    ],
    { windowsHide: true },
  );
  if (generated.status !== 0)
    throw new Error("OpenSSL is required to generate this test's ephemeral TLS certificate");
  const hostData = join(temp, "host"),
    workerData = join(temp, "worker"),
    root = join(temp, "workspace"),
    wire = join(temp, "wire.jsonl");
  for (const d of [hostData, workerData, root]) mkdirSync(d);
  store = new Store(":memory:");
  service = new SessionService(store, { dataDir: hostData, adapters: [] });
  const executor = service.executors.enroll("HTTPS test worker"),
    workspace = service.executors.workspace(executor.id, null, root);
  server = createServer(
    { cert: readFileSync(cert), key: readFileSync(key) },
    createHostHandler(service, { port: 0, webRoot: "." }),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const token = join(temp, "token"),
    configFile = join(temp, "worker.json");
  writeFileSync(token, executor.token, { mode: 0o600 });
  writeFileSync(
    configFile,
    JSON.stringify({
      hostUrl: `https://127.0.0.1:${server.address().port}`,
      executorId: executor.id,
      tokenFile: token,
      dataDir: workerData,
      roots: [root],
      harnessIds: ["codex"],
    }),
  );
  writeFileSync(
    join(workerData, "installations.json"),
    JSON.stringify({
      codex: {
        command: process.execPath,
        args: [resolve("packages/host/test/fixtures/native-peer.mjs"), "codex"],
      },
    }),
  );
  const start = () => {
    child = spawn(process.execPath, ["scripts/worker.mjs", configFile], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NODE_EXTRA_CA_CERTS: cert, SYNTHETIC_WIRE_LOG: wire },
    });
    child.stdout.on("data", (d) => (diagnostics += d));
    child.stderr.on("data", (d) => (diagnostics += d));
  };
  start();
  await waitFor(
    () => service.executors.list().find((e) => e.id === executor.id)?.status === "online",
  );
  const session = service.createDraft({
    title: "TLS remote acceptance",
    kind: "direct",
    harnessId: "codex",
    workspaceId: workspace.id,
    executorId: executor.id,
    bindingId: null,
    model: "model-a",
  });
  await service.openNative(session.id);
  const bytes = Buffer.from("remote attachment content"),
    sha256 = createHash("sha256").update(bytes).digest("hex");
  const upload = service.files.createUpload({
    requestId: randomUUID(),
    displayName: "report.txt",
    size: bytes.length,
    sha256,
    sessionId: session.id,
  });
  service.files.appendChunk(upload.id, 0, bytes);
  const file = await service.files.completeUpload(upload.id);
  const command = service.acceptSend(session.id, {
    requestId: randomUUID(),
    text: "read the attached file",
    mode: "queue",
    attachmentIds: [file.id],
  });
  await waitFor(() => store.command(command.id)?.status === "confirmed");
  const task = store.records("worker-task").find((t) => t.operation === "send");
  await waitFor(() => store.record("worker-task", task.id)?.status === "confirmed");
  const count = () =>
    readFileSync(wire, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l))
      .filter((r) => r.method === "turn/start").length;
  assert.equal(count(), 1);
  store.put("worker-task", task.id, { ...task, status: "dispatched" });
  await waitFor(() => store.record("worker-task", task.id)?.status === "confirmed");
  assert.equal(count(), 1);
  await stop();
  const db = new DatabaseSync(join(workerData, "worker.sqlite"));
  try {
    const imported = db
      .prepare("SELECT data FROM managed_files")
      .all()
      .map((r) => JSON.parse(r.data));
    assert(imported.some((f) => f.sha256 === sha256));
    assert(db.prepare("SELECT data FROM records WHERE kind='worker-intent' AND id=?").get(task.id));
    db.prepare("DELETE FROM records WHERE kind='worker-result' AND id=?").run(task.id);
  } finally {
    db.close();
  }
  // Simulate a crash after native dispatch, before the result becomes durable.
  store.put("worker-task", task.id, { ...task, status: "dispatched" });
  start();
  await waitFor(() => store.record("worker-task", task.id)?.status === "unknown");
  assert.equal(count(), 1);
  await stop();
  const queued = new DatabaseSync(join(workerData, "worker.sqlite"));
  try {
    queued.prepare("DELETE FROM records WHERE kind='worker-result' AND id=?").run(task.id);
    const localCommand = JSON.parse(
      queued.prepare("SELECT data FROM commands WHERE id=?").get(command.id).data,
    );
    queued
      .prepare("UPDATE commands SET status='accepted',data=? WHERE id=?")
      .run(JSON.stringify({ ...localCommand, status: "accepted" }), command.id);
  } finally {
    queued.close();
  }
  store.put("worker-task", task.id, { ...task, status: "dispatched" });
  start();
  await waitFor(() => store.record("worker-task", task.id)?.status === "unknown");
  const firstHeartbeat = Date.parse(
    service.executors.list().find((e) => e.id === executor.id).lastSeenAt,
  );
  await waitFor(
    () =>
      Date.parse(service.executors.list().find((e) => e.id === executor.id).lastSeenAt) >
      firstHeartbeat + 900,
  );
  const fenced = new DatabaseSync(join(workerData, "worker.sqlite"), { readOnly: true });
  try {
    assert.equal(
      fenced.prepare("SELECT status FROM commands WHERE id=?").get(command.id).status,
      "unknown",
    );
  } finally {
    fenced.close();
  }
  assert.equal(count(), 1);
  console.log(
    JSON.stringify({
      httpsWorker: true,
      remoteNativeOpen: true,
      remoteSend: true,
      attachmentHashVerified: true,
      receiptReplayWithoutResend: true,
      restartWithoutReceiptIsUnknown: true,
      recoveredQueuedInputFenced: true,
      modelInference: false,
    }),
  );
} finally {
  await stop();
  if (server) {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
  if (service) await service.dispose();
  store?.close();
  rmSync(temp, { recursive: true, force: true });
}
