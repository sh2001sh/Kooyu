import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  renameSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { HARNESS_IDS, type Session } from "@kodo/protocol";
import { SessionService } from "../src/session-service.js";
import { Store } from "../src/storage/store.js";
import { adapters } from "../src/harnesses/registry.js";
import { descriptor, type AdapterContext, type HarnessAdapter } from "../src/harnesses/adapter.js";
import {
  nativeStorageEnvironment,
  type SessionPresence,
} from "../src/harnesses/session-presence.js";

const peer = fileURLToPath(new URL("./fixtures/session-presence-peer.mjs", import.meta.url));
const session = (harnessId: Session["harnessId"], nativeSessionId: string, id = nativeSessionId) =>
  ({ id, harnessId, nativeSessionId }) as Session;
const adapter = (id: Session["harnessId"]) => adapters.find((item) => item.descriptor.id === id)!;
const write = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value));
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "kodo-native-presence-"));
  const log = join(dir, "calls.jsonl");
  const ctx: AdapterContext = {
    cwd: dir,
    dataDir: dir,
    env: {
      ...process.env,
      PRESENCE_LOG: log,
      USERPROFILE: dir,
      HOME: dir,
      CLAUDE_CONFIG_DIR: dir,
      GEMINI_CLI_HOME: dir,
      GROK_HOME: dir,
      DSH_HOME: dir,
    },
    launch: { command: process.execPath, args: [peer] },
    emit() {
      assert.fail("inspection emitted a live event");
    },
    async interact() {
      assert.fail("inspection opened an interaction");
    },
  };
  return {
    dir,
    log,
    ctx,
    close: () => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 30 }),
  };
}

test("every registered harness provides a deletion inspection boundary", () => {
  for (const id of HARNESS_IDS) assert.equal(typeof adapter(id).inspectSessions, "function", id);
  const env = nativeStorageEnvironment("opencode", {
    XDG_DATA_HOME: "pinned-data",
    OPENAI_API_KEY: "never-copy",
    HOME: "native-home",
  });
  assert.equal(env.XDG_DATA_HOME, "pinned-data");
  assert.equal(env.OPENAI_API_KEY, undefined);
});

test("Claude inspects every project and preserves archived/logged files, unavailable roots and malformed IDs", async () => {
  const f = fixture();
  try {
    const active = randomUUID(),
      archived = randomUUID(),
      missing = randomUUID();
    const root = join(f.dir, "projects", "another-worktree");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, active + ".jsonl"), "active");
    writeFileSync(join(root, archived + ".jsonl"), "archived retains transcript");
    const sessions = [active, archived, missing, "../../escape"].map((id) =>
      session("claude-code", id),
    );
    assert.deepEqual(await adapter("claude-code").inspectSessions!(sessions, f.ctx), {
      [active]: "present",
      [archived]: "present",
      [missing]: "missing",
      "../../escape": "unknown",
    });
    renameSync(join(f.dir, "projects"), join(f.dir, "offline-projects"));
    assert.equal(
      (await adapter("claude-code").inspectSessions!(sessions, f.ctx))[active],
      "unknown",
    );
  } finally {
    f.close();
  }
});

for (const id of ["pi", "kodo"] as const)
  test(
    id + " checks exact log identity and preserves renamed, corrupt and unmapped logs",
    async () => {
      const f = fixture();
      try {
        const root = join(f.dir, id === "kodo" ? "pi" : id, "sessions");
        mkdirSync(root, { recursive: true });
        const path = join(root, "native.jsonl"),
          mapping = join(root, "product.json");
        writeFileSync(path, JSON.stringify({ type: "session", id: "native" }) + "\n");
        write(mapping, { path });
        const s = session(id, "native", "product"),
          probe = () => adapter(id).inspectSessions!([s], f.ctx);
        assert.equal((await probe()).native, "present");
        const renamed = join(root, "renamed.jsonl");
        renameSync(path, renamed);
        assert.equal((await probe()).native, "present");
        rmSync(renamed);
        assert.equal((await probe()).native, "missing");
        writeFileSync(path, "corrupt\n");
        assert.equal((await probe()).native, "unknown");
        rmSync(mapping);
        assert.equal((await probe()).native, "unknown");
        assert.equal(readFileSync(path, "utf8"), "corrupt\n");
      } finally {
        f.close();
      }
    },
  );

test("Gemini uses the correct project and treats partial or unsupported history as unknown", async () => {
  const f = fixture();
  try {
    const root = join(f.dir, ".gemini"),
      chats = join(root, "tmp", "project", "chats");
    mkdirSync(chats, { recursive: true });
    write(join(root, "projects.json"), { projects: { [f.dir]: "project" } });
    const path = join(chats, "session-native.jsonl");
    writeFileSync(path, JSON.stringify({ sessionId: "native" }) + "\n");
    const sessions = ["native", "missing"].map((id) => session("gemini", id));
    const probe = () => adapter("gemini").inspectSessions!(sessions, f.ctx);
    assert.deepEqual(await probe(), { native: "present", missing: "missing" });
    writeFileSync(join(chats, "session-partial.jsonl"), "{");
    assert.deepEqual(await probe(), { native: "present", missing: "unknown" });
    rmSync(join(chats, "session-partial.jsonl"));
    write(join(chats, "session-legacy.json"), {});
    assert.equal((await probe()).missing, "unknown");
    f.ctx.cwd = join(f.dir, "another-project");
    assert.equal((await probe()).native, "unknown");
  } finally {
    f.close();
  }
});

test("Kimi scans both active and archive across all projects; capped and failed lists cannot erase records", async () => {
  const f = fixture();
  try {
    f.ctx.launch.args.push("acp");
    const sessions = ["present", "archived", "missing"].map((id) => session("kimi-code", id));
    const probe = () => adapter("kimi-code").inspectSessions!(sessions, f.ctx);
    assert.deepEqual(await probe(), {
      present: "present",
      archived: "present",
      missing: "missing",
    });
    for (const mode of ["limit", "failure", "malformed"]) {
      f.ctx.env.PRESENCE_CASE = mode;
      assert.equal((await probe()).missing, "unknown", mode);
    }
    const calls = readFileSync(f.log, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert(calls.every((call) => call.args.includes("--all") && call.args.includes("--json")));
    assert(calls.some((call) => !call.args.includes("--archived")));
  } finally {
    f.close();
  }
});

test("ZCode reconciles exact IDs, distinguishes soft deletion and preserves malformed or failed reads", async () => {
  const f = fixture();
  try {
    const sessions = ["present", "archived", "missing", "deleted", "omitted", "malformed"].map(
      (id) => session("zcode", id),
    );
    const probe = () => adapter("zcode").inspectSessions!(sessions, f.ctx);
    assert.deepEqual(await probe(), {
      present: "present",
      archived: "present",
      missing: "missing",
      deleted: "missing",
      omitted: "unknown",
      malformed: "unknown",
    });
    f.ctx.env.PRESENCE_CASE = "failure";
    assert(Object.values(await probe()).every((state) => state === "unknown"));
    assert(
      readFileSync(f.log, "utf8")
        .trim()
        .split("\n")
        .every((line) => JSON.parse(line).method === "v4/sessionsIndex/reconcile"),
    );
  } finally {
    f.close();
  }
});

test("OpenCode performs exact HTTP reads; archive is present, only 404 means missing", async () => {
  const f = fixture();
  try {
    const sessions = ["present", "archived", "missing", "permission", "error", "wrong-id"].map(
      (id) => session("opencode", id),
    );
    assert.deepEqual(await adapter("opencode").inspectSessions!(sessions, f.ctx), {
      present: "present",
      archived: "present",
      missing: "missing",
      permission: "unknown",
      error: "unknown",
      "wrong-id": "unknown",
    });
    assert(
      readFileSync(f.log, "utf8")
        .trim()
        .split("\n")
        .every((line) => JSON.parse(line).method === "GET"),
    );
  } finally {
    f.close();
  }
});

for (const id of ["cursor", "grok-build"] as const)
  test(
    id +
      " local fallback keeps archived files and missing roots, without creating or resuming a session",
    async () => {
      const f = fixture();
      try {
        const present = randomUUID(),
          missing = randomUUID();
        const root =
          id === "cursor"
            ? join(f.dir, ".cursor", "acp-sessions")
            : join(f.dir, "sessions", encodeURIComponent(f.dir));
        const dir = join(root, present);
        mkdirSync(dir, { recursive: true });
        write(
          join(dir, id === "cursor" ? "meta.json" : "summary.json"),
          id === "cursor"
            ? { schemaVersion: 1, cwd: f.dir, archived: true }
            : { info: { id: present, cwd: f.dir }, archived: true },
        );
        const sessions = [present, missing].map((nativeId) => session(id, nativeId));
        const probe = () => adapter(id).inspectSessions!(sessions, f.ctx);
        assert.deepEqual(await probe(), { [present]: "present", [missing]: "missing" });
        renameSync(root, root + "-offline");
        assert.equal((await probe())[missing], "unknown");
        assert(
          readFileSync(f.log, "utf8")
            .trim()
            .split("\n")
            .every((line) => JSON.parse(line).method === "initialize"),
        );
      } finally {
        f.close();
      }
    },
  );

test("DeepSeek scans durable generations across projects; archive, compressed logs and custom profiles are safe", async () => {
  const f = fixture();
  try {
    const dir = join(f.dir, "sessions", "--other-project--", "archived");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "session.v4.jsonl.gz"), "compressed native log");
    f.ctx.launch.args = ["--profile", "sdk"];
    const sessions = ["archived", "missing"].map((id) => session("deepseek-harness", id));
    assert.deepEqual(await adapter("deepseek-harness").inspectSessions!(sessions, f.ctx), {
      archived: "present",
      missing: "missing",
    });
    f.ctx.launch.args = ["--profile", "custom"];
    assert.equal(
      (await adapter("deepseek-harness").inspectSessions!(sessions, f.ctx)).missing,
      "unknown",
    );
    assert.equal(existsSync(f.log), false);
  } finally {
    f.close();
  }
});

for (const id of HARNESS_IDS)
  test(
    id +
      " lifecycle: archive/restore, consecutive native deletion, idempotence and late-event fence",
    async () => {
      const f = fixture(),
        store = new Store(":memory:");
      let state: SessionPresence = "present";
      const synthetic: HarnessAdapter = {
        descriptor: descriptor(id, id, "sdk", [], "isolated lifecycle contract", "implemented"),
        async connect() {
          assert.fail("inspection opened a live runtime");
        },
        async inspectSessions(sessions) {
          return Object.fromEntries(sessions.map((s) => [s.nativeSessionId!, state]));
        },
      };
      const service = new SessionService(store, { dataDir: f.dir, adapters: [synthetic] });
      try {
        const draft = service.createDraft({
          title: "lifecycle",
          harnessId: id,
          kind: id === "kodo" ? "supervisor" : "direct",
        });
        store.saveSession({ ...draft, nativeSessionId: "native", phase: "native" });
        await service.syncNativeSessions();
        service.updateSession(draft.id, { archived: true });
        assert.deepEqual((await service.syncNativeSessions()).removed, []);
        assert.equal(store.session(draft.id).archived, true);
        service.updateSession(draft.id, { archived: false });
        assert.equal(store.session(draft.id).archived, false);
        state = "unknown";
        assert.deepEqual((await service.syncNativeSessions()).removed, []);
        state = "missing";
        assert.deepEqual((await service.syncNativeSessions()).removed, []);
        store.put("native-missing-confirmation", draft.id, {
          ...store.record<object>("native-missing-confirmation", draft.id),
          nativeSessionId: "native",
          firstMissingAt: Date.now() - 6000,
          checkedAt: Date.now(),
        });
        assert.deepEqual((await service.syncNativeSessions()).removed, [draft.id]);
        const receipt = await service.deleteSession(draft.id);
        assert.equal(receipt.nativeMissing, true);
        assert.deepEqual(await service.deleteSession(draft.id), receipt);
        assert.equal(service.ingest(draft.id, "settled", {}, "late"), undefined);
        assert.equal(service.snapshot().sessions.length, 0);
        const blank = service.createDraft({
          title: "unpersisted native",
          harnessId: id,
          kind: id === "kodo" ? "supervisor" : "direct",
        });
        store.saveSession({
          ...blank,
          nativeSessionId: "blank-native",
          phase: "native",
          runState: "unknown",
        });
        assert.equal((await service.deleteSession(blank.id)).nativeMissing, true);
        assert.equal(service.snapshot().sessions.length, 0);
      } finally {
        await service.dispose();
        store.close();
        f.close();
      }
    },
  );
