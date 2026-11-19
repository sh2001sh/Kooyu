import { expect, test } from "@playwright/test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

for (const width of [1440, 390])
  test(`existing messages and child files open in-app with per-turn edit summaries at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 960 });
    const root = mkdtempSync(join(tmpdir(), "kooyu-file-links-ui-"));
    mkdirSync(join(root, "docs"));
    const path = "docs/frontend-design-and-refactoring-2026-11-17.md";
    const spaced = "docs/中文 design.md";
    writeFileSync(join(root, path), "# 已保存的设计方案\n\n这是工作区中真实存在的文件。\n");
    writeFileSync(join(root, spaced), "# 中文文件预览\n");
    const project = await (
      await page.request.post("/api/projects", {
        data: { name: `File links ${width}`, rootPath: root },
      })
    ).json();
    const snapshot = await (await page.request.get("/api/snapshot")).json();
    const workspace = snapshot.workspaces.find(
      (w: { projectId: string }) => w.projectId === project.id,
    );
    const session = await (
      await page.request.post("/api/sessions", {
        data: {
          title: "文件链接与本轮编辑",
          harnessId: "claude-code",
          kind: "direct",
          projectId: project.id,
          workspaceId: workspace.id,
        },
      })
    ).json();
    const values: [string, unknown][] = [
      ["message", { role: "user", text: "保存设计方案" }],
      [
        "tool",
        { id: "read", name: "Read", input: { file_path: "read-only.md" }, status: "completed" },
      ],
      ["tool", { id: "write", name: "Write", input: { file_path: path }, lifecycle: "started" }],
      ["tool", { toolCallId: "write", status: "completed", lifecycle: "completed" }],
      [
        "tool",
        { id: "failed", name: "Write", input: { file_path: "failed.md" }, status: "failed" },
      ],
      ...Array.from(
        { length: 4 },
        (_, i) =>
          [
            "tool",
            {
              id: `edit-${i}`,
              type: "fileChange",
              status: "completed",
              changes: [{ path: `src/${i}.ts`, diff: "@@ -1 +1 @@\n-old\n+new" }],
            },
          ] as [string, unknown],
      ),
      [
        "message",
        {
          role: "assistant",
          text: `完整方案已保存至 \`${path}\`。\n\n另见 [已存在的链接](${path}) 与 \`${spaced}\`。\n\n普通路径：${path}\n\n命令保持代码：\`cat docs/ignore.md\`\n\n\`\`\`txt\n${path}\n\`\`\`\n\n[外部网页](https://example.com/docs/example.md)`,
        },
      ],
      ["turn-ended", { outcome: "completed" }],
      ["settled", {}],
      ["message", { role: "user", text: "继续阅读" }],
      [
        "tool",
        { id: "read2", name: "Read", input: { file_path: "read-only.md" }, status: "completed" },
      ],
      ["message", { role: "assistant", text: "本轮只读取文件" }],
      ["turn-ended", { outcome: "completed" }],
    ];
    const events = values.map(([type, payload], i) => ({
      id: `file-${i}`,
      sessionId: session.id,
      sequence: i + 1,
      type,
      payload,
      source: "fixture",
      nativeRunId: null,
      createdAt: new Date().toISOString(),
    }));
    await page.route(`**/api/sessions/${session.id}?*`, (route) =>
      route.fulfill({ json: { session, events, commands: [], olderCursor: null } }),
    );
    await page.route(`**/api/sessions/${session.id}/activity`, (route) =>
      route.fulfill({
        json: {
          sessionId: session.id,
          cursor: 1,
          agents: [{ agentId: "child", name: "文档子代理", status: "completed" }],
        },
      }),
    );
    await page.route(`**/api/sessions/${session.id}/agents/child`, (route) =>
      route.fulfill({
        json: {
          agent: { agentId: "child", name: "文档子代理", status: "completed" },
          events: [
            { ...events[0], payload: { role: "assistant", text: `子代理生成了 \`${path}\`` } },
          ],
          olderCursor: null,
        },
      }),
    );
    await page.addInitScript((id) => localStorage.setItem("kodo.session", id), session.id);
    try {
      await page.goto("/");
      const main = page.locator(".conversation-main");
      const inline = main.getByRole("button", { name: path, exact: true }).first();
      await expect(inline).toBeAttached();
      expect(await inline.locator("code").count()).toBe(1);
      await inline.click();
      const pane = page.locator(".detail-pane");
      await expect(
        pane.getByRole("heading", { name: "已保存的设计方案", exact: true }),
      ).toBeVisible();
      await expect(pane.getByText("这是工作区中真实存在的文件。", { exact: true })).toBeVisible();
      await page.screenshot({ path: info.outputPath(`file-preview-${width}.png`) });
      await pane.getByRole("button", { name: "关闭详情", exact: true }).click();
      await main.getByRole("button", { name: spaced, exact: true }).click();
      await expect(pane.getByRole("heading", { name: "中文文件预览", exact: true })).toBeVisible();
      await pane.getByRole("button", { name: "关闭详情", exact: true }).click();
      await expect(main.locator("pre code")).toHaveText(path);
      await expect(
        main.getByRole("button", { name: "cat docs/ignore.md", exact: true }),
      ).toHaveCount(0);
      await expect(main.getByRole("link", { name: "外部网页", exact: true })).toHaveAttribute(
        "href",
        "https://example.com/docs/example.md",
      );
      const summary = main.getByRole("region", { name: "本轮编辑的文件", exact: true });
      await expect(summary).toHaveCount(1);
      await expect(summary).toContainText("本轮编辑 5 个文件");
      await expect(summary).not.toContainText(/read-only|failed/);
      await summary.getByRole("button", { name: "再显示 2 个文件", exact: true }).click();
      await expect(summary.getByRole("button", { name: "src/3.ts", exact: true })).toBeVisible();
      await page.screenshot({ path: info.outputPath(`turn-files-${width}.png`) });
      await summary.getByRole("button", { name: path, exact: true }).click();
      await expect(
        pane.getByRole("heading", { name: "已保存的设计方案", exact: true }),
      ).toBeVisible();
      await pane.getByRole("button", { name: "关闭详情", exact: true }).click();
      await summary.getByRole("button", { name: "查看变更", exact: true }).click();
      await expect(pane.getByRole("tab", { name: "改动", exact: true })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await pane.getByRole("button", { name: "关闭详情", exact: true }).click();
      if (width < 600) {
        await page.getByRole("button", { name: /1 子代理/ }).click();
        await page
          .getByRole("dialog", { name: "子代理切换" })
          .getByRole("button", { name: /文档子代理/ })
          .click();
      } else {
        await page.getByRole("combobox", { name: "全部子代理", exact: true }).selectOption("child");
      }
      await page
        .getByRole("tabpanel", { name: /子代理对话/ })
        .getByRole("button", { name: path, exact: true })
        .click();
      await expect(
        pane.getByRole("heading", { name: "已保存的设计方案", exact: true }),
      ).toBeVisible();
      expect(page.context().pages()).toHaveLength(1);
    } finally {
      await page.request.delete(`/api/sessions/${session.id}`);
      await page.request.delete(`/api/projects/${project.id}`);
      rmSync(root, { recursive: true, force: true });
    }
  });
