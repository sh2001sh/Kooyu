import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import { createServer, request } from "node:http";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import WebSocket from "ws";
import { createRelay } from "./protocol-fixture.mjs";

async function fixture() {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const origin = "http://127.0.0.1:" + port;
  const relay = createRelay({ origin });
  relay.server.listen(port, "127.0.0.1");
  await once(relay.server, "listening");
  return { relay, origin };
}
async function enroll(origin, keys = generateKeyPairSync("ed25519"), version = 1) {
  const ws = new WebSocket(origin.replace("http:", "ws:") + "/v" + version + "/host");
  const decode = (raw) => JSON.parse(version === 2 ? raw.subarray(6) : raw);
  const [raw] = await once(ws, "message"),
    challenge = decode(raw);
  const der = keys.publicKey.export({ format: "der", type: "spki" });
  const ready = once(ws, "message");
  const auth = JSON.stringify({
    type: "authenticate",
    publicKey: der.toString("base64"),
    signature: sign(null, Buffer.from(challenge.challenge), keys.privateKey).toString("base64"),
  });
  ws.send(
    version === 2 ? Buffer.concat([Buffer.from([1, 0, 0, 0, 0, 0]), Buffer.from(auth)]) : auth,
  );
  await ready;
  return { ws, keys, decode, id: createHash("sha256").update(der).digest("hex") };
}
test("Relay rejects invalid Host, cross-origin calls, invalid signatures and browser enrollment", async () => {
  const { relay, origin } = await fixture();
  try {
    assert.equal(
      await new Promise((resolve, reject) => {
        const req = request(origin + "/healthz", { headers: { host: "evil.example" } }, (res) => {
          res.resume();
          resolve(res.statusCode);
        });
        req.on("error", reject);
        req.end();
      }),
      421,
    );
    assert.equal(
      (await fetch(origin + "/healthz", { headers: { origin: "https://evil.example" } })).status,
      403,
    );
    const bad = new WebSocket(origin.replace("http:", "ws:") + "/v1/host");
    await once(bad, "message");
    const rejected = once(bad, "close");
    const key = generateKeyPairSync("ed25519")
      .publicKey.export({ format: "der", type: "spki" })
      .toString("base64");
    bad.send(
      JSON.stringify({
        type: "authenticate",
        publicKey: key,
        signature: Buffer.alloc(64).toString("base64"),
      }),
    );
    assert.equal((await rejected)[0], 1008);
    assert.equal(relay.hosts.size, 0);
    const browser = new WebSocket(origin.replace("http:", "ws:") + "/v1/host", { origin });
    const error = await new Promise((resolve) => browser.once("error", resolve));
    assert.match(error.message, /403/);
  } finally {
    await relay.close();
  }
});
test("Relay restricts response content and cookies to enrolled Host; ignores cross-host response injection", async () => {
  const { relay, origin } = await fixture();
  try {
    const a = await enroll(origin),
      b = await enroll(origin);
    const path = "/h/" + a.id + "/api/snapshot";
    const requested = once(a.ws, "message");
    const response = fetch(origin + path, {
      headers: { cookie: "kooyu_" + b.id + "=other; kodo_device=unscoped" },
    });
    const request = JSON.parse((await requested)[0]);
    assert.equal(request.headers.cookie, undefined);
    b.ws.send(
      JSON.stringify({
        type: "head",
        id: request.id,
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    a.ws.send(
      JSON.stringify({
        type: "head",
        id: request.id,
        status: 200,
        headers: {
          "content-type": "text/html",
          "set-cookie": "kodo_device=" + "a".repeat(43) + "; Domain=evil.example; Path=/",
        },
      }),
    );
    a.ws.send(
      JSON.stringify({
        type: "chunk",
        id: request.id,
        data: Buffer.from("<script>bad()</script>").toString("base64"),
      }),
    );
    a.ws.send(JSON.stringify({ type: "end", id: request.id }));
    const result = await response;
    assert.equal(result.status, 200);
    assert.match(result.headers.get("content-type"), /^text\/plain/);
    assert.match(result.headers.get("content-security-policy"), /sandbox/);
    assert.ok(result.headers.get("set-cookie").includes("Path=/h/" + a.id + "/api"));
    assert.equal(result.headers.get("set-cookie").includes("Domain="), false);
    assert.equal(await result.text(), "<script>bad()</script>");
  } finally {
    await relay.close();
  }
});

for (const version of [1, 2])
  test(
    `v${version} congestion rejects new work and still cancels an admitted request`,
    { timeout: 10000 },
    async () => {
      const { relay, origin } = await fixture();
      try {
        const { ws, id, decode } = await enroll(origin, undefined, version);
        const host = relay.hosts.get(id);
        const url = origin + "/h/" + id + "/api/snapshot";
        const admitted = once(ws, "message");
        const controller = new AbortController();
        const response = fetch(url, { signal: controller.signal }).catch((error) => error);
        const request = decode((await admitted)[0]);
        Object.defineProperty(host.ws, "bufferedAmount", { value: 5 * 1024 * 1024 });
        const refused = await fetch(url);
        assert.equal(refused.status, 503);
        assert.equal((await refused.json()).error.code, "RELAY_BUSY");
        assert.equal(host.requests.size, 1);
        const cancelled = once(ws, "message");
        controller.abort();
        assert.equal((await response).name, "AbortError");
        assert.deepEqual(decode((await cancelled)[0]), { type: "cancel", id: request.id });
        assert.equal(host.requests.size, 0);
      } finally {
        await relay.close();
      }
    },
  );
