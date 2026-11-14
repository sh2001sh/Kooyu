import type * as ClaudeSdk from "@anthropic-ai/claude-agent-sdk";

type HistorySdk = Pick<
  typeof ClaudeSdk,
  "getSessionMessages" | "listSubagents" | "getSubagentMessages"
>;
export interface ClaudeHistory {
  nativeSessionId: string;
  messages: ClaudeSdk.SessionMessage[];
  subagents: {
    agentId: string;
    parentAgentId: string;
    toolCallId?: string;
    messages?: ClaudeSdk.SessionMessage[];
    error?: string;
  }[];
  complete: boolean;
}

/** Also loaded in a short-lived child so SDK environment caches cannot cross binding homes. */
export async function readClaudeTree(
  sdk: HistorySdk,
  sessionId: string,
  dir: string,
): Promise<ClaudeHistory> {
  const maxBytes = 8 * 1024 * 1024;
  let bytes = 0;
  const read = async (agentId?: string) => {
    const messages: ClaudeSdk.SessionMessage[] = [];
    const seen = new Set<string>();
    for (let page = 0; ; page++) {
      if (page >= 100) throw new Error("Claude 历史分页超过读取上限。");
      const options = { dir, offset: messages.length, limit: 500 };
      const rows = agentId
        ? await sdk.getSubagentMessages(sessionId, agentId, options)
        : await sdk.getSessionMessages(sessionId, options);
      if (!Array.isArray(rows)) throw new Error("Claude 历史消息格式不兼容。");
      for (const row of rows) {
        if (
          !row ||
          row.session_id !== sessionId ||
          typeof row.uuid !== "string" ||
          !row.uuid ||
          seen.has(row.uuid) ||
          !row.message ||
          typeof row.message !== "object"
        )
          throw new Error("Claude 历史消息身份不匹配或重复。");
        seen.add(row.uuid);
        bytes += Buffer.byteLength(JSON.stringify(row));
        if (bytes > maxBytes) throw new Error("Claude 历史超过读取上限。");
        messages.push(row);
      }
      if (rows.length < 500) return messages;
    }
  };
  const messages = await read();
  const ids = await sdk.listSubagents(sessionId, { dir });
  if (!Array.isArray(ids) || ids.length > 1000)
    throw new Error("Claude 子代理列表超过读取上限或格式不兼容。");
  const known = new Set<string>();
  for (const id of ids) {
    if (
      typeof id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,200}$/.test(id) ||
      id === sessionId ||
      known.has(id)
    )
      throw new Error("Claude 子代理身份无效或重复。");
    known.add(id);
  }
  const pending: ClaudeHistory["subagents"] = [];
  for (const agentId of ids) {
    try {
      const history = await read(agentId);
      if (!history.length) throw new Error("Claude 子代理历史为空或已不可用。");
      const parents = new Set(history.map((row) => row.parent_agent_id ?? sessionId));
      const tools = new Set(
        history.map((row) => row.parent_tool_use_id).filter((id) => id != null),
      );
      const parent = parents.values().next().value!;
      if (
        parents.size !== 1 ||
        (parent !== sessionId && !known.has(parent)) ||
        parent === agentId ||
        tools.size > 1
      )
        throw new Error("Claude 子代理父级身份不匹配。");
      pending.push({
        agentId,
        parentAgentId: parent,
        ...(tools.size ? { toolCallId: tools.values().next().value! } : {}),
        messages: history,
      });
    } catch (error) {
      // Preserve readable siblings without presenting a missing child as complete.
      pending.push({ agentId, parentAgentId: sessionId, error: (error as Error).message });
    }
    if (bytes > maxBytes) throw new Error("Claude 子代理历史超过读取上限。");
  }
  const aliases = new Set([sessionId]);
  for (const child of pending) {
    const alias = child.toolCallId ?? child.agentId;
    if (aliases.has(alias)) throw new Error("Claude 子代理工具身份冲突。");
    aliases.add(alias);
  }
  const subagents: ClaudeHistory["subagents"] = [];
  const ordered = new Set([sessionId]);
  while (pending.length) {
    const index = pending.findIndex((child) => ordered.has(child.parentAgentId));
    if (index < 0) throw new Error("Claude 子代理父级关系存在环。");
    const [child] = pending.splice(index, 1);
    subagents.push(child!);
    ordered.add(child!.agentId);
  }
  return {
    nativeSessionId: sessionId,
    messages,
    subagents,
    complete: subagents.every((child) => !child.error),
  };
}
