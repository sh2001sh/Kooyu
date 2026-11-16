import { test, expect } from "@playwright/test";
import type { CatalogModel } from "@kodo/protocol";
import { groupCatalogModels } from "../src/lib/catalog-models";

test.use({ locale: "zh-CN" });

test("model grouping uses exact API IDs and retains source records", () => {
  const model = { id: "source-a", model: "model-x", name: "Same display name" } as CatalogModel;
  const otherSource = { ...model, id: "source-b" };
  const otherModel = { ...model, id: "other-model", model: "model-x-preview" };
  const groups = groupCatalogModels([model, otherSource, model, otherModel]);
  expect(groups.map((group) => group.model)).toEqual(["model-x", "model-x-preview"]);
  expect(groups[0]!.sources).toEqual([model, otherSource]);
  expect(groups[1]!.sources).toEqual([otherModel]);
});

for (const width of [1440, 390]) {
  test(`same model appears once across providers and endpoints at ${width}px`, async ({
    page,
  }, testInfo) => {
    page.setDefaultTimeout(10000);
    await page.setViewportSize({ width, height: 960 });
    const providers: { id: string; name: string; endpoints: { id: string }[] }[] = [];
    const modelName = `synthetic-shared-${width}`;
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      for (const name of ["Synthetic source A", "Synthetic source B"]) {
        const created = await page.request.post("/api/providers", {
          data: {
            name,
            endpoints: [
              { name: "Responses", protocol: "openai-responses", baseUrl: "http://127.0.0.1:1/v1" },
              ...(name.endsWith("A")
                ? [
                    {
                      name: "Chat",
                      protocol: "openai-completions",
                      baseUrl: "http://127.0.0.1:1/v1",
                    },
                  ]
                : []),
            ],
          },
        });
        expect(created.ok()).toBe(true);
        providers.push(await created.json());
      }
      const models: CatalogModel[] = [];
      for (const provider of providers) {
        for (const endpoint of provider.endpoints) {
          const index = models.length;
          const created = await page.request.post("/api/provider-models", {
            data: {
              providerId: provider.id,
              endpointId: endpoint.id,
              model: modelName,
              overrides: {
                contextWindow: (index + 1) * 10000,
                maxOutputTokens: 1000,
                pricing: { input: index * 2, output: index * 2 + 1 },
              },
            },
          });
          expect(created.ok()).toBe(true);
          models.push(await created.json());
        }
      }
      const different = await page.request.post("/api/provider-models", {
        data: {
          providerId: providers[0]!.id,
          endpointId: providers[0]!.endpoints[0]!.id,
          model: `${modelName}-preview`,
        },
      });
      expect(different.ok()).toBe(true);
      await page.goto("/");
      if (width < 600) await page.getByRole("button", { name: "打开导航", exact: true }).click();
      await page
        .getByRole("navigation", { name: "系统工具", exact: true })
        .getByRole("button", { name: /^(设置|Harness 与配置)$/ })
        .click();
      await page
        .getByRole("navigation", { name: width < 600 ? "配置页面" : "配置导航", exact: true })
        .getByRole("button", { name: "模型来源", exact: true })
        .click();
      const table = page.getByRole("table", { name: "模型列表", exact: true });
      const row = table
        .locator("tbody tr")
        .filter({ hasText: modelName })
        .filter({
          has: page.locator(".sx-model-name").filter({ hasText: new RegExp(`^${modelName}$`) }),
        });
      await expect(table.locator("tbody tr").filter({ hasText: modelName })).toHaveCount(2);
      await expect(row).toHaveCount(1);
      const source = row.getByRole("combobox", { name: `模型 ${modelName} 的来源`, exact: true });
      await expect(source.locator("option")).toHaveCount(3);
      await expect(row.getByText("输入 $0", { exact: true })).toBeVisible();
      await source.selectOption(models[2]!.id);
      await expect(row.getByText("输入 $4", { exact: true })).toBeVisible();
      await expect(row.getByText("30,000", { exact: true })).toBeVisible();
      await row.getByRole("button", { name: "修改", exact: true }).click();
      const editor = table.locator("form.sx-model-editor");
      await expect(
        editor.getByText("当前来源：Synthetic source B · Responses", { exact: true }),
      ).toBeVisible();
      await editor.getByLabel("输入价格", { exact: true }).fill("7");
      await editor.getByRole("button", { name: "保存", exact: true }).click();
      await expect(editor).toHaveCount(0);
      await expect(row.getByText("输入 $7", { exact: true })).toBeVisible();
      const config = await (await page.request.get("/api/provider-configuration")).json();
      expect(
        config.models.find((model: CatalogModel) => model.id === models[0]!.id).overrides.pricing
          .input,
      ).toBe(0);
      expect(
        config.models.find((model: CatalogModel) => model.id === models[1]!.id).overrides.pricing
          .input,
      ).toBe(2);
      expect(
        config.models.find((model: CatalogModel) => model.id === models[2]!.id).overrides.pricing
          .input,
      ).toBe(7);
      await source.selectOption(models[1]!.id);
      await expect(row.getByText("输入 $2", { exact: true })).toBeVisible();
      await row.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: testInfo.outputPath(`model-sources-${width}.png`),
        fullPage: true,
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.getByLabel("模型来源筛选", { exact: true }).selectOption(providers[1]!.id);
      await expect(table.locator("tbody tr").filter({ hasText: modelName })).toHaveCount(1);
      await expect(row.getByText("输入 $7", { exact: true })).toBeVisible();
      await page.getByLabel("模型来源筛选", { exact: true }).selectOption("");
      await expect(table.locator("tbody tr").filter({ hasText: modelName })).toHaveCount(2);
      await expect(row.getByRole("combobox")).toHaveValue(models[1]!.id);
      expect(errors).toEqual([]);
    } finally {
      for (const provider of providers) await page.request.delete(`/api/providers/${provider.id}`);
    }
  });
}
