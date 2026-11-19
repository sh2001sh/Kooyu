import { expect, test } from "@playwright/test";
import { HARNESS_IDS, type Session } from "@kodo/protocol";

for (const harnessId of HARNESS_IDS)
  test(`${harnessId}: terminal failure clears dispatched UI while receipt refresh is stale`, async ({
    page,
    request,
  }) => {
    const session = await (
      await request.post("/api/sessions", {
        data: {
          title: `Terminal queue ${harnessId}`,
          harnessId,
          kind: harnessId === "kodo" ? "supervisor" : "direct",
          bindingId: null,
        },
      })
    ).json();
    let ended = false;
    const state = () => ({
      ...session,
      phase: "native",
      connectionState: "connected",
      runState: ended ? "idle" : "running",
      executionState: "unknown",
    });
    await page.route("**/api/snapshot", async (route) => {
      const snapshot = await (await route.fetch()).json();
      snapshot.sessions = snapshot.sessions.map((s: Session) =>
        s.id === session.id ? state() : s,
      );
      await route.fulfill({ json: snapshot });
    });
    const command = {
      id: "failed-send",
      sessionId: session.id,
      kind: "send",
      origin: "user",
      status: "dispatched",
      generation: 0,
      body: { text: "继续", mode: "new" },
      createdAt: session.createdAt,
    };
    const user = {
      id: "user",
      sessionId: session.id,
      sequence: 1000001,
      type: "message",
      payload: { role: "user", text: "继续", commandId: command.id },
      createdAt: session.createdAt,
    };
    await page.route(`**/api/sessions/${session.id}?*`, (route) =>
      route.fulfill({
        json: { session: state(), events: [user], commands: [command], olderCursor: null },
      }),
    );
    await page.route(`**/api/sessions/${session.id}/settings*`, (route) =>
      route.fulfill({ json: { session: state(), models: [], nativeCatalog: false } }),
    );
    await page.addInitScript((id) => {
      localStorage.setItem("kodo.session", id);
      const Native = EventSource;
      Object.assign(window, { testEventStreams: [] });
      window.EventSource = class extends Native {
        constructor(url: string | URL, options?: EventSourceInit) {
          super(url, options);
          (window as unknown as { testEventStreams: EventSource[] }).testEventStreams.push(this);
        }
      };
    }, session.id);
    try {
      await page.goto("/");
      await expect(page.locator(".run-indicator")).toContainText("原生执行中");
      ended = true;
      await page.evaluate(
        (value) => {
          const streams = (window as unknown as { testEventStreams: EventSource[] })
            .testEventStreams;
          streams
            .at(-1)!
            .dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) }));
        },
        {
          id: "failed-turn",
          sessionId: session.id,
          sequence: 1000002,
          type: "turn-ended",
          payload: {
            commandId: command.id,
            outcome: "failed",
            errors: ["Selected model does not exist or access is denied"],
          },
          createdAt: new Date().toISOString(),
        },
      );
      await expect(page.getByRole("alert")).toContainText("Selected model does not exist");
      await expect(page.locator(".run-indicator")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "中断当前回合", exact: true })).toHaveCount(0);
      // Debounced HTTP reconciliation deliberately returns the old dispatched command.
      await expect
        .poll(
          async () =>
            (await page
              .locator(".session-row, .master-row")
              .filter({ hasText: `Terminal queue ${harnessId}` })
              .textContent()) ?? "",
        )
        .toContain("就绪");
      await expect(page.locator(".chat-header .chat-live-pill")).toHaveCount(0);
      await expect(page.locator(".run-indicator")).toHaveCount(0);
    } finally {
      await request.delete(`/api/sessions/${session.id}`);
    }
  });
