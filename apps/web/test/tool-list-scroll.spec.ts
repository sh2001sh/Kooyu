import { expect, test } from "@playwright/test";

for (const width of [1440, 390])
  for (const harnessId of ["claude-code", "codex", "pi"])
    test(`${harnessId}: long tools scroll, jump and collapse at ${width}px`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 844 });
      const session = await (
        await page.request.post("/api/sessions", {
          data: { title: `Tool scroll ${harnessId} ${width}`, harnessId, kind: "direct" },
        })
      ).json();
      const event = (type: string, payload: unknown, index: number) => ({
        id: `tools-${index}`,
        sessionId: session.id,
        sequence: index + 1,
        type,
        payload,
        createdAt: new Date().toISOString(),
        source: harnessId,
        nativeRunId: null,
      });
      const events = [
        event("message", { role: "user", text: "检查所有文件" }, 0),
        ...Array.from({ length: 120 }, (_, i) =>
          event(
            "tool",
            {
              id: `call-${i}`,
              ...(harnessId === "codex"
                ? { type: "commandExecution", command: `Read file-${i}.txt`, exitCode: 0 }
                : { type: "tool_use", name: "Read", input: { file_path: `file-${i}.txt` } }),
              status: i === 0 ? "failed" : "completed",
              content: Array.from({ length: 220 }, (_, line) => `file-${i} output ${line}`).join(
                "\n",
              ),
            },
            i + 1,
          ),
        ),
        ...Array.from({ length: 12 }, (_, i) =>
          event("message", { role: "assistant", text: `工具后的回答 ${i}` }, i + 121),
        ),
      ];
      await page.route(`**/api/sessions/${session.id}?*`, (route) =>
        route.fulfill({ json: { session, events, commands: [], olderCursor: null } }),
      );
      await page.addInitScript((id) => {
        localStorage.setItem("kodo.session", id);
        const NativeEventSource = window.EventSource;
        Object.assign(window, { testStreams: [] });
        window.EventSource = class extends NativeEventSource {
          constructor(url: string | URL, options?: EventSourceInit) {
            super(url, options);
            (window as unknown as { testStreams: EventSource[] }).testStreams.push(this);
          }
        };
      }, session.id);
      await page.goto("/");
      const group = page.locator(".tool-group");
      const summary = group.locator(":scope > summary");
      await expect(summary).toContainText("120 次工具调用");
      await summary.click();
      const list = group.getByRole("region", { name: "工具调用列表", exact: true });
      await expect(list).toBeVisible();
      expect(await list.evaluate((el) => el.clientHeight)).toBeLessThanOrEqual(420);
      expect(await list.evaluate((el) => el.scrollHeight)).toBeGreaterThan(3000);
      await group.getByRole("button", { name: "末项", exact: true }).click();
      await expect
        .poll(() => list.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight))
        .toBeLessThan(2);
      const last = list.locator(".tool-card").last();
      await expect(last.locator("summary")).toBeInViewport();
      await last.locator("summary").click();
      const output = last.locator("pre");
      await output.scrollIntoViewIfNeeded();
      await output.hover();
      await page.mouse.wheel(0, 10000);
      await expect
        .poll(() => output.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight))
        .toBeLessThan(2);
      await group.getByRole("button", { name: "首项", exact: true }).click();
      await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(0);
      await list.focus();
      await page.keyboard.press("End");
      await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
      await group.getByRole("button", { name: "末项", exact: true }).click();
      if (harnessId === "claude-code")
        await page.screenshot({ path: info.outputPath(`bounded-tools-${width}.png`) });
      await group.getByRole("button", { name: "收起工具调用", exact: true }).click();
      await expect(group).not.toHaveAttribute("open", "");
      await expect(summary).toBeFocused();
      await page.getByRole("button", { name: "回到底部", exact: true }).click();
      const transcript = page.locator(".conversation-main .transcript");
      await expect
        .poll(() => transcript.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight))
        .toBeLessThan(2);
      await expect(page.getByText("工具后的回答 11", { exact: true })).toBeInViewport();
      // A new tool event must not restore a previous search/navigation anchor.
      const next = event("message", { role: "assistant", text: "实时追加后的最新回答" }, 1000);
      await page.evaluate((value) => {
        const streams = (window as unknown as { testStreams: EventSource[] }).testStreams;
        streams.at(-1)!.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) }));
      }, next);
      await expect(page.getByText("实时追加后的最新回答", { exact: true })).toBeInViewport();
      await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.request.delete(`/api/sessions/${session.id}`);
    });

for (const width of [1440, 390])
  test(`disabling automatic collapse still bounds long tool lists at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const session = await (
      await page.request.post("/api/sessions", {
        data: { title: `Expanded tools ${width}`, harnessId: "claude-code", kind: "direct" },
      })
    ).json();
    await page.route("**/api/app-settings", async (route) => {
      const settings = await (await route.fetch()).json();
      await route.fulfill({ json: { ...settings, collapseTools: false } });
    });
    const events = Array.from({ length: 80 }, (_, i) => ({
      id: `expanded-${i}`,
      sessionId: session.id,
      sequence: i + 1,
      type: "tool",
      payload: { id: `call-${i}`, name: "Read", status: "completed", content: `output ${i}` },
      createdAt: new Date().toISOString(),
      source: "fixture",
      nativeRunId: null,
    }));
    await page.route(`**/api/sessions/${session.id}?*`, (route) =>
      route.fulfill({ json: { session, events, commands: [], olderCursor: null } }),
    );
    await page.addInitScript((id) => localStorage.setItem("kodo.session", id), session.id);
    await page.goto("/");
    const group = page.locator(".tool-group");
    await expect(group).toHaveAttribute("open", "");
    const list = group.getByRole("region", { name: "工具调用列表", exact: true });
    expect(await list.evaluate((el) => el.clientHeight)).toBeLessThanOrEqual(420);
    await group.getByRole("button", { name: "末项", exact: true }).click();
    await expect(list.locator(".tool-card").last()).toBeInViewport();
    await group.getByRole("button", { name: "收起工具调用", exact: true }).click();
    await expect(group).not.toHaveAttribute("open", "");
    await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeInViewport();
    await page.request.delete(`/api/sessions/${session.id}`);
  });
