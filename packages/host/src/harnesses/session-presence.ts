import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { HarnessId, Session } from "@kodo/protocol";

export type SessionPresence = "present" | "missing" | "unknown";
export type SessionPresenceMap = Record<string, SessionPresence>;
export const presenceMap = (sessions: Session[], state: SessionPresence): SessionPresenceMap =>
  Object.fromEntries(sessions.map((session) => [session.nativeSessionId!, state]));

export function nativeUserHome(env: NodeJS.ProcessEnv): string {
  return (process.platform === "win32" ? env.USERPROFILE : env.HOME) ?? homedir();
}

/** Capture paths only, never credentials. The launcher's env wins over Host env. */
export function nativeStorageEnvironment(
  id: HarnessId,
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  const userHome = nativeUserHome(env);
  const homes: Partial<Record<HarnessId, [string, string]>> = {
    codex: ["CODEX_HOME", join(userHome, ".codex")],
    "claude-code": ["CLAUDE_CONFIG_DIR", join(userHome, ".claude")],
    gemini: ["GEMINI_CLI_HOME", userHome],
    "kimi-code": ["KIMI_CODE_HOME", join(userHome, ".kimi-code")],
    "grok-build": ["GROK_HOME", join(userHome, ".grok")],
    "deepseek-harness": ["DSH_HOME", join(userHome, ".dsh")],
    zcode: ["ZCODE_DATA_BASE_DIR", userHome],
  };
  const home = homes[id];
  const result: Record<string, string> = home ? { [home[0]]: env[home[0]] ?? home[1] } : {};
  if (id === "opencode")
    result.XDG_DATA_HOME = env.XDG_DATA_HOME ?? join(nativeUserHome(env), ".local", "share");
  for (const key of [
    "HOME",
    "USERPROFILE",
    "XDG_DATA_HOME",
    "XDG_CONFIG_HOME",
    "OPENCODE_CONFIG_DIR",
    "ZCODE_HOME",
  ])
    if (env[key] !== undefined) result[key] = env[key];
  return result;
}

/** Only ENOENT of an exact native target proves absence; unreadable roots do not. */
export async function exactFilePresence(root: string, target: string): Promise<SessionPresence> {
  try {
    if (!(await stat(root)).isDirectory()) return "unknown";
    return (await stat(target)).isFile() ? "present" : "unknown";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return "unknown";
    try {
      return (await stat(root)).isDirectory() ? "missing" : "unknown";
    } catch {
      return "unknown";
    }
  }
}

/** Bounded header read; no migrations, writes or full transcript ingestion. */
export async function jsonLineHeader(path: string): Promise<Record<string, unknown> | null> {
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(65536);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const text = buffer.subarray(0, bytesRead).toString("utf8");
    const end = text.indexOf("\n");
    if (end < 0) return null;
    const value: unknown = JSON.parse(text.slice(0, end));
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } finally {
    await file.close();
  }
}

export async function inspectClaudeFiles(
  sessions: Session[],
  home: string,
): Promise<SessionPresenceMap> {
  const states = presenceMap(sessions, "unknown"),
    root = join(home, "projects");
  try {
    const projects = await readdir(root, { withFileTypes: true });
    if (projects.length > 10000 || projects.some((entry) => entry.isSymbolicLink())) return states;
    for (const session of sessions) {
      const id = session.nativeSessionId!;
      if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) continue;
      let state: SessionPresence = "missing";
      for (const project of projects.filter((entry) => entry.isDirectory())) {
        const found = await exactFilePresence(
          join(root, project.name),
          join(root, project.name, id + ".jsonl"),
        );
        if (found === "present") {
          state = found;
          break;
        }
        if (found === "unknown") state = "unknown";
      }
      states[id] = state;
    }
  } catch {
    /* Inaccessible native homes are not empty histories. */
  }
  return states;
}

/** Native JSONL generations survive archive; search every project, not a filtered UI index. */
export async function inspectDshFiles(
  sessions: Session[],
  home: string,
  standardProfile: boolean,
): Promise<SessionPresenceMap> {
  const states = presenceMap(sessions, "unknown"),
    root = join(home, "sessions");
  try {
    const projects = await readdir(root, { withFileTypes: true });
    if (
      projects.length > 10000 ||
      projects.some(
        (entry) =>
          entry.isSymbolicLink() ||
          (entry.isDirectory() && !/^(?:--.+--|_no-cwd)$/.test(entry.name)),
      )
    )
      return states;
    for (const session of sessions) {
      const id = session.nativeSessionId!;
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(id)) continue;
      let complete = true,
        found = false;
      for (const project of projects.filter((entry) => entry.isDirectory())) {
        try {
          const entries = await readdir(join(root, project.name, id), { withFileTypes: true });
          if (
            entries.some(
              (entry) =>
                entry.isFile() &&
                /^session(?:\.v[1-9][0-9]*)?\.jsonl(?:\.gz|\.zst|\.zstd)?$/.test(entry.name),
            )
          ) {
            found = true;
            break;
          }
          // An existing but empty/incompatible directory may be a pending write or migration.
          complete = false;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") complete = false;
        }
      }
      states[id] = found ? "present" : complete && standardProfile ? "missing" : "unknown";
    }
  } catch {
    /* Missing/unreadable roots cannot establish deletion. */
  }
  return states;
}
