import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import type { Command } from "@kodo/protocol";
import { HostUpgrade } from "../src/lifecycle/upgrade.js";
import { SessionService } from "../src/session-service.js";
import { Store } from "../src/storage/store.js";

test("same-version upgrade pauses active and queued work, backs up and restores the gate on launch failure", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kooyu-host-upgrade-"));
  const store = new Store(join(directory, "kodo.sqlite"));
  const service = new SessionService(store, { dataDir: directory, adapters: [] });
  let installed: string | null = "new-build";
  let launches = 0;
  const upgrade = new HostUpgrade(
    service,
    "old-build",
    () => installed,
    async (ticket) => {
      launches++;
      assert.equal(service.lifecycle.status().frozen, true);
      assert.equal(store.record<{ ticket: string }>("lifecycle", "upgrade")?.ticket, ticket);
      throw new Error("Simulated spawn failure");
    },
  );
  try {
    const session = service.createDraft({
      harnessId: "codex",
      kind: "direct",
      title: "Preserve me",
    });
    store.saveSession({ ...session, runState: "running" });
    const command: Command = {
      id: crypto.randomUUID(),
      sessionId: session.id,
      kind: "send",
      body: { text: "Keep queued" },
      origin: "user",
      status: "accepted",
      generation: 0,
      controllerId: null,
      bindingRevision: null,
      nativeRunId: null,
      createdAt: new Date().toISOString(),
    };
    store.saveCommand(command);

    installed = null;
    await upgrade.tick();
    assert.equal(launches, 0, "Incomplete install must never restart");
    installed = "new-build";
    await assert.rejects(upgrade.tick(), /Simulated spawn failure/);
    assert.equal(launches, 1);
    assert.equal(store.command(command.id)?.status, "cancelled");
    assert.ok(store.record("lifecycle", "update-paused"));
    assert.equal(service.lifecycle.status().frozen, false);
    assert.equal(store.record("lifecycle", "upgrade"), undefined);
    assert.equal(readdirSync(join(directory, "upgrade-backups")).length, 1);
    assert.equal(store.session(session.id).title, "Preserve me");
    assert.throws(() => upgrade.request("uninstalled-build"), /完整安装/);
  } finally {
    await service.dispose();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
