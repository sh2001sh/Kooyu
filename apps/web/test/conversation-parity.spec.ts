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
    ];
    await page.route(`**/api/sessions/${source.id}?*`, (route) =>
      route.fulfill({ json: { session: source, events, commands: [], olderCursor: null } }),
    );
    const requests: { eventId: string; edit?: boolean }[] = [];
    await page.route(`**/api/sessions/${source.id}/branch`, async (route) => {
      requests.push(route.request().postDataJSON());
      const next = await (
        await request.post("/api/sessions", {
          data: { title: `分支草稿 ${width}`, harnessId: "codex", kind: "direct" },
        })
      ).json();
      await route.fulfill({ json: next });
    });
    await page.addInitScript((id) => localStorage.setItem("kodo.session", id), source.id);
    await page.goto("/");
    await expect(page.locator(".user-turn time")).toBeVisible();
    await expect(
      page.locator(".user-turn").getByRole("button", { name: "复制消息", exact: true }),
    ).toBeVisible();
    await page.getByLabel("更多消息操作").click();
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
    await page.getByRole("textbox", { name: "消息内容" }).fill("修改后的消息");
    await page.getByRole("button", { name: "保存到新聊天草稿" }).click();
    await expect.poll(() => requests.length).toBe(2);
    expect(requests[1]).toMatchObject({ eventId: "fixture-user", edit: true });
    await expect(page.locator(".composer textarea")).toHaveValue("修改后的消息");
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
    if (width < 600) await page.getByRole("button", { name: "打开导航", exact: true }).click();
    await page
      .getByRole("navigation", { name: "系统工具", exact: true })
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
