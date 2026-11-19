import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Session, PermissionMode } from "@kodo/protocol";
import { deepSeekAdapter } from "../src/harnesses/deepseek-harness.js";
import { validatePermissionMode } from "../src/configuration/permissions.js";

test("DeepSeek modes handle only native approval requests and respect changes between turns", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kooyu-dsh-permissions-"));
  let mode: PermissionMode | null = null;
  const interactive: string[] = [];
  const replies: { request: string; answer: unknown }[] = [];
  const runtime = await deepSeekAdapter.connect({ nativeSessionId: null } as Session, {
    cwd: dir,
    dataDir: dir,
    env: { ...process.env, SYNTHETIC_DSH_APPROVALS: "1" },
    launch: {
      command: process.execPath,
      args: [fileURLToPath(new URL("./fixtures/native-peer.mjs", import.meta.url)), "dsh"],
    },
    configuration: {
      id: randomUUID(),
      revision: 1,
      name: "test",
      provider: "test",
      model: "test",
      credentialRef: null,
    },
    permissionMode: () => mode,
    interact: async (_id, p: any) => {
      interactive.push(p.method);
      return { outcome: "rejected" };
    },
    emit: (_type, p: any) => {
      if (p.method === "test/answer") replies.push(p);
    },
  });
  try {
    for (const selected of [null, "dsh:allow", "dsh:deny", "dsh:ask"] as const) {
      mode = selected;
      validatePermissionMode("deepseek-harness", mode);
      await runtime.send("test", randomUUID(), "new");
    }
    // Each native prompt emits an approval and a question. Questions always remain interactive.
    const deadline = Date.now() + 3000;
    while (replies.length < 8 && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(interactive.filter((x) => x === "approval/request").length, 2);
    assert.equal(interactive.filter((x) => x === "question/request").length, 4);
    assert.deepEqual(
      replies.filter((x) => x.request === "approval/request").map((x: any) => x.answer.outcome),
      ["rejected", "allowed-once", "rejected", "rejected"],
    );
    assert.throws(() => validatePermissionMode("claude-code", "dsh:allow"));
  } finally {
    await runtime.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
