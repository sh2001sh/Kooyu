import { presenceMap } from "./session-presence.js";
import { acpHarness } from "./acp.js";
import { listAcpSessions } from "./acp-sessions.js";
import { readAcpHistory } from "./acp-history.js";
import { unsupported, type HarnessAdapter } from "./adapter.js";

const acp = acpHarness("antigravity", "Antigravity");

export const antigravityAdapter: HarnessAdapter = {
  ...acp,
  descriptor: {
    ...acp.descriptor,
    modelSupport: "native-models",
    evidence:
      "Google Antigravity CLI agy acp; model selection, permissions and session loading negotiated at runtime",
    capabilities: { ...acp.descriptor.capabilities, historyRead: "supported" },
  },
  async connect(session, ctx) {
    const runtime = await acp.connect(session, ctx);
    return {
      ...runtime,
      read: () => readAcpHistory({ ...session, nativeSessionId: runtime.nativeSessionId }, ctx),
    };
  },
  async inspectSessions(sessions, ctx) {
    const states = presenceMap(sessions, "unknown");
    if (!ctx.cwd) return states;
    const listed = await listAcpSessions(ctx);
    for (const item of listed ?? []) {
      if (Object.hasOwn(states, item.id)) states[item.id] = "present";
    }
    return states;
  },
  standaloneRead: readAcpHistory,
  async standaloneList(_session, ctx) {
    return (await listAcpSessions(ctx)) ?? unsupported("当前 Antigravity CLI 未提供会话列表。");
  },
};
