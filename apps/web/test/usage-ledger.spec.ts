import { expect, test } from "@playwright/test";

const shotPath = (info: { outputPath: (name: string) => string }, name: string) =>
  process.env.HIG_SHOT_DIR ? `${process.env.HIG_SHOT_DIR}/${name}` : info.outputPath(name);

function mockUsagePayload(sessionId: string) {
  const now = Date.now();
  const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
  return {
    records: [
      {
        id: "u-1",
        sessionId,
        projectId: null,
        bindingId: null,
        source: "claude-code",
        scope: "turn",
        input: 18420,
        output: 1280,
        cacheRead: 12400,
        cacheWrite: 1600,
        costUsd: 0.0184,
        costKind: "actual",
        model: "anthropic/claude-sonnet-4-6",
        firstTokenMs: 640,
        durationMs: 7420,
        createdAt: iso(4),
      },
      {
        id: "u-2",
        sessionId,
        projectId: null,
        bindingId: null,
        source: "codex",
        scope: "turn",
        input: 9640,
        output: 890,
        cacheRead: 4200,
        cacheWrite: 0,
        costUsd: 0.0062,
        costKind: "estimate",
        model: "openai/gpt-5.4",
        firstTokenMs: 2180,
        durationMs: 16800,
        createdAt: iso(19),
      },
      {
        id: "u-3",
        sessionId: "deleted-session-id",
        projectId: null,
        bindingId: null,
        source: "claude-code",
        scope: "turn",
        input: 0,
        output: 0,
        cacheRead: null,
        cacheWrite: null,
        costUsd: 0,
        costKind: "estimate",
        model: "gemini-4-argon",
        firstTokenMs: 5640,
        durationMs: 72400,
        createdAt: iso(45),
      },
      {
        id: "u-4",
        sessionId,
        projectId: null,
        bindingId: null,
        source: "kodo",
        scope: "turn",
        input: 4120,
        output: 615,
        cacheRead: 0,
        cacheWrite: 0,
        costUsd: 0.0019,
        costKind: "estimate",
        model: "deepseek-v4.1-flash",
        firstTokenMs: 390,
        durationMs: 3150,
        createdAt: iso(90),
      },
      {
        id: "u-5",
        sessionId: "deleted-session-2",
        projectId: null,
        bindingId: null,
        source: "opencode",
        scope: "session",
        input: 26800,
        output: 3420,
        cacheRead: 16200,
        cacheWrite: 0,
        costUsd: null,
        costKind: "unknown",
        model: null,
        firstTokenMs: null,
        durationMs: null,
        createdAt: iso(140),
      },
    ],
    budgets: [],
  };
}

test.describe("Usage Ledger beautification & latency columns", () => {
  test("desktop 1440px & 1024px show TTFT, total duration, averages and zero right clipping", async ({
    page,
    request,
  }, info) => {
    const sessionRes = await request.post("/api/sessions", {
      data: {
        title: "请你为我分析当前项目，我想要对我的前端布局进行美化",
        harnessId: "claude-code",
        kind: "direct",
      },
    });
    expect(sessionRes.ok()).toBe(true);
    const session = await sessionRes.json();

    try {
      await page.route("**/api/usage", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(mockUsagePayload(session.id)),
        });
      });

      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/");
      await page.getByRole("button", { name: "设置" }).first().click();
      await page.getByRole("button", { name: "用量", exact: true }).click();

      const section = page.locator(".usage-ledger-section");
      await expect(section).toBeVisible();
      await section.scrollIntoViewIfNeeded();

      // Header averages & dedicated timing columns
      await expect(section.locator(".usage-ledger-header__stats")).toContainText("平均首字");
      await expect(section.locator(".usage-ledger-header__stats")).toContainText("平均总耗时");

      const table = section.locator("table.usage-table");
      await expect(table).toBeVisible();
      await expect(table.locator("thead")).toContainText("首字时间");
      await expect(table.locator("thead")).toContainText("总时间");
      await expect(table.locator("tbody")).toContainText("640ms");
      await expect(table.locator("tbody")).toContainText("7.42s");
      await expect(table.locator("tbody")).toContainText("2.18s");
      await expect(table.locator("tbody")).toContainText("5.64s");
      await expect(table.locator("tbody")).toContainText("1m 12s");
      await expect(table.locator("tbody")).toContainText("390ms");

      // Zero horizontal clipping on 1440px
      const overflow1440 = await section.evaluate((el) => {
        const scroll = el.querySelector(".usage-ledger-desktop") as HTMLElement;
        const tbl = el.querySelector("table.usage-table") as HTMLElement;
        const cells = [...tbl.querySelectorAll("td, th")] as HTMLElement[];
        const clippedCells = cells
          .filter((c) => c.scrollWidth > c.clientWidth + 1)
          .map((c) => ({ text: c.innerText.trim(), sw: c.scrollWidth, cw: c.clientWidth }));
        return {
          tableFits: tbl.scrollWidth <= scroll.clientWidth + 1,
          pageFits: document.documentElement.scrollWidth <= window.innerWidth + 1,
          scrollW: tbl.scrollWidth,
          clientW: scroll.clientWidth,
          clippedCells,
        };
      });
      expect(overflow1440.tableFits, JSON.stringify(overflow1440)).toBe(true);
      expect(overflow1440.clippedCells, JSON.stringify(overflow1440.clippedCells)).toEqual([]);
      expect(overflow1440.pageFits).toBe(true);

      await section.screenshot({ path: shotPath(info, "usage-ledger-1440.png") });

      // Dark theme visual verification
      await page.getByRole("button", { name: "深色主题", exact: true }).click();
      await expect(page.locator("html")).toHaveClass(/\bdark\b/);
      await section.screenshot({ path: shotPath(info, "usage-ledger-1440-dark.png") });
      await page.getByRole("button", { name: "浅色主题", exact: true }).click();

      // Compact desktop 1024px: container query switches cleanly to Inset Grouped cards with zero overlap
      await page.setViewportSize({ width: 1024, height: 768 });
      await section.scrollIntoViewIfNeeded();
      await expect(section.locator(".usage-ledger-mobile")).toBeVisible();
      await expect(section.locator(".usage-ledger-mobile")).toContainText("首字时间");
      await expect(section.locator(".usage-ledger-mobile")).toContainText("总时间");
      await expect(section.locator(".usage-ledger-mobile")).toContainText("640ms");
      await expect(section.locator(".usage-ledger-mobile")).toContainText("7.42s");
      const pageFits1024 = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      );
      expect(pageFits1024).toBe(true);
      await section.screenshot({ path: shotPath(info, "usage-ledger-1024.png") });
    } finally {
      await request.delete(`/api/sessions/${session.id}`);
    }
  });

  test("mobile 390px switches to Inset Grouped cards showing TTFT and total duration without overflow", async ({
    page,
    request,
  }, info) => {
    const sessionRes = await request.post("/api/sessions", {
      data: {
        title: "移动端用量明细检查",
        harnessId: "claude-code",
        kind: "direct",
      },
    });
    expect(sessionRes.ok()).toBe(true);
    const session = await sessionRes.json();

    try {
      await page.route("**/api/usage", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(mockUsagePayload(session.id)),
        });
      });

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/");
      await page
        .getByRole("navigation", { name: "移动端标签导航" })
        .getByRole("button", { name: "用量" })
        .click();

      const section = page.locator(".usage-ledger-section");
      await expect(section).toBeVisible();
      await section.scrollIntoViewIfNeeded();

      await expect(section.locator(".usage-ledger-desktop")).toBeHidden();
      const mobileList = section.locator(".usage-ledger-mobile");
      await expect(mobileList).toBeVisible();
      await expect(mobileList).toContainText("首字时间");
      await expect(mobileList).toContainText("总时间");
      await expect(mobileList).toContainText("640ms");
      await expect(mobileList).toContainText("7.42s");
      await expect(mobileList).toContainText("1m 12s");

      const fitsMobile = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      );
      expect(fitsMobile).toBe(true);
      await section.screenshot({ path: shotPath(info, "usage-ledger-390.png") });
    } finally {
      await request.delete(`/api/sessions/${session.id}`);
    }
  });
});
