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
    const agents = [
      { agentId: "child-a", name: "代码检查与结果整理", status: "completed" },
      { agentId: "child-b", name: "运行测试", status: "failed" },
      { agentId: "empty-child", status: "running" },
    ].map((a) => ({ ...a, updatedAt: new Date().toISOString() }));
    await page.route(`**/api/sessions/${session.id}/activity`, (route) =>
      route.fulfill({ json: { sessionId: session.id, cursor: events.length, agents } }),
    );
    await page.route(`**/api/sessions/${session.id}/agents/*`, (route) => {
      const id = new URL(route.request().url()).pathname.split("/").at(-1);
      const childEvents = events
        .filter(
          (e) =>
            e.type === "subagent" && (e.payload as any).agentId === id && (e.payload as any).event,
        )
        .map((e) => ({ ...e, ...(e.payload as any).event }));
      return route.fulfill({
        json: {
          agent: agents.find((a) => a.agentId === id),
          events: childEvents,
          olderCursor: null,
        },
      });
    });
    await page.addInitScript((id) => localStorage.setItem("kodo.session", id), session.id);
    try {
      await page.goto("/");
      await expect(page.getByText("子代理 A 的完整输出", { exact: true })).toHaveCount(0);
      if (mobile) {
        const pill = page.getByRole("button", { name: /3 子代理/ });
        await expect(pill).toBeVisible();
        await pill.click();
        const sheet = page.getByRole("dialog", { name: "子代理切换" });
        await sheet.getByRole("button", { name: /代码检查与结果整理/ }).click();
      } else {
        const a = page.locator('[data-agent-id="child-a"]');
        const b = page.locator('[data-agent-id="child-b"]');
        await expect(a).toBeVisible();
        await expect(a.locator("button").first()).toContainText("完成");
        await expect(b.locator("button").first()).toContainText("失败");
        await a.locator("button").first().click();
      }
      const panel = page.getByRole("tabpanel");
      await expect(panel).toContainText("子代理 A 的完整输出");
      await expect(panel).not.toContainText("子代理 B 的独立输出");
      await expect(panel.locator(".thinking-block")).toHaveCount(1);
      await expect(panel.locator(".thinking-block")).toContainText("历史思考完整内容");
      await expect(panel.locator(".assistant-turn")).not.toContainText("历史思考完整内容");
      await panel.locator(".tool-card > summary").click();
      await expect(panel).toContainText("Read marker.txt");
      await expect(panel.locator("pre")).toHaveText("原生工具嵌套结果");
      if (mobile) {
        await page.getByRole("button", { name: "切换", exact: true }).click();
        await page
          .getByRole("dialog", { name: "子代理切换" })
          .getByRole("button", { name: /运行测试/ })
          .click();
      } else {
        await page
          .getByRole("combobox", { name: "全部子代理", exact: true })
          .selectOption("child-b");
      }
      await expect(panel).toContainText("仅子代理失败");
      await expect(panel).toContainText("子代理本轮失败");
      await expect(panel).not.toContainText("pi 本轮失败");
      if (mobile) {
        await page
          .locator(".mobile-subagent-banner")
          .getByRole("button", { name: "返回主对话" })
          .click();
      } else {
        await panel.getByRole("button", { name: "返回主对话", exact: true }).click();
      }
      await expect(page.getByText("主代理未被子代理结束事件终止", { exact: true })).toBeVisible();
      if (mobile) {
        await page.getByRole("button", { name: /3 子代理/ }).click();
        await page
          .getByRole("dialog", { name: "子代理切换" })
          .getByRole("button", { name: /empty-child/ })
          .click();
      } else {
        await page.locator('[data-agent-id="empty-child"] > button').click();
      }
      await expect(
        page.getByText("尚未收到子代理的对话记录，当前仅有状态通知。", { exact: true }),
      ).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: `../../.local/verification/subagents-${mobile ? "mobile" : "desktop"}.png`,
      });
      expect(errors).toEqual([]);
    } finally {
      await page.unrouteAll({ behavior: "wait" });
      await page.request.delete(`/api/sessions/${session.id}`);
    }
  });
