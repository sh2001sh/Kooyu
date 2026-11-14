import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  buildSessionContext,
  migrateSessionEntries,
  SessionManager,
  type FileEntry,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { KodoError, type Session } from "@kodo/protocol";
import { readCompleteJsonLines } from "./native-history.js";
import type { AdapterContext } from "./adapter.js";
import { exactFilePresence, jsonLineHeader, presenceMap } from "./session-presence.js";
import { dirname, isAbsolute } from "node:path";

export async function inspectSdkSessions(sessions: Session[], ctx: AdapterContext) {
  const states = presenceMap(sessions, "unknown");
  for (const session of sessions) {
    try {
      const mapping = join(ctx.dataDir, session.harnessId, "sessions", session.id + ".json");
      const source = await readFile(mapping, "utf8").catch(async (error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT" || session.harnessId !== "kodo") throw error;
        return readFile(join(ctx.dataDir, "pi", "sessions", session.id + ".json"), "utf8");
      });
      const path: unknown = JSON.parse(source).path;
      if (typeof path !== "string" || !isAbsolute(path)) continue;
      const state = await exactFilePresence(dirname(path), path);
      if (state === "missing") {
        const entries = await readdir(dirname(path), { withFileTypes: true });
        if (entries.length > 2000 || entries.some((entry) => entry.isSymbolicLink())) continue;
        let complete = true,
          found = false;
        for (const entry of entries.filter(
          (entry) => entry.isFile() && entry.name.endsWith(".jsonl"),
        )) {
          const header = await jsonLineHeader(join(dirname(path), entry.name));
          if (header?.type !== "session" || typeof header.id !== "string") complete = false;
          if (header?.id === session.nativeSessionId) {
            found = true;
            break;
          }
        }
        states[session.nativeSessionId!] = found ? "present" : complete ? "missing" : "unknown";
      } else if (state === "present") {
        const header = await jsonLineHeader(path);
        if (header?.type === "session" && header.id === session.nativeSessionId)
          states[session.nativeSessionId!] = "present";
      }
    } catch {
      /* A lost mapping, corrupt header or inaccessible directory is not deletion. */
    }
  }
  return states;
}

/** Read SDK logs without SessionManager.open, which can migrate/rewrite native files. */
export async function readSdkHistory(session: Session, ctx: AdapterContext) {
  const mapping = join(ctx.dataDir, session.harnessId, "sessions", session.id + ".json");
  const source = await readFile(mapping, "utf8").catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT" || session.harnessId !== "kodo") throw error;
    return readFile(join(ctx.dataDir, "pi", "sessions", session.id + ".json"), "utf8");
  });
  const path: unknown = JSON.parse(source).path;
  if (typeof path !== "string" || !path)
    throw new KodoError("UNAVAILABLE", "SDK 会话路径映射无效，未创建替代会话。");
  const entries = (await readCompleteJsonLines(path)) as FileEntry[];
  const header = entries[0];
  if (header?.type !== "session" || header.id !== session.nativeSessionId)
    throw new KodoError("CONFLICT", "SDK 历史原生身份不匹配。");
  // Migrate only the in-memory copy; retain SDK branch/compaction/context-edit semantics.
  migrateSessionEntries(entries);
  return buildSessionContext(
    entries.filter((entry): entry is SessionEntry => entry.type !== "session"),
  ).messages;
}

export async function listSdkHistory(session: Session, ctx: AdapterContext) {
  const dir = join(ctx.dataDir, session.harnessId);
  const cwd = ctx.cwd ?? dir;
  const owners = ctx.sdkSessionOwners?.() ?? {};
  const primary = await SessionManager.list(cwd, join(dir, "sessions"));
  if (session.harnessId === "pi") return primary.filter((item) => owners[item.id] !== "kodo");
  const legacy = await SessionManager.list(cwd, join(ctx.dataDir, "pi", "sessions"));
  return [
    ...new Map(
      [...primary, ...legacy.filter((item) => owners[item.id] === "kodo")].map((item) => [
        item.id,
        item,
      ]),
    ).values(),
  ];
}
