import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { HARNESS_IDS } from "@kodo/protocol";
import { nativeConfigFiles, nativeConfigLocations } from "../src/harnesses/native-defaults.js";

test("native paths preserve environment overrides and report missing files separately", () => {
  const root = mkdtempSync(join(tmpdir(), "kodo-config-locations-"));
  try {
    const config = join(root, "config.toml");
    assert.deepEqual(nativeConfigLocations("codex", { CODEX_HOME: root }, root), [
      { path: config, exists: false },
    ]);
    assert.deepEqual(nativeConfigFiles("codex", { CODEX_HOME: root }, root), []);
    writeFileSync(config, "synthetic config content; path discovery must not parse it");
    assert.deepEqual(nativeConfigFiles("codex", { CODEX_HOME: root }, root), [config]);
    const settings = join(root, "settings.json");
    mkdirSync(settings);
    assert.deepEqual(nativeConfigFiles("claude-code", { CLAUDE_CONFIG_DIR: root }, root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("every engine has a config location, including Grok defaults and isolated Kodo files", () => {
  const root = mkdtempSync(join(tmpdir(), "kodo-config-defaults-"));
  try {
    const kodoRoot = join(root, "host", "kodo");
    for (const id of HARNESS_IDS) {
      const locations = nativeConfigLocations(id, {}, kodoRoot, root);
      assert.ok(locations.length > 0, id);
      assert.ok(
        locations.every((file) => file.path.startsWith(root)),
        id,
      );
      assert.ok(
        locations.every((file) => !file.exists),
        id,
      );
    }
    const grok = join(root, ".grok", "config.toml");
    mkdirSync(dirname(grok), { recursive: true });
    writeFileSync(grok, "synthetic");
    assert.deepEqual(nativeConfigLocations("grok-build", {}, kodoRoot, root), [
      { path: grok, exists: true },
    ]);
    const models = join(kodoRoot, "models.json");
    mkdirSync(kodoRoot, { recursive: true });
    writeFileSync(models, "{}");
    assert.deepEqual(nativeConfigFiles("kodo", {}, kodoRoot), [models]);
    const cursor = join(root, "roaming", "Cursor", "User", "settings.json");
    mkdirSync(dirname(cursor), { recursive: true });
    writeFileSync(cursor, "{}");
    assert.deepEqual(
      nativeConfigLocations("cursor", { APPDATA: join(root, "roaming") }, kodoRoot, root),
      [{ path: cursor, exists: true }],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
