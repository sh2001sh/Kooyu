// Live native Codex response rendered on desktop and phone. No mocked replies.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
const data = resolve(`.local/verification/live-ui-${Date.now()}`);
mkdirSync(data, { recursive: true });
mkdirSync(resolve("output/playwright"), { recursive: true });
const port = "4323",
  url = `http://127.0.0.1:${port}`,
  host = spawn(process.execPath, ["packages/host/dist/main.js"], {
    env: { ...process.env, KODO_DATA_DIR: data, KODO_HOST_PORT: port },
    windowsHide: true,
    stdio: "ignore",
  });
const api = async (path, body) => {
  const r = await fetch(url + "/api" + path, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const v = await r.json();
  if (!r.ok) throw new Error(v.error?.message);
  return v;
};
let browser;
const report = { result: "unverified", startedAt: new Date().toISOString() };
try {
  let ready = false;
  for (let n = 0; n < 80; n++) {
    try {
      await api("/health");
      ready = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  if (!ready) throw new Error("Host not ready");
  const project = await api("/projects", { name: "原生对话验证", rootPath: process.cwd() }),
    snapshot = await api("/snapshot"),
    workspace = snapshot.workspaces.find((w) => w.projectId === project.id);
  const session = await api("/sessions", {
    title: "Codex 原生对话",
    harnessId: "codex",
    kind: "direct",
    projectId: project.id,
    workspaceId: workspace.id,
  });
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.goto(url);
  await page.getByText("Codex 原生对话", { exact: true }).click();
  await page
    .getByRole("textbox", { name: "消息", exact: true })
    .fill("Reply exactly KODO_NATIVE_UI_OK. Do not use tools, read files, or modify anything.");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await page
    .locator(".assistant-turn")
    .filter({ hasText: "KODO_NATIVE_UI_OK" })
    .waitFor({ timeout: 90000 });
  report.sessionId = session.id;
  report.nativeSessionId = (await api("/snapshot")).sessions.find(
    (s) => s.id === session.id,
  ).nativeSessionId;
  await page.screenshot({ path: "output/playwright/live-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".assistant-turn").filter({ hasText: "KODO_NATIVE_UI_OK" }).waitFor();
  await page.screenshot({ path: "output/playwright/live-mobile.png", fullPage: true });
  report.mobileSameNativeSession = Boolean(report.nativeSessionId);
  report.overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  report.result = report.overflow ? "not-passed" : "passed";
} catch (error) {
  report.result = "failed";
  report.error = error.message;
} finally {
  if (browser) await browser.close();
  host.kill("SIGTERM");
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(data, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (report.result !== "passed") process.exitCode = 1;
}
