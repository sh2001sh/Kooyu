import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/storage/store.js";
import { SessionService } from "../src/session-service.js";
import { descriptor, type HarnessAdapter } from "../src/harnesses/adapter.js";
import type { HarnessId } from "@kodo/protocol";

test("binding history retains its pinned native storage without resolving credentials", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kodo-isolated-inspection-"));
  const store = new Store(":memory:");
  const homes = {
    codex: "CODEX_HOME",
    "claude-code": "CLAUDE_CONFIG_DIR",
    "deepseek-harness": "DSH_HOME",
    zcode: "ZCODE_DATA_BASE_DIR",
    opencode: "OPENCODE_CONFIG_DIR",
    gemini: "GEMINI_CLI_HOME",
    "kimi-code": "KIMI_CODE_HOME",
    "grok-build": "GROK_HOME",
  };
  const adapters: HarnessAdapter[] = Object.entries(homes).map(([id, variable]) => ({
    descriptor: descriptor(id as HarnessId, id, "sdk", ["historyRead"], "synthetic", "implemented"),
    async connect() {
      assert.fail("history opened a runtime");
    },
    async standaloneRead(_session, context) {
      assert.equal(
        context.env[variable],
        join(dir, "instances", id, "missing-binding-record", "7"),
      );
      assert.equal(context.configuration, undefined);
      return [];
    },
  }));
  const service = new SessionService(store, { dataDir: dir, adapters });
  try {
    for (const adapter of adapters) {
      const session = service.createDraft({
        title: "Inspection",
        harnessId: adapter.descriptor.id,
        kind: "direct",
      });
      store.saveSession({
        ...session,
        phase: "native",
        nativeSessionId: "native",
        bindingId: "missing-binding-record",
        bindingRevision: 7,
      });
      assert.deepEqual(await service.nativeRead(session.id), []);
    }
  } finally {
    await service.dispose();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("draft history and quota inspection never opens a native session", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kodo-draft-inspection-"));
  const store = new Store(":memory:");
  const adapter: HarnessAdapter = {
    descriptor: descriptor("pi", "Test", "sdk", ["historyRead"], "synthetic", "implemented"),
    async connect() {
      assert.fail("Inspection created a native session");
    },
  };
  const service = new SessionService(store, { dataDir: dir, adapters: [adapter] });
  try {
    const session = service.createDraft({ title: "Draft", harnessId: "pi", kind: "direct" });
    assert.deepEqual(await service.nativeRead(session.id), { nativeSessionId: null, messages: [] });
    assert.equal(((await service.quota(session.id)) as { status: string }).status, "unknown");
    await assert.rejects(service.nativeList(session.id), /不会.*创建/);
    assert.equal(store.commands(session.id).length, 0);
    assert.equal(store.session(session.id).phase, "draft");
  } finally {
    await service.dispose();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unsupported history and unknown quota never reconnect an existing native agent", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kodo-unsupported-inspection-"));
  const store = new Store(":memory:");
  const info = descriptor("deepseek-harness", "Test", "app-server", [], "synthetic", "partial");
  info.capabilities.historyRead = "unsupported";
  const service = new SessionService(store, {
    dataDir: dir,
    adapters: [
      {
        descriptor: info,
        async connect() {
          assert.fail("Unsupported inspection connected an agent");
        },
      },
    ],
  });
  try {
    const session = service.createDraft({
      title: "Existing",
      harnessId: "deepseek-harness",
      kind: "direct",
    });
    store.saveSession({ ...session, phase: "native", nativeSessionId: "native" });
    await assert.rejects(service.nativeRead(session.id), /未启动原生/);
    assert.equal(((await service.quota(session.id)) as { status: string }).status, "unknown");
    assert.equal(store.commands(session.id).length, 0);
  } finally {
    await service.dispose();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("nativeRead inspects an existing session without ACP handshake", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kodo-standalone-history-"));
  const store = new Store(":memory:");
  let inspected = 0;
  const adapter: HarnessAdapter = {
    descriptor: descriptor("gemini", "Gemini", "acp", ["historyRead"], "synthetic", "partial"),
    async connect() {
      assert.fail("nativeRead opened a live ACP connection");
    },
    async standaloneRead(session, context) {
      inspected++;
      assert.equal(session.nativeSessionId, "native-session-test");
      assert.equal(context.cwd, dir);
      return {
        nativeSessionId: session.nativeSessionId,
        messages: [{ role: "user", content: "hello" }],
      };
    },
    async standaloneList() {
      return [{ id: "native-session-test" }];
    },
  };
  const service = new SessionService(store, { dataDir: dir, adapters: [adapter] });
  try {
    const project = service.createProject({ name: "Offline history", rootPath: dir });
    const workspace = store.workspaces().find((item) => item.projectId === project.id)!;
    const session = service.createDraft({
      title: "Existing Gemini session",
      harnessId: "gemini",
      kind: "direct",
      projectId: project.id,
      workspaceId: workspace.id,
    });
    store.saveSession({ ...session, phase: "native", nativeSessionId: "native-session-test" });
    const history = await service.nativeRead(session.id);
    const listing = await service.nativeList(session.id);
    assert.equal(inspected, 1);
    assert.equal((history as any).messages[0].content, "hello");
    assert.deepEqual(listing, [{ id: "native-session-test" }]);
    assert.equal(store.commands(session.id).length, 0);
  } finally {
    await service.dispose();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
