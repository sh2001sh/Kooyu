import { boundModelOption } from "../providers/model-option.js";
import {
  descriptor,
  needCwd,
  unsupported,
  type HarnessAdapter,
  type AdapterContext,
  type Wire,
} from "./adapter.js";
import { JsonRpc, RpcRejected } from "./rpc.js";
import { codexModelOptions, validateReasoning } from "./model-options.js";
import type { PermissionMode } from "@kodo/protocol";
import { existsSync } from "node:fs";
import { NativeSubagents } from "./subagents.js";
import { listCodexThreads, readCodexTree } from "./codex-history.js";

function permissionPolicy(mode: PermissionMode | null | undefined) {
  if (!mode) return {};
  return {
    approvalPolicy: mode === "full-access" ? "never" : "on-request",
    sandboxPolicy: {
      type:
        mode === "full-access"
          ? "dangerFullAccess"
          : mode === "read-only"
            ? "readOnly"
            : "workspaceWrite",
    },
  };
}
async function inspectCodex(ctx: AdapterContext, read: (rpc: JsonRpc) => Promise<unknown>) {
  const rpc = new JsonRpc(ctx, false);
  try {
    await rpc.request("initialize", { clientInfo: { name: "kodo", version: "0.1.0" } });
    rpc.notify("initialized");
    return await read(rpc);
  } finally {
    await rpc.close();
  }
}
export const codexAdapter: HarnessAdapter = {
  descriptor: descriptor(
    "codex",
    "Codex",
    "app-server",
    [
      "directChat",
      "historyRead",
      "resume",
      "observeLive",
      "steer",
      "cancel",
      "interaction",
      "usage",
      "quota",
    ],
    "Official app-server stdio; installed schema must be verified; no cross-process takeover",
    "implemented",
  ),
  standaloneRead: (session, ctx) => {
    if (!session.nativeSessionId) unsupported("没有可读取的原生会话。");
    return inspectCodex(ctx, (rpc) =>
      readCodexTree((method, params) => rpc.request(method, params), session.nativeSessionId!),
    );
  },
  inspectSessions: async (sessions, ctx) => {
    if (ctx.env.CODEX_HOME && !existsSync(ctx.env.CODEX_HOME))
      return Object.fromEntries(sessions.map((session) => [session.nativeSessionId!, "unknown"]));
    return inspectCodex(ctx, async (rpc) => {
      const states: Record<string, "present" | "missing" | "unknown"> = {};
      const listed = new Set<string>();
      try {
        // A fresh app-server may report "thread not loaded" even for stored
        // threads. Scan every provider/source, including archived history first.
        for (const archived of [false, true]) {
          let cursor: string | undefined;
          const cursors = new Set<string>();
          for (let page = 0; ; page++) {
            if (page >= 100) throw new Error("Incomplete Codex history");
            const result = await rpc.request("thread/list", {
              archived,
              limit: 100,
              modelProviders: [],
              sourceKinds: [
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
              ],
              ...(cursor ? { cursor } : {}),
            });
            if (!Array.isArray(result.data)) throw new Error("Invalid Codex history");
            for (const thread of result.data) {
              if (typeof thread?.id !== "string") throw new Error("Invalid Codex thread");
              listed.add(thread.id);
            }
            if (result.nextCursor === null) break;
            if (
              typeof result.nextCursor !== "string" ||
              !result.nextCursor ||
              cursors.has(result.nextCursor)
            )
              throw new Error("Invalid Codex history cursor");
            cursor = result.nextCursor;
            cursors.add(cursor);
          }
        }
      } catch {
        return Object.fromEntries(
          sessions.map((session) => [
            session.nativeSessionId!,
            listed.has(session.nativeSessionId!) ? "present" : "unknown",
          ]),
        );
      }
      for (const session of sessions) {
        const id = session.nativeSessionId!;
        if (listed.has(id)) {
          states[id] = "present";
          continue;
        }
        try {
          const result = await rpc.request("thread/read", { threadId: id, includeTurns: false });
          states[id] = result.thread?.id === id ? "present" : "unknown";
        } catch (error) {
          // "Not loaded" is absence evidence only after both complete scans.
          // Auth, storage and transport errors must never erase local conversations.
          states[id] =
            error instanceof RpcRejected &&
            error.message.includes(id) &&
            /no rollout found for thread id|thread (?:not found|does not exist|not loaded:)|(?:thread|conversation) with (?:id|ID) .+ (?:not found|does not exist)/i.test(
              error.message,
            )
              ? "missing"
              : "unknown";
        }
      }
      return states;
    }) as Promise<Record<string, "present" | "missing" | "unknown">>;
  },
  standaloneList: (_session, ctx) =>
    inspectCodex(ctx, (rpc) => listCodexThreads((method, params) => rpc.request(method, params))),
  async discoverModels(ctx) {
    const rpc = new JsonRpc(ctx, false);
    try {
      await rpc.request("initialize", { clientInfo: { name: "kodo", version: "0.1.0" } });
      rpc.notify("initialized");
      const models = [];
      let cursor: string | undefined;
      do {
        const result = await rpc.request("model/list", {
          limit: 100,
          ...(cursor ? { cursor } : {}),
        });
        models.push(...codexModelOptions(result.data ?? []));
        cursor = result.nextCursor ?? undefined;
      } while (cursor && models.length < 1000);
      return models;
    } finally {
      await rpc.close();
    }
  },
  async connect(session, ctx) {
    needCwd(ctx);
    const rpc = new JsonRpc(ctx, false);
    let nativeId = session.nativeSessionId ?? "",
      runId: string | null = null,
      emptyHistory = !session.nativeSessionId;
    const children = new NativeSubagents(ctx, () => nativeId);
    rpc.onClose = (e) => ctx.emit("disconnected", { message: e.message });
    rpc.onNotification = (method, p) => {
      if (method === "thread/started") {
        const source = p.thread?.source?.subagent?.thread_spawn;
        if (source)
          children.register(p.thread.id, source.parent_thread_id, {
            name: source.agent_nickname ?? source.agent_role ?? undefined,
            status: "running",
          });
      }
      const owner = p.threadId ?? p.item?.senderThreadId;
      if ((owner === nativeId || children.has(owner)) && p.item?.type === "collabAgentToolCall") {
        const item = p.item;
        for (const id of item.receiverThreadIds ?? []) {
          if (item.tool !== "spawnAgent" && !children.has(id)) continue;
          const state = item.agentsStates?.[id];
          if (
            children.register(id, owner, {
              ...(state?.status ? { status: state.status } : {}),
              ...(item.tool === "spawnAgent" ? { toolCallId: item.id } : {}),
            })
          ) {
            if (state?.message)
              children.emit(
                id,
                "message",
                { id: `agent-result:${id}`, role: "assistant", text: state.message },
                `collab:${item.id}:${method}:${id}`,
              );
          }
        }
      }
      if (children.has(p.threadId)) {
        const id = p.threadId;
        if (method === "item/agentMessage/delta")
          children.emit(id, "text-delta", { text: p.delta, itemId: p.itemId }, p.eventId);
        else if (["item/reasoning/summaryTextDelta", "item/reasoning/textDelta"].includes(method))
          children.emit(
            id,
            "text-delta",
            { text: p.delta, itemId: p.itemId, channel: "thought" },
            p.eventId,
          );
        else if (["item/started", "item/completed"].includes(method)) {
          const item = p.item;
          if (item?.type === "agentMessage" && method === "item/completed")
            children.emit(id, "message", item, `item:${item.id}:completed`);
          else if (item && !["userMessage", "reasoning", "agentMessage"].includes(item.type))
            children.emit(
              id,
              "tool",
              { ...item, lifecycle: method === "item/started" ? "started" : "completed" },
              `item:${item.id}:${method}`,
            );
        } else if (method === "turn/completed")
          children.emit(
            id,
            "turn-ended",
            { outcome: p.turn.status, error: p.turn.error },
            `turn:${p.turn.id}:end`,
          );
        else if (method === "turn/started") children.emit(id, "state", { runState: "running" });
        else if (method === "error")
          children.emit(id, p.willRetry ? "state" : "error", p, p.eventId);
        return;
      }
      if (p.threadId && p.threadId !== nativeId) return;
      const eventId = p.eventId ?? undefined;
      if (method === "turn/started") {
        runId = p.turn.id;
        emptyHistory = false;
        ctx.emit("state", { runState: "running" }, eventId, runId);
      } else if (method === "item/agentMessage/delta")
        ctx.emit("text-delta", { text: p.delta, itemId: p.itemId }, eventId, runId);
      else if (
        method === "item/reasoning/summaryTextDelta" ||
        method === "item/reasoning/textDelta"
      )
        ctx.emit(
          "text-delta",
          { text: p.delta, itemId: p.itemId, channel: "thought" },
          eventId,
          runId,
        );
      else if (method === "item/reasoning/summaryPartAdded")
        ctx.emit(
          "text-delta",
          { text: "\n\n", itemId: p.itemId, channel: "thought" },
          eventId,
          runId,
        );
      else if (method === "item/completed" || method === "item/started") {
        const item = p.item;
        if (item.type === "agentMessage" && method === "item/completed")
          ctx.emit("message", item, `item:${item.id}:completed`, runId);
        else if (!["agentMessage", "userMessage", "reasoning"].includes(item.type))
          ctx.emit(
            "tool",
            { ...item, lifecycle: method === "item/started" ? "started" : "completed" },
            `item:${item.id}:${method}`,
            runId,
          );
      } else if (method === "turn/completed") {
        ctx.emit(
          "turn-ended",
          { outcome: p.turn.status, error: p.turn.error, backgroundState: "unknown" },
          `turn:${p.turn.id}:end`,
          p.turn.id,
        );
        if (runId === p.turn.id) runId = null;
      } else if (method === "thread/tokenUsage/updated") {
        ctx.emit(
          "usage",
          { ...p.tokenUsage, scope: "session", sourceId: `${nativeId}:total` },
          eventId,
          runId,
        );
        // Per-turn increment, so usage history shows each turn's tokens.
        const last = p.tokenUsage?.last;
        if (last && runId)
          ctx.emit(
            "usage",
            {
              input: Math.max(0, (last.inputTokens ?? 0) - (last.cachedInputTokens ?? 0)),
              output: last.outputTokens ?? 0,
              cacheRead: last.cachedInputTokens ?? 0,
              cacheWrite: last.cacheWriteInputTokens ?? 0,
              contextWindow: p.tokenUsage.modelContextWindow,
              scope: "turn",
              // One record per model request: `last` is the latest request's usage.
              sourceId: `${nativeId}:${runId}:${p.tokenUsage.total?.totalTokens ?? eventId}`,
            },
            eventId ? `${eventId}:turn` : undefined,
            runId,
          );
      } else if (method === "error") ctx.emit(p.willRetry ? "state" : "error", p, eventId, runId);
      else if (method.includes("request") || method.includes("status"))
        ctx.emit("state", { method, ...p }, eventId, runId);
    };
    rpc.onRequest = (method, p, id) =>
      ctx.interact(String(id), { protocol: "codex", method, params: p });
    try {
      const init = await rpc.request("initialize", {
        clientInfo: { name: "kodo", title: "Kooyu", version: "0.1.0" },
      });
      rpc.notify("initialized");
      ctx.emit("state", { serverInfo: init });
      const targetModel = ctx.model ?? ctx.configuration?.model;
      const result = await rpc.request(nativeId ? "thread/resume" : "thread/start", {
        ...(nativeId ? { threadId: nativeId } : {}),
        cwd: ctx.cwd,
        ...(targetModel ? { model: targetModel } : {}),
        ...permissionPolicy(ctx.permissionMode?.()),
      });
      nativeId = result.thread.id;
      if (session.nativeSessionId)
        emptyHistory = Array.isArray(result.thread.turns) && result.thread.turns.length === 0;
      const readHistory = async (root?: Wire) => {
        const history = await readCodexTree(
          (method, params) => rpc.request(method, params),
          nativeId,
          root,
        );
        for (const child of history.subagents) {
          if (
            !children.register(child.agentId, child.parentAgentId, {
              name: child.thread?.agentNickname,
              ...(child.thread?.turns?.at(-1)?.status
                ? { status: child.thread.turns.at(-1).status }
                : {}),
            })
          )
            continue;
          if (child.error) {
            children.emit(child.agentId, "state", { historyError: child.error });
            continue;
          }
          for (const turn of child.thread.turns ?? [])
            for (const item of turn.items ?? []) {
              if (item.type === "agentMessage")
                children.emit(child.agentId, "message", item, `item:${item.id}:completed`);
              else if (item.type === "reasoning")
                children.emit(
                  child.agentId,
                  "message",
                  {
                    ...item,
                    role: "assistant",
                    channel: "thought",
                    text: [...(item.summary ?? []), ...(item.content ?? [])]
                      .map((part) => (typeof part === "string" ? part : (part.text ?? "")))
                      .join("\n"),
                  },
                  `item:${item.id}:completed`,
                );
              else if (!["userMessage", "reasoning"].includes(item.type))
                children.emit(
                  child.agentId,
                  "tool",
                  { ...item, lifecycle: "completed" },
                  `item:${item.id}:item/completed`,
                );
            }
        }
        return history;
      };
      if (session.nativeSessionId) {
        try {
          await readHistory(result);
        } catch (error) {
          ctx.emit("state", { historyError: (error as Error).message });
        }
      }
      const models = async () => {
        const models = [];
        let cursor: string | undefined;
        do {
          const page = await rpc.request("model/list", {
            limit: 100,
            ...(cursor ? { cursor } : {}),
          });
          models.push(...codexModelOptions(page.data ?? []));
          cursor = page.nextCursor ?? undefined;
        } while (cursor && models.length < 1000);
        return models;
      };
      return {
        nativeSessionId: nativeId,
        models,
        async send(text, commandId, mode, settings) {
          const model = settings?.model ?? targetModel ?? result.model;
          if (settings?.reasoning) {
            const catalog = ctx.configuration?.binding
              ? [boundModelOption(ctx.configuration)]
              : await models();
            validateReasoning(model, settings.reasoning, catalog);
          }
          ctx.assertSendAllowed?.(commandId);
          if (mode !== "steer") emptyHistory = false;
          const response = await rpc.request(
            mode === "steer" ? "turn/steer" : "turn/start",
            {
              threadId: nativeId,
              ...(mode === "steer" ? { expectedTurnId: runId } : {}),
              ...(mode !== "steer"
                ? {
                    model,
                    effort: settings?.reasoning ?? null,
                    ...permissionPolicy(ctx.permissionMode?.()),
                  }
                : {}),
              input: [{ type: "text", text }],
            },
            commandId,
          );
          runId = response.turn?.id ?? runId;
          return { nativeRunId: runId };
        },
        async cancel() {
          if (!runId) unsupported("没有活动的 Codex 回合，未发送取消。");
          await rpc.request("turn/interrupt", { threadId: nativeId, turnId: runId });
        },
        async read() {
          try {
            return await readHistory();
          } catch (error) {
            if (
              !emptyHistory ||
              !(error instanceof RpcRejected) ||
              error.rpcCode !== -32601 ||
              error.message !== "list_turns is not supported yet"
            )
              throw error;
            return rpc.request("thread/read", { threadId: nativeId, includeTurns: false });
          }
        },
        async list() {
          return listCodexThreads((method, params) => rpc.request(method, params));
        },
        async quota() {
          return rpc.request("account/rateLimits/read");
        },
        async close() {
          await rpc.close();
        },
      };
    } catch (e) {
      await rpc.close();
      throw e;
    }
  },
};
