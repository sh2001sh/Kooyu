import assert from "node:assert/strict";
import { cp, mkdir, readFile, writeFile, appendFile, symlink, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { resolve, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
const buildRoot = resolve(process.env.KOOYU_UPGRADE_TEST_BUILD ?? ".");
const { hostBuildId } = await import(
  pathToFileURL(join(buildRoot, "packages/platform/dist/index.js"))
);
const root = resolve(".local/upgrade-handoff-" + Date.now());
const installed = join(root, "host");
const data = join(root, "data");
await mkdir(installed, { recursive: true });
await mkdir(data);
for (const name of ["host", "platform", "protocol"]) {
  await mkdir(join(installed, "packages", name), { recursive: true });
  for (const part of ["dist", "package.json"])
    await cp(join(buildRoot, "packages", name, part), join(installed, "packages", name, part), {
      recursive: true,
    });
}
for (const part of ["package.json", "package-lock.json"])
  await cp(join(buildRoot, part), join(installed, part));
await symlink(join(buildRoot, "node_modules"), join(installed, "node_modules"), "junction");
const writeManifest = async () => {
  const buildId = hostBuildId(installed);
  await writeFile(join(installed, "host-build.json"), JSON.stringify({ buildId }));
  return buildId;
};
const initial = await writeManifest();
const reservation = createServer();
reservation.listen(0, "127.0.0.1");
await once(reservation, "listening");
const port = reservation.address().port;
await new Promise((r) => reservation.close(r));
const url = "http://127.0.0.1:" + port;
const child = spawn(process.execPath, [join(installed, "packages/host/dist/main.js")], {
  env: {
    ...process.env,
    KODO_HOST_PORT: String(port),
    KODO_DATA_DIR: data,
    KODO_HOST_URL: undefined,
  },
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
child.stdout.on("data", (b) => (logs += b));
child.stderr.on("data", (b) => (logs += b));
let latestPid = child.pid;
const waitFor = async (work, timeout = 50000) => {
  const start = Date.now();
  for (;;) {
    try {
      const result = await work();
      if (result) return result;
    } catch {}
    if (Date.now() - start > timeout) throw new Error("Timed out: " + logs.slice(-1800));
    await new Promise((r) => setTimeout(r, 250));
  }
};
const call = async (path, body) => {
  const response = await fetch(url + path, {
    ...(body
      ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
    signal: AbortSignal.timeout(1500),
  });
  assert.ok(response.ok, `${path}: ${response.status}`);
  return response.json();
};
try {
  const health = await waitFor(async () => {
    const h = await call("/api/health");
    return h.buildId === initial && h;
  });
  const session = await call("/api/sessions", {
    title: "Preserved across same-version upgrade",
    harnessId: "codex",
    kind: "direct",
  });
  const db = new DatabaseSync(join(data, "kodo.sqlite"));
  function state(runState) {
    const row = db.prepare("SELECT data FROM session_state WHERE session_id=?").get(session.id);
    const s = { ...JSON.parse(row.data), runState };
    db.prepare("UPDATE session_state SET data=? WHERE session_id=?").run(
      JSON.stringify(s),
      session.id,
    );
  }
  state("running");
  await appendFile(
    join(installed, "packages/host/dist/main.js"),
    "\n// same-version installed build regression\n",
  );
  const expected = await writeManifest();
  assert.notEqual(initial, expected);
  await call("/internal/upgrade", { buildId: expected });
  const waiting = await waitFor(async () => {
    const s = await call("/internal/upgrade");
    return s.state === "pausing" && s;
  });
  assert.equal((await call("/api/work/status")).frozen, false);
  assert.equal((await call("/api/health")).buildId, initial);
  db.close();
  const updated = await waitFor(async () => {
    const h = await call("/api/health");
    return h.buildId === expected && h;
  });
  const work = await waitFor(async () => {
    const h = await call("/api/work/status");
    return !h.frozen && h;
  });
  latestPid = work.pid;
  assert.equal(work.sessions.length, 0, "Paused turns must not still appear running after restart");
  assert.notEqual(latestPid, child.pid);
  assert.equal(updated.hostId, health.hostId);
  const snapshot = await call("/api/snapshot");
  assert.equal(snapshot.sessions.find((s) => s.id === session.id).title, session.title);
  assert.ok((await readdir(join(data, "upgrade-backups"))).some((f) => f.endsWith(".sqlite")));
  const report = {
    root,
    passed: true,
    oldPid: child.pid,
    newPid: latestPid,
    waiting,
    expected,
    updated,
    work,
    sessions: snapshot.sessions.length,
  };
  await writeFile(join(root, "result.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  try {
    const discovery = JSON.parse(await readFile(join(data, "host.json"), "utf8"));
    latestPid = discovery.pid;
  } catch {}
  for (const pid of new Set([child.pid, latestPid]))
    try {
      process.kill(pid);
    } catch {}
  await writeFile(join(root, "test-host.log"), logs);
}
