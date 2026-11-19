import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

test.use({ locale: "zh-CN" });

test("verify settings dropdown is not clipped on desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");

  // Click settings button in sidebar
  await page.getByRole("button", { name: "设置" }).click();

  // Wait for settings page to load
  const trigger = page.locator("#pref-harness-btn");
  await expect(trigger).toBeVisible({ timeout: 10000 });

  // Click trigger to open dropdown
  await trigger.click();

  // Wait for menu to appear
  const menu = page.locator(".sx-select-menu");
  await expect(menu).toBeVisible();

  // Verify multiple items are rendered and visible
  await expect(menu.getByRole("option", { name: "Kooyu" })).toBeVisible();
  await expect(menu.getByRole("option", { name: /Claude Code/ })).toBeVisible();

  const zIndices = await page.evaluate(() => {
    const openMenu = document.querySelector(".sx-select-menu");
    const openRow = document.querySelector(".sx-row:has(.sx-select-container.is-open)");
    const openCard = document.querySelector(".sx-card:has(.sx-select-container.is-open)");
    const toggle = document.querySelector(".sx-toggle");
    const row2 = openCard?.querySelectorAll(".sx-row")[1];
    const row3 = openCard?.querySelectorAll(".sx-row")[2];
    const nextCard = document.querySelectorAll(".sx-card")[2];

    function getStack(el: Element | null | undefined) {
      if (!el) return null;
      const cs = window.getComputedStyle(el);
      return {
        tag: el.tagName,
        class: el.className,
        position: cs.position,
        zIndex: cs.zIndex,
        opacity: cs.opacity,
        transform: cs.transform,
        filter: cs.filter,
        backdropFilter: cs.backdropFilter,
      };
    }

    return {
      openMenu: getStack(openMenu),
      openRow: getStack(openRow),
      openCard: getStack(openCard),
      row2: getStack(row2),
      row3: getStack(row3),
      toggle: getStack(toggle),
      nextCard: getStack(nextCard),
    };
  });
  console.log("STACKING CONTEXT DEBUG:", JSON.stringify(zIndices, null, 2));

  // Wait for pop animation to finish
  await page.waitForTimeout(300);

  // Take screenshot
  mkdirSync(".local", { recursive: true });
  await page.screenshot({ path: ".local/dropdown-desktop.png", animations: "allow" });
});

test("verify settings dropdown on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await page
    .getByRole("navigation", { name: "移动端标签导航", exact: true })
    .getByRole("button", { name: "设置", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "配置页面", exact: true })
    .getByRole("button", { name: "通用", exact: true })
    .click();

  const trigger = page.locator("#pref-harness-btn");
  await expect(trigger).toBeVisible({ timeout: 10000 });

  await trigger.click();

  const menu = page.locator(".sx-select-menu");
  await expect(menu).toBeVisible();

  // Wait for pop animation to finish
  await page.waitForTimeout(300);

  await page.screenshot({ path: ".local/dropdown-mobile.png", animations: "allow" });
});
