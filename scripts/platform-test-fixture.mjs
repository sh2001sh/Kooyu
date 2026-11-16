// Isolated visual QA Host. No model inference or native history import.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { Store } from "../packages/host/dist/storage/store.js";
import { SessionService } from "../packages/host/dist/session-service.js";
import { adapters } from "../packages/host/dist/harnesses/registry.js";
import { createHostServer } from "../packages/host/dist/http/server.js";
import { Pairing } from "../packages/host/dist/devices/pairing.js";
import { RelayConnector } from "../packages/host/dist/devices/relay.js";

const root = resolve(process.env.KOOYU_QA_DIR ?? `.local/verification/platform-${Date.now()}`);
mkdirSync(root, { recursive: true });
const workspace = join(root, "workspace");
mkdirSync(workspace, { recursive: true });
writeFileSync(
  join(workspace, "README.md"),
  "# 平台验收演示项目\n\n此处全部是隔离测试数据，没有连接收费模型。\n",
);
const secrets = new Map();
const vault = {
  get: async (k) => secrets.get(k) ?? null,
  set: async (k, v) => {
    secrets.set(k, v);
  },
  delete: async (k) => {
    secrets.delete(k);
  },
};
const store = new Store(join(root, "kodo.sqlite"));
// Explicit synthetic capability declarations for mobile model-setting regression tests.
const reasoningCatalog =
  process.env.KOOYU_REASONING_FIXTURE === "1"
    ? {
        codex: [
          {
            id: "qa-gpt-5",
            provider: "qa-openai",
            name: "Codex QA long model name for narrow screens",
            source: "discovered",
            isDefault: true,
            reasoning: ["low", "medium", "high"],
          },
          { id: "qa-no-effort", name: "No effort metadata", source: "discovered", reasoning: [] },
        ],
        "claude-code": [
          {
            id: "qa-opus",
            resolvedModel: "qa-claude-resolved",
            name: "Claude QA",
            source: "discovered",
            isDefault: true,
            reasoning: ["low", "high", "max"],
          },
        ],
        opencode: [
          {
            id: "qa-provider/qa-model",
            name: "OpenCode QA",
            source: "discovered",
            isDefault: true,
            reasoning: ["low", "high"],
          },
        ],
        gemini: [
          {
            id: "qa-gemini",
            name: "Gemini QA",
            source: "discovered",
            isDefault: true,
            reasoning: ["minimal", "low", "high"],
          },
        ],
        "kimi-code": [
          {
            id: "qa-kimi",
            name: "Kimi QA",
            source: "discovered",
            isDefault: true,
            reasoning: ["off", "high"],
          },
        ],
      }
    : {};
const service = new SessionService(store, {
  dataDir: root,
  providerVault: vault,
  ...(process.env.KOOYU_COMPOSER_FIXTURE === "1"
    ? {
        providerFetch: async () =>
          new Response(JSON.stringify({ data: [{ id: "gpt-5" }, { id: "gpt-5-mini" }] }), {
            headers: { "content-type": "application/json" },
          }),
      }
    : {}),
  adapters: adapters.map((a) => ({
    descriptor: a.descriptor,
    connect: async (session, ctx) => {
      if (process.env.KOOYU_SCHEDULE_FIXTURE === "1" && a.descriptor.id === "kodo") {
        return {
          nativeSessionId: session.nativeSessionId ?? randomUUID(),
          async send(text) {
            let message = "隔离测试：未调用真实模型。";
            if (text.includes("ScheduleQA")) {
              const tool = ctx.tools.find((t) => t.name === "automation");
              const response = await tool.execute(randomUUID(), {
                action: "create",
                input: {
                  name: "对话创建的每日检查",
                  promptTemplate: "检查项目状态，汇总待处理事项。",
                  timeZone: "Asia/Shanghai",
                  trigger: { kind: "calendar", frequency: "daily", time: "09:00" },
                  enabled: false,
                },
              });
              const plan = JSON.parse(response.content[0].text);
              message =
                "已创建定时任务「" +
                plan.name +
                "」，每天 09:00（Asia/Shanghai）。隔离测试任务保持暂停。";
            }
            ctx.emit("message", { role: "assistant", text: message });
            ctx.emit("turn-ended", {});
            ctx.emit("settled", {});
            return { nativeRunId: null };
          },
          async cancel() {},
          async close() {},
        };
      }
      if (process.env.KOOYU_MEMORY_FIXTURE === "1" && a.descriptor.id === "kodo") {
        return {
          nativeSessionId: session.nativeSessionId ?? randomUUID(),
          async send(text, commandId) {
            const context = ctx.memoryContext?.();
            const match = /^MemoryQA: remember (.+)$/.exec(text);
            let message = "隔离测试回合：未调用真实模型。";
            if (match && context?.settings.enabled) {
              const tool = ctx.tools.find((t) => t.name === "memory");
              const result = await tool.execute(randomUUID(), {
                action: "remember",
                input: { subject: match[1], content: match[1], evidenceQuotes: [match[1]] },
              });
              const entry = JSON.parse(result.content[0].text);
              message =
                entry.status === "confirmed" ? "已记住你的偏好。" : "已形成待确认的记忆建议。";
            }
            store.put("memory-qa-turn", commandId, { context, text, synthetic: true });
            ctx.emit("message", { role: "assistant", text: message });
            ctx.emit("turn-ended", {});
            ctx.emit("settled", {});
            return { nativeRunId: null };
          },
          async cancel() {},
          async close() {},
        };
      }
      throw new Error("Visual QA fixture does not execute models.");
    },
    standaloneList: async () => [],
    discoverModels: async () => reasoningCatalog[a.descriptor.id] ?? [],
  })),
});
// Keep every periodic history importer inert as well as the explicit fixture adapters.
service.syncNativeSessions = async () => ({ imported: 0, updated: 0, skipped: 0, errors: [] });
const project =
  service.snapshot().projects.find((p) => p.name === "平台验收演示项目") ??
  service.createProject({ name: "平台验收演示项目", rootPath: workspace });
const ws = service.snapshot().workspaces.find((w) => w.projectId === project.id);
const session =
  service.snapshot().sessions.find((s) => s.title === "平台验收主对话") ??
  service.createDraft({
    title: "平台验收主对话",
    harnessId: "kodo",
    kind: "supervisor",
    projectId: project.id,
    workspaceId: ws.id,
  });
const execution =
  service.snapshot().sessions.find((s) => s.title === "Android 与桌面互通验收") ??
  service.createDraft({
    title: "Android 与桌面互通验收",
    harnessId: "codex",
    kind: "direct",
    projectId: project.id,
    workspaceId: ws.id,
  });
if (process.env.KOOYU_COMPOSER_FIXTURE === "1") {
  const provider =
    store.records("provider").find((p) => p.name === "QA 模型来源") ??
    (await service.providers.saveProvider({
      name: "QA 模型来源",
      endpoints: [
        {
          name: "Fixture API",
          protocol: "openai-responses",
          baseUrl: "https://fixture.invalid/v1",
        },
      ],
    }));
  if (!service.snapshot().bindings?.some?.((b) => b.harnessId === "kodo")) {
    service.providers.saveProviderBinding({
      harnessId: "kodo",
      providerId: provider.id,
      endpointId: provider.endpoints[0].id,
      expectedDefaultsRevision: service.bindingDefaults().revision,
    });
  }
  if (!service.snapshot().sessions.some((s) => s.title === "全局项目管理主对话")) {
    service.createDraft({ title: "全局项目管理主对话", harnessId: "kodo", kind: "supervisor" });
  }
  const answerLog = [];
  const interaction = (owner, payload, label) => {
    service.remoteInteraction(owner.id, randomUUID(), payload).then((answer) => {
      answerLog.push({ label, answer });
      writeFileSync(join(root, "answers.json"), JSON.stringify(answerLog, null, 2));
    });
  };
  interaction(
    execution,
    {
      protocol: "codex",
      method: "item/tool/requestUserInput",
      params: {
        questions: [
          {
            id: "navigation",
            question: "首页应该如何组织？",
            options: [
              { label: "按项目分组", description: "项目与对话放在同一页" },
              { label: "平铺列表", description: "仅作为测试备选项" },
            ],
            isOther: true,
          },
        ],
      },
    },
    "codex-question",
  );
  interaction(
    session,
    {
      protocol: "kodo",
      method: "approval/request",
      params: { action: "新建项目", name: "Mobile approval demo", rootPath: workspace },
    },
    "project-approval",
  );
  const queued = service.acceptSend(execution.id, {
    requestId: randomUUID(),
    text: "排队消息示例：等待本次问题处理完成",
    mode: "queue",
  });
  writeFileSync(join(root, "queue.json"), JSON.stringify(queued));
}
const reasoningCases = [];
if (process.env.KOOYU_REASONING_FIXTURE === "1") {
  // Override only isolated fixture defaults, never read or modify a real harness configuration.
  const originalModels = service.harnessModels.bind(service);
  service.harnessModels = async (id, discover = false) => {
    const payload = await originalModels(id, discover);
    const first = reasoningCatalog[id]?.[0];
    return first
      ? {
          ...payload,
          defaultModel: {
            model: first.id,
            ...(first.provider ? { provider: first.provider } : {}),
          },
        }
      : payload;
  };
  for (const [harnessId, models] of Object.entries(reasoningCatalog)) {
    const item = service.createDraft({
      title: `Reasoning ${harnessId}`,
      harnessId,
      kind: "direct",
      projectId: project.id,
      workspaceId: ws.id,
      bindingId: null,
    });
    // Keep the default implicit: changing reasoning used to submit model:null and fail validation.
    store.put("session-current-model", item.id, {
      model:
        harnessId === "claude-code"
          ? "qa-claude-resolved"
          : models[0].provider
            ? `${models[0].provider}/${models[0].id}`
            : models[0].id,
    });
    reasoningCases.push({ id: item.id, harnessId, title: item.title, levels: models[0].reasoning });
  }
  writeFileSync(join(root, "reasoning-cases.json"), JSON.stringify(reasoningCases, null, 2));
}
const pairing = new Pairing(store);
if (
  process.env.KOOYU_WORKBENCH_FIXTURE === "1" &&
  !service.goals.list({ includeClosed: true }).length
) {
  let goal = await service.goals.create(
    {
      requestId: randomUUID(),
      controllerSessionId: session.id,
      title: "跨端工作台优化验收",
      description: "隔离测试数据：检查项目、过程与成果的完整导航。",
      workspaceIds: [ws.id],
      sessionIds: [execution.id],
      acceptanceCriteria: ["成果可预览并返回来源对话", "手机与桌面的工作状态一致"],
    },
    "user",
  );
  writeFileSync(
    join(workspace, "verification.md"),
    "# 跨端工作台验收\n\n这是隔离 UI 测试文件。\n\n- 项目分组\n- 成果与来源对话\n- 计划与运行记录\n\n未调用收费模型。\n",
  );
  await service.files.publish(
    {
      requestId: randomUUID(),
      goalId: goal.id,
      workspaceId: ws.id,
      path: "verification.md",
      title: "工作台验收说明",
    },
    "user",
  );
  goal = service.goals.get(goal.id);
  await service.goals.complete(
    goal.id,
    {
      requestId: randomUUID(),
      expectedRevision: goal.revision,
      summary: "隔离演示成果已准备，等待用户检查。",
      deliverables: ["verification.md"],
      limitations: ["演示数据不代表真实模型执行或检查通过。"],
    },
    "user",
  );
  const grant = service.permissions.create({
    requestId: randomUUID(),
    controllerSessionId: session.id,
    operations: ["automation.execute"],
    resources: [`session:${session.id}`],
  });
  service.automations.save({
    requestId: randomUUID(),
    name: "项目每日检查",
    controllerSessionId: session.id,
    promptTemplate: "检查项目状态，汇总待处理事项。",
    trigger: { kind: "cron", expression: "0 9 * * 1-5" },
    timeZone: "Asia/Shanghai",
    enabled: false,
    grantId: grant.id,
    limits: { maxRuns: 10 },
  });
  service.memory.save(
    {
      requestId: randomUUID(),
      scope: "project",
      projectId: project.id,
      subject: "交付约定",
      content: "交付时附实际验证结果，标明尚未验证的部分。",
      sourceRefs: ["user:fixture"],
      status: "confirmed",
    },
    "user",
  );
}
let relayKey;
// The test vault is memory-only; never reuse an identity whose private key expired.
const relayRoot = mkdtempSync(join(root, "relay-"));
const relay = new RelayConnector(relayRoot, undefined, false, {
  getPassword: () => relayKey ?? null,
  setPassword: (v) => {
    relayKey = v;
  },
});
const remote = createHostServer(service, {
  port: 0,
  webRoot: resolve("apps/web/dist"),
  pairing,
  relay,
  forceRemote: true,
  publicOrigin: relay.origin,
});
remote.listen(0, "127.0.0.1");
await once(remote, "listening");
relay.start(remote.address().port);
const port = Number(process.env.KOOYU_QA_PORT ?? 4357);
const local = createHostServer(service, {
  port,
  webRoot: resolve("apps/web/dist"),
  pairing,
  relay,
});
local.listen(port, "127.0.0.1");
await once(local, "listening");
const metadata = {
  url: `http://127.0.0.1:${port}`,
  hostId: store.hostId,
  sessionId: session.id,
  projectId: project.id,
  workspaceId: ws.id,
  pid: process.pid,
  dataDir: root,
  fixture: true,
  modelInference: false,
  reasoningCases,
};
writeFileSync(join(root, "fixture.json"), JSON.stringify(metadata, null, 2));
console.log(JSON.stringify(metadata));
let closing = false;
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    relay.stop();
    for (const server of [local, remote]) {
      server.closeAllConnections();
      server.close();
    }
    await service.dispose();
    store.close();
    process.exit(0);
  });
