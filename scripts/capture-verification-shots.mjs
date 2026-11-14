import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { Store } from "../packages/host/dist/storage/store.js";
import { SessionService } from "../packages/host/dist/session-service.js";
import { createHostHandler } from "../packages/host/dist/http/server.js";

const outDir =
  "C:/Users/admin/.gemini/antigravity/brain/caf3214e-ad51-4064-be34-697d7f06adc8/screenshots";
mkdirSync(outDir, { recursive: true });

const dataDir = resolve(`.local/verification/visual-${Date.now()}`);
mkdirSync(dataDir, { recursive: true });

const store = new Store(join(dataDir, "state.sqlite"));
const service = new SessionService(store, { dataDir });
const server = createServer();
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
server.on("request", createHostHandler(service, { port, webRoot: resolve("apps/web/dist") }));

const url = `http://127.0.0.1:${port}`;
console.log(`Test server running at ${url}`);

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();

try {
  // 1. Visit root -> shows Onboarding SetupWizard
  await page.goto(url);
  await page.waitForTimeout(1500);

  // If splash screen is showing, wait for it or click enter
  const bypassBtn = page.getByRole("button", { name: "先进入工作台" });
  if (await bypassBtn.isVisible().catch(() => false)) {
    // If bypass is visible, let's see
  }

  // Check if onboarding setup wizard is visible
  const skipBtn = page.getByRole("button", { name: "跳过引导" });
  if (await skipBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log("Onboarding step 1/2 visible, capturing onboarding...");
    await page.screenshot({
      path: join(outDir, "verification-onboarding-step1.png"),
      fullPage: false,
    });

    // Advance to step 2 to see the Kooyu engine card with mobius icon
    const nextBtn = page.getByText("跳过 API，先准备引擎");
    if (await nextBtn.isVisible().catch(() => false)) {
      await nextBtn.click();
      await page.waitForTimeout(600);
      await page.screenshot({
        path: join(outDir, "verification-onboarding-step2.png"),
        fullPage: false,
      });
    }

    // Skip onboarding to enter workbench
    const skipAllBtn = page.getByRole("button", { name: "跳过引导" });
    if (await skipAllBtn.isVisible().catch(() => false)) {
      await skipAllBtn.click();
    }
  }

  // 2. Wait for workbench
  await page.getByText("Host 已连接", { exact: true }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);

  // Capture workbench in light mode showing unified 52px header and hairline
  console.log("Capturing workbench light mode...");
  await page.screenshot({
    path: join(outDir, "verification-workbench-light.png"),
    fullPage: false,
  });

  // Switch to dark mode
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-theme", "dark");
  });
  await page.waitForTimeout(500);

  console.log("Capturing workbench dark mode...");
  await page.screenshot({
    path: join(outDir, "verification-workbench-dark.png"),
    fullPage: false,
  });

  // 3. Switch back to light mode and create a session
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-theme", "light");
  });

  // Create a new session via API and simulate running state
  const sessionRes = await page.request.post(`${url}/api/sessions`, {
    data: {
      title: "Möbius 动效验证",
      harnessId: "kodo",
      kind: "supervisor",
    },
  });
  const session = await sessionRes.json();

  // Set running state and add an event
  service.store.transaction(() => {
    service.store.saveSession({
      ...service.store.session(session.id),
      runState: "running",
    });
    service.store.append({
      id: "evt-user-msg",
      sessionId: session.id,
      type: "message",
      payload: { role: "user", content: "请优化界面动效与边框" },
      createdAt: new Date().toISOString(),
    });
  });

  // Reload page to pick up the session in sidebar
  await page.goto(url);
  await page.getByText("Host 已连接", { exact: true }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);

  // Click on the session in the sidebar
  const sessionItem = page.getByText("Möbius 动效验证").first();
  await sessionItem.waitFor({ timeout: 5000 });
  await sessionItem.click();
  await page.waitForTimeout(800);

  console.log("Capturing chat mobius waiting state...");
  await page.screenshot({
    path: join(outDir, "verification-chat-mobius-waiting.png"),
    fullPage: false,
  });

  console.log("All screenshots captured successfully!");
} finally {
  await browser.close();
  server.close();
}
