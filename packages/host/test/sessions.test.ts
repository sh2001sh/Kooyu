import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { NATIVE_HARNESS_IDS, type Supervision } from "@kodo/protocol";
import { Store } from "../src/storage/store.js";
import { SessionService } from "../src/session-service.js";
import { validateSupervision } from "../src/domain/session-rules.js";
import { descriptor, type HarnessAdapter } from "../src/harnesses/adapter.js";

test("only Host-created empty ZCode sessions permit native draft recreation", async () => {
  const store = new Store(":memory:");
  const contexts: Array<{ id: string; recreate: boolean }> = [];
  const adapter: HarnessAdapter = {
    descriptor: descriptor("zcode", "ZCode test", "app-server", ["resume"], "isolated", "partial"),
    async connect(session, ctx) {
      contexts.push({ id: session.id, recreate: ctx.recreateEmptyNativeDraft ?? false });
      return {
        nativeSessionId: session.nativeSessionId ?? `native:${session.id}`,
        async send() {
          return { nativeRunId: null };
        },
        async cancel() {},
        async close() {},
      };
    },
  };
  let service = new SessionService(store, { adapters: [adapter] });
  try {
    const empty = service.createDraft({ title: "empty", harnessId: "zcode", kind: "direct" });
    const used = service.createDraft({ title: "used", harnessId: "zcode", kind: "direct" });
    const external = service.createDraft({ title: "external", harnessId: "zcode", kind: "direct" });
    await service.openNative(empty.id);
    await service.openNative(used.id);
    store.saveCommand({
      id: "test-sent-zcode-command",
      sessionId: used.id,
      kind: "send",
      origin: "user",
      controllerId: null,
      generation: 0,
      bindingRevision: null,
      status: "confirmed",
      nativeRunId: null,
      body: { text: "sent" },
      createdAt: new Date().toISOString(),
    });
    service.attachNative(external.id, "external-session", true);
    await service.dispose();
    service = new SessionService(store, { adapters: [adapter] });
    await service.openNative(empty.id);
    await service.openNative(used.id);
    await service.openNative(external.id);
    assert.deepEqual(contexts.slice(-3), [
      { id: empty.id, recreate: true },
      { id: used.id, recreate: false },
      { id: external.id, recreate: false },
    ]);
  } finally {
    await service.dispose();
    store.close();
  }
});

test("project sessions and global supervisors retain their identities after reopening SQLite", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kodo-store-"));
  const path = join(directory, "state.sqlite");
  const store = new Store(path);
  let reopened: Store | undefined;
  try {
    const service = new SessionService(store);
    const project = service.createProject({ name: "应用", rootPath: directory });
    const workspace = service.snapshot().workspaces[0]!;
    const global = service.createDraft({
      title: "跨项目跟进",
      harnessId: "kodo",
      kind: "supervisor",
    });
    const execution = service.createDraft({
      title: "实现接口",
      harnessId: "codex",
      kind: "direct",
      projectId: project.id,
      workspaceId: workspace.id,
    });
    const before = service.snapshot();
    await service.dispose();
    store.close();
    reopened = new Store(path);
    const restored = new SessionService(reopened);
    const after = restored.snapshot();
    await restored.dispose();
    assert.deepEqual(after, before);
    assert.equal(global.projectId, null);
    assert.equal(execution.projectId, project.id);
    assert.equal(execution.nativeSessionId, null);
  } finally {
    if (reopened) reopened.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("project attribution is independent of execution location; only Kodo creates supervisors", async () => {
  const store = new Store(":memory:"),
    service = new SessionService(store);
  try {
    const a = service.createProject({ name: "A", rootPath: tmpdir() });
    const b = service.createProject({ name: "B" });
    const workspace = service.snapshot().workspaces[0]!;
    const session = service.createDraft({
      title: "独立归属",
      harnessId: "codex",
      kind: "direct",
      projectId: b.id,
      workspaceId: workspace.id,
    });
    assert.equal(session.projectId, b.id);
    assert.equal(session.workspaceId, workspace.id);
    assert.throws(
      () =>
        service.createDraft({
          title: "错误角色",
          harnessId: "codex",
          kind: "supervisor",
          projectId: a.id,
        }),
      /使用 Kooyu/,
    );
    assert.equal(service.snapshot().sessions.length, 1);
  } finally {
    await service.dispose();
    store.close();
  }
});

test("observation is shared but automatic continuation has one controller and project scope", async () => {
  const store = new Store(":memory:"),
    service = new SessionService(store);
  try {
    const a = service.createProject({ name: "A" });
    const b = service.createProject({ name: "B" });
    const global = service.createDraft({ title: "全局", harnessId: "kodo", kind: "supervisor" });
    const project = service.createDraft({
      title: "项目",
      harnessId: "kodo",
      kind: "supervisor",
      projectId: a.id,
    });
    const target = service.createDraft({
      title: "执行",
      harnessId: "cursor",
      kind: "direct",
      projectId: a.id,
    });
    const other = service.createDraft({
      title: "另一项目",
      harnessId: "kimi-code",
      kind: "direct",
      projectId: b.id,
    });
    const existing: Supervision[] = [
      {
        id: "watch",
        controllerSessionId: project.id,
        targetSessionId: target.id,
        mode: "continue",
        state: "active",
        generation: 1,
        cursor: null,
      },
    ];
    assert.doesNotThrow(() => validateSupervision(global, target, "observe", existing));
    assert.throws(() => validateSupervision(global, target, "continue", existing), /控制者/);
    assert.throws(() => validateSupervision(project, other, "observe", []), /其他项目/);
    assert.throws(() => validateSupervision(global, project, "continue", []), /普通执行会话/);
  } finally {
    await service.dispose();
    store.close();
  }
});

test("all ten draft types exist without claiming a running native session", async () => {
  const store = new Store(":memory:"),
    service = new SessionService(store);
  try {
    for (const harnessId of NATIVE_HARNESS_IDS) {
      const draft = service.createDraft({ title: harnessId, harnessId, kind: "direct" });
      assert.equal(draft.phase, "draft");
    }
    const snapshot = service.snapshot();
    assert.equal(snapshot.harnesses.length, 11);
    assert.deepEqual(
      snapshot.harnesses
        .filter((h) => h.implementation === "partial")
        .map((h) => h.id)
        .sort(),
      ["cursor", "gemini", "grok-build", "kimi-code", "opencode", "zcode"],
    );
    assert.ok(snapshot.harnesses.every((item) => item.health?.authentication === "unknown"));
    assert.ok(
      snapshot.sessions.every((item) => item.phase === "draft" && item.nativeSessionId === null),
    );
  } finally {
    await service.dispose();
    store.close();
  }
});

test("removing a project keeps its conversations for the folder, or deletes them on request", async () => {
  const store = new Store(":memory:");
  const service = new SessionService(store);
  const dir = mkdtempSync(join(tmpdir(), "kodo-project-remove-"));
  try {
    const workspace = service.addWorkspace(null, dir);
    const kept = service.createDraft({
      title: "kept",
      harnessId: "pi",
      kind: "direct",
      workspaceId: workspace.id,
    });
    const projectId = kept.projectId!;
    assert.ok(projectId);

    const keep = await service.deleteProject(projectId, "keep");
    assert.equal(keep.sessionsKept, 1);
    let snap = service.snapshot();
    assert.equal(
      snap.projects.some((p) => p.id === projectId),
      false,
    );
    assert.equal(
      snap.sessions.some((s) => s.id === kept.id),
      false,
    );

    // Opening the same folder again brings the project and its conversation back.
    const again = service.addWorkspace(null, dir);
    const next = service.createDraft({
      title: "again",
      harnessId: "pi",
      kind: "direct",
      workspaceId: again.id,
    });
    assert.equal(next.projectId, projectId);
    snap = service.snapshot();
    assert.equal(
      snap.sessions.some((s) => s.id === kept.id),
      true,
    );

    const removed = await service.deleteProject(projectId, "delete");
    assert.equal(removed.sessionsDeleted, 2);
    snap = service.snapshot();
    assert.equal(
      snap.projects.some((p) => p.id === projectId),
      false,
    );
    assert.equal(
      snap.sessions.some((s) => s.id === kept.id || s.id === next.id),
      false,
    );
  } finally {
    await service.dispose();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
