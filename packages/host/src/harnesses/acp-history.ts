import type { Session } from "@kodo/protocol";
import { needCwd, unsupported, type AdapterContext, type Wire } from "./adapter.js";
import { JsonRpc } from "./rpc.js";
import { NATIVE_HISTORY_LIMIT } from "./native-history.js";

/** ACP has no read method: loadSession replays history before replying, without a prompt. */
export async function readAcpHistory(session: Session, ctx: AdapterContext) {
  const nativeId = session.nativeSessionId;
  if (!nativeId) unsupported("历史读取需要原生会话 ID。");
  const cwd = needCwd(ctx),
    rpc = new JsonRpc(ctx);
  const messages: Wire[] = [],
    tools = new Map<string, Wire>();
  let bytes = 0;
  rpc.onRequest = async (method) => {
    if (method === "session/request_permission") return { outcome: { outcome: "cancelled" } };
    unsupported("历史检查不执行文件或终端操作。");
  };
  rpc.onNotification = (method, p) => {
    if (method !== "session/update" || p.sessionId !== nativeId) return;
    const update = p.update as Wire;
    if (!update) return;
    bytes += Buffer.byteLength(JSON.stringify(update));
    if (bytes > NATIVE_HISTORY_LIMIT || messages.length >= 20000)
      throw new Error("ACP 原生历史超过单次读取上限。");
    if (["user_message_chunk", "agent_message_chunk"].includes(update.sessionUpdate)) {
      const role = update.sessionUpdate === "user_message_chunk" ? "user" : "assistant";
      if (update.content?.type !== "text" || typeof update.content.text !== "string") return;
      const previous = messages.at(-1);
      if (previous?.role === role) previous.content += update.content.text;
      else messages.push({ role, content: update.content.text });
    } else if (["tool_call", "tool_call_update"].includes(update.sessionUpdate)) {
      if (typeof update.toolCallId !== "string") return;
      let tool = tools.get(update.toolCallId);
      if (!tool) {
        tool = { role: "tool", toolCallId: update.toolCallId };
        tools.set(update.toolCallId, tool);
        messages.push(tool);
      }
      for (const key of ["title", "kind", "status", "content", "rawInput", "rawOutput"])
        if (update[key] !== undefined) tool[key] = update[key];
    }
  };
  try {
    const init = await rpc.request("initialize", {
      protocolVersion: 1,
      clientInfo: { name: "kodo-history", version: "0.1.0" },
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    });
    if (init.protocolVersion !== 1 || !init.agentCapabilities?.loadSession)
      unsupported("该原生 ACP 安装未声明 loadSession 历史回放能力。");
    const result = await rpc.request("session/load", { sessionId: nativeId, cwd, mcpServers: [] });
    if (result.sessionId && result.sessionId !== nativeId)
      throw new Error("ACP 历史回放身份不匹配。");
    return { nativeSessionId: nativeId, source: "acp-session-load", messages };
  } finally {
    await rpc.close();
  }
}
