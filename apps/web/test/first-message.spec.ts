import { expect, test } from "@playwright/test";
import type { Session } from "@kodo/protocol";

test.use({ locale: "zh-CN" });

function receipt(sessionId: string, input: { requestId: string; text: string; mode: string }) {
  return {
    id: input.requestId,
    sessionId,
    kind: "send",
    origin: "user",
    controllerId: null,
    generation: 0,
    bindingRevision: null,
    status: "accepted",
    nativeRunId: null,
    body: { text: input.text, mode: input.mode },
    createdAt: new Date().toISOString(),
  };
}

test("a late snapshot captured before creation cannot remove the new conversation", async ({
  page,
  request,
}) => {
  await page.addInitScript(() => {
    const NativeSource = window.EventSource;
    const sources: EventSource[] = [];
    window.EventSource = class extends NativeSource {
      constructor(url: string | URL, options?: EventSourceInit) {
        super(url, options);
        sources.push(this);
      }
    };
    window.addEventListener("test-host-state", () =>
      sources.at(-1)!.dispatchEvent(
        new MessageEvent("message", {
          data: JSON.stringify({
            sessionId: "other-session",
            sequence: 1,
            type: "state",
            payload: {},
          }),
        }),
      ),
    );
  });
  let session: Session | undefined;
  let holdSnapshot = false;
  let snapshotCaptured = false;
  let sendStarted = false;
  let stops = 0;
  let releaseSnapshot!: () => void;
  let releaseSend!: () => void;
  const snapshotGate = new Promise<void>((resolve) => {
    releaseSnapshot = resolve;
  });
  const sendGate = new Promise<void>((resolve) => {
    releaseSend = resolve;
  });
  await page.route("**/api/snapshot", async (route) => {
    if (!holdSnapshot) return route.continue();
    holdSnapshot = false;
    const response = await route.fetch();
    snapshotCaptured = true;
    await snapshotGate;
    await route.fulfill({ response });
  });
  await page.route("**/api/sessions", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    session = await response.json();
    await route.fulfill({ response });
  });
  await page.route("**/api/sessions/*/send", async (route) => {
    sendStarted = true;
    await sendGate;
    await route.fulfill({
      status: 202,
      json: receipt(session!.id, route.request().postDataJSON()),
    });
  });
  await page.route("**/api/sessions/*/stop", async (route) => {
    stops++;
    expect(route.request().postDataJSON().pause).toBe(false);
    await route.fulfill({ json: { status: "active", cancel: "requested; await native event" } });
  });
  try {
    await page.goto("/");
    await expect(page.getByText("Host 已连接", { exact: true })).toHaveCount(1);
    holdSnapshot = true;
    await page.evaluate(() => window.dispatchEvent(new Event("test-host-state")));
    await expect.poll(() => snapshotCaptured).toBe(true);
    await page.getByRole("button", { name: "新建会话", exact: true }).first().click();
    await page.getByRole("textbox", { name: "消息", exact: true }).fill("旧快照不能清掉新会话");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await expect.poll(() => sendStarted).toBe(true);
    const lateResponse = page.waitForResponse((response) =>
      response.url().endsWith("/api/snapshot"),
    );
    releaseSnapshot();
    await (await lateResponse).finished();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(
      page.locator(".user-turn").filter({ hasText: "旧快照不能清掉新会话" }),
    ).toHaveCount(1);
    await expect(page.locator(".draft-composer-wrap")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "中断当前回合", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "中断当前回合", exact: true }).click();
    await expect.poll(() => stops).toBe(1);
    await expect(
      page.getByRole("status").filter({ hasText: "已请求中断当前回合。" }),
    ).toBeVisible();
    releaseSend();
  } finally {
    releaseSnapshot();
    releaseSend();
    await page.unrouteAll({ behavior: "wait" });
    if (session) await request.delete("/api/sessions/" + session.id);
  }
});

for (const width of [1440, 390]) {
  test(
    "first message paints before slow creation and send receipts at " + width + "px",
    async ({ page, request }, info) => {
      await page.setViewportSize({ width, height: 960 });
      let session: Session | undefined;
      let createRequests = 0;
      let sendRequests = 0;
      const message = "FIRST_MESSAGE_FEEDBACK_" + width;
      await page.route("**/api/sessions", async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        createRequests++;
        const response = await route.fetch();
        session = await response.json();
        await new Promise((resolve) => setTimeout(resolve, 1200));
        await route.fulfill({ response });
      });
      // Synthetic delivery receipt only: the Host never opens a native model session.
      await page.route("**/api/sessions/*/send", async (route) => {
        sendRequests++;
        const input = route.request().postDataJSON();
        await new Promise((resolve) => setTimeout(resolve, 1200));
        await route.fulfill({
          status: 202,
          json: {
            id: input.requestId,
            sessionId: session!.id,
            kind: "send",
            origin: "user",
            controllerId: null,
            generation: 0,
            bindingRevision: null,
            status: "accepted",
            nativeRunId: null,
            body: { text: input.text, mode: input.mode },
            createdAt: new Date().toISOString(),
          },
        });
      });
      try {
        await page.goto("/");
        await expect(page.getByText("Host 已连接", { exact: true })).toHaveCount(1);
        await page.getByRole("button", { name: "新建会话", exact: true }).first().click();
        await page.getByRole("textbox", { name: "消息", exact: true }).fill(message);
        const sendButton = page.getByRole("button", { name: "发送消息", exact: true });
        await expect(sendButton).toBeEnabled();
        // Settle the draft-view entrance transition so the stopwatch measures send-to-paint latency
        // rather than Playwright's pre-click stability wait on slow CI software renderers.
        await page.evaluate(() => {
          for (const animation of document.getAnimations()) {
            if (animation.effect?.getComputedTiming().iterations !== Infinity) animation.finish();
          }
        });
        const started = Date.now();
        await sendButton.click();
        await page.locator(".user-turn").filter({ hasText: message }).waitFor();
        const messageMs = Date.now() - started;
        await page.locator(".run-indicator").first().waitFor();
        const loadingMs = Date.now() - started;
        console.log(JSON.stringify({ width, messageMs, loadingMs, artificialNetworkMs: 2400 }));
        await page.screenshot({ path: info.outputPath("first-message-" + width + ".png") });
        expect(messageMs).toBeLessThan(500);
        expect(loadingMs).toBeLessThan(500);
        await expect.poll(() => sendRequests).toBe(1);
        await expect(page.locator(".draft-composer-wrap")).toHaveCount(0);
        expect(createRequests).toBe(1);
        await expect(page.locator(".user-turn").filter({ hasText: message })).toHaveCount(1);
      } finally {
        await page.unrouteAll({ behavior: "wait" });
        if (session) await request.delete("/api/sessions/" + session.id);
      }
    },
  );
}

test("failed creation preserves the draft and rapid Enter creates only one retry", async ({
  page,
  request,
}) => {
  let creates = 0;
  let sends = 0;
  let session: Session | undefined;
  await page.route("**/api/sessions", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    creates++;
    if (creates === 1) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return route.fulfill({
        status: 400,
        json: { error: { code: "INVALID_INPUT", message: "创建失败测试" } },
      });
    }
    const response = await route.fetch();
    session = await response.json();
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({ response });
  });
  await page.route("**/api/sessions/*/send", async (route) => {
    sends++;
    await route.fulfill({
      status: 202,
      json: receipt(session!.id, route.request().postDataJSON()),
    });
  });
  try {
    await page.goto("/");
    await expect(page.getByText("Host 已连接", { exact: true })).toHaveCount(1);
    await page.getByRole("button", { name: "新建会话", exact: true }).first().click();
    const composer = page.getByRole("textbox", { name: "消息", exact: true });
    await composer.fill("保留创建失败的首条消息");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await expect(page.getByText("创建失败测试", { exact: true })).toBeVisible();
    await expect(composer).toHaveValue("保留创建失败的首条消息");
    await expect(page.locator(".run-indicator")).toHaveCount(0);
    await composer.press("Enter");
    await page.keyboard.press("Enter");
    await expect.poll(() => sends).toBe(1);
    await expect(page.getByRole("button", { name: "中断当前回合", exact: true })).toBeEnabled();
    expect(creates).toBe(2);
    expect(sends).toBe(1);
    await expect(
      page.locator(".user-turn").filter({ hasText: "保留创建失败的首条消息" }),
    ).toHaveCount(1);
  } finally {
    await page.unrouteAll({ behavior: "wait" });
    if (session) await request.delete("/api/sessions/" + session.id);
  }
});

test("rejected first send restores its text and retries in the same session", async ({
  page,
  request,
}) => {
  let session: Session | undefined;
  let creates = 0;
  let sends = 0;
  await page.route("**/api/sessions", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    creates++;
    const response = await route.fetch();
    session = await response.json();
    await route.fulfill({ response });
  });
  await page.route("**/api/sessions/*/send", async (route) => {
    sends++;
    await route.fulfill(
      sends === 1
        ? { status: 409, json: { error: { code: "CONFLICT", message: "发送失败测试" } } }
        : { status: 202, json: receipt(session!.id, route.request().postDataJSON()) },
    );
  });
  try {
    await page.goto("/");
    await expect(page.getByText("Host 已连接", { exact: true })).toHaveCount(1);
    await page.getByRole("button", { name: "新建会话", exact: true }).first().click();
    const composer = page.getByRole("textbox", { name: "消息", exact: true });
    await composer.fill("重试首条消息");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await expect(page.getByText("发送失败测试", { exact: true })).toBeVisible();
    await expect(page.locator(".draft-composer-wrap")).toHaveCount(0);
    await expect(composer).toHaveValue("重试首条消息");
    await expect(page.locator(".run-indicator")).toHaveCount(0);
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await expect.poll(() => sends).toBe(2);
    await expect(composer).toHaveValue("");
    expect(creates).toBe(1);
    await expect(page.locator(".user-turn").filter({ hasText: "重试首条消息" })).toHaveCount(1);
  } finally {
    await page.unrouteAll({ behavior: "wait" });
    if (session) await request.delete("/api/sessions/" + session.id);
  }
});

test("history delivery reconciles the optimistic first message before its send receipt", async ({
  page,
  request,
}) => {
  let session: Session | undefined;
  let sent!: (input: { requestId: string; text: string; mode: string }) => void;
  const sentInput = new Promise<{ requestId: string; text: string; mode: string }>((resolve) => {
    sent = resolve;
  });
  let finish!: () => void;
  const finishSend = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route("**/api/sessions", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    session = await response.json();
    await route.fulfill({ response });
  });
  await page.route("**/api/sessions/*/send", async (route) => {
    const input = route.request().postDataJSON();
    sent(input);
    await finishSend;
    await route.fulfill({ status: 202, json: receipt(session!.id, input) });
  });
  await page.route(
    (url) => url.pathname.startsWith("/api/sessions/") && url.searchParams.get("tail") === "300",
    async (route) => {
      const input = await sentInput;
      await route.fulfill({
        json: {
          events: [
            {
              id: "first-message-confirmed",
              sequence: 1000000,
              sessionId: session!.id,
              type: "message",
              payload: { role: "user", text: input.text, commandId: input.requestId },
              nativeRunId: null,
              createdAt: new Date().toISOString(),
            },
          ],
          commands: [receipt(session!.id, input)],
          olderCursor: null,
        },
      });
    },
  );
  try {
    await page.goto("/");
    await expect(page.getByText("Host 已连接", { exact: true })).toHaveCount(1);
    await page.getByRole("button", { name: "新建会话", exact: true }).first().click();
    await page.getByRole("textbox", { name: "消息", exact: true }).fill("历史先到也只显示一次");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await expect(
      page.locator(".user-turn:not(.is-sending)").filter({ hasText: "历史先到也只显示一次" }),
    ).toHaveCount(1);
    await expect(page.locator(".user-turn.is-sending")).toHaveCount(0);
    await expect(
      page.locator(".user-turn").filter({ hasText: "历史先到也只显示一次" }),
    ).toHaveCount(1);
    finish();
    await expect(page.getByRole("button", { name: "中断当前回合", exact: true })).toBeEnabled();
    await expect(
      page.locator(".user-turn").filter({ hasText: "历史先到也只显示一次" }),
    ).toHaveCount(1);
  } finally {
    finish();
    await page.unrouteAll({ behavior: "wait" });
    if (session) await request.delete("/api/sessions/" + session.id);
  }
});
