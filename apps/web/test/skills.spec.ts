import { test, expect } from "@playwright/test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { HARNESS_IDS, type HarnessSkillListing } from "@kodo/protocol";

test.use({ locale: "zh-CN" });

for (const width of [1440, 390]) {
  test("manage native skills at " + width + "px", async ({ page }, testInfo) => {
    test.setTimeout(60000);
    page.setDefaultTimeout(10000);
    await page.setViewportSize({ width, height: 960 });
    const endpoint = "/api/harnesses/kodo/skills";
    const listing: HarnessSkillListing = await (await page.request.get(endpoint)).json();
    const directory = listing.directories.find((item) => item.label === "Kooyu 运行目录")!.path;
    const name = "ui-test-skill-" + width;
    const path = join(directory, name, "SKILL.md");
    const source = mkdtempSync(join(tmpdir(), "kodo-ui-skill-"));
    const importedName = name + "-imported";
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      mkdirSync(join(source, "scripts"));
      writeFileSync(
        join(source, "SKILL.md"),
        "---\nname: imported-local-skill\ndescription: Local import fixture\n---\n\nDo not run scripts.\n",
      );
      writeFileSync(join(source, "scripts", "action.js"), "throw new Error('must not execute');");
      await page.goto("/");
      await page
        .getByRole("navigation", { name: width < 600 ? "移动端标签导航" : "系统工具", exact: true })
        .getByRole("button", { name: /^(设置|Harness 与配置)$/ })
        .click();
      await page
        .getByRole("navigation", { name: width < 600 ? "配置页面" : "配置导航", exact: true })
        .getByRole("button", { name: "引擎", exact: true })
        .click();
      const engine = page
        .locator("details.sx-engine")
        .filter({ has: page.locator(".sx-engine__name strong", { hasText: /^Kooyu$/ }) });
      await engine.locator(":scope > summary").click();
      const skills = engine.locator(".sx-skills");
      await skills.locator(":scope > summary").click();
      await skills.getByRole("button", { name: "新建 Skill", exact: true }).click();
      await skills.getByLabel("目标 Skills 目录", { exact: true }).selectOption(directory);
      await skills.getByLabel("技能目录名", { exact: true }).fill(name);
      await skills
        .getByLabel("技能描述", { exact: true })
        .fill("A local skill for browser verification.");
      await skills
        .getByLabel("技能正文", { exact: true })
        .fill("Follow this local test procedure.");
      await skills.getByRole("button", { name: "保存新 Skill", exact: true }).click();
      await skills.getByLabel("搜索 Skills", { exact: true }).fill(name);
      const row = skills.locator("li.sx-skill");
      await expect(row).toHaveCount(1);
      expect(readFileSync(path, "utf8")).toContain("Follow this local test procedure.");
      await row.getByRole("button", { name: "编辑 Skill", exact: true }).click();
      const editor = skills.getByLabel("SKILL.md 内容", { exact: true });
      const original = await editor.inputValue();
      await editor.fill("invalid markdown");
      await skills.getByRole("button", { name: "保存 Skill", exact: true }).click();
      await expect(skills.getByRole("alert")).toContainText("格式不正确");
      expect(readFileSync(path, "utf8")).toBe(original);
      await editor.fill(original + "\nUpdated procedure.\n");
      await skills.getByRole("button", { name: "保存 Skill", exact: true }).click();
      await expect(skills.getByRole("status")).toContainText("原版本已备份");
      expect(readFileSync(path, "utf8")).toContain("Updated procedure.");
      await skills.getByRole("button", { name: "关闭编辑器", exact: true }).click();
      await row.getByRole("button", { name: "停用 Skill", exact: true }).click();
      await expect(row.getByText("已停用", { exact: true })).toBeVisible();
      expect(existsSync(path)).toBe(false);
      expect(existsSync(path + ".kodo-disabled")).toBe(true);
      await row.getByRole("button", { name: "启用 Skill", exact: true }).click();
      await expect(row.getByText("已启用", { exact: true })).toBeVisible();
      expect(existsSync(path)).toBe(true);
      await skills.getByRole("button", { name: "导入本机 Skill", exact: true }).click();
      await skills.getByLabel("目标 Skills 目录", { exact: true }).selectOption(directory);
      await skills.getByLabel("本机 Skill 源目录", { exact: true }).fill(source);
      await skills.getByLabel("技能目录名", { exact: true }).fill(importedName);
      await skills.getByRole("button", { name: "导入 Skill", exact: true }).click();
      await expect(row).toHaveCount(2);
      expect(readFileSync(join(directory, importedName, "scripts", "action.js"), "utf8")).toContain(
        "must not execute",
      );
      await skills.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: testInfo.outputPath("skills-" + width + ".png"),
        fullPage: true,
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const originalRow = row.filter({
        has: page.locator(".sx-skill__info > strong", { hasText: new RegExp("^" + name + "$") }),
      });
      page.once("dialog", (dialog) => dialog.accept());
      const archived = page.waitForResponse(
        (response) => response.url().endsWith(endpoint) && response.request().method() === "POST",
      );
      await originalRow.getByRole("button", { name: "移出 Skill", exact: true }).click();
      const recovery = await (await archived).json();
      await expect(row).toHaveCount(1);
      expect(existsSync(dirname(path))).toBe(false);
      expect(readFileSync(join(recovery.path, "SKILL.md"), "utf8")).toContain("Updated procedure.");
      expect(errors).toEqual([]);
    } finally {
      const remaining: HarnessSkillListing = await (await page.request.get(endpoint)).json();
      for (const skill of remaining.skills.filter((item) =>
        [name, importedName].includes(dirname(item.path).split(/[\\/]/).at(-1)!),
      )) {
        await page.request.post(endpoint, {
          data: { operation: "archive", path: skill.path, version: skill.version },
        });
      }
      rmSync(source, { recursive: true, force: true });
    }
  });
}

test("all engines expose skills and custom directory management preserves files", async ({
  request,
}) => {
  for (const id of HARNESS_IDS) {
    const response = await request.get("/api/harnesses/" + id + "/skills");
    expect(response.ok()).toBe(true);
    const listing = await response.json();
    expect(Array.isArray(listing.skills)).toBe(true);
    expect(Array.isArray(listing.directories)).toBe(true);
  }
  const root = mkdtempSync(join(tmpdir(), "kodo-ui-custom-skills-"));
  const endpoint = "/api/harnesses/grok-build/skills";
  const content =
    "---\nname: custom-local\ndescription: Custom directory test\n---\n\nLocal instructions.\n";
  writeFileSync(join(root, "SKILL.md"), content);
  try {
    expect((await request.post(endpoint + "/directories", { data: { path: root } })).ok()).toBe(
      true,
    );
    const listing: HarnessSkillListing = await (await request.get(endpoint)).json();
    const skill = listing.skills.find((item) => item.path === join(root, "SKILL.md"))!;
    expect(skill.name).toBe("custom-local");
    expect(
      (
        await request.post(endpoint, {
          data: { operation: "save", path: skill.path, version: "stale", content },
        })
      ).status(),
    ).toBe(409);
    expect(
      (
        await request.get(endpoint + "/file", { params: { path: join(root, "..", "SKILL.md") } })
      ).status(),
    ).toBe(404);
    expect(
      (await request.get(endpoint, { params: { workspaceId: "missing-project" } })).status(),
    ).toBe(404);
    expect((await request.delete(endpoint + "/directories", { data: { path: root } })).ok()).toBe(
      true,
    );
    expect(readFileSync(join(root, "SKILL.md"), "utf8")).toBe(content);
  } finally {
    await request.delete(endpoint + "/directories", { data: { path: root } });
    rmSync(root, { recursive: true, force: true });
  }
});
