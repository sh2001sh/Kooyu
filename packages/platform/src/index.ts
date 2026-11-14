import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Preserve the existing data identity across application renames and launchers. */
export function hostDataDirectory(
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): string {
  if (env.KODO_DATA_DIR) return resolve(env.KODO_DATA_DIR);
  const base =
    platform === "win32"
      ? (env.LOCALAPPDATA ?? join(home, "AppData", "Local"))
      : platform === "darwin"
        ? join(home, "Library", "Application Support")
        : (env.XDG_DATA_HOME ?? join(home, ".local", "share"));
  return join(base, "Kodo", "host");
}

/** GUI apps often do not inherit the interactive terminal's tool search path. */
export function hostEnvironment(
  env: NodeJS.ProcessEnv,
  platform = process.platform,
): NodeJS.ProcessEnv {
  const result = { ...env };
  delete result.ELECTRON_RUN_AS_NODE;
  if (platform === "darwin") {
    const entries = (env.PATH ?? "").split(":").filter(Boolean);
    result.PATH = [
      ...new Set([...entries, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]),
    ].join(":");
  }
  return result;
}
