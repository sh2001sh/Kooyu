import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/storage/store.js";
import { Pairing, DEVICE_TOKEN_TTL_MS } from "../src/devices/pairing.js";
test("pairing invitations and device tokens expire at their deadlines, including legacy tokens", () => {
  const store = new Store(":memory:");
  let now = Date.now();
  const pairing = new Pairing(store, () => now);
  try {
    const expired = pairing.create();
    now += 120000;
    assert.throws(() => pairing.pair(expired.code, "test"), /过期/);
    const invite = pairing.create(),
      paired = pairing.pair(invite.code, "test");
    const stored = store.record<any>("device-secret", paired.device.id)!;
    delete stored.expiresAt;
    store.put("device-secret", paired.device.id, stored);
    now += DEVICE_TOKEN_TTL_MS - 1;
    assert.equal(pairing.authenticate(paired.token), true);
    now++;
    assert.equal(pairing.authenticate(paired.token), false);
  } finally {
    store.close();
  }
});
test("paired device survives Host restart, stores a digest, and can be revoked", () => {
  const dir = mkdtempSync(join(tmpdir(), "kodo-pairing-")),
    path = join(dir, "state.sqlite");
  let store = new Store(path);
  try {
    let pairing = new Pairing(store);
    const invite = pairing.create(),
      paired = pairing.pair(invite.code, "Isolated test device");
    assert.equal(pairing.authenticate(paired.token), true);
    assert.equal(JSON.stringify(store.records("device-secret")).includes(paired.token), false);
    assert.equal(store.records("device-public").length, 1);
    store.close();
    store = new Store(path);
    pairing = new Pairing(store);
    assert.equal(pairing.authenticate(paired.token), true);
    pairing.revoke(paired.device.id);
    assert.equal(pairing.authenticate(paired.token), false);
    assert.equal(store.records("device-public").length, 0);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
