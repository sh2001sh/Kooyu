import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

test.use({ locale: "zh-CN" });

const SCREENSHOT_DIR =
  process.env.KOOYU_SCREENSHOT_DIR ?? resolve("test-results", "desktop-borders");

test("desktop borders verification - light & dark", async ({ page, request }) => {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.setViewportSize({ width: 1360, height: 850 });

  // 1. Create a session with some conversation events to see the full desktop chrome
  const sessionRes = await request.post("/api/sessions", {
    data: {
      title: "Desktop 边框设计验收",
      harnessId: "deepseek-harness",
      kind: "direct",
    },
  });
  expect(sessionRes.ok()).toBe(true);
  const session = await sessionRes.json();

  // Send a message
  await request.post(`/api/sessions/${session.id}/events`, {
    data: {
      type: "message",
      source: "user",
      content: "请分析当前桌面端边框与层级设计的美观度",
    },
  });
  await request.post(`/api/sessions/${session.id}/events`, {
    data: {
      type: "message",
      source: "assistant",
      content:
        "桌面端已采用原生边缘对齐分割布局（Edge-to-Edge Split View），消除了顶部双重横向分割线的层叠干扰，统一了毛玻璃标题栏与状态指示条，左右窗格的分割线亦经过精准对齐优化。",
    },
  });

  // Navigate to this session via localStorage
  await page.addInitScript((id) => {
    localStorage.setItem("kodo.session", id);
  }, session.id);

  await page.goto("/");
  await expect(page.getByText("Host 已连接", { exact: true })).toBeVisible({ timeout: 15000 });

  // Click on the session in the sidebar if not already active
  const sessionItem = page.getByText("Desktop 边框设计验收").first();
  await expect(sessionItem).toBeVisible({ timeout: 10000 });
  await sessionItem.click();

  // Wait for chat header to appear
  await expect(page.locator(".chat-header")).toBeVisible({ timeout: 10000 });

  // Wait for rendering
  await page.waitForTimeout(1000);

  // Screenshot 1: Desktop light chat view
  await page.screenshot({
    path: resolve(SCREENSHOT_DIR, "desktop-borders-light.png"),
    fullPage: false,
  });

  // Screenshot 2: Resizer hover state
  const resizer = page.locator(".sidebar-resizer");
  await resizer.hover();
  await page.waitForTimeout(300);
  await page.screenshot({
    path: resolve(SCREENSHOT_DIR, "desktop-borders-resizer-hover.png"),
    fullPage: false,
  });

  // Toggle Dark Mode
  const themeToggle = page.locator(".theme-toggle");
  await themeToggle.click();
  await page.waitForTimeout(800);

  // Screenshot 3: Desktop dark chat view
  await page.screenshot({
    path: resolve(SCREENSHOT_DIR, "desktop-borders-dark.png"),
    fullPage: false,
  });

  // Switch back to light mode for settings
  await themeToggle.click();
  await page.waitForTimeout(500);

  // Navigate to Settings
  await page.getByRole("button", { name: "设置" }).click();
  await expect(page.locator(".sx-page")).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(600);

  // Screenshot 4: Desktop settings view
  await page.screenshot({
    path: resolve(SCREENSHOT_DIR, "desktop-borders-settings.png"),
    fullPage: false,
  });
});
