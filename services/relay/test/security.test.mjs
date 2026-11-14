import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import { createServer, request } from "node:http";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import WebSocket from "ws";
import { createRelay } from "../src/server.mjs";

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
async function enroll(origin, keys = generateKeyPairSync("ed25519")) {
  const ws = new WebSocket(origin.replace("http:", "ws:") + "/v1/host");
  const [raw] = await once(ws, "message"),
    challenge = JSON.parse(raw);
  const der = keys.publicKey.export({ format: "der", type: "spki" });
  const ready = once(ws, "message");
  ws.send(
    JSON.stringify({
      type: "authenticate",
      publicKey: der.toString("base64"),
      signature: sign(null, Buffer.from(challenge.challenge), keys.privateKey).toString("base64"),
    }),
  );
  await ready;
  return { ws, keys, id: createHash("sha256").update(der).digest("hex") };
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
