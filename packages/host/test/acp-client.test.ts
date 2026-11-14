import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, writeFile, rm, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AcpClient } from "../src/harnesses/acp-client.js";
import type { AdapterContext, Wire } from "../src/harnesses/adapter.js";

async function fixture(interact?: AdapterContext["interact"]) {
  const root = await mkdtemp(join(tmpdir(), "kodo-acp-client-"));
  const cwd = join(root, "workspace");
  await mkdir(cwd);
  const requests: unknown[] = [];
  const context: AdapterContext = {
    cwd,
    dataDir: root,
    env: process.env,
    launch: { command: process.execPath, args: [] },
    emit: () => {},
    interact:
      interact ??
      (async (_id, payload) => {
        requests.push(payload);
        return { outcome: { outcome: "selected", optionId: "allow_once" } };
      }),
  };
  const client = new AcpClient(
    context,
    () => "session-test",
    () => true,
  );
  return {
    client,
    root,
    cwd,
    requests,
    call: (method: string, params: Wire = {}) =>
      client.request(method, { sessionId: "session-test", ...params }, "req-test") as Promise<Wire>,
    close: async () => {
      await client.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("ACP reads bounded UTF-8 text and one-based line ranges", async () => {
  const f = await fixture();
  try {
    const path = join(f.cwd, "测试.txt");
    await writeFile(path, "第一行\nsecond\nthird\n");
    assert.deepEqual(await f.call("fs/read_text_file", { path, line: 2, limit: 1 }), {
      content: "second",
    });
    assert.equal((await f.call("fs/read_text_file", { path })).content, "第一行\nsecond\nthird\n");
    await assert.rejects(f.call("fs/read_text_file", { path, line: 0 }), /正整数/);
    await writeFile(path, Buffer.alloc(1024 * 1024 + 1));
    await assert.rejects(f.call("fs/read_text_file", { path }), /1 MiB/);
    await writeFile(path, Buffer.from([65, 0, 66]));
    await assert.rejects(f.call("fs/read_text_file", { path }), /二进制/);
  } finally {
    await f.close();
  }
});

test("ACP rejects another session, path traversal, and symlink escapes", async () => {
  const f = await fixture();
  try {
    const outside = join(f.root, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "secret.txt"), "private");
    await symlink(outside, join(f.cwd, "link"), process.platform === "win32" ? "junction" : "dir");
    for (const path of [join(outside, "secret.txt"), join(f.cwd, "link", "secret.txt")])
      await assert.rejects(f.call("fs/read_text_file", { path }), /当前工作目录/);
    await assert.rejects(
      f.call("fs/write_text_file", { path: join(f.cwd, "link", "new.txt"), content: "no" }),
      /当前工作目录/,
    );
    await assert.rejects(f.call("fs/read_text_file", { path: "relative.txt" }), /绝对路径/);
    await assert.rejects(
      f.call("terminal/output", { sessionId: "another", terminalId: "x" }),
      /当前会话/,
    );
    assert.equal(f.requests.length, 0);
  } finally {
    await f.close();
  }
});

test("ACP file writes require one-operation approval and preserve rejected contents", async () => {
  let allow = false;
  const f = await fixture(async () => ({
    outcome: { outcome: "selected", optionId: allow ? "allow_once" : "reject_once" },
  }));
  try {
    const path = join(f.cwd, "write.txt");
    await writeFile(path, "before");
    await assert.rejects(f.call("fs/write_text_file", { path, content: "after" }), /拒绝/);
    assert.equal(await readFile(path, "utf8"), "before");
    allow = true;
    assert.deepEqual(await f.call("fs/write_text_file", { path, content: "after" }), {});
    assert.equal(await readFile(path, "utf8"), "after");
  } finally {
    await f.close();
  }
});

test("ACP stop invalidates pending file and terminal approvals", async () => {
  for (const method of ["fs/write_text_file", "terminal/create"]) {
    let answer!: (value: unknown) => void, waiting!: () => void;
    const ready = new Promise<void>((resolve) => {
      waiting = resolve;
    });
    const f = await fixture(async () => {
      waiting();
      return new Promise((resolve) => {
        answer = resolve;
      });
    });
    try {
      const path = join(f.cwd, "not-created.txt");
      const pending = f.call(
        method,
        method.startsWith("fs/")
          ? { path, content: "no" }
          : { command: process.execPath, args: ["-e", "process.exit(0)"] },
      );
      const rejected = assert.rejects(pending, /已停止/);
      await ready;
      await f.client.cancel();
      answer({ outcome: { outcome: "selected", optionId: "allow_once" } });
      await rejected;
      await assert.rejects(readFile(path), { code: "ENOENT" });
    } finally {
      await f.close();
    }
  }
});

test("ACP terminal lifecycle retains bounded Unicode output and real exit status", async () => {
  const f = await fixture();
  try {
    const { terminalId } = await f.call("terminal/create", {
      command: process.execPath,
      args: ["-e", "process.stdout.write('中文'.repeat(100));process.exitCode=7"],
      outputByteLimit: 8,
    });
    assert.equal((await f.call("terminal/wait_for_exit", { terminalId })).exitCode, 7);
    const output = await f.call("terminal/output", { terminalId });
    assert.equal(output.truncated, true);
    assert.ok(Buffer.byteLength(output.output) <= 8);
    assert.ok(!output.output.includes("�"));
    assert.equal(output.exitStatus.exitCode, 7);
    assert.deepEqual(await f.call("terminal/release", { terminalId }), {});
    await assert.rejects(f.call("terminal/output", { terminalId }), /已释放/);
    assert.equal(f.requests.length, 1);
  } finally {
    await f.close();
  }
});

test("ACP terminal kill and client close stop running child processes", async () => {
  const f = await fixture();
  try {
    const { terminalId } = await f.call("terminal/create", {
      command: process.execPath,
      args: ["-e", "setInterval(()=>{},1000)"],
    });
    const waiting = f.call("terminal/wait_for_exit", { terminalId });
    await f.call("terminal/kill", { terminalId });
    const exit = await waiting;
    assert.ok(exit.signal !== null || exit.exitCode !== null);
    await f.call("terminal/create", {
      command: process.execPath,
      args: ["-e", "setInterval(()=>{},1000)"],
    });
    await f.client.close();
    await assert.rejects(f.call("terminal/output", { terminalId }), /当前会话/);
  } finally {
    await f.close();
  }
});
