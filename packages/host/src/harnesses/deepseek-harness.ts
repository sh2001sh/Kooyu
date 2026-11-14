import { randomUUID } from "node:crypto";
import { KodoError } from "@kodo/protocol";
import { descriptor, needCwd, type HarnessAdapter, type NativeRuntime } from "./adapter.js";
import { JsonRpc } from "./rpc.js";
import { NativeSubagents } from "./subagents.js";
import { boundModelOption } from "../providers/model-option.js";
import { validateReasoning } from "./model-options.js";
import { dshNativeModelOptions, readDshNativeConfig, writeDshNativePatch } from "./dsh-native.js";
import { inspectDshFiles } from "./session-presence.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { listDshHistory, readDshHistory } from "./dsh-history.js";
const info = descriptor(
  "deepseek-harness",
  "DeepSeek Harness",
  "app-server",
  ["directChat", "historyRead", "resume", "observeLive", "interaction", "cancel"],
  "Native SDK JSON-RPC; session/wait confirms root and descendant idle; cancel restarts the runtime and resumes the session",
  "implemented",
);
info.capabilities.steer = "unsupported";
info.modelSupport = "binding-or-model";
export const deepSeekAdapter: HarnessAdapter = {
  descriptor: info,
  standaloneRead: (session, ctx) => readDshHistory(ctx, session.nativeSessionId ?? ""),
  standaloneList: (_session, ctx) => listDshHistory(ctx),
  inspectSessions: (sessions, ctx) =>
    inspectDshFiles(
      sessions,
      ctx.launch.env?.DSH_HOME ?? ctx.env.DSH_HOME ?? join(homedir(), ".dsh"),
      ctx.launch.args.length === 2 &&
        ctx.launch.args[0] === "--profile" &&
        ctx.launch.args[1] === "sdk",
    ),
  async discoverModels(ctx) {
    return dshNativeModelOptions(readDshNativeConfig({ ...ctx.env, ...ctx.launch.env }));
  },
  async connect(session, ctx) {
    const cwd = needCwd(ctx);
    if (!ctx.configuration)
      throw new KodoError(
        "INVALID_INPUT",
        "DSH initialize 需要明确的 provider 和 model，请选择模型或 Harness 绑定。",
      );
    const native = !ctx.configuration.binding;
    const nativeConfig = native ? readDshNativeConfig({ ...ctx.env, ...ctx.launch.env }) : null;
    const options = () =>
      ctx.configuration!.binding
        ? [boundModelOption(ctx.configuration!)]
        : dshNativeModelOptions(nativeConfig!);
    const routeOf = (model: string) => (native ? `${ctx.configuration!.provider}/${model}` : model);
    if (ctx.reasoning)
      validateReasoning(routeOf(ctx.model ?? ctx.configuration.model), ctx.reasoning, options());
    // Overlay the user's own provider routes onto the SDK profile, without editing it.
    const patch = native ? writeDshNativePatch(ctx.dataDir, nativeConfig!) : null;
    const rpc = new JsonRpc(
        patch && !ctx.launch.args.includes("--patch")
          ? { ...ctx, launch: { ...ctx.launch, args: [...ctx.launch.args, "--patch", patch] } }
          : ctx,
      ),
      nativeId = session.nativeSessionId ?? randomUUID();
    const children = new NativeSubagents(ctx, () => nativeId);
    let replacing = false,
      interrupted = false,
      closed = false,
      ready = false,
      pending = false,
      idle = false,
      statusRevision = 0,
      replacement: NativeRuntime | undefined;
    const confirmSettled = () => {
      if (!ready || !idle || replacing || closed) return;
      const revision = statusRevision;
      void rpc
        .request("session/wait", { sessionId: nativeId }, randomUUID(), 0)
        .then(() => {
          if (closed || replacing || revision !== statusRevision || !idle) return;
          pending = false;
          ctx.emit("settled", { runState: "idle", backgroundState: "settled" });
        })
        .catch((error) => {
          if (!closed && !replacing && revision === statusRevision)
            ctx.emit("error", {
              message: error instanceof Error ? error.message : "DSH 后台任务结束尚未确认。",
            });
        });
    };
    rpc.onClose = (e) => {
      closed = true;
      if (!replacing) ctx.emit("disconnected", { message: e.message });
    };
    rpc.onRequest = (method, p, id) =>
      ctx.interact(String(id), { protocol: "dsh", method, params: p });
    rpc.onNotification = (method, p) => {
      if (replacing || closed) return;
      if (method === "subagent.started" || method === "subagent.finished") {
        if (
          children.register(p.childSessionId, p.parentSessionId, {
            status:
              method === "subagent.started"
                ? "running"
                : p.status === "ok"
                  ? "completed"
                  : "failed",
          }) &&
          p.lastAssistantMessage
        )
          children.emit(p.childSessionId, "message", {
            role: "assistant",
            content: p.lastAssistantMessage,
          });
        return;
      }
      const child = children.has(p.sessionId);
      if (p.sessionId !== nativeId && !child) return;
      const emit: typeof ctx.emit = child
        ? (type, payload, key) => {
            if (type !== "subagent") children.emit(p.sessionId, type, payload, key);
          }
        : ctx.emit;
      if (method === "session.status") {
        if (child) {
          children.emit(p.sessionId, "state", { runState: p.status });
          return;
        }
        idle = p.status === "idle";
        if (p.status === "running") pending = true;
        statusRevision++;
        ctx.emit("state", {
          runState: p.status === "running" ? "running" : "idle",
          backgroundState: "unknown",
        });
        confirmSettled();
      } else if (method === "session.event") {
        const e = p.event,
          key = e.seq === undefined ? undefined : `${p.sessionId}:${e.seq}`;
        if (e.type === "assistant/chunk") {
          const chunk = e.data?.chunk;
          if (chunk?.type === "reasoning-delta" || chunk?.type === "text-delta")
            emit(
              "text-delta",
              {
                text: chunk.text,
                itemId: `${e.data.turn}:${e.data.step}:${chunk.index ?? 0}`,
                ...(chunk.type === "reasoning-delta" ? { channel: "thought" } : {}),
              },
              key,
            );
        } else if (e.type === "assistant/message") emit("message", e.data.message, key);
        else if (e.type === "turn/end")
          emit(
            "turn-ended",
            {
              ...e.data,
              outcome:
                e.data.reason?.kind === "completed"
                  ? "completed"
                  : e.data.reason?.kind === "aborted"
                    ? "cancelled"
                    : "failed",
            },
            key,
          );
        else if (e.type.includes("tool")) emit("tool", e, key);
        else emit("state", e, key);
      } else emit("state", { method, ...p });
    };
    try {
      const init = await rpc.request("initialize", {
        cwd,
        provider: ctx.configuration.provider,
        model: ctx.model ?? ctx.configuration.model,
        ...(ctx.reasoning ? { reasoningEffort: ctx.reasoning } : {}),
        ...(ctx.configuration.modelParameters?.maxOutputTokens
          ? { maxTokens: ctx.configuration.modelParameters.maxOutputTokens }
          : {}),
        approvalRequests: true,
        capabilities: { userQuestions: true },
      });
      if (init.serverInfo?.name !== "deepseek-harness-sdk-runtime")
        throw new Error("DSH SDK runtime 身份不匹配。");
      ctx.emit("state", init);
      if (session.nativeSessionId) await rpc.request("session/resume", { sessionId: nativeId });
      else await rpc.request("session/working-directory/get", { sessionId: nativeId });
      ready = true;
      confirmSettled();
      return {
        nativeSessionId: nativeId,
        async models() {
          return options();
        },
        async send(text, commandId, mode, settings) {
          if (settings?.reasoning)
            validateReasoning(
              native
                ? (settings.model ?? routeOf(ctx.model ?? ctx.configuration!.model))
                : (settings.model ?? ctx.configuration!.model),
              settings.reasoning,
              options(),
            );
          if (mode === "steer")
            throw new KodoError("UNSUPPORTED", "DSH 本接入只提供原生输入队列，未验证 steer。");
          if (replacement) return replacement.send(text, commandId, mode, settings);
          const wanted =
            native && settings?.model?.includes("/")
              ? settings.model.slice(settings.model.indexOf("/") + 1)
              : settings?.model;
          const wantedProvider =
            native && settings?.model?.includes("/")
              ? settings.model.slice(0, settings.model.indexOf("/"))
              : ctx.configuration!.provider;
          if (
            settings &&
            ((wanted ?? ctx.configuration!.model) !== (ctx.model ?? ctx.configuration!.model) ||
              wantedProvider !== ctx.configuration!.provider ||
              settings.reasoning !== (ctx.reasoning ?? null))
          ) {
            // The SDK owns one route per process. At Host's idle turn boundary,
            // resume the same native session under a new initialized route.
            replacing = true;
            await rpc.request("shutdown", {}, `${commandId}:shutdown`, 2000).catch(() => {});
            await rpc.close();
            replacement = await deepSeekAdapter.connect(
              { ...session, nativeSessionId: nativeId },
              {
                ...ctx,
                configuration: { ...ctx.configuration!, provider: wantedProvider },
                model: wanted ?? ctx.configuration!.model,
                reasoning: settings.reasoning ?? undefined,
              },
            );
            if (replacement.nativeSessionId !== nativeId)
              throw new Error("DSH 模型切换改变了原生身份。");
            return replacement.send(text, commandId, mode, settings);
          }
          ctx.assertSendAllowed?.(commandId);
          pending = true;
          idle = false;
          statusRevision++;
          try {
            await rpc.request(
              "session/prompt",
              { sessionId: nativeId, contentBlocks: [{ type: "text", text }] },
              commandId,
              0, // Durable enqueue may wait; its receipt is not a completed model turn.
            );
            return { nativeRunId: null };
          } catch (error) {
            // An interrupt ends the process under the pending prompt; the turn was delivered.
            if (interrupted) return { nativeRunId: null };
            throw error;
          }
        },
        async cancel() {
          if (replacement) return replacement.cancel();
          if (!pending) throw new KodoError("UNSUPPORTED", "没有活动的 DSH 回合，未发送取消。");
          // The SDK protocol has no per-turn cancel. Stop the runtime process, then resume
          // the same native session in a fresh one (resume repairs the interrupted turn).
          interrupted = true;
          replacing = true;
          await rpc.request("shutdown", {}, randomUUID(), 1000).catch(() => {});
          await rpc.close();
          ctx.emit("turn-ended", { outcome: "interrupted", backgroundState: "unknown" });
          replacement = await deepSeekAdapter.connect(
            { ...session, nativeSessionId: nativeId },
            ctx,
          );
        },
        async close() {
          if (replacement) return replacement.close();
          closed = true;
          await rpc.request("shutdown", {}, randomUUID(), 2000).catch(() => {});
          await rpc.close();
        },
      };
    } catch (e) {
      await rpc.close();
      throw e;
    }
  },
};
