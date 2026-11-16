import { expect, test } from "@playwright/test";
import { randomUUID, generateKeyPairSync } from "node:crypto";

for (const width of [1440, 390]) {
  test(`work center saves authorization, plan and memory at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 960 });
    const project = await (
      await page.request.post("/api/projects", { data: { name: `Work ${width}` } })
    ).json();
    const session = await (
      await page.request.post("/api/sessions", {
        data: {
          title: `Work controller ${width}`,
          harnessId: "kodo",
          kind: "supervisor",
          projectId: project.id,
        },
      })
    ).json();
    const executor = await (
      await page.request.post("/api/executors", { data: { name: `Worker ${width}` } })
    ).json();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    if (width < 600) await page.getByRole("button", { name: "打开导航", exact: true }).click();
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page
      .getByRole("navigation", { name: width < 600 ? "配置页面" : "配置导航" })
      .getByRole("button", { name: "工作中心", exact: true })
      .click();
    const center = page.locator(".work-center");
    await page.getByLabel("管理的主对话").selectOption(session.id);
    await center.getByRole("button", { name: "应用与授权", exact: true }).click();
    await center.getByRole("button", { name: "新建授权", exact: true }).click();
    await page.getByLabel("允许的操作（每行一个）").fill("automation.execute");
    await page.getByLabel("允许的资源（每行一个，精确匹配）").fill(`session:${session.id}`);
    await page.getByRole("button", { name: "授予以上范围" }).click();
    await expect(center.getByRole("status")).toContainText("授权已保存");
    await center.getByRole("button", { name: "计划", exact: true }).click();
    await center.getByRole("button", { name: "新建计划", exact: true }).click();
    await page.getByRole("combobox", { name: "执行频率", exact: true }).selectOption("custom");
    await page.getByLabel("计划名称", { exact: true }).fill(`Weekly ${width}`);
    await page.getByLabel("工作内容与验收要求").fill("整理来源并生成带引用的周报");
    await page.getByLabel("自定义 cron 规则").fill("0 9 * * 1");
    await page
      .getByRole("dialog", { name: "新建计划", exact: true })
      .getByText("高级设置", { exact: true })
      .click();
    await page.getByLabel("计划执行节点").selectOption(executor.id);
    await page.getByRole("button", { name: "预览运行时间" }).click();
    await expect(
      page.getByRole("list", { name: "接下来三次运行" }).getByRole("listitem"),
    ).toHaveCount(3);
    await page.getByRole("button", { name: "保存计划", exact: true }).click();
    const row = center.locator(".work-row").filter({ hasText: `Weekly ${width}` });
    await expect(row).toContainText("已启用");
    await row.getByRole("button", { name: "暂停计划" }).click();
    await expect(row).toContainText("已暂停");
    await center.getByRole("button", { name: "项目记忆", exact: true }).click();
    await center.getByRole("button", { name: "新建记忆", exact: true }).click();
    await page.getByLabel("记忆主题").fill("周报格式");
    await page.getByLabel("约定内容").fill("每条结论附原始来源");
    await page.getByLabel("来源引用（每行一个）").fill("UI synthetic preference");
    await page.getByRole("button", { name: "保存已确认记忆" }).click();
    const memory = center.locator(".work-row").filter({ hasText: "周报格式" });
    await expect(memory).toContainText("每条结论附原始来源");
    await memory.getByRole("button", { name: "纠正", exact: true }).click();
    await page.getByLabel("约定内容").fill("每条结论附原始来源和日期");
    await page.getByRole("button", { name: "保存已确认记忆" }).click();
    await expect(memory).toContainText("修订 2");
    await page.screenshot({
      path: testInfo.outputPath(`work-center-${width}.png`),
      fullPage: true,
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await memory.getByRole("button", { name: "删除", exact: true }).click();
    await expect(memory).toHaveCount(0);
    const plans = await (await page.request.get("/api/automations")).json();
    const saved = plans.find(
      (p: { controllerSessionId: string }) => p.controllerSessionId === session.id,
    );
    expect(saved.enabled).toBe(false);
    expect(saved.executorId).toBe(executor.id);
    expect(errors).toEqual([]);
  });

  test(
    "APNs configuration keeps its signing key private at " + width + "px",
    async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 960 });
      await page.goto("/");
      if (width < 600) await page.getByRole("button", { name: "打开导航", exact: true }).click();
      await page.getByRole("button", { name: "设置", exact: true }).click();
      await page
        .getByRole("navigation", { name: width < 600 ? "配置页面" : "配置导航" })
        .getByRole("button", { name: "工作中心", exact: true })
        .click();
      const center = page.locator(".work-center");
      await center.getByRole("button", { name: "通知", exact: true }).click();
      await center.getByText("iOS APNs 服务", { exact: true }).click();
      const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
        .privateKey.export({ type: "pkcs8", format: "pem" })
        .toString();
      await center.getByLabel("Apple Team ID", { exact: true }).fill("TEAM123456");
      await center.getByLabel("APNs Key ID", { exact: true }).fill("KEY1234567");
      await center.getByLabel("应用 Bundle ID（Topic）", { exact: true }).fill("app.kooyu.ios");
      await center.getByLabel("APNs 私钥（PEM .p8；已配置时留空保留）").fill(key);
      await center.getByLabel("启用 Host 的 APNs 服务", { exact: true }).check();
      await center.getByRole("button", { name: "保存 APNs 服务", exact: true }).click();
      await expect(center.getByRole("status")).toContainText("APNs 服务已保存");
      await expect(center.getByLabel("APNs 私钥（PEM .p8；已配置时留空保留）")).toHaveValue("");
      const status = await (await page.request.get("/api/notification-providers/apns")).json();
      expect(status.enabled).toBe(true);
      expect(status.privateKey).toBeUndefined();
      expect(status.credentialRef).toBeUndefined();
      await page.screenshot({
        path: testInfo.outputPath("apns-" + width + ".png"),
        fullPage: true,
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await center.getByLabel("启用 Host 的 APNs 服务", { exact: true }).uncheck();
      await center.getByRole("button", { name: "保存 APNs 服务", exact: true }).click();
      await expect
        .poll(
          async () =>
            (await (await page.request.get("/api/notification-providers/apns")).json()).enabled,
        )
        .toBe(false);
    },
  );
}

test("OAuth provides an external authorization link without navigating the work center", async ({
  page,
}) => {
  const connection = await (
    await page.request.post("/api/applications/connections", {
      data: {
        requestId: randomUUID(),
        applicationId: "github",
        version: "1.0.0",
        name: "Browser OAuth",
        auth: "oauth",
      },
    })
  ).json();
  await page.route("**/api/oauth/start", async (route) => {
    expect(route.request().postDataJSON().connectionId).toBe(connection.id);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ url: "https://provider.example/authorize?state=fixture" }),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page
    .getByRole("navigation", { name: "配置导航" })
    .getByRole("button", { name: "工作中心", exact: true })
    .click();
  const center = page.locator(".work-center");
  await center.getByRole("button", { name: "应用与授权", exact: true }).click();
  await center.getByRole("button", { name: "Browser OAuth · 开始 OAuth", exact: true }).click();
  const link = center.getByRole("link", { name: "在浏览器继续授权" });
  await expect(link).toHaveAttribute("href", "https://provider.example/authorize?state=fixture");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(center).toBeVisible();
  expect(page.url()).not.toContain("provider.example");
});

test("notification deep link opens the same request without answering it", async ({ page }) => {
  const session = await (
    await page.request.post("/api/sessions", {
      data: { title: "Notification destination", harnessId: "kodo", kind: "supervisor" },
    })
  ).json();
  const goal = await (
    await page.request.post("/api/goals", {
      data: {
        requestId: randomUUID(),
        controllerSessionId: session.id,
        title: "Notification goal",
      },
    })
  ).json();
  await page.request.post(`/api/goals/${goal.id}/complete`, {
    data: {
      requestId: randomUUID(),
      expectedRevision: goal.revision,
      summary: "Review report",
      deliverables: ["report"],
      limitations: [],
    },
  });
  const feed = await (await page.request.get("/api/notifications")).json();
  const item = feed.items.find((n: { goalId: string }) => n.goalId === goal.id);
  expect(item).toBeTruthy();
  await page.goto(`/?hostId=${item.link.hostId}&notificationId=${encodeURIComponent(item.id)}`);
  await expect(
    page.getByRole("heading", { name: "Notification destination", exact: true }),
  ).toBeVisible();
  await expect.poll(async () => new URL(page.url()).searchParams.has("notificationId")).toBe(false);
  const latest = await (await page.request.get(`/api/goals/${goal.id}`)).json();
  expect(latest.goal.status).toBe("awaiting-review");
});
