import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { query } from "@anthropic-ai/claude-agent-sdk";
import { ModelRuntime, type createAgentSession } from "@earendil-works/pi-coding-agent";
import type { Session } from "@kodo/protocol";
import { claudeAdapterWithQuery } from "../src/harnesses/claude-code.js";
import { createKodoKernel } from "../src/kodo/kernel.js";
import type { AdapterContext, Wire } from "../src/harnesses/adapter.js";

for (const id of ["kodo", "pi"] as const)
  test(`${id} SDK can abort after a failed turn while awaiting retry`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "kodo-sdk-retry-stop-"));
    const events: { type: string; payload: Wire }[] = [];
    let receive = (_e: Wire) => {};
    let finish!: () => void;
    let aborts = 0;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const create = (async () => ({
      session: {
        sessionId: randomUUID(),
        sessionFile: join(dir, "synthetic-native-log"),
        messages: [],
        subscribe: (fn: typeof receive) => {
          receive = fn;
          return () => {};
        },
        prompt: async () => {
          receive({ type: "agent_start" });
          receive({
            type: "message_end",
            message: {
              role: "assistant",
              stopReason: "error",
              errorMessage: "Stream ended without finish_reason",
            },
          });
          receive({ type: "agent_end" });
          await gate;
        },
        abort: async () => {
          aborts++;
          receive({ type: "agent_settled", aborted: true });
          finish();
        },
        dispose: () => {},
      },
    })) as unknown as typeof createAgentSession;
    const runtime = await createKodoKernel(
      { id: randomUUID(), harnessId: id, nativeSessionId: null } as Session,
      {
        cwd: dir,
        dataDir: dir,
        env: {},
        launch: { command: "synthetic", args: [] },
        configuration: {
          id: randomUUID(),
          revision: 1,
          name: "retry fixture",
          provider: "openai",
          model: "gpt-5",
          protocol: "openai-responses",
          credentialRef: null,
        },
        emit: (type, payload) => {
          events.push({ type, payload: payload as Wire });
        },
        interact: async () => ({}),
      },
      create,
    );
    try {
      const sending = runtime.send("synthetic", randomUUID(), "new");
      await new Promise((resolve) => setImmediate(resolve));
      assert.ok(events.some((event) => event.type === "error"));
      assert.ok(events.some((event) => event.type === "turn-ended"));
      await runtime.cancel();
      await sending;
      assert.equal(aborts, 1);
      assert.ok(
        events.some((event) => event.type === "settled" && event.payload.outcome === "cancelled"),
      );
      await assert.rejects(runtime.cancel(), /没有活动/);
    } finally {
      finish();
      await runtime.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

for (const id of ["kodo", "pi"] as const)
  test(`${id} SDK rejects idle cancellation and emits disconnected after native prompt failure`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "kodo-sdk-failure-")),
      events: string[] = [];
    let receive = (_e: Wire) => {};
    const create = (async () => ({
      session: {
        sessionId: randomUUID(),
        sessionFile: join(dir, "synthetic-native-log"),
        subscribe: (fn: typeof receive) => {
          receive = fn;
          return () => {};
        },
        prompt: async () => {
          receive({ type: "agent_start" });
          throw new Error("synthetic SDK failure");
        },
        dispose: () => {},
        messages: [],
        abort: async () => {
          throw new Error("idle abort must not be called");
        },
      },
    })) as unknown as typeof createAgentSession;
    const ctx: AdapterContext = {
      cwd: dir,
      dataDir: dir,
      launch: { command: "kodo-sdk", args: [] },
      env: {},
      configuration: {
        id: randomUUID(),
        revision: 1,
        name: "isolated SDK fixture",
        provider: "openai",
        model: "gpt-5",
        protocol: "openai-responses",
        credentialRef: null,
      },
      emit: (type) => {
        events.push(type);
      },
      interact: async () => ({}),
    };
    const runtime = await createKodoKernel(
      { id: randomUUID(), harnessId: id, nativeSessionId: null } as Session,
      ctx,
      create,
    );
    try {
      await assert.rejects(runtime.cancel(), /活动/);
      await assert.rejects(runtime.send("synthetic", randomUUID(), "new"), /synthetic SDK failure/);
      assert.equal(events.filter((e) => e === "disconnected").length, 1);
      await assert.rejects(runtime.cancel(), /活动/);
    } finally {
      await runtime.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

for (const id of ["kodo", "pi"] as const)
  test(`${id} SDK applies and confirms session tool rules before each turn`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "kodo-pi-tools-"));
    let activeTools = ["read"];
    const seen: string[][] = [];
    let mode: import("@kodo/protocol").PermissionMode | null = "kodo-tools-read";
    const create = (async () => ({
      session: {
        sessionId: randomUUID(),
        sessionFile: join(dir, "synthetic-native-log"),
        getActiveToolNames: () => activeTools,
        setActiveToolsByName: (names: string[]) => {
          activeTools = [...names];
        },
        subscribe: () => () => {},
        prompt: async () => {
          seen.push([...activeTools]);
        },
        dispose: () => {},
        messages: [],
      },
    })) as unknown as typeof createAgentSession;
    const runtime = await createKodoKernel(
      {
        id: randomUUID(),
        harnessId: id,
        nativeSessionId: null,
        permissionMode: mode,
      } as Session,
      {
        cwd: dir,
        dataDir: dir,
        launch: { command: "kodo-sdk", args: [] },
        env: {},
        configuration: {
          id: randomUUID(),
          revision: 1,
          name: "isolated SDK fixture",
          provider: "openai",
          model: "gpt-5",
          protocol: "openai-responses",
          credentialRef: null,
        },
        emit: () => {},
        interact: async () => ({}),
        permissionMode: () => mode,
      },
      create,
    );
    try {
      assert.deepEqual(activeTools, ["read"]);
      await runtime.send("read", randomUUID(), "new");
      mode = "kodo-tools-none";
      await runtime.setPermissionMode!(mode);
      assert.deepEqual(activeTools, []);
      await runtime.send("no tools", randomUUID(), "new");
      mode = null;
      await runtime.setPermissionMode!(mode);
      await runtime.send("default", randomUUID(), "new");
      assert.deepEqual(seen, [
        ["read"],
        [],
        ["read", "write", "edit", process.platform === "win32" ? "powershell" : "bash"],
      ]);
      await assert.rejects(runtime.setPermissionMode!("full-access"), /只支持/);
    } finally {
      await runtime.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

test("real pi SDK loadout accepts tool scope changes without a model call", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kodo-real-pi-tools-"));
  let mode: import("@kodo/protocol").PermissionMode | null = "kodo-tools-read";
  const runtime = await createKodoKernel(
    {
      id: randomUUID(),
      harnessId: "pi",
      nativeSessionId: null,
      permissionMode: mode,
    } as Session,
    {
      cwd: dir,
      dataDir: dir,
      launch: { command: "kodo-sdk", args: [] },
      env: {},
      configuration: {
        id: randomUUID(),
        revision: 1,
        name: "offline SDK loadout test",
        provider: "openai",
        model: "gpt-5",
        protocol: "openai-responses",
        credentialRef: null,
      },
      emit: () => {},
      interact: async () => ({}),
      permissionMode: () => mode,
    },
  );
  try {
    mode = "kodo-tools-none";
    await runtime.setPermissionMode!(mode);
    mode = null;
    await runtime.setPermissionMode!(mode);
  } finally {
    await runtime.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Claude SDK rejects no-op stop and treats stream EOF without result as disconnection", async () => {
  const events: string[] = [];
  const run = (() =>
    (async function* () {
      yield { type: "system", subtype: "synthetic" };
    })()) as unknown as typeof query;
  const runtime = await claudeAdapterWithQuery(run).connect({ nativeSessionId: null } as Session, {
    cwd: tmpdir(),
    dataDir: tmpdir(),
    env: {},
    launch: { command: "claude-sdk", args: [] },
    emit: (type) => {
      events.push(type);
    },
    interact: async () => ({}),
  });
  try {
    await assert.rejects(runtime.cancel(), /没有活动/);
    await assert.rejects(
      runtime.send("isolated synthetic prompt", randomUUID(), "new"),
      /未收到原生 result/,
    );
    assert.equal(events.filter((e) => e === "disconnected").length, 1);
  } finally {
    await runtime.close();
  }
});

for (const terminal of [
  "diagnostic",
  "abort",
  "eof",
  "real-error",
  "interrupt-failed",
  "no-interrupt",
] as const)
  test(`Claude manual interruption handles ${terminal} without masking unrelated errors`, async () => {
    const diagnostic = "[ede_diagnostic] result_type=user last_content_type=n/a stop_reason=null";
    const events: { type: string; payload: Wire }[] = [];
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let interrupts = 0;
    const run = (() =>
      Object.assign(
        (async function* () {
          yield { type: "system", subtype: "synthetic" };
          await gate;
          if (terminal === "abort")
            throw Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
          if (terminal === "eof") return;
          yield {
            type: "result",
            is_error: true,
            subtype: "error_during_execution",
            errors: [terminal === "real-error" ? "upstream authentication failed" : diagnostic],
          };
          throw new Error(
            terminal === "real-error"
              ? "upstream authentication failed"
              : `Claude Code returned an error result: ${diagnostic}`,
          );
        })(),
        {
          interrupt: async () => {
            interrupts++;
            finish();
            if (terminal === "interrupt-failed") throw new Error("interrupt not acknowledged");
          },
          close: () => {},
        },
      )) as unknown as typeof query;
    const runtime = await claudeAdapterWithQuery(run).connect(
      { nativeSessionId: null } as Session,
      {
        cwd: tmpdir(),
        dataDir: tmpdir(),
        env: {},
        launch: { command: "claude-sdk", args: [] },
        emit: (type, payload) => {
          events.push({ type, payload: payload as Wire });
        },
        interact: async () => ({}),
      },
    );
    try {
      const sending = runtime.send("synthetic", randomUUID(), "new");
      // Observe failures immediately so cancellation races cannot cause an unhandled rejection.
      const result = sending.then(
        () => null,
        (error) => error as Error,
      );
      await new Promise((resolve) => setImmediate(resolve));
      if (terminal === "no-interrupt") finish();
      else if (terminal === "interrupt-failed")
        await assert.rejects(runtime.cancel(), /not acknowledged/);
      else await runtime.cancel();
      const error = await result;
      assert.equal(interrupts, terminal === "no-interrupt" ? 0 : 1);
      if (
        terminal === "real-error" ||
        terminal === "interrupt-failed" ||
        terminal === "no-interrupt"
      ) {
        assert.equal(error, null);
        assert.equal(
          events.filter((event) => event.type === "disconnected").length,
          terminal === "interrupt-failed" ? 1 : 0,
        );
        assert.ok(
          events.some((event) => event.type === "turn-ended" && event.payload.outcome === "failed"),
        );
      } else {
        assert.equal(error, null);
        assert.equal(
          events.filter((event) => event.type === "disconnected" || event.type === "error").length,
          0,
        );
        assert.equal(events.filter((event) => event.type === "turn-ended").length, 1);
        assert.ok(
          events.some(
            (event) => event.type === "turn-ended" && event.payload.outcome === "cancelled",
          ),
        );
      }
      await assert.rejects(runtime.cancel(), /没有活动/);
    } finally {
      finish();
      await runtime.close();
    }
  });

test("Claude SDK applies the selected native permission mode on each turn", async () => {
  const options: Record<string, unknown>[] = [];
  const run = ((input: { options: Record<string, unknown> }) => {
    options.push(input.options);
    return (async function* () {
      yield { type: "result", is_error: false, modelUsage: {} };
    })();
  }) as unknown as typeof query;
  let mode: import("@kodo/protocol").PermissionMode | null = "accept-edits";
  const runtime = await claudeAdapterWithQuery(run).connect({ nativeSessionId: null } as Session, {
    cwd: tmpdir(),
    dataDir: tmpdir(),
    env: {},
    launch: { command: "claude-sdk", args: [] },
    emit: () => {},
    interact: async () => ({}),
    permissionMode: () => mode,
  });
  try {
    await runtime.send("synthetic", randomUUID(), "new");
    mode = "bypass-permissions";
    await runtime.send("synthetic", randomUUID(), "new");
    assert.equal(options[0]?.permissionMode, "acceptEdits");
    assert.equal(options[0]?.allowDangerouslySkipPermissions, undefined);
    assert.equal(options[1]?.permissionMode, "bypassPermissions");
    assert.equal(options[1]?.allowDangerouslySkipPermissions, true);
  } finally {
    await runtime.close();
  }
});

test("Claude native questions preserve answers, reject incomplete input and respect abort", async () => {
  const decisions: Wire[] = [];
  const controller = new AbortController();
  const input = {
    questions: [
      {
        question: "Choose storage",
        header: "Storage",
        options: [{ label: "Local" }, { label: "Remote" }],
      },
    ],
  };
  const run = (({ options }: Parameters<typeof query>[0]) =>
    (async function* () {
      const decision = await options!.canUseTool!("AskUserQuestion", input, {
        toolUseID: "question",
        signal: controller.signal,
      } as never);
      assert.ok(decision);
      decisions.push(decision);
      yield { type: "result", is_error: false, modelUsage: {} };
    })()) as unknown as typeof query;
  let response: Wire = {
    behavior: "allow",
    updatedInput: { questions: [], answers: { "Choose storage": "Local", injected: "ignored" } },
  };
  const runtime = await claudeAdapterWithQuery(run).connect({ nativeSessionId: null } as Session, {
    cwd: tmpdir(),
    dataDir: tmpdir(),
    env: {},
    launch: { command: "claude-sdk", args: [] },
    emit: () => {},
    interact: async () => response,
  });
  try {
    await runtime.send("ask", randomUUID(), "new");
    assert.deepEqual(decisions[0], {
      behavior: "allow",
      updatedInput: { ...input, answers: { "Choose storage": "Local" } },
    });
    response = { behavior: "allow" };
    await runtime.send("ask", randomUUID(), "new");
    assert.equal(decisions[1]!.behavior, "deny");
    response = { behavior: "allow", updatedInput: { answers: { "Choose storage": "Remote" } } };
    controller.abort();
    await runtime.send("ask", randomUUID(), "new");
    assert.equal(decisions[2]!.behavior, "deny");
  } finally {
    await runtime.close();
  }
});

test("Claude limits come from native reports and follow resolved aliases without leaking to another model", async () => {
  const run = (() => {
    const stream = (async function* () {
      yield {
        type: "result",
        is_error: false,
        modelUsage: {
          "synthetic-canonical-a": { contextWindow: 234567, maxOutputTokens: 4567 },
        },
      };
    })();
    return Object.assign(stream, {
      supportedModels: async () => [
        {
          value: "synthetic-alias-a",
          resolvedModel: "synthetic-canonical-a",
          supportsEffort: true,
          supportedEffortLevels: ["native-adaptive"],
        },
        { value: "synthetic-alias-b", resolvedModel: "synthetic-canonical-b" },
      ],
      close: () => {},
    });
  }) as unknown as typeof query;
  const runtime = await claudeAdapterWithQuery(run).connect({ nativeSessionId: null } as Session, {
    cwd: tmpdir(),
    dataDir: tmpdir(),
    env: {},
    launch: { command: "claude-sdk", args: [] },
    emit: () => {},
    interact: async () => ({}),
  });
  try {
    assert.equal((await runtime.models!())[0]?.contextWindow, undefined);
    await runtime.send("isolated synthetic report test", randomUUID(), "new", {
      model: "synthetic-canonical-a",
      reasoning: "native-adaptive",
      revision: 0,
    });
    const models = await runtime.models!();
    assert.equal(models[0]?.contextWindow, 234567);
    assert.equal(models[0]?.maxOutputTokens, 4567);
    assert.equal(models[0]?.parameterSources?.contextWindow?.kind, "native-runtime");
    assert.deepEqual(models[0]?.reasoning, ["native-adaptive"]);
    assert.equal(models[1]?.contextWindow, undefined);
  } finally {
    await runtime.close();
  }
});

test("pi custom endpoint uses exact catalog limits and thinking maps across model changes, with unknown pricing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kodo-configuration-model-"));
  const events: { type: string; payload: Wire }[] = [];
  const sent: string[] = [];
  let receive = (_e: Wire) => {};
  let current: Wire;
  let creates = 0;
  const catalog = await ModelRuntime.create({ modelsPath: null });
  const create = (async (options: Wire) => {
    creates++;
    current = {
      sessionId: "isolated-synthetic-native-id",
      sessionFile: join(dir, "synthetic-log"),
      model: options.model,
      subscribe: (fn: typeof receive) => {
        receive = fn;
        return () => {};
      },
      setModel: async (model: Wire) => {
        current.model = model;
      },
      prompt: async () => {
        assert.equal(current.model.baseUrl, "https://example.invalid/isolated-native-test");
        const expected = catalog.getModel("openai", current.model.id)!;
        assert.equal(current.model.contextWindow, expected.contextWindow);
        assert.equal(current.model.maxTokens, expected.maxTokens);
        assert.deepEqual(current.model.thinkingLevelMap, expected.thinkingLevelMap);
        assert.deepEqual(current.model.input, expected.input);
        assert.deepEqual(current.model.inputLimits, expected.inputLimits);
        sent.push(current.model.id);
        receive({
          type: "message_end",
          message: {
            role: "assistant",
            model: current.model.id,
            provider: current.model.provider,
            usage: { input: 1, cost: { total: 1 } },
          },
        });
      },
      dispose: () => {},
    };
    return { session: current };
  }) as unknown as typeof createAgentSession;
  const runtime = await createKodoKernel(
    { id: randomUUID(), harnessId: "pi", nativeSessionId: null } as Session,
    {
      cwd: dir,
      dataDir: dir,
      env: {},
      launch: { command: "kodo-sdk", args: [] },
      configuration: {
        id: randomUUID(),
        revision: 1,
        name: "Isolated synthetic endpoint",
        provider: "openai",
        model: "gpt-5",
        protocol: "openai-responses",
        baseUrl: "https://example.invalid/isolated-native-test",
        credentialRef: null,
      },
      emit: (type, payload) => events.push({ type, payload: payload as Wire }),
      interact: async () => ({}),
    },
    create,
  );
  try {
    await runtime.send("synthetic B", randomUUID(), "new", {
      model: "gpt-5-mini",
      reasoning: null,
      revision: 1,
    });
    await runtime.send("synthetic A", randomUUID(), "new", {
      model: "gpt-5",
      reasoning: null,
      revision: 2,
    });
    assert.deepEqual(sent, ["gpt-5-mini", "gpt-5"]);
    assert.equal(creates, 1);
    assert.ok(events.filter((e) => e.type === "usage").every((e) => e.payload.cost === null));
  } finally {
    await runtime.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pi refuses unconfirmed custom model metadata before creating a session or sending a prompt", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kodo-unknown-model-"));
  let creates = 0;
  const create = (async () => {
    creates++;
    throw new Error("must not create");
  }) as unknown as typeof createAgentSession;
  const ctx: AdapterContext = {
    cwd: dir,
    dataDir: dir,
    env: {},
    launch: { command: "kodo-sdk", args: [] },
    configuration: {
      id: randomUUID(),
      revision: 1,
      name: "Synthetic unknown route",
      provider: "synthetic-provider",
      model: "gpt-5",
      protocol: "openai-responses",
      baseUrl: "https://example.invalid/synthetic",
      credentialRef: null,
    },
    emit: () => {},
    interact: async () => ({}),
  };
  try {
    await assert.rejects(
      createKodoKernel({ id: randomUUID(), harnessId: "pi" } as Session, ctx, create),
      /参数未确认/,
    );
    ctx.configuration = {
      ...ctx.configuration!,
      provider: "openai",
      protocol: "anthropic-messages",
    };
    await assert.rejects(
      createKodoKernel({ id: randomUUID(), harnessId: "pi" } as Session, ctx, create),
      /接口格式/,
    );
    assert.equal(creates, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
