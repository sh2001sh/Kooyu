import { expect, test } from "@playwright/test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const shotPath = (info: { outputPath: (name: string) => string }, name: string) =>
  process.env.HIG_SHOT_DIR ? `${process.env.HIG_SHOT_DIR}/${name}` : info.outputPath(name);

test.describe("Apple HIG multi-platform web layout & shortcuts", () => {
  test("desktop 1440px: Ctrl+K Spotlight, Docked Split Inspector, dblclick rename, light/dark overflow", async ({
    page,
    request,
  }, info) => {
    const projectRes = await request.post("/api/projects", {
      data: { name: "HIG Desktop Project" },
    });
    expect(projectRes.ok()).toBe(true);
    const project = await projectRes.json();

    const sessionRes = await request.post("/api/sessions", {
      data: {
        title: "HIG Spotlight Initial",
        projectId: project.id,
        harnessId: "codex",
        kind: "direct",
      },
    });
    expect(sessionRes.ok()).toBe(true);
    const session = await sessionRes.json();

    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/");
      await expect(page.getByRole("button", { name: "打开命令面板", exact: true })).toBeVisible();

      // Open CommandPalette via Ctrl+K (or Cmd+K on macOS) and jump to the created session
      const modKey = process.platform === "darwin" ? "Meta+k" : "Control+k";
      await page.keyboard.press(modKey);
      const palette = page.getByRole("dialog", { name: "命令面板", exact: true });
      await expect(palette).toBeVisible();
      await palette
        .getByRole("searchbox", { name: "搜索命令、对话、设置", exact: true })
        .fill("HIG Spotlight Initial");
      await palette
        .getByRole("option")
        .filter({ hasText: "HIG Spotlight Initial" })
        .first()
        .click();
      await expect(palette).toHaveCount(0);
      await expect(page.locator(".chat-header h1")).toHaveText("HIG Spotlight Initial");

      // Double-click title rename
      await page.locator(".chat-header h1").dblclick();
      const renameInput = page.getByRole("textbox", { name: "重命名对话", exact: true });
      await expect(renameInput).toBeVisible();
      await renameInput.fill("HIG Spotlight Renamed");
      await renameInput.press("Enter");
      await expect(page.locator(".chat-header h1")).toHaveText("HIG Spotlight Renamed");

      // Docked Split Inspector >=1180px: no visible scrim backdrop, 340px default -> 520px on files tab
      await page
        .locator(".chat-header")
        .getByRole("button", { name: "会话检查器", exact: true })
        .click();
      const pane = page.locator("aside.detail-pane");
      await expect(pane).toBeVisible();
      await expect(page.locator(".detail-pane__backdrop")).not.toBeVisible();
      const manageBox = await pane.boundingBox();
      expect(manageBox?.width).toBeGreaterThanOrEqual(336);
      expect(manageBox?.width).toBeLessThanOrEqual(344);

      await page.locator("#inspector-tab-files").click();
      await expect(pane).toHaveClass(/detail-pane--workspace/);
      const filesBox = await pane.boundingBox();
      expect(filesBox?.width).toBeGreaterThanOrEqual(516);
      expect(filesBox?.width).toBeLessThanOrEqual(524);

      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.screenshot({ path: shotPath(info, "desktop-light-1440.png"), fullPage: false });

      // Dark theme check & 0px horizontal overflow
      await page.getByRole("button", { name: "深色主题", exact: true }).click();
      await expect(page.locator("html")).toHaveClass(/\bdark\b/);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.screenshot({ path: shotPath(info, "desktop-dark-1440.png"), fullPage: false });
      await page.getByRole("button", { name: "浅色主题", exact: true }).click();
    } finally {
      await request.delete(`/api/sessions/${session.id}`);
      await request.delete(`/api/projects/${project.id}`);
    }
  });

  test("tablet/medium desktop 900px: .main retains floating paper island radius 14px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 900, height: 900 });
    await page.goto("/");
    const radius = await page
      .locator("main.main")
      .evaluate((el) => getComputedStyle(el).borderRadius);
    expect(radius).toBe("14px");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });

  test("mobile 390px: 4-tab liquid dock (对话 | 项目 | 用量 | 设置) + chat-first home + top-right Inbox", async ({
    page,
    request,
  }, info) => {
    const projectRes = await request.post("/api/projects", {
      data: { name: "HIG Mobile Project" },
    });
    expect(projectRes.ok()).toBe(true);
    const project = await projectRes.json();

    const sessionRes = await request.post("/api/sessions", {
      data: {
        title: "HIG Mobile Session",
        projectId: project.id,
        harnessId: "codex",
        kind: "direct",
      },
    });
    expect(sessionRes.ok()).toBe(true);
    const session = await sessionRes.json();

    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/");
      await expect(page.locator(".splash-screen")).toHaveCount(0);

      const tabbar = page.getByRole("navigation", { name: "移动端标签导航", exact: true });
      await expect(tabbar).toBeVisible();
      await expect(tabbar.getByRole("button")).toHaveCount(4);
      await expect(tabbar.getByRole("button", { name: "对话" })).toBeVisible();
      await expect(tabbar.getByRole("button", { name: "项目" })).toBeVisible();
      await expect(tabbar.getByRole("button", { name: "用量" })).toBeVisible();
      await expect(tabbar.getByRole("button", { name: "设置" })).toBeVisible();

      // Verify Chat-First Home: first conversation starts in upper third (< 280px), not pushed to middle!
      const firstSessionBox = await page
        .locator(".session-row")
        .filter({ hasText: "HIG Mobile Session" })
        .boundingBox();
      expect(firstSessionBox).not.toBeNull();
      expect(firstSessionBox!.y).toBeLessThan(280);

      // Top-right Inbox trigger is visible on mobile home
      const inboxBtn = page.locator(".home-bar-inbox-btn");
      await expect(inboxBtn).toBeVisible();

      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.screenshot({ path: shotPath(info, "mobile-home-light-390.png"), fullPage: false });

      // Navigate to Projects tab via bottom dock & verify segmented switcher [项目与目录 | 工作与计划]
      await tabbar.getByRole("button", { name: "项目" }).click();
      await expect(page.locator(".mobile-projects-hub")).toBeVisible();
      await expect(page.getByRole("group", { name: "项目视图切换" })).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.screenshot({
        path: shotPath(info, "mobile-projects-light-390.png"),
        fullPage: false,
      });

      // Navigate to Usage tab via bottom dock
      await tabbar.getByRole("button", { name: "用量" }).click();
      await expect(page.locator(".usage-page")).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.screenshot({
        path: shotPath(info, "mobile-usage-light-390.png"),
        fullPage: false,
      });

      // Open Top-Right Inbox: subpages MUST hide the root bottom dock, and return via top-left back button
      await page.locator(".page-header__inbox-btn").click();
      await expect(page.locator(".inbox-shell")).toBeVisible();
      await expect(tabbar).toHaveCount(0);
      await page.screenshot({
        path: shotPath(info, "mobile-inbox-light-390.png"),
        fullPage: false,
      });
      await page.getByRole("button", { name: "返回对话列表", exact: true }).click();
      await expect(tabbar).toBeVisible();

      // Dark theme via Host status sheet
      await page.getByRole("button", { name: "Host 连接状态与快捷设置", exact: true }).click();
      await page.getByRole("button", { name: "切换到深色外观", exact: true }).click();
      await expect(page.locator("html")).toHaveClass(/\bdark\b/);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.screenshot({ path: shotPath(info, "mobile-home-dark-390.png"), fullPage: false });

      // Reset to light mode so subsequent tests aren't left dark if persisted in localStorage
      await page.getByRole("button", { name: "Host 连接状态与快捷设置", exact: true }).click();
      await page.getByRole("button", { name: "切换到浅色外观", exact: true }).click();

      // Draft hides mobile tab bar
      await page.getByRole("button", { name: "新建会话", exact: true }).first().click();
      await expect(tabbar).toHaveCount(0);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.getByRole("button", { name: "返回会话列表", exact: true }).click();
      await expect(tabbar).toBeVisible();

      // Session hides mobile tab bar
      await page.locator(".session-row").filter({ hasText: "HIG Mobile Session" }).click();
      await expect(tabbar).toHaveCount(0);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    } finally {
      await request.delete(`/api/sessions/${session.id}`);
      await request.delete(`/api/projects/${project.id}`);
    }
  });

  test("conversation & harness reply rendering: IDE code card, diff, callout, file chip & TurnFiles at 1440px and 390px", async ({
    page,
    request,
  }, info) => {
    const root = mkdtempSync(join(tmpdir(), "kooyu-conv-showcase-"));
    mkdirSync(join(root, "src"), { recursive: true });
    const fileA = "src/TranscriptView.tsx";
    const fileB = "src/TurnFiles.tsx";
    writeFileSync(join(root, fileA), "export function TranscriptView() { return null; }\n");
    writeFileSync(join(root, fileB), "export function TurnFiles() { return null; }\n");

    const projectRes = await request.post("/api/projects", {
      data: { name: "Apple HIG UI 重构", rootPath: root },
    });
    expect(projectRes.ok()).toBe(true);
    const project = await projectRes.json();
    const snap = await (await request.get("/api/snapshot")).json();
    const ws = snap.workspaces.find((w: { projectId: string }) => w.projectId === project.id);

    const sessionRes = await request.post("/api/sessions", {
      data: {
        title: "重构对话界面与 Harness 回复渲染",
        projectId: project.id,
        workspaceId: ws.id,
        harnessId: "claude-code",
        kind: "direct",
      },
    });
    expect(sessionRes.ok()).toBe(true);
    const session = await sessionRes.json();

    const assistantMarkdown = [
      "已完成双端对话流与 Harness 回复渲染升级，核心改动落在 `src/TranscriptView.tsx` 与 `src/TurnFiles.tsx`：",
      "",
      "> [!TIP]",
      "> 代码块行号采用独立 `.md-code-gutter` 轨道渲染，既保持 IDE 级对齐观感，又确保一键复制只拷贝纯净源码。",
      "",
      "### 1. Studio 级代码块与行号轨道",
      "",
      "```tsx",
      "export function CodeHeader({ lang, lines }: { lang: string; lines: number }) {",
      "  const isDiff = lang === 'diff' || lang === 'patch';",
      "  return (",
      '    <header className="md-code-card__header">',
      "      <span className=\"md-code-card__lang\">{isDiff ? '变更对比' : lang}</span>",
      '      <span className="md-code-card__meta">{lines} 行</span>',
      "    </header>",
      "  );",
      "}",
      "```",
      "",
      "### 2. Unified Diff 逐行着色",
      "",
      "```diff",
      "@@ -312,5 +312,6 @@",
      "-  border-style: dashed;",
      "-  background: transparent;",
      "+  border: 1px solid var(--border-subtle);",
      "+  border-left: 2.5px solid var(--border-strong);",
      "+  background: color-mix(in srgb, var(--surface-sunken) 46%, var(--surface-paper));",
      "```",
      "",
      "| 渲染模块 | Web / Desktop | Android 原生 |",
      "| :--- | :--- | :--- |",
      "| IDE 代码卡片 | 语言栏 + 行号 + 复制 | 等宽行号栏 + 复制胶囊 |",
      "| Diff 补丁高亮 | 逐行红绿底色对比 | Compose 逐行语义着色 |",
    ].join("\n");

    const now = Date.now();
    const rawEvents: [string, unknown][] = [
      [
        "message",
        {
          role: "user",
          text: "把对话界面和 Harness 回复渲染再美化一下，代码块、Diff、思考过程和编辑文件卡片都要更精致，保持黑白极简风。",
        },
      ],
      [
        "thinking",
        {
          text: "梳理 Web/Desktop 与 Android 双端消息流结构：去除思考块粗糙的虚线框，引入语义化工具图标、GitHub Callout 提示框、带行号的 IDE 代码卡片与 Unified Diff 高亮。",
        },
      ],
      ["tool", { id: "t1", name: "Read", input: { file_path: fileA }, status: "completed" }],
      [
        "tool",
        {
          id: "t2",
          name: "Bash",
          input: { command: "npm --workspace @kodo/web run build" },
          status: "completed",
        },
      ],
      [
        "tool",
        {
          id: "t3",
          type: "fileChange",
          status: "completed",
          changes: [
            { path: fileA, diff: "@@ -1,3 +1,12 @@\n-old\n+line1\n+line2\n+line3\n+line4" },
            { path: fileB, diff: "@@ -1,2 +1,6 @@\n-old\n+card1\n+card2\n+card3" },
          ],
        },
      ],
      [
        "message",
        {
          role: "assistant",
          model: "claude-sonnet-4-5",
          text: assistantMarkdown,
        },
      ],
      ["turn-ended", { outcome: "completed" }],
      ["settled", {}],
    ];

    const events = rawEvents.map(([type, payload], i) => ({
      id: `showcase-${i}`,
      sessionId: session.id,
      sequence: i + 1,
      type,
      payload,
      source: "fixture",
      nativeRunId: null,
      createdAt: new Date(now - (rawEvents.length - i) * 8000).toISOString(),
    }));

    await page.route(`**/api/sessions/${session.id}**`, (route) => {
      const url = route.request().url();
      if (url.includes("/activity")) {
        return route.fulfill({ json: { sessionId: session.id, cursor: 1, agents: [] } });
      }
      return route.fulfill({ json: { session, events, commands: [], olderCursor: null } });
    });

    await page.addInitScript((id) => localStorage.setItem("kodo.session", id), session.id);

    try {
      // 1) Desktop 1440px Light & Dark
      await page.setViewportSize({ width: 1440, height: 1040 });
      await page.goto("/");
      await expect(page.locator(".md-callout--tip")).toBeVisible();
      await expect(page.locator(".md-code-card")).toHaveCount(2);
      await expect(page.locator(".md-diff-line.is-add").first()).toBeVisible();
      await expect(page.locator(".turn-files")).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.screenshot({
        path: shotPath(info, "conv-desktop-light-1440.png"),
        fullPage: false,
      });

      await page.getByRole("button", { name: "深色主题", exact: true }).click();
      await expect(page.locator("html")).toHaveClass(/\bdark\b/);
      await page.screenshot({
        path: shotPath(info, "conv-desktop-dark-1440.png"),
        fullPage: false,
      });
      await page.getByRole("button", { name: "浅色主题", exact: true }).click();

      // 2) Mobile 390px Light & Dark
      await page.setViewportSize({ width: 390, height: 920 });
      await page.waitForTimeout(250);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.screenshot({ path: shotPath(info, "conv-mobile-light-390.png"), fullPage: false });

      // Scroll down inside transcript to also capture Diff + Table + TurnFiles on mobile
      await page.evaluate(() => {
        const scroller =
          document.querySelector(".transcript-scroller") ||
          document.querySelector(".conversation-main");
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
      });
      await page.waitForTimeout(200);
      await page.screenshot({
        path: shotPath(info, "conv-mobile-bottom-light-390.png"),
        fullPage: false,
      });

      await page.evaluate(() => document.documentElement.classList.add("dark"));
      await page.waitForTimeout(150);
      await page.screenshot({
        path: shotPath(info, "conv-mobile-bottom-dark-390.png"),
        fullPage: false,
      });
      await page.evaluate(() => document.documentElement.classList.remove("dark"));
    } finally {
      await request.delete(`/api/sessions/${session.id}`).catch(() => {});
      await request.delete(`/api/projects/${project.id}`).catch(() => {});
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("appearance studio & de-bloated new chat: live preview, palette cards, clean hero & composer controls", async ({
    page,
  }, info) => {
    // 1) Desktop 1440px De-bloated New Chat + Clean Appearance Studio
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto("/");
    await page.getByRole("button", { name: "新建会话", exact: true }).click();
    await expect(page.getByRole("radiogroup", { name: "快捷切换引擎" })).toHaveCount(0);
    await expect(page.locator(".draft-templates")).toHaveCount(0);
    await page.screenshot({ path: shotPath(info, "draft-v7-desktop-1440.png"), fullPage: false });

    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page
      .getByRole("navigation", { name: "配置导航", exact: true })
      .getByRole("button", { name: "外观", exact: true })
      .click();

    const studio = page.locator(".ap-studio");
    await expect(studio.getByRole("heading", { name: "外观", exact: true })).toBeVisible();
    await expect(studio.locator(".ap-studio__subtitle")).toHaveCount(0);
    await expect(
      studio.getByRole("radiogroup", { name: "外观模式选择" }).getByRole("radio"),
    ).toHaveCount(3);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: shotPath(info, "appearance-v7-desktop-1440.png"),
      fullPage: false,
    });

    // Switch palette card ("温润米宣") & glass opacity
    await studio.locator('.ap-palette-card[data-preset="claude"]').click();
    await studio.getByLabel("毛玻璃透明度").fill("74");
    const paperVar = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--surface-paper").trim(),
    );
    expect(paperVar.toUpperCase()).toContain("#FAF9F5");
    await studio.getByRole("button", { name: "恢复默认外观" }).click();

    // 2) Mobile 390px Clean Appearance Studio (subpage hides bottom dock) + New Chat + Full Composer Controls
    await page.setViewportSize({ width: 390, height: 860 });
    await page.waitForTimeout(200);
    await expect(page.getByRole("navigation", { name: "移动端标签导航", exact: true })).toHaveCount(
      0,
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: shotPath(info, "appearance-v7-mobile-390.png"),
      fullPage: false,
    });

    // Return to Settings root -> Jump to Chat -> New Chat Draft -> Switch Engine cleanly via top pill
    await page.getByRole("button", { name: "返回设置列表", exact: true }).click();
    await page
      .getByRole("navigation", { name: "移动端标签导航", exact: true })
      .getByRole("button", { name: "对话" })
      .click();
    await page.getByRole("button", { name: "新建会话", exact: true }).first().click();

    await expect(page.getByRole("radiogroup", { name: "快捷切换引擎" })).toHaveCount(0);
    await page.getByRole("button", { name: "切换对话引擎", exact: true }).click();
    await page
      .getByRole("dialog", { name: "选择对话引擎" })
      .locator('[role="option"][data-value="claude-code"]')
      .click();

    await expect(page.getByRole("button", { name: "模型配置", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "思考强度", exact: true })).toBeVisible();
    const mobilePermBtn = page.getByRole("button", { name: "工具权限", exact: true });
    await expect(mobilePermBtn).toBeVisible();
    // Regression: permission pill must never clip under the Send button or fade curtain on 390px phone
    const permBox = await mobilePermBtn.boundingBox();
    const sendBox = await page.getByRole("button", { name: "发送消息", exact: true }).boundingBox();
    expect(permBox).not.toBeNull();
    expect(sendBox).not.toBeNull();
    expect(permBox!.x + permBox!.width).toBeLessThanOrEqual(sendBox!.x + 1);
    expect(permBox!.width).toBeGreaterThanOrEqual(72);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: shotPath(info, "draft-v7-mobile-controls-390.png"),
      fullPage: false,
    });

    // Open mobile permission popover directly from composer and confirm zero overlap with composer textarea
    await mobilePermBtn.click();
    const mobilePermPopover = page.locator(".composer .ios-popover").first();
    await expect(mobilePermPopover).toBeVisible();
    await expect
      .poll(async () => {
        const popBox = await mobilePermPopover.boundingBox();
        const compBox = await page.locator(".composer").first().boundingBox();
        return popBox && compBox ? popBox.y + popBox.height - compBox.y : 999;
      })
      .toBeLessThanOrEqual(1);
    await page.screenshot({
      path: shotPath(info, "draft-v7-mobile-perm-open-390.png"),
      fullPage: false,
      animations: "disabled",
    });
    await page.keyboard.press("Escape");

    // Verify "+" sheet shows visible permission label & chevron (regression check for blank permission card)
    await page.getByRole("button", { name: "添加附件、权限或模板", exact: true }).click();
    const plusDialog = page.getByRole("dialog", { name: "添加与设置" });
    const permBtn = plusDialog.getByRole("button", { name: "会话权限" });
    await expect(permBtn).toContainText(/逐项审批|原生默认|原生权限/);
    await expect(permBtn.locator("span").first()).toBeVisible();
    await page.screenshot({
      path: shotPath(info, "draft-v7-mobile-plus-390.png"),
      fullPage: false,
      animations: "disabled",
    });
    await plusDialog.getByRole("button", { name: "关闭", exact: true }).click();

    // Desktop 1440px permission popover must stay aligned inside composer horizontal bounds
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(150);
    const desktopPermBtn = page
      .locator(".composer-pickers")
      .getByRole("button", { name: "会话权限" });
    await desktopPermBtn.click();
    const desktopPermPop = page.locator(".composer-pickers .ios-popover").first();
    await expect(desktopPermPop).toBeVisible();
    const dPopBox = await desktopPermPop.boundingBox();
    const dCompBox = await page.locator(".composer").first().boundingBox();
    expect(dPopBox!.x).toBeGreaterThanOrEqual(dCompBox!.x - 1);
    expect(dPopBox!.x + dPopBox!.width).toBeLessThanOrEqual(dCompBox!.x + dCompBox!.width + 1);
    await page.screenshot({
      path: shotPath(info, "draft-v7-desktop-perm-open-1440.png"),
      fullPage: false,
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
  });
});
