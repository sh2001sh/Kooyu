import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { descriptor, type HarnessAdapter } from "../src/harnesses/adapter.js";
import { SessionService } from "../src/session-service.js";
import { Store } from "../src/storage/store.js";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "kodo-session-workspace-"));
  const store = new Store(":memory:");
  const opened: Array<{ id: string; cwd: string | null }> = [];
  const adapter: HarnessAdapter = {
    descriptor: descriptor("kodo", "Kodo test", "sdk", ["resume"], "isolated", "partial"),
    async connect(session, ctx) {
      opened.push({ id: session.id, cwd: ctx.cwd });
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
  const service = new SessionService(store, { adapters: [adapter] });
  return {
    directory,
    store,
    service,
    opened,
    async close() {
      await service.dispose();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("project Kodo drafts resolve the project's latest directory before opening native sessions", async () => {
  const f = fixture();
  try {
    const project = f.service.createProject({ name: "current project", rootPath: f.directory });
    const secondDirectory = join(f.directory, "second");
    mkdirSync(secondDirectory);
    const workspace = f.service.addWorkspace(project.id, secondDirectory);
    f.service.createDraft({
      title: "latest",
      harnessId: "kodo",
      kind: "supervisor",
      projectId: project.id,
      workspaceId: workspace.id,
    });
    const session = f.service.createDraft({
      title: "project orchestration",
      harnessId: "kodo",
      kind: "supervisor",
      projectId: project.id,
      workspaceId: null,
    });
    assert.equal(session.projectId, project.id);
    assert.equal(session.workspaceId, workspace.id);
    await f.service.openNative(session.id);
    assert.deepEqual(f.opened, [{ id: session.id, cwd: secondDirectory }]);
  } finally {
    await f.close();
  }
});

test("explicit global Kodo retains its scope with an inherited directory; direct harnesses still follow the directory", async () => {
  const f = fixture();
  try {
    const project = f.service.createProject({ name: "previous project", rootPath: f.directory });
    const workspace = f.service.snapshot().workspaces[0]!;
    const global = f.service.createDraft({
      title: "global orchestration",
      harnessId: "kodo",
      kind: "supervisor",
      projectId: null,
      workspaceId: workspace.id,
    });
    const inferred = f.service.createDraft({
      title: "implicit project",
      harnessId: "kodo",
      kind: "supervisor",
      workspaceId: workspace.id,
    });
    const direct = f.service.createDraft({
      title: "direct",
      harnessId: "codex",
      kind: "direct",
      projectId: null,
      workspaceId: workspace.id,
    });
    assert.equal(global.projectId, null);
    assert.equal(global.scope, "global");
    assert.equal(global.workspaceId, workspace.id);
    assert.equal(inferred.projectId, project.id);
    assert.equal(direct.projectId, project.id);
    await f.service.openNative(global.id);
    assert.deepEqual(f.opened, [{ id: global.id, cwd: f.directory }]);
    assert.equal(f.store.session(global.id).projectId, null);
  } finally {
    await f.close();
  }
});

test("a project Kodo without a directory cannot open with internal storage as its project", async () => {
  const f = fixture();
  try {
    const project = f.service.createProject({ name: "no folder yet" });
    const session = f.service.createDraft({
      title: "awaiting folder",
      harnessId: "kodo",
      kind: "supervisor",
      projectId: project.id,
    });
    await assert.rejects(f.service.openNative(session.id), /请选择|选择工作位置/);
    assert.deepEqual(f.opened, []);
    assert.equal(f.store.session(session.id).nativeSessionId, null);
    const workspace = f.service.addWorkspace(project.id, f.directory);
    f.service.updateSession(session.id, { workspaceId: workspace.id });
    await f.service.openNative(session.id);
    assert.deepEqual(f.opened, [{ id: session.id, cwd: f.directory }]);
  } finally {
    await f.close();
  }
});

test("Kimi permissions cannot switch an existing session between Server and ACP", async () => {
  const f = fixture();
  try {
    const server = f.service.createDraft({
      title: "server",
      harnessId: "kimi-code",
      kind: "direct",
    });
    f.store.saveSession({ ...server, nativeSessionId: "session_native", phase: "native" });
    assert.throws(
      () => f.service.updateSession(server.id, { permissionMode: "acp:ask" }),
      /Server 会话不支持 ACP/,
    );
    const legacy = f.service.createDraft({
      title: "legacy",
      harnessId: "kimi-code",
      kind: "direct",
    });
    f.store.saveSession({ ...legacy, nativeSessionId: "legacy-native", phase: "native" });
    assert.throws(
      () => f.service.updateSession(legacy.id, { permissionMode: "kimi:manual" }),
      /旧 Kimi ACP 会话不支持 Server/,
    );
  } finally {
    await f.close();
  }
});
