import { descriptor, needCwd, unsupported, type HarnessAdapter, type Wire } from "./adapter.js";
import { JsonRpc, RpcRejected } from "./rpc.js";
import { AcpClient } from "./acp-client.js";
import { collectAcpSessions } from "./acp-sessions.js";
import { KodoError, type HarnessId, type PermissionMode } from "@kodo/protocol";
import { acpModelOptions, selectOptions } from "./model-options.js";
import { boundNativeModel } from "../providers/native-config.js";
import { NativeSubagents } from "./subagents.js";
import { resolveInput } from "./input-modalities.js";
export function acpHarness(id: HarnessId, name: string): HarnessAdapter {
  const info = descriptor(
    id,
    name,
    "acp",
    ["directChat", "observeLive", "cancel", "interaction"],
    "ACP v1; resume/load/list/usage negotiated; no standalone history read API; external writers unsupported",
    "partial",
  );
  info.capabilities.historyRead = "unsupported";
  info.capabilities.steer = "unsupported";
  return {
    descriptor: info,
    async connect(session, ctx) {
      const cwd = needCwd(ctx),
        rpc = new JsonRpc(ctx);
      let nativeId = session.nativeSessionId ?? "";
      const children = new NativeSubagents(ctx, () => nativeId);
      let active = false,
        sending = false,
        closed = false,
        replaying = true,
        cancelRequested = false;
      let turnEpoch = 0;
      const client = new AcpClient(
        ctx,
        () => nativeId,
        () => active && !cancelRequested,
      );
      const childClients = new Map<string, AcpClient>();
      const invalidateClients = () => {
        client.invalidateTurn();
        for (const c of childClients.values()) c.invalidateTurn();
      };
      const closeClients = () =>
        Promise.all([client.close(), ...[...childClients.values()].map((c) => c.close())]);
      let config: Wire[] = [],
        models: Wire | undefined,
        modes: Wire | undefined;
      rpc.onNotification = (method, p) => {
        if (closed) return;
        if (
          id === "grok-build" &&
          [
            "_x.ai/session_notification",
            "x.ai/session_notification",
            "_x.ai/session/update",
            "x.ai/session/update",
          ].includes(method)
        ) {
          const envelope = p.params ?? p;
          if (envelope.sessionId !== nativeId && !children.has(envelope.sessionId)) return;
          const u = envelope.update;
          if (
            !u ||
            !["subagent_spawned", "subagent_progress", "subagent_finished"].includes(
              u.sessionUpdate,
            )
          )
            return;
          const childId = u.child_session_id;
          if (
            children.register(childId, u.parent_session_id ?? envelope.sessionId, {
              ...(u.description ? { name: u.description } : {}),
              status: u.sessionUpdate === "subagent_finished" ? u.status : "running",
            })
          ) {
            if (replaying) return;
            children.emit(childId, "state", u);
            if (u.output) children.emit(childId, "message", { role: "assistant", text: u.output });
            if (u.error) children.emit(childId, "error", { message: u.error });
          }
          return;
        }
        const child = children.has(p.sessionId);
        if (method !== "session/update" || (p.sessionId !== nativeId && !child)) return;
        const u = p.update as Wire;
        if (u.sessionUpdate === "subagent_spawned") {
          if (
            children.register(u.subagentSessionId, p.sessionId, {
              name: u.name,
              status: "running",
              toolCallId: u._meta?.cursor?.toolCallId,
            }) &&
            u.task &&
            !replaying
          )
            children.emit(u.subagentSessionId, "message", { role: "user", text: u.task });
          return;
        }
        if (u.sessionUpdate === "subagent_state_update") {
          if (children.has(u.subagentSessionId))
            children.register(u.subagentSessionId, p.sessionId, { status: u.state });
          return;
        }
        // Replay must restore child identities, but not duplicate text or root accounting.
        if (replaying) return;
        const emit: typeof ctx.emit = child
          ? (type, payload, key) => {
              if (type !== "subagent") children.emit(p.sessionId, type, payload, key);
            }
          : ctx.emit;
        if (child) {
          if (u.sessionUpdate === "plan") emit("todo", { items: u.entries });
          else if (["agent_message_chunk", "agent_thought_chunk"].includes(u.sessionUpdate))
            emit("text-delta", {
              text: u.content?.text ?? "",
              channel: u.sessionUpdate === "agent_thought_chunk" ? "thought" : "assistant",
            });
          else if (["tool_call", "tool_call_update"].includes(u.sessionUpdate)) emit("tool", u);
          else emit("state", u);
          return;
        }
        if (u.sessionUpdate === "config_option_update") config = u.configOptions ?? [];
        if (u.sessionUpdate === "current_mode_update" && modes)
          modes.currentModeId = u.currentModeId;
        if (u.sessionUpdate === "current_model_update" && models)
          models.currentModelId = u.currentModelId;
        if (u.sessionUpdate === "plan") ctx.emit("todo", { items: u.entries });
        else if (["agent_message_chunk", "agent_thought_chunk"].includes(u.sessionUpdate))
          ctx.emit("text-delta", {
            text: u.content?.text ?? "",
            channel: u.sessionUpdate === "agent_thought_chunk" ? "thought" : "assistant",
          });
        else if (["tool_call", "tool_call_update"].includes(u.sessionUpdate)) ctx.emit("tool", u);
        else if (u.sessionUpdate === "usage_update")
          ctx.emit("usage", {
            ...u,
            scope: "session",
            sourceId: nativeId,
            costUsd: u.cost?.currency === "USD" ? u.cost.amount : null,
          });
        else ctx.emit("state", u);
      };
      rpc.onRequest = async (method, p, rid) => {
        if (method !== "session/request_permission") {
          if (!children.has(p.sessionId)) return client.request(method, p, String(rid));
          let childClient = childClients.get(p.sessionId);
          if (!childClient) {
            const childId = p.sessionId;
            childClient = new AcpClient(
              ctx,
              () => childId,
              () => active && !cancelRequested && !closed,
            );
            childClients.set(childId, childClient);
          }
          return childClient.request(method, p, String(rid));
        }
        if ((p.sessionId !== nativeId && !children.has(p.sessionId)) || !active || cancelRequested)
          return { outcome: { outcome: "cancelled" } };
        const permissionEpoch = turnEpoch;
        const answer = (await ctx.interact(String(rid), {
          protocol: "acp",
          method,
          params: p,
          options: p.options,
        })) as Wire;
        if (
          permissionEpoch !== turnEpoch ||
          !active ||
          cancelRequested ||
          answer?.outcome?.outcome !== "selected" ||
          !p.options?.some((o: Wire) => o.optionId === answer.outcome.optionId)
        )
          return { outcome: { outcome: "cancelled" } };
        return { outcome: { outcome: "selected", optionId: answer.outcome.optionId } };
      };
      rpc.onClose = (e) => {
        closed = true;
        turnEpoch++;
        invalidateClients();
        active = false;
        void closeClients().catch((error) => ctx.emit("error", { message: error.message }));
        ctx.emit("disconnected", { message: e.message });
      };
      try {
        const init = await rpc.request("initialize", {
          protocolVersion: 1,
          clientInfo: { name: "kodo", version: "0.1.0" },
          clientCapabilities: {
            fs: { readTextFile: true, writeTextFile: true },
            terminal: true,
            ...(id === "cursor" ? { _meta: { subagents: true } } : {}),
          },
        });
        if (init.protocolVersion !== 1) unsupported(`不兼容的 ACP 版本 ${init.protocolVersion}。`);
        const caps = init.agentCapabilities ?? {};
        const resume = Boolean(session.nativeSessionId && caps.sessionCapabilities?.resume);
        if (session.nativeSessionId && !resume && !caps.loadSession)
          unsupported("此 ACP 安装未声明 session/resume 或 session/load；无法恢复，原会话保留。");
        const method = session.nativeSessionId
          ? resume
            ? "session/resume"
            : "session/load"
          : "session/new";
        const result = await rpc.request(method, {
          ...(session.nativeSessionId ? { sessionId: session.nativeSessionId } : {}),
          cwd,
          mcpServers: [],
        });
        nativeId = session.nativeSessionId ?? result.sessionId;
        if (!nativeId) throw new Error("ACP 未返回原生 session ID。");
        if (
          session.nativeSessionId &&
          result.sessionId &&
          result.sessionId !== session.nativeSessionId
        )
          throw new Error("ACP 恢复返回了不同的原生 session ID。");
        replaying = false;
        config = result.configOptions ?? [];
        models = result.models;
        modes = result.modes;
        ctx.emit("state", {
          nativeCapabilities: caps,
          agentInfo: init.agentInfo,
          configOptions: result.configOptions,
          models: result.models,
          modes: result.modes,
        });
        const initialModel =
          config.find((o) => o.category === "model")?.currentValue ?? models?.currentModelId;
        const initialReasoning = config.find((o) => o.category === "thought_level")?.currentValue;
        const setOption = async (category: string, value: string, requestId: string) => {
          const option = config.find((o) => o.category === category);
          if (!option || !selectOptions(option).some((o) => o.value === value))
            unsupported("此 ACP 会话未声明所选配置值；不会静默替换。");
          if (option.currentValue === value) return;
          const response = await rpc.request(
            "session/set_config_option",
            { sessionId: nativeId, configId: option.id, value },
            requestId,
          );
          config = response.configOptions ?? [];
          if (config.find((o) => o.id === option.id)?.currentValue !== value)
            throw new Error("ACP 配置响应未确认所选值，后续发送已中止。");
          ctx.emit("state", { configOptions: config });
        };
        const setModel = async (value: string, requestId: string) => {
          if (ctx.configuration?.binding && value === ctx.configuration.model)
            value = boundNativeModel(ctx.configuration);
          if (config.some((o) => o.category === "model"))
            return setOption("model", value, requestId);
          if (
            !models &&
            ctx.configuration?.binding &&
            value === boundNativeModel(ctx.configuration)
          )
            return;
          // Some ACP servers omit the current exact model from their picker.
          if (models?.currentModelId === value) return;
          if (!models?.availableModels?.some((m: Wire) => m.modelId === value))
            unsupported("此 ACP 会话未声明所选模型；不会静默替换模型。");
          await rpc.request(
            "session/set_model",
            { sessionId: nativeId, modelId: value },
            requestId,
          );
          models.currentModelId = value;
        };
        const permissionOptions = () => {
          const option = config.find((o) => o.category === "mode");
          const choices = option
            ? selectOptions(option).map((o) => ({
                value: `acp:${String(o.value)}` as PermissionMode,
                label: String(o.name ?? o.value),
                detail: typeof o.description === "string" ? o.description : undefined,
              }))
            : ((modes?.availableModes ?? []) as Wire[]).map((o: Wire) => ({
                value: `acp:${String(o.id)}` as PermissionMode,
                label: String(o.name ?? o.id),
                detail: typeof o.description === "string" ? o.description : undefined,
              }));
          const current = option?.currentValue ?? modes?.currentModeId;
          return {
            current: typeof current === "string" ? (`acp:${current}` as PermissionMode) : null,
            options: choices,
          };
        };
        const setPermissionMode = async (value: PermissionMode | null) => {
          if (!value?.startsWith("acp:")) unsupported("此 ACP 会话只能选择原生声明的运行模式。");
          const selected = value.slice(4);
          if (!permissionOptions().options.some((o) => o.value === value))
            unsupported("此 ACP 会话未声明所选运行模式。");
          if (permissionOptions().current === value) return;
          if (config.some((o) => o.category === "mode"))
            await setOption("mode", selected, `mode:${session.id}`);
          else {
            await rpc.request("session/set_mode", { sessionId: nativeId, modeId: selected });
            if (modes) modes.currentModeId = selected;
            ctx.emit("state", { modes });
          }
        };
        if (session.permissionMode?.startsWith("acp:"))
          await setPermissionMode(session.permissionMode);
        const targetModel = ctx.model ?? ctx.configuration?.model;
        if (targetModel) {
          await setModel(targetModel, `initial-model:${session.id}`);
        }
        if (ctx.reasoning)
          if (config.some((o) => o.category === "thought_level"))
            await setOption("thought_level", ctx.reasoning, `initial-reasoning:${session.id}`);
          else if (ctx.reasoning !== ctx.configuration?.binding?.reasoning)
            unsupported("此 ACP 未声明思考切换接口；只能使用绑定配置中的默认档位。");
        const supportsImages = (selected?: string | null) => {
          if (caps.promptCapabilities?.image !== true) return false;
          // The Google-to-Chat bridge currently accepts text and tools only.
          if (
            id === "gemini" &&
            (ctx.configuration?.binding?.route === "gateway" ||
              ctx.configuration?.protocol === "openai-completions")
          )
            return false;
          if (ctx.configuration?.binding)
            return ctx.configuration.modelParameters?.input?.includes("image") ?? false;
          const model = selected ?? targetModel ?? initialModel;
          const input = typeof model === "string" ? resolveInput(ctx, id, model) : undefined;
          return input ? input.includes("image") : true;
        };
        return {
          nativeSessionId: nativeId,
          capabilities: {
            resume:
              caps.loadSession || caps.sessionCapabilities?.resume ? "supported" : "unsupported",
            steer: "unsupported",
          },
          async models() {
            return acpModelOptions(config, models).map((model) => ({
              ...model,
              input: supportsImages(model.id) ? ["text", "image"] : ["text"],
            }));
          },
          async permissionOptions() {
            return permissionOptions();
          },
          setPermissionMode,
          // ACP: image content blocks are allowed only when the agent declares
          // promptCapabilities.image during initialize.
          supportsImages,
          async send(text, commandId, mode, settings, input) {
            if (mode === "steer") unsupported("ACP 通用层未承诺运行中 steer。");
            if (input?.images?.length && !supportsImages(settings?.model))
              unsupported("此 ACP 代理未声明图片输入，图片未发送。");
            if (closed) throw new KodoError("CONFLICT", "ACP 连接已关闭，无法发送。");
            if (sending) unsupported("ACP 当前已有活动或准备中的回合，请等待结束后发送。");
            sending = true;
            cancelRequested = false;
            const epoch = ++turnEpoch;
            let promptDispatched = false;
            invalidateClients();
            const assertCurrent = () => {
              if (closed) throw new Error("ACP 连接已关闭，发送准备已中止。");
              if (cancelRequested || epoch !== turnEpoch) throw new Error("ACP 发送准备已取消。");
              ctx.assertSendAllowed?.(commandId);
            };
            try {
              assertCurrent();
              const selected = settings?.model ?? targetModel ?? initialModel;
              if (selected) await setModel(selected, `${commandId}:model`);
              assertCurrent();
              const reasoning = settings ? (settings.reasoning ?? initialReasoning) : ctx.reasoning;
              if (reasoning) {
                if (config.some((o) => o.category === "thought_level"))
                  await setOption("thought_level", reasoning, `${commandId}:reasoning`);
                else if (reasoning !== ctx.configuration?.binding?.reasoning)
                  unsupported("此 ACP 未声明思考切换接口，请创建使用新默认档位的绑定。");
              }
              assertCurrent();
              const requestedMode = ctx.permissionMode?.();
              if (requestedMode?.startsWith("acp:")) await setPermissionMode(requestedMode);
              assertCurrent();
              active = true;
              promptDispatched = true;
              const response = await rpc.request(
                "session/prompt",
                {
                  sessionId: nativeId,
                  prompt: [
                    ...(text || !input?.images?.length ? [{ type: "text", text }] : []),
                    ...(input?.images ?? []).map((image) => ({
                      type: "image",
                      data: image.data,
                      mimeType: image.mimeType,
                    })),
                  ],
                },
                commandId,
                24 * 3600000,
              );
              ctx.emit(
                "turn-ended",
                {
                  outcome:
                    response.stopReason === "cancelled"
                      ? "cancelled"
                      : response.stopReason === "end_turn"
                        ? "completed"
                        : "failed",
                  stopReason: response.stopReason,
                  backgroundState: "unknown",
                },
                `prompt:${commandId}:end`,
              );
              return { nativeRunId: null };
            } catch (error) {
              if (promptDispatched && error instanceof RpcRejected)
                ctx.emit(
                  "turn-ended",
                  {
                    outcome: "failed",
                    commandId,
                    error: { message: error.message },
                    backgroundState: "unknown",
                  },
                  `prompt:${commandId}:end`,
                );
              // No prompt was dispatched while configuring; this is safe to reject,
              // even if the configuration RPC itself lost its connection.
              if (!promptDispatched)
                throw new KodoError(
                  "CONFLICT",
                  error instanceof Error ? error.message : "ACP 发送准备失败。",
                );
              throw error;
            } finally {
              active = false;
              sending = false;
              turnEpoch++;
              invalidateClients();
            }
          },
          async cancel() {
            if (closed || !sending) unsupported("没有活动的 ACP 回合，未发送取消。");
            if (cancelRequested) return;
            cancelRequested = true;
            turnEpoch++;
            invalidateClients();
            if (active) rpc.notify("session/cancel", { sessionId: nativeId });
            await Promise.all([
              client.cancel(),
              ...[...childClients.values()].map((c) => c.cancel()),
            ]);
          },
          async list() {
            if (!caps.sessionCapabilities?.list) unsupported("该 ACP 未声明 session/list。");
            const sessions = await collectAcpSessions(rpc, cwd);
            if (sessions === null) unsupported("该 ACP 未实现 session/list。");
            return { sessions };
          },
          async close() {
            closed = true;
            turnEpoch++;
            invalidateClients();
            active = false;
            try {
              await closeClients();
            } finally {
              await rpc.close();
            }
          },
        };
      } catch (e) {
        await Promise.allSettled([closeClients(), rpc.close()]);
        throw e;
      }
    },
  };
}
