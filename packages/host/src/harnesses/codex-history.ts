import type { Wire } from "./adapter.js";
import { NATIVE_HISTORY_LIMIT } from "./native-history.js";

export const codexSources = [
  "cli",
  "vscode",
  "exec",
  "appServer",
  "unknown",
  "subAgent",
  "subAgentReview",
  "subAgentCompact",
  "subAgentThreadSpawn",
  "subAgentOther",
];

type Request = (method: string, params: Wire) => Promise<Wire>;

/** Scan both archives with no provider filter; children can outlive their parent process. */
export async function listCodexThreads(request: Request) {
  const threads = new Map<string, Wire>();
  let bytes = 0;
  for (const archived of [false, true]) {
    let cursor: string | undefined;
    const seen = new Set<string>();
    for (let page = 0; ; page++) {
      if (page >= 100) throw new Error("Codex 历史分页超过读取上限。");
      const result = await request("thread/list", {
        archived,
        limit: 100,
        modelProviders: [],
        sourceKinds: codexSources,
        ...(cursor ? { cursor } : {}),
      });
      if (!Array.isArray(result.data)) throw new Error("Codex 历史列表格式不兼容。");
      for (const thread of result.data) {
        if (typeof thread?.id !== "string" || !thread.id)
          throw new Error("Codex 历史会话身份无效。");
        bytes += Buffer.byteLength(JSON.stringify(thread));
        if (bytes > NATIVE_HISTORY_LIMIT || threads.size >= 10000)
          throw new Error("Codex 历史列表超过读取上限。");
        threads.set(thread.id, thread);
      }
      if (result.nextCursor === null || result.nextCursor === undefined) break;
      if (
        typeof result.nextCursor !== "string" ||
        !result.nextCursor ||
        seen.has(result.nextCursor)
      )
        throw new Error("Codex 历史分页游标重复或无效。");
      cursor = result.nextCursor;
      seen.add(cursor);
    }
  }
  return { data: [...threads.values()], nextCursor: null };
}

export async function readCodexTree(request: Request, rootId: string, root?: Wire) {
  const result = root ?? (await request("thread/read", { threadId: rootId, includeTurns: true }));
  if (result.thread?.id !== rootId) throw new Error("Codex 历史会话身份不匹配。");
  const listing = await listCodexThreads(request);
  const candidates = new Map<string, string>();
  for (const thread of listing.data) {
    const parent = thread.source?.subagent?.thread_spawn?.parent_thread_id;
    if (typeof parent === "string" && thread.id !== rootId) candidates.set(thread.id, parent);
  }
  // Tool records preserve lineage even if a deleted child no longer appears in the index.
  const collect = (thread: Wire) => {
    for (const turn of thread.turns ?? [])
      for (const item of turn.items ?? []) {
        if (item.type === "collabAgentToolCall" && item.tool === "spawnAgent")
          for (const id of item.receiverThreadIds ?? [])
            if (typeof id === "string" && id !== rootId && !candidates.has(id))
              candidates.set(id, thread.id);
      }
  };
  collect(result.thread);
  const subagents: Wire[] = [],
    known = new Set([rootId]);
  let bytes = Buffer.byteLength(JSON.stringify(result));
  if (bytes > NATIVE_HISTORY_LIMIT) throw new Error("Codex 会话历史超过读取上限。");
  for (let index = 0; index < known.size; index++) {
    const parent = [...known][index]!;
    for (const [id, parentId] of candidates) {
      if (parentId !== parent || known.has(id)) continue;
      if (known.size >= 1000) throw new Error("Codex 子会话超过读取上限。");
      known.add(id);
      try {
        const child = await request("thread/read", { threadId: id, includeTurns: true });
        if (child.thread?.id !== id) throw new Error("Codex 子会话身份不匹配。");
        bytes += Buffer.byteLength(JSON.stringify(child));
        const sourceParent = child.thread.source?.subagent?.thread_spawn?.parent_thread_id;
        if (sourceParent && sourceParent !== parentId) throw new Error("Codex 子会话父级不匹配。");
        subagents.push({ agentId: id, parentAgentId: parentId, thread: child.thread });
        collect(child.thread);
      } catch (error) {
        subagents.push({ agentId: id, parentAgentId: parentId, error: (error as Error).message });
      }
      if (bytes > NATIVE_HISTORY_LIMIT) throw new Error("Codex 子会话历史超过读取上限。");
    }
  }
  return { ...result, subagents, complete: subagents.every((child) => !child.error) };
}
