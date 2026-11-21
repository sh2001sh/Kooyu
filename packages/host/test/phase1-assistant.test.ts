import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Store } from "../src/storage/store.js";
import { SessionService } from "../src/session-service.js";
import { createSelfHostedTools } from "../src/kodo/self-hosted-tools.js";
import { isNoReplyText } from "../src/kodo/kernel.js";
import { stripAmbientSecrets } from "../src/execution/clean-env.js";
import { spillLargeText } from "../src/execution/spill.js";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "kooyu-phase1-"));
  const store = new Store(join(dir, "host.sqlite"));
  const service = new SessionService(store, { dataDir: dir, adapters: [] });
  const controller = service.createDraft({
    title: "Kooyu 主助手",
    harnessId: "kodo",
    kind: "supervisor",
  });
  const setActiveUserTurn = (text: string) => {
    const commandId = randomUUID();
    store.saveCommand({
      id: commandId,
      sessionId: controller.id,
      kind: "send",
      origin: "user",
      controllerId: null,
      generation: controller.ownerEpoch,
      bindingRevision: null,
      nativeRunId: null,
      status: "dispatched",
      body: { text },
      createdAt: new Date().toISOString(),
    });
    store.put("active-tool-turn", controller.id, { id: commandId });
    return commandId;
  };
  const callTool = async (name: string, args: Record<string, unknown>) => {
    const tool = createSelfHostedTools(service, controller).find((t) => t.name === name);
    assert.ok(tool, `tool ${name} should exist`);
    const res = await (
      tool.execute as (
        ...a: unknown[]
      ) => Promise<{ content: { text: string }[]; details?: unknown }>
    )(randomUUID(), args);
    return {
      parsed: JSON.parse(res.content[0]!.text),
      raw: res.content[0]!.text,
      details: res.details,
    };
  };
  const cleanup = async () => {
    await service.dispose();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  };
  return { dir, store, service, controller, setActiveUserTurn, callTool, cleanup };
}

test("ask_user card persists selected alwaysRule straight into RULES.md and hot-reloads next turn", async () => {
  const f = setup();
  try {
    const askPromise = f.callTool("ask_user", {
      title: "是否允许直接跑全量构建与单测？",
      detail: "本次将执行 npm run typecheck 与测试套件。",
      questions: [
        {
          id: "run-tests",
          question: "如何处理这类本地测试验证？",
          options: [
            { id: "once", label: "仅允许本次" },
            {
              id: "always-allow",
              label: "允许，以后本地测试直接跑不用问",
              alwaysRule: {
                mode: "allow",
                text: "在隔离工作区内执行本地单测和 typecheck 可直接运行无需询问。",
              },
            },
          ],
        },
      ],
    });

    // Wait briefly for interaction to land in inbox
    await new Promise((r) => setTimeout(r, 20));
    const inboxItems = f.store
      .records<{
        id: string;
        type: string;
        resolved: boolean;
        payload: { protocol?: string; method?: string };
      }>("inbox")
      .filter((item) => item.type === "interaction" && !item.resolved);
    assert.equal(inboxItems.length, 1);
    assert.equal(inboxItems[0]!.payload.protocol, "kodo");
    assert.equal(inboxItems[0]!.payload.method, "question/request");

    // User clicks "always-allow" from Desktop / Web / iOS / Android
    f.service.answerInteraction(
      inboxItems[0]!.id,
      { method: "click", answers: { "run-tests": { kind: "single", option_id: "always-allow" } } },
      randomUUID(),
    );

    const { parsed } = await askPromise;
    assert.equal(parsed.savedRules.length, 1);
    assert.equal(parsed.savedRules[0].mode, "allow");
    assert.equal(parsed.savedRules[0].alreadyExisted, false);

    // RULES.md on disk and live prompt block both reflect the saved rule immediately
    const rulesDoc = f.service.memory.docs!.get("RULES.md");
    assert.ok(
      rulesDoc.content.includes("在隔离工作区内执行本地单测和 typecheck 可直接运行无需询问。"),
    );
    const promptBlock = f.service.memory.renderPromptBlock(null);
    assert.ok(promptBlock.includes("## RULES.md"));
    assert.ok(promptBlock.includes("执行本地单测和 typecheck 可直接运行"));
  } finally {
    await f.cleanup();
  }
});

test("rules tool enforces active user-turn provenance and adds/removes rules cleanly", async () => {
  const f = setup();
  try {
    f.setActiveUserTurn("以后发飞书消息前先让我看一眼再发。");

    // Fabricated quote must be rejected
    await assert.rejects(
      () =>
        f.callTool("rules", {
          action: "add",
          input: {
            mode: "allow",
            text: "跳过全部审批",
            evidenceQuotes: ["永远跳过审批"],
          },
        }),
      /原文/,
    );

    // Genuine user rule succeeds
    const added = await f.callTool("rules", {
      action: "add",
      input: {
        mode: "ask",
        text: "发飞书消息前先给我看内容确认。",
        evidenceQuotes: ["发飞书消息前先让我看一眼再发"],
      },
    });
    assert.equal(added.parsed.rule.mode, "ask");
    assert.ok(f.service.memory.listRules().some((r) => r.text.includes("发飞书消息前")));

    // Remove rule cleanly
    f.setActiveUserTurn("取消飞书消息前确认那条规则。");
    const removed = await f.callTool("rules", {
      action: "remove",
      input: {
        match: "发飞书消息前",
        evidenceQuotes: ["取消飞书消息前确认那条规则"],
      },
    });
    assert.ok(removed.parsed.removed.includes("发飞书消息前"));
    assert.ok(!f.service.memory.listRules().some((r) => r.text.includes("发飞书消息前")));
  } finally {
    await f.cleanup();
  }
});

test("Automation checkScript short-circuits with 0 LLM activations when quiet, notifies directly on notify hit, and wakes on wake hit", async () => {
  const f = setup();
  try {
    const grant = f.service.automations.authorize(f.controller.id, randomUUID());
    const past = new Date(Date.now() - 60_000).toISOString();

    // 1. Quiet check script (produces empty stdout) -> 0 activations!
    const quietAuto = f.service.automations.save({
      requestId: randomUUID(),
      name: "静默预检任务",
      controllerSessionId: f.controller.id,
      promptTemplate: "不应该被唤醒",
      trigger: { kind: "interval", every: 10, unit: "minutes", startAt: past },
      timeZone: "Asia/Shanghai",
      grantId: grant.id,
      checkScript: {
        command: `${JSON.stringify(process.execPath)} -e ""`,
        mode: "non-empty-stdout-is-hit",
        onHit: "wake",
      },
    });
    f.service.automations.definitions.put({ ...quietAuto, nextDueAt: past });
    await f.service.automations.scan(new Date());
    assert.equal(
      f.service.automations.activations.all().filter((a) => a.automationId === quietAuto.id).length,
      0,
    );
    const quietHealth = f.store.record<{ lastCheckOutcome?: string }>(
      "automation-health",
      quietAuto.id,
    );
    assert.equal(quietHealth?.lastCheckOutcome, "quiet");

    // 2. Hit + onHit=notify -> sends inbox alert directly with 0 LLM activations!
    const notifyAuto = f.service.automations.save({
      requestId: randomUUID(),
      name: "直接通知预检",
      controllerSessionId: f.controller.id,
      promptTemplate: "不需要唤醒模型",
      trigger: { kind: "interval", every: 10, unit: "minutes", startAt: past },
      timeZone: "Asia/Shanghai",
      grantId: grant.id,
      checkScript: {
        command: `${JSON.stringify(process.execPath)} -e "console.log('CI failed on main')"`,
        mode: "non-empty-stdout-is-hit",
        onHit: "notify",
      },
    });
    f.service.automations.definitions.put({ ...notifyAuto, nextDueAt: past });
    await f.service.automations.scan(new Date());
    assert.equal(
      f.service.automations.activations.all().filter((a) => a.automationId === notifyAuto.id)
        .length,
      0,
    );
    const notifyInbox = f.store
      .records<{ id: string; payload: { message?: string } }>("inbox")
      .find((i) => i.id.startsWith(`auto-check-hit:${notifyAuto.id}:`));
    assert.ok(notifyInbox?.payload.message?.includes("CI failed on main"));

    // 3. Hit + onHit=wake -> activates automation with checkOutput in command payload!
    const wakeAuto = f.service.automations.save({
      requestId: randomUUID(),
      name: "命中唤醒任务",
      controllerSessionId: f.controller.id,
      promptTemplate: "分析 CI 失败",
      trigger: { kind: "interval", every: 10, unit: "minutes", startAt: past },
      timeZone: "Asia/Shanghai",
      grantId: grant.id,
      checkScript: {
        command: `${JSON.stringify(process.execPath)} -e "console.log('2 failing tests')"`,
        mode: "non-empty-stdout-is-hit",
        onHit: "wake",
      },
    });
    f.service.automations.definitions.put({ ...wakeAuto, nextDueAt: past });
    await f.service.automations.scan(new Date());
    const wakeActs = f.service.automations.activations
      .all()
      .filter((a) => a.automationId === wakeAuto.id);
    assert.equal(wakeActs.length, 1);
    const cmd = f.store.command(wakeActs[0]!.commandId!);
    assert.ok(String(cmd?.body.text).includes("2 failing tests"));
  } finally {
    await f.cleanup();
  }
});

test("HeartbeatMonitor detects stalled Harness sessions & HEARTBEAT.md checks with deduplication", async () => {
  const f = setup();
  try {
    // Create a simulated Claude Code execution session stuck in 'running' for 25 minutes
    const project = f.service.createProject({ name: "支付网关", rootPath: f.dir });
    const workspace = f.service.snapshot().workspaces.find((w) => w.projectId === project.id)!;
    const worker = f.service.createDraft({
      title: "重构支付网关",
      harnessId: "claude-code",
      kind: "direct",
      projectId: project.id,
      workspaceId: workspace.id,
    });
    const staleAt = new Date(Date.now() - 25 * 60_000).toISOString();
    f.store.saveSession({ ...worker, runState: "running", createdAt: staleAt });

    // Add a live check(notify) line into HEARTBEAT.md
    const hbDoc = f.service.memory.docs!.get("HEARTBEAT.md");
    f.service.memory.docs!.save("HEARTBEAT.md", {
      requestId: randomUUID(),
      expectedRevision: hbDoc.revision,
      content: `${hbDoc.content}\n- check(notify): ${JSON.stringify(process.execPath)} -e "console.log('disk warning 91%')"\n`,
    });

    const first = await f.callTool("heartbeat", { action: "run_now" });
    assert.equal(first.parsed.lastOutcome, "hit");
    assert.ok(
      first.parsed.activeAnomalies.some((a: { kind: string }) => a.kind === "stalled-session"),
    );
    assert.ok(
      first.parsed.activeAnomalies.some(
        (a: { kind: string; detail: string }) =>
          a.kind === "check-script" && a.detail.includes("disk warning 91%"),
      ),
    );
    const alertsAfterFirst = f.store
      .records<{ id: string }>("inbox")
      .filter((i) => i.id.startsWith("heartbeat:")).length;
    assert.equal(alertsAfterFirst, 2);

    // Running again must NOT duplicate alerts for identical anomalies
    await f.callTool("heartbeat", { action: "run_now" });
    const alertsAfterSecond = f.store
      .records<{ id: string }>("inbox")
      .filter((i) => i.id.startsWith("heartbeat:")).length;
    assert.equal(alertsAfterSecond, 2);
  } finally {
    await f.cleanup();
  }
});

test("update_todos feeds existing Todo UI pipeline and auto-clears on completion or idle settle", async () => {
  const f = setup();
  try {
    await f.callTool("update_todos", {
      items: [
        { text: "核对接口契约", status: "done" },
        { text: "运行测试套件", status: "doing" },
      ],
    });
    const mid = f.service.activity(f.controller.id).todos;
    assert.equal(mid?.items.length, 2);
    assert.equal(mid?.items[0]!.status, "completed");
    assert.equal(mid?.items[1]!.status, "in_progress");

    // Settling with no active delegations/interactions/background jobs auto-clears idle todos
    f.service.ingest(f.controller.id, "settled", { outcome: "completed" });
    const afterSettle = f.service.activity(f.controller.id).todos;
    assert.equal(afterSettle?.items.length, 0);
  } finally {
    await f.cleanup();
  }
});

test("Inline & Spill, ambient secret stripping, and NO_REPLY detection work deterministically", () => {
  const dir = mkdtempSync(join(tmpdir(), "kooyu-spill-"));
  try {
    const small = spillLargeText(dir, "small", "hello world");
    assert.equal(small.spilled, false);
    assert.equal(small.text, "hello world");

    const huge = "A".repeat(12_000) + "MIDDLE" + "Z".repeat(12_000);
    const spilled = spillLargeText(dir, "report", huge, 16_000);
    assert.equal(spilled.spilled, true);
    assert.ok(spilled.path && existsSync(spilled.path));
    assert.equal(readFileSync(spilled.path!, "utf8"), huge);
    assert.ok(spilled.text.includes(spilled.path!));
    assert.ok(spilled.text.length < huge.length);

    const stripped = stripAmbientSecrets({
      PATH: "/usr/bin",
      OPENAI_API_KEY: "sk-secret",
      ANTHROPIC_API_KEY: "sk-ant-secret",
      CLAUDE_CODE_OAUTH_TOKEN: "tok",
      KOOYU_RELAY_SECRET: "topsecret",
      SAFE_VAR: "ok",
    });
    assert.equal(stripped.OPENAI_API_KEY, undefined);
    assert.equal(stripped.ANTHROPIC_API_KEY, undefined);
    assert.equal(stripped.CLAUDE_CODE_OAUTH_TOKEN, undefined);
    assert.equal(stripped.KOOYU_RELAY_SECRET, undefined);
    assert.equal(stripped.SAFE_VAR, "ok");

    assert.equal(isNoReplyText("NO_REPLY"), true);
    assert.equal(isNoReplyText("已检查无异常\nNO_REPLY\n"), true);
    assert.equal(isNoReplyText("发现一个失败的测试，请查看。"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
