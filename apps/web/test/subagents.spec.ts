import { test, expect } from "@playwright/test";
test.use({ locale: "zh-CN" });

for (const mobile of [false, true])
  test(`subagent output stays separate and expands on ${mobile ? "mobile" : "desktop"}`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const session = await (
      await page.request.post("/api/sessions", {
        data: { title: "子代理显示合成回归", harnessId: "pi", kind: "direct" },
      })
    ).json();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const values = [
      ["message", { role: "assistant", text: "主代理继续执行" }],
      [
        "subagent",
        {
          agentId: "child-a",
          parentAgentId: "root",
          name: "代码检查与结果整理",
          status: "running",
        },
      ],
      [
        "subagent",
        { agentId: "child-b", parentAgentId: "root", name: "运行测试", status: "running" },
      ],
      [
        "subagent",
        {
          agentId: "child-a",
          event: {
            type: "text-delta",
            payload: { itemId: "saved-thought", text: "历史思考", channel: "thought" },
          },
        },
      ],
      [
        "subagent",
        {
          agentId: "child-a",
          event: {
            type: "message",
            payload: { id: "saved-thought", text: "历史思考完整内容", channel: "thought" },
          },
        },
      ],
      [
        "subagent",
        {
          agentId: "child-a",
          event: {
            type: "message",
            payload: { id: "saved-thought", text: "历史思考完整内容", channel: "thought" },
          },
        },
      ],
      [
        "subagent",
        {
          agentId: "child-a",
          event: { type: "text-delta", payload: { text: "子代理 A 的完整输出" } },
        },
      ],
      [
        "subagent",
        {
          agentId: "child-b",
          event: { type: "message", payload: { role: "assistant", text: "子代理 B 的独立输出" } },
        },
      ],
      [
        "subagent",
        {
          agentId: "child-a",
          event: { type: "message", payload: { role: "assistant", text: "子代理 A 的完整输出" } },
        },
      ],
      [
        "subagent",
        {
          agentId: "child-a",
          event: {
            type: "tool",
            payload: {
              toolCallId: "same-tool",
              title: "Read marker.txt",
              rawInput: { path: "marker.txt" },
              status: "in_progress",
            },
          },
        },
      ],
      [
        "subagent",
        {
          agentId: "child-a",
          event: {
            type: "tool",
            payload: {
              toolCallId: "same-tool",
              status: "completed",
              content: [{ type: "content", content: { type: "text", text: "原生工具嵌套结果" } }],
            },
          },
        },
      ],
      [
        "subagent",
        { agentId: "child-a", event: { type: "turn-ended", payload: { outcome: "completed" } } },
      ],
      [
        "subagent",
        {
          agentId: "child-b",
          event: { type: "error", payload: { message: "仅子代理失败" } },
          status: "failed",
        },
      ],
      ["subagent", { agentId: "empty-child", status: "running" }],
      ["message", { role: "assistant", text: "主代理未被子代理结束事件终止" }],
    ];
    const events = values.map(([type, payload], i) => ({
      id: `sub-test-${i}`,
      sessionId: session.id,
      nativeRunId: null,
      sequence: i + 1,
      type,
      payload,
      createdAt: new Date().toISOString(),
      source: "pi",
    }));
    await page.route(`**/api/sessions/${session.id}?*`, (route) =>
      route.fulfill({ json: { session, events, commands: [], olderCursor: null } }),
    );
    await page.addInitScript((id) => localStorage.setItem("kodo.session", id), session.id);
    try {
      await page.goto("/");
      const a = page.locator('[data-agent-id="child-a"]');
      const b = page.locator('[data-agent-id="child-b"]');
      await expect(a).toBeVisible();
      await expect(a.locator("summary").first()).toContainText("完成");
      await expect(b.locator("summary").first()).toContainText("失败");
      await expect(page.getByText("子代理 A 的完整输出", { exact: true })).toHaveCount(0);
      await a.locator("summary").first().click();
      await expect(a).toContainText("子代理 A 的完整输出");
      await expect(a).not.toContainText("子代理 B 的独立输出");
      await expect(a.locator(".thinking-block")).toHaveCount(1);
      await expect(a.locator(".thinking-block")).toContainText("历史思考完整内容");
      await expect(a.locator(".assistant-turn")).not.toContainText("历史思考完整内容");
      await a.locator(".tool-card > summary").click();
      await expect(a).toContainText("Read marker.txt");
      await expect(a.locator("pre")).toHaveText("原生工具嵌套结果");
      await page.evaluate(() => {
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: { writeText: async (text: string) => localStorage.setItem("copied-child", text) },
        });
      });
      await a.getByRole("button", { name: "复制子代理输出", exact: true }).click();
      expect(await page.evaluate(() => localStorage.getItem("copied-child"))).toBe(
        "历史思考完整内容\n子代理 A 的完整输出\n原生工具嵌套结果",
      );
      await b.locator("summary").first().click();
      await expect(b).toContainText("仅子代理失败");
      await expect(b).toContainText("子代理本轮失败");
      await expect(b).not.toContainText("pi 本轮失败");
      await expect(page.getByText("主代理未被子代理结束事件终止", { exact: true })).toBeVisible();
      await page.locator('[data-agent-id="empty-child"] > summary').click();
      await expect(
        page.getByText("尚未收到原生子代理输出；当前仅有状态通知。", { exact: true }),
      ).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await a.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `../../.local/verification/subagents-${mobile ? "mobile" : "desktop"}.png`,
      });
      expect(errors).toEqual([]);
    } finally {
      await page.unrouteAll({ behavior: "wait" });
      await page.request.delete(`/api/sessions/${session.id}`);
    }
  });
