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
    if (width < 600) await page.getByRole("button", { name: "打开导航", exact: true }).click();
    await page.getByRole("button", { name: "Harness 与配置", exact: true }).first().click();
    await page.getByRole("button", { name: "模型库", exact: true }).first().click();
    const panel = page.getByRole("region", { name: "Provider 与模型配置" });
    const record = panel.locator(".provider-record").filter({
      has: page.getByText(modelName, { exact: true }),
    });
    await expect(record.getByText("输入 $0", { exact: true })).toBeVisible();
    await expect(record.getByText("输出 $2.5", { exact: true })).toBeVisible();
    await expect(record.getByText("参考价 · USD / 百万 Token", { exact: true })).toBeVisible();
    await record.getByRole("button", { name: `编辑参数 ${modelName}`, exact: true }).click();
    const editor = panel.locator("form.provider-editor");
    await editor.getByText("思考档位", { exact: true }).click();
    await expect(editor.getByLabel("支持的思考档位（JSON）")).toBeVisible();
    await expect(editor.getByLabel("档位映射覆盖（JSON）")).toBeHidden();
    await expect(editor.getByText("pi 思考映射覆盖（JSON）", { exact: true })).toHaveCount(0);
    await editor.getByText("引擎协议映射（高级）", { exact: true }).click();
    await expect(editor.getByLabel("档位映射覆盖（JSON）")).toHaveValue(
      JSON.stringify(overrides.thinkingLevelMap, null, 2),
    );
    await editor.getByLabel("上下文窗口", { exact: true }).fill("234567");
    await editor.getByRole("button", { name: "保存参数覆盖", exact: true }).click();
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
