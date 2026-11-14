// Isolated transport fixture: no user data, no native harnesses or model calls.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { Store } from "../packages/host/dist/storage/store.js";
import { SessionService } from "../packages/host/dist/session-service.js";
import { Pairing } from "../packages/host/dist/devices/pairing.js";
import { RelayConnector } from "../packages/host/dist/devices/relay.js";
import { createHostServer } from "../packages/host/dist/http/server.js";
import { createRelay } from "../services/relay/src/server.mjs";
async function freePort() {
  const s = createServer();
  s.listen(0, "127.0.0.1");
  await once(s, "listening");
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}
const dir = mkdtempSync(join(tmpdir(), "kooyu-relay-ui-")),
  desktopPort = await freePort();
const webRoot = resolve("apps/web/dist");
const remoteOrigin = process.argv[2];
const relayPort = remoteOrigin ? 0 : await freePort();
const origin = remoteOrigin ?? "http://127.0.0.1:" + relayPort;
let relay;
if (!remoteOrigin) {
  relay = createRelay({ origin, webRoot });
  relay.server.listen(relayPort, "127.0.0.1");
  await once(relay.server, "listening");
}
const store = new Store(":memory:"),
  service = new SessionService(store, { dataDir: dir, adapters: [] }),
  pairing = new Pairing(store);
let secret = null;
const connector = new RelayConnector(dir, origin, !remoteOrigin, {
  getPassword: () => secret,
  setPassword: (value) => {
    secret = value;
  },
});
const upstream = createHostServer(service, {
  port: relayPort,
  webRoot,
  forceRemote: true,
  pairing,
  ...(remoteOrigin ? { publicOrigin: origin } : {}),
});
upstream.listen(0, "127.0.0.1");
await once(upstream, "listening");
connector.start(upstream.address().port);
const local = createHostServer(service, { port: desktopPort, webRoot, pairing, relay: connector });
local.listen(desktopPort, "127.0.0.1");
await once(local, "listening");
const project = service.createProject({ name: "Relay 隔离验收项目", rootPath: dir });
service.createDraft({
  title: "Relay 隔离验收会话",
  kind: "direct",
  harnessId: "codex",
  projectId: project.id,
});
mkdirSync(".local/verification", { recursive: true });
writeFileSync(
  ".local/verification/relay-fixture.json",
  JSON.stringify({ desktop: "http://127.0.0.1:" + desktopPort, origin, synthetic: true }),
);
console.log(
  JSON.stringify({ desktop: "http://127.0.0.1:" + desktopPort, origin, synthetic: true }),
);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  connector.stop();
  await relay?.close();
  local.closeAllConnections();
  upstream.closeAllConnections();
  await Promise.all([new Promise((r) => local.close(r)), new Promise((r) => upstream.close(r))]);
  await service.dispose();
  store.close();
  rmSync(dir, { recursive: true, force: true });
}
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => void close());
// A finite lease guarantees a disconnected test runner cannot leave the fixture exposed.
setTimeout(() => void close(), 15 * 60 * 1000).unref();
