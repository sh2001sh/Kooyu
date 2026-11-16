import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { Session, Usage } from "@kodo/protocol";
import { SCHEMA_V1, SCHEMA_V2 } from "../src/storage/schema.js";
import { Store } from "../src/storage/store.js";
import { SessionService } from "../src/session-service.js";
import { createKodoKernel } from "../src/kodo/kernel.js";
import { HARNESS_TOOL_NAMES } from "../src/kodo/tools.js";
import { descriptor, type AdapterContext, type HarnessAdapter } from "../src/harnesses/adapter.js";

test("v2 pi supervisors migrate to Kodo without changing native identity, receipts, control or usage totals", () => {
  const dir = mkdtempSync(join(tmpdir(), "kodo-identity-migration-")),
    path = join(dir, "state.sqlite"),
    old = new DatabaseSync(path);
  const controller = randomUUID(),
    target = randomUUID(),
    profile = randomUUID(),
    commandId = randomUUID(),
    watchId = randomUUID();
  old.exec(SCHEMA_V1);
  old.exec(SCHEMA_V2);
  for (const [id, kind] of [
    [controller, "supervisor"],
    [target, "direct"],
  ]) {
    old
      .prepare("INSERT INTO sessions VALUES (?,?,? ,?,'global',NULL,NULL,'test-host',?)")
      .run(
        id!,
        kind === "supervisor" ? "与 pi 对话" : `preserved ${kind}`,
        "pi",
        kind!,
        new Date().toISOString(),
      );
    const state = {
      id,
      harnessId: "pi",
      kind,
      instanceId: "pi:native",
      nativeSessionId: `native:${id}`,
      profileId: profile,
      profileRevision: 2,
      ownerEpoch: 7,
    };
    old.prepare("INSERT INTO session_state VALUES (?,?)").run(id!, JSON.stringify(state));
    old
      .prepare("INSERT INTO native_identity VALUES ('pi','pi:native',?,?)")
      .run(state.nativeSessionId, id!);
    const event = {
      id: `event:${id}`,
      sessionId: id,
      nativeRunId: null,
      type: "message",
      source: "pi",
      payload: { text: "isolated historical fixture" },
      createdAt: new Date().toISOString(),
    };
    old
      .prepare("INSERT INTO events(id,session_id,data) VALUES (?,?,?)")
      .run(event.id, id!, JSON.stringify(event));
    old
      .prepare("INSERT INTO records VALUES ('usage',?,?)")
      .run(
        `usage:${id}`,
        JSON.stringify({ id: `usage:${id}`, sessionId: id, source: "pi", costUsd: 0.25 }),
      );
  }
  const watch = {
    id: watchId,
    controllerSessionId: controller,
    targetSessionId: target,
    mode: "continue",
    state: "paused",
    generation: 9,
    cursor: "17",
  };
  const command = {
    id: commandId,
    sessionId: target,
    controllerId: controller,
    generation: 7,
    kind: "send",
    status: "unknown",
    body: { text: "never resend this fixture" },
  };
  old
    .prepare("INSERT INTO watches VALUES (?,?,?,'continue','paused',?)")
    .run(watchId, controller, target, JSON.stringify(watch));
  old
    .prepare("INSERT INTO commands VALUES (?,?,'unknown',?)")
    .run(commandId, target, JSON.stringify(command));
  old
    .prepare("INSERT INTO records VALUES ('profile-defaults','global',?)")
    .run(
      JSON.stringify({ productProfileId: null, harnessProfileIds: { pi: profile }, revision: 3 }),
    );
  old.close();
  const store = new Store(path);
  try {
    assert.equal(store.session(controller).harnessId, "kodo");
    assert.equal(store.session(target).harnessId, "pi");
    assert.equal(store.session(controller).title, "与 Kodo 对话");
    assert.equal(store.session(target).title, "preserved direct");
    for (const id of [controller, target]) {
      assert.equal(store.session(id).nativeSessionId, `native:${id}`);
      assert.equal(store.session(id).bindingRevision, null);
      assert.equal(store.session(id).bindingUnavailable, true);
      assert.equal(store.session(id).ownerEpoch, 7);
    }
    assert.equal(store.session(controller).instanceId, "kodo:native");
    assert.equal(store.session(target).instanceId, "pi:native");
    assert.deepEqual(store.watches()[0], watch);
    assert.deepEqual(store.command(commandId), { ...command, bindingRevision: null });
    assert.equal(store.events(controller)[0]?.source, "kodo");
    assert.equal(store.events(target)[0]?.source, "pi");
    const usage = store.records<Usage>("usage");
    assert.equal(
      usage.reduce((n, u) => n + u.costUsd!, 0),
      0.5,
    );
    assert.deepEqual(new Set(usage.map((u) => u.source)), new Set(["kodo", "pi"]));
    assert.deepEqual(store.record<any>("binding-defaults", "global")?.harnessBindingIds, {
      pi: null,
      kodo: null,
    });
    assert.equal(store.db.prepare("PRAGMA foreign_keys").get()?.foreign_keys, 1);
    assert.deepEqual(store.db.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal(
      store.db.prepare("SELECT harness_id FROM native_identity WHERE session_id=?").get(controller)
        ?.harness_id,
      "kodo",
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Kodo alone receives management tools; standalone pi retains a separate instance and defaults", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kodo-tool-identity-")),
    store = new Store(":memory:"),
    contexts = new Map<string, AdapterContext>();
  const adapters: HarnessAdapter[] = ["kodo", "pi"].map((id) => ({
    descriptor: descriptor(
      id as "kodo" | "pi",
      id,
      "sdk",
      [],
      "ISOLATED TEST PEER; no model calls",
      "implemented",
    ),
    async connect(s, ctx) {
      contexts.set(s.id, ctx);
      return {
        nativeSessionId: randomUUID(),
        async send() {
          return { nativeRunId: null };
        },
        async cancel() {},
        async close() {},
      };
    },
  }));
  const service = new SessionService(store, { dataDir: dir, adapters });
  try {
    const kodo = service.createDraft({ title: "Kodo", harnessId: "kodo", kind: "supervisor" }),
      pi = service.createDraft({ title: "pi", harnessId: "pi", kind: "direct" });
    await service.openNative(kodo.id);
    await service.openNative(pi.id);
    assert.deepEqual(
      contexts
        .get(kodo.id)
        ?.tools?.map((t) => t.name)
        .sort(),
      [
        ...HARNESS_TOOL_NAMES,
        "web_fetch",
        "goal",
        "files",
        "automation",
        "memory",
        "applications",
        "outbound",
        ...(service.browser.status().available ? ["browser"] : []),
      ].sort(),
    );
    assert.equal(contexts.get(pi.id)?.tools, undefined);
    assert.notEqual(kodo.instanceId, pi.instanceId);
    assert.equal(kodo.bindingId, null);
    assert.equal(pi.bindingId, null);
    assert.throws(
      () => service.createDraft({ title: "pi is not Kodo", harnessId: "pi", kind: "supervisor" }),
      /主对话使用 Kooyu/,
    );
  } finally {
    await service.dispose();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Kodo SDK kernel restores the legacy pi log and keeps standalone pi history separate without model calls", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kodo-sdk-legacy-")),
    legacyDir = join(dir, "pi", "sessions");
  mkdirSync(legacyDir, { recursive: true });
  const manager = SessionManager.create(dir, legacyDir);
  manager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "ISOLATED SYNTHETIC HISTORY FIXTURE" }],
    api: "openai-responses",
    provider: "openai",
    model: "gpt-5",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  });
  const sessionId = randomUUID(),
    nativeId = manager.getSessionId(),
    nativePath = manager.getSessionFile()!;
  writeFileSync(join(legacyDir, `${sessionId}.json`), JSON.stringify({ path: nativePath }));
  const ctx: AdapterContext = {
    cwd: dir,
    dataDir: dir,
    env: {},
    launch: { command: "kodo-sdk", args: [] },
    configuration: {
      id: randomUUID(),
      revision: 1,
      name: "offline kernel test",
      provider: "openai",
      model: "gpt-5",
      protocol: "openai-responses",
      credentialRef: null,
    },
    emit() {},
    async interact() {
      return {};
    },
    sdkSessionOwners: () => ({ [nativeId]: "kodo" }),
  };
  let kodo, pi;
  try {
    kodo = await createKodoKernel(
      {
        id: sessionId,
        harnessId: "kodo",
        kind: "supervisor",
        nativeSessionId: nativeId,
      } as Session,
      ctx,
    );
    assert.equal(kodo.nativeSessionId, nativeId);
    assert.ok(JSON.stringify(await kodo.read!()).includes("ISOLATED SYNTHETIC HISTORY FIXTURE"));
    assert.equal(
      JSON.parse(readFileSync(join(dir, "kodo", "sessions", `${sessionId}.json`), "utf8")).path,
      nativePath,
    );
    assert.ok(((await kodo.list!()) as any[]).some((s) => s.id === nativeId));
    pi = await createKodoKernel(
      { id: randomUUID(), harnessId: "pi", kind: "direct", nativeSessionId: null } as Session,
      ctx,
    );
    assert.notEqual(pi.nativeSessionId, nativeId);
    assert.equal(
      ((await pi.list!()) as any[]).some((s) => s.id === nativeId),
      false,
    );
  } finally {
    await kodo?.close();
    await pi?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Kodo role prompt states scope: project conversations stay in project, global ones span projects", async () => {
  const { kodoRolePrompt } = await import("../src/kodo/kernel.js");
  const project = kodoRolePrompt({ scope: "project", projectId: "p-1" });
  assert.match(project, /PROJECT main conversation/);
  assert.match(project, /p-1/);
  const global = kodoRolePrompt({ scope: "global", projectId: null });
  assert.match(global, /GLOBAL main conversation/);
  assert.match(global, /not a project scope/);
  for (const role of ["Session manager", "Progress reporter", "Goal supervisor", "Orchestrator"])
    assert.match(global, new RegExp(role));
});
