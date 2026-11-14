import { spawn } from "node:child_process";
import { electronEnvironment } from "./electron-environment.mjs";
import { resolveElectronRuntime } from "./electron-runtime.mjs";

const runtime = await resolveElectronRuntime();
if (runtime.fallback)
  console.warn(`Electron 从用户缓存启动（原位置退出码 ${runtime.original.code}）：${runtime.path}`);
const child = spawn(runtime.path, process.argv.slice(2), {
  env: electronEnvironment(),
  windowsHide: true,
  stdio: "inherit",
});
child.once("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
