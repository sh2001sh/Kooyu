import { acpHarness } from "./acp.js";
import { unsupported, type AdapterContext, type HarnessAdapter } from "./adapter.js";
import type { HarnessModelOption, Session } from "@kodo/protocol";
import { captureNativeCommand } from "./native-command.js";
import { listAcpSessions } from "./acp-sessions.js";
import { mkdir, readFile, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { exactFilePresence, presenceMap } from "./session-presence.js";

const acp = acpHarness("grok-build", "Grok Build");

/** Grok's private workspace scratch folders can fail under Windows' shared TEMP ACLs.
 * Use Host-owned storage and a dedicated process, so an existing leader cannot
 * retain the broken environment. This leaves native tools and user homes intact. */
export async function grokWorkspaceContext(
  ctx: AdapterContext,
  platform: NodeJS.Platform = process.platform,
): Promise<AdapterContext> {
  if (platform !== "win32") return ctx;
  const scratch = join(resolve(ctx.dataDir), "native-tmp", "grok");
  await mkdir(scratch, { recursive: true, mode: 0o700 });
  const args = [...ctx.launch.args];
  if (args.at(-1) === "stdio" && args.includes("agent") && !args.includes("--no-leader"))
    args.splice(args.length - 1, 0, "--no-leader");
  return {
    ...ctx,
    launch: {
      ...ctx.launch,
      args,
      env: { ...ctx.launch.env, TEMP: scratch, TMP: scratch, TMPDIR: scratch },
    },
  };
}
const samePath = (left: string, right: string) =>
  process.platform === "win32"
    ? resolve(left).toLowerCase() === resolve(right).toLowerCase()
    : resolve(left) === resolve(right);

async function listGrok(_session: Session, ctx: AdapterContext) {
  if (!ctx.cwd) unsupported("Grok 本地会话列表需要工作位置。");
  const native = await listAcpSessions(ctx);
  if (native !== null) return native;
  const home = ctx.launch.env?.GROK_HOME ?? ctx.env.GROK_HOME ?? join(homedir(), ".grok");
  const path = join(home, "sessions", encodeURIComponent(ctx.cwd));
  const entries = await readdir(path, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  if (entries.length > 2000) unsupported("Grok 本地会话过多，无法安全列出。");
  const root = entries.length ? await realpath(path) : path;
  const sessions = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(entry.name))
      continue;
    try {
      const summaryPath = await realpath(join(path, entry.name, "summary.json"));
      const withinRoot = relative(root, summaryPath);
      if (
        !withinRoot ||
        withinRoot === ".." ||
        withinRoot.startsWith(".." + sep) ||
        isAbsolute(withinRoot)
      )
        continue;
      const info = await stat(summaryPath);
      if (!info.isFile() || info.size > 65536) continue;
      const summary = JSON.parse(await readFile(summaryPath, "utf8"));
      if (summary.info?.id !== entry.name || !samePath(summary.info?.cwd ?? "", ctx.cwd)) continue;
      sessions.push({
        id: entry.name,
        title: typeof summary.generated_title === "string" ? summary.generated_title : null,
        cwd: ctx.cwd,
        createdAt: summary.created_at,
        updatedAt: summary.updated_at,
        model: typeof summary.current_model_id === "string" ? summary.current_model_id : null,
      });
    } catch {
      // A session can be written or removed while listing.
    }
  }
  return sessions.sort((a, b) =>
    String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")),
  );
}
async function readGrok(session: Session, ctx: AdapterContext) {
  const nativeId = session.nativeSessionId;
  if (!nativeId) unsupported("Grok 会话没有原生 ID。");
  const args = ctx.launch.args;
  if (args.at(-2) !== "agent" || args.at(-1) !== "stdio")
    unsupported("该 Grok 入口未声明可调用的原生 export 命令。");
  const transcript = await captureNativeCommand(ctx, [...args.slice(0, -2), "export", nativeId]);
  return { nativeSessionId: nativeId, format: "markdown", transcript };
}
export const grokBuildAdapter: HarnessAdapter = {
  ...acp,
  async discoverModels(ctx): Promise<HarnessModelOption[]> {
    const args = ctx.launch.args;
    if (args.at(-2) !== "agent" || args.at(-1) !== "stdio")
      unsupported("该 Grok 入口不支持原生模型列表。");
    const output = await captureNativeCommand(ctx, [...args.slice(0, -2), "models"]);
    if (/not authenticated/i.test(output) || !output.includes("Available models:"))
      unsupported("Grok 模型目录需要已登录的原生账号。");
    const models: HarnessModelOption[] = [];
    for (const line of output.split(String.fromCharCode(10))) {
      const match = /^ *([*-]) +([a-z0-9][a-z0-9._-]*)(?: +[(]default[)])? *$/i.exec(line);
      if (match)
        models.push({
          id: match[2]!,
          source: "discovered",
          ...(match[1] === "*" ? { isDefault: true } : {}),
        });
    }
    if (!models.length) unsupported("Grok 未返回可用模型。");
    return models;
  },
  descriptor: {
    ...acp.descriptor,
    evidence: `${acp.descriptor.evidence}; standalone native CLI transcript export`,
    capabilities: { ...acp.descriptor.capabilities, historyRead: "supported" },
  },
  standaloneRead: readGrok,
  standaloneList: listGrok,
  async inspectSessions(sessions, ctx) {
    const states = presenceMap(sessions, "unknown");
    if (!ctx.cwd) return states;
    try {
      const remote = await listAcpSessions(ctx);
      const home = ctx.launch.env?.GROK_HOME ?? ctx.env.GROK_HOME ?? join(homedir(), ".grok");
      const root = join(home, "sessions", encodeURIComponent(ctx.cwd));
      for (const session of sessions) {
        const id = session.nativeSessionId!;
        if (remote?.some((item) => item.id === id)) states[id] = "present";
        else if (remote === null && /^[0-9a-f-]{36}$/i.test(id))
          states[id] = await exactFilePresence(root, join(root, id, "summary.json"));
      }
    } catch {
      /* Never use filtered/unsupported ACP history as negative evidence. */
    }
    return states;
  },
  async connect(session, ctx) {
    const runtime = await acp.connect(session, await grokWorkspaceContext(ctx));
    return {
      ...runtime,
      read: () => readGrok({ ...session, nativeSessionId: runtime.nativeSessionId }, ctx),
      list: () => listGrok(session, ctx),
    };
  },
};
