import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Store } from "../src/storage/store.js";
import {
  AppUpdater,
  classifyReleaseAsset,
  compareSemver,
  isReleaseNewer,
  parseReleaseTag,
  parseSha256Sums,
  pickRecommendedAsset,
} from "../src/updater.js";

test("updater helpers parse tags, semver, checksums and platform assets", () => {
  assert.deepEqual(parseReleaseTag("v0.3.0"), {
    version: "0.3.0",
    buildNumber: null,
    prerelease: false,
  });
  assert.deepEqual(parseReleaseTag("preview-0.3.0-42"), {
    version: "0.3.0",
    buildNumber: 42,
    prerelease: true,
  });
  assert.equal(compareSemver("0.3.0", "0.2.1"), 1);
  assert.equal(compareSemver("0.2.1", "0.2.1"), 0);
  assert.equal(compareSemver("0.2.0", "0.2.1"), -1);

  assert.equal(
    isReleaseNewer("0.2.1", { version: "0.3.0", prerelease: false, buildNumber: null }, "stable"),
    true,
  );
  assert.equal(
    isReleaseNewer("0.2.1", { version: "0.2.1", prerelease: false, buildNumber: null }, "stable"),
    false,
  );
  assert.equal(
    isReleaseNewer("0.2.1", { version: "0.2.1", prerelease: true, buildNumber: 18 }, "preview"),
    true,
  );

  assert.equal(classifyReleaseAsset("Kooyu-Setup-0.3.0.exe"), "windows");
  assert.equal(classifyReleaseAsset("Kooyu-0.3.0-arm64.dmg"), "macos-arm64");
  assert.equal(classifyReleaseAsset("Kooyu-0.3.0.dmg"), "macos-x64");
  assert.equal(classifyReleaseAsset("Kooyu-0.3.0-android-debug.apk"), "android");

  const sums = parseSha256Sums(
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  Kooyu-Setup-0.3.0.exe\n",
  );
  assert.equal(
    sums.get("Kooyu-Setup-0.3.0.exe"),
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  );

  const recommended = pickRecommendedAsset(
    [
      {
        name: "Kooyu-0.3.0-arm64.dmg",
        downloadUrl: "https://example.com/mac.dmg",
        size: 100,
        sha256: null,
        platform: "macos-arm64",
      },
      {
        name: "Kooyu-Setup-0.3.0.exe",
        downloadUrl: "https://example.com/win.exe",
        size: 100,
        sha256: null,
        platform: "windows",
      },
    ],
    "win32",
    "x64",
  );
  assert.equal(recommended?.name, "Kooyu-Setup-0.3.0.exe");
});

test("AppUpdater checks GitHub Releases, verifies SHA-256 on download, rejects tampering and launches installer", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kooyu-updater-"));
  const store = new Store(":memory:");
  const installerPayload = Buffer.from("fake-kooyu-nsis-installer-binary-v0.3.0");
  const validSha = createHash("sha256").update(installerPayload).digest("hex");
  let serveCorrupt = false;
  const launched: Array<{ path: string; platform: string }> = [];

  const mockFetch: typeof fetch = async (input) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("api.github.com/repos/") && url.includes("/releases")) {
      return new Response(
        JSON.stringify([
          {
            tag_name: "preview-0.4.0-9",
            name: "Kooyu 0.4.0 Preview",
            body: "Preview notes",
            draft: false,
            prerelease: true,
            published_at: "2026-11-19T12:00:00Z",
            html_url: "https://github.com/sh2001sh/kodo/releases/tag/preview-0.4.0-9",
            assets: [],
          },
          {
            tag_name: "v0.3.0",
            name: "Kooyu 0.3.0",
            body: "新增软件内自动升级与语音输入",
            draft: false,
            prerelease: false,
            published_at: "2026-11-19T10:00:00Z",
            html_url: "https://github.com/sh2001sh/kodo/releases/tag/v0.3.0",
            assets: [
              {
                name: "Kooyu-Setup-0.3.0.exe",
                browser_download_url:
                  "https://github.com/sh2001sh/kodo/releases/download/v0.3.0/Kooyu-Setup-0.3.0.exe",
                size: installerPayload.length,
              },
              {
                name: "Kooyu-0.3.0-android-debug.apk",
                browser_download_url:
                  "https://github.com/sh2001sh/kodo/releases/download/v0.3.0/Kooyu-0.3.0-android-debug.apk",
                size: 12345,
              },
              {
                name: "SHA256SUMS.txt",
                browser_download_url:
                  "https://github.com/sh2001sh/kodo/releases/download/v0.3.0/SHA256SUMS.txt",
                size: 120,
              },
            ],
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.endsWith("SHA256SUMS.txt")) {
      return new Response(`${validSha}  Kooyu-Setup-0.3.0.exe\n`, { status: 200 });
    }
    if (url.endsWith("Kooyu-Setup-0.3.0.exe")) {
      const body = serveCorrupt ? Buffer.from("tampered-bytes") : installerPayload;
      return new Response(body, {
        status: 200,
        headers: { "content-length": String(body.length) },
      });
    }
    return new Response("not found", { status: 404 });
  };

  const updater = new AppUpdater(store, dir, {
    fetcher: mockFetch,
    currentVersion: "0.2.1",
    platform: "win32",
    arch: "x64",
    launcher: (path, platform) => launched.push({ path, platform }),
  });

  try {
    // Stable channel ignores preview-0.4.0-9 and picks v0.3.0
    const checked = await updater.check({ channel: "stable" });
    assert.equal(checked.state, "available");
    assert.equal(checked.updateAvailable, true);
    assert.equal(checked.latest?.version, "0.3.0");
    assert.equal(checked.latest?.recommendedAsset?.sha256, validSha);
    assert.equal(checked.latest?.androidAsset?.name, "Kooyu-0.3.0-android-debug.apk");

    // Corrupt download is rejected by SHA-256 verification
    serveCorrupt = true;
    await updater.startDownload();
    for (let i = 0; i < 40 && updater.status().download.state !== "error"; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(updater.status().download.state, "error");
    assert.match(updater.status().download.error ?? "", /SHA-256/);

    // Valid download passes SHA-256 and becomes ready
    serveCorrupt = false;
    await updater.startDownload();
    for (let i = 0; i < 40 && updater.status().download.state !== "ready"; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    const ready = updater.status();
    assert.equal(ready.download.state, "ready");
    assert.equal(ready.download.sha256Verified, true);
    assert.ok(ready.download.localPath && existsSync(ready.download.localPath));

    // Install launches the verified file
    const installRes = await updater.install();
    assert.equal(installRes.launched, true);
    assert.equal(launched.length, 1);
    assert.equal(launched[0]!.platform, "win32");
  } finally {
    updater.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
