import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test.use({ locale: "zh-CN" });

const approvedMark = readFileSync(resolve("../../brand/assets/svg/kooyu-mark.svg"), "utf8");
const contour = approvedMark.split('<path d="')[1]!.split('"')[0]!;
const approvedIcon = readFileSync(resolve("../../brand/assets/icons/kooyu-favicon.svg"), "utf8");

for (const width of [1440, 390]) {
  test(
    "approved ribbon appears in launch, branding and loading at " + width + "px",
    async ({ page, request }, info) => {
      await page.setViewportSize({ width, height: 960 });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route("**/api/snapshot", async (route) => {
        await gate;
        await route.continue();
      });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      try {
        await page.goto("/");
        const hero = page.locator(".splash-hero-mobius svg");
        await expect(hero).toBeVisible();
        await expect(hero).toHaveAttribute("viewBox", "96 128 848 704");
        await expect(hero.locator("clipPath path")).toHaveAttribute("d", contour);
        await page.screenshot({ path: info.outputPath("brand-launch-" + width + ".png") });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await expect(hero).toHaveCSS("animation-name", "none");
        release();
        await expect(page.getByText("Host 已连接", { exact: true })).toHaveCount(1);
        await expect(page.locator(".brand-mark svg")).toHaveAttribute("viewBox", "96 128 848 704");
        await expect(page.locator(".brand-mark svg clipPath path")).toHaveAttribute("d", contour);
        const ids = await page
          .locator("svg defs [id]")
          .evaluateAll((elements) => elements.map((el) => el.id));
        expect(new Set(ids).size).toBe(ids.length);
        expect(await (await request.get("/icon.svg")).text()).toBe(approvedIcon);
        expect(errors).toEqual([]);
      } finally {
        release();
        await page.unrouteAll({ behavior: "wait" });
      }
    },
  );
}
