import { expect, test } from "@playwright/test";

const shotPath = (info: { outputPath: (name: string) => string }, name: string) =>
  process.env.HIG_SHOT_DIR ? `${process.env.HIG_SHOT_DIR}/${name}` : info.outputPath(name);

test.describe("Selective harness conversation import & multi-language switching", () => {
  test("Settings -> 导入对话 selectively imports only chosen conversations in a project at 1440px & 390px", async ({
    page,
    request,
  }, info) => {
    const pA = await (await request.post("/api/projects", { data: { name: "Alpha Repo" } })).json();
    const pB = await (await request.post("/api/projects", { data: { name: "Beta Repo" } })).json();
    const existing = await (
      await request.post("/api/sessions", {
        data: { title: "Already In Kooyu", projectId: pA.id, harnessId: "codex", kind: "direct" },
      })
    ).json();

    const importedRequests: Array<Record<string, any>> = [];
    let importedAlpha1 = false;

    try {
      await page.route("**/api/native-imports*", async (route) => {
        const req = route.request();
        if (req.method() === "GET") {
          const url = new URL(req.url());
          const projectId = url.searchParams.get("projectId");
          const all = [
            {
              harnessId: "claude-code",
              nativeSessionId: "alpha-c1",
              title: "排查鉴权 Token 刷新失败问题",
              cwd: "E:/repos/alpha",
              projectId: pA.id,
              workspaceId: null,
              createdAt: "2026-11-18T09:00:00Z",
              updatedAt: "2026-11-18T11:30:00Z",
              model: "claude-sonnet-4-6",
              messageCount: 14,
              alreadyImported: importedAlpha1,
              existingSessionId: importedAlpha1 ? existing.id : null,
            },
            {
              harnessId: "codex",
              nativeSessionId: "alpha-c2",
              title: "重构账单明细表格列宽布局",
              cwd: "E:/repos/alpha",
              projectId: pA.id,
              workspaceId: null,
              createdAt: "2026-11-18T08:00:00Z",
              updatedAt: "2026-11-18T10:15:00Z",
              model: "gpt-5.4",
              messageCount: 8,
              alreadyImported: false,
              existingSessionId: null,
            },
            {
              harnessId: "codex",
              nativeSessionId: "alpha-c3",
              title: "Already In Kooyu",
              cwd: "E:/repos/alpha",
              projectId: pA.id,
              workspaceId: null,
              createdAt: "2026-11-17T08:00:00Z",
              updatedAt: "2026-11-17T09:00:00Z",
              model: "gpt-5.4",
              messageCount: 4,
              alreadyImported: true,
              existingSessionId: existing.id,
            },
            {
              harnessId: "opencode",
              nativeSessionId: "beta-c1",
              title: "Beta 服务性能分析",
              cwd: "E:/repos/beta",
              projectId: pB.id,
              workspaceId: null,
              createdAt: "2026-11-18T07:00:00Z",
              updatedAt: "2026-11-18T07:45:00Z",
              model: "deepseek-v4.1-flash",
              messageCount: 6,
              alreadyImported: false,
              existingSessionId: null,
            },
          ];
          const filtered = projectId ? all.filter((c) => c.projectId === projectId) : all;
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ candidates: filtered, warnings: [] }),
          });
          return;
        }
        if (req.method() === "POST") {
          const body = req.postDataJSON();
          importedRequests.push(body);
          importedAlpha1 = true;
          await route.fulfill({
            status: 201,
            contentType: "application/json",
            body: JSON.stringify({
              imported: [existing],
              skipped: [],
              errors: [],
            }),
          });
          return;
        }
        await route.continue();
      });

      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/");
      await page.getByRole("button", { name: "设置", exact: true }).click();
      await page
        .getByRole("navigation", { name: "配置导航", exact: true })
        .getByRole("button", { name: "导入对话", exact: true })
        .click();

      await expect(page.getByRole("heading", { name: "导入对话" }).first()).toBeVisible();
      await expect(page.getByText("排查鉴权 Token 刷新失败问题")).toBeVisible();
      await expect(page.getByText("Beta 服务性能分析")).toBeVisible();

      // Filter to Alpha Repo only
      await page.getByLabel("所属项目", { exact: true }).selectOption(pA.id);
      await expect(page.getByText("排查鉴权 Token 刷新失败问题")).toBeVisible();
      await expect(page.getByText("Beta 服务性能分析")).toHaveCount(0);

      // Select ONLY the first conversation (leave the second unselected!)
      const row1 = page.locator(".sx-import-row__main", { hasText: "排查鉴权 Token 刷新失败问题" });
      await row1.click();
      await expect(row1).toHaveAttribute("aria-pressed", "true");
      const importBtn = page.getByRole("button", { name: "导入所选对话 (1)", exact: true });
      await expect(importBtn).toBeEnabled();

      await page.waitForTimeout(450);
      await page.screenshot({ path: shotPath(info, "import-settings-1440.png"), fullPage: false });

      // Import selected conversation and verify payload contains ONLY alpha-c1
      await importBtn.click();
      await expect(page.getByText("已成功导入 1 个对话")).toBeVisible();
      expect(importedRequests).toHaveLength(1);
      expect(
        importedRequests[0]!.items.map((i: { nativeSessionId: string }) => i.nativeSessionId),
      ).toEqual(["alpha-c1"]);

      // Verify zero horizontal overflow on mobile 390px
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(300);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      ).toBe(true);
      await page.screenshot({ path: shotPath(info, "import-settings-390.png"), fullPage: false });
    } finally {
      await request.delete(`/api/sessions/${existing.id}`).catch(() => {});
      await request.delete(`/api/projects/${pA.id}`).catch(() => {});
      await request.delete(`/api/projects/${pB.id}`).catch(() => {});
    }
  });

  test("Multi-language switcher immediately translates desktop settings & mobile 4-tab dock", async ({
    page,
    request,
  }, info) => {
    const prior = await (await request.get("/api/app-settings")).json();
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/");
      await page.getByRole("button", { name: "设置", exact: true }).click();
      await page
        .getByRole("navigation", { name: "配置导航", exact: true })
        .getByRole("button", { name: "通用", exact: true })
        .click();

      // Switch to English: applies immediately without clicking Save
      await page.getByLabel("界面语言", { exact: true }).selectOption("en");
      await expect(page.getByRole("button", { name: "Import chats", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Model sources", exact: true })).toBeVisible();
      await expect(page.getByText("Back to chats", { exact: true })).toBeVisible();

      await expect
        .poll(async () => (await (await request.get("/api/app-settings")).json()).language)
        .toBe("en");

      await page.screenshot({ path: shotPath(info, "i18n-en-1440.png"), fullPage: false });

      // Check Mobile 390px 4-tab dock translated to English
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("button", { name: "返回设置列表", exact: true }).click();
      const dock = page.getByRole("navigation", { name: "移动端标签导航" });
      await expect(dock.getByRole("button", { name: "Chats" })).toBeVisible();
      await expect(dock.getByRole("button", { name: "Projects" })).toBeVisible();
      await expect(dock.getByRole("button", { name: "Usage" })).toBeVisible();
      await expect(dock.getByRole("button", { name: "Settings" })).toBeVisible();
      await page.screenshot({ path: shotPath(info, "i18n-en-390.png"), fullPage: false });

      // Switch to Japanese and verify
      await page.setViewportSize({ width: 1440, height: 900 });
      await page
        .getByRole("navigation", { name: "配置导航", exact: true })
        .getByRole("button", { name: "General", exact: true })
        .click();
      await page.getByLabel("Interface language", { exact: true }).selectOption("ja");
      await expect(page.getByRole("button", { name: "チャット取込", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "モデルソース", exact: true })).toBeVisible();
    } finally {
      const cur = await (await request.get("/api/app-settings")).json();
      await request
        .patch("/api/app-settings", {
          data: { ...prior, revision: cur.revision },
        })
        .catch(() => {});
    }
  });
});
