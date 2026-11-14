import { expect, test } from "@playwright/test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("all harnesses reuse the last project folder while explicit global Kooyu keeps global scope", async ({
  page,
  request,
}) => {
  const directory = mkdtempSync(join(tmpdir(), "kodo-ui-workspace-"));
  const previousSettings = await (await request.get("/api/app-settings")).json();
  const projectIds: string[] = [];
  const workspaceIds: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    const project = await (
      await request.post("/api/projects", { data: { name: "目录沿用项目", rootPath: directory } })
    ).json();
    projectIds.push(project.id);
    const otherDirectory = join(directory, "other");
    mkdirSync(otherDirectory);
    const other = await (
      await request.post("/api/projects", {
        data: { name: "另一个项目目录", rootPath: otherDirectory },
      })
    ).json();
    projectIds.push(other.id);
    const snapshot = await (await request.get("/api/snapshot")).json();
    const workspace = snapshot.workspaces.find(
      (w: { projectId: string }) => w.projectId === project.id,
    );
    const otherWorkspace = snapshot.workspaces.find(
      (w: { projectId: string }) => w.projectId === other.id,
    );
    workspaceIds.push(workspace.id, otherWorkspace.id);
    await page.addInitScript((id) => {
      localStorage.setItem("kodo.lastWorkspace", id);
    }, workspace.id);

    for (const harnessId of ["kodo", "codex", "pi"]) {
      const currentSettings = await (await request.get("/api/app-settings")).json();
      const updated = await request.patch("/api/app-settings", {
        data: { ...currentSettings, defaultHarnessId: harnessId },
      });
      expect(updated.ok()).toBe(true);
      const settingsLoaded = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/app-settings") && response.request().method() === "GET",
      );
      await page.goto("/");
      await settingsLoaded;
      await expect(page.getByText("Host 已连接", { exact: true })).toHaveCount(1);
      await page.getByRole("button", { name: "新建会话", exact: true }).click();
      await expect(page.getByRole("button", { name: "Harness", exact: true })).toHaveAttribute(
        "data-value",
        harnessId,
      );
      await expect(page.getByRole("button", { name: "项目", exact: true })).toHaveAttribute(
        "data-value",
        project.id,
      );
      await expect(page.getByRole("button", { name: "工作位置", exact: true })).toHaveAttribute(
        "data-value",
        workspace.id,
      );
      await page.getByLabel("标题", { exact: true }).fill(`沿用目录 ${harnessId}`);
      await page.getByRole("button", { name: "创建会话", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: `沿用目录 ${harnessId}`, exact: true }),
      ).toBeVisible();
      const saved = await (await request.get("/api/snapshot")).json();
      expect(
        saved.sessions.find((s: { title: string }) => s.title === `沿用目录 ${harnessId}`),
      ).toMatchObject({ harnessId, projectId: project.id, workspaceId: workspace.id });
    }

    await page.getByRole("button", { name: "新建主对话", exact: true }).click();
    await expect(page.getByRole("button", { name: "项目", exact: true })).toHaveAttribute(
      "data-value",
      "",
    );
    await expect(page.getByRole("button", { name: "工作位置", exact: true })).toHaveAttribute(
      "data-value",
      workspace.id,
    );
    await page.getByLabel("标题", { exact: true }).fill("全局编排沿用目录");
    await page.getByRole("button", { name: "创建会话", exact: true }).click();
    await expect(page.locator(".master-row").filter({ hasText: "全局编排沿用目录" })).toHaveCount(
      1,
    );
    const saved = await (await request.get("/api/snapshot")).json();
    expect(
      saved.sessions.find((s: { title: string }) => s.title === "全局编排沿用目录"),
    ).toMatchObject({ projectId: null, scope: "global", workspaceId: workspace.id });

    await page.getByRole("button", { name: "在 另一个项目目录 新建会话", exact: true }).click();
    await expect(page.getByRole("button", { name: "项目", exact: true })).toHaveAttribute(
      "data-value",
      other.id,
    );
    await expect(page.getByRole("button", { name: "工作位置", exact: true })).toHaveAttribute(
      "data-value",
      otherWorkspace.id,
    );
    await page.getByRole("textbox", { name: "消息", exact: true }).fill("编排这个项目");
    await page.getByRole("button", { name: "工作位置", exact: true }).click();
    await page.getByRole("option", { name: "不指定目录", exact: true }).click();
    await expect(page.getByText("请先选择工作位置。", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "发送消息", exact: true })).toBeDisabled();
    expect(errors).toEqual([]);
  } finally {
    const currentSettings = await (await request.get("/api/app-settings")).json();
    await request.patch("/api/app-settings", {
      data: { ...previousSettings, revision: currentSettings.revision },
    });
    const snapshot = await (await request.get("/api/snapshot")).json();
    for (const session of snapshot.sessions) {
      if (workspaceIds.includes(session.workspaceId))
        await request.delete(`/api/sessions/${session.id}`);
    }
    for (const id of projectIds) await request.delete(`/api/projects/${id}?sessions=delete`);
    rmSync(directory, { recursive: true, force: true });
  }
});
