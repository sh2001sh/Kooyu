import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SessionService } from "../src/session-service.js";
import { Store } from "../src/storage/store.js";
import { workspaceGit } from "../src/workspaces/git.js";

function initRepo(dir: string) {
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", windowsHide: true }).trim();
  git("init", "-q");
  git("config", "user.name", "Kooyu Test");
  git("config", "user.email", "test@kooyu.invalid");
  git("config", "core.autocrlf", "false");
  writeFileSync(join(dir, "app.ts"), "export const v = 1;\n");
  git("add", "app.ts");
  git("commit", "-m", "initial");
  return git;
}

test("workspaceGit supports suggest-message and audited discard-file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kooyu-p2-git-"));
  const repoDir = join(dir, "repo");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(repoDir);
  initRepo(repoDir);
  const store = new Store(join(dir, "kodo.sqlite"));
  const service = new SessionService(store, { dataDir: dir, adapters: [] });
  try {
    const project = service.createProject({ name: "Git P2", rootPath: repoDir });
    const workspace = store.workspaces().find((w) => w.projectId === project.id)!;

    writeFileSync(join(repoDir, "app.ts"), "export const v = 2;\n");
    const suggested = (await workspaceGit(
      service,
      workspace,
      "suggest-message",
      {},
      "desktop",
    )) as { message: string; scope: string };
    assert.equal(suggested.scope, "working");
    assert.match(suggested.message, /app\.ts/);

    await workspaceGit(service, workspace, "stage", { path: "app.ts" }, "desktop");
    const stagedSuggested = (await workspaceGit(
      service,
      workspace,
      "suggest-message",
      {},
      "desktop",
    )) as { message: string; scope: string };
    assert.equal(stagedSuggested.scope, "staged");
    assert.match(stagedSuggested.message, /app\.ts/);

    await workspaceGit(
      service,
      workspace,
      "discard-file",
      { path: "app.ts", confirmed: true },
      "desktop",
    );
    assert.equal(readFileSync(join(repoDir, "app.ts"), "utf8"), "export const v = 1;\n");
    const audits = store.records<{ kind?: string; status: string }>("git-discard");
    assert.ok(audits.some((a) => a.kind === "file" && a.status === "confirmed"));
  } finally {
    await service.dispose();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("IntakeFilter supports observe, propose + one-click approve, auto dispatch, and context-only group ring buffer", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kooyu-p2-intake-"));
  const store = new Store(join(dir, "kodo.sqlite"));
  const service = new SessionService(store, { dataDir: dir, adapters: [] });
  try {
    const controller = service.createDraft({
      harnessId: "kodo",
      kind: "supervisor",
      title: "Intake Ctrl",
    });

    // 1. context-only ring buffer stores passive messages without inbox noise
    const ctx1 = service.intake.accept(
      {
        sourceKind: "feishu",
        sourceId: "conn-1",
        externalId: "m-1",
        fingerprint: "fp-1",
        disposition: "context-only",
        controllerId: controller.id,
        summary: "alice: deploying v2 soon",
        sender: "alice",
      },
      () => {},
    );
    assert.equal(ctx1.duplicate, false);
    assert.equal(store.records("inbox").length, 0);
    const recent = service.intake.recentContext("feishu", "conn-1", 5);
    assert.equal(recent.length, 1);
    assert.match(recent[0]!.summary, /deploying v2/);

    // 2. propose creates an inbox item and approve() dispatches idempotently once
    const prop = service.intake.accept(
      {
        sourceKind: "telegram",
        sourceId: "conn-2",
        externalId: "m-2",
        fingerprint: "fp-2",
        disposition: "proposed",
        controllerId: controller.id,
        summary: "Please run nightly tests",
      },
      () => {},
    );
    const inboxItem = store.record<{ payload: { intakeEventId?: string } }>(
      "inbox",
      "intake:" + prop.id,
    );
    assert.equal(inboxItem?.payload.intakeEventId, prop.id);

    const approved1 = service.intake.approve(prop.id);
    assert.equal(approved1.alreadyApproved, false);
    assert.ok(approved1.commandId);
    const approved2 = service.intake.approve(prop.id);
    assert.equal(approved2.alreadyApproved, true);
    assert.equal(approved2.commandId, approved1.commandId);

    // 3. auto dispatches directly when controller is not user-paused
    const auto1 = service.intake.accept(
      {
        sourceKind: "weixin",
        sourceId: "conn-3",
        externalId: "m-3",
        fingerprint: "fp-3",
        disposition: "dispatched",
        controllerId: controller.id,
        summary: "Check build status",
      },
      () => {},
    );
    assert.equal(auto1.disposition, "dispatched");
    assert.ok(auto1.commandId);

    // 4. auto downgrades to proposed if controller was paused by user stop
    await service.stop(controller.id, true);
    const autoAfterPause = service.intake.accept(
      {
        sourceKind: "weixin",
        sourceId: "conn-3",
        externalId: "m-4",
        fingerprint: "fp-4",
        disposition: "dispatched",
        controllerId: controller.id,
        summary: "Should not auto-revive",
      },
      () => {},
    );
    assert.equal(autoAfterPause.disposition, "proposed");
    assert.equal(autoAfterPause.commandId, undefined);
  } finally {
    await service.dispose();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("IMChannelService persists bindings into SCHEMA_V10 im_channels table with intakeMode and groupChat", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kooyu-p2-im-"));
  const store = new Store(join(dir, "kodo.sqlite"));
  const memVault = new Map<string, string>();
  const service = new SessionService(store, {
    dataDir: dir,
    adapters: [],
    providerVault: {
      get: async (ref) => memVault.get(ref) ?? null,
      set: async (ref, secret) => {
        memVault.set(ref, secret);
      },
      delete: async (ref) => {
        memVault.delete(ref);
      },
    },
  });
  try {
    const controller = service.createDraft({
      harnessId: "kodo",
      kind: "supervisor",
      title: "IM Ctrl",
    });
    const conn = await service.applications.connect({
      requestId: crypto.randomUUID(),
      applicationId: "telegram",
      version: "1.0.0",
      name: "TG Bot",
      token: "123456:ABC-DEF",
    });
    const bound = service.im.bind({
      connectionId: conn!.id,
      controllerId: controller.id,
      ownerExternalUserId: "42",
      chatId: "-100123",
      intakeMode: "auto",
      groupChat: true,
      triggerPrefix: "@Kooyu",
    });
    assert.equal(bound.intakeMode, "auto");
    assert.equal(bound.groupChat, true);
    const dbRow = store.db
      .prepare("SELECT id, kind, status, data FROM im_channels WHERE id=?")
      .get(conn!.id) as { id: string; kind: string; status: string; data: string } | undefined;
    assert.equal(dbRow?.kind, "telegram");
    assert.equal(dbRow?.status, "active");
    assert.equal(JSON.parse(dbRow!.data).intakeMode, "auto");

    service.im.unbind(conn!.id);
    assert.equal(
      store.db.prepare("SELECT id FROM im_channels WHERE id=?").get(conn!.id),
      undefined,
    );
  } finally {
    await service.dispose();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
