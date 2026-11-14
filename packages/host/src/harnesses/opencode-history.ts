import type { Wire } from "./adapter.js";
import { NATIVE_HISTORY_LIMIT } from "./native-history.js";

/** The children endpoint is authoritative for parentage; the global session list can hide children. */
export async function readOpenCodeTree(request: (path: string) => Promise<Wire>, rootId: string) {
  const messages = await request(`/session/${encodeURIComponent(rootId)}/message`);
  if (!Array.isArray(messages)) throw new Error("OpenCode 历史消息格式不兼容。");
  if (messages.some((row) => row.info?.sessionID !== rootId || !Array.isArray(row.parts)))
    throw new Error("OpenCode 历史消息身份不匹配。");
  const subagents: Wire[] = [],
    queue = [rootId],
    seen = new Set(queue);
  let bytes = Buffer.byteLength(JSON.stringify(messages));
  if (bytes > NATIVE_HISTORY_LIMIT) throw new Error("OpenCode 历史超过读取上限。");
  for (let index = 0; index < queue.length; index++) {
    const parent = queue[index]!;
    const rows = await request(`/session/${encodeURIComponent(parent)}/children`);
    if (!Array.isArray(rows)) throw new Error("OpenCode 子会话列表格式不兼容。");
    for (const info of rows) {
      if (typeof info?.id !== "string" || !info.id || info.parentID !== parent || seen.has(info.id))
        throw new Error("OpenCode 子会话身份或父级不匹配。");
      if (seen.size >= 1000) throw new Error("OpenCode 子会话超过读取上限。");
      seen.add(info.id);
      let child: Wire;
      try {
        const history = await request(`/session/${encodeURIComponent(info.id)}/message`);
        if (!Array.isArray(history)) throw new Error("OpenCode 子会话历史格式不兼容。");
        if (history.some((row) => row.info?.sessionID !== info.id || !Array.isArray(row.parts)))
          throw new Error("OpenCode 子会话消息身份不匹配。");
        child = { agentId: info.id, parentAgentId: parent, info, messages: history };
      } catch (error) {
        child = { agentId: info.id, parentAgentId: parent, info, error: (error as Error).message };
      }
      bytes += Buffer.byteLength(JSON.stringify(child));
      if (bytes > NATIVE_HISTORY_LIMIT) throw new Error("OpenCode 子会话历史超过读取上限。");
      subagents.push(child);
      queue.push(info.id);
    }
  }
  return {
    nativeSessionId: rootId,
    messages,
    subagents,
    complete: subagents.every((child) => !child.error),
  };
}
