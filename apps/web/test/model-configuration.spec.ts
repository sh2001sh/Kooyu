import { test, expect } from "@playwright/test";

// Synthetic configuration only; no model inference or real Provider pricing is simulated.
for (const width of [1440, 390])
  test(`prices and unified reasoning settings at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 960 });
    const modelName = `synthetic-priced-model-${width}`;
    const providerResponse = await page.request.post("/api/providers", {
      data: {
        name: `Synthetic priced Provider ${width}`,
        endpoints: [
          { name: "Synthetic", protocol: "openai-responses", baseUrl: "http://127.0.0.1:1/v1" },
        ],
      },
    });
    expect(providerResponse.ok()).toBe(true);
    const provider = await providerResponse.json();
    const overrides = {
      contextWindow: 123456,
      maxOutputTokens: 2345,
      input: ["text"],
      reasoning: true,
      reasoningOptions: [{ type: "effort", values: ["low", "high"] }],
      thinkingLevelMap: { low: "low", high: "high", max: null },
      pricing: { input: 0, output: 2.5 },
    };
    const modelResponse = await page.request.post("/api/provider-models", {
      data: {
        providerId: provider.id,
        endpointId: provider.endpoints[0].id,
        model: modelName,
        overrides,
      },
    });
    expect(modelResponse.ok()).toBe(true);
    const model = await modelResponse.json();
    await page.goto("/");
    await page
      .getByRole("navigation", { name: width < 600 ? "移动端标签导航" : "系统工具", exact: true })
      .getByRole("button", { name: "设置", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: width < 600 ? "配置页面" : "配置导航" })
      .getByRole("button", { name: "模型来源", exact: true })
      .click();
    const providerCard = page.locator("section.sx-section").filter({
      has: page
        .locator(".sx-provider-name")
        .filter({ hasText: new RegExp(`^Synthetic priced Provider ${width}$`) }),
    });
    await providerCard.locator(".sx-provider-models__toggle").click();
    const record = providerCard
      .getByRole("table", { name: "模型列表" })
      .locator("tbody tr")
      .filter({ hasText: modelName });
    await expect(record.getByText("输入 $0", { exact: true })).toBeVisible();
    await expect(record.getByText("输出 $2.5", { exact: true })).toBeVisible();
    await record.getByRole("button", { name: "修改", exact: true }).click();
    const editor = page.locator("form.sx-model-editor");
    await editor.getByLabel("上下文窗口", { exact: true }).fill("234567");
    await editor.getByRole("button", { name: "保存", exact: true }).click();
    await expect(editor).toHaveCount(0);
    const config = await (await page.request.get("/api/provider-configuration")).json();
    const saved = config.models.find((item: { id: string }) => item.id === model.id);
    expect(saved.overrides.thinkingLevelMap).toEqual(overrides.thinkingLevelMap);
    expect(saved.overrides.reasoningOptions).toEqual(overrides.reasoningOptions);
    expect(saved.overrides.pricing).toEqual(overrides.pricing);
    expect(saved.effective.contextWindow).toBe(234567);
    await page.screenshot({
      path: testInfo.outputPath(`model-configuration-${width}.png`),
      fullPage: true,
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
