import { open, readFile, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { HarnessModelOption, Session } from "@kodo/protocol";
import { acpHarness } from "./acp.js";
import { unsupported, type AdapterContext, type HarnessAdapter, type Wire } from "./adapter.js";
import { readCompleteJsonLines } from "./native-history.js";
import { captureNativeCommand } from "./native-command.js";
import { presenceMap } from "./session-presence.js";

const acp = acpHarness("gemini", "Gemini CLI");
const samePath = (left: string, right: string) =>
  process.platform === "win32"
    ? resolve(left).toLowerCase() === resolve(right).toLowerCase()
    : resolve(left) === resolve(right);

async function projectChats(home: string, cwd: string) {
  const absent = (error: NodeJS.ErrnoException): null => {
    if (error.code === "ENOENT") return null;
    throw error;
  };
  const root = await realpath(join(home, ".gemini")).catch(absent);
  if (!root) return null;
  const mappingPath = join(root, "projects.json");
  const mappingInfo = await stat(mappingPath).catch(absent);
  if (!mappingInfo) return null;
  if (!mappingInfo.isFile() || mappingInfo.size > 1024 * 1024)
    unsupported("Gemini 项目映射超过读取上限或不是文件。");
  const mapping = JSON.parse(await readFile(mappingPath, "utf8")) as Wire;
  const projects = mapping.projects;
  if (!projects || typeof projects !== "object" || Array.isArray(projects))
    unsupported("Gemini 项目映射格式不兼容。");
  const entry = Object.entries(projects).find(([path]) => samePath(path, cwd));
  if (!entry) return null;
  const slug = entry?.[1];
  if (typeof slug !== "string" || !/^[a-z0-9][a-z0-9._-]*$/i.test(slug))
    unsupported("Gemini 原生项目映射中没有当前工作位置。");
  const chats = await realpath(join(root, "tmp", slug, "chats")).catch(absent);
  if (!chats) return null;
  const underRoot = relative(root, chats);
  if (!underRoot || underRoot === ".." || underRoot.startsWith(".." + sep) || isAbsolute(underRoot))
    unsupported("Gemini 历史目录不在原生配置目录内。");
  const files = (await readdir(chats, { withFileTypes: true })).filter(
    (file) => file.isFile() && /^session-.*\.jsonl$/.test(file.name),
  );
  if (files.length > 2000) unsupported("Gemini 原生历史文件过多，无法安全定位会话。");
  const unsupportedFiles = (await readdir(chats)).some((name) => /^session-.*\.json$/.test(name));
  return { chats, files: files.map((file) => join(chats, file.name)), unsupportedFiles };
}

async function chatMetadata(path: string): Promise<Wire | null> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (!buffer.subarray(0, bytesRead).includes(10)) return null;
    const head = buffer.subarray(0, bytesRead).toString("utf8").split("\n", 1)[0] ?? "";
    const metadata = JSON.parse(head) as Wire;
    return typeof metadata.sessionId === "string" ? metadata : null;
  } catch {
    return null;
  } finally {
    await handle.close();
  }
}

async function sessionLog(home: string, cwd: string, nativeId: string): Promise<string> {
  const project = await projectChats(home, cwd);
  if (!project) unsupported("Gemini 原生历史中没有此会话 ID。");
  const { chats, files } = project;
  for (const path of files) {
    if ((await chatMetadata(path))?.sessionId !== nativeId) continue;
    const actual = await realpath(path);
    const underChats = relative(chats, actual);
    if (
      !underChats ||
      underChats === ".." ||
      underChats.startsWith(".." + sep) ||
      isAbsolute(underChats)
    )
      unsupported("Gemini 历史文件不在已确认的聊天目录内。");
    return actual;
  }
  return unsupported("Gemini 原生历史中没有此会话 ID。");
}

async function listGemini(_session: Session, ctx: AdapterContext) {
  if (!ctx.cwd) unsupported("Gemini 历史列表需要工作位置。");
  const home = ctx.launch.env?.GEMINI_CLI_HOME ?? ctx.env.GEMINI_CLI_HOME ?? homedir();
  const project = await projectChats(home, ctx.cwd);
  if (!project) return [];
  const { files } = project;
  const sessions: Wire[] = [];
  for (const path of files) {
    const metadata = await chatMetadata(path);
    if (metadata)
      sessions.push({
        id: metadata.sessionId,
        kind: metadata.kind,
        createdAt: metadata.startTime,
        updatedAt: metadata.lastUpdated,
      });
  }
  return sessions.sort((a, b) =>
    String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")),
  );
}

async function readGemini(session: Session, ctx: AdapterContext) {
  const nativeId = session.nativeSessionId;
  if (!nativeId || !ctx.cwd) unsupported("Gemini 历史读取需要原生 ID 和工作位置。");
  const home = ctx.launch.env?.GEMINI_CLI_HOME ?? ctx.env.GEMINI_CLI_HOME ?? homedir();
  const path = await sessionLog(home, ctx.cwd, nativeId);
  const records = await readCompleteJsonLines(path);
  if (records[0]?.sessionId !== nativeId)
    unsupported("Gemini 原生历史会话 ID 在读取期间发生变化。");
  const messages: Wire[] = [];
  for (const record of records.slice(1)) {
    if (record.type === "user" && Array.isArray(record.content)) {
      const content = record.content
        .filter((part: Wire) => typeof part?.text === "string")
        .map((part: Wire) => part.text as string)
        .filter(
          (text: string) => !/^\s*<session_context>[\s\S]*<\/session_context>\s*$/.test(text),
        );
      if (content.length) messages.push({ role: "user", content });
    } else if (record.type === "gemini") {
      if (typeof record.content === "string" && record.content)
        messages.push({ role: "assistant", content: record.content });
      if (Array.isArray(record.toolCalls))
        for (const call of record.toolCalls)
          messages.push({
            role: "tool",
            name: call.name,
            status: call.status,
            result: call.result,
          });
    }
  }
  return { nativeSessionId: nativeId, messages };
}

export const geminiAdapter: HarnessAdapter = {
  ...acp,
  async discoverModels(ctx): Promise<HarnessModelOption[]> {
    if (ctx.launch.args.at(-1) !== "--acp") unsupported("该 Gemini 入口不支持原生模型列表。");
    const output = await captureNativeCommand(ctx, [
      ...ctx.launch.args.slice(0, -1),
      "models",
      "list",
      "--output-format",
      "json",
    ]);
    const listing = JSON.parse(output) as Wire[];
    if (!Array.isArray(listing)) unsupported("Gemini 原生模型目录格式不兼容。");
    return listing
      .filter((item) => typeof item.modelId === "string" && item.modelId)
      .map((item) => ({
        id: item.modelId,
        name: typeof item.displayName === "string" ? item.displayName : item.modelId,
        source: "discovered" as const,
        ...(Number.isSafeInteger(item.contextLimits?.inputTokens)
          ? { maxInputTokens: item.contextLimits.inputTokens }
          : {}),
        ...(Number.isSafeInteger(item.contextLimits?.outputTokens)
          ? { maxOutputTokens: item.contextLimits.outputTokens }
          : {}),
      }));
  },
  descriptor: {
    ...acp.descriptor,
    evidence: acp.descriptor.evidence + "; exact native Gemini JSONL session history",
    capabilities: { ...acp.descriptor.capabilities, historyRead: "supported" },
  },
  standaloneRead: readGemini,
  standaloneList: listGemini,
  async inspectSessions(sessions, ctx) {
    const states = presenceMap(sessions, "unknown");
    if (!ctx.cwd) return states;
    const home = ctx.launch.env?.GEMINI_CLI_HOME ?? ctx.env.GEMINI_CLI_HOME ?? homedir();
    try {
      const project = await projectChats(home, ctx.cwd);
      if (!project) return states;
      const ids = new Set<string>();
      let complete = !project.unsupportedFiles;
      for (const path of project.files) {
        const header = await chatMetadata(path);
        if (typeof header?.sessionId === "string") ids.add(header.sessionId);
        else complete = false;
      }
      for (const session of sessions)
        states[session.nativeSessionId!] = ids.has(session.nativeSessionId!)
          ? "present"
          : complete
            ? "missing"
            : "unknown";
    } catch {
      /* Permission, schema and concurrent-file errors preserve local records. */
    }
    return states;
  },
  async connect(session, ctx) {
    const runtime = await acp.connect(session, ctx);
    return {
      ...runtime,
      read: () => readGemini({ ...session, nativeSessionId: runtime.nativeSessionId }, ctx),
      list: () => listGemini(session, ctx),
    };
  },
};
