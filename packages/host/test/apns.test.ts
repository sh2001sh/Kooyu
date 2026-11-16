import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter, once } from "node:events";
import { createServer, connect, type ServerHttp2Session } from "node:http2";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/storage/store.js";
import { LifecycleGate } from "../src/lifecycle/gate.js";
import { NotificationService } from "../src/notifications/service.js";
import { NotificationDispatcher } from "../src/notifications/delivery.js";
import type { ApnsRequest, ApnsTransport } from "../src/notifications/apns.js";
import { createApnsHttp2Transport } from "../src/notifications/apns.js";
import { SessionService } from "../src/session-service.js";
import { Pairing } from "../src/devices/pairing.js";
import { createHostServer } from "../src/http/server.js";

const privateKey = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();
const configuration = {
  enabled: true,
  teamId: "TEAM123456",
  keyId: "KEY1234567",
  topic: "app.kooyu.ios",
  environment: "sandbox",
  privateKey,
  expectedRevision: 0,
};
function fixture(transport: ApnsTransport = async () => ({ status: 200, body: "" })) {
  const store = new Store(":memory:");
  const secrets = new Map<string, string>();
  const vault = {
    get: async (ref: string) => secrets.get(ref) ?? null,
    set: async (ref: string, value: string) => {
      secrets.set(ref, value);
    },
    delete: async (ref: string) => {
      secrets.delete(ref);
    },
  };
  const gate = new LifecycleGate(store),
    feed = new NotificationService(store, new EventEmitter());
  const dispatcher = new NotificationDispatcher(store, feed, vault, gate, undefined, transport);
  feed.onPublish = (item) => dispatcher.enqueue(item);
  const deviceId = randomUUID();
  store.put("device-public", deviceId, {
    id: deviceId,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });
  const registration = {
    kind: "apns",
    enabled: true,
    preview: false,
    deviceToken: "ab".repeat(32),
    expectedRevision: 0,
    expectedProviderRevision: 1,
    topic: "app.kooyu.ios",
    environment: "sandbox",
  };
  const start = async () => {
    await dispatcher.configureApns(configuration);
    return (await dispatcher.configure(deviceId, registration))!;
  };
  return { store, vault, secrets, gate, feed, dispatcher, deviceId, registration, start };
}

test("APNs validates signing keys, app identity, environment and provider revision before registration", async () => {
  const s = fixture();
  try {
    await assert.rejects(
      s.dispatcher.configureApns({ ...configuration, privateKey: "PRIVATE-SECRET-invalid" }),
      (e: Error) => /P-256/.test(e.message) && !e.message.includes("PRIVATE-SECRET"),
    );
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 })
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString();
    await assert.rejects(
      s.dispatcher.configureApns({ ...configuration, privateKey: rsa }),
      /P-256/,
    );
    await assert.rejects(s.dispatcher.configureApns({ ...configuration, topic: "app/kooyu/ios" }));
    await s.dispatcher.configureApns(configuration);
    for (const change of [
      { topic: "other.app" },
      { environment: "production" },
      { expectedProviderRevision: 2 },
      { expectedProviderRevision: undefined },
    ])
      await assert.rejects(
        s.dispatcher.configure(s.deviceId, { ...s.registration, ...change }),
        /不一致/,
      );
    assert.equal(s.dispatcher.list().length, 0);
    assert.equal(s.secrets.size, 1);
  } finally {
    s.store.close();
  }
});

test("APNs HTTP2 transport bounds responses, closes connections and obeys cancellation", async () => {
  const server = createServer();
  const sessions = new Set<ServerHttp2Session>();
  server.on("session", (session) => {
    sessions.add(session);
    session.on("close", () => sessions.delete(session));
  });
  server.on("stream", (stream, headers) => {
    stream.on("error", () => {});
    if (headers[":path"] === "/slow") return;
    stream.respond({ ":status": 200 });
    stream.end(headers[":path"] === "/large" ? "x".repeat(20000) : "ok");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = "http://127.0.0.1:" + (server.address() as { port: number }).port;
  const transport = createApnsHttp2Transport((() => connect(origin)) as typeof connect);
  const base: ApnsRequest = {
    origin: "https://api.push.apple.com",
    path: "/ok",
    headers: {},
    body: "{}",
    signal: AbortSignal.timeout(2000),
  };
  try {
    assert.deepEqual(await transport(base), { status: 200, body: "ok" });
    await assert.rejects(transport({ ...base, path: "/large" }), /exceeded limit/);
    await assert.rejects(
      transport({ ...base, path: "/slow", signal: AbortSignal.timeout(50) }),
      /timed out|cancelled/,
    );
    await assert.rejects(transport({ ...base, signal: AbortSignal.abort() }));
  } finally {
    for (const session of sessions) session.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("identical APNs registration preserves channel revision and pending deliveries", async () => {
  const s = fixture();
  try {
    const channel = await s.start();
    s.feed.publish({ id: "same-registration", kind: "question" });
    const repeat = await s.dispatcher.configure(s.deviceId, {
      ...s.registration,
      expectedRevision: channel.revision,
    });
    assert.deepEqual(repeat, channel);
    assert.equal(s.dispatcher.deliveries.all()[0]!.status, "pending");
    assert.equal(s.secrets.size, 2);
    const disabled = await s.dispatcher.configure(s.deviceId, {
      ...s.registration,
      enabled: false,
      expectedRevision: channel.revision,
    });
    assert.equal(disabled?.enabled, false);
    assert.equal(disabled?.revision, channel.revision + 1);
    assert.equal(s.dispatcher.deliveries.all()[0]!.status, "cancelled");
  } finally {
    s.store.close();
  }
});

test("APNs retries transient provider failures with stable notification identities and redacted errors", async () => {
  let calls = 0;
  const requests: ApnsRequest[] = [];
  const s = fixture(async (request) => {
    requests.push(request);
    if (++calls === 1) return { status: 503, body: '{"reason":"private-provider-response"}' };
    return { status: 200, body: "" };
  });
  try {
    await s.start();
    s.feed.publish({ id: "retry", kind: "goal-completed", preview: "sensitive-body" });
    await s.dispatcher.scan(Date.now() + 6000);
    const pending = s.dispatcher.deliveries.all()[0]!;
    assert.equal(pending.status, "pending");
    assert.equal(pending.attempts, 1);
    assert(!pending.lastError!.includes("private-provider-response"));
    await s.dispatcher.scan(Date.parse(pending.dueAt) + 1);
    assert.equal(s.dispatcher.deliveries.all()[0]!.status, "accepted");
    assert.equal(requests[0]!.headers["apns-id"], requests[1]!.headers["apns-id"]);
    assert.equal(
      requests[0]!.headers["apns-collapse-id"],
      requests[1]!.headers["apns-collapse-id"],
    );
    assert.equal(requests[0]!.headers.authorization, requests[1]!.headers.authorization);
    assert(!requests[0]!.body.includes("sensitive-body"));
  } finally {
    s.store.close();
  }
});

test("APNs permanent provider rejection does not disable an otherwise valid device", async () => {
  const s = fixture(async () => ({
    status: 403,
    body: '{"reason":"InvalidProviderToken","secret":"do-not-persist"}',
  }));
  try {
    const c = await s.start();
    s.feed.publish({ id: "bad-provider", kind: "question" });
    await s.dispatcher.scan(Date.now() + 6000);
    const d = s.dispatcher.deliveries.all()[0]!;
    assert.equal(d.status, "failed");
    assert.match(d.lastError!, /403/);
    assert(!JSON.stringify(d).includes("do-not-persist"));
    assert.equal(s.dispatcher.channels.get(c.id).enabled, true);
  } finally {
    s.store.close();
  }
});

test("APNs token replacement fences a late invalid-device response from the previous registration", async () => {
  let resolve!: (r: { status: number; body: string }) => void, entered!: () => void;
  const started = new Promise<void>((r) => {
    entered = r;
  });
  const s = fixture(async () => {
    entered();
    return new Promise((r) => {
      resolve = r;
    });
  });
  try {
    const c = await s.start();
    s.feed.publish({ id: "old-token", kind: "question" });
    const scanning = s.dispatcher.scan(Date.now() + 6000);
    await started;
    const next = await s.dispatcher.configure(s.deviceId, {
      ...s.registration,
      deviceToken: "cd".repeat(32),
      expectedRevision: c.revision,
    });
    resolve({ status: 410, body: '{"reason":"Unregistered"}' });
    await scanning;
    assert.equal(s.dispatcher.channels.get(c.id).enabled, true);
    assert.equal(s.dispatcher.channels.get(c.id).revision, next!.revision);
    assert.equal(s.dispatcher.deliveries.all()[0]!.status, "cancelled");
  } finally {
    s.store.close();
  }
});

test("APNs provider rotation invalidates queued sends and old device registrations", async () => {
  let calls = 0;
  const s = fixture(async () => {
    calls++;
    return { status: 200, body: "" };
  });
  try {
    const c = await s.start();
    s.feed.publish({ id: "old-provider", kind: "question" });
    await s.dispatcher.configureApns({
      ...configuration,
      privateKey: undefined,
      expectedRevision: 1,
      environment: "production",
    });
    await s.dispatcher.scan(Date.now() + 6000);
    assert.equal(calls, 0);
    assert.equal(s.dispatcher.channels.get(c.id).enabled, false);
    assert.equal(s.dispatcher.deliveries.all()[0]!.status, "cancelled");
    await assert.rejects(
      s.dispatcher.configure(s.deviceId, { ...s.registration, expectedRevision: 2 }),
      /不一致/,
    );
  } finally {
    s.store.close();
  }
});

test("APNs quiesce during Vault lookup fences dispatch and drain observes in-flight work", async () => {
  let calls = 0,
    release!: () => void,
    entered!: () => void;
  const s = fixture(async () => {
    calls++;
    return { status: 200, body: "" };
  });
  try {
    await s.start();
    s.feed.publish({ id: "fenced", kind: "question" });
    const started = new Promise<void>((r) => {
      entered = r;
    });
    const blocked = new Promise<void>((r) => {
      release = r;
    });
    const get = s.vault.get;
    s.vault.get = async (ref) => {
      if (ref.startsWith("notification:apns:")) {
        entered();
        await blocked;
      }
      return get(ref);
    };
    const running = s.dispatcher.scan(Date.now() + 6000);
    await started;
    s.gate.quiesce();
    assert.equal(s.gate.status().inFlight, 1);
    release();
    await running;
    await s.dispatcher.drain();
    assert.equal(calls, 0);
    assert.equal(s.gate.status().inFlight, 0);
    assert.equal(s.dispatcher.deliveries.all()[0]!.status, "pending");
  } finally {
    s.store.close();
  }
});

test("APNs removal erases the Vault token and preserves a monotonic channel revision", async () => {
  const s = fixture();
  try {
    const c = await s.start(),
      ref = s.dispatcher.channels.get(c.id).credentialRef!;
    s.feed.publish({ id: "revoked", kind: "question" });
    await s.dispatcher.removeChannel(c.id);
    assert.equal(s.secrets.has(ref), false);
    assert.equal(s.dispatcher.channels.get(c.id).credentialRef, null);
    assert.equal(s.dispatcher.channels.get(c.id).revision, c.revision + 1);
    await s.dispatcher.removeChannel(c.id);
    assert.equal(s.dispatcher.channels.get(c.id).revision, c.revision + 1);
    assert.equal(s.dispatcher.deliveries.all()[0]!.status, "cancelled");
    await assert.rejects(s.dispatcher.configure(s.deviceId, s.registration), /已修改/);
  } finally {
    s.store.close();
  }
});

test("APNs HTTP routes restrict signing configuration and token revocation to the correct identities", async () => {
  const s = fixture(),
    dir = mkdtempSync(join(tmpdir(), "kooyu-apns-api-"));
  const pairing = new Pairing(s.store);
  const one = pairing.pair(pairing.create().code, "one"),
    two = pairing.pair(pairing.create().code, "two");
  const service = new SessionService(s.store, {
    dataDir: dir,
    adapters: [],
    providerVault: s.vault,
  });
  const server = createHostServer(service, {
    port: 4310,
    webRoot: dir,
    publicOrigin: "https://kooyu.test",
    pairing,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const call = (path: string, method = "GET", body?: unknown, token?: string) =>
    new Promise<{ status: number; body: any }>((resolve, reject) => {
      const request = httpRequest(
        {
          hostname: "127.0.0.1",
          port: (server.address() as { port: number }).port,
          path,
          method,
          headers: {
            host: token ? "kooyu.test" : "127.0.0.1:4310",
            ...(token ? { authorization: "Bearer " + token, "x-forwarded-for": "192.0.2.1" } : {}),
            ...(body === undefined ? {} : { "content-type": "application/json" }),
          },
        },
        (response) => {
          let raw = "";
          response.on("data", (chunk) => {
            raw += chunk;
          });
          response.on("end", () =>
            resolve({ status: response.statusCode!, body: JSON.parse(raw) }),
          );
        },
      );
      request.on("error", reject);
      request.end(body === undefined ? undefined : JSON.stringify(body));
    });
  try {
    assert.equal(
      (await call("/api/notification-providers/apns", "PUT", configuration, one.token)).status,
      401,
    );
    assert.equal(
      (await call("/api/notification-providers/apns", "PUT", configuration)).status,
      200,
    );
    const publicStatus = await call(
      "/api/notification-providers/apns",
      "GET",
      undefined,
      one.token,
    );
    assert.equal(publicStatus.status, 200);
    assert(!JSON.stringify(publicStatus.body).includes("PRIVATE KEY"));
    const configured = await call(
      "/api/notification-channels",
      "PUT",
      { ...s.registration, deviceId: two.device.id },
      one.token,
    );
    assert.equal(configured.status, 200);
    assert.equal(configured.body.deviceId, one.device.id);
    const path = "/api/notification-channels/" + encodeURIComponent(configured.body.id);
    assert.equal((await call(path, "DELETE", undefined, two.token)).status, 401);
    assert.equal(
      (await call("/api/notification-channels", "GET", undefined, two.token)).body.length,
      0,
    );
    assert.equal((await call(path, "DELETE", undefined, one.token)).status, 200);
    assert.equal((await call(path, "DELETE", undefined, one.token)).status, 200);
    assert.equal((await call("/api/devices/" + one.device.id, "DELETE")).status, 200);
    assert.equal(
      (await call("/api/notification-channels", "GET", undefined, one.token)).status,
      401,
    );
    assert.equal(s.secrets.size, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await service.dispose();
    s.store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
