import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Session } from "@kodo/protocol";
import { SessionService } from "../src/session-service.js";
import { Store } from "../src/storage/store.js";
import { descriptor, type HarnessAdapter } from "../src/harnesses/adapter.js";
import { codexAdapter } from "../src/harnesses/codex.js";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "kodo-sidebar-actions-"));
  const store = new Store(":memory:");
  const states: Record<string, "present" | "missing" | "unknown"> = {};
  let unavailable = false;
  const adapter: HarnessAdapter = {
    descriptor: descriptor(
      "codex",
      "Codex test",
      "app-server",
      ["resume"],
      "synthetic",
      "implemented",
    ),
    async inspectSessions(sessions) {
      if (unavailable) throw new Error("temporarily unavailable");
      return Object.fromEntries(
        sessions.map((session) => [
          session.nativeSessionId!,
          states[session.nativeSessionId!] ?? "unknown",
        ]),
      );
    },
    async connect(session) {
      return {
        nativeSessionId: session.nativeSessionId ?? "native",
        async send() {
          return { nativeRunId: null };
        },
        async cancel() {},
        async close() {},
      };
    },
  };
  const service = new SessionService(store, {
    dataDir: join(directory, "host"),
    adapters: [adapter],
  });
  const createNative = (id: string) => {
    const draft = service.createDraft({ title: id, harnessId: "codex", kind: "direct" });
    const session: Session = { ...draft, phase: "native", nativeSessionId: id };
    store.saveSession(session);
    return session;
  };
  return {
    directory,
    store,
    service,
    states,
    createNative,
    setUnavailable(value: boolean) {
      unavailable = value;
    },
    async close() {
      await service.dispose();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("sidebar project rename/pin/archive are persistent, scoped and atomic", async () => {
  const f = fixture();
  try {
    const project = f.service.createProject({ name: "Before", rootPath: f.directory });
    const other = f.service.createProject({ name: "Other" });
    const session = f.service.createDraft({
      title: "Project chat",
      harnessId: "codex",
      projectId: project.id,
      kind: "direct",
    });
    const unrelated = f.service.createDraft({
      title: "Other chat",
      harnessId: "codex",
      projectId: other.id,
      kind: "direct",
    });
    f.service.updateSession(session.id, { pinned: true, unread: true });
    const extra = join(f.directory, "extra");
    mkdirSync(extra);
    const changed = f.service.updateProject(project.id, {
      name: "  Renamed  ",
      pinned: true,
      rootPath: extra,
    });
    assert.equal(changed.name, "Renamed");
    assert.equal(changed.pinned, true);
    assert.equal(
      f.store.workspaces().filter((workspace) => workspace.projectId === project.id).length,
      2,
    );
    assert.equal(f.store.session(session.id).workspaceId, session.workspaceId);
    assert.throws(() =>
      f.service.updateProject(project.id, {
        name: "Wrong",
        rootPath: join(f.directory, "missing"),
      }),
    );
    assert.equal(f.store.projects().find((item) => item.id === project.id)!.name, "Renamed");
    assert.throws(() => f.service.updateProject(project.id, { name: "  " }));
    assert.throws(() => f.service.updateProject(project.id, { unexpected: true }));
    f.service.updateProject(project.id, { archiveSessions: true });
    assert.equal(f.store.session(session.id).archived, true);
    assert.equal(f.store.session(unrelated.id).archived, false);
    f.service.updateSession(session.id, { archived: false, unread: false });
    assert.equal(f.store.session(session.id).pinned, true);
    assert.equal(f.store.session(session.id).archived, false);
    assert.equal(f.store.session(session.id).unread, false);
  } finally {
    await f.close();
  }
});

test("confirmed native deletion removes a stale Codex record and search; deletion receipts survive", async () => {
  const f = fixture();
  try {
    const session = f.createNative("deleted-externally");
    f.states[session.nativeSessionId!] = "present";
    assert.equal((await f.service.syncNativeSessions()).checked, 1);
    f.store.saveSession({ ...f.store.session(session.id), runState: "unknown" });
    f.states[session.nativeSessionId!] = "missing";
    assert.deepEqual((await f.service.syncNativeSessions()).removed, []);
    assert.equal(f.service.snapshot().sessions.length, 1);
    const missing = f.store.record<object>("native-missing-confirmation", session.id)!;
    f.store.put("native-missing-confirmation", session.id, {
      ...missing,
      firstMissingAt: Date.now() - 6000,
    });
    const result = await f.service.syncNativeSessions();
    assert.deepEqual(result.removed, [session.id]);
    assert.equal(f.service.snapshot().sessions.length, 0);
    assert.equal(f.service.search(session.title).sessions.length, 0);
    assert.throws(() => f.service.read(session.id), /不存在/);
    const receipt = await f.service.deleteSession(session.id);
    assert.equal(receipt.nativeMissing, true);
    assert.equal(receipt.nativeDeleted, false);
    assert.deepEqual(await f.service.deleteSession(session.id), receipt);
    f.store.recover();
    assert.equal(f.service.snapshot().sessions.length, 0);
    assert.equal(f.service.ingest(session.id, "settled", {}, "late"), undefined);
  } finally {
    await f.close();
  }
});

test("native sync preserves archive, empty drafts, uncertain reads and live sessions", async () => {
  const f = fixture();
  try {
    const archived = f.createNative("archived");
    const empty = f.createNative("empty-unpersisted");
    const uncertain = f.createNative("uncertain");
    const live = f.createNative("live");
    f.service.updateSession(archived.id, { archived: true });
    f.states.archived = "present";
    f.states[empty.nativeSessionId!] = "missing";
    f.states.uncertain = "unknown";
    f.states.live = "missing";
    f.store.put("native-storage-seen", live.id, { at: new Date().toISOString() });
    await f.service.openNative(live.id);
    f.store.saveSession({ ...f.store.session(live.id), runState: "running" });
    assert.deepEqual((await f.service.syncNativeSessions()).removed, []);
    assert.equal(f.store.session(archived.id).archived, true);
    assert.equal(f.store.session(uncertain.id).nativeSessionId, "uncertain");
    assert.equal(f.service.snapshot().sessions.length, 4);
    f.setUnavailable(true);
    assert.deepEqual((await f.service.syncNativeSessions()).removed, []);
    assert.equal(f.service.snapshot().sessions.length, 4);
  } finally {
    await f.close();
  }
});

test("explicit removal of an unpersisted missing native thread cannot get stuck on stale run state", async () => {
  const f = fixture();
  try {
    const session = f.createNative("never-persisted");
    f.store.saveSession({ ...session, runState: "unknown" });
    f.states[session.nativeSessionId!] = "missing";
    assert.deepEqual((await f.service.syncNativeSessions()).removed, []);
    assert.equal(f.service.snapshot().sessions.length, 1);
    assert.equal((await f.service.deleteSession(session.id)).nativeMissing, true);
    assert.equal(f.service.snapshot().sessions.length, 0);
  } finally {
    await f.close();
  }
});

test("project removal keeps/restores conversations or explicitly deletes locally without touching files", async () => {
  const f = fixture();
  try {
    const keep = join(f.directory, "keep");
    mkdirSync(keep);
    writeFileSync(join(keep, "source.txt"), "preserve");
    const project = f.service.createProject({ name: "Removable", rootPath: keep });
    const session = f.service.createDraft({
      title: "Kept",
      harnessId: "codex",
      kind: "direct",
      projectId: project.id,
    });
    await f.service.deleteProject(project.id, "keep");
    assert.equal(
      f.service.snapshot().projects.some((item) => item.id === project.id),
      false,
    );
    assert.equal(f.store.session(session.id).title, "Kept");
    const workspace = f.store.workspaces().find((item) => item.projectId === project.id)!;
    f.service.createDraft({
      title: "Reopen folder",
      harnessId: "codex",
      kind: "direct",
      workspaceId: workspace.id,
    });
    assert.equal(
      f.service.snapshot().projects.some((item) => item.id === project.id),
      true,
    );
    await f.service.deleteProject(project.id, "delete");
    assert.equal(
      f.service.snapshot().sessions.some((item) => item.projectId === project.id),
      false,
    );
    assert.equal(readFileSync(join(keep, "source.txt"), "utf8"), "preserve");
  } finally {
    await f.close();
  }
});

test("Codex status probing distinguishes definitive absence from archive and operational failures", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kodo-codex-status-"));
  const log = join(directory, "calls.log");
  try {
    const ids = [
      "present",
      "missing",
      "permission",
      "wrong-id",
      "transport-error",
      "archived",
      "unloaded-present",
      "unloaded-archived",
      "unloaded-deleted",
      "read-only-present",
    ];
    const states = await codexAdapter.inspectSessions!(
      ids.map((nativeSessionId) => ({ nativeSessionId }) as Session),
      {
        cwd: directory,
        dataDir: directory,
        env: { ...process.env, CODEX_HOME: directory, STATUS_CALL_LOG: log },
        launch: {
          command: process.execPath,
          args: [fileURLToPath(new URL("./fixtures/codex-status-peer.mjs", import.meta.url))],
        },
        emit() {},
        async interact() {
          return {};
        },
      },
    );
    assert.deepEqual(states, {
      present: "present",
      missing: "missing",
      permission: "unknown",
      "wrong-id": "unknown",
      "transport-error": "unknown",
      archived: "present",
      "unloaded-present": "present",
      "unloaded-archived": "present",
      "unloaded-deleted": "missing",
      "read-only-present": "present",
    });
    assert(
      readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .every((method) =>
          ["initialize", "initialized", "thread/list", "thread/read"].includes(method),
        ),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("uncertain native scans and restored history reset consecutive deletion confirmation", async () => {
  const f = fixture();
  try {
    const session = f.createNative("transiently-missing");
    f.store.put("native-storage-seen", session.id, { at: new Date().toISOString() });
    const ageConfirmation = () =>
      f.store.put("native-missing-confirmation", session.id, {
        ...f.store.record<object>("native-missing-confirmation", session.id),
        nativeSessionId: session.nativeSessionId,
        firstMissingAt: Date.now() - 6000,
        checkedAt: Date.now(),
      });
    for (const recovered of ["present", "unknown", "unavailable"] as const) {
      f.states[session.nativeSessionId!] = "missing";
      ageConfirmation();
      f.setUnavailable(recovered === "unavailable");
      if (recovered !== "unavailable") f.states[session.nativeSessionId!] = recovered;
      assert.deepEqual((await f.service.syncNativeSessions()).removed, []);
      assert.equal(f.store.record("native-missing-confirmation", session.id), undefined);
      f.setUnavailable(false);
      f.states[session.nativeSessionId!] = "missing";
      assert.deepEqual((await f.service.syncNativeSessions()).removed, []);
    }
    assert.equal(f.service.snapshot().sessions.length, 1);
  } finally {
    await f.close();
  }
});

test("incomplete Codex listings never prove deletion even when thread/read reports absence", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kodo-codex-incomplete-"));
  try {
    for (const mode of ["permission", "malformed", "repeated-cursor"]) {
      const states = await codexAdapter.inspectSessions!(
        [
          { nativeSessionId: "missing" } as Session,
          { nativeSessionId: "unloaded-deleted" } as Session,
        ],
        {
          cwd: directory,
          dataDir: directory,
          env: { ...process.env, CODEX_HOME: directory, STATUS_LIST_MODE: mode },
          launch: {
            command: process.execPath,
            args: [fileURLToPath(new URL("./fixtures/codex-status-peer.mjs", import.meta.url))],
          },
          emit() {},
          async interact() {
            return {};
          },
        },
      );
      assert.deepEqual(states, { missing: "unknown", "unloaded-deleted": "unknown" }, mode);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
