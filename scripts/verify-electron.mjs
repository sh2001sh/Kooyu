import { _electron as electron } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { electronEnvironment } from "./electron-environment.mjs";
import { resolveElectronRuntime } from "./electron-runtime.mjs";
import assert from "node:assert/strict";
const data = resolve(`.local/verification/electron-${Date.now()}`);
mkdirSync(data, { recursive: true });
const port = "4322",
  url = `http://127.0.0.1:${port}`,
  report = { startedAt: new Date().toISOString(), result: "unverified" };
let app, hostPid;
function checkpoint(step) {
  report.step = step;
  writeFileSync(join(data, "progress.json"), JSON.stringify(report, null, 2));
  console.log(`Electron verification: ${step}`);
}
async function closeApplication() {
  if (!app) return;
  const closing = app.close();
  let timer;
  const completed = await Promise.race([
    closing.then(() => true),
    new Promise((r) => {
      timer = setTimeout(() => r(false), 5000);
    }),
  ]);
  clearTimeout(timer);
  if (!completed) {
    let alive = true;
    try {
      process.kill(report.electronPid, 0);
    } catch {
      alive = false;
    }
    if (alive) throw new Error("Electron main process did not exit within five seconds.");
    // Playwright's Windows cmd wrapper can outlive an already exited GUI.
    // Terminate only that wrapper, never its detached Host or process tree.
    app.process().kill();
    report.playwrightCloseTimedOut = true;
    report.nativeProcessExited = true;
    void closing.catch(() => {});
  }
  app = undefined;
}
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
let nativeSession, nativeCommand;
try {
  const runtime = await resolveElectronRuntime();
  report.runtime = runtime;
  report.binary = runtime.path;
  report.environment = {
    inheritedRunAsNode: Object.keys(process.env).some(
      (key) => key.toUpperCase() === "ELECTRON_RUN_AS_NODE",
    ),
    runAsNodeRemoved: true,
    softwareRendering: electronEnvironment().KODO_SOFTWARE_RENDERING ?? "0",
    diagnosis:
      "用户已定位本机环境问题：继承 ELECTRON_RUN_AS_NODE=1 与 GPU 初始化 0xC0000005；当前探针结果单独记录。",
  };
  report.preflight = runtime.cached ?? runtime.original;
  checkpoint("preflight");
  if (report.preflight.code !== 0)
    throw new Error(
      `Electron binary exited before application launch (${report.preflight.code}); desktop lifecycle remains unverified.`,
    );
  app = await electron.launch({
    executablePath: runtime.path,
    args: [resolve("apps/desktop")],
    env: { ...electronEnvironment(), KODO_DATA_DIR: data, KODO_HOST_PORT: port },
    timeout: 30000,
  });
  report.electronPid = await app.evaluate(() => process.pid);
  checkpoint("launched");
  const page = await app.firstWindow({ timeout: 15000 });
  // A fresh, isolated Host opens onboarding before exposing the workbench.
  // Exercise the visible skip control rather than assuming old saved settings.
  const skipOnboarding = page.getByRole("button", { name: "跳过引导", exact: true });
  await Promise.race([
    skipOnboarding.waitFor({ timeout: 15000 }),
    page.getByRole("button", { name: "新建会话", exact: true }).first().waitFor({ timeout: 15000 }),
  ]);
  if (await skipOnboarding.isVisible()) await skipOnboarding.click();
  await page
    .getByRole("button", { name: "新建会话", exact: true })
    .first()
    .waitFor({ timeout: 15000 });
  await page.getByText("Host 已连接", { exact: true }).waitFor({ timeout: 15000 });
  report.rendererConnected = true;
  mkdirSync(resolve("output/playwright"), { recursive: true });
  await page.screenshot({ path: resolve("output/playwright/electron-fixed.png") });
  const discovery = JSON.parse(readFileSync(join(data, "host.json"), "utf8"));
  hostPid = discovery.pid;
  report.hostPid = hostPid;
  checkpoint("window-ready");
  report.trayIcon = await app.evaluate(
    ({ nativeImage }, path) => (nativeImage.createFromPath(path).isEmpty() ? "empty" : "loaded"),
    resolve("apps/desktop/assets/tray.png"),
  );
  assert.deepEqual(
    readFileSync(resolve("apps/desktop/assets/tray.png")),
    readFileSync(resolve("brand/icons/kooyu-app-32.png")),
    "Tray must use the approved Kooyu brand, not the legacy K icon",
  );
  assert.deepEqual(
    readFileSync(resolve("apps/desktop/assets/app.png")),
    readFileSync(resolve("brand/icons/kooyu-app-256.png")),
    "Window asset must use the approved Kooyu icon",
  );
  report.approvedBrandIcons = true;
  if (process.argv.includes("--provider-bindings")) {
    // Explicitly synthetic metadata only. This walkthrough never sends a model prompt.
    const p = await api("/providers", {
      name: "Electron isolated configuration QA",
      endpoints: [
        { name: "Responses", protocol: "openai-responses", baseUrl: "http://127.0.0.1:1/v1" },
        { name: "Google", protocol: "google-generative-ai", baseUrl: "http://127.0.0.1:1" },
      ],
    });
    const modelsByEndpoint = {};
    for (const e of p.endpoints) {
      modelsByEndpoint[e.name] = await api("/provider-models", {
        providerId: p.id,
        endpointId: e.id,
        model: `synthetic-${e.name}`,
        overrides: {
          contextWindow: 123456,
          maxOutputTokens: 2345,
          reasoning: true,
          reasoningOptions: [{ type: "effort", values: ["low", "high"] }],
          input: ["text"],
        },
      });
    }
    await page
      .getByRole("button", { name: /^(设置|Harness 与配置)$/ })
      .first()
      .click();
    const configNav = page.getByRole("navigation", { name: "配置导航" });
    await configNav.waitFor({ timeout: 15000 });
    await configNav.getByRole("button", { name: "高级", exact: true }).click();
    const config = page.getByRole("region", { name: "Provider 与模型配置" });
    report.providerBindings = [];
    for (const [id, endpointName] of [
      ["deepseek-harness", "Responses"],
      ["zcode", "Responses"],
      ["gemini", "Google"],
      ["kimi-code", "Responses"],
      ["grok-build", "Responses"],
    ]) {
      await config.getByRole("button", { name: "添加 Harness 绑定", exact: true }).click();
      await config.getByLabel("目标 Harness", { exact: true }).selectOption(id);
      await config.getByLabel("设为该 Harness 的新会话默认配置").check();
      await config.getByLabel("绑定名称", { exact: true }).fill(`Electron QA ${id}`);
      await config
        .getByLabel("Provider 与模型", { exact: true })
        .selectOption(modelsByEndpoint[endpointName].id);
      await config.getByLabel("默认思考强度", { exact: true }).selectOption("high");
      await config.getByRole("button", { name: "保存 Harness 绑定", exact: true }).click();
      await config.getByText(`Electron QA ${id}`, { exact: true }).waitFor();
      const state = await api("/snapshot"),
        bindings = await api("/provider-configuration");
      const saved = bindings.bindings.find((b) => b.name === `Electron QA ${id}`);
      if (state.bindingDefaults.harnessBindingIds[id] !== saved?.id)
        throw new Error(`Electron ${id} default was not applied.`);
      report.providerBindings.push({ harnessId: id, saved: true, appliedAsDefault: true });
    }
    await config.getByRole("button", { name: "添加 Harness 绑定", exact: true }).click();
    await config.getByLabel("目标 Harness", { exact: true }).selectOption("cursor");
    if (await config.getByRole("button", { name: "保存 Harness 绑定", exact: true }).isEnabled())
      throw new Error("Cursor custom Provider must remain unavailable.");
    report.cursorUnsupportedShown = true;
    await page.screenshot({ path: join(data, "provider-bindings.png"), fullPage: true });
    checkpoint("provider-bindings-saved");
  }
  if (process.argv.includes("--with-native-conversation")) {
    const project = await api("/projects", {
      name: "Electron real task lifecycle",
      rootPath: process.cwd(),
    });
    const snapshot = await api("/snapshot"),
      workspace = snapshot.workspaces.find((w) => w.projectId === project.id);
    nativeSession = await api("/sessions", {
      title: "Electron 原生任务存活验证",
      harnessId: "codex",
      kind: "direct",
      projectId: project.id,
      workspaceId: workspace.id,
    });
    await page.reload();
    await page.getByText(nativeSession.title, { exact: true }).click();
    await page
      .getByRole("textbox", { name: "消息", exact: true })
      .fill(
        "Write the integers 1 through 800, one per line. Do not use tools or change files. This bounded test checks that closing the GUI preserves execution.",
      );
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    const until = Date.now() + 45000;
    while (Date.now() < until) {
      const detail = await api(`/sessions/${nativeSession.id}`);
      nativeCommand = detail.commands.find((c) => c.kind === "send");
      if (
        detail.session.runState === "running" &&
        detail.events.some((e) => e.type === "text-delta")
      )
        break;
      if (nativeCommand && ["unknown", "rejected"].includes(nativeCommand.status))
        throw new Error(nativeCommand.error);
      await new Promise((r) => setTimeout(r, 100));
    }
    const detail = await api(`/sessions/${nativeSession.id}`);
    if (
      detail.session.runState !== "running" ||
      !detail.events.some((e) => e.type === "text-delta")
    )
      throw new Error("Native turn was not streaming before window close.");
    report.nativeTaskRunningBeforeClose = true;
    report.nativeSessionId = detail.session.nativeSessionId;
    await page.screenshot({ path: resolve("output/playwright/electron-native-running.png") });
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  report.windowHidden = await app.evaluate(
    ({ BrowserWindow }) => !BrowserWindow.getAllWindows()[0].isVisible(),
  );
  report.hostAfterClose = (await fetch(url + "/api/health")).ok;
  checkpoint("window-hidden-host-alive");
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
  report.reopened = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].isVisible(),
  );
  checkpoint("window-reopened");
  await closeApplication();
  checkpoint("ui-exited");
  report.hostAfterExit = (await fetch(url + "/api/health")).ok;
  if (nativeSession) {
    const until = Date.now() + 90000;
    let detail;
    do {
      detail = await api(`/sessions/${nativeSession.id}`);
      if (detail.session.runState === "idle") break;
      await new Promise((r) => setTimeout(r, 100));
    } while (Date.now() < until);
    report.nativeTaskCompletedAfterExit =
      detail.session.runState === "idle" &&
      detail.commands.find((c) => c.id === nativeCommand.id)?.status === "confirmed" &&
      detail.events.some(
        (e) =>
          e.type === "message" &&
          e.payload?.role !== "user" &&
          JSON.stringify(e.payload).includes("800"),
      );
    report.sameNativeIdentityAfterExit = detail.session.nativeSessionId === report.nativeSessionId;
    if (!report.nativeTaskCompletedAfterExit || !report.sameNativeIdentityAfterExit)
      throw new Error("Native task did not finish with its original identity after GUI exit.");
  }
  report.result =
    report.trayIcon === "loaded" &&
    report.windowHidden &&
    report.hostAfterClose &&
    report.reopened &&
    report.hostAfterExit
      ? "passed"
      : "not-passed";
} catch (error) {
  report.error = error.message;
  report.result = "failed";
} finally {
  if (app)
    await closeApplication().catch((error) => {
      report.cleanupError = error.message;
      app.process().kill();
    });
  if (!hostPid) {
    try {
      hostPid = JSON.parse(readFileSync(join(data, "host.json"), "utf8")).pid;
    } catch {}
  }
  if (hostPid)
    try {
      process.kill(hostPid, "SIGTERM");
    } catch {}
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(data, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (report.result !== "passed") process.exitCode = 1;
}
