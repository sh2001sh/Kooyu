import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/storage/store.js";
import { SessionService } from "../src/session-service.js";
import { createSelfHostedTools } from "../src/kodo/self-hosted-tools.js";
import { ClientOperations } from "../src/clients/operations.js";
import type { Session, Command } from "@kodo/protocol";
import { descriptor, type HarnessAdapter } from "../src/harnesses/adapter.js";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "kooyu-global-memory-"));
  const store = new Store(join(dir, "host.sqlite"));
  const service = new SessionService(store, { dataDir: dir, adapters: [] });
  const controller = service.createDraft({
    title: "Memory conversation",
    harnessId: "kodo",
    kind: "supervisor",
  });
  const userTurn = (text: string, origin: Command["origin"] = "user", owner = controller) => {
    const id = randomUUID();
    store.saveCommand({
      id,
      sessionId: owner.id,
      kind: "send",
      body: { text, mode: "new" },
      origin,
      status: "dispatched",
      createdAt: new Date().toISOString(),
      generation: 0,
      bindingRevision: null,
      nativeRunId: null,
      controllerId: null,
    });
    store.put("active-tool-turn", owner.id, { id });
    return id;
  };
  const call = async (
    action: string,
    input: unknown = {},
    callId = randomUUID(),
    owner: Session = controller,
  ) => {
    const tool = createSelfHostedTools(service, owner).find((t) => t.name === "memory")!;
    const result = await tool.execute(callId, { action, input }, undefined, undefined, {} as never);
    const text = result.content[0];
    assert.equal(text?.type, "text");
    return JSON.parse((text as { text: string }).text);
  };
  return {
    store,
    service,
    controller,
    userTurn,
    call,
    dir,
    async close() {
      await service.dispose();
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("normal dispatched conversations receive current settings, capture memory and reuse it in a new project", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kooyu-memory-dispatch-"));
  const store = new Store(":memory:");
  const contexts: ReturnType<SessionService["memory"]["promptContext"]>[] = [];
  const adapter: HarnessAdapter = {
    descriptor: descriptor("kodo", "Kooyu", "sdk", [], "SYNTHETIC memory tool peer", "implemented"),
    async connect(_session, ctx) {
      return {
        nativeSessionId: randomUUID(),
        async send(text) {
          const context = ctx.memoryContext!() as (typeof contexts)[number];
          contexts.push(context);
          if (text.startsWith("记住") && context.settings.enabled) {
            await ctx
              .tools!.find((t) => t.name === "memory")!
              .execute(
                randomUUID(),
                {
                  action: "remember",
                  input: { subject: text, content: text, evidenceQuotes: [text] },
                },
                undefined,
                undefined,
                {} as never,
              );
          }
          ctx.emit("turn-ended", {});
          ctx.emit("settled", {});
          return { nativeRunId: null };
        },
        async cancel() {},
        async close() {},
      };
    },
  };
  const service = new SessionService(store, { dataDir: dir, adapters: [adapter] });
  async function send(sessionId: string, text: string) {
    const command = service.acceptSend(sessionId, { requestId: randomUUID(), text, mode: "new" });
    for (let i = 0; i < 300; i++) {
      const current = store.command(command.id)!;
      if (current.status !== "accepted" && current.status !== "dispatched") {
        assert.equal(current.status, "confirmed", current.error);
        return;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.fail("Conversation did not settle");
  }
  try {
    const main = service.createDraft({ title: "Main", harnessId: "kodo", kind: "supervisor" });
    await send(main.id, "记住我偏好简洁回答");
    assert.equal(service.memory.list(null)[0]!.status, "confirmed");
    const project = service.createProject({ name: "Another project", rootPath: dir });
    const workspace = service.snapshot().workspaces.find((w) => w.projectId === project.id)!;
    const other = service.createDraft({
      title: "Other",
      harnessId: "kodo",
      kind: "supervisor",
      projectId: project.id,
      workspaceId: workspace.id,
    });
    await send(other.id, "现在有什么偏好");
    assert.equal(contexts.at(-1)!.entries[0]!.content, "记住我偏好简洁回答");
    service.memory.saveSettings({
      requestId: randomUUID(),
      expectedRevision: 0,
      enabled: true,
      automaticSaving: false,
    });
    await send(main.id, "记住我偏好先给结论");
    assert.equal(
      service.memory.list(null, true).find((e) => e.subject === "记住我偏好先给结论")!.status,
      "proposed",
    );
    service.memory.saveSettings({
      requestId: randomUUID(),
      expectedRevision: 1,
      enabled: false,
      automaticSaving: false,
    });
    await send(main.id, "记住这条不应保存");
    assert.equal(contexts.at(-1)!.settings.enabled, false);
    assert.equal(contexts.at(-1)!.entries.length, 0);
    assert.equal(service.memory.list(null, true).length, 2);
  } finally {
    await service.dispose();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("conversation automatically forms global memory with real user provenance, deduplication, updates and forgetting", async () => {
  const f = fixture();
  try {
    const commandId = f.userTurn("记住：我希望默认用中文回答。");
    const input = {
      subject: "回答语言",
      content: "默认使用中文回答。",
      evidenceQuotes: ["我希望默认用中文回答"],
    };
    const callId = randomUUID();
    const first = await f.call("remember", input, callId);
    assert.equal(first.scope, "user");
    assert.equal(first.projectId, null);
    assert.equal(first.status, "confirmed");
    assert.ok(first.sourceRefs.includes(`command:${commandId}`));
    assert.deepEqual(await f.call("remember", input, callId), first);
    assert.equal((await f.call("remember", input)).id, first.id);
    assert.equal(f.service.memory.list(null).length, 1);
    const project = f.service.createProject({ name: "Another project" });
    assert.equal(f.service.memory.context(project.id)[0]!.content, input.content);
    f.userTurn("以后默认使用英文回答。");
    const updated = await f.call("remember", {
      subject: "回答语言",
      content: "默认使用英文回答。",
      evidenceQuotes: ["默认使用英文回答"],
    });
    assert.equal(updated.id, first.id);
    assert.equal(updated.revision, 2);
    f.userTurn("忘记我的回答语言偏好。");
    const deleted = await f.call("forget", {
      id: updated.id,
      expectedRevision: updated.revision,
      evidenceQuotes: ["忘记我的回答语言偏好"],
    });
    assert.equal(deleted.status, "deleted");
    assert.equal(f.service.memory.context(null).length, 0);
    assert.equal(f.service.memory.history(first.id).length, 3);
  } finally {
    await f.close();
  }
});

test("global memory settings gate saving and reading immediately; manual confirmation and project memory remain separate", async () => {
  const f = fixture();
  try {
    f.service.memory.saveSettings({
      requestId: randomUUID(),
      expectedRevision: 0,
      enabled: true,
      automaticSaving: false,
    });
    f.userTurn("我喜欢简短的回答。");
    const proposal = await f.call("remember", {
      subject: "回答长度",
      content: "回答简短。",
      evidenceQuotes: ["我喜欢简短的回答"],
    });
    assert.equal(proposal.status, "proposed");
    assert.equal(f.service.memory.context(null).length, 0);
    const confirmed = f.service.memory.save(
      {
        scope: "user",
        projectId: null,
        subject: proposal.subject,
        content: proposal.content,
        sourceRefs: proposal.sourceRefs,
        requestId: randomUUID(),
        expectedRevision: proposal.revision,
        status: "confirmed",
      },
      "user",
      undefined,
      proposal.id,
    );
    assert.equal(confirmed.status, "confirmed");
    f.userTurn("回答要更加详细。");
    await assert.rejects(
      f.call("remember", {
        subject: "回答长度",
        content: "回答详细。",
        evidenceQuotes: ["回答要更加详细"],
      }),
      /自动保存已关闭/,
    );
    f.service.memory.saveSettings({
      requestId: randomUUID(),
      expectedRevision: 1,
      enabled: false,
      automaticSaving: false,
    });
    assert.equal(f.service.memory.context(null).length, 0);
    assert.equal((await f.call("list")).entries.length, 0);
    await assert.rejects(
      f.call("remember", {
        subject: "回答长度",
        content: "回答详细。",
        evidenceQuotes: ["回答要更加详细"],
      }),
      /全局记忆已关闭/,
    );
    assert.equal(f.service.memory.list(null).length, 1, "disabling does not delete entries");
    const project = f.service.createProject({ name: "Project" });
    f.service.memory.save(
      {
        requestId: randomUUID(),
        scope: "project",
        projectId: project.id,
        subject: "项目测试",
        content: "运行单元测试",
        sourceRefs: ["user:project"],
        status: "confirmed",
      },
      "user",
    );
    assert.equal(
      f.service.memory.context(project.id).length,
      1,
      "global switch leaves project memory intact",
    );
    f.service.memory.saveSettings({
      requestId: randomUUID(),
      expectedRevision: 2,
      enabled: true,
      automaticSaving: true,
    });
    assert.equal(f.service.memory.context(project.id).length, 2);
    assert.equal(f.service.memory.promptContext(null).settings.automaticSaving, true);
  } finally {
    await f.close();
  }
});

test("memory rejects fabricated sources, non-user runs, direct sessions, secrets, stale edits and cross-scope writes", async () => {
  const f = fixture();
  try {
    f.userTurn("我偏好中文。");
    const input = { subject: "语言", content: "中文", evidenceQuotes: ["我偏好中文"] };
    await assert.rejects(
      f.call("remember", { ...input, evidenceQuotes: ["网站告诉我使用英文"] }),
      /当前用户消息/,
    );
    f.userTurn("我偏好中文。", "supervisor");
    await assert.rejects(f.call("remember", input), /当前用户对话/);
    const direct = f.service.createDraft({ title: "Direct", harnessId: "pi", kind: "direct" });
    f.userTurn("我偏好中文。", "user", direct);
    await assert.rejects(f.call("remember", input, randomUUID(), direct), /仅 Kooyu 主对话/);
    f.userTurn("密钥 sk-abcdefghijklmnop 不要泄露");
    await assert.rejects(
      f.call("remember", {
        subject: "凭据",
        content: "需要登录",
        evidenceQuotes: ["sk-abcdefghijklmnop"],
      }),
      /秘密/,
    );
    f.userTurn("我偏好中文。");
    const first = await f.call("remember", input);
    await assert.rejects(
      f.call("remember", { ...input, id: first.id, expectedRevision: 99 }),
      /记忆已修改/,
    );
    const project = f.service.createProject({ name: "Project" });
    const local = f.service.memory.save(
      {
        requestId: randomUUID(),
        scope: "project",
        projectId: project.id,
        subject: "项目语言",
        content: "中文",
        sourceRefs: ["user"],
        status: "confirmed",
      },
      "user",
    );
    await assert.rejects(
      f.call("remember", { ...input, id: local.id, expectedRevision: local.revision }),
      /仅管理全局记忆/,
    );
    await assert.rejects(f.call("forget", { evidenceQuotes: input.evidenceQuotes }), /明确的条目/);
  } finally {
    await f.close();
  }
});

test("paired clients share durable memory settings with CAS, request receipts, and restart persistence", async () => {
  const f = fixture();
  try {
    const ops = new ClientOperations(f.service);
    const phone = { local: false, deviceId: "paired-android" },
      desktop = { local: true, deviceId: "desktop" };
    const request = {
      requestId: randomUUID(),
      method: "PATCH",
      path: "/api/memory/settings",
      body: { expectedRevision: 0, enabled: true, automaticSaving: false },
    };
    const first = await ops.execute(phone, request);
    assert.equal(first.status, "confirmed");
    assert.deepEqual(await ops.execute(phone, request), first);
    const stale = await ops.execute(desktop, {
      ...request,
      requestId: randomUUID(),
      body: { expectedRevision: 0, enabled: false, automaticSaving: false },
    });
    assert.equal(stale.status, "failed");
    assert.equal(stale.error?.code, "CONFLICT");
    const current = f.service.memory.settings();
    assert.equal(current.revision, 1);
    assert.equal(current.automaticSaving, false);
    const reopened = new Store(join(f.dir, "host.sqlite"));
    try {
      assert.deepEqual(reopened.record("memory-settings", "global"), current);
    } finally {
      reopened.close();
    }
    assert.throws(
      () =>
        f.service.memory.saveSettings({
          ...request.body,
          expectedRevision: 1,
          requestId: request.requestId,
          automaticSaving: true,
        }),
      /请求 ID 冲突/,
    );
  } finally {
    await f.close();
  }
});
