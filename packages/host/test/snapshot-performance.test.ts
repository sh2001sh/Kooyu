import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { descriptor, type HarnessAdapter } from "../src/harnesses/adapter.js";
import { refreshDesktopInstallations } from "../src/harnesses/desktop-installations.js";
import { nativeLaunch } from "../src/configuration/config.js";
import { SessionService } from "../src/session-service.js";
import { Store } from "../src/storage/store.js";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "kodo-snapshot-cache-"));
  const store = new Store(":memory:");
  const adapter: HarnessAdapter = {
    descriptor: descriptor("kodo", "Test", "sdk", [], "fixture", "partial"),
    async connect() {
      throw new Error("Snapshots must not open a native session");
    },
  };
  const service = new SessionService(store, { dataDir: directory, adapters: [adapter] });
  const entry = (name: string) => {
    const path = join(directory, name);
    writeFileSync(path, "synthetic executable metadata; never launched");
    chmodSync(path, 0o755);
    return path;
  };
  const configure = (command: string) =>
    writeFileSync(
      join(directory, "installations.json"),
      JSON.stringify({ kodo: { command, args: [] } }),
    );
  return {
    directory,
    service,
    store,
    entry,
    configure,
    async close() {
      await service.dispose();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("warm installation scans preserve live sessions and native configuration", async () => {
  const f = fixture();
  try {
    const first = f.service.snapshot();
    const health = first.harnesses[0]!.health;
    const session = f.service.createDraft({
      title: "immediate",
      harnessId: "kodo",
      kind: "supervisor",
    });
    f.store.saveSession({ ...session, title: "live update", runState: "running" });
    const config = first.harnesses[0]!.configFileLocations?.find((file) =>
      file.path.startsWith(join(f.directory, "kodo")),
    );
    assert.ok(config, "test config must be isolated in the temporary data directory");
    mkdirSync(join(config.path, ".."), { recursive: true });
    writeFileSync(config.path, JSON.stringify({ model: "fresh-model" }));
    const warm = f.service.snapshot();
    assert.equal(warm.harnesses[0]!.health, health, "expensive scans are reused");
    assert.equal(warm.sessions.find((s) => s.id === session.id)?.title, "live update");
    assert.equal(warm.sessions.find((s) => s.id === session.id)?.runState, "running");
    assert.ok(warm.harnesses[0]!.configFiles?.includes(config.path));
  } finally {
    await f.close();
  }
});

test("installation overrides invalidate cached health immediately, including deletion", async () => {
  const f = fixture();
  try {
    f.service.snapshot();
    const first = f.entry("first.exe");
    f.configure(first);
    assert.equal(f.service.snapshot().harnesses[0]!.health!.executable, first);
    const second = f.entry("second-longer.exe");
    f.configure(second);
    assert.equal(f.service.snapshot().harnesses[0]!.health!.executable, second);
    rmSync(join(f.directory, "installations.json"));
    assert.equal(f.service.snapshot().harnesses[0]!.health!.source, "sdk");
  } finally {
    await f.close();
  }
});

test("explicit refresh invalidates scans and native launches always validate afresh", async () => {
  const f = fixture();
  try {
    const command = f.entry("disappearing.exe");
    f.configure(command);
    assert.equal(f.service.snapshot().harnesses[0]!.health!.launchable, true);
    rmSync(command);
    assert.ok(nativeLaunch(f.directory, "kodo").unavailableReason);
    refreshDesktopInstallations();
    assert.equal(f.service.snapshot().harnesses[0]!.health!.launchable, false);
  } finally {
    await f.close();
  }
});

test("snapshot health expires after ten seconds and observes PATH changes immediately", async (t) => {
  const f = fixture();
  const originalPath = process.env.PATH;
  try {
    const command = f.entry("expired.exe");
    f.configure(command);
    const initial = f.service.snapshot().harnesses[0]!.health;
    process.env.PATH =
      (originalPath ?? "") + (process.platform === "win32" ? ";" : ":") + f.directory;
    assert.notEqual(f.service.snapshot().harnesses[0]!.health, initial);
    rmSync(command);
    const future = Date.now() + 10001;
    t.mock.method(Date, "now", () => future);
    assert.equal(f.service.snapshot().harnesses[0]!.health!.launchable, false);
  } finally {
    t.mock.restoreAll();
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    await f.close();
  }
});
