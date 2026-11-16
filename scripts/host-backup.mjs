import {
  createReadStream,
  createWriteStream,
  existsSync,
  readFileSync,
  statSync,
  openSync,
  writeFileSync,
  closeSync,
  unlinkSync,
} from "node:fs";
import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  writeFile,
  rm,
  copyFile,
  rename,
  lstat,
  open,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, relative, isAbsolute, dirname } from "node:path";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  hkdfSync,
} from "node:crypto";
import { pipeline } from "node:stream/promises";
import { DatabaseSync, backup } from "node:sqlite";
import * as tar from "tar";
import { fileURLToPath } from "node:url";
const HEADER = Buffer.from("KOOYUBK1"),
  SCHEMA = 9,
  PROTOCOL = 2;
const fileHash = async (path) => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
};
const contained = (root, p) => {
  const r = relative(root, p);
  return r === "" || (!r.startsWith("..") && !isAbsolute(r));
};
async function key(path) {
  const s = await lstat(path);
  if (!s.isFile() || s.isSymbolicLink() || (process.platform !== "win32" && (s.mode & 0o077) !== 0))
    throw new Error("Backup key requires a private regular file (0600)");
  const bytes = await readFile(path);
  if (bytes.length < 32) throw new Error("Backup key must contain at least 32 random bytes");
  return bytes;
}
function acquire(dataDir) {
  const lock = join(dataDir, "host.lock");
  if (existsSync(lock)) {
    const pid = Number(readFileSync(lock, "utf8"));
    try {
      process.kill(pid, 0);
      throw new Error("Stop the Host cleanly after quiesce before backing up");
    } catch (e) {
      if (e.code !== "ESRCH") throw e;
    }
    unlinkSync(lock);
  }
  const fd = openSync(lock, "wx", 0o600);
  writeFileSync(fd, String(process.pid));
  closeSync(fd);
  return () => {
    if (existsSync(lock) && readFileSync(lock, "utf8") === String(process.pid)) unlinkSync(lock);
  };
}
async function files(root, at = root) {
  const result = [];
  for (const entry of await readdir(at, { withFileTypes: true })) {
    const p = join(at, entry.name);
    if (entry.isSymbolicLink())
      throw new Error("Backup refuses symbolic links: " + relative(root, p));
    if (entry.isDirectory()) result.push(...(await files(root, p)));
    else if (entry.isFile())
      result.push(relative(root, p).split(String.fromCharCode(92)).join("/"));
  }
  return result;
}
function safePath(path) {
  const p = path.replaceAll(String.fromCharCode(92), "/");
  return (
    p.length > 0 &&
    !isAbsolute(path) &&
    !p.startsWith("/") &&
    !p.includes(":") &&
    !p.split("/").some((x) => x === "..")
  );
}
export async function backupHost({
  dataDir,
  output,
  keyFile,
  includeNative = false,
  nativeWritersStopped = false,
}) {
  dataDir = resolve(dataDir);
  output = resolve(output);
  if (!existsSync(join(dataDir, "kodo.sqlite"))) throw new Error("Host database not found");
  if (contained(dataDir, output))
    throw new Error("Backup output must be outside the Host data directory");
  if (includeNative && !nativeWritersStopped)
    throw new Error("Confirm native writers are stopped with --native-writers-stopped");
  const secret = await key(keyFile),
    release = acquire(dataDir),
    temp = await mkdtemp(join(tmpdir(), "kooyu-backup-"));
  let target,
    created = false;
  try {
    await mkdir(join(temp, "data"), { mode: 0o700 });
    const manifest = {
      format: 1,
      productVersion: JSON.parse(
        await readFile(new URL("../package.json", import.meta.url), "utf8"),
      ).version,
      schema: SCHEMA,
      protocol: PROTOCOL,
      createdAt: new Date().toISOString(),
      sourceDataDir: dataDir,
      files: {},
      nativeHistory: includeNative
        ? "Kooyu/pi SDK session JSONL and validated mapping files only"
        : "excluded",
      credentialStrategy:
        "Credentials, vaults, master keys, browser profiles and device tokens are excluded; reauthorize after restore",
      exclusions: [
        "user workspaces",
        "external native histories",
        "native CLI homes and instances",
        "browser profiles",
        "vaults and master keys",
        "Relay identities",
        "worker tokens",
      ],
    };
    const db = new DatabaseSync(join(dataDir, "kodo.sqlite"), { readOnly: true });
    try {
      if (db.prepare("PRAGMA quick_check").get().quick_check !== "ok")
        throw new Error("Database integrity check failed");
      if (Number(db.prepare("PRAGMA user_version").get().user_version) !== SCHEMA)
        throw new Error("Back up using the matching product/schema version");
      await backup(db, join(temp, "data", "kodo.sqlite"));
    } finally {
      db.close();
    }
    const snapshot = new DatabaseSync(join(temp, "data", "kodo.sqlite"));
    snapshot
      .prepare(
        "DELETE FROM records WHERE kind IN ('device-secret','device-public','relay-identity','oauth-state')",
      )
      .run();
    snapshot.close();
    const candidates = [];
    if (existsSync(join(dataDir, "files")))
      for (const f of await files(join(dataDir, "files"))) candidates.push(join("files", f));
    if (includeNative)
      for (const kernel of ["kodo", "pi"]) {
        const root = join(dataDir, kernel, "sessions");
        if (!existsSync(root)) continue;
        for (const f of await files(root)) {
          if (f.endsWith(".jsonl")) candidates.push(join(kernel, "sessions", f));
          else if (f.endsWith(".json")) {
            try {
              const m = JSON.parse(await readFile(join(root, f), "utf8"));
              if (
                Object.keys(m).length === 1 &&
                typeof m.path === "string" &&
                m.path.endsWith(".jsonl") &&
                contained(root, resolve(m.path)) &&
                existsSync(m.path)
              )
                candidates.push(join(kernel, "sessions", f));
            } catch {
              /* Unrecognized native config is deliberately excluded. */
            }
          }
        }
      }
    for (const f of candidates) {
      const destination = join(temp, "data", f);
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      await copyFile(join(dataDir, f), destination);
    }
    for (const f of await files(join(temp, "data")))
      manifest.files[f] = await fileHash(join(temp, "data", f));
    await writeFile(join(temp, "manifest.json"), JSON.stringify(manifest, null, 2), {
      mode: 0o600,
    });
    const archive = join(temp, "payload.tar.gz");
    await tar.c({ cwd: temp, file: archive, gzip: true, portable: true }, [
      "manifest.json",
      "data",
    ]);
    const salt = randomBytes(32),
      iv = randomBytes(12),
      cipher = createCipheriv(
        "aes-256-gcm",
        Buffer.from(hkdfSync("sha256", secret, salt, "kooyu-backup-v1", 32)),
        iv,
      );
    cipher.setAAD(HEADER);
    target = await open(output, "wx", 0o600);
    created = true;
    await target.write(Buffer.concat([HEADER, salt, iv]));
    await target.close();
    target = null;
    await pipeline(
      createReadStream(archive),
      cipher,
      createWriteStream(output, { flags: "r+", start: 52, mode: 0o600 }),
    );
    await writeFile(output, cipher.getAuthTag(), { flag: "a", mode: 0o600 });
    return { output, manifest };
  } catch (e) {
    if (target) await target.close().catch(() => {});
    if (created) await rm(output, { force: true });
    throw e;
  } finally {
    release();
    await rm(temp, { recursive: true, force: true });
  }
}
export async function restoreHost({ input, destination, keyFile }) {
  input = resolve(input);
  destination = resolve(destination);
  if (existsSync(destination)) throw new Error("Restore destination must not exist");
  const secret = await key(keyFile);
  await mkdir(dirname(destination), { recursive: true });
  const temp = await mkdtemp(join(dirname(destination), ".kooyu-restore-"));
  await mkdir(join(temp, "extract"), { mode: 0o700 });
  try {
    const size = statSync(input).size;
    if (size < 68) throw new Error("Backup is truncated");
    const handle = await open(input, "r"),
      header = Buffer.alloc(52),
      tag = Buffer.alloc(16);
    try {
      await handle.read(header, 0, 52, 0);
      await handle.read(tag, 0, 16, size - 16);
    } finally {
      await handle.close();
    }
    if (!header.subarray(0, 8).equals(HEADER)) throw new Error("Unknown backup format");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(hkdfSync("sha256", secret, header.subarray(8, 40), "kooyu-backup-v1", 32)),
      header.subarray(40, 52),
    );
    decipher.setAAD(HEADER);
    decipher.setAuthTag(tag);
    const archive = join(temp, "payload.tar.gz");
    await pipeline(
      createReadStream(input, { start: 52, end: size - 17 }),
      decipher,
      createWriteStream(archive, { flags: "wx", mode: 0o600 }),
    );
    let total = 0,
      invalid = false;
    const paths = new Set();
    await tar.t({
      file: archive,
      strict: true,
      onReadEntry: (entry) => {
        const p = entry.path.replace(/\/$/, "");
        if (
          !safePath(p) ||
          !["File", "Directory"].includes(entry.type) ||
          paths.has(p) ||
          (p !== "manifest.json" && p !== "data" && !p.startsWith("data/"))
        )
          invalid = true;
        paths.add(p);
        total += entry.size;
        if (
          total > 32 * 1024 ** 3 ||
          (entry.path === "manifest.json" && entry.size > 16 * 1024 * 1024)
        )
          invalid = true;
      },
    });
    if (invalid) throw new Error("Unsafe backup archive entry or size");
    await tar.x({ file: archive, cwd: join(temp, "extract"), strict: true, preservePaths: false });
    const manifest = JSON.parse(await readFile(join(temp, "extract", "manifest.json"), "utf8"));
    if (
      manifest.format !== 1 ||
      manifest.schema !== SCHEMA ||
      manifest.protocol !== PROTOCOL ||
      !manifest.files ||
      Array.isArray(manifest.files) ||
      typeof manifest.files !== "object" ||
      typeof manifest.sourceDataDir !== "string"
    )
      throw new Error("Incompatible backup versions");
    const root = join(temp, "extract", "data"),
      actual = await files(root);
    if (actual.length !== Object.keys(manifest.files).length || !actual.includes("kodo.sqlite"))
      throw new Error("Manifest does not cover all restored files");
    for (const f of actual)
      if (!safePath(f) || (await fileHash(join(root, f))) !== manifest.files[f])
        throw new Error("Backup hash mismatch: " + f);
    await chmod(root, 0o700);
    for (const f of actual) await chmod(join(root, f), 0o600);
    const db = new DatabaseSync(join(root, "kodo.sqlite"));
    try {
      if (
        Number(db.prepare("PRAGMA user_version").get().user_version) !== SCHEMA ||
        db.prepare("PRAGMA quick_check").get().quick_check !== "ok"
      )
        throw new Error("Restored database failed validation");
      const oldHost = db.prepare("SELECT value FROM metadata WHERE key='host_id'").get().value,
        newHost = randomUUID(),
        now = new Date().toISOString();
      db.exec("BEGIN IMMEDIATE");
      db.prepare("UPDATE metadata SET value=? WHERE key='host_id'").run(newHost);
      db.prepare("UPDATE workspaces SET host_id=? WHERE host_id=?").run(newHost, oldHost);
      db.prepare("UPDATE sessions SET host_id=? WHERE host_id=?").run(newHost, oldHost);
      for (const row of db.prepare("SELECT session_id,data FROM session_state").all()) {
        const s = JSON.parse(row.data);
        if (s.hostId === oldHost) s.hostId = newHost;
        s.connectionState = "offline";
        s.runState = s.runState === "idle" ? "idle" : "unknown";
        s.executionState = "unknown";
        s.ownerEpoch = (s.ownerEpoch ?? 0) + 1;
        if (
          !["kodo", "pi"].includes(s.harnessId) ||
          !actual.some((f) => f === s.harnessId + "/sessions/" + s.id + ".json")
        )
          s.bindingUnavailable = true;
        db.prepare("UPDATE session_state SET data=? WHERE session_id=?").run(
          JSON.stringify(s),
          row.session_id,
        );
      }
      db.exec(
        "DELETE FROM records WHERE kind IN ('device-secret','device-public','relay-identity','oauth-state','oauth-config','executor','worker-task','notification-ack','remote-open','native-inspection-home','native-inspection-environment','browser-environment','browser-generation');",
      );
      db.prepare(
        "INSERT INTO records(kind,id,data) VALUES ('lifecycle','gate',?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data",
      ).run(JSON.stringify({ generation: 1, frozen: true }));
      db.exec(
        "UPDATE commands SET status='cancelled',data=json_set(data,'$.status','cancelled','$.error','Restored instance: execution frozen') WHERE status='accepted'; UPDATE commands SET status='unknown',data=json_set(data,'$.status','unknown') WHERE status='dispatched'; UPDATE watches SET state='paused',data=json_set(data,'$.state','paused','$.generation',COALESCE(json_extract(data,'$.generation'),0)+1); UPDATE wakes SET state='cancelled',data=json_set(data,'$.state','cancelled') WHERE state IN ('pending','dispatched');",
      );
      for (const table of [
        "automations",
        "app_connections",
        "webhook_connections",
        "notification_channels",
      ])
        db.exec(
          "UPDATE " +
            table +
            " SET data=json_set(data,'$.enabled',json('false'),'$.mode','off','$.credentialRef',NULL,'$.secretRef',NULL,'$.generation',COALESCE(json_extract(data,'$.generation'),0)+1)",
        );
      db.exec(
        "UPDATE authorization_grants SET data=json_set(data,'$.revoked',json('true'),'$.revision',json_extract(data,'$.revision')+1); UPDATE notification_deliveries SET data=json_set(data,'$.status','cancelled'); UPDATE outbound_messages SET data=json_set(data,'$.status','withdrawn') WHERE json_extract(data,'$.status')='pending'; UPDATE tool_action_receipts SET data=json_set(data,'$.status','unknown') WHERE json_extract(data,'$.status')='dispatched';",
      );
      for (const row of db.prepare("SELECT sequence,data FROM notification_items").all()) {
        const item = JSON.parse(row.data);
        item.link = { ...item.link, hostId: newHost };
        db.prepare("UPDATE notification_items SET data=? WHERE sequence=?").run(
          JSON.stringify(item),
          row.sequence,
        );
      }
      db.prepare(
        "INSERT INTO records(kind,id,data) VALUES ('restore','manifest',?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data",
      ).run(
        JSON.stringify({
          at: now,
          autoExecutionFrozen: true,
          credentials: "reauthorization-required",
        }),
      );
      db.exec("COMMIT");
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } finally {
      db.close();
    }
    for (const f of actual.filter((f) => /^(kodo|pi)\/sessions\/.*\.json$/.test(f))) {
      const p = join(root, f),
        m = JSON.parse(await readFile(p, "utf8"));
      if (typeof m.path !== "string" || !contained(manifest.sourceDataDir, resolve(m.path)))
        throw new Error("Native mapping points outside backup");
      const r = relative(manifest.sourceDataDir, m.path).split(String.fromCharCode(92)).join("/");
      if (!actual.includes(r)) throw new Error("Native history missing from backup");
      await writeFile(p, JSON.stringify({ path: join(destination, r) }), { mode: 0o600 });
    }
    await writeFile(join(root, "restore-manifest.json"), JSON.stringify(manifest, null, 2), {
      mode: 0o600,
    });
    if (existsSync(destination)) throw new Error("Restore destination already exists");
    await rename(root, destination);
    return { destination, frozen: true, credentials: "reauthorization-required" };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2),
    mode = args.shift(),
    opts = Object.fromEntries(
      args
        .filter((x) => x.startsWith("--"))
        .map((x) => [x.slice(2), args[args.indexOf(x) + 1] ?? true]),
    );
  const required = (keys) => {
    for (const k of keys)
      if (!opts[k] || String(opts[k]).startsWith("--")) throw new Error("Missing --" + k);
  };
  if (mode === "backup") {
    required(["data-dir", "output", "key-file"]);
    console.log(
      JSON.stringify(
        await backupHost({
          dataDir: opts["data-dir"],
          output: opts.output,
          keyFile: opts["key-file"],
          includeNative: args.includes("--include-native"),
          nativeWritersStopped: args.includes("--native-writers-stopped"),
        }),
      ),
    );
  } else if (mode === "restore") {
    required(["input", "destination", "key-file"]);
    console.log(
      JSON.stringify(
        await restoreHost({
          input: opts.input,
          destination: opts.destination,
          keyFile: opts["key-file"],
        }),
      ),
    );
  } else
    throw new Error(
      "Usage: host-backup.mjs backup --data-dir PATH --output FILE --key-file KEY | restore --input FILE --destination NEW_PATH --key-file KEY",
    );
}
