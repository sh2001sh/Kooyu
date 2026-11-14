import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { HARNESS_IDS } from "@kodo/protocol";
import { desktopInstallations, bundledLaunch } from "../src/harnesses/desktop-installations.js";
import { readAsarText, asarContains } from "../src/harnesses/asar.js";
import { executable } from "../src/harnesses/rpc.js";
import {
  resolveInstallation,
  resolveInstallationModes,
  launchDefaults,
} from "../src/configuration/config.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "kodo-desktop-contract-"));
  const put = (relative: string, data = "synthetic installation metadata") => {
    const path = join(root, relative);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, data);
    return path;
  };
  return { root, put, close: () => rmSync(root, { recursive: true, force: true }) };
}
function archive(path: string, files: Record<string, string>) {
  const tree: any = { files: {} };
  const chunks: Buffer[] = [];
  let offset = 0;
  for (const [name, value] of Object.entries(files)) {
    const parts = name.split("/");
    let node = tree;
    for (const part of parts.slice(0, -1)) node = node.files[part] ??= { files: {} };
    const chunk = Buffer.from(value);
    node.files[parts.at(-1)!] = { size: chunk.length, offset: String(offset) };
    chunks.push(chunk);
    offset += chunk.length;
  }
  const json = Buffer.from(JSON.stringify(tree));
  const size = 8 + Math.ceil((4 + json.length) / 4) * 4;
  const header = Buffer.alloc(8 + size);
  header.writeUInt32LE(4, 0);
  header.writeUInt32LE(size, 4);
  header.writeUInt32LE(size - 4, 8);
  header.writeUInt32LE(json.length, 12);
  json.copy(header, 16);
  writeFileSync(path, Buffer.concat([header, ...chunks]));
}

test("all ten native harnesses and Kodo recognize desktop-only installation records", () => {
  const f = fixture();
  const names = [
    "Kodo",
    "pi",
    "OpenAI Codex",
    "Claude",
    "DeepSeek Harness",
    "ZCode",
    "OpenCode",
    "Gemini",
    "Cursor",
    "Kimi Code",
    "Grok Build",
  ];
  try {
    HARNESS_IDS.forEach((id, i) => {
      const found = desktopInstallations(id, undefined, [
        { name: names[i]!, path: f.root, version: "synthetic-1" },
      ]);
      assert.ok(
        found.some((a) => a.path === f.root && a.version === "synthetic-1"),
        id,
      );
      const selected = desktopInstallations(id, f.root, [
        { name: names[i]!, path: f.root, version: "synthetic-1" },
      ]);
      assert.equal(
        selected[0]?.version,
        "synthetic-1",
        "explicit path preserves installed version metadata",
      );
    });
  } finally {
    f.close();
  }
});

test("desktop GUI alone is detected without inventing a native command or requiring a PATH CLI", () => {
  const f = fixture();
  try {
    f.put("Cursor.exe");
    const desktop = { name: "Cursor", path: f.root, version: "synthetic" };
    const result = resolveInstallation("cursor", undefined, [desktop], () => null);
    assert.equal(result.desktops.length, 1);
    assert.equal(result.ready, false);
    assert.match(result.reason!, /已发现.*桌面版/);
    assert.equal(bundledLaunch("cursor", desktop, ["acp"]), null);
    // An editor's GUI/terminal launcher is not cursor-agent.
    f.put("resources/bin/cursor.exe");
    assert.equal(bundledLaunch("cursor", desktop, ["acp"]), null);
  } finally {
    f.close();
  }
});

test("Cursor uses the current agent command and accepts the older cursor-agent alias", () => {
  assert.equal(launchDefaults.cursor.command, "agent");
  for (const command of ["agent", "cursor-agent"]) {
    const result = resolveInstallation("cursor", undefined, [], (candidate) =>
      candidate === command ? candidate : null,
    );
    assert.equal(result.ready, true);
    assert.equal(result.launch.command, command);
    assert.deepEqual(result.launch.args, ["acp"]);
  }
});

test("desktop runtime selection respects explicit overrides, preference and bundled ZCode config", () => {
  const f = fixture();
  try {
    const resources = process.platform === "darwin" ? "Contents/Resources" : "resources";
    const entry = f.put(`${resources}/glm/zcode.cjs`);
    const config = f.put(`${resources}/config/provider/zcode-builtin.json`, "{}");
    const desktop = { name: "ZCode", path: f.root, version: "synthetic" };
    const finder = (command: string) => command;
    const automatic = resolveInstallation("zcode", undefined, [desktop], finder);
    assert.equal(automatic.launch.source, "cli");
    const bundled = resolveInstallation("zcode", { preferDesktop: true }, [desktop], finder);
    assert.equal(bundled.launch.source, "desktop-bundled");
    assert.equal(bundled.launch.args[0], entry);
    assert.equal(bundled.launch.env?.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE, config);
    assert.deepEqual(bundled.launch.args.slice(1), launchDefaults.zcode.args);
    const explicit = resolveInstallation(
      "zcode",
      { command: "chosen-native", args: ["stdio"], preferDesktop: true },
      [desktop],
      finder,
    );
    assert.equal(explicit.launch.command, "chosen-native");
    assert.equal(explicit.launch.source, "configured");
    const absent = resolveInstallation(
      "zcode",
      { command: "missing", args: [] },
      [desktop],
      () => null,
    );
    assert.equal(absent.ready, false);
    assert.match(absent.launch.unavailableReason!, /用户指定/);
    assert.throws(() => resolveInstallation("zcode", { preferDesktop: "yes" }, [], finder));
  } finally {
    f.close();
  }
});

test("installed ASAR metadata stays in place, refreshes after update and selects native desktop bridges", () => {
  const f = fixture();
  try {
    const path = f.put("resources/app.asar");
    const desktop = { name: "Synthetic desktop", path: f.root, version: null };
    const exe = process.platform === "darwin" ? "Contents/MacOS/OpenCode" : "OpenCode.exe";
    f.put(exe);
    // Native chunk existence is metadata-only, independent of the text read size limit.
    archive(path, {
      "out/main/sidecar.js": 'await import("./chunks/native.js")',
      "out/main/chunks/native.js": "export const Server = {};",
    });
    assert.equal(asarContains(path, "out/main/chunks/native.js"), true);
    assert.equal(readAsarText(path, "out/main/chunks/native.js", 4), null);
    if (process.platform !== "darwin") {
      const open = bundledLaunch("opencode", desktop, ["serve"]);
      assert.equal(open?.source, "desktop-bundled");
      assert.equal(open?.env?.ELECTRON_RUN_AS_NODE, "1");
      assert.ok(open?.args.at(-1)?.endsWith(join("out", "main", "chunks", "native.js")));
      archive(path, {
        "dsh/node_modules/@deepseek-ai/dsh-desktop-host/package.json":
          '{"name":"synthetic-updated"}',
      });
      f.put("DeepSeek Harness.exe");
      assert.equal(asarContains(path, "out/main/sidecar.js"), false);
      const dsh = bundledLaunch("deepseek-harness", desktop, ["--profile", "sdk"]);
      assert.equal(dsh?.source, "desktop-bundled");
      assert.ok(dsh?.args[1]?.endsWith(join("lib", "cli.js")));
    }
  } finally {
    f.close();
  }
});

test("bundled Codex resolves a native binary while SDK fallback remains independent of a desktop login", () => {
  const f = fixture();
  try {
    const native = f.put(`bin/build-synthetic/codex${process.platform === "win32" ? ".exe" : ""}`);
    const desktop = { name: "Codex", path: f.root, version: null };
    const result = resolveInstallation("codex", undefined, [desktop], (cmd) =>
      cmd === native ? cmd : null,
    );
    assert.equal(result.ready, true);
    assert.equal(result.launch.source, "desktop-bundled");
    for (const id of ["pi", "kodo", "claude-code"] as const) {
      const sdk = resolveInstallation(id, undefined, [], () => null);
      assert.equal(sdk.ready, true);
      assert.equal(sdk.launch.source, "sdk");
    }
  } finally {
    f.close();
  }
});

test("each harness reports CLI-only and desktop-only entrypoints independently", () => {
  const f = fixture();
  const sdkIds = new Set(["kodo", "pi", "claude-code"]);
  try {
    for (const id of HARNESS_IDS) {
      const desktop = { name: id, path: f.root, version: "synthetic" };
      const command = launchDefaults[id].command;
      const find = (value: string) =>
        value === command || (isAbsolute(value) && value.startsWith(f.root) && value !== f.root)
          ? value
          : value === process.execPath
            ? value
            : null;
      const withoutBundled = resolveInstallationModes(id, [desktop], find);
      assert.equal(withoutBundled.cliOnly.launchable, true, id);
      assert.equal(withoutBundled.cliOnly.source, sdkIds.has(id) ? "sdk" : "cli", id);
      assert.equal(withoutBundled.desktopOnly.launchable, sdkIds.has(id), id);
      assert.equal(withoutBundled.desktopOnly.source, sdkIds.has(id) ? "sdk" : null, id);
      if (sdkIds.has(id)) continue;
      const bin = id === "cursor" ? "cursor-agent" : command;
      const resources = process.platform === "darwin" ? "Contents/Resources" : "resources";
      f.put(`${resources}/bin/${bin}${process.platform === "win32" ? ".exe" : ""}`);
      const withBundled = resolveInstallationModes(id, [desktop], find);
      assert.equal(withBundled.desktopOnly.launchable, true, id);
      assert.equal(withBundled.desktopOnly.source, "desktop-bundled", id);
      const noCli = resolveInstallationModes(id, [desktop], (value) =>
        isAbsolute(value) ? find(value) : null,
      );
      assert.equal(noCli.cliOnly.launchable, false, id);
      assert.equal(noCli.desktopOnly.launchable, true, id);
    }
  } finally {
    f.close();
  }
});

test("a directory is never reported as a runnable CLI entrypoint", () => {
  const f = fixture();
  try {
    assert.equal(executable(f.root), null);
  } finally {
    f.close();
  }
});
