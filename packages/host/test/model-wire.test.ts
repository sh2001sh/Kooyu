import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import type { PermissionMode, Session } from "@kodo/protocol";
import { adapters } from "../src/harnesses/registry.js";
import type { AdapterContext } from "../src/harnesses/adapter.js";

for (const id of [
  "codex",
  "zcode",
  "deepseek-harness",
  "opencode",
  "gemini",
  "cursor",
  "kimi-code",
  "grok-build",
] as const)
  test(`${id}: native model changes stay on the same session and reach the native protocol`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "kodo-model-wire-"));
    const log = join(dir, "synthetic-wire.jsonl");
    const fixture = fileURLToPath(
      new URL(
        id === "opencode" ? "./fixtures/opencode-peer.mjs" : "./fixtures/native-peer.mjs",
        import.meta.url,
      ),
    );
    const mode = ["codex", "zcode"].includes(id) ? id : id === "deepseek-harness" ? "dsh" : "acp";
    let permissionMode: PermissionMode | null = id === "zcode" ? "plan" : "read-only";
    const context: AdapterContext = {
      cwd: dir,
      dataDir: dir,
      env: { ...process.env, SYNTHETIC_WIRE_LOG: log },
      launch: { command: process.execPath, args: [fixture, ...(id === "opencode" ? [] : [mode])] },
      emit: () => {},
      interact: async () => ({}),
      ...(["codex", "zcode"].includes(id) ? { permissionMode: () => permissionMode } : {}),
      ...(id === "deepseek-harness"
        ? {
            configuration: {
              id: randomUUID(),
              revision: 1,
              name: "Synthetic route",
              provider: "provider",
              model: "model-a",
              credentialRef: null,
            },
          }
        : {}),
    };
    const runtime = await adapters
      .find((a) => a.descriptor.id === id)!
      .connect(
        { id: randomUUID(), hostId: "test", harnessId: id, nativeSessionId: null } as Session,
        context,
      );
    try {
      const nativeId = runtime.nativeSessionId;
      const prefix = ["opencode", "zcode"].includes(id) ? "provider/" : "";
      if (id !== "deepseek-harness") assert.ok((await runtime.models!()).length);
      await runtime.send("synthetic A", randomUUID(), "new", {
        model: `${prefix}model-a`,
        reasoning: id === "zcode" ? "native-deep" : null,
        revision: 0,
      });
      if (id === "codex") permissionMode = "full-access";
      if (id === "zcode") permissionMode = "yolo";
      await runtime.send("synthetic B", randomUUID(), "new", {
        model: `${prefix}model-b`,
        reasoning: ["deepseek-harness", "zcode"].includes(id) ? null : "native-deep",
        revision: 1,
      });
      assert.equal(runtime.nativeSessionId, nativeId);
      const wire = readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));
      if (mode === "codex") {
        const turns = wire.filter((r) => r.method === "turn/start");
        assert.deepEqual(
          turns.map((r) => [r.params.model, r.params.effort]),
          [
            ["model-a", null],
            ["model-b", "native-deep"],
          ],
        );
        assert.equal(wire.filter((r) => r.method === "thread/start").length, 1);
        assert.deepEqual(wire.find((r) => r.method === "thread/start").params.sandboxPolicy, {
          type: "readOnly",
        });
        assert.deepEqual(
          turns.map((r) => [r.params.sandboxPolicy, r.params.approvalPolicy]),
          [
            [{ type: "readOnly" }, "on-request"],
            [{ type: "dangerFullAccess" }, "never"],
          ],
        );
      } else if (mode === "zcode") {
        const turns = wire.filter((r) => r.params?.type === "sendText");
        assert.deepEqual(
          turns.map((r) => r.params.payload.mode),
          ["plan", "yolo"],
        );
        assert.deepEqual(turns[1].params.payload.modelSelection, {
          providerId: "provider",
          modelId: "model-b",
        });
        assert.equal(turns[0].params.payload.modelSelection.options.reasoningLevel, "native-deep");
        permissionMode = null;
        await runtime.send("follow native mode", randomUUID(), "new", {
          model: "provider/model-b",
          reasoning: null,
          revision: 2,
        });
        const updated = readFileSync(log, "utf8")
          .trim()
          .split("\n")
          .map((l) => JSON.parse(l));
        assert.equal(
          updated.filter((r) => r.params?.type === "sendText").at(-1).params.payload.mode,
          undefined,
        );
        await assert.rejects(
          runtime.send("must not send", randomUUID(), "new", {
            model: "provider/model-b",
            reasoning: "native-deep",
            revision: 2,
          }),
          /未声明/,
        );
      } else if (mode === "dsh") {
        assert.equal(
          wire.filter((r) => r.method === "initialize").at(-1).params.reasoningEffort,
          undefined,
        );
        await assert.rejects(
          runtime.send("must not send", randomUUID(), "new", {
            model: "model-b",
            reasoning: "native-deep",
            revision: 2,
          }),
          /未声明/,
        );
        assert.equal(wire.find((r) => r.method === "session/resume").params.sessionId, nativeId);
      } else if (id === "opencode") {
        const turns = wire.filter((r) => r.path?.endsWith("prompt_async"));
        assert.deepEqual(turns[1].data.model, { providerID: "provider", modelID: "model-b" });
        assert.equal(turns[1].data.variant, "native-deep");
      } else {
        const change = wire.findIndex(
          (r) => r.method === "session/set_config_option" && r.params.configId === "engine",
        );
        const depth = wire.findIndex(
          (r) => r.method === "session/set_config_option" && r.params.configId === "depth",
        );
        const prompt = wire.findLastIndex((r) => r.method === "session/prompt");
        assert.ok(change >= 0 && depth > change && prompt > depth);
        await assert.rejects(
          runtime.send("must not send", randomUUID(), "new", {
            model: "model-b",
            reasoning: "not-supported",
            revision: 2,
          }),
          /未声明/,
        );
        const after = readFileSync(log, "utf8");
        assert.ok(!after.includes("must not send"));
      }
    } finally {
      await runtime.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

for (const [id, nativeModes] of [
  ["gemini", "legacy"],
  ["cursor", "config"],
] as const)
  test(`${id}: advertised ACP run mode is selected before prompting`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "kodo-acp-mode-"));
    const log = join(dir, "wire.jsonl");
    const fixture = fileURLToPath(new URL("./fixtures/native-peer.mjs", import.meta.url));
    let selected: PermissionMode | null = null;
    const runtime = await adapters
      .find((a) => a.descriptor.id === id)!
      .connect(
        { id: randomUUID(), hostId: "test", harnessId: id, nativeSessionId: null } as Session,
        {
          cwd: dir,
          dataDir: dir,
          env: { ...process.env, SYNTHETIC_WIRE_LOG: log, SYNTHETIC_ACP_MODES: nativeModes },
          launch: { command: process.execPath, args: [fixture, "acp"] },
          emit: () => {},
          interact: async () => ({}),
          permissionMode: () => selected,
        },
      );
    try {
      assert.deepEqual(
        (await runtime.permissionOptions!()).options.map((option) => option.value),
        ["acp:ask", "acp:code"],
      );
      selected = "acp:code";
      await runtime.setPermissionMode!(selected);
      assert.equal((await runtime.permissionOptions!()).current, selected);
      await runtime.send("after mode", randomUUID(), "new");
      const wire = readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const method = nativeModes === "legacy" ? "session/set_mode" : "session/set_config_option";
      assert.ok(
        wire.findIndex((r) => r.method === method) <
          wire.findIndex((r) => r.method === "session/prompt"),
      );
      await assert.rejects(runtime.setPermissionMode!("acp:unlisted"), /未声明/);
    } finally {
      await runtime.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

test("ACP without advertised modes does not offer a permission switch", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kodo-acp-no-mode-"));
  const fixture = fileURLToPath(new URL("./fixtures/native-peer.mjs", import.meta.url));
  const runtime = await adapters
    .find((a) => a.descriptor.id === "kimi-code")!
    .connect(
      {
        id: randomUUID(),
        hostId: "test",
        harnessId: "kimi-code",
        nativeSessionId: null,
      } as Session,
      {
        cwd: dir,
        dataDir: dir,
        env: process.env,
        launch: { command: process.execPath, args: [fixture, "acp"] },
        emit: () => {},
        interact: async () => ({}),
      },
    );
  try {
    assert.deepEqual((await runtime.permissionOptions!()).options, []);
    await assert.rejects(runtime.setPermissionMode!("acp:code"), /未声明/);
  } finally {
    await runtime.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("OpenCode confirms session tool rules before prompt and rejects unconfirmed rules", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kodo-opencode-mode-"));
  const log = join(dir, "wire.jsonl");
  const fixture = fileURLToPath(new URL("./fixtures/opencode-peer.mjs", import.meta.url));
  let selected: PermissionMode | null = "opencode-ask";
  const context: AdapterContext = {
    cwd: dir,
    dataDir: dir,
    env: { ...process.env, SYNTHETIC_WIRE_LOG: log },
    launch: { command: process.execPath, args: [fixture] },
    emit: () => {},
    interact: async () => ({}),
    permissionMode: () => selected,
  };
  const runtime = await adapters
    .find((a) => a.descriptor.id === "opencode")!
    .connect(
      { id: randomUUID(), hostId: "test", harnessId: "opencode", nativeSessionId: null } as Session,
      context,
    );
  try {
    await runtime.send("first", randomUUID(), "new");
    selected = "opencode-deny";
    await runtime.setPermissionMode!(selected);
    selected = "opencode-allow";
    await runtime.setPermissionMode!(selected);
    await runtime.send("second", randomUUID(), "new");
    selected = null;
    await runtime.setPermissionMode!(selected);
    const wire = readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const changes = wire.filter((r) => r.method === "PATCH");
    assert.deepEqual(
      changes.map((r) => r.data.permission),
      [
        [{ permission: "*", pattern: "*", action: "ask" }],
        [{ permission: "*", pattern: "*", action: "deny" }],
        [{ permission: "*", pattern: "*", action: "allow" }],
        [],
      ],
    );
    assert.ok(
      wire.findIndex((r) => r.path?.endsWith("prompt_async")) >
        wire.findIndex((r) => r.method === "PATCH"),
    );
  } finally {
    await runtime.close();
    rmSync(dir, { recursive: true, force: true });
  }
  const rejectedDir = mkdtempSync(join(tmpdir(), "kodo-opencode-reject-"));
  const rejectedLog = join(rejectedDir, "wire.jsonl");
  const rejected = await adapters
    .find((a) => a.descriptor.id === "opencode")!
    .connect(
      { id: randomUUID(), hostId: "test", harnessId: "opencode", nativeSessionId: null } as Session,
      {
        ...context,
        cwd: rejectedDir,
        dataDir: rejectedDir,
        env: {
          ...process.env,
          SYNTHETIC_WIRE_LOG: rejectedLog,
          SYNTHETIC_OPENCODE_IGNORE_PERMISSION: "1",
        },
      },
    );
  try {
    selected = "opencode-ask";
    await assert.rejects(rejected.send("blocked", randomUUID(), "new"), /未确认/);
    assert.ok(!readFileSync(rejectedLog, "utf8").includes("prompt_async"));
  } finally {
    await rejected.close();
    rmSync(rejectedDir, { recursive: true, force: true });
  }
});
