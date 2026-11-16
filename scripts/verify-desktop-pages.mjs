import { _electron as electron } from "@playwright/test";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { electronEnvironment } from "./electron-environment.mjs";
import { resolveElectronRuntime } from "./electron-runtime.mjs";

const output = resolve(
  process.env.KOOYU_SCREENSHOT_DIR ?? "output/playwright/desktop-android-2026-11-15/desktop",
);
const base = process.env.KODO_HOST_URL ?? "http://127.0.0.1:4357";
const report = {
  startedAt: new Date().toISOString(),
  platform: "electron",
  fixture: true,
  modelInference: false,
  pages: [],
  errors: [],
  rendererErrors: [],
};
mkdirSync(output, { recursive: true });
let app, page, child;
const api = async (path, body, method = body ? "POST" : "GET") => {
  const r = await fetch(base + "/api" + path, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const value = await r.json();
  if (!r.ok) throw new Error(value.error?.message ?? String(r.status));
  return value;
};
async function captureFrame(id, label, scroll) {
  await page.waitForTimeout(250);
  const path = join(output, id + ".png");
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  report.pages.push({
    id,
    label,
    path,
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
    horizontalOverflow: overflow,
    ...(scroll ? { scroll } : {}),
  });
  writeFileSync(join(output, "manifest.json"), JSON.stringify(report, null, 2));
  if (overflow) throw new Error("Horizontal document overflow");
  console.log("CAPTURED " + id + " " + label);
}
async function capture(id, label) {
  await captureFrame(id, label);
  // fullPage only expands the document, not the app's independent scroll panes.
  const panes = await page.evaluateHandle(() =>
    Array.from(document.querySelectorAll("body *")).filter((element) => {
      const rect = element.getBoundingClientRect();
      return (
        /^(auto|scroll)$/.test(getComputedStyle(element).overflowY) &&
        element.scrollHeight > element.clientHeight + 2 &&
        rect.width > 240 &&
        rect.height > 120 &&
        rect.bottom > 0 &&
        rect.top < innerHeight &&
        rect.right > 0 &&
        rect.left < innerWidth
      );
    }),
  );
  try {
    let paneIndex = 0;
    for (const handle of (await panes.getProperties()).values()) {
      const pane = handle.asElement();
      if (!pane) continue;
      paneIndex++;
      const state = await pane.evaluate((element) => ({
        top: element.scrollTop,
        max: element.scrollHeight - element.clientHeight,
        step: Math.max(1, Math.floor(element.clientHeight * 0.8)),
        className: element.className,
      }));
      try {
        const positions = [];
        for (let top = 0; top < state.max; top += state.step) positions.push(top);
        positions.push(state.max);
        for (const [index, top] of positions.entries()) {
          if (Math.abs(top - state.top) < 2) continue;
          await pane.evaluate((element, target) => {
            element.scrollTop = target;
          }, top);
          const actualTop = await pane.evaluate((element) => element.scrollTop);
          if (Math.abs(actualTop - top) > 2) throw new Error("Scroll pane did not reach target");
          await captureFrame(
            `${id}-scroll-${paneIndex}-${index + 1}`,
            `${label} · 滚动区域 ${paneIndex} · ${index + 1}/${positions.length}`,
            { pane: state.className, top: actualTop, max: state.max },
          );
        }
      } finally {
        await pane.evaluate((element, top) => {
          element.scrollTop = top;
        }, state.top);
      }
    }
  } finally {
    await panes.dispose();
  }
}
async function run(id, label, work) {
  try {
    await work();
    await capture(id, label);
  } catch (e) {
    report.errors.push({ id, label, error: e.message });
    console.error("FAILED " + id + ": " + e.message);
    await page
      .screenshot({ path: join(output, id + "-failure.png"), fullPage: true })
      .catch(() => {});
    writeFileSync(
      join(output, id + "-state.txt"),
      await page
        .locator("body")
        .ariaSnapshot()
        .catch(() => "unavailable"),
    );
  }
}
try {
  const fixture = JSON.parse(
    readFileSync(
      resolve(
        process.env.KOOYU_QA_DIR ?? ".local/verification/platform-pages-20261115",
        "fixture.json",
      ),
      "utf8",
    ),
  );
  const health = await api("/health");
  if (fixture.fixture !== true || fixture.url !== base || fixture.hostId !== health.hostId)
    throw new Error(
      "Refusing to modify a Host without the matching local visual-QA fixture record.",
    );
  const initial = await api("/onboarding");
  await api(
    "/onboarding",
    { expectedRevision: initial.revision, status: "active", step: 0 },
    "PATCH",
  );
  const runtime = await resolveElectronRuntime();
  report.runtime = runtime;
  app = await electron.launch({
    executablePath: runtime.path,
    args: [
      resolve("apps/desktop"),
      "--user-data-dir=" +
        resolve(process.env.KOOYU_DESKTOP_QA_PROFILE ?? ".local/verification/desktop-qa-profile"),
    ],
    env: { ...electronEnvironment(), KODO_HOST_URL: base },
    timeout: 30000,
  });
  child = app.process();
  console.log("ELECTRON launched");
  page = await app.firstWindow({ timeout: 30000 });
  page.setDefaultTimeout(7000);
  page.on("pageerror", (e) => report.rendererErrors.push(e.message));
  await page.waitForURL(base + "/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await run("01-onboarding-model", "首次引导：模型", async () => {
    await page.getByRole("heading", { name: "模型配置", exact: true }).waitFor();
    await page.getByRole("button", { name: "跳过 API，先准备引擎", exact: true }).waitFor();
  });
  await run("02-onboarding-engines", "首次引导：执行引擎", async () => {
    await page.getByRole("button", { name: "跳过 API，先准备引擎" }).click();
  });
  await run("03-onboarding-ready", "首次引导：完成", async () => {
    await page.getByRole("button", { name: "继续", exact: true }).click();
  });
  await page.getByRole("button", { name: "进入工作台", exact: true }).click();
  await page.getByText("Host 已连接", { exact: true }).waitFor();
  report.rendererConnected = true;
  await run("04-workbench", "工作台与项目导航", async () => {});
  await run("05-new-conversation", "新建会话", async () => {
    await page.getByRole("button", { name: "新建会话", exact: true }).first().click();
  });
  await run("06-inbox", "待处理", async () => {
    await page.getByRole("button", { name: "待处理", exact: true }).first().click();
  });
  const nav = () => page.getByRole("navigation", { name: "配置导航" });
  await page.getByRole("button", { name: "设置", exact: true }).first().click();
  for (const [id, label] of [
    ["general", "通用"],
    ["engines", "引擎"],
    ["providers", "模型来源"],
    ["usage", "用量"],
    ["devices", "手机连接"],
    ["advanced", "高级"],
  ]) {
    await run("settings-" + id, "设置：" + label, async () => {
      await nav().getByRole("button", { name: label, exact: true }).click();
    });
    if (id === "engines") {
      const cards = page.locator("details.sx-engine");
      const count = await cards.count();
      for (let index = 0; index < count; index++) {
        await run(
          "engine-" + String(index + 1).padStart(2, "0"),
          "引擎详情 " + (index + 1),
          async () => {
            const card = cards.nth(index);
            const summary = card.locator("summary").first();
            if (!((await card.getAttribute("open")) !== null)) await summary.click();
            await summary.scrollIntoViewIfNeeded();
          },
        );
        await cards.nth(index).evaluate((card) => {
          card.open = false;
        });
      }
    }
    if (id === "providers")
      await run("settings-provider-editor", "添加模型来源", async () => {
        await page.getByRole("button", { name: "添加来源", exact: true }).first().click();
      });
  }
  await nav().getByRole("button", { name: "工作中心", exact: true }).click();
  for (const [id, label] of [
    ["plans", "计划"],
    ["applications", "应用与授权"],
    ["memory", "项目记忆"],
    ["environments", "执行环境"],
    ["notifications", "通知"],
    ["activity", "运行与核对"],
  ]) {
    await run("work-" + id, "工作中心：" + label, async () => {
      await page.locator(".work-center").getByRole("button", { name: label, exact: true }).click();
    });
    const forms = page.locator(".work-center details");
    for (let index = 0; index < (await forms.count()); index++) {
      const form = forms.nth(index);
      const summary = form.locator("summary").first();
      const title = await summary.textContent();
      await run("work-" + id + "-form-" + (index + 1), title, async () => {
        await summary.click();
        await summary.scrollIntoViewIfNeeded();
      });
      if ((await form.getAttribute("open")) !== null) await summary.click();
    }
  }
  await page.getByRole("button", { name: "返回对话", exact: true }).click();
  const snapshot = await api("/snapshot");
  const controller = snapshot.sessions.find((s) => s.title === "平台验收主对话");
  const goal = await api("/goals", {
    requestId: randomUUID(),
    controllerSessionId: controller.id,
    title: "平台逐页验收",
    acceptanceCriteria: ["桌面与 Android 页面可查看", "截图可追溯"],
  });
  await api("/artifacts", {
    requestId: randomUUID(),
    goalId: goal.id,
    title: "验收演示成果",
    displayName: "qa-report.md",
    content: "# 隔离界面验收\n\n这是测试数据，不代表真实模型任务。\n",
  });
  await page.evaluate((id) => localStorage.setItem("kodo.session", id), controller.id);
  await page.reload();
  await run("conversation-main", "主对话与目标状态", async () => {
    await page.getByRole("button", { name: "文件与改动", exact: true }).waitFor();
  });
  await page.getByRole("button", { name: "文件与改动", exact: true }).click();
  const tabs = page.getByRole("tablist", { name: "检查器视图" }).getByRole("tab");
  const labels = await tabs.allTextContents();
  for (const [index, label] of labels.entries()) {
    await run("inspector-" + (index + 1), "检查器：" + label, async () => {
      await tabs.filter({ hasText: label }).first().click();
    });
    if (label === "文件")
      await run("inspector-file-preview", "工作区 Markdown 预览", async () => {
        await page.getByText("README.md", { exact: true }).first().click();
        await page.getByText("平台验收演示项目", { exact: true }).last().waitFor();
      });
  }
  await page.getByRole("button", { name: "关闭详情", exact: true }).click();
  await run("conversation-light", "浅色主题", async () => {
    const button = page.getByRole("button", { name: "浅色主题", exact: true });
    if (await button.isVisible()) await button.click();
    await page.getByRole("button", { name: "深色主题", exact: true }).waitFor();
  });
  await run("conversation-dark", "深色主题", async () => {
    const button = page.getByRole("button", { name: "深色主题", exact: true });
    if (await button.isVisible()) await button.click();
  });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  report.closeHidesWindow = await app.evaluate(
    ({ BrowserWindow }) => !BrowserWindow.getAllWindows()[0].isVisible(),
  );
  report.hostSurvivesClose = (await fetch(base + "/api/health")).ok;
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
  report.reopened = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].isVisible(),
  );
} catch (error) {
  report.errors.push({ id: "fatal", error: error.message });
} finally {
  if (app) {
    await app.evaluate(({ app }) => app.quit()).catch(() => {});
    await Promise.race([app.close().catch(() => {}), new Promise((r) => setTimeout(r, 5000))]);
    child?.kill();
  }
  report.finishedAt = new Date().toISOString();
  report.result =
    !report.errors.length &&
    !report.rendererErrors.length &&
    report.rendererConnected &&
    report.closeHidesWindow &&
    report.hostSurvivesClose &&
    report.reopened
      ? "passed"
      : "failed";
  writeFileSync(join(output, "manifest.json"), JSON.stringify(report, null, 2));
  const escape = (s) =>
    String(s).replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
    );
  writeFileSync(
    join(output, "index.html"),
    "<!doctype html><meta charset=utf-8><title>Kooyu Desktop QA</title><style>body{font:16px system-ui;background:#eee;margin:24px}article{background:white;padding:16px;margin:20px 0}img{width:100%;max-width:1360px}</style><h1>Kooyu 桌面端逐页截图</h1><p>隔离演示数据；" +
      escape(report.result) +
      "</p>" +
      report.pages
        .map(
          (p) =>
            "<article><h2>" +
            escape(p.label) +
            "</h2><a href=" +
            escape(p.id + ".png") +
            "><img loading=lazy src=" +
            escape(p.id + ".png") +
            " alt=" +
            escape(p.id) +
            "></a></article>",
        )
        .join(""),
  );
  console.log(
    JSON.stringify({
      result: report.result,
      screenshots: report.pages.length,
      errors: report.errors,
      rendererErrors: report.rendererErrors,
    }),
  );
  if (report.result !== "passed") process.exitCode = 1;
}
