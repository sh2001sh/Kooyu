import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { descriptor, type HarnessAdapter } from "../src/harnesses/adapter.js";
import { SessionService } from "../src/session-service.js";
import { Store } from "../src/storage/store.js";

test("discoverNativeImports filters by project and importNativeSessions selectively imports and hydrates messages", async () => {
  const dirA = mkdtempSync(join(tmpdir(), "kooyu-import-a-"));
  const dirB = mkdtempSync(join(tmpdir(), "kooyu-import-b-"));
  const store = new Store(":memory:");

  const claudeAdapter: HarnessAdapter = {
    descriptor: descriptor(
      "claude-code",
      "Claude Code",
      "sdk",
      ["directChat", "historyRead"],
      "test",
      "implemented",
    ),
    async connect() {
      throw new Error("not used");
    },
    async standaloneList(_session, ctx) {
      if (ctx.cwd === dirA) {
        return [
          {
            sessionId: "claude-a-1",
            summary: "Fix auth token refresh",
            cwd: dirA,
            lastModified: Date.parse("2026-11-18T12:00:00Z"),
          },
          {
            sessionId: "claude-a-2",
            summary: "Refactor usage table",
            cwd: dirA,
            lastModified: Date.parse("2026-11-18T10:00:00Z"),
          },
        ];
      }
      if (ctx.cwd === dirB) {
        return [
          {
            sessionId: "claude-b-1",
            summary: "Other project thread",
            cwd: dirB,
            lastModified: Date.parse("2026-11-18T11:00:00Z"),
          },
        ];
      }
      return [];
    },
    async standaloneRead(session) {
      return {
        nativeSessionId: session.nativeSessionId,
        messages: [
          {
            type: "user",
            timestamp: "2026-11-18T11:58:00Z",
            message: { role: "user", content: "Please fix token refresh." },
          },
          {
            type: "assistant",
            timestamp: "2026-11-18T11:59:00Z",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "Done! Updated the refresh logic." }],
            },
          },
        ],
      };
    },
  };

  const codexAdapter: HarnessAdapter = {
    descriptor: descriptor(
      "codex",
      "Codex",
      "app-server",
      ["directChat", "historyRead"],
      "test",
      "implemented",
    ),
    async connect() {
      throw new Error("not used");
    },
    async standaloneList() {
      return {
        data: [
          {
            id: "codex-a-1",
            title: "Codex API refactor",
            cwd: dirA,
            updatedAt: "2026-11-18T13:00:00Z",
          },
          {
            id: "codex-subagent",
            title: "Internal child thread",
            cwd: dirA,
            source: { subagent: { thread_spawn: { parent_thread_id: "codex-a-1" } } },
            updatedAt: "2026-11-18T13:01:00Z",
          },
          {
            id: "codex-b-1",
            title: "Codex in project B",
            cwd: dirB,
            updatedAt: "2026-11-18T09:00:00Z",
          },
        ],
      };
    },
    async standaloneRead(session) {
      return {
        thread: {
          id: session.nativeSessionId,
          turns: [
            {
              items: [
                { type: "userMessage", content: [{ type: "text", text: "Refactor API" }] },
                { type: "agentMessage", text: "Refactored cleanly." },
              ],
            },
          ],
        },
      };
    },
  };

  const service = new SessionService(store, { adapters: [claudeAdapter, codexAdapter] });
  try {
    const projectA = service.createProject({ name: "Project A" });
    const projectB = service.createProject({ name: "Project B" });
    const wsA = service.addWorkspace(projectA.id, dirA);
    service.addWorkspace(projectB.id, dirB);

    // 1. Discover scoped to Project A: should find claude-a-1, claude-a-2, codex-a-1 (skip subagent & project B)
    const discoveryA = await service.discoverNativeImports({ projectId: projectA.id });
    assert.deepEqual(
      discoveryA.candidates.map((c) => `${c.harnessId}:${c.nativeSessionId}`),
      ["codex:codex-a-1", "claude-code:claude-a-1", "claude-code:claude-a-2"],
    );
    assert.ok(
      discoveryA.candidates.every((c) => c.projectId === projectA.id && !c.alreadyImported),
    );

    // 2. Selectively import ONLY claude-a-1 (leave claude-a-2 and codex-a-1 unimported!)
    const selected = discoveryA.candidates.find((c) => c.nativeSessionId === "claude-a-1")!;
    const res = await service.importNativeSessions({
      projectId: projectA.id,
      items: [
        {
          harnessId: selected.harnessId,
          nativeSessionId: selected.nativeSessionId,
          title: selected.title,
          cwd: selected.cwd,
          workspaceId: selected.workspaceId,
        },
      ],
    });
    assert.equal(res.imported.length, 1);
    assert.equal(res.skipped.length, 0);
    assert.equal(res.errors.length, 0);

    const importedSession = res.imported[0]!;
    assert.equal(importedSession.harnessId, "claude-code");
    assert.equal(importedSession.nativeSessionId, "claude-a-1");
    assert.equal(importedSession.projectId, projectA.id);
    assert.equal(importedSession.workspaceId, wsA.id);
    assert.equal(importedSession.phase, "native");

    // Verify transcript messages were hydrated into RuntimeEvents
    const events = service.events(importedSession.id);
    assert.equal(events.length, 2);
    assert.deepEqual(
      events.map((e) => ({
        role: (e.payload as { role: string }).role,
        text: (e.payload as { text: string }).text,
      })),
      [
        { role: "user", text: "Please fix token refresh." },
        { role: "assistant", text: "Done! Updated the refresh logic." },
      ],
    );

    // 3. Re-discover: claude-a-1 is now flagged alreadyImported, others remain unimported
    const after = await service.discoverNativeImports({ projectId: projectA.id });
    assert.equal(
      after.candidates.find((c) => c.nativeSessionId === "claude-a-1")?.alreadyImported,
      true,
    );
    assert.equal(
      after.candidates.find((c) => c.nativeSessionId === "claude-a-2")?.alreadyImported,
      false,
    );

    // 4. Attempting to re-import claude-a-1 skips it cleanly
    const dup = await service.importNativeSessions({
      items: [{ harnessId: "claude-code", nativeSessionId: "claude-a-1", cwd: dirA }],
    });
    assert.equal(dup.imported.length, 0);
    assert.equal(dup.skipped.length, 1);
  } finally {
    await service.dispose();
    store.close();
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  }
});
