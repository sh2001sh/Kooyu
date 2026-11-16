import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Store } from "../src/storage/store.js";
import { SessionService } from "../src/session-service.js";
import { createHostServer } from "../src/http/server.js";
import { parsePorcelain } from "../src/goals/workspace.js";

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "kooyu-goal-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", dir, ...args], { stdio: "pipe", windowsHide: true });
  git("init", "-q");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Kooyu Test");
  git("config", "core.autocrlf", "false");
  writeFileSync(join(dir, "a.txt"), "one\n");
  writeFileSync(join(dir, "c.txt"), "stable\n");
  git("add", ".");
  git("commit", "-q", "-m", "init");
  return dir;
}

function setup(dir: string) {
  const store = new Store(":memory:");
  const service = new SessionService(store, { dataDir: dir, adapters: [] });
  const project = service.createProject({ name: "研究", rootPath: dir });
  const workspace = service.snapshot().workspaces.find((w) => w.projectId === project.id)!;
  const controller = service.createDraft({
    title: "Kooyu",
    harnessId: "kodo",
    kind: "supervisor",
    projectId: project.id,
    workspaceId: workspace.id,
  });
  const worker = service.createDraft({
    title: "Codex",
    harnessId: "codex",
    kind: "direct",
    projectId: project.id,
    workspaceId: workspace.id,
  });
  return { store, service, project, workspace, controller, worker };
}

test("porcelain parsing keeps literal paths and skips rename sources", () => {
  assert.deepEqual(parsePorcelain(" M a b.txt\0R  new.txt\0old.txt\0?? 中文.md\0"), [
    { path: "a b.txt", status: "M" },
    { path: "new.txt", status: "R" },
    { path: "中文.md", status: "??" },
  ]);
});

test("a model report never completes a goal; only Host checks make it passed and the user accepts", async () => {
  const dir = repo();
  const { store, service, controller, worker, workspace } = setup(dir);
  try {
    const goal = await service.goals.create(
      {
        requestId: randomUUID(),
        controllerSessionId: controller.id,
        title: "整理报告",
        acceptanceCriteria: ["生成 report.md"],
        sessionIds: [worker.id],
      },
      "user",
    );
    assert.equal(goal.status, "active");
    assert.deepEqual(goal.workspaceIds, [workspace.id]);
    assert.equal(goal.baselines[0]!.git, true);

    // The model's own review is evidence but not a verification fact.
    await service.goals.recordVerification(
      goal.id,
      { requestId: randomUUID(), kind: "review", method: "读过报告", outcome: "passed" },
      "model",
      controller.id,
    );
    assert.equal(service.goals.get(goal.id).verificationStatus, "unverified");

    writeFileSync(join(dir, "report.md"), "# 报告\n");
    const check = await service.goals.runCheck(
      goal.id,
      {
        requestId: randomUUID(),
        command: `node -e "process.exit(require('fs').existsSync('report.md')?0:3)"`,
        hashFiles: ["report.md", "../escape.txt"],
      },
      "model",
      controller.id,
    );
    assert.equal(check.recordedBy, "host");
    assert.equal(check.exitCode, 0);
    assert.equal(check.outcome, "passed");
    assert.match(check.fileHashes![0]!.sha256!, /^[0-9a-f]{64}$/);
    assert.equal(check.fileHashes![1]!.sha256, null);
    assert.equal(service.goals.get(goal.id).verificationStatus, "passed");

    const failing = await service.goals.runCheck(
      goal.id,
      { requestId: randomUUID(), kind: "test", command: `node -e "process.exit(2)"` },
      "model",
      controller.id,
    );
    assert.equal(failing.outcome, "failed");
    assert.equal(failing.exitCode, 2);
    assert.equal(service.goals.get(goal.id).verificationStatus, "failed");

    const submitted = await service.goals.complete(
      goal.id,
      {
        requestId: randomUUID(),
        expectedRevision: service.goals.get(goal.id).revision,
        summary: "报告已生成",
        deliverables: ["report.md"],
      },
      "model",
      controller.id,
    );
    assert.equal(submitted.status, "awaiting-review");
    assert.deepEqual(
      submitted.result!.changes![0]!.changes.map((c) => [c.path, c.attribution]),
      [["report.md", "introduced"]],
    );

    // A user may accept an unverified/failed result; the acceptance records that fact.
    const accepted = await service.goals.review(goal.id, {
      requestId: randomUUID(),
      expectedRevision: submitted.revision,
      decision: "accept",
      remainingUncertainty: "测试失败项未修复",
    });
    assert.equal(accepted.status, "completed");
    assert.equal(accepted.acceptedBy!.verificationStatus, "failed");
    await assert.rejects(
      service.goals.update(
        goal.id,
        { requestId: randomUUID(), expectedRevision: accepted.revision, title: "x" },
        "user",
      ),
      /已结束/,
    );
    const kinds = service.feed.list(0).items.map((i) => i.kind);
    assert.deepEqual(kinds, ["goal-awaiting-review", "goal-completed"]);
    assert.ok(service.goals.history(goal.id).length >= 6);
    assert.ok(store.events(controller.id).some((e) => e.type === "supervision"));
  } finally {
    await service.dispose();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("baseline keeps pre-existing edits out of the goal's change report", async () => {
  const dir = repo();
  const { store, service, controller } = setup(dir);
  try {
    writeFileSync(join(dir, "a.txt"), "user edit\n");
    writeFileSync(join(dir, "keep.txt"), "untracked before\n");
    const goal = await service.goals.create(
      { requestId: randomUUID(), controllerSessionId: controller.id, title: "修改" },
      "user",
    );
    assert.deepEqual(goal.baselines[0]!.dirty.map((d) => d.path).sort(), ["a.txt", "keep.txt"]);
    writeFileSync(join(dir, "a.txt"), "user edit\nagent edit\n");
    writeFileSync(join(dir, "b.txt"), "new\n");
    writeFileSync(join(dir, "c.txt"), "changed\n");
    const done = await service.goals.complete(
      goal.id,
      { requestId: randomUUID(), expectedRevision: goal.revision, summary: "完成" },
      "user",
    );
    const report = done.result!.changes![0]!;
    assert.deepEqual(
      report.changes.map((c) => [c.path, c.attribution]),
      [
        ["a.txt", "preexisting-modified"],
        ["b.txt", "introduced"],
        ["c.txt", "introduced"],
      ],
    );
    assert.equal(report.preexistingUnchanged, 1);
    assert.match(report.coverage, /归属未知/);
  } finally {
    await service.dispose();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("goal requests are idempotent, revisions are compare-and-set, and model scope needs a grant", async () => {
  const dir = repo();
  const { store, service, controller, worker } = setup(dir);
  try {
    const requestId = randomUUID();
    const input = { requestId, controllerSessionId: controller.id, title: "一次" };
    const first = await service.goals.create(input, "user");
    const again = await service.goals.create(input, "user");
    assert.equal(again.id, first.id);
    await assert.rejects(
      service.goals.create({ ...input, title: "不同" }, "user"),
      /不同的目标操作/,
    );
    await assert.rejects(
      service.goals.update(
        first.id,
        { requestId: randomUUID(), expectedRevision: first.revision + 5, title: "旧" },
        "user",
      ),
      /已被修改/,
    );
    await assert.rejects(
      service.goals.create(
        {
          requestId: randomUUID(),
          controllerSessionId: controller.id,
          title: "越权",
          sessionIds: [worker.id],
        },
        "model",
      ),
      /管理范围/,
    );
    service.grantTarget(controller.id, worker.id);
    const linked = await service.goals.update(
      first.id,
      { requestId: randomUUID(), expectedRevision: first.revision, addSessionIds: [worker.id] },
      "model",
      controller.id,
    );
    assert.deepEqual(linked.sessionIds, [worker.id]);
    const blocked = await service.goals.update(
      first.id,
      {
        requestId: randomUUID(),
        expectedRevision: linked.revision,
        status: "blocked",
        blockedReason: "需要 API key",
      },
      "model",
      controller.id,
    );
    assert.equal(blocked.status, "blocked");
    assert.equal(service.feed.list(0).items.at(-1)!.kind, "goal-blocked");
    // A changed scope invalidates earlier checks.
    const check = await service.goals.runCheck(
      first.id,
      { requestId: randomUUID(), command: "node -e 0" },
      "user",
    );
    assert.equal(service.goals.get(first.id).verificationStatus, "passed");
    const rescoped = await service.goals.update(
      first.id,
      {
        requestId: randomUUID(),
        expectedRevision: service.goals.get(first.id).revision,
        acceptanceCriteria: ["新的标准"],
        status: "active",
      },
      "user",
    );
    assert.equal(rescoped.scopeRevision, 2);
    assert.equal(rescoped.verificationStatus, "unverified");
    assert.equal(check.scopeRevision, 1);
  } finally {
    await service.dispose();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a check interrupted before its result was stored is reported unknown, not re-run", async () => {
  const dir = repo();
  const { store, service, controller } = setup(dir);
  try {
    const goal = await service.goals.create(
      { requestId: randomUUID(), controllerSessionId: controller.id, title: "检查" },
      "user",
    );
    const requestId = randomUUID();
    const input = { requestId, command: "node -e 0" };
    // Simulate a crash after the intent was written but before the result was stored.
    const parsed = {
      requestId,
      kind: "command",
      command: "node -e 0",
      timeoutSeconds: 300,
      hashFiles: [],
    };
    store.put("goal-check-intent", `check:${goal.id}:${requestId}`, {
      fingerprint: JSON.stringify(parsed),
      state: "running",
    });
    await assert.rejects(service.goals.runCheck(goal.id, input, "user"), /结果未知/);
    assert.equal(service.goals.verifications(goal.id).length, 0);
  } finally {
    await service.dispose();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cancelling a goal freezes its supervision before any stop request", async () => {
  const dir = repo();
  const { store, service, controller, worker } = setup(dir);
  try {
    const goal = await service.goals.create(
      {
        requestId: randomUUID(),
        controllerSessionId: controller.id,
        title: "取消",
        sessionIds: [worker.id],
      },
      "user",
    );
    const watch = service.watch({
      controllerSessionId: controller.id,
      targetSessionId: worker.id,
      mode: "observe",
      goalId: goal.id,
    });
    assert.equal(watch.goalId, goal.id);
    const cancelled = await service.goals.review(goal.id, {
      requestId: randomUUID(),
      expectedRevision: goal.revision,
      decision: "cancel",
      stopSessions: true,
    });
    assert.equal(cancelled.status, "cancelled");
    assert.equal(store.watches().find((w) => w.id === watch.id)!.state, "paused");
  } finally {
    await service.dispose();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("notifications keep a monotonic cursor, stay separate from inbox handling and reset after retention", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kooyu-notify-"));
  const store = new Store(":memory:");
  const service = new SessionService(store, { dataDir: dir, adapters: [] });
  try {
    const session = service.createDraft({ title: "Codex", harnessId: "codex", kind: "direct" });
    const inbox = (service as any).inbox.bind(service);
    inbox("q1", session.id, "interaction", { protocol: "claude", input: { questions: [{}] } });
    inbox("a1", session.id, "interaction", {
      protocol: "codex",
      method: "item/commandExecution/requestApproval",
    });
    inbox("a1", session.id, "interaction", { protocol: "codex" }); // replay: no new fact
    inbox("e1", session.id, "error", { message: "x" }); // ordinary error: activity log only
    inbox("l1", session.id, "limit", { reason: "budget" });
    const page = service.feed.list(0);
    assert.deepEqual(
      page.items.map((i) => i.kind),
      ["question", "approval-required", "limit-paused"],
    );
    assert.ok(page.items.every((i, n) => n === 0 || i.sequence > page.items[n - 1]!.sequence));
    assert.equal(page.items[1]!.inboxItemId, "a1");
    assert.doesNotMatch(page.items[1]!.title, /requestApproval/);
    assert.deepEqual(service.feed.list(page.cursor).items, []);
    service.feed.markRead(page.items[0]!.id);
    assert.equal(store.record<any>("inbox", "q1").resolved, false);
    assert.equal(service.feed.collect(Date.now() + 40 * 86400000), 1);
    const reset = service.feed.list(0);
    assert.equal(reset.resetRequired, true);
    assert.deepEqual(
      reset.items.map((i) => i.kind),
      ["approval-required", "limit-paused"],
    );
    assert.equal(service.feed.list(reset.cursor).resetRequired, false);
  } finally {
    await service.dispose();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("goal and notification routes enforce local-only command execution", async () => {
  const dir = repo();
  const { store, service, controller } = setup(dir);
  const options = { port: 0, webRoot: dir, forceRemote: false };
  const server = createHostServer(service, options);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  options.port = (server.address() as { port: number }).port;
  const origin = `http://127.0.0.1:${options.port}`;
  const post = (path: string, body: unknown) =>
    fetch(origin + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    const created = await post("/api/goals", {
      requestId: randomUUID(),
      controllerSessionId: controller.id,
      title: "HTTP 目标",
    });
    assert.equal(created.status, 201);
    const goal = await created.json();
    const listed = await (
      await fetch(`${origin}/api/goals?controllerSessionId=${controller.id}`)
    ).json();
    assert.equal(listed[0].id, goal.id);
    const check = await post(`/api/goals/${goal.id}/checks`, {
      requestId: randomUUID(),
      command: "node -e 0",
    });
    assert.equal(check.status, 201);
    const detail = await (await fetch(`${origin}/api/goals/${goal.id}`)).json();
    assert.equal(detail.goal.verificationStatus, "passed");
    const review = await post(`/api/goals/${goal.id}/review`, {
      requestId: randomUUID(),
      expectedRevision: detail.goal.revision,
      decision: "request-changes",
      note: "还没提交",
    });
    assert.equal(review.status, 409);
    const notifications = await (await fetch(`${origin}/api/notifications?after=0`)).json();
    assert.equal(notifications.resetRequired, false);
    assert.equal((await fetch(`${origin}/api/web/search-config`)).status, 200);
    assert.equal((await fetch(`${origin}/api/goals/not-a-uuid`)).status, 400);
  } finally {
    server.closeAllConnections();
    server.close();
    await service.dispose();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
