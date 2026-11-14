import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test.use({ locale: "zh-CN" });
for (const width of [1440, 390]) {
  test(
    "workspace inspector shows files, images, Markdown, diffs and runtime at " + width + "px",
    async ({ page, request }, info) => {
      test.setTimeout(90000);
      await page.setViewportSize({ width, height: 960 });
      const dir = mkdtempSync(join(tmpdir(), "kooyu-inspector-ui-"));
      const git = (...args: string[]) =>
        execFileSync("git", ["-C", dir, ...args], { windowsHide: true });
      const errors: string[] = [];
      let projectId = "",
        sessionId = "";
      page.on("pageerror", (error) => errors.push(error.message));
      try {
        mkdirSync(join(dir, "output"));
        writeFileSync(join(dir, "README.md"), "# Initial\nold content\n");
        git("init", "--quiet");
        git("config", "user.name", "Kooyu Test");
        git("config", "user.email", "test@example.invalid");
        git("config", "core.autocrlf", "false");
        git("add", "README.md");
        git("commit", "-qm", "initial");
        writeFileSync(
          join(dir, "README.md"),
          "# Preview document\nmodified content\n[Open script](output/script.ts)\n![diagram](output/design.svg)\n",
        );
        writeFileSync(join(dir, "output", "script.ts"), "export const result = 'ready';\n");
        writeFileSync(
          join(dir, "output", "design.svg"),
          '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="240" viewBox="0 0 480 240"><rect width="480" height="240" fill="#dbe9f4"/><rect x="40" y="40" width="400" height="160" rx="12" fill="#fff"/><text x="75" y="130" font-size="26" fill="#183047">Workspace preview</text></svg>',
        );
        writeFileSync(join(dir, "unsupported.docx"), Buffer.from([0x50, 0x4b, 0, 0xff]));
        const project = await (
          await request.post("/api/projects", {
            data: { name: "File inspector " + width, rootPath: dir },
          })
        ).json();
        projectId = project.id;
        const snapshot = await (await request.get("/api/snapshot")).json();
        const workspace = snapshot.workspaces.find(
          (item: { projectId: string }) => item.projectId === projectId,
        )!;
        const session = await (
          await request.post("/api/sessions", {
            data: {
              title: "Workspace inspector " + width,
              harnessId: "codex",
              kind: "direct",
              projectId,
              workspaceId: workspace.id,
            },
          })
        ).json();
        sessionId = session.id;
        const events = [
          {
            id: "file-call",
            sessionId,
            nativeRunId: null,
            sequence: 1,
            type: "tool",
            payload: {
              type: "fileChange",
              status: "completed",
              changes: [{ path: "output/design.svg" }],
            },
            createdAt: new Date().toISOString(),
            source: "codex",
          },
          {
            id: "file-reply",
            sessionId,
            nativeRunId: null,
            sequence: 2,
            type: "message",
            payload: { role: "assistant", text: "[Open design](output/design.svg)" },
            createdAt: new Date().toISOString(),
            source: "codex",
          },
          {
            id: "child",
            sessionId,
            nativeRunId: null,
            sequence: 3,
            type: "subagent",
            payload: { agentId: "reviewer", name: "File reviewer", status: "completed" },
            createdAt: new Date().toISOString(),
            source: "codex",
          },
        ];
        await page.route("**/api/sessions/" + sessionId + "?*", (route) =>
          route.fulfill({ json: { session, events, commands: [], olderCursor: null } }),
        );
        await page.addInitScript((id) => localStorage.setItem("kodo.session", id), sessionId);
        await page.goto("/");
        await page.getByRole("button", { name: "Open design", exact: true }).click();
        const panel = page.getByRole("complementary", { name: "会话检查器" });
        await expect(panel.getByRole("tab", { name: "文件", exact: true })).toHaveAttribute(
          "aria-selected",
          "true",
        );
        const image = panel.getByRole("img", { name: "design.svg", exact: true });
        await expect(image).toBeVisible();
        await expect
          .poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth))
          .toBe(480);
        await panel.getByRole("button", { name: "放大图片" }).click();
        await expect(panel.getByRole("button", { name: "125%", exact: true })).toBeVisible();
        await panel.screenshot({ path: info.outputPath("image-" + width + ".png") });
        await panel.getByRole("button", { name: /^会话涉及/ }).click();
        await expect(panel.getByLabel("文件列表")).toContainText("output/design.svg");
        await panel.getByRole("button", { name: "工作区", exact: true }).click();
        await panel.getByRole("button", { name: "README.md", exact: true }).click();
        await expect(panel.getByRole("heading", { name: "Preview document" })).toBeVisible();
        await expect
          .poll(() =>
            panel
              .getByRole("img", { name: "diagram" })
              .evaluate((el: HTMLImageElement) => el.naturalWidth),
          )
          .toBe(480);
        await panel.getByRole("button", { name: "查看源码" }).click();
        await expect(panel.locator(".workspace-preview__code")).toContainText("# Preview document");
        await panel.getByRole("button", { name: "阅读预览" }).click();
        await panel.getByRole("button", { name: "Open script", exact: true }).click();
        await expect(panel.locator(".workspace-preview__code")).toContainText("result = 'ready'");
        await panel.getByRole("tab", { name: "改动", exact: true }).click();
        await expect(panel.getByLabel("改动文件列表")).toContainText("README.md");
        await panel.getByRole("button", { name: /修改README.md|修改 README.md/ }).click();
        await expect(panel.locator(".workspace-diff")).toContainText("+modified content");
        await expect(panel).toContainText("作者归属未知");
        await panel.screenshot({ path: info.outputPath("changes-" + width + ".png") });
        await panel.getByRole("button", { name: "查看当前文件" }).click();
        await expect(panel.getByRole("heading", { name: "Preview document" })).toBeVisible();
        await panel.getByRole("tab", { name: "文件", exact: true }).click();
        await panel.getByRole("button", { name: "unsupported.docx", exact: true }).click();
        await expect(panel).toContainText("暂不支持此文件格式");
        await panel.getByLabel("文件路径", { exact: true }).fill("../outside.txt");
        await panel.getByRole("button", { name: "打开", exact: true }).click();
        await expect(panel.getByRole("alert")).toContainText("超出当前工作位置");
        await panel.getByLabel("文件路径", { exact: true }).fill("output/script.ts");
        await panel.getByRole("button", { name: "打开", exact: true }).click();
        await expect(panel.locator(".workspace-preview__code")).toContainText("'ready'");
        writeFileSync(join(dir, "output", "script.ts"), "export const result = 'updated';\n");
        await panel.getByRole("button", { name: "刷新文件与改动" }).click();
        await expect(panel.locator(".workspace-preview__code")).toContainText("'updated'");
        rmSync(join(dir, "output", "script.ts"));
        await panel.getByRole("button", { name: "刷新文件与改动" }).click();
        await expect(panel.getByRole("alert")).toContainText("不存在");
        await expect(panel.locator(".workspace-preview__code")).toHaveCount(0);
        await panel.getByRole("tab", { name: "运行", exact: true }).click();
        await expect(panel.getByText("File reviewer", { exact: true })).toBeVisible();
        await panel.getByRole("tab", { name: "运行", exact: true }).focus();
        await page.keyboard.press("Home");
        await expect(panel.getByRole("tab", { name: "文件", exact: true })).toBeFocused();
        // Rebuilt assets may be served by an older independent Host process.
        await page.route("**/api/workspaces/" + workspace.id + "/**", (route) =>
          route.fulfill({
            status: 404,
            json: { error: { code: "NOT_FOUND", message: "接口不存在。" } },
          }),
        );
        await panel.getByRole("button", { name: "刷新文件与改动" }).click();
        await expect(panel).toContainText("当前 Host 仍是旧版本");
        await expect(panel).not.toContainText("接口不存在。");
        await panel.getByRole("tab", { name: "改动", exact: true }).click();
        await expect(panel).toContainText("刷新或关闭界面不会重启 Host");
        await page.keyboard.press("Escape");
        await expect(panel).toHaveCount(0);
        expect(errors).toEqual([]);
      } finally {
        if (sessionId) await request.delete("/api/sessions/" + sessionId).catch(() => {});
        if (projectId) await request.delete("/api/projects/" + projectId).catch(() => {});
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
}
