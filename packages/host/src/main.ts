import { directGateway } from "./account/direct.js";
import { join, resolve } from "node:path";
import { hostDataDirectory, hostBuildId, installedHostBuild } from "@kodo/platform";
import { spawn } from "node:child_process";
import { PROTOCOL_VERSION } from "@kodo/protocol";
import { fileURLToPath } from "node:url";
import { createServer as createHttpsServer } from "node:https";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
  openSync,
  closeSync,
} from "node:fs";
import { Store } from "./storage/store.js";
import { SessionService } from "./session-service.js";
import { createHostHandler, createHostServer } from "./http/server.js";
import { Pairing } from "./devices/pairing.js";
import { DeviceMailbox } from "./devices/mailbox.js";
import { RelayConnector, DEFAULT_RELAY_ORIGIN } from "./devices/relay.js";
import { distribution } from "./distribution.js";
import { configureVault } from "./credentials/vault.js";
import { HostUpgrade } from "./lifecycle/upgrade.js";
const installationRoot = fileURLToPath(new URL("../../../", import.meta.url));
const loadedBuildId = hostBuildId(installationRoot);
let fatalCleanup = () => {};
let fatal = false;
const onFatal = (error: unknown) => {
  if (fatal) return;
  fatal = true;
  const message = (error instanceof Error ? error.message : String(error)).replace(
    /(?:sk-|Bearer\s+)[A-Za-z0-9_\-.]{8,}/g,
    "[redacted]",
  );
  console.error(`Host fatal error; exiting for recovery: ${message}`);
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 3000).unref();
  try {
    fatalCleanup();
  } catch {
    process.exit(1);
  }
};
process.on("uncaughtException", onFatal);
process.on("unhandledRejection", onFatal);
const dataDir = hostDataDirectory();
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const port = Number(process.env.KOOYU_HOST_PORT ?? process.env.KODO_HOST_PORT ?? 4310),
  bind = process.env.KOOYU_BIND ?? process.env.KODO_BIND ?? "127.0.0.1";
const rawAdminPort = process.env.KOOYU_ADMIN_PORT ?? process.env.KODO_ADMIN_PORT;
const adminPort = rawAdminPort ? Number(rawAdminPort) : null;
if (
  adminPort !== null &&
  (!Number.isInteger(adminPort) || adminPort < 1 || adminPort > 65535 || adminPort === port)
)
  throw new Error("Invalid KOOYU_ADMIN_PORT (must differ from the public port).");
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid KOOYU_HOST_PORT.");
const tlsCert = process.env.KOOYU_TLS_CERT ?? process.env.KODO_TLS_CERT;
const tlsKey = process.env.KOOYU_TLS_KEY ?? process.env.KODO_TLS_KEY;
const tls = Boolean(tlsCert && tlsKey);
if (bind !== "127.0.0.1" && bind !== "::1" && !tls)
  throw new Error("Non-loopback binding requires KOOYU_TLS_CERT and KOOYU_TLS_KEY.");
const lock = join(dataDir, "host.lock");
if (existsSync(lock)) {
  const pid = Number(readFileSync(lock, "utf8"));
  let alive = false;
  try {
    process.kill(pid, 0);
    alive = true;
  } catch {}
  if (alive) throw new Error("A Host already owns this data directory.");
  unlinkSync(lock);
}
const fd = openSync(lock, "wx");
writeFileSync(fd, String(process.pid));
closeSync(fd);
const cleanup = () => {
  try {
    if (readFileSync(lock, "utf8") === String(process.pid)) unlinkSync(lock);
  } catch {}
};
process.once("exit", cleanup);
const vault = configureVault(dataDir);
if (!vault.status().available)
  console.warn(
    `Credential vault unavailable: ${vault.status().reason} Secret-backed features stay disabled.`,
  );
const store = new Store(join(dataDir, "kodo.sqlite"));
store.recover();
const service = new SessionService(store, {
  dataDir,
  onFatal,
});
const resumeTicket = process.env.KOOYU_UPGRADE_TICKET;
delete process.env.KOOYU_UPGRADE_TICKET;
const savedUpgrade = store.record<{ ticket: string; buildId: string; generation: number }>(
  "lifecycle",
  "upgrade",
);
const pausedUpdate = store.record<{ generation: number; sessionIds: string[] }>(
  "lifecycle",
  "update-paused",
);
if (pausedUpdate && service.lifecycle.status().generation === pausedUpdate.generation + 1) {
  for (const session of store.sessions().filter((s) => pausedUpdate.sessionIds.includes(s.id)))
    store.saveSession({ ...session, runState: "idle", connectionState: "offline" });
  store.remove("lifecycle", "update-paused");
  // Reopen dispatch after an installer-triggered restart; paused turns are never replayed.
  const gate = service.lifecycle.status();
  if (!resumeTicket) service.lifecycle.resume(gate.processIdentity, gate.generation);
}
if (
  resumeTicket &&
  savedUpgrade?.ticket === resumeTicket &&
  savedUpgrade.buildId === loadedBuildId
) {
  const gate = service.lifecycle.status();
  if (gate.generation === savedUpgrade.generation + 1) {
    service.lifecycle.resume(gate.processIdentity, gate.generation);
    store.remove("lifecycle", "upgrade");
  }
}
const upgrade = new HostUpgrade(
  service,
  loadedBuildId,
  () => installedHostBuild(installationRoot),
  async (ticket) => {
    const log = openSync(join(dataDir, "host-process.log"), "a");
    // The independent helper waits for this process and its data lock to close.
    const helper = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
    import { spawn } from 'node:child_process';
    const parent = Number(process.argv[1]);
    for (let attempt = 0; ; attempt++) {
      let alive = true; try { process.kill(parent, 0); } catch { alive = false; }
      if (!alive) break;
      if (attempt >= 600) throw new Error('Old Host did not release the data directory');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const child = spawn(process.execPath, [process.argv[2]], { detached: true, windowsHide: true,
      stdio: ['ignore', 1, 2], env: process.env });
    child.on('error', error => { console.error(error.message); process.exitCode = 1; });
    child.unref();
  `,
        String(process.pid),
        resolve(fileURLToPath(import.meta.url)),
      ],
      {
        detached: true,
        windowsHide: true,
        stdio: ["ignore", log, log],
        env: { ...process.env, KOOYU_UPGRADE_TICKET: ticket },
      },
    );
    closeSync(log);
    await new Promise<void>((done, reject) => {
      helper.once("spawn", done);
      helper.once("error", reject);
    });
    helper.unref();
    await shutdown();
  },
);
const relay = new RelayConnector(
  dataDir,
  process.env.KOOYU_RELAY_ORIGIN ?? process.env.KODO_RELAY_ORIGIN ?? DEFAULT_RELAY_ORIGIN,
);
const accountOrigin = process.env.KOOYU_ACCOUNT_ORIGIN ?? distribution.accountOrigin;
relay.requireAccount();
if (accountOrigin) relay.configureAccount(accountOrigin, store.hostId);
const mailbox = new DeviceMailbox(service);
const pairing = new Pairing(store);
let syncingRevocations = false;
const revocationTimer = setInterval(async () => {
  if (syncingRevocations || !relay.account) return;
  syncingRevocations = true;
  try {
    const pending = await relay.account.hostRequest("pairing/sync");
    const ack: string[] = [];
    for (const command of pending.items) {
      pairing.revoke(command.paired_client_id);
      store.remove("web-push-device", command.paired_client_id);
      await service.delivery.revokeDevice(command.paired_client_id);
      ack.push(command.id);
    }
    if (ack.length) {
      relay.syncMailboxDevices();
      await relay.account.hostRequest("pairing/sync", { ack });
    }
  } catch {
    /* The durable queue is retried when account service and Host reconnect. */
  } finally {
    syncingRevocations = false;
  }
}, 20000).unref();
relay.setMailboxDelivery((host, envelope) => mailbox.deliver(host, envelope));
relay.setMailboxDevices(() => store.records("device-public"));
service.notifications.on("notification", () => {
  for (const { deviceId } of store.records<{ deviceId: string }>("web-push-device"))
    relay.pushDevice(deviceId, undefined, true);
});
const options = {
  port,
  webRoot: fileURLToPath(new URL("../../../apps/web/dist/", import.meta.url)),
  publicOrigin: process.env.KOOYU_PUBLIC_ORIGIN ?? process.env.KODO_PUBLIC_ORIGIN,
  accountRemote: true,
  pairing,
  mailbox,
  relay,
  buildId: loadedBuildId,
  upgrade,
};
// Optional plaintext administration is reachable only inside the Host's loopback namespace.
const adminServer =
  adminPort === null ? null : createHostServer(service, { ...options, port: adminPort });
adminServer?.once("error", onFatal);
adminServer?.listen(adminPort!, "127.0.0.1");
// This ephemeral loopback listener never grants local privileges. Relay traffic
// cannot be forwarded into the trusted desktop listener even with spoofed headers.
const remoteServer = createHostServer(service, {
  ...options,
  publicOrigin: relay.origin,
  forceRemote: true,
});
remoteServer.once("error", onFatal);
remoteServer.listen(0, "127.0.0.1", () => {
  relay.start((remoteServer.address() as { port: number }).port);
});
const localHandler = createHostHandler(service, options);
const direct =
  tls && options.publicOrigin && relay.account
    ? directGateway(
        relay.account,
        new URL(options.publicOrigin).origin,
        relay.origin,
        () => (remoteServer.address() as { port: number } | null)?.port ?? 0,
      )
    : undefined;
const server = tls
  ? createHttpsServer(
      {
        cert: readFileSync(tlsCert!),
        key: readFileSync(tlsKey!),
      },
      (req, res) => {
        if (direct && (req.url === "/v1/nonce" || req.url?.startsWith("/h/")))
          void direct(req, res);
        else void localHandler(req, res);
      },
    )
  : createHostServer(service, options);
fatalCleanup = () => {
  adminServer?.closeAllConnections();
  adminServer?.close();
  relay.stop();
  remoteServer.closeAllConnections();
  remoteServer.close();
  service.failClosed(new Error("Host process exception"));
  server.closeAllConnections();
  server.close();
  void service.dispose().finally(() => {
    store.close();
    cleanup();
    process.exit(1);
  });
};
server.once("error", (error) => {
  onFatal(error);
});
server.listen(port, bind, () => {
  writeFileSync(
    join(dataDir, "host.json"),
    JSON.stringify({
      pid: process.pid,
      hostId: store.hostId,
      discoveryVersion: 1,
      protocolVersion: PROTOCOL_VERSION,
      url: `${tls ? "https" : "http"}://127.0.0.1:${port}`,
      ...(adminPort ? { adminUrl: `http://127.0.0.1:${adminPort}` } : {}),
    }),
  );
  console.log(`Kooyu Host: ${tls ? "https" : "http"}://127.0.0.1:${port}`);
  service.resumeWork();
  void service
    .syncNativeSessions()
    .catch((error) => console.error("Native history sync failed:", error.message));
  void service
    .maintenance()
    .catch((error) => console.error("Host maintenance failed:", error.message));
});
let closing = false;
const upgradeTimer = setInterval(() => {
  void upgrade.tick().catch((error) => console.error("Host upgrade postponed:", error.message));
}, 15000);
upgradeTimer.unref();
async function shutdown() {
  clearInterval(revocationTimer);
  if (closing) return;
  closing = true;
  clearInterval(upgradeTimer);
  adminServer?.closeAllConnections();
  adminServer?.close();
  relay.stop();
  remoteServer.closeAllConnections();
  remoteServer.close();
  await service.dispose();
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
  store.close();
  cleanup();
  process.exit(0);
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void shutdown().catch(onFatal);
  });
