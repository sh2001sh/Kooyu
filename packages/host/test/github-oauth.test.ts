import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { GitHubOAuth } from "../src/applications/github-oauth.js";
import { SessionService } from "../src/session-service.js";
import { Store } from "../src/storage/store.js";
import { createHostServer } from "../src/http/server.js";
import { once } from "node:events";

async function fixture() {
  const store = new Store(":memory:");
  const values = new Map<string, string>();
  const vault = {
    get: async (ref: string) => values.get(ref) ?? null,
    set: async (ref: string, value: string) => {
      values.set(ref, value);
    },
    delete: async (ref: string) => {
      values.delete(ref);
    },
  };
  const requests: Array<{ url: string; body: URLSearchParams }> = [];
  let response: Record<string, unknown> = { error: "authorization_pending" };
  let pause: Promise<void> | undefined;
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, body: new URLSearchParams(String(init?.body ?? "")) });
    if (url.endsWith("/login/device/code"))
      return Response.json({
        device_code: "secret-device-code",
        user_code: "ABCD-EFGH",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      });
    if (url.endsWith("/user")) return Response.json({ login: "octocat" });
    if (pause) await pause;
    return Response.json(response);
  };
  const service = new SessionService(store, {
    adapters: [],
    providerVault: vault,
    applicationFetch: fetcher,
  });
  const oauth = new GitHubOAuth(service, vault, fetcher);
  oauth.configure({ clientId: "Ov23-test-client" });
  const start = () => oauth.start({ requestId: randomUUID() }, "desktop");
  const due = (id: string) => {
    const record = store.record<any>("github-login", id)!;
    store.put("github-login", id, { ...record, nextPollAt: 0 });
  };
  return {
    store,
    values,
    service,
    oauth,
    requests,
    start,
    due,
    setResponse: (v: Record<string, unknown>) => (response = v),
    setPause: (v: Promise<void>) => (pause = v),
    close: async () => {
      await service.dispose();
      store.close();
    },
  };
}
test("GitHub device login stores secrets only in vault, obeys interval and slowdown, then connects without grants", async () => {
  const f = await fixture();
  try {
    const login = await f.start();
    assert.equal(login.verificationUri, "https://github.com/login/device");
    assert.ok(!JSON.stringify(login).includes("secret-device-code"));
    assert.equal(f.requests[0]!.body.get("scope"), "public_repo");
    await f.oauth.poll(login.id, "desktop");
    assert.equal(f.requests.length, 1);
    f.due(login.id);
    f.setResponse({ error: "slow_down" });
    const slow: any = await f.oauth.poll(login.id, "desktop");
    assert.equal(slow.interval, 10);
    f.due(login.id);
    f.setResponse({ access_token: "secret-access-token", token_type: "bearer" });
    const connected: any = await f.oauth.poll(login.id, "desktop");
    assert.equal(connected.status, "connected");
    const connection = f.service.applications.connections.get(login.connectionId);
    assert.equal(connection.name, "GitHub · octocat");
    assert.equal(await f.values.get(connection.credentialRef!), "secret-access-token");
    assert.equal(f.service.permissions.grants.all().length, 0);
    assert.ok(!JSON.stringify(f.service.applications.list()).includes("secret-access-token"));
    assert.ok(
      !JSON.stringify(f.store.record("github-login", login.id)).includes("secret-device-code"),
    );
    assert.ok(!f.values.has("github-device:" + login.id));
  } finally {
    await f.close();
  }
});
test("GitHub cancellation wins an in-flight token response and cannot revive a revoked connection", async () => {
  const f = await fixture();
  try {
    const login = await f.start();
    f.due(login.id);
    f.setResponse({ access_token: "must-not-save", token_type: "bearer" });
    let release!: () => void;
    f.setPause(
      new Promise<void>((r) => {
        release = r;
      }),
    );
    const poll = f.oauth.poll(login.id, "desktop");
    await new Promise((r) => setImmediate(r));
    await f.oauth.cancel(login.id, "desktop");
    release();
    await assert.rejects(poll, /取消|修改/);
    assert.equal(f.service.applications.connections.get(login.connectionId).enabled, false);
    assert.ok(![...f.values.values()].includes("must-not-save"));
  } finally {
    await f.close();
  }
});
test("GitHub device login enforces device ownership and expiry", async () => {
  const f = await fixture();
  try {
    const login = await f.start();
    await assert.rejects(f.oauth.poll(login.id, "other"), /不存在/);
    const record = f.store.record<any>("github-login", login.id);
    f.store.put("github-login", login.id, { ...record, expiresAt: 0 });
    const expired: any = await f.oauth.poll(login.id, "desktop");
    assert.equal(expired.status, "expired");
    assert.equal(f.service.applications.connections.get(login.connectionId).enabled, false);
    assert.ok(!f.values.has("github-device:" + login.id));
  } finally {
    await f.close();
  }
});

test("GitHub login routes are local-only and return device codes without access credentials", async () => {
  const f = await fixture();
  const options = { port: 0, webRoot: "." };
  const server = createHostServer(f.service, options);
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    options.port = (server.address() as { port: number }).port;
    const url = `http://127.0.0.1:${options.port}`;
    const request = (path: string, body?: unknown, remote = false) =>
      fetch(url + path, {
        method: body ? "POST" : "GET",
        headers: {
          ...(body ? { "content-type": "application/json" } : {}),
          ...(remote ? { "x-forwarded-for": "203.0.113.9" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    assert.equal((await request("/api/oauth/github/configuration", undefined, true)).status, 401);
    const config = await request("/api/oauth/github/configuration", {
      clientId: "Ov23-test-client",
    });
    assert.equal(config.status, 200);
    const started = await request("/api/oauth/github/start", { requestId: randomUUID() });
    assert.equal(started.status, 201);
    const login = await started.json();
    assert.equal(login.status, "pending");
    assert.ok(!JSON.stringify(login).includes("secret-device-code"));
    const cancelled = await request(`/api/oauth/github/${login.id}/cancel`, {});
    assert.equal(cancelled.status, 200);
    assert.equal((await cancelled.json()).status, "cancelled");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await f.close();
  }
});
