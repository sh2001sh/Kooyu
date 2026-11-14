import { _electron as electron } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { electronEnvironment } from "./electron-environment.mjs";
import { resolveElectronRuntime } from "./electron-runtime.mjs";

const outDir =
  "C:/Users/admin/.gemini/antigravity/brain/caf3214e-ad51-4064-be34-697d7f06adc8/screenshots";
mkdirSync(outDir, { recursive: true });

const data = resolve(`.local/verification/desktop-verify-${Date.now()}`);
mkdirSync(data, { recursive: true });
const port = "4329";

const runtime = await resolveElectronRuntime();
console.log("Using Electron runtime:", runtime.path);

const app = await electron.launch({
  executablePath: runtime.path,
  args: [resolve("apps/desktop")],
  env: {
    ...electronEnvironment(),
    KODO_DATA_DIR: data,
    KODO_HOST_PORT: port,
  },
  timeout: 45000,
});

try {
  const page = await app.firstWindow({ timeout: 30000 });
  await page.waitForTimeout(2000);

  // 1. Screenshot Onboarding SetupWizard in Desktop Electron
  console.log("Capturing desktop onboarding...");
  await page.screenshot({
    path: join(outDir, "desktop-app-onboarding-step1.png"),
  });

  // Next step to see Kooyu agent card
  const nextBtn = page.getByText("跳过 API，先准备引擎");
  if (await nextBtn.isVisible().catch(() => false)) {
    await nextBtn.click();
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: join(outDir, "desktop-app-onboarding-step2.png"),
    });
  }

  // Click "跳过引导" to enter workbench
  const skipBtn = page.getByRole("button", { name: "跳过引导" });
  if (await skipBtn.isVisible().catch(() => false)) {
    await skipBtn.click();
    await page.waitForTimeout(1500);
  }

  // Wait for Host connected in workbench
  await page.getByText("Host 已连接", { exact: true }).waitFor({ timeout: 20000 });
  await page.waitForTimeout(1000);

  // 2. Capture desktop workbench light mode
  console.log("Capturing desktop workbench light mode...");
  await page.screenshot({
    path: join(outDir, "desktop-app-workbench-light.png"),
  });

  // Switch to dark mode via UI theme toggle button
  const themeToggle = page.locator(".theme-toggle").first();
  if (await themeToggle.isVisible().catch(() => false)) {
    await themeToggle.click();
    await page.waitForTimeout(800);
  } else {
    await page.evaluate(() => {
      document.documentElement.setAttribute("data-theme", "dark");
    });
    await page.waitForTimeout(800);
  }

  console.log("Capturing desktop workbench dark mode...");
  await page.screenshot({
    path: join(outDir, "desktop-app-workbench-dark.png"),
  });

  // 3. Switch back to light mode and send a message to capture Möbius spinner in desktop app
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-theme", "light");
  });
  await page.waitForTimeout(500);

  const composer = page.locator("textarea, input[placeholder*='问问 Kooyu']").first();
  if (await composer.isVisible().catch(() => false)) {
    await composer.fill("为桌面端边框和顶部栏优化");
    const sendBtn = page
      .locator(
        "button.composer-submit, button[aria-label*='发送'], button.composer__send, .composer-bar button",
      )
      .last();
    if (await sendBtn.isVisible().catch(() => false)) {
      await sendBtn.click();
      await page.waitForTimeout(400);
      console.log("Capturing desktop chat mobius animation...");
      await page.screenshot({
        path: join(outDir, "desktop-app-chat-mobius.png"),
      });
    }
  }

  console.log("Desktop app verification screenshots completed successfully!");
} finally {
  await app.close().catch(() => {});
}
