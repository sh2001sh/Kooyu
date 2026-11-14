// Capture the redesigned two-column shell at the review viewports.
// Absolute output paths: Playwright resolves relative paths against process.cwd(),
// which is not stable across how this script is invoked.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const base = "http://127.0.0.1:4325";
const outDir = resolve(import.meta.dirname, "..", ".impeccable", "review");
mkdirSync(outDir, { recursive: true });
const shot = (name) => resolve(outDir, name);

const browser = await chromium.launch();

async function seed(page) {
  const create = async (path, body) => {
    const r = await page.request.post(`${base}/api${path}`, { data: body });
    if (!r.ok()) throw new Error(`${path} -> ${r.status()} ${await r.text()}`);
    return r.json();
  };
  const project = await create("/projects", { name: "agent-harness" });
  const other = await create("/projects", { name: "网站重构" });
  const server = await create("/workspaces", {
    projectId: project.id,
    rootPath: "E:\\sh\\Coding\\agent-harness",
  });
  const rows = [
    ["修复登录态回归", "codex", "direct", project.id, server.id],
    ["梳理 harness 适配层", "claude-code", "direct", project.id, server.id],
    ["pi 直接对话", "pi", "direct", project.id, server.id],
    ["ZCode 协议核对", "zcode", "direct", project.id, server.id],
    ["首页视觉改版", "cursor", "direct", other.id, null],
    ["Kooyu 主对话", "kodo", "supervisor", null, null],
  ];
  for (const [title, harnessId, kind, projectId, workspaceId] of rows) {
    await create("/sessions", { title, harnessId, kind, projectId, workspaceId });
  }
}

// Seed once with the widest viewport, then capture each size from the same data.
const seeder = await browser.newPage({ viewport: { width: 1440, height: 960 } });
await seeder.goto(base);
await seeder.getByText("Host 已连接", { exact: true }).waitFor({ timeout: 15000 });
await seed(seeder);
await seeder.close();

for (const [name, width, height] of [
  ["desktop.png", 1440, 960],
  ["user-1280.png", 1280, 860],
  ["mobile.png", 390, 844],
]) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(base);
  await page.waitForTimeout(900);
  await page.screenshot({ path: shot(name), fullPage: false });
  console.log(`${name}: ${width}x${height} -> ${shot(name)}`);
  await page.close();
}

const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
await page.goto(base);
await page.getByText("Host 已连接", { exact: true }).waitFor({ timeout: 15000 });
await page.getByText("修复登录态回归", { exact: true }).first().click();
// Wait for the conversation header, not a fixed delay: the shell refreshes the
// snapshot after selecting, so a timer races the render.
await page
  .getByRole("heading", { name: "修复登录态回归", exact: true })
  .waitFor({ timeout: 15000 });
await page.waitForTimeout(900);
await page.screenshot({ path: shot("desktop-session.png") });
console.log("desktop-session.png");

await page.getByRole("button", { name: "会话详情与管理", exact: true }).click();
await page.waitForTimeout(800);
await page.screenshot({ path: shot("desktop-inspector.png") });
console.log("desktop-inspector.png");

await page.getByRole("button", { name: "关闭详情" }).click();
await page.waitForTimeout(400);
await page.getByRole("button", { name: "按 Harness", exact: true }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: shot("desktop-harness-view.png") });
console.log("desktop-harness-view.png");

await page.getByRole("button", { name: "按项目", exact: true }).click();
await page.waitForTimeout(300);
await page.getByRole("button", { name: "在 agent-harness 新建会话", exact: true }).first().click();
await page.getByRole("button", { name: "Harness", exact: true }).click();
await page.locator('.ios-popover [role="option"][data-value="pi"]').click();
await page.waitForTimeout(500);
await page.screenshot({ path: shot("desktop-new-modal.png") });
console.log("desktop-new-modal.png");

await page.getByRole("button", { name: "模型配置", exact: true }).click();
await page.waitForTimeout(450);
await page.screenshot({ path: shot("desktop-popover.png") });
console.log("desktop-popover.png");
await page.getByRole("button", { name: "思考强度", exact: true }).click();
await page.waitForTimeout(350);
await page.screenshot({ path: shot("desktop-draft-thinking.png") });
console.log("desktop-draft-thinking.png");
await page.keyboard.press("Escape");
await page.waitForTimeout(250);

await page.getByRole("button", { name: "折叠侧边栏" }).click();
await page.waitForTimeout(700);
await page.screenshot({ path: shot("desktop-collapsed.png") });
console.log("desktop-collapsed.png");

await page.getByRole("button", { name: "展开侧边栏" }).click();
await page.waitForTimeout(450);
await page.getByRole("button", { name: "Harness 与配置", exact: true }).click();
await page.waitForTimeout(500);
await page.locator(".health-row summary", { hasText: "Codex" }).click();
await page.waitForTimeout(350);
await page.screenshot({ path: shot("desktop-config.png") });
console.log("desktop-config.png");

await page.locator(".health-row summary", { hasText: "Codex" }).click();
await page.waitForTimeout(200);
await page.getByRole("button", { name: "模型库", exact: true }).click();
await page.waitForTimeout(350);
await page.screenshot({ path: shot("desktop-config-lower.png") });
console.log("desktop-config-lower.png");

await page.getByRole("button", { name: "用量与预算", exact: true }).click();
await page.waitForTimeout(450);
const budgetSelect = page.locator(".budget-form select");
const budgetInput = page.locator('.budget-form input[type="number"]');
if ((await budgetSelect.count()) > 0 && (await budgetInput.count()) > 0) {
  await budgetSelect.selectOption({ index: 1 });
  await budgetInput.fill("40");
  await page.locator('.budget-form button[type="submit"]').click();
  await page.waitForTimeout(400);
  await page.locator('.budget-form button[type="submit"]').blur();
}

const usageShotSnap = await (await fetch(`${base}/api/snapshot`)).json();
const uProj0 = usageShotSnap.projects[0]?.id ?? null;
const uProj1 = usageShotSnap.projects[1]?.id ?? uProj0;
const uSessByHarness = (h) =>
  usageShotSnap.sessions.find((s) => s.harnessId === h)?.id ??
  usageShotSnap.sessions[0]?.id ??
  "s-demo";
const dayIso = (daysAgo, hour = 14) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 20, 0, 0);
  return d.toISOString();
};
const mockUsagePayload = {
  records: [
    {
      id: "u-1",
      sessionId: uSessByHarness("codex"),
      projectId: uProj0,
      bindingId: null,
      source: "codex",
      scope: "turn",
      input: 34200,
      output: 8100,
      cacheRead: 42000,
      cacheWrite: 3800,
      costUsd: 0.412,
      costKind: "actual",
      model: "gpt-5.3-codex",
      createdAt: dayIso(0, 15),
    },
    {
      id: "u-2",
      sessionId: uSessByHarness("claude-code"),
      projectId: uProj0,
      bindingId: null,
      source: "claude-code",
      scope: "turn",
      input: 28400,
      output: 7400,
      cacheRead: 51200,
      cacheWrite: 6400,
      costUsd: 0.568,
      costKind: "actual",
      model: "claude-sonnet-4-5",
      createdAt: dayIso(0, 11),
    },
    {
      id: "u-3",
      sessionId: uSessByHarness("pi"),
      projectId: uProj0,
      bindingId: null,
      source: "pi",
      scope: "turn",
      input: 19800,
      output: 5200,
      cacheRead: 11200,
      cacheWrite: 0,
      costUsd: 0.084,
      costKind: "estimate",
      model: "deepseek-v4.1-flash",
      createdAt: dayIso(1, 17),
    },
    {
      id: "u-4",
      sessionId: uSessByHarness("zcode"),
      projectId: uProj0,
      bindingId: null,
      source: "zcode",
      scope: "turn",
      input: 24500,
      output: 6100,
      cacheRead: 18400,
      cacheWrite: 2200,
      costUsd: 0.238,
      costKind: "actual",
      model: "glm-5",
      createdAt: dayIso(2, 16),
    },
    {
      id: "u-5",
      sessionId: uSessByHarness("codex"),
      projectId: uProj0,
      bindingId: null,
      source: "codex",
      scope: "turn",
      input: 41600,
      output: 9300,
      cacheRead: 36800,
      cacheWrite: 4100,
      costUsd: 0.514,
      costKind: "actual",
      model: "gpt-5.3-codex",
      createdAt: dayIso(3, 14),
    },
    {
      id: "u-6",
      sessionId: uSessByHarness("claude-code"),
      projectId: uProj1,
      bindingId: null,
      source: "claude-code",
      scope: "turn",
      input: 16200,
      output: 4400,
      cacheRead: 29500,
      cacheWrite: 2800,
      costUsd: 0.312,
      costKind: "actual",
      model: "claude-opus-4-1",
      createdAt: dayIso(5, 19),
    },
    {
      id: "u-7",
      sessionId: uSessByHarness("cursor"),
      projectId: uProj1,
      bindingId: null,
      source: "cursor",
      scope: "session",
      input: 12400,
      output: 2900,
      cacheRead: 8100,
      cacheWrite: 0,
      costUsd: null,
      costKind: "unknown",
      model: "composer-2",
      createdAt: dayIso(7, 13),
    },
    {
      id: "u-8",
      sessionId: uSessByHarness("codex"),
      projectId: uProj0,
      bindingId: null,
      source: "codex",
      scope: "turn",
      input: 31100,
      output: 6800,
      cacheRead: 28000,
      cacheWrite: 1900,
      costUsd: 0.382,
      costKind: "actual",
      model: "gpt-5.3-codex",
      createdAt: dayIso(9, 10),
    },
    {
      id: "u-9",
      sessionId: uSessByHarness("pi"),
      projectId: uProj0,
      bindingId: null,
      source: "pi",
      scope: "turn",
      input: 15800,
      output: 4100,
      cacheRead: 9400,
      cacheWrite: 0,
      costUsd: 0.068,
      costKind: "estimate",
      model: "deepseek-v4.1-flash",
      createdAt: dayIso(11, 16),
    },
    {
      id: "u-10",
      sessionId: uSessByHarness("claude-code"),
      projectId: uProj0,
      bindingId: null,
      source: "claude-code",
      scope: "turn",
      input: 22900,
      output: 5900,
      cacheRead: 38200,
      cacheWrite: 4400,
      costUsd: 0.445,
      costKind: "actual",
      model: "claude-sonnet-4-5",
      createdAt: dayIso(12, 15),
    },
    {
      id: "u-11",
      sessionId: uSessByHarness("zcode"),
      projectId: uProj0,
      bindingId: null,
      source: "zcode",
      scope: "turn",
      input: 18100,
      output: 4300,
      cacheRead: 14600,
      cacheWrite: 1200,
      costUsd: 0.194,
      costKind: "actual",
      model: "glm-5",
      createdAt: dayIso(18, 14),
    },
    {
      id: "u-12",
      sessionId: uSessByHarness("codex"),
      projectId: uProj0,
      bindingId: null,
      source: "codex",
      scope: "turn",
      input: 27400,
      output: 6200,
      cacheRead: 25100,
      cacheWrite: 2400,
      costUsd: 0.336,
      costKind: "actual",
      model: "gpt-5.3-codex",
      createdAt: dayIso(26, 11),
    },
  ],
  budgets: [
    ...(uProj0 ? [{ projectId: uProj0, usd: 4.5 }] : []),
    ...(uProj1 && uProj1 !== uProj0 ? [{ projectId: uProj1, usd: 0.4 }] : []),
  ],
};
const usageShowcasePage = await browser.newPage({ viewport: { width: 1440, height: 960 } });
await usageShowcasePage.route("**/api/usage", async (route) => {
  await route.fulfill({ json: mockUsagePayload });
});
await usageShowcasePage.goto(base);
await usageShowcasePage.getByRole("button", { name: "用量与预算", exact: true }).click();
await usageShowcasePage
  .getByRole("img", { name: "每日费用堆叠柱状图" })
  .waitFor({ timeout: 10000 });
await usageShowcasePage.waitForTimeout(450);
await usageShowcasePage.screenshot({ path: shot("desktop-usage.png") });
console.log("desktop-usage.png");
await usageShowcasePage.setViewportSize({ width: 390, height: 844 });
await usageShowcasePage.waitForTimeout(300);
await usageShowcasePage.screenshot({ path: shot("mobile-usage.png") });
console.log("mobile-usage.png");
await usageShowcasePage.close();

// Visual showcase of queued messages tray & busy send-mode pill on desktop & mobile
const queuePage = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const snapRes = await fetch(`${base}/api/snapshot`);
const liveSnap = await snapRes.json();
const codexSess = liveSnap.sessions.find((s) => s.harnessId === "codex") ?? liveSnap.sessions[0];
if (codexSess) {
  const runningSess = {
    ...codexSess,
    runState: "running",
    phase: "native",
    connectionState: "connected",
    model: "gpt-5.3-codex",
    reasoning: "medium",
  };
  const mockSnap = {
    ...liveSnap,
    sessions: liveSnap.sessions.map((s) => (s.id === codexSess.id ? runningSess : s)),
  };
  const now = new Date().toISOString();
  const mockCommands = [
    {
      id: "cmd-q-1",
      sessionId: codexSess.id,
      kind: "send",
      origin: "user",
      requestId: "req-q-1",
      status: "accepted",
      body: {
        text: "核对全部认证模块单测并补齐边界用例，完成后输出修改摘要。",
        mode: "queue",
      },
      createdAt: now,
    },
    {
      id: "cmd-q-2",
      sessionId: codexSess.id,
      kind: "send",
      origin: "user",
      requestId: "req-q-2",
      status: "accepted",
      body: {
        text: "顺便检查移动端 390px 下的安全区域留白",
        mode: "queue",
      },
      createdAt: now,
    },
  ];
  await queuePage.route("**/api/snapshot", async (route) => {
    await route.fulfill({ json: mockSnap });
  });
  await queuePage.route(`**/api/sessions/${codexSess.id}*`, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        json: {
          session: runningSess,
          events: [
            {
              id: "ev-u1",
              seq: 1,
              type: "message",
              createdAt: now,
              payload: { role: "user", text: "请先修复登录态回归并确认刷新 token 后不丢会话。" },
            },
            {
              id: "ev-a1",
              seq: 2,
              type: "text-delta",
              createdAt: now,
              payload: { delta: "正在检查 auth/session 刷新拦截器并补充并发续期锁逻辑……" },
            },
          ],
          commands: mockCommands,
          nextSeq: 3,
          hasMoreEvents: false,
        },
      });
      return;
    }
    await route.continue();
  });
  await queuePage.goto(base);
  await queuePage.locator(".session-row").filter({ hasText: codexSess.title }).first().click();
  await queuePage.getByLabel("待发消息", { exact: true }).waitFor({ timeout: 10000 });
  await queuePage.waitForTimeout(450);
  await queuePage.screenshot({ path: shot("desktop-queue.png") });
  console.log("desktop-queue.png");

  await queuePage
    .locator(".pending-message")
    .first()
    .getByRole("button", { name: "修改待发消息", exact: true })
    .click();
  await queuePage.waitForTimeout(250);
  await queuePage.screenshot({ path: shot("desktop-queue-edit.png") });
  console.log("desktop-queue-edit.png");
  await queuePage
    .locator(".pending-message")
    .first()
    .getByRole("button", { name: "取消修改", exact: true })
    .click();
  await queuePage.waitForTimeout(200);

  await queuePage.setViewportSize({ width: 390, height: 844 });
  await queuePage.waitForTimeout(350);
  await queuePage.screenshot({ path: shot("mobile-queue.png") });
  console.log("mobile-queue.png");
}
await queuePage.close();

// Dark mode showcase on Draft Art Canvas
const darkPage = await browser.newPage({ viewport: { width: 1440, height: 960 } });
await darkPage.goto(base);
await darkPage
  .getByRole("button", { name: "深色模式" })
  .or(darkPage.locator('[aria-label*="深色"], [title*="深色"]'))
  .first()
  .click();
await darkPage.waitForTimeout(550);
await darkPage.screenshot({ path: shot("desktop-dark.png") });
console.log("desktop-dark.png");
await darkPage.close();

await browser.close();
