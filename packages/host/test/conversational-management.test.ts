import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/storage/store.js";
import { SessionService } from "../src/session-service.js";
import { createHarnessTools } from "../src/kodo/tools.js";
import { descriptor, type HarnessAdapter, type Wire } from "../src/harnesses/adapter.js";
import type { InboxItem, Session } from "@kodo/protocol";

// Exercise the tools a Kodo model can call; no real model or native process.
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "kodo-conversation-management-"));
  const store = new Store(":memory:");
  const connections: string[] = [];
  const adapters: HarnessAdapter[] = (["kodo", "pi", "codex"] as const).map((id) => ({
    descriptor: descriptor(id, id, "sdk", [], "SYNTHETIC management fixture", "implemented"),
    async connect(session) {
      connections.push(session.id);
      return {
        nativeSessionId: session.nativeSessionId ?? randomUUID(),
        async send() {
          return { nativeRunId: null };
        },
        async cancel() {},
        async close() {},
        async read() {
          return { messages: ["synthetic native history"] };
        },
        async list() {
          return [{ id: session.nativeSessionId }];
        },
        async quota() {
          return { status: "known", remaining: 5 };
        },
      };
    },
  }));
  const service = new SessionService(store, { dataDir: dir, adapters });
  const project = service.createProject({ name: "Conversation project" });
  const controller = service.createDraft({
    title: "Kodo A",
    harnessId: "kodo",
    kind: "supervisor",
  });
  const nextController = service.createDraft({
    title: "Kodo B",
    harnessId: "kodo",
    kind: "supervisor",
  });
  const target = service.createDraft({
    title: "Execution",
    harnessId: "pi",
    kind: "direct",
    projectId: project.id,
  });
  const call = async (owner: Session, name: string, input: Wire, id = randomUUID()) => {
    const tool = createHarnessTools(service, owner).find((item) => item.name === name);
    assert.ok(tool);
    const result = await tool.execute(id, input, undefined, undefined, {} as never);
    const content = result.content[0];
    assert.ok(content && content.type === "text");
    return JSON.parse(content.text);
  };
  const approve = async (work: Promise<unknown>, decision: "accept" | "decline" = "accept") => {
    // Every management request must exist as a live conversation interaction
    // before a user answer can turn it into authority.
    for (let i = 0; i < 30; i++) {
      const item = store
        .records<InboxItem>("inbox")
        .find((item) => item.type === "interaction" && !item.resolved);
      if (item) {
        assert.equal((item.payload as Wire).protocol, "kodo");
        service.answerInteraction(item.id, { decision }, randomUUID());
        return work;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.fail("Missing conversation confirmation");
  };
  return {
    service,
    store,
    connections,
    project,
    controller,
    nextController,
    target,
    call,
    approve,
    async close() {
      await service.dispose();
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("Kodo conversation enables, pauses, resumes and transfers supervision with explicit user answers", async () => {
  const f = await fixture();
  try {
    const input = {
      sessionId: f.target.id,
      mode: "continue",
      goal: "Finish the task",
      limits: { maxContinuations: 2 },
    };
    const id = randomUUID();
    const pending = f.call(f.controller, "harness_watch", input, id);
    assert.equal(f.store.watches().length, 0);
    const watch = (await f.approve(pending)) as Wire;
    assert.equal(watch.state, "active");
    assert.equal(watch.limits.maxContinuations, 2);
    assert.equal(f.connections.length, 0);
    assert.deepEqual(await f.call(f.controller, "harness_watch", input, id), watch);
    assert.equal(f.store.watches().length, 1);
    await f.call(f.controller, "harness_watch", { sessionId: f.target.id, action: "pause" });
    assert.equal(f.store.watches()[0]?.state, "paused");
    // Existing tool API still cannot silently resume a user-paused lease.
    assert.throws(
      () =>
        f.service.watch(
          { controllerSessionId: f.controller.id, targetSessionId: f.target.id, mode: "continue" },
          "model",
        ),
      /用户显式启用/,
    );
    await f.approve(f.call(f.controller, "harness_watch", input));
    const transfer = f.call(f.nextController, "harness_watch", { ...input, action: "transfer" });
    assert.equal(
      f.store.watches().find((item) => item.state === "active")?.controllerSessionId,
      f.controller.id,
    );
    await f.approve(transfer);
    assert.deepEqual(
      f.store
        .watches()
        .filter((item) => item.state === "active")
        .map((item) => item.controllerSessionId),
      [f.nextController.id],
    );
    assert.equal(f.store.session(f.target.id).nativeSessionId, null);
  } finally {
    await f.close();
  }
});

test("denial and project scope block conversational management without changing authority", async () => {
  const f = await fixture();
  try {
    const denied = f.call(f.controller, "harness_watch", {
      sessionId: f.target.id,
      mode: "continue",
    });
    const rejected = assert.rejects(denied, /用户未允许/);
    await f.approve(
      denied.catch(() => undefined),
      "decline",
    );
    await rejected;
    assert.equal(f.store.watches().length, 0);
    assert.throws(() => f.service.requireGrant(f.controller, f.target), /管理范围/);
    const other = f.service.createProject({ name: "Other" });
    const scoped = f.service.createDraft({
      title: "Scoped",
      kind: "supervisor",
      harnessId: "kodo",
      projectId: other.id,
    });
    await assert.rejects(
      f.call(scoped, "harness_watch", { sessionId: f.target.id }),
      /不能管理其他项目/,
    );
    assert.equal(f.store.records<InboxItem>("inbox").filter((item) => !item.resolved).length, 0);
    const pending = f.call(f.controller, "harness_watch", {
      sessionId: f.target.id,
      mode: "continue",
    });
    const changed = assert.rejects(pending, /范围已改变|不能管理其他项目/);
    f.service.updateSession(f.controller.id, { projectId: other.id });
    await f.approve(pending.catch(() => undefined));
    await changed;
    assert.equal(f.store.watches().length, 0);
  } finally {
    await f.close();
  }
});

test("stopping Kodo cancels its pending confirmation and does not leave a grant", async () => {
  const f = await fixture();
  try {
    const pending = f.call(f.controller, "harness_watch", {
      sessionId: f.target.id,
      mode: "continue",
    });
    const rejected = assert.rejects(pending, /用户未允许/);
    const interaction = f.store.records<InboxItem>("inbox").find((item) => !item.resolved)!;
    await f.service.stop(f.controller.id);
    await rejected;
    assert.equal(f.store.watches().length, 0);
    assert.equal(f.store.record<InboxItem>("inbox", interaction.id)?.resolved, true);
    assert.throws(
      () => f.service.answerInteraction(interaction.id, { decision: "accept" }, randomUUID()),
      /已失效/,
    );
  } finally {
    await f.close();
  }
});

test("concurrent tool replay shares one approval and target stop invalidates a pending resume", async () => {
  const f = await fixture();
  try {
    const id = randomUUID();
    const input = { sessionId: f.target.id, mode: "continue" };
    const first = f.call(f.controller, "harness_watch", input, id);
    const duplicate = f.call(f.controller, "harness_watch", input, id);
    assert.equal(f.store.records<InboxItem>("inbox").filter((item) => !item.resolved).length, 1);
    const results = (await f.approve(Promise.all([first, duplicate]))) as Wire[];
    assert.equal(results[0]?.id, results[1]?.id);
    const unchanged = await f.call(f.controller, "harness_watch", input);
    assert.equal(unchanged.id, results[0]?.id);
    await f.call(f.controller, "harness_watch", { sessionId: f.target.id, action: "pause" });
    const pending = f.call(f.controller, "harness_watch", input);
    const rejected = assert.rejects(pending, /目标已停止/);
    await f.service.stop(f.target.id);
    await f.approve(pending.catch(() => undefined));
    await rejected;
    assert.equal(f.store.watches()[0]?.state, "paused");
  } finally {
    await f.close();
  }
});

test("native history and quota are readable through Kodo tools; draft history never creates a native session", async () => {
  const f = await fixture();
  try {
    const empty = f.call(f.controller, "harness_read", {
      sessionId: f.target.id,
      source: "native",
    });
    const rejected = assert.rejects(empty, /尚未创建原生历史/);
    await f.approve(empty.catch(() => undefined));
    await rejected;
    assert.equal(f.connections.length, 0);
    await f.service.openNative(f.target.id);
    const nativeId = f.store.session(f.target.id).nativeSessionId;
    const history = await f.call(f.controller, "harness_read", {
      sessionId: f.target.id,
      source: "native",
    });
    assert.deepEqual(history, { messages: ["synthetic native history"] });
    const list = await f.call(f.controller, "harness_read", {
      sessionId: f.target.id,
      source: "history",
    });
    assert.equal(list.length, 1);
    const quota = await f.call(f.controller, "harness_read", {
      sessionId: f.target.id,
      source: "quota",
    });
    assert.equal(quota.remaining, 5);
    assert.equal(f.store.session(f.target.id).nativeSessionId, nativeId);
  } finally {
    await f.close();
  }
});

test("conversation grants future creation and creates one linked cross-harness handoff with preserved material", async () => {
  const f = await fixture();
  try {
    const grant = f.call(f.controller, "harness_grant", {
      projectId: f.project.id,
      mode: "create-and-control",
      limits: { maxContinuations: 3 },
    });
    await f.approve(grant);
    const created = f.service.createManagedDraft(f.controller.id, randomUUID(), {
      projectId: f.project.id,
      harnessId: "pi",
      title: "Future execution",
    });
    assert.equal(
      f.store.watches().find((item) => item.targetSessionId === created.id)?.limits
        ?.maxContinuations,
      3,
    );
    const input = {
      sessionId: f.target.id,
      harnessId: "codex",
      text: "Goal, files, checks and remaining work",
    };
    const id = randomUUID();
    const handoff = (await f.approve(f.call(f.controller, "harness_handoff", input, id))) as Wire;
    assert.equal(handoff.session.harnessId, "codex");
    assert.equal(handoff.session.projectId, f.project.id);
    assert.equal(handoff.queued, false);
    assert.equal(handoff.session.nativeSessionId, null);
    assert.equal(f.store.record<Wire>("handoff-material", handoff.session.id)?.text, input.text);
    assert.equal(
      f.store.record<Wire>("session-link", handoff.session.id)?.fromSessionId,
      f.target.id,
    );
    const repeated = await f.call(f.controller, "harness_handoff", input, id);
    assert.equal(repeated.session.id, handoff.session.id);
    await assert.rejects(
      f.call(f.controller, "harness_handoff", { ...input, text: "different" }, id),
      /请求 ID/,
    );
    assert.equal(f.connections.length, 0);
  } finally {
    await f.close();
  }
});

test("progress listing reports each session's last reply, failure and waiting state without writing", async () => {
  const f = await fixture();
  try {
    f.service.ingest(f.target.id, "message", { role: "user", text: "implement export" }, "u1");
    f.service.ingest(f.target.id, "message", { role: "assistant", text: "Export done." }, "a1");
    f.service.ingest(
      f.target.id,
      "turn-ended",
      { outcome: "failed", error: { message: "quota exhausted" } },
      "t1",
    );
    const before = f.store.commands(f.target.id).length;
    const report = await f.call(f.controller, "harness_list", { progress: true });
    const row = report.sessions.find((s: Wire) => s.sessionId === f.target.id);
    assert.ok(row);
    assert.equal(row.status, "failed");
    assert.equal(row.lastRequest, "implement export");
    assert.equal(row.lastReply, "Export done.");
    assert.equal(row.lastError, "quota exhausted");
    assert.equal(row.project, "Conversation project");
    assert.ok(!report.sessions.some((s: Wire) => s.sessionId === f.controller.id));
    const failed = await f.call(f.controller, "harness_list", { status: "failed" });
    assert.deepEqual(
      failed.sessions.map((s: Session) => s.id),
      [f.target.id],
    );
    assert.equal(f.store.commands(f.target.id).length, before);
    assert.equal(f.store.watches().length, 0);
  } finally {
    await f.close();
  }
});

test("harness_update renames after confirmation, archives with confirmation, and respects project scope", async () => {
  const f = await fixture();
  try {
    const rename = f.call(f.controller, "harness_update", {
      sessionId: f.target.id,
      title: "Renamed",
    });
    await f.approve(rename);
    assert.equal(f.store.session(f.target.id).title, "Renamed");

    const declined = f.call(f.controller, "harness_update", {
      sessionId: f.target.id,
      archived: true,
    });
    const rejected = assert.rejects(declined, /未允许/);
    await f.approve(
      declined.catch(() => undefined),
      "decline",
    );
    await rejected;
    assert.equal(f.store.session(f.target.id).archived, false);

    await assert.rejects(
      f.call(f.controller, "harness_update", { sessionId: f.controller.id, title: "x" }),
      /不整理自身/,
    );

    const other = f.service.createProject({ name: "Other" });
    const scoped = f.service.createDraft({
      title: "Project Kodo",
      harnessId: "kodo",
      kind: "supervisor",
      projectId: f.project.id,
    });
    await assert.rejects(
      f.call(scoped, "harness_update", { sessionId: f.target.id, projectId: other.id }),
      /移出本项目/,
    );
    assert.equal(f.store.session(f.target.id).projectId, f.project.id);
  } finally {
    await f.close();
  }
});
