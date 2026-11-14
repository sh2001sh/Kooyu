import { expect, test } from "@playwright/test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Snapshot } from "@kodo/protocol";

test.use({ locale: "zh-CN" });

for (const width of [1440, 390]) {
  test(
    "session and project context actions at " + width + "px",
    async ({ page, context }, testInfo) => {
      test.setTimeout(90000);
      page.setDefaultTimeout(10000);
      await page.setViewportSize({ width, height: 960 });
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      const directory = mkdtempSync(join(tmpdir(), "kodo-sidebar-ui-"));
      writeFileSync(join(directory, "source.txt"), "Keep project files");
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const suffix = String(width);
      const project = await (
        await page.request.post("/api/projects", {
          data: { name: "菜单项目 " + suffix, rootPath: directory },
        })
      ).json();
      const snapshot = async (): Promise<Snapshot> =>
        (await page.request.get("/api/snapshot")).json();
      const workspace = (await snapshot()).workspaces.find(
        (item) => item.projectId === project.id,
      )!;
      const createSession = async (title: string, restoreFromFolder = false) =>
        (
          await page.request.post("/api/sessions", {
            data: {
              title,
              harnessId: "codex",
              kind: "direct",
              ...(restoreFromFolder ? {} : { projectId: project.id }),
              workspaceId: workspace.id,
            },
          })
        ).json();
      const first = await createSession("选中会话 " + suffix),
        second = await createSession("右键会话 " + suffix);
      let projectName = project.name;
      let secondTitle = second.title;
      const row = (title: string) =>
        page.locator(".session-row").filter({
          has: page.locator(".session-title > span:first-child", {
            hasText: new RegExp("^" + title + "$"),
          }),
        });
      const menu = () => page.getByRole("menu", { name: "会话操作", exact: true });
      const openSessionMenu = async (title: string) => {
        if (width < 600)
          await page.getByRole("button", { name: "会话菜单 " + title, exact: true }).click();
        else await row(title).click({ button: "right" });
        await expect(menu()).toBeVisible();
      };
      const openProjectMenu = async () => {
        await page.getByRole("button", { name: "项目菜单 " + projectName, exact: true }).click();
        return page.getByRole("menu", { name: "项目操作", exact: true });
      };
      const returnToList = async () => {
        if (width < 600)
          await page.getByRole("button", { name: "返回会话列表", exact: true }).click();
      };
      try {
        await page.addInitScript((id) => {
          localStorage.setItem("kodo.session", id);
          localStorage.setItem("kodo.viewMode", "project");
        }, first.id);
        await page.goto("/");
        await returnToList();
        await expect(row(first.title)).toBeVisible();
        const selectedBefore = await row(first.title).getAttribute("aria-current");
        await openSessionMenu(secondTitle);
        expect(await row(first.title).getAttribute("aria-current")).toBe(selectedBefore);
        await expect(menu().getByRole("menuitem", { name: "重命名", exact: true })).toBeFocused();
        await page.keyboard.press("ArrowDown");
        await expect(menu().getByRole("menuitem", { name: "置顶", exact: true })).toBeFocused();
        await page.screenshot({
          path: testInfo.outputPath("session-menu-" + width + ".png"),
          fullPage: true,
        });
        await page.keyboard.press("Escape");
        await expect(menu()).toHaveCount(0);
        await row(secondTitle).focus();
        await page.keyboard.press("Shift+F10");
        await expect(menu()).toBeVisible();
        await menu().getByRole("menuitem", { name: "重命名", exact: true }).click();
        await page.getByLabel("会话名称", { exact: true }).fill("   ");
        await expect(
          page.getByRole("button", { name: "保存会话名称", exact: true }),
        ).toBeDisabled();
        secondTitle = "已重命名会话 " + suffix;
        await page.getByLabel("会话名称", { exact: true }).fill(secondTitle);
        await page.getByLabel("会话名称", { exact: true }).press("Enter");
        await expect(row(secondTitle)).toHaveCount(1);
        await openSessionMenu(secondTitle);
        await menu().getByRole("menuitem", { name: "置顶", exact: true }).click();
        await expect
          .poll(
            async () => (await snapshot()).sessions.find((item) => item.id === second.id)?.pinned,
          )
          .toBe(true);
        await openSessionMenu(secondTitle);
        await menu().getByRole("menuitem", { name: "取消置顶", exact: true }).click();
        await expect
          .poll(
            async () => (await snapshot()).sessions.find((item) => item.id === second.id)?.pinned,
          )
          .toBe(false);
        await openSessionMenu(secondTitle);
        await menu().getByRole("menuitem", { name: "标记为未读", exact: true }).click();
        await expect(row(secondTitle).getByLabel("未读", { exact: true })).toBeVisible();
        await row(secondTitle).click();
        await returnToList();
        await expect(row(secondTitle).getByLabel("未读", { exact: true })).toHaveCount(0);
        await openSessionMenu(secondTitle);
        await menu().getByRole("menuitem", { name: "复制会话名称", exact: true }).click();
        await expect
          .poll(() => page.evaluate(() => navigator.clipboard.readText()))
          .toBe(secondTitle);
        await openSessionMenu(secondTitle);
        await menu().getByRole("menuitem", { name: "复制会话 ID", exact: true }).click();
        await expect
          .poll(() => page.evaluate(() => navigator.clipboard.readText()))
          .toBe(second.id);
        await openSessionMenu(secondTitle);
        await menu().getByRole("menuitem", { name: "归档", exact: true }).click();
        await expect(row(secondTitle)).toHaveCount(0);
        await page.getByRole("button", { name: "显示归档", exact: true }).click();
        await expect(row(secondTitle)).toBeVisible();
        await openSessionMenu(secondTitle);
        await menu().getByRole("menuitem", { name: "取消归档", exact: true }).click();
        await expect
          .poll(
            async () => (await snapshot()).sessions.find((item) => item.id === second.id)?.archived,
          )
          .toBe(false);
        await page.getByRole("button", { name: "显示归档", exact: true }).click();
        await openSessionMenu(secondTitle);
        await menu().getByRole("menuitem", { name: "删除会话", exact: true }).click();
        await page
          .getByRole("dialog", { name: "删除会话", exact: true })
          .getByRole("button", { name: "取消", exact: true })
          .click();
        expect((await page.request.get("/api/sessions/" + second.id)).ok()).toBe(true);
        await openSessionMenu(secondTitle);
        await menu().getByRole("menuitem", { name: "删除会话", exact: true }).click();
        await page
          .getByRole("dialog", { name: "删除会话", exact: true })
          .getByRole("button", { name: "删除", exact: true })
          .click();
        await expect(row(secondTitle)).toHaveCount(0);
        expect((await page.request.get("/api/sessions/" + second.id)).status()).toBe(404);
        expect((await page.request.delete("/api/sessions/" + second.id)).ok()).toBe(true);

        let projectMenu = await openProjectMenu();
        await page.screenshot({
          path: testInfo.outputPath("project-menu-" + width + ".png"),
          fullPage: true,
        });
        await projectMenu.getByRole("menuitem", { name: "编辑项目", exact: true }).click();
        const editor = page.getByRole("dialog", { name: "编辑项目", exact: true });
        projectName = "已编辑项目 " + suffix;
        await editor.getByLabel("项目名称", { exact: true }).fill(projectName);
        await editor.getByRole("button", { name: "保存修改", exact: true }).click();
        await expect(editor).toHaveCount(0);
        await expect(
          page.getByRole("button", { name: "项目菜单 " + projectName, exact: true }),
        ).toBeVisible();
        projectMenu = await openProjectMenu();
        await projectMenu.getByRole("menuitem", { name: "置顶", exact: true }).click();
        await expect
          .poll(
            async () => (await snapshot()).projects.find((item) => item.id === project.id)?.pinned,
          )
          .toBe(true);
        projectMenu = await openProjectMenu();
        page.once("dialog", (dialog) => dialog.accept());
        await projectMenu.getByRole("menuitem", { name: "归档项目会话", exact: true }).click();
        await expect(row(first.title)).toHaveCount(0);
        await page.getByRole("button", { name: "显示归档", exact: true }).click();
        await expect(row(first.title)).toBeVisible();
        await openSessionMenu(first.title);
        await menu().getByRole("menuitem", { name: "取消归档", exact: true }).click();
        await expect
          .poll(
            async () => (await snapshot()).sessions.find((item) => item.id === first.id)?.archived,
          )
          .toBe(false);
        await page.getByRole("button", { name: "显示归档", exact: true }).click();
        projectMenu = await openProjectMenu();
        await projectMenu.getByRole("menuitem", { name: "移除项目", exact: true }).click();
        let removal = page.getByRole("dialog", { name: "移除项目", exact: true });
        await removal.getByRole("button", { name: "取消", exact: true }).click();
        await expect(row(first.title)).toBeVisible();
        projectMenu = await openProjectMenu();
        await projectMenu.getByRole("menuitem", { name: "移除项目", exact: true }).click();
        removal = page.getByRole("dialog", { name: "移除项目", exact: true });
        await removal.getByRole("button", { name: "移除项目", exact: true }).click();
        await expect(
          page.getByRole("button", { name: "项目菜单 " + projectName, exact: true }),
        ).toHaveCount(0);
        expect((await page.request.get("/api/sessions/" + first.id)).ok()).toBe(true);
        await createSession("重新打开目录 " + suffix, true);
        await page.reload();
        if (
          width < 600 &&
          (await page.getByRole("button", { name: "返回会话列表", exact: true }).isVisible())
        )
          await returnToList();
        await expect(row(first.title)).toBeVisible();
        projectMenu = await openProjectMenu();
        await projectMenu.getByRole("menuitem", { name: "移除项目", exact: true }).click();
        removal = page.getByRole("dialog", { name: "移除项目", exact: true });
        await removal.getByRole("checkbox").check();
        await removal.getByRole("button", { name: "移除并删除会话", exact: true }).click();
        await expect(
          page.getByRole("button", { name: "项目菜单 " + projectName, exact: true }),
        ).toHaveCount(0);
        expect((await page.request.get("/api/sessions/" + first.id)).status()).toBe(404);
        expect(readFileSync(join(directory, "source.txt"), "utf8")).toBe("Keep project files");
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        expect(errors).toEqual([]);
      } finally {
        await page.request.delete("/api/projects/" + project.id + "?sessions=delete");
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
}
