import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Metadata fixture only. Empty drafts and model selection never execute inference.
let endpoint: Server, base: string;
test.beforeAll(async () => {
  endpoint = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        data: [
          {
            id: "settings-model-a",
            contextWindow: 128000,
            maxOutputTokens: 4096,
            reasoning: false,
            input: ["text"],
            pricing: { input: 2, output: 8 },
          },
          {
            id: "settings-model-b",
            contextWindow: 256000,
            maxOutputTokens: 8192,
            reasoning: false,
            input: ["text"],
            pricing: { input: 3, output: 12 },
          },
        ],
      }),
    );
  });
  await new Promise<void>((done) => endpoint.listen(0, "127.0.0.1", done));
  const address = endpoint.address();
  if (!address || typeof address === "string") throw new Error("Missing metadata endpoint");
  base = `http://127.0.0.1:${address.port}/v1`;
});
test.afterAll(async () => {
  endpoint.closeAllConnections();
  await new Promise<void>((done) => endpoint.close(() => done()));
});

for (const mobile of [false, true])
  test(`${mobile ? "mobile" : "desktop"}: preferences, automatic models, engine Provider and chat model switching`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(60000);
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const previous = await (await page.request.get("/api/app-settings")).json();
    const priorDefaults = (await (await page.request.get("/api/snapshot")).json()).bindingDefaults;
    await page.request.patch("/api/app-settings", {
      data: { ...previous, autoRefreshModels: false, theme: "light" },
    });
    const nav = (name: string) => page.getByRole("button", { name, exact: true }).first();
    const screenshots = fileURLToPath(new URL("../../../.impeccable/review/", import.meta.url));
    mkdirSync(screenshots, { recursive: true });
    try {
      await page.goto("/");
      await expect(page.getByText("Host 已连接", { exact: true })).toHaveCount(1);
      await nav(mobile ? "配置" : "Harness 与配置").click();
      await nav("通用").click();
      await page.getByLabel("发送快捷键", { exact: true }).selectOption("mod-enter");
      await page.getByRole("button", { name: "保存设置", exact: true }).click();
      await expect(page.getByText("已保存", { exact: true })).toBeVisible();
      await page.reload();
      await nav(mobile ? "配置" : "Harness 与配置").click();
      await nav("通用").click();
      await expect(page.getByLabel("发送快捷键", { exact: true })).toHaveValue("mod-enter");
      await nav("外观").click();
      await page.getByLabel("消息字号", { exact: true }).selectOption("18");
      await page.getByLabel("减少动态效果", { exact: true }).check();
      await page.getByRole("button", { name: "保存设置", exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("data-reduce-motion", "true");
      await page.screenshot({ path: testInfo.outputPath("appearance.png"), fullPage: true });
      await nav("个人指令").click();
      await page
        .getByRole("textbox", { name: "个人指令", exact: true })
        .fill("请用中文回复，并说明验证结果。");
      await page.getByRole("button", { name: "保存设置", exact: true }).click();
      await expect(page.getByText("已保存", { exact: true })).toBeVisible();
      await nav("Provider").click();
      const panel = page.getByRole("region", { name: "Provider 与模型配置" });
      await panel.getByRole("button", { name: "添加 Provider", exact: true }).click();
      const name = `Settings Provider ${mobile ? "mobile" : "desktop"}`;
      await panel.getByLabel("Provider 名称", { exact: true }).fill(name);
      await panel.getByLabel("入口名称", { exact: true }).fill("Responses");
      await panel.getByLabel("接口格式", { exact: true }).selectOption("openai-responses");
      await panel.getByLabel("接口地址", { exact: true }).fill(base);
      await panel.getByRole("button", { name: "保存 Provider", exact: true }).click();
      const record = panel
        .locator(".provider-record")
        .filter({ has: page.getByText(name, { exact: true }) });
      await expect(record.getByText("2 个模型已同步", { exact: true })).toBeVisible();
      const configuration = await (await page.request.get("/api/provider-configuration")).json();
      const provider = configuration.providers.find((item: { name: string }) => item.name === name);
      expect(
        configuration.models.filter(
          (item: { providerId: string }) => item.providerId === provider.id,
        ),
      ).toHaveLength(2);
      await nav("模型库").click();
      await panel.getByLabel("模型库 Provider 筛选", { exact: true }).selectOption(provider.id);
      await panel.getByRole("button", { name: "编辑参数 settings-model-b", exact: true }).click();
      await panel.getByLabel("上下文窗口", { exact: true }).fill("512000");
      await panel.getByText("价格覆盖（Token、缓存、按次与阶梯）", { exact: true }).click();
      await panel.getByLabel("输入价格", { exact: true }).fill("0");
      await panel.getByLabel("输出价格", { exact: true }).fill("10");
      await panel.getByRole("button", { name: "保存参数覆盖", exact: true }).click();
      await expect(panel.getByText("512,000", { exact: true })).toBeVisible();
      await panel.getByRole("button", { name: "编辑参数 settings-model-b", exact: true }).click();
      await panel.getByRole("button", { name: "恢复全部自动参数", exact: true }).click();
      await expect(panel.getByText("256,000", { exact: true })).toBeVisible();
      await expect(panel.getByText("输入 $3", { exact: true })).toBeVisible();
      await nav("引擎与安装").click();
      const row = page.locator(".engine-row").filter({
        has: page.locator("summary > .health-row__title > strong").filter({ hasText: /^Codex$/ }),
      });
      await row.locator(":scope > summary").click();
      await row.getByLabel("Codex Provider", { exact: true }).selectOption(provider.id);
      await expect(row.getByRole("combobox")).toHaveCount(2);
      await row.getByRole("button", { name: "保存并用于新对话", exact: true }).click();
      await expect(row.locator(".health-row__title")).toContainText("对话中选模型");
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(
        false,
      );
      await page.screenshot({
        path: resolve(
          screenshots,
          mobile ? "settings-mobile-provider.png" : "settings-desktop-provider.png",
        ),
        fullPage: true,
      });
      await page.locator(".page-content").evaluate((element) => {
        element.scrollTop = 0;
      });
      await page.screenshot({
        path: resolve(screenshots, mobile ? "settings-mobile.png" : "settings-desktop.png"),
        fullPage: true,
      });
      await page.screenshot({ path: testInfo.outputPath("engine-settings.png"), fullPage: true });
      await row.getByText("历史配置与模型映射", { exact: true }).click();
      const history = row.getByLabel("Codex 历史配置", { exact: true });
      const selected = await history.inputValue();
      await history.selectOption("");
      await expect(history).toHaveValue("");
      await history.selectOption(selected);
      await expect(history).toHaveValue(selected);
      if (mobile) await nav("会话").click();
      else await nav("返回对话").click();
      await nav("新建会话").click();
      await nav("Harness").click();
      await page.locator('.ios-popover [role="option"][data-value="codex"]').click();
      await nav("模型配置").click();
      await page.getByRole("option").filter({ hasText: "settings-model-b" }).click();
      await page.getByRole("button", { name: "创建会话", exact: true }).click();
      await expect
        .poll(async () =>
          (await (await page.request.get("/api/snapshot")).json()).sessions.some(
            (session: { bindingId: string; model: string }) =>
              session.bindingId === selected && session.model === "settings-model-b",
          ),
        )
        .toBe(true);
      await expect(page.getByRole("button", { name: "创建会话", exact: true })).toHaveCount(0);
      await nav("模型配置").click();
      await page.locator('.ms-popover [data-value="settings-model-a"]').click();
      await expect
        .poll(async () =>
          (await (await page.request.get("/api/snapshot")).json()).sessions.some(
            (session: { bindingId: string; model: string }) =>
              session.bindingId === selected && session.model === "settings-model-a",
          ),
        )
        .toBe(true);
      expect(errors).toEqual([]);
    } finally {
      const current = await (await page.request.get("/api/app-settings")).json();
      await page.request.patch("/api/app-settings", {
        data: { ...previous, revision: current.revision },
      });
      const defaults = (await (await page.request.get("/api/snapshot")).json()).bindingDefaults;
      await page.request.patch("/api/binding-defaults", {
        data: {
          expectedRevision: defaults.revision,
          harnessBindingIds: priorDefaults.harnessBindingIds,
        },
      });
    }
  });
