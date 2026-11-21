import { expect, test } from "@playwright/test";
import { randomUUID, generateKeyPairSync } from "node:crypto";

for (const width of [1440, 390]) {
  test(`work center guides first plan and keeps optional setup out of the way at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 960 });
    const project = await (
      await page.request.post("/api/projects", { data: { name: `Simple work ${width}` } })
    ).json();
    let createdId = "";
    await page.route("**/api/snapshot", async (route) => {
      const response = await route.fetch();
      const snapshot = await response.json();
      snapshot.sessions = snapshot.sessions.filter(
        (s: { id: string; kind: string }) => s.kind !== "supervisor" || s.id === createdId,
      );
      await route.fulfill({ response, json: snapshot });
    });
    await page.route("**/api/sessions", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const response = await route.fetch();
      createdId = (await response.json()).id;
      await route.fulfill({ response });
    });
    const openSettingsSection = async (name: string) => {
      await page
        .getByRole("navigation", { name: width < 600 ? "移动端标签导航" : "系统工具", exact: true })
        .getByRole("button", { name: "设置", exact: true })
        .click();
      await page
        .getByRole("navigation", { name: width < 600 ? "配置页面" : "配置导航", exact: true })
        .getByRole("button", { name, exact: true })
        .click();
    };

    await page.goto("/");
    await openSettingsSection("自动化与通知");
    const center = page.locator(".work-center");
    await expect(center.getByText(/你还没有 Kooyu 主对话/)).toBeVisible();
    await page.screenshot({ path: info.outputPath(`work-first-plan-${width}.png`) });

    // Project memory & conventions in unified 记忆与约定 settings page must be usable without a supervisor.
    if (width < 600) await page.getByRole("button", { name: "返回设置列表", exact: true }).click();
    else {
      await page.getByRole("button", { name: "返回对话", exact: true }).click();
      await page.getByRole("button", { name: "设置", exact: true }).click();
    }
    if (width < 600) {
      await page
        .getByRole("navigation", { name: "配置页面", exact: true })
        .getByRole("button", { name: "记忆与约定", exact: true })
        .click();
    } else {
      await page
        .getByRole("navigation", { name: "配置导航", exact: true })
        .getByRole("button", { name: "记忆与约定", exact: true })
        .click();
    }
    await page.getByLabel("适用范围", { exact: true }).selectOption(project.id);
    await page.getByRole("button", { name: "新增约定", exact: true }).click();
    await page.getByLabel("约定内容", { exact: true }).fill("项目文档使用中文");
    await page.screenshot({
      path: info.outputPath(`work-simple-memory-${width}.png`),
      animations: "disabled",
    });
    await page.getByRole("button", { name: "保存并确认", exact: true }).click();
    await expect(page.getByText("项目文档使用中文").first()).toBeVisible();
    const memories = await (await page.request.get(`/api/memory?projectId=${project.id}`)).json();
    const savedMemory = memories.find(
      (m: { projectId: string; content: string }) =>
        m.projectId === project.id && m.content === "项目文档使用中文",
    );
    expect(savedMemory.subject).toBe("项目文档使用中文");
    await page.getByLabel("适用范围", { exact: true }).selectOption("");
    await expect(page.getByText("项目文档使用中文")).toHaveCount(0);

    // Automation & Notification channels remain streamlined in 设置 -> 自动化与通知
    if (width < 600) {
      await page.getByRole("button", { name: "返回设置列表", exact: true }).click();
      await page
        .getByRole("navigation", { name: "配置页面", exact: true })
        .getByRole("button", { name: "自动化与通知", exact: true })
        .click();
    } else {
      await page
        .getByRole("navigation", { name: "配置导航", exact: true })
        .getByRole("button", { name: "自动化与通知", exact: true })
        .click();
    }
    await center.getByRole("button", { name: "通知", exact: true }).click();
    await expect(page.getByLabel("管理的主对话")).toHaveCount(0);
    await expect(page.getByLabel("Bark 推送地址")).toHaveCount(0);
    await expect(center.getByText(/无需填写地址。点击下方按钮/)).toBeVisible();
    await page.screenshot({ path: info.outputPath(`work-simple-notifications-${width}.png`) });
    await page.getByRole("combobox", { name: "通知通道", exact: true }).selectOption("bark");
    await expect(page.getByLabel("Bark 推送地址")).toBeVisible();
    await expect(page.getByLabel("Bark 推送地址")).toHaveAttribute("required", "");
    await page.getByRole("combobox", { name: "通知通道", exact: true }).selectOption("client");
    await expect(page.getByLabel("Bark 推送地址")).toHaveCount(0);

    await center.getByRole("button", { name: "执行环境", exact: true }).click();
    await expect(center.getByText("默认在本机执行", { exact: true })).toBeVisible();
    await expect(page.getByLabel("新节点名称")).toBeHidden();
    await expect(page.getByLabel("允许访问的网站（每行一个）")).toBeHidden();
    await page.screenshot({ path: info.outputPath(`work-simple-environments-${width}.png`) });

    // Plans converged inside 工作 -> 自动计划 with direct + 新建计划
    if (width < 600) {
      await page.getByRole("button", { name: "返回设置列表", exact: true }).click();
      await page
        .getByRole("navigation", { name: "配置页面", exact: true })
        .getByRole("button", { name: "工作与计划", exact: true })
        .click();
    } else {
      await page.getByRole("button", { name: "返回对话", exact: true }).click();
      await page.getByRole("button", { name: "工作", exact: true }).click();
    }
    const hub = page.locator(".workbench-hub");
    await hub.getByLabel("项目范围", { exact: true }).selectOption(project.id);
    await hub.getByRole("button", { name: "自动计划", exact: true }).click();
    await hub.getByRole("button", { name: "新建计划", exact: true }).click();
    const editor = page.getByRole("region", { name: "新建计划", exact: true });
    await expect(editor).toBeVisible();
    await editor.getByLabel("计划名称", { exact: true }).fill(`Simple plan ${width}`);
    await editor.getByLabel("工作内容", { exact: true }).fill("整理本项目进展与待办");
    await editor.getByRole("combobox", { name: "执行频率", exact: true }).selectOption("interval");
    await editor.getByRole("combobox", { name: "间隔单位", exact: true }).selectOption("days");
    await expect(editor.getByRole("button", { name: "保存计划", exact: true })).toBeDisabled();
    await editor.getByRole("button", { name: "预览运行时间", exact: true }).click();
    await expect(editor.getByText("允许此主对话按计划自动执行")).toBeVisible();
    await editor.getByLabel("允许此主对话按计划自动执行", { exact: true }).check();
    let failed = false;
    await page.route("**/api/{automations,client/operations}", async (route) => {
      const req = route.request();
      const body = req.method() === "POST" ? req.postDataJSON() : undefined;
      const isCreate =
        req.url().endsWith("/api/automations") ||
        (req.url().endsWith("/api/client/operations") &&
          body?.method === "POST" &&
          body?.path === "/api/automations");
      if (req.method() === "POST" && isCreate && !failed) {
        failed = true;
        return route.fulfill({ status: 503, json: { error: { message: "保存临时失败，请重试" } } });
      }
      return route.continue();
    });
    await editor.getByRole("button", { name: "保存计划", exact: true }).click();
    await expect(editor.getByRole("alert")).toContainText("保存临时失败");
    await editor.getByRole("button", { name: "保存计划", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(hub.locator(".hub-row").filter({ hasText: `Simple plan ${width}` })).toContainText(
      "已启用",
    );
    const grants = (await (await page.request.get("/api/grants")).json()).filter(
      (g: { controllerSessionId: string }) => g.controllerSessionId === createdId,
    );
    expect(grants).toHaveLength(1);
    expect(grants[0].operations).toEqual(["automation.execute"]);
    expect(grants[0].resources).toEqual([`session:${createdId}`]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

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
    await page
      .getByRole("navigation", { name: width < 600 ? "移动端标签导航" : "系统工具", exact: true })
      .getByRole("button", { name: "设置", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: width < 600 ? "配置页面" : "配置导航", exact: true })
      .getByRole("button", { name: "自动化与通知", exact: true })
      .click();
    const center = page.locator(".work-center");
    await page.getByLabel("管理的主对话").selectOption(session.id);
    await center.getByRole("button", { name: "应用与授权", exact: true }).click();
    await center.getByRole("button", { name: "新建授权", exact: true }).click();
    await page.getByRole("checkbox", { name: "运行定时任务", exact: true }).check();
    await expect(page.getByLabel("允许的资源（每行一个，精确匹配）")).toHaveValue(
      `session:${session.id}`,
    );
    await page.getByRole("button", { name: "授予以上范围" }).click();
    await expect(center.getByRole("status")).toContainText("授权已保存");

    // Create & pause plan in 工作 -> 自动计划
    if (width < 600) {
      await page.getByRole("button", { name: "返回设置列表", exact: true }).click();
      await page
        .getByRole("navigation", { name: "配置页面", exact: true })
        .getByRole("button", { name: "工作与计划", exact: true })
        .click();
    } else {
      await page.getByRole("button", { name: "返回对话", exact: true }).click();
      await page.getByRole("button", { name: "工作", exact: true }).click();
    }
    const hub = page.locator(".workbench-hub");
    await hub.getByLabel("项目范围", { exact: true }).selectOption(project.id);
    await hub.getByRole("button", { name: "自动计划", exact: true }).click();
    await hub.getByRole("button", { name: "新建计划", exact: true }).click();
    const editor = page.getByRole("region", { name: "新建计划", exact: true });
    await editor.getByLabel("管理的主对话", { exact: true }).selectOption(session.id);
    await editor.getByRole("combobox", { name: "执行频率", exact: true }).selectOption("custom");
    await editor.getByLabel("计划名称", { exact: true }).fill(`Weekly ${width}`);
    await editor.getByLabel("工作内容", { exact: true }).fill("整理来源并生成带引用的周报");
    await editor.getByLabel("自定义 cron 规则").fill("0 9 * * 1");
    await editor.getByText("高级设置", { exact: true }).click();
    await editor.getByLabel("计划执行节点").selectOption(executor.id);
    await editor.getByRole("button", { name: "预览运行时间" }).click();
    await editor.getByRole("button", { name: "保存计划", exact: true }).click();
    const planRow = hub.locator(".hub-row").filter({ hasText: `Weekly ${width}` });
    await expect(planRow).toContainText("已启用");
    await planRow.getByRole("button", { name: "编辑与运行记录", exact: true }).click();
    await hub.getByRole("button", { name: "暂停计划", exact: true }).click();
    await expect(planRow).toContainText("已暂停");

    // Memory CRUD in unified 设置 -> 记忆与约定
    if (width < 600) {
      await page.getByRole("button", { name: "返回设置列表", exact: true }).click();
    } else {
      await page
        .getByRole("navigation", { name: "系统工具", exact: true })
        .getByRole("button", { name: "设置", exact: true })
        .click();
    }
    await page
      .getByRole("navigation", { name: width < 600 ? "配置页面" : "配置导航", exact: true })
      .getByRole("button", { name: "记忆与约定", exact: true })
      .click();
    await page.getByLabel("适用范围", { exact: true }).selectOption(project.id);
    await page.getByRole("button", { name: "新增约定", exact: true }).click();
    await page.getByLabel("主题（可选）", { exact: true }).fill("周报格式");
    await page.getByLabel("约定内容", { exact: true }).fill("每条结论附原始来源");
    await page.getByRole("button", { name: "保存并确认", exact: true }).click();
    await expect(page.getByText("每条结论附原始来源")).toBeVisible();
    await page.getByRole("button", { name: "编辑", exact: true }).first().click();
    await page.getByLabel("约定内容", { exact: true }).fill("每条结论附原始来源和日期");
    await page.getByRole("button", { name: "保存并确认", exact: true }).click();
    await expect(page.getByText("每条结论附原始来源和日期")).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`work-center-${width}.png`),
      fullPage: true,
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "删除", exact: true }).first().click();
    await expect(page.getByText("每条结论附原始来源和日期")).toHaveCount(0);
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
      await page
        .getByRole("navigation", { name: width < 600 ? "移动端标签导航" : "系统工具", exact: true })
        .getByRole("button", { name: "设置", exact: true })
        .click();
      await page
        .getByRole("navigation", { name: width < 600 ? "配置页面" : "配置导航", exact: true })
        .getByRole("button", { name: "自动化与通知", exact: true })
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
        applicationId: "slack",
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
    .getByRole("button", { name: "自动化与通知", exact: true })
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
