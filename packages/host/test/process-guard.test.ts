import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { Store } from "../src/storage/store.js";
for (const kind of ["uncaughtException", "unhandledRejection"])
  test(`Host ${kind} exits nonzero and releases its lock for durable recovery`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "kodo-process-guard-"));
    const entry = new URL("../src/main.ts", import.meta.url).href;
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const port = address.port;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const trigger =
      kind === "uncaughtException"
        ? 'setImmediate(() => { throw new Error("synthetic process failure"); })'
        : 'Promise.reject(new Error("synthetic process failure"))';
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `await import(${JSON.stringify(entry)}); ${trigger};`,
      ],
      {
        cwd: fileURLToPath(new URL("../../../", import.meta.url)),
        env: { ...process.env, KODO_DATA_DIR: dir, KODO_HOST_PORT: String(port) },
        windowsHide: true,
      },
    );
    let output = "";
    child.stdout.on("data", (b) => {
      output += b;
    });
    child.stderr.on("data", (b) => {
      output += b;
    });
    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        const deadline = setTimeout(() => {
          child.kill();
          reject(new Error("fatal guard failed to exit"));
        }, 10000);
        child.once("error", (error) => {
          clearTimeout(deadline);
          reject(error);
        });
        child.once("exit", (code) => {
          clearTimeout(deadline);
          resolve(code);
        });
      });
      assert.equal(code, 1, output);
      assert.match(output, /Host fatal error; exiting for recovery/);
      assert.equal(existsSync(join(dir, "host.lock")), false);
      const store = new Store(join(dir, "kodo.sqlite"));
      store.recover();
      store.close();
    } finally {
      if (child.exitCode === null) child.kill();
      rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
  });
