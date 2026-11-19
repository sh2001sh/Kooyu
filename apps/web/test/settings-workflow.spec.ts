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
        await page.getByRole("button", { name: "设置", exact: true }).click();
        await section("通用").click();
        const shortcut = page.getByLabel("发送快捷键", { exact: true });
        const currentShortcut = await shortcut.inputValue();
        await shortcut.selectOption(currentShortcut === "mod-enter" ? "enter" : "mod-enter");
        await page.getByRole("button", { name: "保存", exact: true }).click();
        await expect(page.getByText("已保存", { exact: true })).toBeVisible();
        await page.reload();
        await page.getByRole("button", { name: "设置", exact: true }).click();
        await section("通用").click();
        await expect(shortcut).toHaveValue(currentShortcut === "mod-enter" ? "enter" : "mod-enter");
        await page.getByLabel("消息字号", { exact: true }).selectOption("18");
        await page.getByRole("switch", { name: "减少动态效果", exact: true }).check();
        await page.getByLabel("指令内容", { exact: true }).fill("请用中文回复，并说明验证结果。");
        await page.getByRole("button", { name: "保存", exact: true }).click();
        await expect(page.locator("html")).toHaveAttribute("data-reduce-motion", "true");
        if (mobile) {
          await page.getByRole("button", { name: "返回设置列表", exact: true }).click();
        }
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
        if (mobile) {
          await page.getByRole("button", { name: "返回设置列表", exact: true }).click();
        }
        await section("引擎").click();
        const engine = page
          .locator(".sx-engine")
          .filter({ has: page.locator("summary strong").filter({ hasText: /^pi$/ }) });
        await engine.locator(":scope > summary").click();
        await engine
          .locator('select[id="src-pi"]')
          .selectOption(provider.id + ":" + provider.endpoints[0].id);
        await expect
          .poll(
            async () =>
              (await (await page.request.get("/api/snapshot")).json()).bindingDefaults
                .harnessBindingIds.pi,
          )
          .toBeTruthy();
        const bound = (await (await page.request.get("/api/snapshot")).json()).bindingDefaults
          .harnessBindingIds.pi;
        if (mobile) {
          await page.getByRole("button", { name: "返回设置列表", exact: true }).click();
          await page
            .getByRole("navigation", { name: "移动端标签导航", exact: true })
            .getByRole("button", { name: "对话", exact: true })
            .click();
        } else {
          await page.getByRole("button", { name: "返回对话", exact: true }).click();
        }
        await page.getByRole("button", { name: "新建会话", exact: true }).click();
        if (mobile) {
          await page.getByRole("button", { name: "切换对话引擎", exact: true }).click();
          await page
            .getByRole("dialog", { name: "选择对话引擎" })
            .locator('[role="option"][data-value="pi"]')
            .click();
        } else {
          await page.getByRole("button", { name: "Harness", exact: true }).click();
          await page.locator('.ios-popover [role="option"][data-value="pi"]').click();
        }
        await page.getByRole("button", { name: "模型配置", exact: true }).click();
        await page.getByRole("option").filter({ hasText: "settings-model-b" }).click();
        if (mobile) {
          await page.getByRole("button", { name: "新对话设置", exact: true }).click();
          await page.getByRole("button", { name: "保存为空会话草稿", exact: true }).click();
        } else {
          await page.getByRole("button", { name: "创建会话", exact: true }).click();
        }
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

test("per-harness new-chat defaults apply in draft preview and created sessions (native and provider-bound)", async ({
  page,
}) => {
  test.setTimeout(60000);
  const previous = await (await page.request.get("/api/app-settings")).json();
  const priorDefaults = (await (await page.request.get("/api/snapshot")).json()).bindingDefaults;
  const createdSessionIds: string[] = [];
  let createdProviderId: string | null = null;
  try {
    // 1) Native-login engine (codex): configure model, reasoning, and permissionMode in 新对话默认值
    const currentSettings = await (await page.request.get("/api/app-settings")).json();
    const codexModels = await (await page.request.get("/api/harnesses/codex/models")).json();
    const candidateModel =
      codexModels.models?.find((m: { reasoning?: string[] }) => m.reasoning?.length) ??
      codexModels.models?.[0];
    const targetCodexModel = candidateModel?.id ?? "gpt-5.4";
    const targetCodexReasoning =
      candidateModel?.reasoning?.[candidateModel.reasoning.length - 1] ?? "high";
    const patchRes = await page.request.patch("/api/app-settings", {
      data: {
        ...currentSettings,
        harnessDefaults: {
          ...currentSettings.harnessDefaults,
          codex: {
            model: targetCodexModel,
            reasoning: targetCodexReasoning,
            permissionMode: "full-access",
            modelMap: {},
          },
        },
      },
    });
    expect(patchRes.ok()).toBe(true);

    // Ensure codex uses native login (no provider binding)
    const snapBefore = await (await page.request.get("/api/snapshot")).json();
    if (snapBefore.bindingDefaults.harnessBindingIds.codex) {
      await page.request.patch("/api/binding-defaults", {
        data: {
          expectedRevision: snapBefore.bindingDefaults.revision,
          harnessBindingIds: { ...snapBefore.bindingDefaults.harnessBindingIds, codex: null },
        },
      });
    }

    await page.goto("/");
    await page.getByRole("button", { name: "新建会话", exact: true }).click();
    await page.getByRole("button", { name: "Harness", exact: true }).click();
    await page.locator('.ios-popover [role="option"][data-value="codex"]').click();

    // Draft composer pills must immediately show the configured defaults
    await expect(page.getByRole("button", { name: "模型配置", exact: true })).toContainText(
      targetCodexModel.split("/").pop()!,
    );
    await expect(page.getByRole("button", { name: "思考强度", exact: true })).toContainText(
      targetCodexReasoning,
    );
    await expect(
      page.locator(".composer-pickers").getByRole("button", { name: "会话权限" }),
    ).toContainText("完全访问");

    const nativeTitle = "新对话默认值验证-原生";
    await page.getByLabel("标题", { exact: true }).fill(nativeTitle);
    await page.getByRole("button", { name: "创建会话", exact: true }).click();
    await expect
      .poll(async () => {
        const snap = await (await page.request.get("/api/snapshot")).json();
        const found = snap.sessions.find((s: { title: string }) => s.title === nativeTitle);
        if (found) createdSessionIds.push(found.id);
        return found
          ? { model: found.model, reasoning: found.reasoning, permissionMode: found.permissionMode }
          : null;
      })
      .toEqual({
        model: targetCodexModel,
        reasoning: targetCodexReasoning,
        permissionMode: "full-access",
      });

    // 2) Provider-bound engine (pi): configure model, reasoning, and permissionMode via Engine Settings UI
    const pRes = await page.request.post("/api/providers", {
      data: {
        name: "Defaults Bound Provider",
        endpoints: [{ name: "默认", protocol: "openai-responses", baseUrl: base }],
      },
    });
    expect(pRes.ok()).toBe(true);
    const provider = await pRes.json();
    createdProviderId = provider.id;

    // Add a reasoning-capable model to this provider
    const mRes = await page.request.post("/api/provider-models", {
      data: {
        providerId: provider.id,
        endpointId: provider.endpoints[0].id,
        model: "defaults-bound-model",
        overrides: {
          contextWindow: 200000,
          maxOutputTokens: 16384,
          input: ["text"],
          reasoning: true,
          reasoningOptions: [{ type: "effort", values: ["low", "medium", "high"] }],
        },
      },
    });
    expect(mRes.ok()).toBe(true);

    const snapMid = await (await page.request.get("/api/snapshot")).json();
    const bindRes = await page.request.post("/api/harness-provider-bindings", {
      data: {
        harnessId: "pi",
        providerId: provider.id,
        endpointId: provider.endpoints[0].id,
        expectedDefaultsRevision: snapMid.bindingDefaults.revision,
        requestId: crypto.randomUUID(),
      },
    });
    expect(bindRes.ok()).toBe(true);

    // Open 设置 -> 引擎 -> verify per-engine provider badge (原生配置 vs provider name) & set 新对话默认值 in UI
    await page.goto("/");
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page
      .getByRole("navigation", { name: "配置导航" })
      .getByRole("button", { name: "引擎", exact: true })
      .click();
    const codexEngine = page
      .locator(".sx-engine")
      .filter({ has: page.locator("summary strong").filter({ hasText: /^Codex$/ }) });
    await expect(codexEngine.locator(".sx-engine__provider.is-native")).toHaveText("原生配置");
    const piEngine = page
      .locator(".sx-engine")
      .filter({ has: page.locator("summary strong").filter({ hasText: /^pi$/ }) });
    await expect(piEngine.locator(".sx-engine__provider.is-provider")).toHaveText(
      "Defaults Bound Provider",
    );
    if (process.env.HIG_SHOT_DIR) {
      await page.screenshot({
        path: `${process.env.HIG_SHOT_DIR}/engines-provider-badges-1440.png`,
        fullPage: false,
      });
    }
    await piEngine.locator(":scope > summary").click();
    await piEngine.locator('select[id="model-pi"]').selectOption("defaults-bound-model");
    await piEngine.locator('select[id="reasoning-pi"]').selectOption("high");
    await piEngine.locator('select[id="perm-pi"]').selectOption("kodo-tools-read");

    await expect
      .poll(async () => {
        const s = await (await page.request.get("/api/app-settings")).json();
        return s.harnessDefaults?.pi;
      })
      .toMatchObject({
        model: "defaults-bound-model",
        reasoning: "high",
        permissionMode: "kodo-tools-read",
      });

    // Return to new chat, select pi, verify composer pills AND created session persist all 3 defaults
    await page.getByRole("button", { name: "返回对话", exact: true }).click();
    await page.getByRole("button", { name: "新建会话", exact: true }).click();
    await page.getByRole("button", { name: "Harness", exact: true }).click();
    await page.locator('.ios-popover [role="option"][data-value="pi"]').click();

    await expect(page.getByRole("button", { name: "模型配置", exact: true })).toContainText(
      "defaults-bound-model",
    );
    await expect(page.getByRole("button", { name: "思考强度", exact: true })).toContainText("high");
    await expect(
      page.locator(".composer-pickers").getByRole("button", { name: "会话权限" }),
    ).toContainText("仅阅读工具");

    const boundTitle = "新对话默认值验证-绑定来源";
    await page.getByLabel("标题", { exact: true }).fill(boundTitle);
    await page.getByRole("button", { name: "创建会话", exact: true }).click();
    await expect
      .poll(async () => {
        const snap = await (await page.request.get("/api/snapshot")).json();
        const found = snap.sessions.find((s: { title: string }) => s.title === boundTitle);
        if (found) createdSessionIds.push(found.id);
        return found
          ? { model: found.model, reasoning: found.reasoning, permissionMode: found.permissionMode }
          : null;
      })
      .toEqual({
        model: "defaults-bound-model",
        reasoning: "high",
        permissionMode: "kodo-tools-read",
      });
  } finally {
    for (const id of [...new Set(createdSessionIds)]) {
      await page.request.delete(`/api/sessions/${id}`).catch(() => {});
    }
    if (createdProviderId) {
      await page.request.delete(`/api/providers/${createdProviderId}`).catch(() => {});
    }
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
