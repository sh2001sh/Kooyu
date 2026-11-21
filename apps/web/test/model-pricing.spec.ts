import { test, expect } from "@playwright/test";

test.use({ locale: "zh-CN" });

// Isolated configuration fixtures only: no inference or real price claims.
for (const width of [1440, 390])
  test(`model pricing: cache, request, tiers and zero persist at ${width}px`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(90000);
    page.setDefaultTimeout(10000);
    await page.setViewportSize({ width, height: 960 });
    const providerName = `Synthetic pricing ${width}`,
      modelName = `synthetic-pricing-${width}`;
    const response = await page.request.post("/api/providers", {
      data: {
        name: providerName,
        endpoints: [
          { name: "Local", protocol: "openai-responses", baseUrl: "http://127.0.0.1:1/v1" },
        ],
      },
    });
    expect(response.ok()).toBe(true);
    const provider = await response.json();
    const created = await page.request.post("/api/provider-models", {
      data: {
        providerId: provider.id,
        endpointId: provider.endpoints[0].id,
        model: modelName,
        overrides: {
          contextWindow: 100000,
          maxOutputTokens: 1000,
          pricing: { input: 0, output: 2.5, cacheRead: 0.1, cacheWrite: 0.3 },
        },
      },
    });
    expect(created.ok()).toBe(true);
    const model = await created.json();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const openSettings = async () => {
      await page.goto("/");
      await page
        .getByRole("navigation", { name: width < 600 ? "移动端标签导航" : "系统工具", exact: true })
        .getByRole("button", { name: /^(设置|Harness 与配置)$/ })
        .click();
      await page
        .getByRole("navigation", { name: width < 600 ? "配置页面" : "配置导航", exact: true })
        .getByRole("button", { name: "模型来源", exact: true })
        .click();
      await section.getByRole("button", { name: /模型列表/ }).click();
    };
    const section = page
      .locator("section.sx-section")
      .filter({ has: page.locator(".sx-provider-name").filter({ hasText: provider.name }) });
    const row = section.locator("tbody tr").filter({ hasText: modelName });
    const editor = section.locator("form.sx-model-editor");
    const savedPricing = async () => {
      const config = await (await page.request.get("/api/provider-configuration")).json();
      return config.models.find((m: { id: string }) => m.id === model.id).overrides.pricing;
    };
    try {
      await openSettings();
      await expect(row.getByText("输入 $0", { exact: true })).toBeVisible();
      await expect(row.getByText("缓存读取 $0.1", { exact: true })).toBeVisible();
      await expect(row.getByText("缓存写入 $0.3", { exact: true })).toBeVisible();
      await row.getByRole("button", { name: "修改", exact: true }).click();
      for (const label of [
        "输入价格",
        "输出价格",
        "缓存读取价格",
        "缓存写入价格",
        "每次请求价格",
      ]) {
        await expect(editor.getByLabel(label, { exact: true })).toHaveAttribute("min", "0");
        await editor.getByLabel(label, { exact: true }).fill("0");
      }
      await editor.getByLabel("计费方式", { exact: true }).selectOption("hybrid");
      await editor.getByLabel("阶梯计价", { exact: true }).selectOption("custom");
      await editor.getByLabel("第 1 档输入 Token 上限", { exact: true }).fill("128000");
      await editor.getByLabel("第 1 档输入价格", { exact: true }).fill("0");
      await editor.getByLabel("第 1 档输出价格", { exact: true }).fill("0");
      await editor.getByRole("button", { name: "添加价格阶梯", exact: true }).click();
      await editor.getByLabel("第 2 档输入价格", { exact: true }).fill("2");
      await editor.getByLabel("第 2 档输出价格", { exact: true }).fill("8");
      await editor.getByLabel("第 2 档缓存读取价格", { exact: true }).fill("0.25");
      await editor.getByLabel("第 2 档缓存写入价格", { exact: true }).fill("1");
      await editor.getByLabel("第 2 档每次请求价格", { exact: true }).fill("0.002");
      await editor.getByRole("button", { name: "保存", exact: true }).click();
      await expect(editor).toHaveCount(0);
      expect(await savedPricing()).toEqual({
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        perRequest: 0,
        billingMode: "hybrid",
        tiers: [
          { upToInputTokens: 128000, input: 0, output: 0 },
          { input: 2, output: 8, cacheRead: 0.25, cacheWrite: 1, perRequest: 0.002 },
        ],
      });
      await openSettings();
      await row.getByText("阶梯计价 · 2 档", { exact: true }).click();
      await expect(row.getByText("缓存写入 $1 / 百万 Token", { exact: true })).toBeVisible();
      await row.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: testInfo.outputPath(`pricing-summary-${width}.png`),
        fullPage: true,
      });
      await row.getByRole("button", { name: "修改", exact: true }).click();
      await expect(editor.getByLabel("缓存读取价格", { exact: true })).toHaveValue("0");
      await expect(editor.getByLabel("第 2 档每次请求价格", { exact: true })).toHaveValue("0.002");
      if (width < 600) {
        const inputBox = await editor.getByLabel("输入价格", { exact: true }).boundingBox();
        expect(inputBox!.width).toBeGreaterThan(240);
        expect(inputBox!.height).toBeGreaterThanOrEqual(44);
        const priceBox = await editor.locator(".model-pricing-editor").boundingBox();
        expect(priceBox!.width).toBeGreaterThan(280);
      }
      await editor.getByLabel("缓存写入价格", { exact: true }).fill("-1");
      expect(
        await editor
          .getByLabel("缓存写入价格", { exact: true })
          .evaluate((el: HTMLInputElement) => el.validity.rangeUnderflow),
      ).toBe(true);
      await editor.getByRole("button", { name: "保存", exact: true }).click();
      await expect(editor).toBeVisible();
      expect((await savedPricing()).cacheWrite).toBe(0);
      await editor.getByLabel("缓存写入价格", { exact: true }).fill("0");
      await editor.getByLabel("第 2 档输入 Token 上限", { exact: true }).fill("100");
      await editor.getByRole("button", { name: "保存", exact: true }).click();
      await expect(
        page.getByText("阶梯的输入 Token 上限必须是递增的正整数。", { exact: true }),
      ).toBeVisible();
      await editor.getByLabel("第 2 档输入 Token 上限", { exact: true }).fill("");
      await editor.evaluate((element) => element.scrollIntoView({ block: "start" }));
      await page.screenshot({
        path: testInfo.outputPath(`pricing-editor-${width}.png`),
        fullPage: true,
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await editor.getByLabel("计费方式", { exact: true }).selectOption("request");
      await editor.getByLabel("阶梯计价", { exact: true }).selectOption("off");
      await editor.getByRole("button", { name: "保存", exact: true }).click();
      await expect(editor).toHaveCount(0);
      await expect(row.getByText("按次 $0 / 次", { exact: true })).toBeVisible();
      await expect(row.getByText("按次计费 · USD / 次", { exact: true })).toBeVisible();
      expect((await savedPricing()).tiers).toEqual([]);
      await row.getByRole("button", { name: "修改", exact: true }).click();
      await editor.getByLabel("缓存读取价格", { exact: true }).fill("");
      await editor.getByRole("button", { name: "保存", exact: true }).click();
      await expect(editor).toHaveCount(0);
      expect(await savedPricing()).not.toHaveProperty("cacheRead");
      expect(errors).toEqual([]);
    } finally {
      await page.request.delete(`/api/providers/${provider.id}`);
    }
  });
