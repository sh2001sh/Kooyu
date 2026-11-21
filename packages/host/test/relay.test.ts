import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/storage/store.js";
import { SessionService } from "../src/session-service.js";
import { Pairing } from "../src/devices/pairing.js";
import { RelayConnector } from "../src/devices/relay.js";
import { createHostServer } from "../src/http/server.js";

async function port() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const value = (server.address() as { port: number }).port;
  await new Promise<void>((done) => server.close(() => done()));
  return value;
}
const relayModule = new URL("../../../services/relay/test/protocol-fixture.mjs", import.meta.url)
  .href;
const { createRelay } = await import(relayModule);
async function until(check: () => boolean, timeout = 8000) {
  const end = Date.now() + timeout;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  assert.ok(check(), "condition reached before timeout");
}

test(
  "Relay: real Host pairing, remote isolation, cookie scope, streaming revoke, reconnect and disable",
  { timeout: 45000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "kooyu-relay-test-"));
    const relayPort = await port(),
      localPort = await port(),
      origin = "http://127.0.0.1:" + relayPort;
    const relay = createRelay({ origin });
    relay.server.listen(relayPort, "127.0.0.1");
    await once(relay.server, "listening");
    const store = new Store(":memory:"),
      service = new SessionService(store, { dataDir: dir, adapters: [] }),
      pairing = new Pairing(store);
    let secret: string | null = null;
    const vault = {
      getPassword: () => secret,
      setPassword: (value: string) => {
        secret = value;
      },
    };
    let connector = new RelayConnector(dir, origin, true, vault);
    const remote = createHostServer(service, {
      port: relayPort,
      webRoot: dir,
      forceRemote: true,
      pairing,
    });
    remote.listen(0, "127.0.0.1");
    await once(remote, "listening");
    connector.start((remote.address() as { port: number }).port);
    const local = createHostServer(service, {
      port: localPort,
      webRoot: dir,
      pairing,
      relay: connector,
    });
    local.listen(localPort, "127.0.0.1");
    await once(local, "listening");
    const desktop = "http://127.0.0.1:" + localPort;
    const json = (method: string, body: unknown) => ({
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    try {
      assert.equal(connector.status().enabled, false);
      const inviteResponse = await fetch(desktop + "/api/pairing", json("POST", {}));
      assert.equal(inviteResponse.status, 201);
      const invite = (await inviteResponse.json()) as any;
      assert.match(invite.code, /^[A-F0-9]{32}$/);
      const base = invite.url.split("#")[0].replace(/\/$/, "");
      assert.equal(
        (await fetch(base + "/api/snapshot")).status,
        401,
        "remote does not inherit loopback privileges",
      );
      assert.equal(
        (
          await fetch(base + "/api/snapshot", {
            headers: { "x-forwarded-for": "", "x-local": "true" },
          })
        ).status,
        401,
      );
      const paired = await fetch(
        base + "/api/pair",
        json("POST", { code: invite.code, name: "Relay browser fixture" }),
      );
      assert.equal(paired.status, 201);
      const device = ((await paired.json()) as any).device;
      const cookie = paired.headers.get("set-cookie")!;
      assert.match(cookie, /HttpOnly/);
      assert.match(cookie, /Secure/);
      assert.match(cookie, /SameSite=Lax/);
      assert.ok(cookie.includes("Path=" + new URL(base).pathname + "/api"));
      const headers = { cookie: cookie.split(";")[0]! };
      const snap = await fetch(base + "/api/snapshot", { headers });
      assert.equal(snap.status, 200);
      assert.equal(((await snap.json()) as any).hostId, store.hostId);
      assert.equal(
        (await fetch(base + "/api/pair", json("POST", { code: invite.code, name: "Replay" })))
          .status,
        401,
      );
      assert.equal((await fetch(base + "/api/remote", { headers })).status, 401);
      assert.equal(
        (
          await fetch(base + "/api/pairing", {
            ...json("POST", {}),
            headers: { ...headers, "content-type": "application/json" },
          })
        ).status,
        401,
      );
      assert.equal(
        (await fetch(base + "/api/devices/" + device.id, { method: "DELETE", headers })).status,
        401,
      );
      assert.equal(
        (
          await fetch(base + "/api/snapshot", {
            headers: { ...headers, origin: "https://evil.example" },
          })
        ).status,
        403,
      );
      const token = headers.cookie.split("=")[1];
      assert.equal(JSON.stringify(store.records("device-secret")).includes(token!), false);
      const foreign = headers.cookie.replace(/kooyu_[a-f0-9]{64}/, "kooyu_" + "a".repeat(64));
      assert.equal(
        (await fetch(base + "/api/snapshot", { headers: { cookie: foreign } })).status,
        401,
      );
      const manifest = await fetch(base + "/manifest.webmanifest");
      assert.equal(((await manifest.json()) as any).start_url, new URL(base).pathname + "/");
      const stream = await fetch(base + "/api/events?after=0", {
        headers,
        signal: AbortSignal.timeout(10000),
      });
      assert.equal(stream.status, 200);
      const reader = stream.body!.getReader();
      assert.match(new TextDecoder().decode((await reader.read()).value), /connected/);
      const revoke = await fetch(desktop + "/api/devices/" + device.id, { method: "DELETE" });
      assert.equal(revoke.status, 200);
      let events = "";
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        events += new TextDecoder().decode(part.value);
      }
      assert.match(events, /auth-expired/);
      assert.equal((await fetch(base + "/api/snapshot", { headers })).status, 401);
      const oldUrl = connector.status().url;
      const saved = JSON.parse(readFileSync(join(dir, "relay-identity.json"), "utf8"));
      assert.equal(saved.privateKey, undefined);
      assert.ok(secret);
      connector.stop();
      await until(() => relay.hosts.size === 0);
      assert.equal((await fetch(base + "/api/snapshot")).status, 503);
      connector = new RelayConnector(dir, origin, true, vault);
      connector.start((remote.address() as { port: number }).port);
      await until(() => connector.status().state === "connected");
      assert.equal(connector.status().url, oldUrl);
      // Force loss of the established transport. The same identity reconnects automatically.
      relay.hosts.values().next().value.ws.terminate();
      await until(() => connector.status().state !== "connected");
      await until(() => connector.status().state === "connected");
      // Invalid frames must close and reconnect, not throw from native WebSocket.close().
      const malformedPeer = relay.hosts.values().next().value.ws;
      const malformedClose = once(malformedPeer, "close");
      malformedPeer.send(JSON.stringify({ type: "unexpected" }));
      assert.equal((await malformedClose)[0], 4008);
      await until(() => connector.status().state === "connected");
      connector.disable();
      await until(() => relay.hosts.size === 0);
      assert.equal(new RelayConnector(dir, origin, true, vault).status().enabled, false);
    } finally {
      connector.stop();
      await relay.close();
      local.closeAllConnections();
      remote.closeAllConnections();
      await Promise.all([
        new Promise<void>((done) => local.close(() => done())),
        new Promise<void>((done) => remote.close(() => done())),
      ]);
      await service.dispose();
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test("Remote-only HTTP handler rejects local credentials and administrative endpoints", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kooyu-remote-boundary-")),
    p = await port();
  const store = new Store(":memory:"),
    service = new SessionService(store, { dataDir: dir, adapters: [] });
  const server = createHostServer(service, { port: p, webRoot: dir, forceRemote: true });
  server.listen(p, "127.0.0.1");
  await once(server, "listening");
  try {
    for (const path of ["snapshot", "remote", "harnesses/management"])
      assert.equal((await fetch("http://127.0.0.1:" + p + "/api/" + path)).status, 401);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await service.dispose();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
