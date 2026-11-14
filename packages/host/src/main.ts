import { join } from "node:path";
import { hostDataDirectory } from "@kodo/platform";
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
import { RelayConnector, DEFAULT_RELAY_ORIGIN } from "./devices/relay.js";
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
mkdirSync(dataDir, { recursive: true });
const port = Number(process.env.KODO_HOST_PORT ?? 4310),
  bind = process.env.KODO_BIND ?? "127.0.0.1";
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid KODO_HOST_PORT.");
const tls = Boolean(process.env.KODO_TLS_CERT && process.env.KODO_TLS_KEY);
if (bind !== "127.0.0.1" && bind !== "::1" && !tls)
  throw new Error("Non-loopback binding requires KODO_TLS_CERT and KODO_TLS_KEY.");
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
const store = new Store(join(dataDir, "kodo.sqlite"));
store.recover();
const service = new SessionService(store, { dataDir, onFatal });
const relay = new RelayConnector(dataDir, process.env.KODO_RELAY_ORIGIN ?? DEFAULT_RELAY_ORIGIN);
const pairing = new Pairing(store);
const options = {
  port,
  webRoot: fileURLToPath(new URL("../../../apps/web/dist/", import.meta.url)),
  publicOrigin: process.env.KODO_PUBLIC_ORIGIN,
  pairing,
  relay,
};
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
const server = tls
  ? createHttpsServer(
      {
        cert: readFileSync(process.env.KODO_TLS_CERT!),
        key: readFileSync(process.env.KODO_TLS_KEY!),
      },
      createHostHandler(service, options),
    )
  : createHostServer(service, options);
fatalCleanup = () => {
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
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    relay.stop();
    remoteServer.closeAllConnections();
    remoteServer.close();
    void service.dispose().finally(() => {
      server.closeAllConnections();
      server.close(() => {
        store.close();
        cleanup();
      });
    });
  });
