import { test, expect } from "@playwright/test";
import type { Session, RuntimeEvent } from "@kodo/protocol";

for (const width of [1440, 390]) {
  for (const selectionMode of ["fixed", "provider"] as const)
    test(`configured ${selectionMode} parameters appear in composer at ${width}px`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 960 });
      const providerResponse = await page.request.post("/api/providers", {
        data: {
          name: `Provenance ${selectionMode} ${width}`,
          endpoints: [
            {
              name: "Offline fixture",
              protocol: "openai-completions",
              baseUrl: "http://127.0.0.1:1/v1",
            },
          ],
        },
      });
      expect(providerResponse.ok()).toBe(true);
      const provider = await providerResponse.json();
      const modelResponse = await page.request.post("/api/provider-models", {
        data: {
          providerId: provider.id,
          endpointId: provider.endpoints[0].id,
          model: `synthetic-provenance-${selectionMode}-${width}`,
          overrides: {
            contextWindow: 1048576,
            maxOutputTokens: 32768,
            input: ["text"],
            reasoning: true,
            reasoningOptions: [{ type: "effort", values: ["low", "medium", "high"] }],
            pricing: { input: 0, output: 10, cacheRead: 0.1 },
          },
        },
      });
      expect(modelResponse.ok()).toBe(true);
      const model = await modelResponse.json();
      const bindingResponse = await page.request.post("/api/harness-bindings", {
        data: {
          name: `Composer ${selectionMode}`,
          harnessId: "pi",
          modelId: model.id,
          selectionMode,
        },
      });
      expect(bindingResponse.ok()).toBe(true);
      const binding = await bindingResponse.json();
      const response = await page.request.post("/api/sessions", {
        data: {
          title: `参数来源 ${selectionMode} ${width}`,
          harnessId: "pi",
          kind: "direct",
          bindingId: binding.id,
        },
      });
      expect(response.ok()).toBe(true);
      const session = await response.json();
      try {
        await page.goto("/");
        await page.locator(".session-row").filter({ hasText: session.title }).click();
        await page.getByRole("button", { name: "模型配置", exact: true }).click();
        const params = page.getByLabel("模型自动参数");
        await expect(params).toContainText("1,048,576 tokens");
        await expect(params).toContainText("32,768 tokens");
        await expect(params).toContainText("low / medium / high");
        await expect(params).toContainText("输入 $0");
        await expect(params).toContainText("输出 $10");
        await expect(params).toContainText("缓存读 $0.1");
        await expect(params).not.toContainText("参数未确认");
        await expect(params).not.toContainText("未公开");
        await page.screenshot({
          path: info.outputPath(`parameters-${selectionMode}-${width}.png`),
          fullPage: true,
        });
      } finally {
        await page.request.delete(`/api/sessions/${session.id}`);
      }
    });

  test(`failed native run can stop and settled dispatch stops waiting at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 960 });
    const response = await page.request.post("/api/sessions", {
      data: {
        title: `错误后停止 ${width}`,
        harnessId: "pi",
        kind: "direct",
        bindingId: null,
      },
    });
    const session: Session = await response.json();
    let settled = false;
    let stops = 0;
    let finishStop!: () => void;
    const stopGate = new Promise<void>((resolve) => {
      finishStop = resolve;
    });
    const state = () => ({
      ...session,
      phase: "native",
      nativeSessionId: "synthetic-native",
      connectionState: "connected",
      runState: "idle",
      executionState: settled ? "settled" : "unknown",
    });
    const event = (type: RuntimeEvent["type"], sequence: number, payload: object) => ({
      id: `synthetic-${sequence}`,
      sequence,
      sessionId: session.id,
      type,
      payload,
      source: "pi",
      createdAt: session.createdAt,
    });
    const failure = event("error", 90001, { message: "Stream ended without finish_reason" });
    await page.addInitScript(() => {
      const NativeSource = window.EventSource;
      const sources: EventSource[] = [];
      window.EventSource = class extends NativeSource {
        constructor(url: string | URL, options?: EventSourceInit) {
          super(url, options);
          sources.push(this);
        }
      };
      window.addEventListener("test-native-event", (event) =>
        sources.at(-1)!.dispatchEvent(
          new MessageEvent("message", {
            data: JSON.stringify((event as CustomEvent).detail),
          }),
        ),
      );
    });
    await page.route("**/api/snapshot", async (route) => {
      const response = await route.fetch();
      const snapshot = await response.json();
      snapshot.sessions = snapshot.sessions.map((item: Session) =>
        item.id === session.id ? state() : item,
      );
      await route.fulfill({ json: snapshot });
    });
    await page.route(`**/api/sessions/${session.id}?*`, async (route) => {
      const response = await route.fetch();
      const detail = await response.json();
      await route.fulfill({
        json: {
          ...detail,
          session: state(),
          events: [
            failure,
            ...(settled ? [event("settled", 90002, { outcome: "cancelled" })] : []),
          ],
          commands: [
            {
              id: "synthetic-send",
              sessionId: session.id,
              kind: "send",
              origin: "user",
              status: "dispatched",
              body: { text: "synthetic" },
              createdAt: session.createdAt,
            },
          ],
        },
      });
    });
    await page.route(`**/api/sessions/${session.id}/settings*`, async (route) =>
      route.fulfill({ json: { session: state(), models: [], nativeCatalog: false } }),
    );
    await page.route(`**/api/sessions/${session.id}/stop`, async (route) => {
      stops++;
      expect(route.request().postDataJSON().pause).toBe(false);
      await stopGate;
      settled = true;
      await route.fulfill({ json: { status: "active", cancel: "requested; await native event" } });
    });
    try {
      await page.goto("/");
      await page.locator(".session-row").filter({ hasText: session.title }).click();
      await expect(
        page.getByText("Stream ended without finish_reason", { exact: true }),
      ).toBeVisible();
      const stop = page.getByRole("button", { name: "中断当前回合", exact: true });
      await expect(stop).toBeEnabled();
      await expect(page.getByRole("button", { name: "停止并暂停托管", exact: true })).toHaveCount(
        0,
      );
      await stop.click();
      await expect(stop).toBeDisabled();
      expect(stops).toBe(1);
      finishStop();
      await expect(stop).toBeEnabled();
      await page.evaluate(
        (event) => window.dispatchEvent(new CustomEvent("test-native-event", { detail: event })),
        event("settled", 90002, { outcome: "cancelled" }),
      );
      await expect(page.locator(".run-indicator")).toHaveCount(0);
      await expect(
        page.getByRole("status").filter({ hasText: "已请求中断当前回合。" }),
      ).toBeVisible();
      await page.screenshot({
        path: info.outputPath(`stopped-after-error-${width}.png`),
        fullPage: true,
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    } finally {
      finishStop();
      await page.unrouteAll({ behavior: "wait" });
      await page.request.delete(`/api/sessions/${session.id}`);
    }
  });
}
