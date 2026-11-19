import { test, expect } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`message time, copy, edit and branch are available at ${width}px`, async ({
    page,
    request,
  }, info) => {
    await page.setViewportSize({ width, height: 960 });
    const source = await (
      await request.post("/api/sessions", {
        data: { title: `消息操作 ${width}`, harnessId: "codex", kind: "direct" },
      })
    ).json();
    const at = "2026-11-14T08:31:00.000Z";
    const events = [
      {
        id: "fixture-user",
        sequence: 1,
        sessionId: source.id,
        type: "message",
        createdAt: at,
        source: "native",
        nativeRunId: null,
        payload: { role: "user", text: "测试消息内容" },
      },
      {
        id: "fixture-assistant",
        sequence: 2,
        sessionId: source.id,
        type: "message",
        createdAt: at,
        source: "native",
        nativeRunId: null,
        payload: { role: "assistant", text: "测试助手回复" },
      },
      {
        id: "fixture-stopped",
        sequence: 3,
        sessionId: source.id,
        type: "turn-ended",
        createdAt: at,
        source: "native",
        nativeRunId: null,
        payload: { outcome: "cancelled" },
      },
    ];
    let activeEvents = events;
    await page.route(`**/api/sessions/${source.id}?*`, (route) =>
      route.fulfill({
        json: { session: source, events: activeEvents, commands: [], olderCursor: null },
      }),
    );
    const requests: { eventId: string; edit?: boolean }[] = [];
    let failEdit = true;
    await page.route("**/api/snapshot", async (route) => {
      const response = await route.fetch();
      const snapshot = await response.json();
      snapshot.sessions = snapshot.sessions.map((item: { id: string }) =>
        item.id === source.id ? source : item,
      );
      await route.fulfill({ json: snapshot });
    });
    await page.route(`**/api/sessions/${source.id}/message-branches`, async (route) => {
      const input = route.request().postDataJSON();
      requests.push(input);
      if (input.action === "edit" && failEdit) {
        failEdit = false;
        return route.fulfill({
          status: 503,
          json: { error: { code: "UNAVAILABLE", message: "合成保存失败" } },
        });
      }
      if (input.action === "edit") {
        source.conversation = {
          activeId: input.requestId,
          branches: [
            {
              id: input.requestId,
              rootEventId: "fixture-user",
              userEventId: "fixture-edited",
              originalBranchId: "root",
              prefixEventIds: [],
            },
          ],
        };
        activeEvents = [
          {
            ...events[0]!,
            id: "fixture-edited",
            sequence: 4,
            conversationBranchId: input.requestId,
            payload: { role: "user", text: input.text },
          },
          {
            ...events[1]!,
            id: "fixture-new-answer",
            sequence: 5,
            conversationBranchId: input.requestId,
            payload: { role: "assistant", text: "修改后的回复" },
          },
        ] as typeof events;
      } else {
        source.conversation.activeId = input.branchId;
        activeEvents =
          input.branchId === "root"
            ? events
            : ([
                {
                  ...events[0]!,
                  id: "fixture-edited",
                  sequence: 4,
                  conversationBranchId: input.branchId,
                  payload: { role: "user", text: "修改后的消息" },
                },
              ] as typeof events);
      }
      await route.fulfill({ json: source });
    });
    await page.route(`**/api/sessions/${source.id}/branch`, async (route) => {
      requests.push(route.request().postDataJSON());
      if (route.request().postDataJSON().edit && failEdit) {
        failEdit = false;
        return route.fulfill({
          status: 503,
          json: { error: { code: "UNAVAILABLE", message: "合成保存失败" } },
        });
      }
      const next = await (
        await request.post("/api/sessions", {
          data: { title: `分支草稿 ${width}`, harnessId: "codex", kind: "direct" },
        })
      ).json();
      await route.fulfill({ json: next });
    });
    await page.addInitScript((id) => localStorage.setItem("kodo.session", id), source.id);
    await page.goto("/");
    await expect(page.locator(".user-message time")).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("status").filter({ hasText: "已停止" })).toBeVisible();
    await expect(page.locator(".turn-error")).toHaveCount(0);
    await expect(
      page
        .locator(".user-message > .message-actions")
        .getByRole("button", { name: "复制消息", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".user-turn .message-actions")).toHaveCount(0);
    await expect(page.getByLabel("更多消息操作")).toHaveCount(0);
    const reply = page.locator(".assistant-turn");
    const contentBox = await reply.locator(".markdown").boundingBox();
    const copyBox = await reply.getByRole("button", { name: "复制", exact: true }).boundingBox();
    expect(copyBox!.y).toBeGreaterThanOrEqual(contentBox!.y + contentBox!.height);
    await expect(page.getByRole("button", { name: "分支到新聊天", exact: true })).toBeVisible();
    const branchBox = await page
      .getByRole("button", { name: "分支到新聊天", exact: true })
      .boundingBox();
    expect(branchBox!.x).toBeGreaterThanOrEqual(0);
    expect(branchBox!.x + branchBox!.width).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: info.outputPath(`message-actions-${width}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "分支到新聊天", exact: true }).click();
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0]!.eventId).toBe("fixture-assistant");
    await page.evaluate((id) => localStorage.setItem("kodo.session", id), source.id);
    await page.reload();
    await page.getByRole("button", { name: "编辑消息", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "编辑消息", exact: true })).toHaveCount(0);
    await expect(page.locator(".user-turn").getByRole("textbox", { name: "消息内容" })).toHaveValue(
      "测试消息内容",
    );
    await page.getByRole("textbox", { name: "消息内容" }).fill("取消的修改");
    await page.getByRole("textbox", { name: "消息内容" }).press("Escape");
    await expect(page.locator(".user-turn")).toContainText("测试消息内容");
    await page.getByRole("button", { name: "编辑消息", exact: true }).click();
    await page.getByRole("textbox", { name: "消息内容" }).fill("修改后的消息");
    await page.screenshot({ path: info.outputPath(`inline-edit-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "保存并继续", exact: true }).click();
    await expect.poll(() => requests.length).toBe(2);
    await expect(page.getByRole("textbox", { name: "消息内容" })).toHaveValue("修改后的消息");
    await expect(page.getByText("合成保存失败", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "保存并继续", exact: true }).click();
    await expect.poll(() => requests.length).toBe(3);
    expect(requests[1]).toMatchObject({
      eventId: "fixture-user",
      action: "edit",
      text: "修改后的消息",
    });
    await expect(page.locator(".user-message")).toContainText("修改后的消息");
    await expect(page.locator(".assistant-turn")).toContainText("修改后的回复");
    await expect(page.locator(".message-variants")).toContainText("2 / 2");
    await expect(page.locator(".composer textarea")).toHaveValue("");
    await page.getByRole("button", { name: "上一个消息分支", exact: true }).click();
    await expect(page.locator(".user-message")).toContainText("测试消息内容");
    await expect(page.locator(".assistant-turn")).toContainText("测试助手回复");
    await expect(page.locator(".message-variants")).toContainText("1 / 2");
    await page.getByRole("button", { name: "下一个消息分支", exact: true }).click();
    await expect(page.locator(".user-message")).toContainText("修改后的消息");
    await page.reload();
    await expect(page.locator(".message-variants")).toContainText("2 / 2");
    await page.screenshot({
      path: info.outputPath(`message-variants-${width}.png`),
      fullPage: true,
    });
  });

  test(`model modality manual override and automatic restore at ${width}px`, async ({
    page,
    request,
  }, info) => {
    await page.setViewportSize({ width, height: 960 });
    const provider = await (
      await request.post("/api/providers", {
        data: {
          name: `Modality ${width}`,
          endpoints: [
            { name: "Local", protocol: "openai-responses", baseUrl: "http://127.0.0.1:1/v1" },
          ],
        },
      })
    ).json();
    const saved = await (
      await request.post("/api/provider-models", {
        data: {
          providerId: provider.id,
          endpointId: provider.endpoints[0].id,
          model: `modality-fixture-${width}`,
          overrides: { input: ["text"] },
        },
      })
    ).json();
    await page.goto("/");
    await page
      .getByRole("navigation", { name: width < 600 ? "移动端标签导航" : "系统工具", exact: true })
      .getByRole("button", { name: /^(设置|Harness 与配置)$/ })
      .click();
    await page
      .getByRole("navigation", { name: width < 600 ? "配置页面" : "配置导航", exact: true })
      .getByRole("button", { name: "模型来源", exact: true })
      .click();
    const row = page.locator("tbody tr").filter({ hasText: saved.model });
    await row.getByRole("button", { name: "修改", exact: true }).click();
    await page.getByLabel("输入模态", { exact: true }).selectOption("image");
    const editorBox = await page.locator("form.sx-model-editor").boundingBox();
    expect(editorBox!.x).toBeGreaterThanOrEqual(0);
    expect(editorBox!.x + editorBox!.width).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: info.outputPath(`modality-editor-${width}.png`),
      fullPage: true,
    });
    await page
      .locator("form.sx-model-editor")
      .getByRole("button", { name: "保存", exact: true })
      .click();
    await expect(row).toContainText("文本 · 图片");
    const model = async () =>
      (await (await request.get("/api/provider-configuration")).json()).models.find(
        (m: { id: string }) => m.id === saved.id,
      );
    expect((await model()).overrides.input).toEqual(["text", "image"]);
    await row.getByRole("button", { name: "修改", exact: true }).click();
    await page.getByLabel("输入模态", { exact: true }).selectOption("auto");
    await page
      .locator("form.sx-model-editor")
      .getByRole("button", { name: "保存", exact: true })
      .click();
    await expect.poll(async () => (await model()).overrides.input).toBeUndefined();
  });
}
