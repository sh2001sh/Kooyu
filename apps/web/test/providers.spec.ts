import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";

// This local endpoint supplies explicitly synthetic model metadata only.
// No inference response or native harness integration is simulated by this UI test.
let fixture: Server, base: string;
test.beforeAll(async () => {
  fixture = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        data: [
          {
            id: "ui-synthetic-model",
            name: "UI synthetic metadata",
            contextWindow: 123456,
            maxInputTokens: 120000,
            maxOutputTokens: 2345,
            reasoning: true,
            reasoningOptions: [{ type: "effort", values: ["low", "high"] }],
            input: ["text"],
          },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  const address = fixture.address();
  if (!address || typeof address === "string") throw new Error("Metadata fixture address missing");
  base = `http://127.0.0.1:${address.port}/v1`;
});
test.afterAll(async () => {
  fixture.closeAllConnections();
  await new Promise<void>((resolve) => fixture.close(() => resolve()));
});

test("legacy configuration API and editor are absent", async ({ page }) => {
  await page.goto("/");
  const snapshot = await (await page.request.get("/api/snapshot")).json();
  expect(snapshot).not.toHaveProperty("profiles");
  expect((await page.request.get("/api/profiles")).status()).toBe(404);
  expect((await page.request.post("/api/profiles", { data: {} })).status()).toBe(404);
  await page.getByRole("button", { name: "设置", exact: true }).first().click();
  await expect(page.getByRole("navigation", { name: "配置导航" })).toBeVisible();
  await page
    .getByRole("navigation", { name: "配置导航" })
    .getByRole("button", { name: "高级", exact: true })
    .click();
  const config = page.getByRole("region", { name: "Provider 与模型配置" });
  await expect(config.getByRole("button", { name: /添加 Profile/ })).toHaveCount(0);
});

for (const mobile of [false, true])
  test(`${mobile ? "mobile" : "desktop"}: Provider → discovery → parameter override/restore → native binding → draft`, async ({
    page,
  }, testInfo) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const suffix = mobile ? "mobile" : "desktop",
      name = `Synthetic Provider ${suffix}`,
      bindingName = `Synthetic Codex ${suffix}`;
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    const beforeDefaults = (await (await page.request.get("/api/snapshot")).json()).bindingDefaults;
    await expect(page.getByText("Host 已连接", { exact: true })).toHaveCount(1);
    await page.getByRole("button", { name: "设置", exact: true }).first().click();
    await page
      .getByRole("navigation", { name: mobile ? "配置页面" : "配置导航" })
      .getByRole("button", { name: "模型来源", exact: true })
      .click();
    await page.getByRole("button", { name: "添加来源", exact: true }).click();
    await page.getByLabel("名称", { exact: true }).fill(name);
    await page.getByLabel("接口格式", { exact: true }).selectOption("openai-responses");
    await page.getByLabel("接口地址", { exact: true }).fill(base);
    await page.getByRole("button", { name: "再加一种接口格式" }).click();
    await page.getByLabel("接口名称", { exact: true }).first().fill("Responses");
    await page.getByLabel("接口名称", { exact: true }).last().fill("Messages");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    const record = page
      .locator(".sx-section")
      .filter({ has: page.locator(".sx-provider-name").filter({ hasText: name }) });
    await expect(record.getByText("2 个模型", { exact: true })).toBeVisible();
    const table = record.getByRole("table", { name: "模型列表", exact: true });
    const row = table.locator("tbody tr").filter({ hasText: "ui-synthetic-model" });
    await expect(row).toHaveCount(1);
    await row.getByRole("button", { name: "修改", exact: true }).click();
    const editor = table.locator("form.sx-model-editor");
    await editor.getByLabel("上下文窗口", { exact: true }).fill("654321");
    await editor.getByRole("button", { name: "保存", exact: true }).click();
    await expect(row.getByText("654,321", { exact: true })).toBeVisible();
    await row.getByRole("button", { name: "修改", exact: true }).click();
    await editor.getByRole("button", { name: "恢复自动", exact: true }).click();
    await expect(row.getByText("123,456", { exact: true })).toBeVisible();
    const config = page.getByRole("region", { name: "Provider 与模型配置" });
    if (mobile) {
      await page.getByRole("button", { name: "返回设置列表", exact: true }).click();
    }
    await page.getByRole("button", { name: "高级", exact: true }).first().click();
    await config.getByRole("button", { name: "添加 Harness 绑定", exact: true }).click();
    await config.getByLabel("绑定名称", { exact: true }).fill(bindingName);
    await config.getByLabel("目标 Harness", { exact: true }).selectOption("codex");
    // Providers from earlier cases remain in this isolated UI Host.
    const current: any = await (await page.request.get("/api/provider-configuration")).json();
    const p = current.providers.find((p: any) => p.name === name),
      model = current.models.find((m: any) => m.providerId === p.id);
    await config.getByLabel("Provider 与模型", { exact: true }).selectOption(model.id);
    await config.getByLabel("默认思考强度", { exact: true }).selectOption("high");
    await expect(config.getByText("可保存 · 原生协议直连", { exact: true })).toBeVisible();
    await config.getByRole("button", { name: "保存 Harness 绑定", exact: true }).click();
    await expect(config.getByText(bindingName, { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`${suffix}-binding.png`), fullPage: true });
    for (const id of ["deepseek-harness", "zcode", "kimi-code", "grok-build"]) {
      await config.getByRole("button", { name: "添加 Harness 绑定", exact: true }).click();
      await config.getByLabel("目标 Harness", { exact: true }).selectOption(id);
      await config.getByLabel("设为该 Harness 的新会话默认配置").check();
      await expect(config.getByLabel("目标 Harness", { exact: true })).toHaveValue(id);
      await config.getByLabel("绑定名称", { exact: true }).fill(`${bindingName}-${id}`);
      await config.getByLabel("Provider 与模型", { exact: true }).selectOption(model.id);
      await config.getByLabel("默认思考强度", { exact: true }).selectOption("high");
      await expect(config.getByText("可保存 · 原生协议直连", { exact: true })).toBeVisible();
      await config.getByRole("button", { name: "保存 Harness 绑定", exact: true }).click();
      await expect(config.getByText(`${bindingName}-${id}`, { exact: true })).toBeVisible();
      const applied = await (await page.request.get("/api/snapshot")).json();
      const saved = (
        await (await page.request.get("/api/provider-configuration")).json()
      ).bindings.find((b: any) => b.name === `${bindingName}-${id}`);
      expect(applied.bindingDefaults.harnessBindingIds[id]).toBe(saved.id);
    }
    await config.getByRole("button", { name: "添加 Harness 绑定", exact: true }).click();
    await config.getByLabel("目标 Harness", { exact: true }).selectOption("cursor");
    await expect(
      config.getByRole("button", { name: "保存 Harness 绑定", exact: true }),
    ).toBeDisabled();
    await config.getByRole("button", { name: "关闭配置编辑", exact: true }).click();
    const googleProvider = await (
      await page.request.post("/api/providers", {
        data: {
          name: `Synthetic Google ${suffix}`,
          endpoints: [{ name: "Google", protocol: "google-generative-ai", baseUrl: base }],
        },
      })
    ).json();
    const googleModel = await (
      await page.request.post("/api/provider-models", {
        data: {
          providerId: googleProvider.id,
          endpointId: googleProvider.endpoints[0].id,
          model: "synthetic-google",
          overrides: {
            contextWindow: 123456,
            maxOutputTokens: 2345,
            reasoning: true,
            reasoningOptions: [{ type: "effort", values: ["low", "high"] }],
            input: ["text"],
          },
        },
      })
    ).json();
    await page.reload();
    await page.getByRole("button", { name: "设置", exact: true }).first().click();
    await page.getByRole("button", { name: "高级", exact: true }).first().click();
    await config.getByRole("button", { name: "添加 Harness 绑定", exact: true }).click();
    await config.getByLabel("目标 Harness", { exact: true }).selectOption("gemini");
    await config.getByLabel("设为该 Harness 的新会话默认配置").check();
    await expect(config.getByLabel("目标 Harness", { exact: true })).toHaveValue("gemini");
    await config.getByLabel("绑定名称", { exact: true }).fill(`${bindingName}-gemini`);
    await config.getByLabel("Provider 与模型", { exact: true }).selectOption(googleModel.id);
    await config.getByLabel("默认思考强度", { exact: true }).selectOption("high");
    await expect(config.getByText("可保存 · 原生协议直连", { exact: true })).toBeVisible();
    await config.getByRole("button", { name: "保存 Harness 绑定", exact: true }).click();
    await expect(config.getByText(`${bindingName}-gemini`, { exact: true })).toBeVisible();
    const chatProvider = await (
      await page.request.post("/api/providers", {
        data: {
          name: `Synthetic Chat ${suffix}`,
          endpoints: [{ name: "Chat", protocol: "openai-completions", baseUrl: base }],
        },
      })
    ).json();
    const chatModel = await (
      await page.request.post("/api/provider-models", {
        data: {
          providerId: chatProvider.id,
          endpointId: chatProvider.endpoints[0].id,
          model: "synthetic-chat-model",
          overrides: {
            contextWindow: 123456,
            maxOutputTokens: 2345,
            reasoning: true,
            reasoningOptions: [{ type: "effort", values: ["low", "high"] }],
            input: ["text"],
          },
        },
      })
    ).json();
    await page.reload();
    await page.getByRole("button", { name: "设置", exact: true }).first().click();
    await page.getByRole("button", { name: "高级", exact: true }).first().click();
    await config.getByRole("button", { name: "添加 Harness 绑定", exact: true }).click();
    await config.getByLabel("目标 Harness", { exact: true }).selectOption("gemini");
    await config.getByLabel("设为该 Harness 的新会话默认配置").check();
    await config.getByLabel("绑定名称", { exact: true }).fill(`${bindingName}-gemini-chat`);
    await config.getByLabel("Provider 与模型", { exact: true }).selectOption(chatModel.id);
    await config.getByLabel("默认思考强度", { exact: true }).selectOption("high");
    await expect(config.getByText("可保存 · 本地转换网关", { exact: true })).toBeVisible();
    await config.getByRole("button", { name: "保存 Harness 绑定", exact: true }).click();
    await expect(config.getByText(`${bindingName}-gemini-chat`, { exact: true })).toBeVisible();
    const bridgeBinding = (
      await (await page.request.get("/api/provider-configuration")).json()
    ).bindings.find((b: any) => b.name === `${bindingName}-gemini-chat`);
    expect(bridgeBinding.route).toBe("gateway");
    expect(
      (await (await page.request.get("/api/snapshot")).json()).bindingDefaults.harnessBindingIds
        .gemini,
    ).toBe(bridgeBinding.id);
    await page.screenshot({
      path: testInfo.outputPath(`${suffix}-all-harness-bindings.png`),
      fullPage: true,
    });
    // A mismatched harness must be shown as unavailable, without creating a binding.
    await config.getByRole("button", { name: "添加 Harness 绑定", exact: true }).click();
    await config.getByLabel("目标 Harness", { exact: true }).selectOption("gemini");
    await config.getByLabel("Provider 与模型", { exact: true }).selectOption(model.id);
    await expect(
      config.getByRole("button", { name: "保存 Harness 绑定", exact: true }),
    ).toBeDisabled();
    await config.getByRole("button", { name: "关闭配置编辑", exact: true }).click();
    if (mobile) {
      await page.getByRole("button", { name: "返回设置列表", exact: true }).click();
      await page
        .getByRole("navigation", { name: "移动端标签导航", exact: true })
        .getByRole("button", { name: "对话", exact: true })
        .click();
    } else {
      await page.getByRole("button", { name: "返回对话", exact: true }).click();
      await expect(page.locator(".session-rows")).toBeVisible();
    }
    await page.getByRole("button", { name: "新建会话", exact: true }).first().click();
    if (mobile) {
      await page.getByRole("button", { name: "切换对话引擎", exact: true }).click();
      await page
        .getByRole("dialog", { name: "选择对话引擎" })
        .locator('[role="option"][data-value="codex"]')
        .click();
    } else {
      await page.getByRole("button", { name: "Harness", exact: true }).click();
      await page.locator('.ios-popover [role="option"][data-value="codex"]').click();
    }
    await page.getByRole("button", { name: "模型配置", exact: true }).click();
    await page.getByRole("option").filter({ hasText: bindingName }).click();
    await page.getByRole("button", { name: "模型配置", exact: true }).click();
    await expect(page.getByText("123,456 tokens", { exact: true })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    );
    expect(overflow).toBe(false);
    expect(errors).toEqual([]);
    const afterDefaults = (await (await page.request.get("/api/snapshot")).json()).bindingDefaults;
    await page.request.patch("/api/binding-defaults", {
      data: {
        expectedRevision: afterDefaults.revision,
        harnessBindingIds: beforeDefaults.harnessBindingIds,
      },
    });
  });
