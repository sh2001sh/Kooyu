import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";

/** Compare loaded code with installed code, including rebuilds of the same app version. */
export function hostBuildId(root: string): string {
  const hash = createHash("sha256");
  const add = (path: string) => {
    hash.update(path.replaceAll("\\", "/") + "\0");
    hash.update(readFileSync(join(root, path)));
  };
  const scan = (path: string) => {
    for (const entry of readdirSync(join(root, path), { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) scan(child);
      else if (entry.name.endsWith(".js") || entry.name === "package.json") add(child);
    }
  };
  for (const name of ["host", "platform", "protocol"]) scan(`packages/${name}/dist`);
  // Workspace packages are materialized in installed distributions.
  for (const name of ["platform", "protocol"]) {
    try {
      scan(`node_modules/@kodo/${name}/dist`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  add("package.json");
  add("package-lock.json");
  try {
    add("distribution.json");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return hash.digest("hex");
}

/** A manifest only becomes usable once all files named by the build are in place. */
export function installedHostBuild(root: string): string | null {
  try {
    const manifest = JSON.parse(readFileSync(join(root, "host-build.json"), "utf8"));
    return typeof manifest.buildId === "string" && manifest.buildId === hostBuildId(root)
      ? manifest.buildId
      : null;
  } catch {
    return null;
  }
}

/**
 * Resolves the Kooyu host data directory. Uses `KOOYU_DATA_DIR` (or legacy `KODO_DATA_DIR`)
 * when explicitly set. Defaults to `<appData>/Kooyu/host`, transparently preserving an existing
 * legacy `<appData>/Kodo/host` directory when the new path has not yet been initialized.
 */
export function hostDataDirectory(
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): string {
  const override = env.KOOYU_DATA_DIR || env.KODO_DATA_DIR;
  if (override) return resolve(override);
  const base =
    platform === "win32"
      ? (env.LOCALAPPDATA ?? join(home, "AppData", "Local"))
      : platform === "darwin"
        ? join(home, "Library", "Application Support")
        : (env.XDG_DATA_HOME ?? join(home, ".local", "share"));
  const primary = join(base, "Kooyu", "host");
  const legacy = join(base, "Kodo", "host");
  if (!existsSync(primary) && existsSync(legacy)) return legacy;
  return primary;
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
