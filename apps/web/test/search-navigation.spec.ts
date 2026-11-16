import { test, expect } from "@playwright/test";

test.afterEach(async ({ request }) => {
  const snapshot = await (await request.get("/api/snapshot")).json();
  for (const session of snapshot.sessions.filter((s: { title: string }) =>
    ["合成搜索定位回归", "合成删除回归", "历史分页完整性回归"].includes(s.title),
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

for (const width of [1440, 390])
  test(`older history preserves the viewport and complete latest answer at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const session = await (
      await page.request.post("/api/sessions", {
        data: { title: "历史分页完整性回归", harnessId: "pi", kind: "direct" },
      })
    ).json();
    const finalText =
      Array.from(
        { length: 35 },
        (_, i) => `完整回复第 ${i + 1} 段：加载历史记录以后，这段内容仍然完整可见。`,
      ).join("\n\n") + "\n\nLATEST_ANSWER_END";
    const events = Array.from({ length: 900 }, (_, i) => ({
      id: `history-${i}`,
      sequence: i + 1,
      sessionId: session.id,
      nativeRunId: null,
      type: "message",
      source: "pi",
      createdAt: new Date().toISOString(),
      payload: {
        role: "assistant",
        text:
          i === 899
            ? `<analysis>RELAY_ANALYSIS_ONLY</analysis>\n<final>${finalText}</final>`
            : `历史消息 ${i}`,
      },
    }));
    let latestVersion = false;
    let tails = 0;
    await page.route(`**/api/sessions/${session.id}?*`, async (route) => {
      const url = new URL(route.request().url());
      const before = Number(url.searchParams.get("before"));
      if (!before) tails++;
      const all = latestVersion
        ? [
            ...events,
            {
              ...events[899]!,
              id: "fresh-event",
              sequence: 901,
              payload: { role: "assistant", text: "FRESH_LATEST_REPLY" },
            },
          ]
        : events;
      const end = before ? before - 1 : all.length;
      const slice = all.slice(Math.max(0, end - 300), end);
      await route.fulfill({
        json: {
          session,
          events: slice,
          commands: [],
          olderCursor: slice[0]!.sequence > 1 ? slice[0]!.sequence : null,
        },
      });
    });
    await page.addInitScript((id) => localStorage.setItem("kodo.session", id), session.id);
    await page.goto("/");
    const transcript = page.locator(".transcript");
    await expect(transcript.getByText("LATEST_ANSWER_END", { exact: true })).toBeInViewport();
    await transcript.evaluate((el) => {
      el.scrollTop = 0;
    });
    const anchor = transcript.locator("#message-history-600 .markdown");
    const beforeTop = (await anchor.boundingBox())!.y;
    await page.getByRole("button", { name: "更早记录", exact: true }).click();
    await expect(transcript.locator(".assistant-turn")).toHaveCount(600);
    expect(Math.abs((await anchor.boundingBox())!.y - beforeTop)).toBeLessThan(8);
    // Prepending the second page must keep both already loaded pages and the newest reply.
    await transcript.evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.getByRole("button", { name: "更早记录", exact: true }).click();
    await expect(transcript.locator(".assistant-turn")).toHaveCount(900);
    await transcript.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(transcript.getByText("LATEST_ANSWER_END", { exact: true })).toBeInViewport();
    const answer = transcript.locator(".assistant-turn").last();
    await expect(answer).not.toContainText("RELAY_ANALYSIS_ONLY");
    await expect(answer).not.toContainText("<analysis>");
    const thought = transcript.locator(".thinking-block");
    await thought.locator("summary").click();
    await expect(thought).toContainText("RELAY_ANALYSIS_ONLY");
    await expect(thought).not.toContainText("LATEST_ANSWER_END");
    await thought.locator("summary").click();
    await transcript.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(transcript.getByText("LATEST_ANSWER_END", { exact: true })).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`history-complete-${width}.png`) });
    // The floating latest button must fetch the tail; scrolling an old page is insufficient.
    latestVersion = true;
    await transcript.evaluate((el) => {
      el.scrollTop = 500;
    });
    const initialTails = tails;
    await page.getByRole("button", { name: "回到底部", exact: true }).click();
    await expect(transcript.getByText("FRESH_LATEST_REPLY", { exact: true })).toBeInViewport();
    expect(tails).toBeGreaterThan(initialTails);
    await expect(transcript.locator(".assistant-turn")).toHaveCount(300);
  });

test("analysis channels and native thinking snapshots never become an assistant answer", async ({
  page,
}) => {
  const session = await (
    await page.request.post("/api/sessions", {
      data: { title: "历史分页完整性回归", harnessId: "pi", kind: "direct" },
    })
  ).json();
  const values = [
    ["message", { role: "user", text: "请解释字面标记 <analysis> 的含义" }],
    ["text-delta", { text: "ANALYSIS_CHANNEL_ONLY", channel: "analysis", itemId: "analysis" }],
    ["message", { id: "analysis", text: "ANALYSIS_CHANNEL_ONLY", channel: "analysis" }],
    [
      "message",
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "NATIVE_THINKING_ONLY" },
          { type: "text", text: "FINAL_NATIVE_ANSWER" },
        ],
      },
    ],
    ["message", { role: "user", text: "继续" }],
    ["text-delta", { text: "<ana" }],
    [
      "text-delta",
      { text: "lysis>STREAM_ANALYSIS_ONLY</analysis><final>STREAM_FINAL_ANSWER</final>" },
    ],
    [
      "message",
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "<analysis>STREAM_ANALYSIS_ONLY</analysis><final>STREAM_FINAL_ANSWER</final>",
          },
        ],
      },
    ],
    ["message", { role: "user", text: "只有思考，没有回答" }],
    [
      "message",
      { role: "assistant", content: [{ type: "thinking", thinking: "REASONING_ONLY_SNAPSHOT" }] },
    ],
  ];
  const events = values.map(([type, payload], index) => ({
    id: `analysis-${index}`,
    sequence: index + 1,
    sessionId: session.id,
    nativeRunId: null,
    type,
    payload,
    source: "pi",
    createdAt: new Date().toISOString(),
  }));
  await page.route(`**/api/sessions/${session.id}?*`, (route) =>
    route.fulfill({ json: { session, events, commands: [], olderCursor: null } }),
  );
  await page.addInitScript((id) => localStorage.setItem("kodo.session", id), session.id);
  await page.goto("/");
  const answers = page.locator(".transcript .assistant-turn");
  await expect(answers).toHaveCount(2);
  await expect(answers.nth(0)).toHaveText(/FINAL_NATIVE_ANSWER/);
  await expect(answers.nth(1)).toHaveText(/STREAM_FINAL_ANSWER/);
  for (const answer of await answers.all())
    await expect(answer).not.toContainText(/ANALYSIS|THINKING|<analysis>/);
  await expect(page.locator(".user-turn").first()).toContainText("<analysis>");
  const thoughts = page.locator(".thinking-block");
  for (const thought of await thoughts.all()) await thought.locator("summary").click();
  await expect(page.getByText("REASONING_ONLY_SNAPSHOT", { exact: true })).toBeVisible();
  await expect(page.getByText("STREAM_ANALYSIS_ONLY", { exact: true })).toHaveCount(1);
});
