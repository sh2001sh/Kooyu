import { test, expect } from "@playwright/test";

test.afterEach(async ({ request }) => {
  const snapshot = await (await request.get("/api/snapshot")).json();
  for (const session of snapshot.sessions.filter((s: { title: string }) =>
    ["合成搜索定位回归", "合成删除回归"].includes(s.title),
  ))
    await request.delete(`/api/sessions/${session.id}`);
});

// Browser-only synthetic transcript. Host's bounded event lookup and cross-session
// identity checks are independently covered in domain tests; no model is mocked as real.
test("search opens an old event in the same or another session and leaves history bounded", async ({
  page,
}) => {
  const created = await page.request.post("/api/sessions", {
    data: { title: "合成搜索定位回归", harnessId: "pi", kind: "direct" },
  });
  const session = await created.json();
  const events = Array.from({ length: 1000 }, (_, i) => ({
    id: `event-${i}`,
    sessionId: session.id,
    nativeRunId: null,
    sequence: i + 1,
    type: "message",
    payload: {
      id: `native-${i}`,
      role: "assistant",
      text: i === 10 ? "EARLY_SEARCH_TARGET_0010" : `synthetic message ${i}`,
    },
    createdAt: new Date().toISOString(),
    source: "pi",
  }));
  let located = 0;
  await page.route(`**/api/sessions/${session.id}?*`, (route) => {
    const url = new URL(route.request().url());
    const hit = url.searchParams.get("event");
    if (hit) located++;
    const slice = hit
      ? events.slice(0, 161)
      : url.searchParams.has("before")
        ? events.slice(400, 700)
        : events.slice(-300);
    return route.fulfill({
      json: {
        session,
        events: slice,
        commands: [],
        olderCursor: hit ? null : slice[0].sequence,
        anchorEventId: hit,
      },
    });
  });
  await page.route("**/api/search?*", (route) =>
    route.fulfill({
      json: {
        sessions: [],
        hits: [{ sessionId: session.id, eventId: "event-10", snippet: "EARLY_SEARCH_TARGET_0010" }],
      },
    }),
  );
  await page.goto("/");
  await page.locator(".session-row").filter({ hasText: session.title }).click();
  await expect(page.locator(".transcript .turn")).toHaveCount(300);
  await page.getByRole("button", { name: "更早记录", exact: true }).click();
  await page.getByRole("textbox", { name: /搜索/ }).fill("EARLY_SEARCH_TARGET_0010");
  await expect(page.locator(".search-snippet")).toBeVisible();
  await page.locator(".session-row").filter({ hasText: session.title }).click();
  const hit = page.locator('[data-search-hit="true"]');
  await expect(hit).toContainText("EARLY_SEARCH_TARGET_0010");
  await expect(hit).toBeInViewport();
  expect(await page.locator(".transcript .turn").count()).toBeLessThanOrEqual(300);
  expect(located).toBe(1);
  await page.getByRole("button", { name: "新建会话", exact: true }).first().click();
  await page.locator(".session-row").filter({ hasText: session.title }).click();
  await expect(hit).toBeInViewport();
  expect(located).toBe(2);
  await page.getByRole("button", { name: "返回最新记录", exact: true }).click();
  await expect(page.locator(".transcript .turn")).toHaveCount(300);
  await expect(hit).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "返回会话列表", exact: true }).click();
  await page.locator(".session-row").filter({ hasText: session.title }).click();
  await expect(hit).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "../../output/playwright/search-location-fixed-mobile.png" });
});

test("context-menu deletion syncs across tabs and removes the session from the real Host snapshot", async ({
  page,
}) => {
  const r = await page.request.post("/api/sessions", {
    data: { title: "合成删除回归", harnessId: "pi", kind: "direct" },
  });
  const session = await r.json();
  await page.goto("/");
  await page.locator(".session-row").filter({ hasText: session.title }).click();
  const other = await page.context().newPage();
  await other.goto("/");
  await other.locator(".session-row").filter({ hasText: session.title }).click();
  await expect(other.getByRole("heading", { name: session.title, exact: true })).toBeVisible();
  await page.locator(".session-row").filter({ hasText: session.title }).click({ button: "right" });
  const menu = page.getByRole("menu", { name: "会话操作", exact: true });
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "删除会话", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "删除会话", exact: true });
  await dialog.getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.getByText(session.title, { exact: true })).toHaveCount(0);
  expect((await page.request.get(`/api/sessions/${session.id}`)).status()).toBe(404);
  const snapshot = await (await page.request.get("/api/snapshot")).json();
  expect(snapshot.sessions.some((s: { id: string }) => s.id === session.id)).toBe(false);
  await expect(other.getByText(session.title, { exact: true })).toHaveCount(0);
  await expect(other.getByRole("button", { name: "创建会话", exact: true })).toBeVisible();
  await other.close();
});
