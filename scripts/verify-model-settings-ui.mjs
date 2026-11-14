// Actual Codex native conversation through the shared desktop/phone UI.
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
const dir = resolve(`.local/verification/model-ui-${Date.now()}`);
mkdirSync(dir, { recursive: true });
const port = "4324",
  url = `http://127.0.0.1:${port}`;
const host = spawn(process.execPath, ["packages/host/dist/main.js"], {
  env: { ...process.env, KODO_HOST_PORT: port, KODO_DATA_DIR: dir },
  windowsHide: true,
  stdio: "ignore",
});
let browser;
const report = { result: "unverified", checks: {}, consoleErrors: [] };
function check(name, value) {
  report.checks[name] = Boolean(value);
  assert.ok(value, name);
}
async function api(path, body) {
  const r = await fetch(`${url}/api${path}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error.message);
  return data;
}
async function until(fn, timeout = 120000) {
  const until = Date.now() + timeout;
  while (!(await fn())) {
    if (Date.now() > until) throw new Error("Native model UI verification deadline exceeded");
    await new Promise((r) => setTimeout(r, 50));
  }
}
async function chooseModel(page, model) {
  await page.getByRole("button", { name: "模型与思考强度", exact: true }).click();
  const form = page.locator(".ms-popover");
  await form.getByLabel("搜索模型").fill(model);
  await form.locator(".ms-model-scroll").getByText(model, { exact: true }).click();
  await form.waitFor({ state: "detached" });
}
async function chooseEffort(page, effort) {
  await page.getByRole("button", { name: "模型与思考强度", exact: true }).click();
  const form = page.locator(".ms-popover");
  const levels = await form.locator(".reasoning-slider__scale span").allTextContents();
  const index = levels.indexOf(effort);
  assert.ok(index > 0, `Native model did not offer effort ${effort}`);
  const slider = form.getByRole("slider", { name: "会话思考强度" });
  const box = await slider.boundingBox();
  await slider.click({
    position: { x: 10 + ((box.width - 20) * index) / (levels.length - 1), y: box.height / 2 },
  });
  await form
    .locator(".reasoning-slider__heading strong")
    .getByText(effort, { exact: true })
    .waitFor();
  return form;
}
try {
  await until(async () => {
    try {
      return (await api("/health")).status === "ok";
    } catch {
      return false;
    }
  }, 15000);
  const project = await api("/projects", {
    name: "Native model UI verification",
    rootPath: process.cwd(),
  });
  const workspace = (await api("/snapshot")).workspaces.find((w) => w.projectId === project.id);
  const session = await api("/sessions", {
    title: "Codex 真实模型切换",
    harnessId: "codex",
    kind: "direct",
    bindingId: null,
    projectId: project.id,
    workspaceId: workspace.id,
  });
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.on("pageerror", (e) => report.consoleErrors.push(e.message));
  await page.goto(url);
  await page.locator(".session-row").filter({ hasText: session.title }).click();
  await chooseModel(page, "gpt-6.1-sol");
  await chooseEffort(page, "low");
  await page.screenshot({
    path: "output/playwright/real-model-settings-desktop.png",
    animations: "disabled",
  });
  await until(async () => (await api(`/sessions/${session.id}`)).session.reasoning === "low");
  await page.keyboard.press("Escape");
  const original = (await api(`/sessions/${session.id}`)).session.nativeSessionId;
  check("nativeCatalogWithoutModelCall", Boolean(original));
  await page
    .getByRole("textbox", { name: "消息", exact: true })
    .fill(
      "First write KODO_UI_A, then the integers 1 through 600, one per line. Do not use tools, read or change files. This is a bounded conversation configuration test.",
    );
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await until(async () => {
    const d = await api(`/sessions/${session.id}`);
    return d.session.runState === "running" && d.events.some((e) => e.type === "text-delta");
  });
  await page
    .getByRole("textbox", { name: "消息", exact: true })
    .fill(
      "Repeat the exact KODO_ token from my first user message in this conversation, then write KODO_UI_B. Do not use tools or files.",
    );
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await page.getByLabel("待发消息", { exact: true }).waitFor();
  const originalPending = "KODO_PENDING_ORIGINAL_MUST_NEVER_REACH_NATIVE";
  await page.getByRole("textbox", { name: "消息", exact: true }).fill(originalPending);
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  const pending = page.locator(".pending-message").filter({ hasText: originalPending });
  await pending.waitFor();
  const pendingId = await pending.getAttribute("data-command-id");
  const edited = page.locator(`[data-command-id="${pendingId}"]`);
  await edited.getByRole("button", { name: "修改待发消息", exact: true }).click();
  await edited
    .getByLabel("修改待发消息内容")
    .fill(
      "Before this turn ends, acknowledge KODO_PENDING_NOW, then continue the requested task. Do not use tools or files.",
    );
  const editWidth = await edited.getByLabel("修改待发消息内容").boundingBox();
  const rowWidth = await edited.boundingBox();
  check("pendingEditorUsesRowWidth", editWidth.width >= rowWidth.width - 40);
  await edited.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "output/playwright/pending-message-edit-desktop.png",
    animations: "disabled",
  });
  await edited.getByRole("button", { name: "保存修改", exact: true }).click();
  await edited.getByText(/Before this turn ends/).waitFor();
  check("pendingEditPersisted", (await api(`/commands/${pendingId}`)).body.pendingRevision === 1);
  await page.setViewportSize({ width: 390, height: 844 });
  await until(() => edited.getByRole("button", { name: "立即发送", exact: true }).isEnabled());
  await edited.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "output/playwright/pending-message-actions-mobile.png",
    animations: "disabled",
  });
  await edited.getByRole("button", { name: "立即发送", exact: true }).click();
  await until(async () => (await api(`/commands/${pendingId}`)).status === "confirmed");
  const promoted = await api(`/commands/${pendingId}`);
  check(
    "pendingSentAsNativeSteer",
    promoted.body.mode === "steer" &&
      promoted.body.text.includes("KODO_PENDING_NOW") &&
      !promoted.body.settings,
  );
  check(
    "originalRequestStillIdempotent",
    (
      await api(`/sessions/${session.id}/send`, {
        requestId: pendingId,
        text: originalPending,
        mode: "queue",
      })
    ).id === pendingId,
  );

  await chooseModel(page, "gpt-6-astra");
  await chooseEffort(page, "medium");
  await page.screenshot({
    path: "output/playwright/real-model-settings-mobile.png",
    animations: "disabled",
  });
  check(
    "phoneNoOverflow",
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  );
  await until(async () => (await api(`/sessions/${session.id}`)).session.reasoning === "medium");
  const changed = (await api(`/sessions/${session.id}`)).session;
  check("changedWhileNativeTurnRunning", changed.runState === "running");
  check("modelChangePreservedNativeId", changed.nativeSessionId === original);
  await until(async () => {
    const d = await api(`/sessions/${session.id}`);
    return (
      d.session.runState === "idle" &&
      d.commands.filter((c) => c.kind === "send" && c.status === "confirmed").length === 3 &&
      d.events.filter((e) => e.type === "turn-ended").length === 2
    );
  });
  const detail = await api(`/sessions/${session.id}`);
  const sends = detail.commands.filter((c) => c.kind === "send");
  check(
    "activeTurnKeptOriginalModel",
    sends[0].body.settings.model === "gpt-6.1-sol" && sends[0].body.settings.reasoning === "low",
  );
  check(
    "queuedTurnUsedNewModelAndEffort",
    sends[1].body.settings.model === "gpt-6-astra" && sends[1].body.settings.reasoning === "medium",
  );
  const messages = detail.events.filter((e) => e.type === "message" && e.payload.role !== "user");
  check(
    "nativeReplyAfterSwitch",
    JSON.stringify(messages.at(-1)).includes("KODO_UI_B") &&
      JSON.stringify(messages.at(-1)).includes("KODO_UI_A"),
  );
  check(
    "correctedPendingOnlyOnce",
    detail.events.filter((e) => e.type === "message" && e.payload.commandId === pendingId)
      .length === 1,
  );
  const history = await api(`/sessions/${session.id}/native`);
  check("originalPendingNeverNative", !JSON.stringify(history).includes(originalPending));
  check("nativeSteerAcknowledged", JSON.stringify(history).includes("KODO_PENDING_NOW"));
  check("noNativeErrors", !detail.events.some((e) => e.type === "error"));
  check("noFrontendExceptions", report.consoleErrors.length === 0);
  report.result = "passed";
} catch (e) {
  report.result = "failed";
  report.error = e.message;
  process.exitCode = 1;
} finally {
  await browser?.close();
  host.kill();
  writeFileSync(join(dir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, report: join(dir, "report.json") }, null, 2));
}
