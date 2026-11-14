import { test, expect } from "@playwright/test";
test.use({ locale: "zh-CN" });

// Synthetic discovery UI states only; native desktop conversations have separate real probes.
for (const width of [1440, 390])
  test(`desktop-only installation states and rescan at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    let scans = 0;
    const snapshot = await (await page.request.get("/api/snapshot")).json();
    await page.route("**/api/snapshot", async (route) => {
      for (const harness of snapshot.harnesses) {
        if (harness.id === "cursor") delete harness.configFileLocations;
        if (harness.id === "pi") {
          delete harness.configFiles;
          delete harness.configFileLocations;
        }
        if (harness.id === "opencode") harness.implementation = "partial";
        if (harness.id === "opencode")
          harness.configFileLocations = [{ path: "D:/Apps/OpenCode/opencode.json", exists: false }];
        if (harness.id === "cursor")
          harness.configFiles = [
            "D:/Apps/很长的配置路径/Cursor-Configuration-With-A-Long-Name/settings.json",
          ];
        if (harness.id === "opencode") harness.configFiles = [];
        if (harness.id === "grok-build") harness.health = { installed: false, launchable: false };
        if (harness.id === "cursor")
          harness.health = {
            installed: true,
            launchable: false,
            source: null,
            authentication: "unknown",
            executable: null,
            version: "synthetic-1",
            desktops: [
              {
                name: "Cursor synthetic desktop",
                path: "D:\\Apps\\很长的安装路径\\Cursor-Desktop-Only-With-A-Long-Name",
                version: "synthetic-1",
              },
            ],
            error: "已发现桌面版；此版本尚未找到可调用的原生入口。",
          };
        if (harness.id === "opencode")
          harness.health = {
            installed: true,
            launchable: true,
            source: "desktop-bundled",
            authentication: "unknown",
            executable: "D:\\Apps\\OpenCode\\OpenCode.exe",
            version: "synthetic-2",
            desktops: [
              {
                name: "OpenCode synthetic desktop",
                path: "D:\\Apps\\OpenCode",
                version: "synthetic-2",
              },
            ],
          };
      }
      await route.fulfill({ json: snapshot });
    });
    await page.route("**/api/harnesses/installations?refresh=1", (route) => {
      scans++;
      return route.fulfill({ json: { harnesses: [] } });
    });
    await page.goto("/");
    if (width < 600) await page.getByRole("button", { name: "打开导航", exact: true }).click();
    await page
      .getByRole("navigation", { name: "系统工具", exact: true })
      .getByRole("button", { name: /^(Settings|设置)$/ })
      .click();
    await page
      .getByRole("navigation", { name: width < 600 ? "配置页面" : "配置导航", exact: true })
      .getByRole("button", { name: "引擎", exact: true })
      .click();
    const cursor = page
      .locator(".sx-engine")
      .filter({ has: page.locator("summary strong", { hasText: /^Cursor$/ }) });
    await expect(cursor.locator(":scope > summary")).toContainText("需设置启动入口");
    await cursor.locator(":scope > summary").click();
    await expect(cursor.locator(".sx-engine__body")).toContainText("已安装");
    await expect(
      cursor.getByText(
        "D:/Apps/很长的配置路径/Cursor-Configuration-With-A-Long-Name/settings.json",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.locator(".capability-grid, .metric-strip, .health-row__transport"),
    ).toHaveCount(0);
    const open = page
      .locator(".sx-engine")
      .filter({ has: page.locator("summary strong", { hasText: /^OpenCode$/ }) });
    await open.locator(":scope > summary").click();
    await expect(open.locator(":scope > summary")).toContainText("可用");
    await expect(open.locator(":scope > summary")).not.toContainText("部分功能");
    await expect(open.getByText("D:/Apps/OpenCode/opencode.json", { exact: false })).toBeVisible();
    await expect(open.getByText("尚未创建", { exact: true })).toBeVisible();
    const pi = page.locator(".sx-engine").filter({
      has: page.locator("summary strong", { hasText: /^pi$/ }),
    });
    await pi.locator(":scope > summary").click();
    await expect(pi.locator(".sx-file")).toHaveCount(0);
    await pi.locator(":scope > summary").click();
    await expect(page.locator(".sx-engine")).toHaveCount(11);
    await expect(
      page.locator(".sx-engine").filter({ hasText: "Grok Build" }).locator(":scope > summary"),
    ).toContainText("未安装");
    await expect(cursor).toBeVisible();
    await page.getByRole("button", { name: "重新检测", exact: true }).click();
    await expect.poll(() => scans).toBe(1);
    await cursor.locator(".sx-engine__body").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `../../output/playwright/desktop-installations-${width}.png`,
      fullPage: true,
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });

test("installation API returns discovery separately from authentication and launchability", async ({
  request,
}) => {
  const response = await request.get("/api/harnesses/installations?refresh=1");
  expect(response.ok()).toBe(true);
  const { harnesses } = await response.json();
  expect(harnesses).toHaveLength(11);
  for (const h of harnesses) {
    expect(typeof h.health.installed).toBe("boolean");
    expect(typeof h.health.launchable).toBe("boolean");
    expect(Array.isArray(h.health.desktops)).toBe(true);
    expect(h.health.authentication).toBe("unknown");
    expect(Array.isArray(h.configFiles)).toBe(true);
    expect(h.configFileLocations.length).toBeGreaterThan(0);
    expect(h.configFiles).toEqual(
      h.configFileLocations
        .filter((file: { exists: boolean }) => file.exists)
        .map((file: { path: string }) => file.path),
    );
  }
});
