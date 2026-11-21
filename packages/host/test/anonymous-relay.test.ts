import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RelayConnector } from "../src/devices/relay.js";

test("remote access requires an account service before enrollment", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kooyu-unbound-host-"));
  const connector = new RelayConnector(dir, "https://relay.example.org", false, {
    getPassword: () => null,
    setPassword: () => {},
  });
  connector.requireAccount();
  try {
    await assert.rejects(connector.enable(), /账号服务/);
    assert.equal(connector.status().enabled, false);
  } finally {
    connector.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
