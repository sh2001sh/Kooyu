import { test, expect, type APIRequestContext } from "@playwright/test";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";

test.use({ locale: "zh-CN" });

async function state(client: APIRequestContext, status: string, step = 0) {
  const current = await (await client.get("/api/onboarding")).json();
  const saved = await client.patch("/api/onboarding", {
    data: { expectedRevision: current.revision, step, status },
  });
  expect(saved.ok()).toBe(true);
}
test.beforeEach(async ({ request }) => {
  await state(request, "active");
});
test.afterEach(async ({ request }) => {
  await state(request, "skipped");
  const config = await (await request.get("/api/provider-configuration")).json();
  for (const provider of config.providers)
    if (provider.name.startsWith("Onboarding test"))
      await request.delete("/api/providers/" + provider.id);
});

test("first launch can skip everything and reopen from general settings", async ({
  page,
  request,
}) => {
  const before = await (await request.get("/api/provider-configuration")).json();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "为主 Agent 连接模型（可选）" })).toBeVisible();
  await page.getByRole("button", { name: "跳过引导", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "系统工具" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "为主 Agent 连接模型（可选）" })).toHaveCount(0);
  const after = await (await request.get("/api/provider-configuration")).json();
  expect(after.providers.length).toBe(before.providers.length);
  expect((await (await request.get("/api/onboarding")).json()).status).toBe("skipped");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page
    .getByRole("navigation", { name: "配置导航" })
    .getByRole("button", { name: "通用", exact: true })
    .click();
  await page.getByRole("button", { name: "打开设置引导" }).click();
  await expect(page.getByRole("heading", { name: "为主 Agent 连接模型（可选）" })).toBeVisible();
});

test("skip API, resume at Harness step and complete without a main binding", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "跳过 API，先准备引擎" })).toBeInViewport();
  await page.getByRole("button", { name: "跳过 API，先准备引擎" }).click();
  await expect(page.getByRole("heading", { name: "接上你想用的执行引擎" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "接上你想用的执行引擎" })).toBeVisible();
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await expect(page.getByText("主 Agent API 暂未配置", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "进入工作台", exact: true }).click();
  await expect(page.getByRole("heading", { name: "你的工作台，准备好了" })).toHaveCount(0);
  expect((await (await request.get("/api/onboarding")).json()).status).toBe("completed");
});

for (const mobile of [false, true])
  test(
    "save real configuration and main binding on " + (mobile ? "mobile" : "desktop"),
    async ({ page, request }) => {
      test.setTimeout(60000);
      if (mobile) await page.setViewportSize({ width: 390, height: 844 });
      const methods: string[] = [];
      const upstream = createServer((req, res) => {
        methods.push(req.method + " " + req.url);
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            data: [
              {
                id: "onboarding-synthetic-model",
                contextWindow: 64000,
                maxOutputTokens: 2048,
                input: ["text"],
                reasoning: false,
              },
            ],
          }),
        );
      });
      await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
      const address = upstream.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const settingsBefore = await (await request.get("/api/app-settings")).json();
      try {
        await page.goto("/");
        const source = page.getByLabel("模型来源", { exact: true });
        if (await source.count()) await source.selectOption("new");
        await page
          .getByLabel("来源名称", { exact: true })
          .fill("Onboarding test " + (mobile ? "mobile" : "desktop"));
        await page.getByLabel("Base URL", { exact: true }).fill("http://127.0.0.1:" + port + "/v1");
        await mkdir("../../.local/verification/onboarding", { recursive: true });
        await page.screenshot({
          path:
            "../../.local/verification/onboarding/" + (mobile ? "mobile" : "desktop") + "-api.png",
          fullPage: true,
        });
        await page.getByRole("button", { name: "保存并获取模型", exact: true }).click();
        await expect(page.getByLabel("主 Agent 模型", { exact: true })).toBeVisible();
        await page.getByRole("button", { name: "使用此模型，继续" }).click();
        await expect(page.getByRole("heading", { name: "接上你想用的执行引擎" })).toBeVisible();
        await expect(page.getByText("正在检测安装方式…")).toHaveCount(0);
        expect(await page.locator(".setup-shell").evaluate((el) => el.scrollTop)).toBe(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.screenshot({
          path:
            "../../.local/verification/onboarding/" +
            (mobile ? "mobile" : "desktop") +
            "-engines.png",
          fullPage: true,
        });
        await page.getByRole("button", { name: "继续", exact: true }).click();
        await expect(page.getByText("配置已保存，对话尚未测试", { exact: true })).toBeVisible();
        await page.getByRole("button", { name: "进入工作台", exact: true }).click();
        const snapshot = await (await request.get("/api/snapshot")).json();
        const binding = snapshot.bindings.find(
          (b: { id: string }) => b.id === snapshot.bindingDefaults.harnessBindingIds.kodo,
        );
        expect(binding.model).toBe("onboarding-synthetic-model");
        expect(methods.length).toBeGreaterThan(0);
        expect(
          methods.every((method) => method.startsWith("GET ") && method.includes("/models")),
        ).toBe(true);
        await page.reload();
        await expect(
          page.getByRole("heading", { name: "为主 Agent 连接模型（可选）" }),
        ).toHaveCount(0);
      } finally {
        const current = await (await request.get("/api/app-settings")).json();
        await request.patch("/api/app-settings", {
          data: { ...settingsBefore, revision: current.revision },
        });
        await new Promise<void>((resolve, reject) =>
          upstream.close((e) => (e ? reject(e) : resolve())),
        );
      }
    },
  );

test("discovery failure preserves API and offers manual model parameters", async ({ page }) => {
  await page.goto("/");
  const source = page.getByLabel("模型来源", { exact: true });
  if (await source.count()) await source.selectOption("new");
  await page.getByLabel("来源名称", { exact: true }).fill("Onboarding test unavailable");
  await page.getByLabel("Base URL", { exact: true }).fill("http://127.0.0.1:1/v1");
  await page.getByRole("button", { name: "保存并获取模型", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("未能获取模型列表");
  await page.getByRole("button", { name: "列表没有想用的模型？手动添加" }).click();
  await page.getByLabel("模型 ID", { exact: true }).fill("unknown-onboarding-model");
  await page.getByRole("button", { name: "添加模型", exact: true }).click();
  await expect(page.getByText("这个模型还缺少能力参数", { exact: true })).toBeVisible();
  await expect(page.getByLabel("上下文窗口（tokens）", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "跳过引导", exact: true }).click();
});

test("Harness installation is explicit and failed jobs can retry", async ({ page }) => {
  let installs = 0;
  let phase: "idle" | "running" | "failed" | "succeeded" = "idle";
  await page.route("**/api/snapshot", async (route) => {
    const response = await route.fetch();
    const snapshot = await response.json();
    const engine = snapshot.harnesses.find((h: { id: string }) => h.id === "codex");
    engine.health = {
      ...engine.health,
      installed: phase === "succeeded",
      launchable: phase === "succeeded",
    };
    await route.fulfill({ response, json: snapshot });
  });
  await page.route("**/api/harnesses/management", async (route) => {
    await route.fulfill({
      json: [
        {
          harnessId: "codex",
          kind: "managed-npm",
          documentation: "https://example.com/codex",
          canRestore: false,
          ...(phase === "idle"
            ? {}
            : {
                job: {
                  id: "test-install",
                  harnessId: "codex",
                  state: phase,
                  action: "install",
                  startedAt: new Date().toISOString(),
                  message:
                    phase === "running"
                      ? "测试安装进行中"
                      : phase === "failed"
                        ? "测试下载失败，请重试"
                        : "测试安装完成",
                },
              }),
        },
      ],
    });
  });
  await page.route("**/api/harnesses/codex/install", async (route) => {
    expect(route.request().method()).toBe("POST");
    installs++;
    phase = installs === 1 ? "running" : "succeeded";
    await route.fulfill({ json: {} });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "跳过 API，先准备引擎" }).click();
  const engine = page
    .locator(".setup-engine-list li")
    .filter({ has: page.getByText("Codex", { exact: true }) });
  await expect(engine.getByRole("button", { name: "安装", exact: true })).toBeEnabled();
  expect(installs).toBe(0);
  await engine.getByRole("button", { name: "安装", exact: true }).click();
  await expect(engine.getByRole("button", { name: "安装中…" })).toBeDisabled();
  phase = "failed";
  await expect(engine.getByRole("alert")).toContainText("测试下载失败");
  await engine.getByRole("button", { name: "重试安装" }).click();
  await expect(engine.getByText("已检测到 · 账号待确认")).toBeVisible();
  expect(installs).toBe(2);
});
