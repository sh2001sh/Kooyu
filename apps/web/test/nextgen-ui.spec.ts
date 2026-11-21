import { test, expect } from "@playwright/test";

test("DraftWorkspace shows 4 playbook capsules and populates supervisor composer", async ({
  page,
}) => {
  await page.goto("/");
  const capsules = page.locator(".playbook-capsule");
  await expect(capsules).toHaveCount(4);
  await expect(page.getByRole("button", { name: "实现与审查" })).toBeVisible();
  await expect(page.getByRole("button", { name: "并行分工" })).toBeVisible();
  await expect(page.getByRole("button", { name: "修 CI / 单测守护" })).toBeVisible();
  await expect(page.getByRole("button", { name: "深度联网调研" })).toBeVisible();

  await page.getByRole("button", { name: "修 CI / 单测守护" }).click();
  await expect(page.locator("textarea[aria-label='消息']")).toContainText("测试与 lint");
});

test("Delegation live card renders cleanly on supervisor while direct session puts escalation in header", async ({
  page,
  request,
}) => {
  const supervisor = await (
    await request.post("/api/sessions", {
      data: { title: "主控编排测试", harnessId: "kodo", kind: "supervisor" },
    })
  ).json();
  await request.post("/api/sessions", {
    data: { title: "独立直聊测试", harnessId: "codex", kind: "direct" },
  });
  const delegatedWorker = await (
    await request.post("/api/sessions", {
      data: { title: "受管子会话", harnessId: "codex", kind: "direct" },
    })
  ).json();

  const ticket = {
    id: "11111111-1111-4111-8111-111111111111",
    batchId: null,
    controllerSessionId: supervisor.id,
    workerSessionId: delegatedWorker.id,
    watchId: "22222222-2222-4222-8222-222222222222",
    goalId: null,
    title: "实现支付模块与单测",
    harnessId: "codex",
    status: "running",
    waitPolicy: "all",
    mandate: {
      prompt: "Implement payments",
      worktreeBranch: "kooyu/payments-fix",
      writePolicy: "worktree-isolated",
      limits: {},
    },
    provisioningStep: "dispatched",
    report: {
      ticketId: "11111111-1111-4111-8111-111111111111",
      workerSessionId: delegatedWorker.id,
      status: "running",
      generatedAt: new Date().toISOString(),
      gitFacts: {
        branch: "kooyu/payments-fix",
        headCommit: "abc1234",
        dirtyFiles: ["src/pay.ts"],
        diffStat: { filesChanged: 3, insertions: 42, deletions: 7 },
      },
      hostVerifications: [{ name: "unit-tests", passed: true, summary: "ok" }],
      workerClaim: {
        trust: "unverified-worker-claim",
        replyExcerpt: "已完成支付接口并补充单元测试。",
      },
    },
    lastError: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await page.route("**/api/snapshot", async (route) => {
    const response = await route.fetch();
    const snapshot = await response.json();
    snapshot.delegationTickets = [ticket];
    await route.fulfill({ json: snapshot });
  });

  await page.goto("/");
  // Open standalone direct session -> escalation button is in header, NOT inside transcript canvas
  await page.getByText("独立直聊测试").first().click();
  await expect(page.locator("header .nx-btn", { hasText: "转交 Kooyu 主控" })).toBeVisible();
  await expect(page.locator(".transcript .delegation-dock")).toHaveCount(0);

  // Open supervisor session -> styled live delegation card with diff stats & Host verification
  await page.getByText("主控编排测试").first().click();
  const card = page.locator(".delegation-card").first();
  await expect(card).toBeVisible();
  await expect(card).toContainText("实现支付模块与单测");
  await expect(card).toContainText("kooyu/payments-fix");
  await expect(card).toContainText("+42");
  await expect(card).toContainText("-7");
  await expect(card).toContainText("Host 1/1");
  await expect(card.getByRole("button", { name: "下钻直聊" })).toBeVisible();
  await expect(card.getByRole("button", { name: "审阅改动" })).toBeVisible();
});

test("Inbox renders one-click approve button for intake-proposal items", async ({
  page,
  request,
}) => {
  const supervisor = await (
    await request.post("/api/sessions", {
      data: { title: "收件箱接入测试", harnessId: "kodo", kind: "supervisor" },
    })
  ).json();
  const eventId = "33333333-3333-4333-8333-333333333333";
  let approvedCalled = false;

  await page.route("**/api/snapshot", async (route) => {
    const response = await route.fetch();
    const snapshot = await response.json();
    snapshot.inbox = [
      {
        id: "intake:" + eventId,
        sessionId: supervisor.id,
        type: "notification",
        resolved: false,
        createdAt: new Date().toISOString(),
        payload: {
          type: "intake-proposal",
          intakeEventId: eventId,
          sourceKind: "telegram",
          summary: "请运行夜间回归测试",
        },
      },
    ];
    await route.fulfill({ json: snapshot });
  });
  await page.route(`**/api/intake/${eventId}/approve`, async (route) => {
    approvedCalled = true;
    await route.fulfill({ json: { id: eventId, commandId: "cmd-1", alreadyApproved: false } });
  });

  await page.goto("/");
  await page
    .getByRole("button", { name: /待处理|收件箱|Inbox/ })
    .first()
    .click();
  const approveBtn = page.getByRole("button", { name: "批准并派发执行" });
  await expect(approveBtn).toBeVisible();
  await approveBtn.click();
  expect(approvedCalled).toBe(true);
});
