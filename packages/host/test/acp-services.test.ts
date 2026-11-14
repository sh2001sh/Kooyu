import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { KodoError, type Session } from "@kodo/protocol";
import { acpHarness } from "../src/harnesses/acp.js";
import { readAcpHistory } from "../src/harnesses/acp-history.js";
import type { AdapterContext, Wire } from "../src/harnesses/adapter.js";
const peer = fileURLToPath(new URL("./fixtures/acp-services-peer.mjs", import.meta.url));
async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), "kodo-acp-services-"));
  const events: { type: string; payload: Wire }[] = [],
    approvals: Wire[] = [];
  const ctx: AdapterContext = {
    cwd,
    dataDir: cwd,
    env: process.env,
    launch: { command: process.execPath, args: [peer] },
    emit: (type, payload) => events.push({ type, payload: payload as Wire }),
    interact: async (_id, payload) => {
      const request = payload as Wire;
      approvals.push(request);
      return { outcome: { outcome: "selected", optionId: request.options[0].optionId } };
    },
  };
  return { ctx, events, approvals, close: () => rm(cwd, { recursive: true, force: true }) };
}
test("ACP serves approved file and terminal operations through native JSON-RPC", async () => {
  const f = await fixture();
  const runtime = await acpHarness("gemini", "Test").connect(
    { id: randomUUID() } as Session,
    f.ctx,
  );
  try {
    assert.equal(runtime.capabilities?.resume, "supported");
    await runtime.send("services", randomUUID(), "new");
    assert.ok(f.events.some((e) => e.payload.text?.includes("terminal OK")));
    assert.equal(f.approvals.length, 3);
    assert.equal(f.events.find((e) => e.type === "usage")?.payload.costUsd, 0.25);
    assert.equal(
      f.events.find((e) => e.type === "usage")?.payload.sourceId,
      runtime.nativeSessionId,
    );
  } finally {
    await runtime.close();
    await f.close();
  }
});
test("ACP rejects idle stops and uses native outcomes for cancellation and token limits", async () => {
  const f = await fixture();
  const runtime = await acpHarness("gemini", "Test").connect(
    { id: randomUUID() } as Session,
    f.ctx,
  );
  try {
    await assert.rejects(runtime.cancel(), /没有活动/);
    let began!: () => void;
    const ready = new Promise<void>((resolve) => {
      began = resolve;
    });
    f.ctx.emit = (type, payload) => {
      f.events.push({ type, payload: payload as Wire });
      if (type === "text-delta") began();
    };
    const pending = runtime.send("wait", randomUUID(), "new");
    await ready;
    await runtime.cancel();
    await pending;
    assert.equal(f.events.find((e) => e.type === "turn-ended")?.payload.outcome, "cancelled");
    await runtime.send("limited", randomUUID(), "new");
    assert.equal(f.events.filter((e) => e.type === "turn-ended").at(-1)?.payload.outcome, "failed");
  } finally {
    await runtime.close();
    await f.close();
  }
});
test("ACP load does not replay live events; history omits private thoughts and usage", async () => {
  const f = await fixture();
  const session = { id: randomUUID(), nativeSessionId: "acp-services-session" } as Session;
  const runtime = await acpHarness("cursor", "Test").connect(session, f.ctx);
  try {
    assert.equal(
      f.events.filter((e) => ["text-delta", "usage", "tool"].includes(e.type)).length,
      0,
    );
    const history = await readAcpHistory(session, f.ctx);
    assert.deepEqual(history.messages, [
      { role: "user", content: "old question" },
      { role: "assistant", content: "old reply" },
    ]);
    assert.ok(!JSON.stringify(history).includes("private thought"));
    assert.equal(f.approvals.length, 0);
  } finally {
    await runtime.close();
    await f.close();
  }
});

test("ACP transport loss after prompt dispatch remains ambiguous delivery", async () => {
  const f = await fixture();
  let working!: () => void;
  const started = new Promise<void>((resolve) => {
    working = resolve;
  });
  const emit = f.ctx.emit;
  f.ctx.emit = (type, payload) => {
    emit(type, payload);
    if ((payload as Wire).text === "working") working();
  };
  const runtime = await acpHarness("gemini", "Test").connect(
    { id: randomUUID() } as Session,
    f.ctx,
  );
  try {
    const pending = assert.rejects(
      runtime.send("wait", randomUUID(), "new"),
      (error: unknown) => error instanceof Error && !(error instanceof KodoError),
    );
    await started;
    await runtime.close();
    await pending;
  } finally {
    await runtime.close();
    await f.close();
  }
});

test("ACP normal completion fences pending approvals from the next active turn", async () => {
  const f = await fixture();
  const answers: { resolve: (value: unknown) => void; payload: Wire }[] = [];
  let ready!: () => void;
  const waiting = new Promise<void>((resolve) => {
    ready = resolve;
  });
  f.ctx.interact = async (_id, payload) =>
    new Promise((resolve) => {
      answers.push({ resolve, payload: payload as Wire });
      if (answers.length === 2) ready();
    });
  const emit = f.ctx.emit;
  f.ctx.emit = (type, payload) => {
    emit(type, payload);
    if (type === "text-delta" && (payload as Wire).text === "next turn")
      for (const answer of answers)
        answer.resolve({
          outcome: { outcome: "selected", optionId: answer.payload.options[0].optionId },
        });
  };
  const runtime = await acpHarness("grok-build", "Test").connect(
    { id: randomUUID() } as Session,
    f.ctx,
  );
  try {
    const first = runtime.send("late-approvals", randomUUID(), "new");
    await waiting;
    await runtime.list!();
    await first;
    await runtime.send("check-late", randomUUID(), "new");
    assert.equal(
      f.events.filter((e) => e.type === "turn-ended").at(-1)?.payload.outcome,
      "completed",
    );
    await assert.rejects(readFile(join(f.ctx.cwd!, "late.txt")), { code: "ENOENT" });
  } finally {
    for (const answer of answers) answer.resolve({ outcome: { outcome: "cancelled" } });
    await runtime.close();
    await f.close();
  }
});

for (const action of ["complete", "cancel", "close"] as const) {
  test(
    "ACP reserves configuration preparation and fences " + action,
    { timeout: 10000 },
    async () => {
      const f = await fixture();
      const log = join(f.ctx.cwd!, "wire.jsonl");
      f.ctx.env = { ...process.env, SYNTHETIC_ACP_DELAY_MODEL: "1", SYNTHETIC_WIRE_LOG: log };
      let preparing!: () => void;
      const prepared = new Promise<void>((resolve) => {
        preparing = resolve;
      });
      let working!: () => void;
      const started = new Promise<void>((resolve) => {
        working = resolve;
      });
      const emit = f.ctx.emit;
      f.ctx.emit = (type, payload) => {
        emit(type, payload);
        if ((payload as Wire).sessionUpdate === "test-preparing") preparing();
        if ((payload as Wire).text === "working") working();
      };
      const runtime = await acpHarness("cursor", "Test").connect(
        { id: randomUUID() } as Session,
        f.ctx,
      );
      try {
        const first = runtime.send("wait", randomUUID(), "new", {
          model: "second",
          reasoning: null,
          revision: 0,
        });
        const outcome =
          action === "complete"
            ? first
            : assert.rejects(
                first,
                (error: unknown) =>
                  error instanceof KodoError && /取消|关闭|closed|退出|连接/.test(error.message),
              );
        await prepared;
        await assert.rejects(runtime.send("duplicate", randomUUID(), "new"), /准备中/);
        if (action === "close") await runtime.close();
        else {
          if (action === "cancel") await runtime.cancel();
          await runtime.list!();
          if (action === "complete") {
            await started;
            await runtime.cancel();
          }
        }
        await outcome;
        const calls = (await readFile(log, "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        assert.equal(
          calls.filter((call) => call.method === "session/prompt").length,
          action === "complete" ? 1 : 0,
        );
        assert.equal(
          calls.filter((call) => call.method === "session/cancel").length,
          action === "complete" ? 1 : 0,
        );
        if (action === "close")
          await assert.rejects(runtime.send("closed", randomUUID(), "new"), /关闭/);
        else {
          await runtime.send("next", randomUUID(), "new", {
            model: "second",
            reasoning: null,
            revision: 0,
          });
          assert.equal(
            f.events.filter((e) => e.type === "turn-ended").at(-1)?.payload.outcome,
            "completed",
          );
        }
      } finally {
        await runtime.close();
        await f.close();
      }
    },
  );
}
