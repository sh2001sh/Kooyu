// Capture persisted, previously verified native output without another model call.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
const root = resolve(".local/verification"),
  name = readdirSync(root)
    .filter((x) => x.startsWith("live-ui-"))
    .sort()
    .at(-1);
if (!name) throw new Error("Run verify:live-ui first");
const data = join(root, name),
  report = JSON.parse(readFileSync(join(data, "report.json"), "utf8")),
  port = "4324",
  url = `http://127.0.0.1:${port}`;
const host = spawn(process.execPath, ["packages/host/dist/main.js"], {
  env: { ...process.env, KODO_HOST_PORT: port, KODO_DATA_DIR: data },
  stdio: "ignore",
  windowsHide: true,
});
let browser;
mkdirSync(".impeccable/review", { recursive: true });
try {
  let ready = false;
  for (let n = 0; n < 80; n++) {
    try {
      if ((await fetch(url + "/api/health")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!ready) throw new Error("Host not ready");
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.goto(url);
  await page.getByText("Codex 原生对话", { exact: true }).click();
  await page.locator(".assistant-turn").filter({ hasText: "KODO_NATIVE_UI_OK" }).waitFor();
  await page.getByRole("textbox", { name: "消息", exact: true }).focus();
  await page.screenshot({ path: ".impeccable/review/desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".impeccable/review/mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole("button", { name: "Harness 与配置", exact: true }).click();
  await page
    .locator(".health-row")
    .filter({ has: page.locator("summary strong", { hasText: "Codex" }) })
    .locator("summary")
    .click();
  await page
    .locator(".health-row[open] dd")
    .filter({ hasText: "已通过原生单轮对话及双视口 UI" })
    .waitFor();
  await page.screenshot({ path: ".impeccable/review/capabilities.png", fullPage: true });
  console.log("Captured persisted native session " + report.nativeSessionId);
} finally {
  if (browser) await browser.close();
  host.kill("SIGTERM");
}
