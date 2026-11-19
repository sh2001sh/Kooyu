import { test, expect } from "@playwright/test";
import { HARNESS_IDS, type Session } from "@kodo/protocol";

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

for (const harnessId of HARNESS_IDS) {
  test(`${harnessId}: retry progress and recovered send-now controls`, async ({
    page,
    request,
  }, info) => {
    const session = await (
      await request.post("/api/sessions", {
        data: {
          title: `Retry ${harnessId}`,
          harnessId,
          kind: harnessId === "kodo" ? "supervisor" : "direct",
          bindingId: null,
        },
      })
    ).json();
    let retry = true;
    let sends = 0;
    const state = () => ({
      ...session,
      phase: "native",
      connectionState: "connected",
      runState: retry ? "running" : "idle",
      retry: retry
        ? { attempt: 2, maxAttempts: 5, delayMs: 1000, since: new Date().toISOString() }
        : undefined,
    });
    await page.route("**/api/snapshot", async (route) => {
      const snapshot = await (await route.fetch()).json();
      snapshot.sessions = snapshot.sessions.map((s: Session) =>
        s.id === session.id ? state() : s,
      );
      await route.fulfill({ json: snapshot });
    });
    const command = {
      id: "queued-fixture",
      sessionId: session.id,
      kind: "send",
      origin: "user",
      status: "accepted",
      generation: 0,
      body: { text: "继续", mode: "queue" },
      createdAt: session.createdAt,
    };
    await page.route(`**/api/sessions/${session.id}?*`, (route) =>
      route.fulfill({
        json: {
          session: state(),
          events: [
            {
              id: "error-fixture",
              sequence: 1,
              sessionId: session.id,
              type: "turn-ended",
              payload: { outcome: "failed", errors: ["API 503 synthetic"] },
              createdAt: session.createdAt,
            },
          ],
          commands: [command],
          olderCursor: null,
        },
      }),
    );
    await page.route(`**/api/sessions/${session.id}/settings*`, (route) =>
      route.fulfill({ json: { session: state(), models: [], nativeCatalog: false } }),
    );
    await page.route(`**/api/sessions/${session.id}/commands/queued-fixture`, async (route) => {
      sends++;
      expect(route.request().postDataJSON().action).toBe("send-now");
      await route.fulfill({ json: { ...command, body: { ...command.body, sendNow: true } } });
    });
    await page.addInitScript((id) => localStorage.setItem("kodo.session", id), session.id);
    await page.goto("/");
    await expect(page.locator(".run-indicator")).toContainText("重试中 2/5");
    await expect(page.locator(".run-indicator")).toContainText("正在请求…");
    retry = false;
    await page.reload();
    const sendNow = page
      .locator(".pending-message")
      .getByRole("button", { name: "立即发送", exact: true });
    await expect(sendNow).toBeEnabled();
    await expect(page.locator(".run-indicator")).not.toContainText("重试中");
    await sendNow.click();
    await expect.poll(() => sends).toBe(1);
    if (harnessId === "claude-code")
      await page.screenshot({ path: info.outputPath("recovered-send-now.png"), fullPage: true });
  });
}

test("an unresolved stop shows a held new send as queued instead of starting", async ({
  page,
  request,
}) => {
  const session = await (
    await request.post("/api/sessions", {
      data: { title: "Held new send", harnessId: "codex", kind: "direct", bindingId: null },
    })
  ).json();
  const state = {
    ...session,
    runState: "idle",
    connectionState: "offline",
    executionState: "unknown",
  };
  await page.route("**/api/snapshot", async (route) => {
    const snapshot = await (await route.fetch()).json();
    snapshot.sessions = snapshot.sessions.map((s: Session) => (s.id === session.id ? state : s));
    await route.fulfill({ json: snapshot });
  });
  const command = {
    sessionId: session.id,
    origin: "user",
    generation: 0,
    createdAt: session.createdAt,
  };
  await page.route(`**/api/sessions/${session.id}?*`, (route) =>
    route.fulfill({
      json: {
        session: state,
        events: [],
        olderCursor: null,
        commands: [
          { ...command, id: "old-stop", kind: "stop", status: "unknown", body: {} },
          {
            ...command,
            id: "held-send",
            kind: "send",
            status: "accepted",
            body: { text: "继续", mode: "new" },
          },
        ],
      },
    }),
  );
  await page.route(`**/api/sessions/${session.id}/settings*`, (route) =>
    route.fulfill({ json: { session: state, models: [], nativeCatalog: false } }),
  );
  await page.addInitScript((id) => localStorage.setItem("kodo.session", id), session.id);
  await page.goto("/");
  await expect(page.locator(".run-indicator")).toContainText("运行状态待核对");
  await expect(page.locator(".pending-message")).toContainText("继续");
  await expect(page.getByRole("button", { name: "中断当前回合", exact: true })).toHaveCount(0);
  await expect(page.locator(".run-indicator")).not.toContainText("正在启动");
});
