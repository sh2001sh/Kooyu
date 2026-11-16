import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { HarnessBinding } from "@kodo/protocol";
import { Store } from "../src/storage/store.js";
import { SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4 } from "../src/storage/schema.js";
import { SessionService } from "../src/session-service.js";
import { collectProviderCredentials } from "../src/configuration/config.js";

function binding(harnessId: HarnessBinding["harnessId"]): HarnessBinding {
  return {
    id: randomUUID(),
    revision: 1,
    name: "Synthetic binding",
    harnessId,
    providerId: randomUUID(),
    providerRevision: 1,
    endpointId: randomUUID(),
    modelId: randomUUID(),
    modelRevision: 1,
    model: "synthetic-model",
    reasoning: null,
    route: "direct",
    protocol: "openai-responses",
    parameters: {},
    sources: {},
    updatedAt: new Date().toISOString(),
  };
}

test("binding defaults inherit by harness and project; explicit native opt-out is pinned", async () => {
  const store = new Store(":memory:");
  const service = new SessionService(store);
  try {
    const global = binding("codex"),
      projectBinding = binding("codex");
    for (const item of [global, projectBinding]) {
      store.put("harness-binding", item.id, item);
      store.put("harness-binding-revision", `${item.id}:1`, item);
    }
    const project = service.createProject({ name: "Scope" });
    service.updateBindingDefaults({ expectedRevision: 0, harnessBindingIds: { codex: global.id } });
    service.updateProjectDefaults(project.id, {
      expectedRevision: 0,
      bindingDefaults: { codex: projectBinding.id },
    });
    const create = (extra: object = {}) =>
      service.createDraft({
        title: "Synthetic",
        harnessId: "codex",
        kind: "direct",
        ...extra,
      });
    assert.equal(create().bindingId, global.id);
    assert.equal(create({ projectId: project.id }).bindingId, projectBinding.id);
    assert.equal(create({ projectId: project.id, bindingId: global.id }).bindingId, global.id);
    assert.equal(create({ projectId: project.id, bindingId: null }).bindingId, null);
    assert.throws(() => create({ bindingId: randomUUID() }), /绑定不存在/);
    assert.throws(
      () =>
        service.updateBindingDefaults({
          expectedRevision: 0,
          harnessBindingIds: {},
        }),
      /已更新/,
    );
    assert.equal(store.records("profile").length, 0);
    assert.equal(store.records("profile-revision").length, 0);
  } finally {
    await service.dispose();
    store.close();
  }
});

test("credential GC retains current and session-pinned Provider revisions", async () => {
  const store = new Store(":memory:");
  const removed: string[] = [];
  try {
    const item = binding("codex");
    const oldRef = "synthetic-old",
      currentRef = "synthetic-current",
      orphan = "synthetic-orphan";
    const provider = {
      id: item.providerId,
      revision: 1,
      name: "Synthetic",
      endpoints: [
        {
          id: item.endpointId,
          name: "Endpoint",
          protocol: "openai-responses",
          baseUrl: "http://127.0.0.1:1/v1",
          credentialRef: oldRef,
        },
      ],
      updatedAt: new Date().toISOString(),
    };
    store.put("provider-revision", `${provider.id}:1`, provider);
    store.put("provider", provider.id, {
      ...provider,
      revision: 2,
      endpoints: [{ ...provider.endpoints[0], credentialRef: currentRef }],
    });
    store.put("harness-binding", item.id, item);
    store.put("harness-binding-revision", `${item.id}:1`, item);
    for (const ref of [oldRef, currentRef, orphan])
      store.put("credential-owned", ref, { ref, state: "stored" });
    const service = new SessionService(store);
    try {
      service.createDraft({
        title: "Pinned",
        harnessId: "codex",
        kind: "direct",
        bindingId: item.id,
      });
      await collectProviderCredentials(store, {
        set: async () => {},
        delete: async (ref) => {
          removed.push(ref);
        },
      });
      assert.deepEqual(removed, [orphan]);
    } finally {
      await service.dispose();
    }
  } finally {
    store.close();
  }
});

test("v5 migrates mirrored binding IDs, preserves history, and removes old configuration records", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kodo-binding-v5-"));
  const path = join(dir, "state.sqlite");
  const old = new DatabaseSync(path);
  const item = binding("codex");
  const profileId = randomUUID();
  const sessionId = randomUUID();
  const commandId = randomUUID();
  try {
    old.exec(SCHEMA_V1);
    old.exec(SCHEMA_V2);
    old.exec(SCHEMA_V3);
    old.exec(SCHEMA_V4);
    old
      .prepare("INSERT INTO sessions VALUES (?,?,'codex','direct','global',NULL,NULL,'old-host',?)")
      .run(sessionId, "历史会话", new Date().toISOString());
    old.prepare("INSERT INTO session_state VALUES (?,?)").run(
      sessionId,
      JSON.stringify({
        id: sessionId,
        harnessId: "codex",
        kind: "direct",
        instanceId: "codex:old",
        nativeSessionId: "native-old",
        profileId,
        profileRevision: 1,
      }),
    );
    old.prepare("INSERT INTO events(id,session_id,data) VALUES (?,?,?)").run(
      randomUUID(),
      sessionId,
      JSON.stringify({
        id: randomUUID(),
        sessionId,
        type: "message",
        payload: { text: "历史保留" },
      }),
    );
    old.prepare("INSERT INTO commands VALUES (?,?,'confirmed',?)").run(
      commandId,
      sessionId,
      JSON.stringify({
        id: commandId,
        sessionId,
        kind: "send",
        status: "confirmed",
        profileRevision: 1,
      }),
    );
    const put = (kind: string, id: string, data: object) =>
      old.prepare("INSERT INTO records VALUES (?,?,?)").run(kind, id, JSON.stringify(data));
    put("harness-binding", item.id, { ...item, profileId });
    put("harness-binding-revision", `${item.id}:1`, { ...item, profileId });
    put("provider", item.providerId, {
      id: item.providerId,
      revision: 1,
      legacyProfileId: profileId,
    });
    put("profile", profileId, { id: profileId });
    put("profile-revision", `${profileId}:1`, { id: profileId });
    put("profile-defaults", "global", { harnessProfileIds: { codex: profileId }, revision: 4 });
    put("usage", "old-usage", { id: "old-usage", sessionId, profileId, costUsd: 1 });
  } finally {
    old.close();
  }
  const store = new Store(path);
  const service = new SessionService(store);
  try {
    const migrated = store.session(sessionId);
    assert.equal(migrated.bindingId, item.id);
    assert.equal(migrated.bindingRevision, 1);
    assert.equal(migrated.bindingUnavailable, true);
    assert.equal(migrated.nativeSessionId, "native-old");
    assert.equal(store.events(sessionId).length, 1);
    assert.equal(store.command(commandId)?.bindingRevision, 1);
    assert.equal(store.record<any>("binding-defaults", "global")?.harnessBindingIds.codex, item.id);
    assert.equal(store.records<any>("usage")[0]?.bindingId, item.id);
    assert.equal(store.record<any>("harness-binding", item.id)?.profileId, undefined);
    assert.equal(store.record<any>("provider", item.providerId)?.legacyProfileId, undefined);
    for (const kind of ["profile", "profile-revision", "profile-defaults", "provider-legacy"])
      assert.equal(store.records(kind).length, 0);
    await assert.rejects(service.openNative(sessionId), /需创建新会话/);
    assert.equal(store.db.prepare("PRAGMA user_version").get()?.user_version, 9);
  } finally {
    await service.dispose();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("v6 renames stored kernel tool modes to kodo-tools-* without touching other sessions", () => {
  const dir = mkdtempSync(join(tmpdir(), "kodo-kernel-v6-"));
  const path = join(dir, "state.sqlite");
  const first = new Store(path);
  const ids = { kodo: randomUUID(), pi: randomUUID(), codex: randomUUID() };
  try {
    for (const [harness, id] of Object.entries(ids)) {
      first.db
        .prepare(`INSERT INTO sessions VALUES (?,?,?,?,'global',NULL,NULL,'h',?)`)
        .run(
          id,
          harness,
          harness,
          harness === "kodo" ? "supervisor" : "direct",
          new Date().toISOString(),
        );
      first.db.prepare("INSERT INTO session_state VALUES (?,?)").run(
        id,
        JSON.stringify({
          id,
          harnessId: harness,
          permissionMode:
            harness === "kodo" ? "pi-tools-read" : harness === "pi" ? "pi-tools-none" : "read-only",
        }),
      );
    }
    first.db.exec("PRAGMA user_version = 5");
  } finally {
    first.close();
  }
  const store = new Store(path);
  try {
    assert.equal(store.session(ids.kodo).permissionMode, "kodo-tools-read");
    assert.equal(store.session(ids.pi).permissionMode, "kodo-tools-none");
    assert.equal(store.session(ids.codex).permissionMode, "read-only");
    assert.equal(store.db.prepare("PRAGMA user_version").get()!.user_version, 9);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
