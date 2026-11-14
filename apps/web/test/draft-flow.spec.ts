import { expect, test } from "@playwright/test";

let initialSessionIds = new Set<string>();

test.beforeEach(async ({ request }) => {
  const snapshot = await (await request.get("/api/snapshot")).json();
  initialSessionIds = new Set(snapshot.sessions.map((item: { id: string }) => item.id));
});

test.afterEach(async ({ request }) => {
  const snapshot = await (await request.get("/api/snapshot")).json();
  for (const session of snapshot.sessions as { id: string }[]) {
    if (!initialSessionIds.has(session.id)) await request.delete(`/api/sessions/${session.id}`);
  }
});

test("an edited desktop draft remains open and readable after switching to phone width", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Harness", exact: true }).click();
  await page.locator('.ios-popover [role="option"][data-value="codex"]').click();
  await page.getByRole("textbox", { name: "消息", exact: true }).fill("尚未发送的任务");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toHaveValue(
    "尚未发送的任务",
  );
  const snapshot = await (await page.request.get("/api/snapshot")).json();
  const codexNativePermission = snapshot.harnesses.find(
    (item: { id: string; nativeDefaults?: { permission?: string | null } }) => item.id === "codex",
  )?.nativeDefaults?.permission;
  await expect(page.getByRole("button", { name: "会话权限" })).toContainText(
    codexNativePermission || "原生默认",
  );
  await page.setViewportSize({ width: 320, height: 700 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("new project preselects its directory and draft settings reach the session", async ({
  page,
}) => {
  await page.route("**/api/harnesses/codex/models?discover=1", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        harnessId: "codex",
        modelSupport: "native-models",
        defaultModel: null,
        models: [{ id: "gpt-5.1-codex", source: "discovered", reasoning: ["low", "high"] }],
      }),
    }),
  );
  let sent: { text: string; mode: string } | undefined;
  await page.route("**/api/sessions/*/send", async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({ contentType: "application/json", body: "{}" });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "新建会话", exact: true }).click();
  await page.getByRole("button", { name: "Harness", exact: true }).click();
  await page.locator('.ios-popover [role="option"][data-value="codex"]').click();
  await page.getByRole("textbox", { name: "消息", exact: true }).fill("请检查这个项目");
  await expect(page.getByRole("button", { name: "发送消息" })).toBeDisabled();
  await expect(page.getByText("请先选择工作位置。")).toBeVisible();

  await page.getByRole("button", { name: "项目", exact: true }).click();
  await page.getByRole("button", { name: "新建项目" }).click();
  await page.getByRole("button", { name: "选择文件夹" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "选择此目录" }).click();
  await page.getByLabel("项目名称").fill("草稿流程项目");
  await page.getByRole("dialog").getByRole("button", { name: "创建项目" }).click();
  await expect(page.getByRole("button", { name: "项目", exact: true })).toContainText(
    "草稿流程项目",
  );
  await expect(page.getByRole("button", { name: "工作位置", exact: true })).not.toContainText(
    "选择工作位置",
  );
  await expect(page.getByRole("button", { name: "发送消息" })).toBeEnabled();

  await page.getByRole("button", { name: "模型配置" }).click();
  await page.locator('.ios-popover [role="option"][data-value="model:gpt-5.1-codex"]').click();
  await page.getByRole("button", { name: "思考强度" }).click();
  await page.getByRole("slider", { name: "新对话思考强度" }).focus();
  await page.keyboard.press("End");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "会话权限" }).click();
  await page
    .locator(".ios-popover")
    .getByRole("button", { name: /工作区写入/ })
    .click();

  await page.getByLabel("选择文本附件").setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("附加的真实文本内容"),
  });
  await expect(page.getByLabel("文本附件", { exact: true })).toContainText("notes.txt");
  await page.getByRole("button", { name: "移除附件 notes.txt" }).click();
  await expect(page.getByLabel("文本附件", { exact: true })).toHaveCount(0);
  await page.getByLabel("选择文本附件").setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("附加的真实文本内容"),
  });
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.getByRole("heading", { name: "请检查这个项目" })).toBeVisible();

  const snapshot = await (await page.request.get("/api/snapshot")).json();
  const session = snapshot.sessions.find(
    (item: { title: string }) => item.title === "请检查这个项目",
  );
  const project = snapshot.projects.find((item: { name: string }) => item.name === "草稿流程项目");
  expect(session.projectId).toBe(project.id);
  expect(session.workspaceId).toBeTruthy();
  expect(session.model).toBe("gpt-5.1-codex");
  expect(session.reasoning).toBe("high");
  expect(session.permissionMode).toBe("workspace-write");
  expect(sent?.mode).toBe("new");
  expect(sent?.text).toContain("附加的真实文本内容");
  expect(sent?.text).toContain("notes.txt");
  const context = await (
    await page.request.get(`/api/workspaces/${session.workspaceId}/context`)
  ).json();
  expect(context.workspaceId).toBe(session.workspaceId);
  expect(typeof context.git).toBe("boolean");
});

test("attachment-only first send keeps a useful title and recovers a rejected message", async ({
  page,
}) => {
  await page.route("**/api/sessions/*/send", (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "INVALID_INPUT", message: "模拟发送拒绝" } }),
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "新建会话", exact: true }).click();
  await page.getByRole("button", { name: "Harness", exact: true }).click();
  await page.locator('.ios-popover [role="option"][data-value="pi"]').click();
  await page.getByLabel("选择文本附件").setInputFiles({
    name: "image.png",
    mimeType: "image/png",
    buffer: Buffer.from([137, 80, 78, 71]),
  });
  await expect(page.getByRole("alert")).toContainText("只支持文本文件");
  await expect(page.getByRole("button", { name: "发送消息" })).toBeDisabled();
  await page.getByLabel("选择文本附件").setInputFiles({
    name: "request.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# 需求说明\n请阅读。"),
  });
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.getByRole("heading", { name: "与 pi 对话" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toContainText("需求说明");
  await expect(page.getByRole("alert")).toContainText("模拟发送拒绝");
  const snapshot = await (await page.request.get("/api/snapshot")).json();
  const sessions = snapshot.sessions.filter(
    (item: { title: string }) => item.title === "与 pi 对话",
  );
  expect(sessions).toHaveLength(1);
  expect(sessions[0].phase).toBe("draft");
});
