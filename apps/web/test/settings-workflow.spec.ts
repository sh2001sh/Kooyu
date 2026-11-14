import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";

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
  test(
    (mobile ? "mobile" : "desktop") +
      ": preferences, source discovery, engine binding and chat model",
    async ({ page }) => {
      test.setTimeout(60000);
      if (mobile) await page.setViewportSize({ width: 390, height: 844 });
      const previous = await (await page.request.get("/api/app-settings")).json();
      const priorDefaults = (await (await page.request.get("/api/snapshot")).json())
        .bindingDefaults;
      const section = (name: string) =>
        page
          .getByRole("navigation", { name: mobile ? "配置页面" : "配置导航" })
          .getByRole("button", { name, exact: true });
      try {
        await page.goto("/");
        await page.getByRole("button", { name: mobile ? "配置" : "设置", exact: true }).click();
        await section("通用").click();
        const shortcut = page.getByLabel("发送快捷键", { exact: true });
        const currentShortcut = await shortcut.inputValue();
        await shortcut.selectOption(currentShortcut === "mod-enter" ? "enter" : "mod-enter");
        await page.getByRole("button", { name: "保存", exact: true }).click();
        await expect(page.getByText("已保存", { exact: true })).toBeVisible();
        await page.reload();
        await page.getByRole("button", { name: mobile ? "配置" : "设置", exact: true }).click();
        await section("通用").click();
        await expect(shortcut).toHaveValue(currentShortcut === "mod-enter" ? "enter" : "mod-enter");
        await page.getByLabel("消息字号", { exact: true }).selectOption("18");
        await page.getByRole("switch", { name: "减少动态效果", exact: true }).check();
        await page.getByLabel("指令内容", { exact: true }).fill("请用中文回复，并说明验证结果。");
        await page.getByRole("button", { name: "保存", exact: true }).click();
        await expect(page.locator("html")).toHaveAttribute("data-reduce-motion", "true");
        await section("模型来源").click();
        await page.getByRole("button", { name: "添加来源", exact: true }).click();
        const name = "Settings Provider " + (mobile ? "mobile" : "desktop");
        await page.getByLabel("名称", { exact: true }).fill(name);
        await page.getByLabel("接口格式", { exact: true }).selectOption("openai-responses");
        await page.getByLabel("接口地址", { exact: true }).fill(base);
        await page.getByRole("button", { name: "保存", exact: true }).click();
        const card = page
          .locator(".sx-section")
          .filter({ has: page.locator(".sx-provider-name").filter({ hasText: name }) });
        await expect(card.getByText("2 个模型", { exact: true })).toBeVisible();
        const config = await (await page.request.get("/api/provider-configuration")).json();
        const provider = config.providers.find((item: { name: string }) => item.name === name);
        expect(
          config.models.filter((item: { providerId: string }) => item.providerId === provider.id),
        ).toHaveLength(2);
        await section("引擎").click();
        const engine = page
          .locator(".sx-engine")
          .filter({ has: page.locator("summary strong").filter({ hasText: /^Codex$/ }) });
        await engine.locator(":scope > summary").click();
        await engine
          .locator('select[id="src-codex"]')
          .selectOption(provider.id + ":" + provider.endpoints[0].id);
        await expect
          .poll(
            async () =>
              (await (await page.request.get("/api/snapshot")).json()).bindingDefaults
                .harnessBindingIds.codex,
          )
          .toBeTruthy();
        const bound = (await (await page.request.get("/api/snapshot")).json()).bindingDefaults
          .harnessBindingIds.codex;
        await page.getByRole("button", { name: mobile ? "会话" : "返回对话", exact: true }).click();
        await page.getByRole("button", { name: "新建会话", exact: true }).click();
        await page.getByRole("button", { name: "Harness", exact: true }).click();
        await page.locator('.ios-popover [role="option"][data-value="codex"]').click();
        await page.getByRole("button", { name: "模型配置", exact: true }).click();
        await page.getByRole("option").filter({ hasText: "settings-model-b" }).click();
        await page.getByRole("button", { name: "创建会话", exact: true }).click();
        await expect
          .poll(async () =>
            (await (await page.request.get("/api/snapshot")).json()).sessions.some(
              (session: { bindingId: string; model: string }) =>
                session.bindingId === bound && session.model === "settings-model-b",
            ),
          )
          .toBe(true);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true);
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
    },
  );
