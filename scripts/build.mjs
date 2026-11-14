import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
const temp = resolve(".local/tmp");
mkdirSync(temp, { recursive: true });
const npm = process.env.npm_execpath;
if (!npm) throw new Error("Use npm run build.");
for (const args of [
  ["run", "build:core"],
  ["run", "build", "-w", "@kodo/web"],
  ["run", "build", "-w", "@kodo/desktop"],
]) {
  const code = await new Promise((done, reject) => {
    const p = spawn(process.execPath, [npm, ...args], {
      stdio: "inherit",
      env: { ...process.env, TEMP: temp, TMP: temp },
      windowsHide: true,
    });
    p.once("error", reject);
    p.once("exit", done);
  });
  if (code !== 0) process.exit(code ?? 1);
}
