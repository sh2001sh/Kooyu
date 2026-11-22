import { test, expect } from "@playwright/test";

test("Antigravity proxy can be saved, validated and cleared independently", async ({ page }) => {
  const openSettings = async () => {
    await page.goto("/");
    await page
      .getByRole("navigation", { name: "系统工具" })
      .getByRole("button", { name: /^(Settings|设置)$/ })
      .click();
    await page
      .getByRole("navigation", { name: "配置导航" })
      .getByRole("button", { name: "引擎", exact: true })
      .click();
    await page.locator(".sx-engine summary").filter({ hasText: "Antigravity" }).click();
  };
  const field = page.getByLabel("网络代理", { exact: true });
  const save = page.getByRole("button", { name: "保存代理" });
  await openSettings();
  await field.fill("http://127.0.0.1:7890");
  await save.click();
  await expect(save).toBeDisabled();
  await openSettings();
  await expect(field).toHaveValue("http://127.0.0.1:7890");
  await field.fill("ftp://127.0.0.1:21");
  await save.click();
  await expect(page.getByText("代理地址仅支持 HTTP 或 HTTPS 主机和端口。")).toBeVisible();
  await field.fill("");
  await save.click();
  await expect(save).toBeDisabled();
  await openSettings();
  await expect(field).toHaveValue("");
});
