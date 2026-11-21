import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { spawn } = require("node-pty");
const terminal = spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/c", "echo KOOYU_CONPTY_OK"], {
  cols: 80,
  rows: 24,
});
let output = "";
terminal.onData((data) => {
  output += data;
});
const timer = setTimeout(() => terminal.kill(), 8000);
terminal.onExit(({ exitCode }) => {
  clearTimeout(timer);
  assert.equal(exitCode, 0);
  assert.match(output, /KOOYU_CONPTY_OK/);
  process.stdout.write(
    JSON.stringify({
      node: process.versions.node,
      electron: process.versions.electron,
      conpty: true,
    }) + "\n",
    () => process.exit(0),
  );
});
