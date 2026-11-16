import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("Kooyu main conversation shows the current goal, its deliverable and accepts it", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const session = await (
    await request.post("/api/sessions", {
      data: { title: "目标验收主对话", harnessId: "kodo", kind: "supervisor" },
    })
  ).json();
  const goal = await (
    await request.post("/api/goals", {
      data: {
        requestId: randomUUID(),
        controllerSessionId: session.id,
        title: "整理本周资料周报",
        acceptanceCriteria: ["每条结论附来源"],
      },
    })
  ).json();
  const artifact = await request.post("/api/artifacts", {
    data: {
      requestId: randomUUID(),
      title: "本周周报",
      goalId: goal.id,
      content: "# 周报\n\n- 结论 A（来源：https://example.com）\n",
      displayName: "weekly.md",
    },
  });
  expect(artifact.status()).toBe(201);
  const latest = (await (await request.get(`/api/goals/${goal.id}`)).json()).goal;
  const submitted = await request.post(`/api/goals/${goal.id}/complete`, {
    data: {
      requestId: randomUUID(),
      expectedRevision: latest.revision,
      summary: "周报已生成，结论均附来源。",
      deliverables: ["weekly.md"],
      limitations: ["未核对付费墙内文章"],
    },
  });
  expect(submitted.ok()).toBe(true);

  await page.addInitScript((id) => localStorage.setItem("kodo.session", id), session.id);
  await page.goto("/");
  const pill = page.getByRole("button", { name: /整理本周资料周报.*待验收/ });
  await expect(pill).toBeVisible();
  await pill.click();
  await expect(page.getByRole("tab", { name: "目标" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("周报已生成，结论均附来源。")).toBeVisible();
  await expect(page.getByText("未核对付费墙内文章")).toBeVisible();
  await expect(page.getByText("weekly.md · v1", { exact: false })).toBeVisible();
  await expect(page.getByLabel("下载 weekly.md")).toHaveAttribute(
    "href",
    /\/files\/.+\/content\?download=1$/,
  );
  await expect(page.getByText(/当前验证状态为“未验证”/)).toBeVisible();
  await page.getByRole("button", { name: "要求修改" }).isDisabled();
  await page.getByLabel("修改意见或保留的不确定事项").fill("付费墙文章后续补充");
  await page.getByRole("button", { name: "接受结果" }).click();
  await expect(page.getByText("已结束 1")).toBeVisible();
  const accepted = (await (await request.get(`/api/goals/${goal.id}`)).json()).goal;
  expect(accepted.status).toBe("completed");
  expect(accepted.acceptedBy.verificationStatus).toBe("unverified");
  expect(accepted.acceptedBy.remainingUncertainty).toBe("付费墙文章后续补充");
  await expect(pill).toHaveCount(0);
  expect(errors).toEqual([]);
});
