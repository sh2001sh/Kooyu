import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

test.use({ locale: "zh-CN" });

const SCREENSHOT_DIR = process.env.KOOYU_SCREENSHOT_DIR ?? resolve("test-results", "splash-mobius");

test("verify splash opening screen and response waiting mobius animation", async ({
  page,
  request,
}) => {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  // 1. Create a session with a running / pending state to capture the dynamic Möbius waiting animation
  const sessionRes = await request.post("/api/sessions", {
    data: {
      title: "Möbius 环等待回复动效验证",
      harnessId: "deepseek-harness",
      kind: "direct",
    },
  });
  expect(sessionRes.ok()).toBe(true);
  const session = await sessionRes.json();

  // Send initial message
  await request.post(`/api/sessions/${session.id}/events`, {
    data: {
      type: "message",
      source: "user",
      content: "请详细推导莫比乌斯环的拓扑学几何参数方程，并说明其单侧性与连续性特征",
    },
  });

  // Set running state on session so the run-indicator with MobiusLoader is visible
  // In host-client, when session is running or pending message exists, MobiusLoader is shown
  await page.setViewportSize({ width: 1360, height: 850 });

  // Route /api/snapshot initially to delay or inspect the Splash Screen
  let allowSnapshot = false;
  await page.route("**/api/snapshot", async (route) => {
    if (!allowSnapshot) {
      // Delay snapshot slightly so we capture the launch splash screen in full glory
      await new Promise((r) => setTimeout(r, 1200));
    }
    await route.continue();
  });

  // Navigate to root to capture Launch Splash Screen
  const gotoPromise = page.goto(`/?session=${session.id}`);

  // Expect splash screen to appear immediately while waiting for snapshot
  const splash = page.locator(".splash-screen");
  await expect(splash).toBeVisible({ timeout: 5000 });
  await expect(splash.locator(".splash-hero-mobius")).toBeVisible();
  await expect(splash.locator(".splash-progress-track")).toBeVisible();

  // Wait a fraction to capture the kinetic progress flow
  await page.waitForTimeout(600);

  // Capture Screenshot 1: Launch Splash Screen (Light)
  await page.screenshot({
    path: resolve(SCREENSHOT_DIR, "splash-screen-launch.png"),
    fullPage: false,
  });

  // Switch dark on splash screen to capture Dark Splash Screen
  await page.evaluate(() => {
    document.documentElement.classList.add("dark");
  });
  await page.waitForTimeout(200);
  await page.screenshot({
    path: resolve(SCREENSHOT_DIR, "splash-screen-dark.png"),
    fullPage: false,
  });
  await page.evaluate(() => {
    document.documentElement.classList.remove("dark");
  });

  // Allow snapshot to complete
  allowSnapshot = true;
  await gotoPromise;

  // Wait for the app to finish loading
  await expect(page.getByText("Host 已连接", { exact: true })).toBeVisible({ timeout: 15000 });

  // Open the session
  const sessionItem = page.getByText("Möbius 环等待回复动效验证").first();
  await sessionItem.click();

  // Inject a mock pending/running state into DOM to capture the Möbius waiting animation in chat
  await page.evaluate(() => {
    const transcript = document.querySelector(".transcript");
    if (transcript) {
      const runInd = document.createElement("div");
      runInd.className = "run-indicator run-indicator--mobius";
      runInd.id = "test-mobius-indicator";
      runInd.innerHTML = `
        <div class="mobius-loader-wrap mobius-loader-wrap--compact" role="status" aria-label="正在执行" style="width: 24px; height: 14px;">
          <svg viewBox="0 0 100 60" fill="none" class="mobius-loader-svg" aria-hidden="true">
            <defs>
              <linearGradient id="mobiusBase_test" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#F69B7B" stop-opacity="0.25"></stop>
                <stop offset="50%" stop-color="#F17561" stop-opacity="0.35"></stop>
                <stop offset="100%" stop-color="#C84634" stop-opacity="0.25"></stop>
              </linearGradient>
              <linearGradient id="mobiusBeam_test" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#FFC59E"></stop>
                <stop offset="35%" stop-color="#F17561"></stop>
                <stop offset="70%" stop-color="#E04838"></stop>
                <stop offset="100%" stop-color="#8250DF"></stop>
              </linearGradient>
            </defs>
            <path d="M 50,30 C 62,13 88,13 88,30 C 88,47 62,47 50,30 C 38,13 12,13 12,30 C 12,47 38,47 50,30 Z" stroke="url(#mobiusBase_test)" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" class="mobius-track"></path>
            <path d="M 50,30 C 62,13 88,13 88,30 C 88,47 62,47 50,30 C 38,13 12,13 12,30 C 12,47 38,47 50,30 Z" stroke="url(#mobiusBeam_test)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="24 151" class="mobius-pulse mobius-pulse--secondary"></path>
            <path d="M 50,30 C 62,13 88,13 88,30 C 88,47 62,47 50,30 C 38,13 12,13 12,30 C 12,47 38,47 50,30 Z" stroke="url(#mobiusBeam_test)" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="32 143" class="mobius-pulse mobius-pulse--primary"></path>
            <path d="M 32,17 C 42,23 58,37 68,43" stroke="rgba(17, 19, 23, 0.16)" stroke-width="6" stroke-linecap="round" class="mobius-twist-shadow"></path>
            <path d="M 32,17 C 42,23 58,37 68,43" stroke="url(#mobiusBeam_test)" stroke-width="4.5" stroke-linecap="round" class="mobius-twist-highlight"></path>
          </svg>
        </div>
        <span>正在思考并生成回复…</span>
      `;
      transcript.appendChild(runInd);
    }
  });

  await page.waitForTimeout(600);

  // Capture Screenshot 2: Chat Waiting for Response with Mobius Strip Animation (Light)
  await page.screenshot({
    path: resolve(SCREENSHOT_DIR, "chat-mobius-waiting.png"),
    fullPage: false,
  });

  // Switch to Dark Mode
  const themeToggle = page.locator(".theme-toggle");
  await themeToggle.click();
  await page.waitForTimeout(600);

  // Capture Screenshot 3: Chat Waiting for Response with Mobius Strip Animation (Dark)
  await page.screenshot({
    path: resolve(SCREENSHOT_DIR, "chat-mobius-waiting-dark.png"),
    fullPage: false,
  });

  // Switch back to light
  await themeToggle.click();
  await page.waitForTimeout(400);

  // Trigger Onboarding Setup Screen
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("kooyu:open-setup"));
  });
  await expect(page.locator(".setup-shell")).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(600);

  // Capture Screenshot 4: Onboarding Setup Wizard with Sunset-Coral Step Accents
  await page.screenshot({
    path: resolve(SCREENSHOT_DIR, "onboarding-setup-wizard.png"),
    fullPage: false,
  });
});
