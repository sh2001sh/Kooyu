import { acpHarness } from "./acp.js";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { unsupported, type AdapterContext, type HarnessAdapter } from "./adapter.js";
import { captureNativeCommand } from "./native-command.js";
import { readAcpHistory } from "./acp-history.js";
import { listAcpSessions } from "./acp-sessions.js";
import type { HarnessModelOption } from "@kodo/protocol";
import { exactFilePresence, nativeUserHome, presenceMap } from "./session-presence.js";

export async function listCursorSessions(root: string, cwd: string) {
  const entries = (
    await readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    })
  ).filter(
    (entry) =>
      entry.isDirectory() && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(entry.name),
  );
  if (entries.length > 2000) unsupported("Cursor 本地会话过多，无法安全列出。");
  const actualRoot = entries.length ? await realpath(root) : root;
  const samePath = (path: string) =>
    process.platform === "win32"
      ? resolve(path).toLowerCase() === resolve(cwd).toLowerCase()
      : resolve(path) === resolve(cwd);
  const sessions = [];
  for (const entry of entries) {
    try {
      const path = await realpath(join(root, entry.name, "meta.json"));
      const within = relative(actualRoot, path);
      if (!within || within === ".." || within.startsWith(".." + sep) || isAbsolute(within))
        continue;
      const info = await stat(path);
      if (!info.isFile() || info.size > 4096) continue;
      const metadata = JSON.parse(await readFile(path, "utf8"));
      if (
        metadata.schemaVersion !== 1 ||
        typeof metadata.cwd !== "string" ||
        !samePath(metadata.cwd)
      )
        continue;
      sessions.push({
        id: entry.name,
        title: typeof metadata.title === "string" ? metadata.title : null,
        cwd: metadata.cwd,
        updatedAt: info.mtime.toISOString(),
      });
    } catch {
      // Ignore a session being created or removed during the listing.
    }
  }
  return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

const acp = acpHarness("cursor", "Cursor");
const nativeList = async (_session: unknown, ctx: AdapterContext) => {
  if (!ctx.cwd) unsupported("Cursor 本地会话列表需要工作位置。");
  return (
    (await listAcpSessions(ctx)) ??
    listCursorSessions(
      join(nativeUserHome({ ...ctx.env, ...ctx.launch.env }), ".cursor", "acp-sessions"),
      ctx.cwd,
    )
  );
};
export const cursorAdapter: HarnessAdapter = {
  ...acp,
  async discoverModels(ctx): Promise<HarnessModelOption[]> {
    if (ctx.launch.args.at(-1) !== "acp") unsupported("该 Cursor 入口不支持原生模型列表。");
    const output = await captureNativeCommand(ctx, [...ctx.launch.args.slice(0, -1), "models"]);
    if (!output.includes("Available models"))
      unsupported("Cursor 原生模型目录格式不兼容或未登录。");
    const models: HarnessModelOption[] = [];
    for (const line of output.split(String.fromCharCode(10))) {
      const match = /^([a-z0-9][a-z0-9._-]*) - (.+)$/i.exec(line.trim());
      if (!match) continue;
      models.push({
        id: match[1]!,
        name: match[2]!.replace(/ ((?:current|default)(?:, (?:current|default))?)$/, ""),
        source: "discovered",
        ...(line.includes("default)") ? { isDefault: true } : {}),
        ...(line.includes("current") ? { isCurrent: true } : {}),
      });
    }
    if (!models.length) unsupported("Cursor 未返回可用模型。");
    return models;
  },
  descriptor: {
    ...acp.descriptor,
    evidence:
      "ACP v1; conditional loadSession history replay; paginated native session/list with bounded local metadata fallback",
    capabilities: { ...acp.descriptor.capabilities, historyRead: "supported" },
  },
  standaloneRead: readAcpHistory,
  standaloneList: nativeList,
  async inspectSessions(sessions, ctx) {
    const states = presenceMap(sessions, "unknown");
    if (!ctx.cwd) return states;
    try {
      const root = join(
        nativeUserHome({ ...ctx.env, ...ctx.launch.env }),
        ".cursor",
        "acp-sessions",
      );
      const local = await listCursorSessions(root, ctx.cwd);
      // ACP session/list does not promise archived entries. Its absence is not deletion.
      const remote = await listAcpSessions(ctx);
      for (const session of sessions) {
        const id = session.nativeSessionId!;
        if (remote?.some((item) => item.id === id) || local.some((item) => item.id === id))
          states[id] = "present";
        else if (remote === null && /^[0-9a-f-]{36}$/i.test(id))
          states[id] = await exactFilePresence(root, join(root, id, "meta.json"));
      }
    } catch {
      /* Unsupported transports and unreadable metadata preserve records. */
    }
    return states;
  },
  async connect(session, ctx) {
    const runtime = await acp.connect(session, ctx);
    return {
      ...runtime,
      list: () => nativeList(session, ctx),
      read: () => readAcpHistory({ ...session, nativeSessionId: runtime.nativeSessionId }, ctx),
    };
  },
};
