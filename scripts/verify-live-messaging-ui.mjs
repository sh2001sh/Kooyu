// Real Codex messages through the shipped desktop/phone web UI and Host API.
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const data = resolve(`.local/verification/live-messaging-ui-${Date.now()}`);
mkdirSync(data, { recursive: true });
mkdirSync(resolve("output/playwright"), { recursive: true });
const port = "4323",
  url = `http://127.0.0.1:${port}`;
const host = spawn(process.execPath, ["packages/host/dist/main.js"], {
  env: { ...process.env, KODO_DATA_DIR: data, KODO_HOST_PORT: port },
  windowsHide: true,
  stdio: "ignore",
});
const report = {
  startedAt: new Date().toISOString(),
  result: "unverified",
  checks: {},
  consoleErrors: [],
};
let browser;
async function api(path, body) {
  const response = await fetch(url + "/api" + path, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error?.message);
  return value;
}
async function until(check, timeout = 90000) {
  const deadline = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("Real UI verification deadline exceeded");
    await new Promise((r) => setTimeout(r, 50));
  }
}
function check(name, value) {
  report.checks[name] = Boolean(value);
  assert.ok(value, name);
}
try {
  await until(async () => {
    try {
      await api("/health");
      return true;
    } catch {
      return false;
    }
  }, 15000);
  const project = await api("/projects", {
    name: "Real UI messaging test",
    rootPath: process.cwd(),
  });
  const workspace = (await api("/snapshot")).workspaces.find((w) => w.projectId === project.id);
  const session = await api("/sessions", {
    title: "Codex 真实消息操作",
    harnessId: "codex",
    kind: "direct",
    projectId: project.id,
    workspaceId: workspace.id,
  });
  report.sessionId = session.id;
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.on("pageerror", (e) => report.consoleErrors.push(e.message));
  await page.goto(url);
  await page.locator(".session-row").filter({ hasText: session.title }).click();
  await page.getByText("Host 已连接", { exact: true }).waitFor();
  const textbox = page.getByRole("textbox", { name: "消息", exact: true }),
    send = page.getByRole("button", { name: "发送消息", exact: true });
  const submit = async (text) => {
    await textbox.fill(text);
    await send.click();
    await textbox.waitFor();
  };
  const token = randomUUID().slice(0, 8),
    withdrawn = `UI_WITHDRAW_${token}`,
    a = `UI_QUEUE_A_${token}`,
    b = `UI_QUEUE_B_${token}`,
    steer = `UI_STEER_${token}`;
  await submit(
    "Write the integers from 1 to 600, one per line. Do not use tools or modify files. This bounded test checks UI queueing and steering.",
  );
  await until(async () => {
    const d = await api(`/sessions/${session.id}`);
    const failure = d.commands.find((c) => ["unknown", "rejected"].includes(c.status));
    if (failure) throw new Error(failure.error);
    return d.session.runState === "running" && d.events.some((e) => e.type === "text-delta");
  });
  check("realStreamingTurn", true);
  await submit(withdrawn);
  const pending = page.getByLabel("待发消息", { exact: true });
  await pending.getByText(new RegExp(withdrawn)).waitFor();
  await page.screenshot({ path: "output/playwright/real-queue-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await pending.getByText(new RegExp(withdrawn)).waitFor();
  check("pendingVisibleOnPhone", true);
  await page.screenshot({ path: "output/playwright/real-queue-mobile.png" });
  await page.getByRole("button", { name: "撤回待发消息", exact: true }).click();
  await pending.waitFor({ state: "detached" });
  let detail = await api(`/sessions/${session.id}`);
  const cancelled = detail.commands.find((c) => c.body.text === withdrawn);
  check("phoneWithdrawalPersisted", cancelled?.status === "cancelled");
  await submit(`Reply exactly ${a}. Do not use tools or modify files.`);
  await pending.getByText(new RegExp(a)).waitFor();
  await submit(`Reply exactly ${b}. Do not use tools or modify files.`);
  await pending.getByText(new RegExp(b)).waitFor();
  await submit(
    `Before ending the current turn, acknowledge ${steer}. Do not use tools or modify files.`,
  );
  const steerPending = page.locator(".pending-message").filter({ hasText: steer });
  await steerPending.getByRole("button", { name: "引导当前轮" }).click();
  await until(async () => {
    detail = await api(`/sessions/${session.id}`);
    const c = detail.commands.find((c) => String(c.body.text).includes(steer));
    if (c && ["unknown", "rejected"].includes(c.status)) throw new Error(c.error);
    return c?.status === "confirmed";
  }, 15000);
  check("phoneNativeSteerConfirmed", true);
  await page.locator(".assistant-turn").filter({ hasText: b }).waitFor({ timeout: 90000 });
  await until(async () => {
    detail = await api(`/sessions/${session.id}`);
    return detail.session.runState === "idle";
  });
  report.nativeSessionId = detail.session.nativeSessionId;
  check(
    "queueRepliesRendered",
    (await page.locator(".assistant-turn").filter({ hasText: a }).count()) > 0 &&
      (await page.locator(".assistant-turn").filter({ hasText: b }).count()) > 0,
  );
  check(
    "steerReplyRendered",
    (await page.locator(".assistant-turn").filter({ hasText: steer }).count()) > 0,
  );
  check(
    "withdrawnNeverDelivered",
    !detail.events.some(
      (e) => e.type === "message" && JSON.stringify(e.payload).includes(withdrawn),
    ),
  );
  check(
    "phoneNoOverflow",
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  );
  await page.screenshot({ path: "output/playwright/real-messaging-mobile.png" });
  await page.getByRole("button", { name: "返回会话列表", exact: true }).click();
  await page.getByRole("textbox", { name: /搜索/ }).fill(b);
  await page.locator(".search-snippet").waitFor();
  await page.locator(".session-row").filter({ hasText: session.title }).click();
  await page.locator('[data-search-hit="true"]').waitFor();
  check("realSearchLocatedMessage", true);
  await page.getByRole("button", { name: "会话详情与管理", exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "删除本地会话", exact: true }).click();
  await page
    .locator(".session-row")
    .filter({ hasText: session.title })
    .waitFor({ state: "detached" });
  check("phoneDeletedLocally", !(await api("/snapshot")).sessions.some((s) => s.id === session.id));
  check("noFrontendExceptions", report.consoleErrors.length === 0);
  report.result = "passed";
} catch (error) {
  report.result = "failed";
  report.error = error.message;
} finally {
  await browser?.close();
  host.kill();
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(data, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (report.result !== "passed") process.exitCode = 1;
}
