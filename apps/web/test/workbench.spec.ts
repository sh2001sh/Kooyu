import { test, expect, type Page } from "@playwright/test";

async function pickPopoverOption(page: Page, triggerLabel: string, optionValue: string) {
  await page.getByRole("button", { name: triggerLabel, exact: true }).click();
  await page.locator(`.ios-popover [role="option"][data-value="${optionValue}"]`).click();
}

async function pickFirstWorkspace(page: Page) {
  await page.getByRole("button", { name: "工作位置", exact: true }).click();
  await page.locator(`.ios-popover [role="option"]`).nth(1).click();
}

async function pickProjectDirectory(page: Page) {
  await page.getByRole("dialog").getByRole("button", { name: "选择文件夹" }).click();
  await expect(page.getByRole("heading", { name: "选择工作目录" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "选择此目录" }).click();
}
test("a temporary initial Host failure recovers the snapshot and live event connection", async ({
  page,
}) => {
  let failed = false;
  await page.route("**/api/snapshot", (route) => {
    if (failed) return route.continue();
    failed = true;
    return route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "UNAVAILABLE", message: "synthetic temporary Host failure" },
      }),
    });
  });
  await page.goto("/");
  await expect(page.getByText("Host 已连接", { exact: true })).toBeVisible({ timeout: 10000 });
});
test("desktop: native direct draft entries, project workspace, history filters and capability UI", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Host 已连接", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await page.getByLabel("项目名称").fill("UI 验收 · 隔离项目");
  await pickProjectDirectory(page);
  await page.getByRole("button", { name: "创建项目", exact: true }).last().click();
  for (const harness of [
    "pi",
    "Codex",
    "Claude Code",
    "DeepSeek Harness",
    "ZCode",
    "OpenCode",
    "Gemini CLI",
    "Cursor",
    "Kimi Code",
    "Grok Build",
    "Antigravity",
  ]) {
    await page.getByRole("button", { name: "新建会话", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByLabel("标题", { exact: true }).fill(`UI 验收 · ${harness}`);
    await pickPopoverOption(
      page,
      "Harness",
      (
        {
          pi: "pi",
          Codex: "codex",
          "Claude Code": "claude-code",
          "DeepSeek Harness": "deepseek-harness",
          ZCode: "zcode",
          OpenCode: "opencode",
          "Gemini CLI": "gemini",
          Cursor: "cursor",
          "Kimi Code": "kimi-code",
          Antigravity: "antigravity",
          "Grok Build": "grok-build",
        } as Record<string, string>
      )[harness]!,
    );
    await pickFirstWorkspace(page);
    await page.getByRole("button", { name: "创建会话", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: `UI 验收 · ${harness}`, exact: true }),
    ).toBeVisible();
  }
  const snapshot = await (await page.request.get("/api/snapshot")).json();
  const drafts = snapshot.sessions.filter((s: { title: string }) =>
    s.title.startsWith("UI 验收 · "),
  );
  expect(drafts).toHaveLength(11);
  expect(
    drafts.every(
      (s: { phase: string; nativeSessionId: string | null }) =>
        s.phase === "draft" && s.nativeSessionId === null,
    ),
  ).toBe(true);
  await page.screenshot({ path: "../../output/playwright/desktop.png", fullPage: true });
  await page.getByRole("button", { name: "会话检查器", exact: true }).click();
  await expect(page.getByText("尚未创建", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "关闭详情" }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "配置导航" })).toBeVisible();
  await page
    .getByRole("navigation", { name: "配置导航" })
    .getByRole("button", { name: "引擎", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "引擎", exact: true }).first()).toBeVisible();
  await expect(page.locator(".session-rows")).toHaveCount(0);
  await page
    .locator(".sx-engine")
    .filter({ has: page.locator("summary strong", { hasText: "Codex" }) })
    .locator(":scope > summary")
    .click();
  const engine = page.locator(".sx-engine[open]");
  await expect(engine).toContainText("Codex");
  await expect(engine).toContainText("安装");
  await page.screenshot({ path: "../../output/playwright/capabilities.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("Kooyu is the main agent while pi remains an independent direct harness on desktop and phone", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(".new-conversation").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const harnessTrigger = page.getByRole("button", { name: "Harness", exact: true });
  await expect(harnessTrigger).toHaveAttribute("data-value", "kodo");
  await page.getByLabel("标题", { exact: true }).fill("Kooyu 产品主对话");
  await page.getByRole("button", { name: "创建会话", exact: true }).click();
  await expect(page.locator(".composer-harness")).toContainText("Kooyu");
  await page.screenshot({ path: "../../output/playwright/kodo-main-desktop.png" });
  await page.locator(".new-conversation").click();
  await harnessTrigger.click();
  const options = await page
    .locator('.ios-popover [role="option"][data-value]')
    .evaluateAll((v) => v.map((e) => e.getAttribute("data-value")));
  expect(options).toHaveLength(12);
  expect(options).toContain("kodo");
  expect(options).toContain("pi");
  await page.locator('.ios-popover [role="option"][data-value="pi"]').click();
  await page.getByLabel("标题", { exact: true }).fill("独立 pi agent");
  await page.getByRole("button", { name: "创建会话", exact: true }).click();
  await expect(page.locator(".composer-harness")).toContainText("pi");
  await expect(page.locator(".composer-harness")).not.toContainText("Kooyu");
  const snapshot = await (await page.request.get("/api/snapshot")).json(),
    main = snapshot.sessions.find((s: any) => s.title === "Kooyu 产品主对话"),
    pi = snapshot.sessions.find((s: any) => s.title === "独立 pi agent");
  expect(main.harnessId).toBe("kodo");
  expect(main.kind).toBe("supervisor");
  expect(pi.harnessId).toBe("pi");
  expect(pi.kind).toBe("direct");
  expect(main.instanceId).not.toBe(pi.instanceId);
  expect(snapshot.harnesses.some((h: any) => h.id === "kodo" && h.name === "Kooyu")).toBe(true);
  expect(snapshot.harnesses.some((h: any) => h.id === "pi" && h.name === "pi")).toBe(true);
  for (const s of [main, pi])
    expect((await (await page.request.get(`/api/sessions/${s.id}`)).json()).commands).toHaveLength(
      0,
    );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "../../output/playwright/pi-direct-mobile.png" });
  await page.getByRole("button", { name: "返回会话列表" }).click();
  await page.getByText("Kooyu 产品主对话", { exact: true }).click();
  await expect(page.locator(".composer-harness")).toContainText("Kooyu");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("an unassigned draft can create a project by choosing a Host folder", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新建会话", exact: true }).click();
  const projectPicker = page.getByRole("button", { name: "项目", exact: true });
  await expect(projectPicker).toBeVisible();
  await projectPicker.click();
  await page.getByRole("button", { name: "新建项目" }).click();
  await page.getByRole("button", { name: "选择文件夹" }).click();
  await expect(page.getByRole("heading", { name: "选择工作目录" })).toBeVisible();
  await expect(page.getByRole("button", { name: "选择此目录" })).toBeEnabled();
  await page
    .getByRole("dialog")
    .screenshot({ path: "../../output/playwright/project-picker-desktop.png" });
  const home = await (await page.request.get("/api/directories")).json();
  await page.getByRole("button", { name: "选择此目录" }).click();
  await expect(page.locator(".directory-choice")).toContainText(home.path);
  await page.getByLabel("项目名称").fill("文件夹选择项目");
  await page.getByRole("dialog").getByRole("button", { name: "创建项目" }).click();
  await expect(projectPicker).toContainText("文件夹选择项目");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "../../output/playwright/project-selected-mobile.png" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "新对话设置", exact: true }).click();
  await page.getByLabel("自定义标题", { exact: true }).fill("归属项目会话");
  await page.getByRole("button", { name: "保存为空会话草稿", exact: true }).click();
  const snapshot = await (await page.request.get("/api/snapshot")).json();
  const project = snapshot.projects.find((p: { name: string }) => p.name === "文件夹选择项目");
  const session = snapshot.sessions.find((s: { title: string }) => s.title === "归属项目会话");
  expect(session.projectId).toBe(project.id);
  expect(
    snapshot.workspaces.find((w: { id: string }) => w.id === session.workspaceId)?.rootPath,
  ).toBe(home.path);

  await page.setViewportSize({ width: 1440, height: 960 });
  await page.locator(".new-conversation").click();
  await page.getByLabel("标题", { exact: true }).fill("原先未归属");
  await page.getByRole("button", { name: "创建会话", exact: true }).click();
  await page.getByRole("button", { name: "会话检查器", exact: true }).click();
  await page.getByRole("button", { name: "新建项目" }).click();
  await page.getByLabel("项目名称").fill("详情新项目");
  await page.getByRole("dialog").getByRole("button", { name: "创建项目" }).click();
  const updated = await (await page.request.get("/api/snapshot")).json();
  const newProject = updated.projects.find((p: { name: string }) => p.name === "详情新项目");
  await expect(page.getByRole("combobox", { name: "调整项目归属" })).toHaveValue(newProject.id);
  await expect
    .poll(async () => {
      const current = await (await page.request.get("/api/snapshot")).json();
      return current.sessions.find((s: { title: string }) => s.title === "原先未归属")?.projectId;
    })
    .toBe(newProject.id);
});
test("mobile: scope/list/chat navigation, all harness choices and accessible composer", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "新建会话", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "切换对话引擎", exact: true }).click();
  await page
    .getByRole("dialog", { name: "选择对话引擎" })
    .locator('[role="option"][data-value="pi"]')
    .click();
  await page.getByRole("button", { name: "新对话设置", exact: true }).click();
  await page.getByLabel("自定义标题", { exact: true }).fill("手机 UI 验收 · 草稿");
  await page.getByRole("button", { name: "保存为空会话草稿", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "停止并暂停托管", exact: true })).toHaveCount(0);
  await page.screenshot({ path: "../../output/playwright/mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const snapshot = await (await page.request.get("/api/snapshot")).json(),
    session = snapshot.sessions.find((s: any) => s.title === "手机 UI 验收 · 草稿");
  expect(session.harnessId).toBe("pi");
  expect(session.nativeSessionId).toBeNull();
  await page.getByRole("button", { name: "返回会话列表" }).click();
  await expect(page.getByRole("heading", { name: "对话", exact: true })).toBeVisible();
  await page
    .getByRole("navigation", { name: "移动端标签导航", exact: true })
    .getByRole("button", { name: "设置", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "配置页面" })
    .getByRole("button", { name: "手机连接", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "手机连接", exact: true }).first()).toBeVisible();
});

for (const mobile of [false, true])
  test(`${mobile ? "mobile" : "desktop"}: management is conversational and absent from the inspector`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const controller = await (
      await page.request.post("/api/sessions", {
        data: {
          title: `Conversational management ${mobile}`,
          harnessId: "kodo",
          kind: "supervisor",
        },
      })
    ).json();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let answered = false;
    const requestId = controller.id + ":synthetic-management-request";
    // UI interaction fixture; real authorization and side effects are covered by Host tool tests.
    await page.route("**/api/snapshot", async (route) => {
      const response = await route.fetch();
      const snapshot = await response.json();
      if (!answered)
        snapshot.inbox.push({
          id: requestId,
          sessionId: controller.id,
          type: "interaction",
          resolved: false,
          createdAt: new Date().toISOString(),
          payload: {
            protocol: "kodo",
            method: "approval/request",
            params: {
              action: "设置会话托管",
              title: "Execution",
              mode: "continue",
              limits: { maxContinuations: 2 },
            },
          },
        });
      await route.fulfill({ response, json: snapshot });
    });
    await page.route("**/api/interactions/**", async (route) => {
      expect(route.request().postDataJSON().answer).toEqual({ decision: "accept" });
      answered = true;
      await route.fulfill({ json: { status: "processed" } });
    });
    await page.addInitScript((id) => localStorage.setItem("kodo.session", id), controller.id);
    await page.goto("/");
    await expect(page.getByLabel("消息", { exact: true })).toHaveAttribute("placeholder", "Kooyu");
    await expect(page.getByText("Kooyu 管理操作 · 等待确认", { exact: true })).toBeVisible();
    await expect(page.getByText("最多自动续聊 2 次", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "结构化回答", exact: true })).toHaveCount(0);
    await page.screenshot({
      path: `../../.impeccable/review/conversational-confirmation-${mobile ? "mobile" : "desktop"}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "允许本次", exact: true }).click();
    await expect.poll(() => answered).toBe(true);
    await expect(page.getByText("Kooyu 管理操作 · 等待确认", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "会话检查器", exact: true }).click();
    const inspector = page.getByRole("complementary", { name: "会话检查器" });
    await expect(inspector).toBeVisible();
    await page.evaluate(() => {
      for (const animation of document.getAnimations()) {
        if (animation.effect?.getComputedTiming().iterations !== Infinity) animation.finish();
      }
    });
    await expect(
      inspector.getByText("高级管理：托管、交接、原生历史", { exact: true }),
    ).toHaveCount(0);
    for (const label of ["选择目标会话", "选择主对话", "监控模式", "托管预算 USD", "目标 harness"])
      await expect(inspector.getByLabel(label, { exact: true })).toHaveCount(0);
    for (const name of ["准备交接材料", "读取原生历史", "发现历史", "查询额度", "启用自动继续"])
      await expect(inspector.getByRole("button", { name, exact: true })).toHaveCount(0);
    await expect(inspector.getByLabel("调整项目归属", { exact: true })).toBeVisible();
    await expect(inspector.getByText("成果与工作位置", { exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: `../../.impeccable/review/conversational-management-${mobile ? "mobile" : "desktop"}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "关闭详情", exact: true }).click();
    await expect(page.getByLabel("消息", { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
test("binding defaults preserve session revisions across desktop and phone", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByText("旧版模型配置", { exact: false })).toHaveCount(0);
  const provider = await (
    await page.request.post("/api/providers", {
      data: {
        name: "配置继承验收",
        endpoints: [
          { name: "Responses", protocol: "openai-responses", baseUrl: "http://127.0.0.1:1/v1" },
        ],
      },
    })
  ).json();
  const model = await (
    await page.request.post("/api/provider-models", {
      data: {
        providerId: provider.id,
        endpointId: provider.endpoints[0].id,
        model: "model-before",
        overrides: {
          contextWindow: 123456,
          maxOutputTokens: 2345,
          reasoning: false,
          input: ["text"],
        },
      },
    })
  ).json();
  const binding = await (
    await page.request.post("/api/harness-bindings", {
      data: {
        name: "配置继承验收",
        harnessId: "codex",
        modelId: model.id,
      },
    })
  ).json();
  const old = await (
    await page.request.post("/api/sessions", {
      data: { title: "旧绑定修订", harnessId: "codex", kind: "direct", bindingId: binding.id },
    })
  ).json();
  const p = await (
    await page.request.post("/api/projects", { data: { name: "默认配置验收项目" } })
  ).json();
  await page.request.post("/api/harness-bindings", {
    data: {
      id: binding.id,
      expectedRevision: 1,
      name: "配置继承验收 r2",
      harnessId: "codex",
      modelId: model.id,
    },
  });
  await page.reload();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const projectBefore = (await (await page.request.get("/api/snapshot")).json()).projects.find(
    (v: any) => v.id === p.id,
  );
  const saveDefault = await page.request.patch("/api/projects/" + p.id + "/binding-defaults", {
    data: {
      expectedRevision: projectBefore.configRevision ?? 0,
      bindingDefaults: { ...projectBefore.bindingDefaults, codex: binding.id },
    },
  });
  expect(saveDefault.ok()).toBe(true);
  await page.getByRole("button", { name: "返回对话", exact: true }).click();
  await page.locator(".new-conversation").click();
  await page.getByLabel("标题", { exact: true }).fill("继承配置草稿");
  await pickPopoverOption(page, "Harness", "codex");
  await page.getByRole("button", { name: "项目", exact: true }).click();
  await page.locator(".ios-popover [role='option']", { hasText: "默认配置验收项目" }).click();
  await page.getByRole("button", { name: "创建会话", exact: true }).click();
  await expect(page.getByRole("heading", { name: "继承配置草稿", exact: true })).toBeVisible();
  const after = await (await page.request.get("/api/snapshot")).json(),
    inherited = after.sessions.find((v: any) => v.title === "继承配置草稿");
  expect(inherited.bindingId).toBe(binding.id);
  expect(inherited.bindingRevision).toBe(2);
  expect(after.sessions.find((v: any) => v.id === old.id).bindingRevision).toBe(1);
  expect(
    (await (await page.request.get(`/api/sessions/${inherited.id}`)).json()).commands,
  ).toHaveLength(0);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page
    .getByRole("navigation", { name: "配置导航" })
    .getByRole("button", { name: "引擎", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "引擎", exact: true }).first()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "引擎", exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("project inline create binds project Kooyu master or harness model, and 2-tab tree switches views", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("项目名称").fill("模型与分组验收");
  await pickProjectDirectory(page);
  await dialog.getByRole("button", { name: "创建项目", exact: true }).click();

  await expect(
    page.getByRole("button", { name: "在 模型与分组验收 新建会话", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "在 模型与分组验收 新建会话", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "工作位置", exact: true })).not.toHaveAttribute(
    "data-value",
    "",
  );

  await pickPopoverOption(page, "Harness", "kodo");
  await page.getByRole("button", { name: "模型配置", exact: true }).click();
  await expect
    .poll(async () => page.locator(".ios-popover [role='option']").count())
    .toBeGreaterThan(3);
  await page.keyboard.press("Escape");
  await page.getByLabel("标题", { exact: true }).fill("项目内主对话");
  await page.getByRole("button", { name: "创建会话", exact: true }).click();
  await expect(page.getByRole("heading", { name: "项目内主对话", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "在 模型与分组验收 新建会话", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await pickPopoverOption(page, "Harness", "opencode");
  await expect(page.getByRole("button", { name: "模型配置", exact: true })).toBeEnabled();

  await pickPopoverOption(page, "Harness", "codex");
  const modelBtn = page.getByRole("button", { name: "模型配置", exact: true });
  await expect(modelBtn).toBeEnabled();
  await modelBtn.click();
  await page.getByLabel("模型 ID", { exact: true }).fill("gpt-5.3-codex");
  await page.locator('.ios-popover [role="option"]', { hasText: "gpt-5.3-codex" }).first().click();
  await page.getByLabel("标题", { exact: true }).fill("Codex 指定模型草稿");
  await page.getByRole("button", { name: "创建会话", exact: true }).click();

  await expect(
    page.getByRole("heading", { name: "Codex 指定模型草稿", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "模型配置", exact: true })).toContainText(
    "gpt-5.3-codex",
  );

  const snap = await (await page.request.get("/api/snapshot")).json();
  const projectMaster = snap.sessions.find((s: any) => s.title === "项目内主对话");
  const codexDraft = snap.sessions.find((s: any) => s.title === "Codex 指定模型草稿");
  expect(projectMaster.kind).toBe("supervisor");
  expect(projectMaster.projectId).toBeTruthy();
  expect(codexDraft.harnessId).toBe("codex");
  expect(codexDraft.model).toBe("gpt-5.3-codex");

  await page.getByRole("button", { name: "按 Harness", exact: true }).click();
  await expect(page.getByRole("button", { name: "新建 Codex 会话", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "按项目", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "在 模型与分组验收 新建会话", exact: true }),
  ).toBeVisible();
});

test("usage page renders trend chart, donut breakdown, heatmap, model leaderboard and budget burn", async ({
  page,
}) => {
  await page.goto("/");
  const snap = await (await page.request.get("/api/snapshot")).json();
  const s0 = snap.sessions[0] ?? { id: "s-1", projectId: null };
  const p0 = snap.projects[0] ?? { id: "p-1", name: "Demo" };
  const now = Date.now();
  const isoDaysAgo = (d: number) => new Date(now - d * 86400_000).toISOString();

  await page.route("**/api/usage", async (route) => {
    await route.fulfill({
      json: {
        records: [
          {
            id: "u-1",
            sessionId: s0.id,
            projectId: p0.id,
            bindingId: null,
            source: "codex",
            scope: "turn",
            input: 18500,
            output: 4200,
            cacheRead: 12000,
            cacheWrite: 1500,
            costUsd: 0.184,
            costKind: "actual",
            model: "gpt-5.3-codex",
            createdAt: isoDaysAgo(0),
          },
          {
            id: "u-2",
            sessionId: s0.id,
            projectId: p0.id,
            bindingId: null,
            source: "claude-code",
            scope: "turn",
            input: 14200,
            output: 3800,
            cacheRead: 24000,
            cacheWrite: 3200,
            costUsd: 0.246,
            costKind: "actual",
            model: "claude-sonnet-4-5",
            createdAt: isoDaysAgo(1),
          },
          {
            id: "u-3",
            sessionId: s0.id,
            projectId: null,
            bindingId: null,
            source: "pi",
            scope: "session",
            input: 9600,
            output: 2100,
            cacheRead: 4000,
            cacheWrite: 0,
            costUsd: 0.042,
            costKind: "estimate",
            model: "deepseek-v4.1-flash",
            createdAt: isoDaysAgo(3),
          },
        ],
        budgets: [{ projectId: p0.id, usd: 1 }],
      },
    });
  });

  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page
    .getByRole("navigation", { name: "配置导航" })
    .getByRole("button", { name: "用量", exact: true })
    .click();
  await expect(page.getByRole("img", { name: "每日费用堆叠柱状图" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Token 构成环形图" })).toBeVisible();
  await expect(page.getByRole("grid", { name: "近 12 周活跃热力图" })).toBeVisible();
  await expect(page.getByText("模型消耗排行", { exact: true })).toBeVisible();
  await expect(page.getByText("claude-sonnet-4-5", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("43%", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Token", exact: true }).click();
  await expect(page.getByRole("img", { name: "每日 Token 堆叠柱状图" })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
