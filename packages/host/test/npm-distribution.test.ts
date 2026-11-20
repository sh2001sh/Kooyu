import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Store } from "../src/storage/store.js";
import { AppUpdater } from "../src/updater.js";

test("npm Host never checks, downloads or launches desktop installers", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kooyu-npm-update-"));
  const store = new Store(join(dir, "test.sqlite"));
  const previous = process.env.KOOYU_DISTRIBUTION;
  process.env.KOOYU_DISTRIBUTION = "npm";
  let updater: AppUpdater;
  try {
    updater = new AppUpdater(store, dir, {
      currentVersion: "0.2.1",
      fetcher: async () => assert.fail("npm edition must not contact desktop release endpoints"),
      launcher: () => assert.fail("npm edition must not launch a desktop installer"),
    });
  } finally {
    if (previous === undefined) delete process.env.KOOYU_DISTRIBUTION;
    else process.env.KOOYU_DISTRIBUTION = previous;
  }
  try {
    const status = await updater.check();
    assert.equal(status.distribution, "npm");
    assert.equal(status.updateCommand, "npm install -g kooyu@latest");
    assert.equal(status.autoCheck, false);
    assert.equal(status.updateAvailable, false);
    assert.equal(status.latest, null);
    assert.equal(status.download.localPath, null);
    await assert.rejects(updater.startDownload(), /npm install/);
    await assert.rejects(updater.install(), /npm install/);
  } finally {
    updater.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
