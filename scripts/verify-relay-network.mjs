import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { Entry } from "@napi-rs/keyring";
import { RelayConnector } from "../packages/host/dist/devices/relay.js";
const { desktop, origin } = JSON.parse(
  readFileSync(".local/verification/relay-fixture.json", "utf8"),
);
const post = (body) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const invitation = await (await fetch(desktop + "/api/pairing", post({}))).json();
assert.ok(invitation.url);
const base = invitation.url.split("#")[0].slice(0, -1);
const nativeResponse = await fetch(
  base + "/api/pair/native",
  post({ code: invitation.code, name: "Native protocol public verification" }),
);
assert.equal(nativeResponse.status, 201);
const native = await nativeResponse.json();
assert.ok(native.token);
assert.equal(native.protocolVersion, 2);
const options = { headers: { authorization: "Bearer " + native.token, "x-kooyu-protocol": "2" } };
const snapshot = await fetch(base + "/api/native/snapshot", options);
assert.equal(snapshot.status, 200);
assert.equal((await snapshot.json()).hostId, native.hostId);
assert.equal((await fetch(base + "/api/remote", options)).status, 401);
const stream = await fetch(base + "/api/events?after=0", {
  ...options,
  signal: AbortSignal.timeout(22000),
});
assert.equal(stream.status, 200);
const reader = stream.body.getReader();
let data = "";
while (!data.includes(": heartbeat")) {
  const part = await reader.read();
  assert.equal(part.done, false);
  data += new TextDecoder().decode(part.value);
}
await reader.cancel();
assert.equal(
  (await fetch(desktop + "/api/devices/" + native.device.id, { method: "DELETE" })).status,
  200,
);
assert.equal((await fetch(base + "/api/snapshot", options)).status, 401);
// Exercise the real system vault with an isolated credential, and always remove it.
const dir = mkdtempSync(join(tmpdir(), "kooyu-relay-vault-"));
const ref = "relay:" + createHash("sha256").update(join(dir, "relay-identity.json")).digest("hex");
let connector = new RelayConnector(dir, origin);
try {
  connector.start(1);
  const first = await connector.enable();
  assert.equal(
    readFileSync(join(dir, "relay-identity.json"), "utf8").includes("PRIVATE KEY"),
    false,
  );
  assert.ok(new Entry("Kooyu", ref).getPassword());
  connector.stop();
  await new Promise((r) => setTimeout(r, 300));
  connector = new RelayConnector(dir, origin);
  connector.start(1);
  assert.equal(await connector.enable(), first);
  connector.disable();
} finally {
  connector.stop();
  new Entry("Kooyu", ref).deletePassword();
  rmSync(dir, { recursive: true, force: true });
}
const report = {
  origin,
  nativeBearer: true,
  protocolVersion: 2,
  heartbeat: true,
  revocation: true,
  systemVault: true,
  stableHostIdentity: true,
  fixtureOnly: true,
  modelCalls: 0,
};
writeFileSync(".local/verification/relay-network-result.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
