import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Session } from "@kodo/protocol";
import { SessionService } from "../src/session-service.js";
import { Store } from "../src/storage/store.js";
import { descriptor, type HarnessAdapter, type AdapterContext } from "../src/harnesses/adapter.js";
import { createKodoKernel } from "../src/kodo/kernel.js";

test("inspection separates workspaces and captured homes without resolving credentials", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kodo-inspection-groups-")),
    store = new Store(":memory:");
  const calls: { cwd: string | null; home: string | undefined }[] = [];
  const synthetic: HarnessAdapter = {
    descriptor: descriptor(
      "gemini",
      "Gemini",
      "acp",
      [],
      "isolated workspace contract",
      "implemented",
    ),
    async connect() {
      assert.fail("inspection reconnected");
    },
    async inspectSessions(sessions, ctx) {
      assert.equal(ctx.configuration, undefined);
      calls.push({ cwd: ctx.cwd, home: ctx.env.GEMINI_CLI_HOME });
      return Object.fromEntries(sessions.map((s) => [s.nativeSessionId!, "present"]));
    },
  };
  const service = new SessionService(store, { dataDir: dir, adapters: [synthetic] });
  try {
    for (const [index, folder] of ["one", "two", "one"].entries()) {
      const cwd = join(dir, folder);
      mkdirSync(cwd, { recursive: true });
      const workspace = service.addWorkspace(null, cwd);
      const s = service.createDraft({
        title: folder,
        harnessId: "gemini",
        kind: "direct",
        workspaceId: workspace.id,
      });
      store.saveSession({ ...s, nativeSessionId: String(index), phase: "native" });
      store.put("native-inspection-environment", s.id, {
        nativeSessionId: String(index),
        env: { GEMINI_CLI_HOME: join(dir, "captured-" + index) },
      });
    }
    assert.equal((await service.syncNativeSessions()).checked, 3);
    assert.equal(calls.length, 3);
    assert.deepEqual(
      calls.sort((a, b) => String(a.home).localeCompare(String(b.home))),
      ["one", "two", "one"].map((folder, index) => ({
        cwd: join(dir, folder),
        home: join(dir, "captured-" + index),
      })),
    );
  } finally {
    await service.dispose();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("missing confirmations reset across home, binding and workspace changes and async races", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kodo-native-confirmation-context-")),
    store = new Store(":memory:");
  let duringInspection: (() => void) | undefined;
  const service = new SessionService(store, {
    dataDir: dir,
    adapters: [
      {
        descriptor: descriptor(
          "gemini",
          "Gemini",
          "acp",
          [],
          "isolated context changes",
          "implemented",
        ),
        async connect() {
          assert.fail("inspection opened a runtime");
        },
        async inspectSessions(sessions) {
          duringInspection?.();
          return Object.fromEntries(sessions.map((s) => [s.nativeSessionId!, "missing"]));
        },
      },
    ],
  });
  try {
    const s = service.createDraft({
      title: "changing context",
      harnessId: "gemini",
      kind: "direct",
    });
    store.saveSession({ ...s, nativeSessionId: "native", phase: "native" });
    store.put("native-storage-seen", s.id, { at: new Date().toISOString() });
    const age = () =>
      store.put("native-missing-confirmation", s.id, {
        ...store.record<object>("native-missing-confirmation", s.id),
        firstMissingAt: Date.now() - 6000,
      });
    const workspace = service.addWorkspace(null, dir);
    await service.syncNativeSessions();
    for (const change of [
      () =>
        store.put("native-inspection-environment", s.id, {
          nativeSessionId: "native",
          env: { GEMINI_CLI_HOME: join(dir, "new-home") },
        }),
      () => store.saveSession({ ...store.session(s.id), bindingId: "changed", bindingRevision: 1 }),
      () => store.saveSession({ ...store.session(s.id), workspaceId: workspace.id }),
    ]) {
      age();
      change();
      assert.deepEqual((await service.syncNativeSessions()).removed, []);
      assert(
        store.record<{ firstMissingAt: number }>("native-missing-confirmation", s.id)!
          .firstMissingAt >
          Date.now() - 5000,
      );
    }
    age();
    duringInspection = () =>
      store.put("native-inspection-environment", s.id, {
        nativeSessionId: "native",
        env: { GEMINI_CLI_HOME: join(dir, "changed-during-scan") },
      });
    assert.equal((await service.syncNativeSessions()).checked, 0);
    duringInspection = undefined;
    assert.deepEqual((await service.syncNativeSessions()).removed, []);
    age();
    assert.deepEqual((await service.syncNativeSessions()).removed, [s.id]);
  } finally {
    await service.dispose();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("explicit removal inspects its target beyond the automatic 200-session batch", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kodo-targeted-sync-")),
    store = new Store(":memory:");
  const inspected: string[] = [];
  const service = new SessionService(store, {
    dataDir: dir,
    adapters: [
      {
        descriptor: descriptor(
          "codex",
          "Codex",
          "app-server",
          [],
          "isolated large sidebar",
          "implemented",
        ),
        async connect() {
          assert.fail("inspection opened a runtime");
        },
        async inspectSessions(sessions) {
          inspected.push(...sessions.map((s) => s.id));
          return Object.fromEntries(sessions.map((s) => [s.nativeSessionId!, "missing"]));
        },
      },
    ],
  });
  try {
    const target = service.createDraft({
      title: "old stale session",
      harnessId: "codex",
      kind: "direct",
    });
    store.saveSession({
      ...target,
      nativeSessionId: "deleted-target",
      phase: "native",
      runState: "unknown",
      createdAt: "2000-01-01T00:00:00Z",
    });
    for (let i = 0; i < 201; i++) {
      const s = service.createDraft({ title: "other", harnessId: "codex", kind: "direct" });
      store.saveSession({ ...s, nativeSessionId: String(i), phase: "native" });
    }
    assert.equal((await service.deleteSession(target.id)).nativeMissing, true);
    assert.deepEqual(inspected, [target.id]);
    assert.equal(service.snapshot().sessions.length, 201);
  } finally {
    await service.dispose();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("native deletion closes idle connections but preserves running and in-flight sessions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kodo-idle-native-sync-")),
    store = new Store(":memory:");
  const closed: string[] = [],
    inspected: string[] = [];
  let missing = false;
  const service = new SessionService(store, {
    dataDir: dir,
    adapters: [
      {
        descriptor: descriptor(
          "codex",
          "Codex",
          "app-server",
          ["resume"],
          "isolated idle connection",
          "implemented",
        ),
        async connect(s) {
          return {
            nativeSessionId: s.nativeSessionId!,
            async send() {
              return { nativeRunId: null };
            },
            async cancel() {},
            async close() {
              closed.push(s.id);
            },
          };
        },
        async inspectSessions(sessions) {
          inspected.push(...sessions.map((s) => s.id));
          return Object.fromEntries(
            sessions.map((s) => [s.nativeSessionId!, missing ? "missing" : "present"]),
          );
        },
      },
    ],
  });
  try {
    const create = async (title: string) => {
      const s = service.createDraft({ title, harnessId: "codex", kind: "direct" });
      store.saveSession({ ...s, nativeSessionId: title, phase: "native" });
      await service.openNative(s.id);
      return s;
    };
    const idle = await create("idle"),
      running = await create("running");
    await service.syncNativeSessions();
    inspected.length = 0;
    store.saveSession({ ...store.session(running.id), runState: "running" });
    missing = true;
    await service.syncNativeSessions();
    assert.deepEqual(inspected, [idle.id]);
    store.put("native-missing-confirmation", idle.id, {
      ...store.record<object>("native-missing-confirmation", idle.id),
      nativeSessionId: "idle",
      firstMissingAt: Date.now() - 6000,
      checkedAt: Date.now(),
    });
    assert.deepEqual((await service.syncNativeSessions()).removed, [idle.id]);
    assert.deepEqual(closed, [idle.id]);
    assert.equal(store.session(running.id).runState, "running");
    assert.equal(service.snapshot().sessions.length, 1);
    store.saveSession({ ...store.session(running.id), runState: "idle" });
    store.saveCommand({ ...store.commands(running.id)[0]!, status: "unknown" });
    assert.deepEqual((await service.syncNativeSessions()).removed, []);
    assert(inspected.every((id) => id === idle.id));
  } finally {
    await service.dispose();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("project deletion checks every missing member beyond 200 despite stale running state", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kodo-project-native-sync-")),
    store = new Store(":memory:");
  const service = new SessionService(store, {
    dataDir: dir,
    adapters: [
      {
        descriptor: descriptor(
          "gemini",
          "Gemini",
          "acp",
          [],
          "isolated missing project session",
          "implemented",
        ),
        async connect() {
          assert.fail("project deletion opened a runtime");
        },
        async inspectSessions(sessions) {
          return Object.fromEntries(sessions.map((s) => [s.nativeSessionId!, "missing"]));
        },
      },
    ],
  });
  try {
    const project = service.createProject({ name: "stale project", rootPath: dir });
    for (let i = 0; i < 202; i++) {
      const s = service.createDraft({
        title: "deleted natively",
        harnessId: "gemini",
        kind: "direct",
        projectId: project.id,
      });
      store.saveSession({
        ...s,
        phase: "native",
        nativeSessionId: "removed-" + i,
        runState: "running",
      });
    }
    const result = await service.deleteProject(project.id, "delete");
    assert.equal(result.sessionsDeleted, 202);
    assert.equal(service.snapshot().sessions.length, 0);
    assert.equal(existsSync(dir), true);
  } finally {
    await service.dispose();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const id of ["pi", "kodo"] as const)
  test(id + " never recreates a deleted or invalid native log on resume", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kodo-missing-native-log-"));
    try {
      const root = join(dir, id, "sessions");
      mkdirSync(root, { recursive: true });
      const path = join(root, "deleted.jsonl");
      writeFileSync(join(root, "product.json"), JSON.stringify({ path }));
      const ctx: AdapterContext = {
        cwd: dir,
        dataDir: dir,
        env: {},
        launch: { command: "never-launch", args: [] },
        configuration: {
          id: "test",
          revision: 1,
          name: "test",
          provider: "openai",
          model: "gpt-5",
          protocol: "openai-responses",
          credentialRef: null,
        },
        emit() {
          assert.fail("resume emitted an event");
        },
        async interact() {
          assert.fail("resume asked a question");
        },
      };
      const s = { id: "product", harnessId: id, nativeSessionId: "native" } as Session;
      await assert.rejects(createKodoKernel(s, ctx), /文件已缺失/);
      assert.equal(existsSync(path), false);
      writeFileSync(path, "{}\n");
      await assert.rejects(createKodoKernel(s, ctx), /身份无效/);
      assert.equal(readFileSync(path, "utf8"), "{}\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
