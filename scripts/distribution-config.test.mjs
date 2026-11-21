import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stageDistribution } from "./distribution-config.mjs";

test("source builds need no official service, official artifacts must inject a clean public origin", async () => {
  const root = await mkdtemp(join(tmpdir(), "kooyu-distribution-"));
  try {
    await stageDistribution(root, {});
    await assert.rejects(readFile(join(root, "distribution.json")), { code: "ENOENT" });
    await assert.rejects(stageDistribution(root, { KOOYU_OFFICIAL_RELEASE: "1" }), /requires/);
    for (const origin of [
      "http://example.com",
      "https://example.com/path",
      "https://user:secret@example.com",
      "https://example.com/?token=secret",
    ])
      await assert.rejects(stageDistribution(root, { KOOYU_OFFICIAL_RELAY_ORIGIN: origin }));
    const env = {
      KOOYU_OFFICIAL_RELEASE: "1",
      KOOYU_OFFICIAL_RELAY_ORIGIN: "https://relay.example.com",
    };
    await assert.rejects(stageDistribution(root, env), /ACCOUNT_ORIGIN/);
    await stageDistribution(root, {
      ...env,
      KOOYU_OFFICIAL_ACCOUNT_ORIGIN: "https://account.example.com",
    });
    assert.deepEqual(JSON.parse(await readFile(join(root, "distribution.json"), "utf8")), {
      schema: 1,
      accountOrigin: "https://account.example.com",
      relay: { origin: "https://relay.example.com", protocol: 2 },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
