import { expect, test } from "@playwright/test";

for (const width of [1440, 390])
  test(`many agent tabs stay bounded, close, reopen, collapse and preserve main position at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 960 });
    const session = await (
      await page.request.post("/api/sessions", {
        data: { title: `Agent navigation ${width}`, harnessId: "claude-code", kind: "direct" },
      })
    ).json();
    const agents = Array.from({ length: 40 }, (_, i) => ({
      agentId: `child-${i}`,
      name: `子代理 ${i} · 检查项目目录与长标题内容`,
      status: "running",
      updatedAt: new Date().toISOString(),
    }));
    const events = Array.from({ length: 120 }, (_, i) => ({
      id: `main-${i}`,
      sequence: i + 1,
      sessionId: session.id,
      type: "message",
      payload: { role: "assistant", text: `主对话 ${i}：内容和输入框不应被子代理标签挤走。` },
      source: "fixture",
      nativeRunId: null,
      createdAt: new Date().toISOString(),
    }));
    const mutations: string[] = [];
    page.on("request", (request) => {
      if (["POST", "DELETE", "PUT", "PATCH"].includes(request.method()))
        mutations.push(request.url());
    });
    await page.route(`**/api/sessions/${session.id}?*`, (route) =>
      route.fulfill({ json: { session, events, commands: [], olderCursor: null } }),
    );
    await page.route(`**/api/sessions/${session.id}/activity`, (route) =>
      route.fulfill({ json: { sessionId: session.id, cursor: events.length, agents } }),
    );
    await page.route(`**/api/sessions/${session.id}/agents/*`, (route) => {
      const id = new URL(route.request().url()).pathname.split("/").at(-1);
      return route.fulfill({
        json: {
          agent: agents.find((a) => a.agentId === id),
          events: events.map((e) => ({
            ...e,
            id: `${id}-${e.id}`,
            payload: { role: "assistant", text: `${id} 独立输出 ${e.sequence}` },
          })),
          olderCursor: null,
        },
      });
    });
    await page.addInitScript((id) => localStorage.setItem("kodo.session", id), session.id);
    await page.goto("/");
    if (width < 600) {
      await expect(page.getByRole("tablist", { name: "主对话与子代理", exact: true })).toHaveCount(
        0,
      );
      const pill = page.getByRole("button", { name: /40 子代理/ });
      await expect(pill).toBeVisible();
      await pill.click();
      const sheet = page.getByRole("dialog", { name: "子代理切换" });
      await expect(sheet).toBeVisible();
      await expect(sheet.locator("button.ios-sheet-action-row")).toHaveCount(41);
      await sheet.getByRole("button", { name: /子代理 25/ }).click();
      const mobileBannerBack = page
        .locator(".mobile-subagent-banner")
        .getByRole("button", { name: "返回主对话", exact: true });
      await expect(mobileBannerBack).toBeVisible();
      await mobileBannerBack.click();
      await expect(mobileBannerBack).toHaveCount(0);
      return;
    }
    const tabs = page.getByRole("tablist", { name: "主对话与子代理", exact: true });
    await expect(tabs.getByRole("tab")).toHaveCount(41);
    await expect(
      page.getByRole("button", { name: "向后滚动子代理标签", exact: true }),
    ).toBeEnabled();
    const main = page.locator(".conversation-main > .conversation .transcript");
    await main.evaluate((el) => {
      el.scrollTop = 1100;
    });
    const before = await main.evaluate((el) => ({
      top: el.scrollTop,
      left: el.getBoundingClientRect().left,
      width: el.clientWidth,
    }));
    await page.getByRole("button", { name: "向后滚动子代理标签", exact: true }).click();
    await expect.poll(() => tabs.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    await tabs.hover();
    const wheelBefore = await tabs.evaluate((el) => el.scrollLeft);
    await page.mouse.wheel(0, 400);
    await expect.poll(() => tabs.evaluate((el) => el.scrollLeft)).toBeGreaterThan(wheelBefore);
    await page.getByRole("combobox", { name: "全部子代理", exact: true }).selectOption("child-39");
    const panel = page.getByRole("tabpanel");
    await expect(panel).toContainText("child-39 独立输出 120");
    const childScroll = panel.locator(".transcript");
    expect(await childScroll.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await childScroll.evaluate((el) => {
      el.scrollTop = 700;
    });
    await panel.getByRole("button", { name: "返回主对话", exact: true }).click();
    await expect.poll(() => main.evaluate((el) => el.scrollTop)).toBeCloseTo(before.top, 0);
    const after = await main.evaluate((el) => ({
      left: el.getBoundingClientRect().left,
      width: el.clientWidth,
    }));
    expect(after.left).toBeCloseTo(before.left, 0);
    expect(after.width).toBe(before.width);
    await page.getByRole("combobox", { name: "全部子代理", exact: true }).selectOption("child-39");
    await expect.poll(() => childScroll.evaluate((el) => el.scrollTop)).toBeCloseTo(700, 0);
    await page
      .getByRole("button", { name: `关闭子代理标签：${agents[39].name}`, exact: true })
      .click();
    await expect(panel).toHaveCount(0);
    await expect(tabs.getByRole("tab")).toHaveCount(40);
    await page.getByRole("combobox", { name: "全部子代理", exact: true }).selectOption("child-39");
    await expect(panel).toBeVisible();
    await expect(tabs.getByRole("tab")).toHaveCount(41);
    await page.getByRole("button", { name: "收起子代理标签", exact: true }).click();
    await expect(tabs.getByRole("tab")).toHaveCount(1);
    await expect(panel).toHaveCount(0);
    await page.getByRole("button", { name: "展开子代理标签", exact: true }).click();
    await expect(tabs.getByRole("tab")).toHaveCount(41);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`many-agent-tabs-${width}.png`) });
    expect(mutations).toEqual([]);
  });
