import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import electronPath from "electron";
import { electronEnvironment } from "./electron-environment.mjs";

export function probeElectron(path, env = electronEnvironment()) {
  return new Promise((done) => {
    const child = spawn(path, ["--version"], {
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (b) => {
      stdout = (stdout + b).slice(-4096);
    });
    child.stderr.on("data", (b) => {
      stderr = (stderr + b).slice(-4096);
    });
    const timer = setTimeout(() => {
      child.kill();
      done({ code: null, stdout, stderr: "Version probe timed out" });
    }, 15000);
    child.once("error", (error) => {
      clearTimeout(timer);
      done({ code: null, stdout, stderr: error.message });
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      done({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}
function fingerprint(root) {
  const hash = createHash("sha256");
  const walk = (relative = "") => {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(relative, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile())
        hash
          .update(path)
          .update("\0")
          .update(readFileSync(join(root, path)));
      else throw new Error("Electron runtime must contain ordinary files and directories.");
    }
  };
  walk();
  return hash.digest("hex");
}
// Some Windows hosts fail before application code when the runtime image lives
// on a particular volume. Copy exactly the installed distribution into Kooyu's
// own cache and verify it; do not change system settings or Electron's sandbox.
export async function resolveElectronRuntime() {
  const source = electronPath,
    env = electronEnvironment();
  const original = await probeElectron(source, env);
  if (original.code === 0) return { path: source, original, fallback: false };
  if (process.platform !== "win32" || ![0x80000003, 0xc0000005].includes(original.code))
    throw new Error(`Electron startup probe failed (${original.code}): ${original.stderr}`);
  const sourceRoot = dirname(source),
    digest = fingerprint(sourceRoot);
  const cacheRoot = resolve(
    process.env.KOOYU_ELECTRON_CACHE ??
      process.env.KODO_ELECTRON_CACHE ??
      join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "Kooyu", "electron"),
  );
  mkdirSync(cacheRoot, { recursive: true });
  const destination = join(cacheRoot, digest);
  if (!existsSync(destination)) {
    const temporary = join(cacheRoot, `${digest}.partial-${randomUUID()}`);
    cpSync(sourceRoot, temporary, { recursive: true, errorOnExist: true });
    if (fingerprint(temporary) !== digest)
      throw new Error("Electron cache copy failed integrity verification.");
    try {
      renameSync(temporary, destination);
    } catch (error) {
      if (!existsSync(destination)) throw error;
    }
  }
  if (fingerprint(destination) !== digest)
    throw new Error(`Electron cache integrity mismatch: ${destination}`);
  const path = join(destination, "electron.exe"),
    cached = await probeElectron(path, env);
  if (cached.code !== 0)
    throw new Error(
      `Electron failed in both repository (${original.code}) and user cache (${cached.code}). Cache: ${destination}. ${cached.stderr}`,
    );
  return { path, original, cached, fallback: true, digest };
}
