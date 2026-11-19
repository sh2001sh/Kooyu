// Isolated fixture only: no user data or model calls.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { get, Agent } from "node:https";
import { gunzipSync } from "node:zlib";
const { desktop, synthetic } = JSON.parse(
  readFileSync(".local/verification/relay-fixture.json", "utf8"),
);
assert.equal(synthetic, true);
const post = (body) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const inviteResponse = await fetch(desktop + "/api/pairing", post({}));
assert.equal(inviteResponse.status, 201);
const invitation = await inviteResponse.json();
const base = invitation.url.split("#")[0].slice(0, -1);
const paired = await fetch(
  base + "/api/pair/native",
  post({ code: invitation.code, name: "Compression verification" }),
);
assert.equal(paired.status, 201);
const device = await paired.json();
const agent = new Agent({ keepAlive: true });
const read = (encoding) =>
  new Promise((resolve, reject) => {
    const started = performance.now();
    get(
      base + "/api/native/snapshot",
      { agent, headers: { authorization: "Bearer " + device.token, "accept-encoding": encoding } },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            encoding: response.headers["content-encoding"],
            body: Buffer.concat(chunks),
            ms: Math.round(performance.now() - started),
          }),
        );
        response.on("error", reject);
      },
    ).on("error", reject);
  });
try {
  const plain = await read("identity");
  const zipped = await read("gzip");
  assert.equal(plain.status, 200);
  assert.equal(zipped.status, 200);
  assert.equal(zipped.encoding, "gzip");
  const decoded = gunzipSync(zipped.body);
  assert.equal(JSON.parse(decoded).hostId, device.hostId);
  assert.ok(zipped.body.length < decoded.length);
  const stream = await fetch(base + "/api/events", {
    headers: { authorization: "Bearer " + device.token, "accept-encoding": "gzip" },
    signal: AbortSignal.timeout(25000),
  });
  assert.equal(stream.status, 200);
  assert.equal(stream.headers.get("content-encoding"), null);
  const reader = stream.body.getReader();
  let received = "";
  while (!received.includes(": heartbeat")) {
    const next = await reader.read();
    assert.equal(next.done, false);
    received += new TextDecoder().decode(next.value);
  }
  await reader.cancel();
  const report = {
    fixtureOnly: true,
    jsonBytes: decoded.length,
    compressedBytes: zipped.body.length,
    reductionPercent: Math.round(100 * (1 - zipped.body.length / decoded.length)),
    uncompressedRequestMs: plain.ms,
    compressedReusedConnectionMs: zipped.ms,
    sseHeartbeat: true,
    sseUncompressed: true,
  };
  writeFileSync(
    ".local/verification/relay-compression-20261119.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  agent.destroy();
  await fetch(desktop + "/api/devices/" + device.device.id, { method: "DELETE" });
  await fetch(desktop + "/api/remote", { method: "DELETE" });
}
