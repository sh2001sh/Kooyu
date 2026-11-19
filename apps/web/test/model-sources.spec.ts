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

for (const width of [1440, 1024, 390]) {
  test(`models render under each provider with no right-edge clipping at ${width}px`, async ({
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
      await page
        .getByRole("navigation", { name: width < 600 ? "移动端标签导航" : "系统工具", exact: true })
        .getByRole("button", { name: /^(设置|Harness 与配置)$/ })
        .click();
      await page
        .getByRole("navigation", { name: width < 600 ? "配置页面" : "配置导航", exact: true })
        .getByRole("button", { name: "模型来源", exact: true })
        .click();

      // No separate global "全部来源" table section at bottom
      await expect(page.getByLabel("模型来源筛选", { exact: true })).toHaveCount(0);

      // Provider A (2 endpoints: Responses + Chat) renders its own models directly under Provider A
      const cardA = page.locator("section.sx-section").filter({
        has: page.locator(".sx-provider-name").filter({ hasText: /^Synthetic source A$/ }),
      });
      const tableA = cardA.getByRole("table", { name: "模型列表", exact: true });
      const rowA = tableA.locator("tbody tr").filter({
        has: page.locator(".sx-model-name").filter({ hasText: new RegExp(`^${modelName}$`) }),
      });
      await expect(tableA.locator("tbody tr")).toHaveCount(2);
      await expect(rowA).toHaveCount(1);
      const endpointSelect = rowA.getByRole("combobox", {
        name: `模型 ${modelName} 的来源`,
        exact: true,
      });
      await expect(endpointSelect.locator("option")).toHaveCount(2);
      await expect(rowA.getByText("输入 $0", { exact: true })).toBeVisible();
      await endpointSelect.selectOption(models[1]!.id);
      await expect(rowA.getByText("输入 $2", { exact: true })).toBeVisible();
      await expect(rowA.getByText("20,000", { exact: true })).toBeVisible();

      // Provider B (1 endpoint) renders its own models directly under Provider B without redundant 来源 column
      const cardB = page.locator("section.sx-section").filter({
        has: page.locator(".sx-provider-name").filter({ hasText: /^Synthetic source B$/ }),
      });
      const tableB = cardB.getByRole("table", { name: "模型列表", exact: true });
      const rowB = tableB.locator("tbody tr").filter({
        has: page.locator(".sx-model-name").filter({ hasText: new RegExp(`^${modelName}$`) }),
      });
      await expect(tableB.locator("tbody tr")).toHaveCount(1);
      await expect(tableB.locator("thead th").filter({ hasText: /^来源|接口$/ })).toHaveCount(0);
      await expect(rowB.getByText("输入 $4", { exact: true })).toBeVisible();
      await expect(rowB.getByText("30,000", { exact: true })).toBeVisible();

      // Verify right-edge "修改" button is never clipped outside its table card container
      for (const [card, row] of [
        [cardA, rowA],
        [cardB, rowB],
      ] as const) {
        const scrollWrap = card.locator(".sx-model-table-card");
        const editBtn = row.getByRole("button", { name: "修改", exact: true });
        await editBtn.scrollIntoViewIfNeeded();
        const wrapBox = await scrollWrap.boundingBox();
        const btnBox = await editBtn.boundingBox();
        expect(wrapBox).not.toBeNull();
        expect(btnBox).not.toBeNull();
        expect(btnBox!.x + btnBox!.width).toBeLessThanOrEqual(wrapBox!.x + wrapBox!.width + 1);
      }

      // Edit Provider B's model without disturbing Provider A's models
      await rowB.getByRole("button", { name: "修改", exact: true }).click();
      const editorB = tableB.locator("form.sx-model-editor");
      await expect(
        editorB.getByText("当前来源：Synthetic source B · Responses", { exact: true }),
      ).toBeVisible();
      await editorB.getByLabel("输入价格", { exact: true }).fill("7");
      await editorB.getByRole("button", { name: "保存", exact: true }).click();
      await expect(editorB).toHaveCount(0);
      await expect(rowB.getByText("输入 $7", { exact: true })).toBeVisible();

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

      await page.screenshot({
        path: process.env.HIG_SHOT_DIR
          ? `${process.env.HIG_SHOT_DIR}/model-sources-${width}.png`
          : testInfo.outputPath(`model-sources-${width}.png`),
        fullPage: true,
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(errors).toEqual([]);
    } finally {
      for (const provider of providers) await page.request.delete(`/api/providers/${provider.id}`);
    }
  });
}

test("provider card '应用到' binds and unbinds compatible harnesses directly", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  const priorDefaults = (await (await page.request.get("/api/snapshot")).json()).bindingDefaults;
  let providerId: string | null = null;
  try {
    const pRes = await page.request.post("/api/providers", {
      data: {
        name: "Quick Apply Provider",
        endpoints: [
          { name: "Responses", protocol: "openai-responses", baseUrl: "http://127.0.0.1:1/v1" },
        ],
      },
    });
    expect(pRes.ok()).toBe(true);
    const provider = await pRes.json();
    providerId = provider.id;

    const mRes = await page.request.post("/api/provider-models", {
      data: {
        providerId: provider.id,
        endpointId: provider.endpoints[0].id,
        model: "quick-apply-model",
        overrides: {
          contextWindow: 128000,
          maxOutputTokens: 8192,
          input: ["text"],
          reasoning: true,
          reasoningOptions: [{ type: "effort", values: ["low", "high"] }],
        },
      },
    });
    expect(mRes.ok()).toBe(true);

    await page.goto("/");
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page
      .getByRole("navigation", { name: "配置导航", exact: true })
      .getByRole("button", { name: "模型来源", exact: true })
      .click();

    const card = page.locator("section.sx-section").filter({
      has: page.locator(".sx-provider-name").filter({ hasText: /^Quick Apply Provider$/ }),
    });
    const cardHeightBefore = (await card.boundingBox())!.height;
    await card.getByRole("button", { name: "应用到", exact: true }).click();

    const applyDialog = page.getByRole("dialog", { name: "将 Quick Apply Provider 应用到引擎" });
    await expect(applyDialog).toBeVisible();
    // Provider card itself must not expand or jump when modal opens
    expect(Math.abs((await card.boundingBox())!.height - cardHeightBefore)).toBeLessThanOrEqual(2);

    // Apply to Codex in 1 click inside the modal
    const codexBtn = applyDialog.locator(".sx-apply-row__btn").filter({ hasText: /^Codex/ });
    await codexBtn.click();
    await expect(codexBtn).toHaveAttribute("aria-pressed", "true");
    await expect(card.getByText("1 个引擎在用", { exact: true })).toBeVisible();

    const snapApplied = await (await page.request.get("/api/snapshot")).json();
    const codexBinding = snapApplied.bindings.find(
      (b: { id: string }) => b.id === snapApplied.bindingDefaults.harnessBindingIds.codex,
    );
    expect(codexBinding?.providerId).toBe(provider.id);

    if (process.env.HIG_SHOT_DIR) {
      await page.screenshot({
        path: `${process.env.HIG_SHOT_DIR}/provider-apply-modal-1440.png`,
        fullPage: false,
      });
    }

    // Mobile 390px Bottom Sheet verification while open
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(applyDialog).toBeVisible();
    await page.waitForTimeout(340);
    const box390 = await applyDialog.boundingBox();
    expect(box390!.y + box390!.height).toBeGreaterThanOrEqual(840);
    expect(box390!.height).toBeGreaterThan(360);
    if (process.env.HIG_SHOT_DIR) {
      await page.screenshot({
        path: `${process.env.HIG_SHOT_DIR}/provider-apply-sheet-390.png`,
        fullPage: false,
      });
    }
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.waitForTimeout(300);

    // Click Codex again to restore native config, then close with Escape
    await codexBtn.click();
    await expect(codexBtn).toHaveAttribute("aria-pressed", "false");
    await expect(card.getByText("尚未被引擎使用", { exact: true })).toBeVisible();
    const snapCleared = await (await page.request.get("/api/snapshot")).json();
    expect(snapCleared.bindingDefaults.harnessBindingIds.codex).toBeNull();

    await page.keyboard.press("Escape");
    await expect(applyDialog).toHaveCount(0);
  } finally {
    if (providerId) await page.request.delete(`/api/providers/${providerId}`).catch(() => {});
    const defaults = (await (await page.request.get("/api/snapshot")).json()).bindingDefaults;
    await page.request.patch("/api/binding-defaults", {
      data: {
        expectedRevision: defaults.revision,
        harnessBindingIds: priorDefaults.harnessBindingIds,
      },
    });
  }
});

test("provider '应用到' modal auto-expands and persists Claude Code role model mapping", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  const priorDefaults = (await (await page.request.get("/api/snapshot")).json()).bindingDefaults;
  const priorSettings = await (await page.request.get("/api/app-settings")).json();
  let providerId: string | null = null;
  try {
    const pRes = await page.request.post("/api/providers", {
      data: {
        name: "Anthropic Relay",
        endpoints: [
          {
            name: "Messages",
            protocol: "anthropic-messages",
            baseUrl: "http://127.0.0.1:1/anthropic",
          },
        ],
      },
    });
    expect(pRes.ok()).toBe(true);
    const provider = await pRes.json();
    providerId = provider.id;

    for (const model of ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5"]) {
      const mRes = await page.request.post("/api/provider-models", {
        data: {
          providerId: provider.id,
          endpointId: provider.endpoints[0].id,
          model,
          overrides: {
            contextWindow: 200000,
            maxOutputTokens: 16384,
            input: ["text", "image"],
            reasoning: true,
            reasoningOptions: [{ type: "effort", values: ["low", "high"] }],
          },
        },
      });
      expect(mRes.ok()).toBe(true);
    }

    await page.goto("/");
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page
      .getByRole("navigation", { name: "配置导航", exact: true })
      .getByRole("button", { name: "模型来源", exact: true })
      .click();

    const card = page
      .locator("section.sx-section")
      .filter({ has: page.locator(".sx-provider-name").filter({ hasText: /^Anthropic Relay$/ }) });
    await card.getByRole("button", { name: "应用到", exact: true }).click();

    const dialog = page.getByRole("dialog", { name: "将 Anthropic Relay 应用到引擎" });
    await expect(dialog).toBeVisible();

    const claudeBtn = dialog.locator(".sx-apply-row__btn").filter({ hasText: /Claude Code/ });
    await expect(claudeBtn).toContainText("支持映射");
    await claudeBtn.click();
    await expect(claudeBtn).toHaveAttribute("aria-pressed", "true");

    // Role model mapping drawer auto-expands immediately upon enabling Claude Code
    const drawer = dialog.locator(".sx-apply-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText("角色模型映射");

    // Smart-match fills main/opus/haiku/fast automatically
    await drawer.getByRole("button", { name: /智能匹配/ }).click();
    await expect(drawer.getByLabel(/主模型/)).toHaveValue("claude-sonnet-4-6");
    await expect(drawer.getByLabel(/Opus 档/)).toHaveValue("claude-opus-4-6");
    await expect(drawer.getByLabel(/Haiku 档/)).toHaveValue("claude-haiku-4-5");
    await expect(drawer.getByLabel(/快速/)).toHaveValue("claude-haiku-4-5");

    // Wait for serialized preferences PATCH to settle and verify persistence on Host
    await expect
      .poll(async () => {
        const s = await (await page.request.get("/api/app-settings")).json();
        return s.harnessDefaults?.["claude-code"]?.modelMap;
      })
      .toEqual({
        main: "claude-sonnet-4-6",
        opus: "claude-opus-4-6",
        haiku: "claude-haiku-4-5",
        fast: "claude-haiku-4-5",
      });

    if (process.env.HIG_SHOT_DIR) {
      await page.screenshot({
        path: `${process.env.HIG_SHOT_DIR}/provider-apply-claude-map-1440.png`,
        fullPage: false,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(340);
      await page.screenshot({
        path: `${process.env.HIG_SHOT_DIR}/provider-apply-claude-map-390.png`,
        fullPage: false,
      });
      await page.setViewportSize({ width: 1440, height: 960 });
    }
  } finally {
    if (providerId) await page.request.delete(`/api/providers/${providerId}`).catch(() => {});
    const snap = await (await page.request.get("/api/snapshot")).json();
    await page.request
      .patch("/api/binding-defaults", {
        data: {
          expectedRevision: snap.bindingDefaults.revision,
          harnessBindingIds: priorDefaults.harnessBindingIds,
        },
      })
      .catch(() => {});
    const curSettings = await (await page.request.get("/api/app-settings")).json();
    await page.request
      .patch("/api/app-settings", {
        data: {
          ...priorSettings,
          revision: curSettings.revision,
        },
      })
      .catch(() => {});
  }
});

test("provider '应用到' modal lets user choose Chat Completions, Responses, or Anthropic endpoint per engine or globally", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  const priorDefaults = (await (await page.request.get("/api/snapshot")).json()).bindingDefaults;
  let providerId: string | null = null;
  try {
    const pRes = await page.request.post("/api/providers", {
      data: {
        name: "Multi Protocol Hub",
        endpoints: [
          {
            name: "Chat",
            protocol: "openai-completions",
            baseUrl: "http://127.0.0.1:1/chat",
          },
          {
            name: "Responses",
            protocol: "openai-responses",
            baseUrl: "http://127.0.0.1:1/responses",
          },
          {
            name: "Anthropic",
            protocol: "anthropic-messages",
            baseUrl: "http://127.0.0.1:1/anthropic",
          },
        ],
      },
    });
    expect(pRes.ok()).toBe(true);
    const provider = await pRes.json();
    providerId = provider.id;

    for (const [epIdx, model] of [
      [0, "gpt-chat-demo"],
      [1, "gpt-responses-demo"],
      [2, "claude-sonnet-4-6"],
    ] as const) {
      const mRes = await page.request.post("/api/provider-models", {
        data: {
          providerId: provider.id,
          endpointId: provider.endpoints[epIdx].id,
          model,
          overrides: {
            contextWindow: 128000,
            maxOutputTokens: 8192,
            input: ["text"],
            reasoning: true,
            reasoningOptions: [{ type: "effort", values: ["low", "high"] }],
          },
        },
      });
      expect(mRes.ok()).toBe(true);
    }

    await page.goto("/");
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page
      .getByRole("navigation", { name: "配置导航", exact: true })
      .getByRole("button", { name: "模型来源", exact: true })
      .click();

    const card = page.locator("section.sx-section").filter({
      has: page.locator(".sx-provider-name").filter({ hasText: /^Multi Protocol Hub$/ }),
    });
    await card.getByRole("button", { name: "应用到", exact: true }).click();

    const dialog = page.getByRole("dialog", { name: "将 Multi Protocol Hub 应用到引擎" });
    await expect(dialog).toBeVisible();

    // Top bar shows all 3 protocol tabs
    const tabBar = dialog.getByRole("tablist", { name: "选择目标端点协议" });
    await expect(tabBar.getByRole("tab", { name: /全部端点/ })).toBeVisible();
    await expect(tabBar.getByRole("tab", { name: /Chat Completions/ })).toBeVisible();
    await expect(tabBar.getByRole("tab", { name: /Responses/ })).toBeVisible();
    await expect(tabBar.getByRole("tab", { name: /Anthropic/ })).toBeVisible();

    // Per-engine inline endpoint select is visible BEFORE enabling Kooyu
    const kodoSelect = dialog.getByLabel("Kooyu 使用的端点协议");
    await expect(kodoSelect).toBeVisible();
    await kodoSelect.selectOption(provider.endpoints[2].id); // Anthropic
    const kodoBtn = dialog.locator(".sx-apply-row__btn").filter({ hasText: /^Kooyu/ });
    await kodoBtn.click();
    await expect(kodoBtn).toHaveAttribute("aria-pressed", "true");

    const snapAfterAnthropic = await (await page.request.get("/api/snapshot")).json();
    const kodoBinding1 = snapAfterAnthropic.bindings.find(
      (b: { id: string }) => b.id === snapAfterAnthropic.bindingDefaults.harnessBindingIds.kodo,
    );
    expect(kodoBinding1?.endpointId).toBe(provider.endpoints[2].id);

    if (process.env.HIG_SHOT_DIR) {
      await page.screenshot({
        path: `${process.env.HIG_SHOT_DIR}/provider-apply-endpoints-1440.png`,
        fullPage: false,
      });
    }

    // Switching the inline select while active rebinds Kooyu immediately to Responses
    await kodoSelect.selectOption(provider.endpoints[1].id);
    await expect
      .poll(async () => {
        const s = await (await page.request.get("/api/snapshot")).json();
        const b = s.bindings.find(
          (x: { id: string }) => x.id === s.bindingDefaults.harnessBindingIds.kodo,
        );
        return b?.endpointId;
      })
      .toBe(provider.endpoints[1].id);

    // Top tab filter: selecting "Responses" keeps Codex visible and hides Claude Code
    await tabBar.getByRole("tab", { name: /Responses/ }).click();
    await expect(dialog.locator(".sx-apply-row__btn").filter({ hasText: /^Codex/ })).toBeVisible();
    await expect(
      dialog.locator(".sx-apply-row__btn").filter({ hasText: /Claude Code/ }),
    ).toHaveCount(0);
  } finally {
    if (providerId) await page.request.delete(`/api/providers/${providerId}`).catch(() => {});
    const snap = await (await page.request.get("/api/snapshot")).json();
    await page.request
      .patch("/api/binding-defaults", {
        data: {
          expectedRevision: snap.bindingDefaults.revision,
          harnessBindingIds: priorDefaults.harnessBindingIds,
        },
      })
      .catch(() => {});
  }
});
