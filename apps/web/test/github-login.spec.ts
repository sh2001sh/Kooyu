import { expect, test } from "@playwright/test";
for (const width of [1440, 390])
  test(`GitHub browser login displays code, polls and keeps grants explicit at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 960 });
    let configured = false,
      approved = false,
      cancelled = false;
    const starts: Array<Record<string, unknown>> = [];
    await page.route("**/api/oauth/github/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/configuration")) {
        if (route.request().method() === "POST") configured = true;
        return route.fulfill({
          json: { clientId: configured ? "Ov23-test-client" : "", configured, managed: false },
        });
      }
      if (url.pathname.endsWith("/start")) {
        starts.push(route.request().postDataJSON());
        cancelled = false;
        return route.fulfill({
          status: 201,
          json: {
            id: "login",
            connectionId: "github",
            userCode: "ABCD-EFGH",
            verificationUri: "https://github.com/login/device",
            expiresAt: new Date(Date.now() + 900000).toISOString(),
            interval: 5,
            status: "pending",
          },
        });
      }
      if (url.pathname.endsWith("/cancel")) cancelled = true;
      return route.fulfill({
        json: {
          id: "login",
          connectionId: "github",
          userCode: "ABCD-EFGH",
          verificationUri: "https://github.com/login/device",
          expiresAt: new Date(Date.now() + 900000).toISOString(),
          interval: 5,
          status: cancelled ? "cancelled" : approved ? "connected" : "pending",
        },
      });
    });
    await page.addInitScript(() => {
      window.open = () => null;
    });
    await page.goto("/");
    await page
      .getByRole("navigation", { name: width < 600 ? "移动端标签导航" : "系统工具", exact: true })
      .getByRole("button", { name: "设置", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: width < 600 ? "配置页面" : "配置导航", exact: true })
      .getByRole("button", { name: "自动化与通知", exact: true })
      .click();
    const github = page.locator(".github-login").first();
    await expect(
      github.getByRole("button", { name: "使用 GitHub 登录", exact: true }),
    ).toBeDisabled();
    await github.getByLabel("GitHub OAuth App Client ID").fill("Ov23-test-client");
    await github.getByRole("button", { name: "保存 GitHub 应用", exact: true }).click();
    await github.getByRole("button", { name: "使用 GitHub 登录", exact: true }).click();
    await expect(github.getByText("ABCD-EFGH", { exact: true })).toBeVisible();
    expect(starts[0]!.privateRepositories).toBe(false);
    await expect(github.getByRole("link", { name: "打开 GitHub 授权页" })).toHaveAttribute(
      "href",
      "https://github.com/login/device",
    );
    await page.screenshot({ path: info.outputPath(`github-login-${width}.png`) });
    approved = true;
    await github.getByRole("button", { name: "检查授权结果", exact: true }).click();
    await expect(
      github.getByText("GitHub 已连接。请在下方为主对话授予具体仓库和操作权限。"),
    ).toBeVisible();
    await github.getByRole("checkbox", { name: /需要访问私有仓库/ }).check();
    await github.getByRole("button", { name: "使用 GitHub 登录", exact: true }).click();
    expect(starts[1]!.privateRepositories).toBe(true);
    await github.getByRole("button", { name: "取消登录", exact: true }).click();
    await expect(
      github.getByRole("button", { name: "使用 GitHub 登录", exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
  });
