// Executed by the installed native Node before NSIS replaces locked runtime files.
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { DatabaseSync, backup } from "node:sqlite";
const roots = process.argv
  .slice(2)
  .map((arg) => arg.trim())
  .filter((arg) => arg && !/^[/\\]+resources$/i.test(arg))
  .map((arg) => resolve(arg));
if (!roots.length) process.exit(0);
const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
const dataCandidates = (() => {
  const explicit = process.env.KOOYU_DATA_DIR || process.env.KODO_DATA_DIR;
  if (explicit) return [resolve(explicit)];
  return [join(localAppData, "Kooyu", "host"), join(localAppData, "Kodo", "host")];
})();
const data =
  dataCandidates.find((dir) => existsSync(join(dir, "host.lock"))) ??
  dataCandidates.find((dir) => existsSync(join(dir, "kodo.sqlite"))) ??
  dataCandidates[0];
let frozen;
let url;
const call = async (path, body) => {
  const response = await fetch(url + path, {
    method: body ? "POST" : "GET",
    ...(body
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : {}),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Host management returned HTTP ${response.status}`);
  return response.json();
};
try {
  if (!existsSync(join(data, "host.lock"))) process.exit(0);
  const pid = Number(readFileSync(join(data, "host.lock"), "utf8"));
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error("Invalid Host owner");
  let alive = true;
  try {
    process.kill(pid, 0);
  } catch {
    alive = false;
  }
  if (!alive) process.exit(0);
  const discovery = JSON.parse(readFileSync(join(data, "host.json"), "utf8"));
  const address = new URL(discovery.url);
  if (
    discovery.pid !== pid ||
    !["127.0.0.1", "localhost"].includes(address.hostname) ||
    address.username ||
    address.password ||
    address.pathname !== "/"
  )
    throw new Error("Unrecognized Host identity");
  url = address.origin;
  const rawOwner = execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' | Select-Object ExecutablePath,CommandLine | ConvertTo-Json -Compress`,
    ],
    { windowsHide: true, encoding: "utf8" },
  ).trim();
  if (!rawOwner) {
    try {
      process.kill(pid, 0);
    } catch {
      process.exit(0);
    }
    throw new Error("Could not inspect running Host process");
  }
  const owner = JSON.parse(rawOwner);
  const matched = roots.some((resources) => {
    const entry = resolve(resources, "host/packages/host/dist/main.js");
    return (
      owner.ExecutablePath &&
      resolve(owner.ExecutablePath).toLowerCase() ===
        resolve(resources, "runtime/node.exe").toLowerCase() &&
      String(owner.CommandLine ?? "")
        .toLowerCase()
        .includes(entry.toLowerCase())
    );
  });
  if (!matched) throw new Error("Host belongs to another installation; no process was stopped");
  const health = await call("/api/work/status");
  if (health.pid !== pid || health.hostId !== discovery.hostId)
    throw new Error("Host identity changed");
  frozen = await call("/internal/quiesce", {});
  const snapshot = await call("/api/snapshot");
  await Promise.allSettled(
    snapshot.sessions
      .filter((s) => s.phase === "native" || s.runState !== "idle")
      .map((s) => call(`/api/sessions/${s.id}/stop`, { pause: true, requestId: randomUUID() })),
  );
  const db = new DatabaseSync(join(data, "kodo.sqlite"));
  try {
    const ticket = randomUUID();
    mkdirSync(join(data, "upgrade-backups"), { recursive: true });
    await backup(db, join(data, "upgrade-backups", `${Date.now()}-${ticket}.sqlite`));
    db.prepare("INSERT OR REPLACE INTO records(kind,id,data) VALUES ('lifecycle','upgrade',?)").run(
      JSON.stringify({ ticket, installer: true, generation: frozen.generation }),
    );
    db.prepare(
      "INSERT OR REPLACE INTO records(kind,id,data) VALUES ('lifecycle','update-paused',?)",
    ).run(
      JSON.stringify({
        generation: frozen.generation,
        sessionIds: snapshot.sessions.map((s) => s.id),
      }),
    );
  } finally {
    db.close();
  }
  process.kill(pid);
  frozen = undefined;
  for (let attempt = 0; attempt < 60; attempt++) {
    let running = true;
    try {
      process.kill(pid, 0);
    } catch {
      running = false;
    }
    if (!running) process.exit(0);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Host has not exited; installation postponed");
} catch (error) {
  if (frozen)
    await call("/internal/resume", {
      processIdentity: frozen.processIdentity,
      generation: frozen.generation,
    }).catch(() => {});
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
