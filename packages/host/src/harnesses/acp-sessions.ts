import { isAbsolute, resolve } from "node:path";
import { needCwd, unsupported, type AdapterContext, type Wire } from "./adapter.js";
import { JsonRpc, RpcRejected } from "./rpc.js";
import { NATIVE_HISTORY_LIMIT } from "./native-history.js";

/** null means explicitly unsupported, never a hidden transport/authentication error. */
export async function collectAcpSessions(rpc: JsonRpc, cwd: string): Promise<Wire[] | null> {
  const sessions = new Map<string, Wire>(),
    cursors = new Set<string>();
  const canonical = (path: string) =>
    process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);
  let cursor: string | undefined,
    bytes = 0,
    count = 0;
  for (let page = 0; page < 100; page++) {
    let result: Wire;
    try {
      result = await rpc.request("session/list", {
        cwd,
        ...(cursor === undefined ? {} : { cursor }),
      });
    } catch (error) {
      if (page === 0 && error instanceof RpcRejected && error.rpcCode === -32601) return null;
      throw error;
    }
    if (!result || !Array.isArray(result.sessions)) throw new Error("ACP 会话列表格式无效。");
    bytes += Buffer.byteLength(JSON.stringify(result));
    count += result.sessions.length;
    if (bytes > NATIVE_HISTORY_LIMIT || count > 20000)
      throw new Error("ACP 会话列表超过读取上限。");
    for (const item of result.sessions) {
      if (
        !item ||
        typeof item.sessionId !== "string" ||
        !item.sessionId ||
        typeof item.cwd !== "string" ||
        !isAbsolute(item.cwd)
      )
        throw new Error("ACP 会话列表缺少有效的原生 ID 或工作目录。");
      if (canonical(item.cwd) !== canonical(cwd) || sessions.has(item.sessionId)) continue;
      sessions.set(item.sessionId, {
        id: item.sessionId,
        sessionId: item.sessionId,
        cwd: item.cwd,
        title: typeof item.title === "string" ? item.title : null,
        updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : null,
      });
    }
    if (result.nextCursor == null) return [...sessions.values()];
    if (typeof result.nextCursor !== "string" || !result.nextCursor)
      throw new Error("ACP 会话列表游标无效。");
    if (cursors.has(result.nextCursor)) throw new Error("ACP 会话列表游标重复，读取已停止。");
    cursor = result.nextCursor;
    cursors.add(cursor!);
  }
  throw new Error("ACP 会话列表超过分页上限。");
}

/** A separate inspection connection never creates, resumes, loads, or prompts a session. */
export async function listAcpSessions(ctx: AdapterContext): Promise<Wire[] | null> {
  const cwd = needCwd(ctx),
    rpc = new JsonRpc(ctx);
  try {
    const init = await rpc.request("initialize", {
      protocolVersion: 1,
      clientInfo: { name: "kodo-history", version: "0.1.0" },
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    });
    if (init.protocolVersion !== 1) unsupported("ACP 会话列表协议版本不兼容。");
    if (!init.agentCapabilities?.sessionCapabilities?.list) return null;
    return await collectAcpSessions(rpc, cwd);
  } finally {
    await rpc.close();
  }
}
