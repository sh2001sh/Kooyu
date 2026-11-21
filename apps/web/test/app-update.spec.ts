import { expect, test, type TestInfo } from "@playwright/test";
import { join } from "node:path";

function shotPath(info: TestInfo, name: string): string {
  return process.env.HIG_SHOT_DIR ? join(process.env.HIG_SHOT_DIR, name) : info.outputPath(name);
}

test.describe("In-app software update flow", () => {
  test("Settings -> 通用 -> 软件更新 checks release, downloads with SHA-256 verification and launches installer at 1440px & 390px", async ({
    page,
  }, info) => {
    let phase: "idle" | "available" | "downloading" | "ready" | "installing" = "idle";
    let installCalled = 0;

    const releasePayload = {
      tag: "v0.3.0",
      version: "0.3.0",
      buildNumber: null,
      prerelease: false,
      title: "Kooyu 0.3.0",
      notes: "- 支持应用内一键检查、SHA-256 校验与升级安装\n- 新增全端语音输入与多语言切换",
      publishedAt: "2026-11-19T12:00:00Z",
      htmlUrl: "https://github.com/sh2001sh/Kooyu/releases/tag/v0.3.0",
      assets: [
        {
          name: "Kooyu-Setup-0.3.0.exe",
          downloadUrl:
            "https://github.com/sh2001sh/Kooyu/releases/download/v0.3.0/Kooyu-Setup-0.3.0.exe",
          size: 88_400_000,
          sha256: "a".repeat(64),
          platform: "windows",
        },
        {
          name: "Kooyu-0.3.0-android-debug.apk",
          downloadUrl:
            "https://github.com/sh2001sh/Kooyu/releases/download/v0.3.0/Kooyu-0.3.0-android-debug.apk",
          size: 24_100_000,
          sha256: "b".repeat(64),
          platform: "android",
        },
      ],
      recommendedAsset: {
        name: "Kooyu-Setup-0.3.0.exe",
        downloadUrl:
          "https://github.com/sh2001sh/Kooyu/releases/download/v0.3.0/Kooyu-Setup-0.3.0.exe",
        size: 88_400_000,
        sha256: "a".repeat(64),
        platform: "windows",
      },
      androidAsset: {
        name: "Kooyu-0.3.0-android-debug.apk",
        downloadUrl:
          "https://github.com/sh2001sh/Kooyu/releases/download/v0.3.0/Kooyu-0.3.0-android-debug.apk",
        size: 24_100_000,
        sha256: "b".repeat(64),
        platform: "android",
      },
    };

    const makeStatus = () => ({
      currentVersion: "0.2.1",
      platform: "win32",
      arch: "x64",
      channel: "stable",
      autoCheck: true,
      repository: "sh2001sh/Kooyu",
      state: phase === "idle" ? "up-to-date" : "available",
      checkedAt: "2026-11-19T12:30:00Z",
      updateAvailable: phase !== "idle",
      latest: phase === "idle" ? null : releasePayload,
      error: null,
      download:
        phase === "downloading"
          ? {
              state: "downloading",
              tag: "v0.3.0",
              assetName: "Kooyu-Setup-0.3.0.exe",
              downloadedBytes: 44_200_000,
              totalBytes: 88_400_000,
              localPath: null,
              sha256Verified: false,
              error: null,
            }
          : phase === "ready" || phase === "installing"
            ? {
                state: phase,
                tag: "v0.3.0",
                assetName: "Kooyu-Setup-0.3.0.exe",
                downloadedBytes: 88_400_000,
                totalBytes: 88_400_000,
                localPath: "C:/tmp/Kooyu-Setup-0.3.0.exe",
                sha256Verified: true,
                error: null,
              }
            : {
                state: "idle",
                tag: null,
                assetName: null,
                downloadedBytes: 0,
                totalBytes: null,
                localPath: null,
                sha256Verified: false,
                error: null,
              },
    });

    await page.route("**/api/app-update", async (route) => {
      if (phase === "downloading") phase = "ready";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(makeStatus()),
      });
    });

    await page.route("**/api/app-update/check", async (route) => {
      phase = "available";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(makeStatus()),
      });
    });

    await page.route("**/api/app-update/download", async (route) => {
      phase = "downloading";
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify(makeStatus()),
      });
    });

    await page.route("**/api/app-update/install", async (route) => {
      installCalled += 1;
      phase = "installing";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          launched: true,
          localPath: "C:/tmp/Kooyu-Setup-0.3.0.exe",
          message: "已启动 Kooyu 安装程序，请按提示完成升级。",
        }),
      });
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page
      .getByRole("navigation", { name: "配置导航", exact: true })
      .getByRole("button", { name: "通用", exact: true })
      .click();

    await expect(page.getByRole("heading", { name: "软件更新" })).toBeVisible();
    await page.getByRole("button", { name: "检查更新", exact: true }).click();

    await expect(page.getByText("发现新版本 v0.3.0")).toBeVisible();
    await expect(page.getByText("Kooyu-Setup-0.3.0.exe")).toBeVisible();

    await page.getByRole("button", { name: "下载更新", exact: true }).click();
    await expect(page.getByRole("button", { name: "立即安装更新", exact: true })).toBeVisible();
    await expect(page.getByText("SHA-256 已校验")).toBeVisible();

    await page.waitForTimeout(250);
    await page.screenshot({ path: shotPath(info, "app-update-1440.png"), fullPage: false });

    // Verify 390px mobile zero horizontal overflow
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);
    await page.screenshot({ path: shotPath(info, "app-update-390.png"), fullPage: false });

    await page.getByRole("button", { name: "立即安装更新", exact: true }).click();
    await expect(page.getByText("已启动 Kooyu 安装程序，请按提示完成升级。")).toBeVisible();
    expect(installCalled).toBe(1);
  });
});
