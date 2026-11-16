import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { resolveInput } from "./input-modalities.js";
import { descriptor, needCwd, unsupported, type HarnessAdapter, type Wire } from "./adapter.js";
import { JsonRpc, RpcRejected } from "./rpc.js";
import { ZCodeFrames } from "./zcode-frames.js";
import { readZCodeHistory } from "./zcode-history.js";
import {
  providerModel,
  validateReasoning,
  zcodeBuiltinModelOptions,
  zcodeModelOptions,
  zcodeUserModelOptions,
} from "./model-options.js";
import { mergeModelOptions } from "./models.js";
import { boundModelOption } from "../providers/model-option.js";
import { boundNativeModel } from "../providers/native-config.js";
import { presenceMap } from "./session-presence.js";
import { NativeSubagents } from "./subagents.js";
import { listZCodeSessions } from "./zcode-sessions.js";

function userProviderConfig(env: NodeJS.ProcessEnv): Wire | undefined {
  const home = env.ZCODE_HOME ?? join(homedir(), ".zcode");
  try {
    return JSON.parse(readFileSync(join(home, "v2", "provider_config.json"), "utf8")) as Wire;
  } catch {
    return undefined;
  }
}

function builtinConfig(path?: string): Wire | undefined {
  if (!path) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Wire;
  } catch {
    return undefined;
  }
}

export const zcodeAdapter: HarnessAdapter = {
  standaloneList: (_session, ctx) => listZCodeSessions(ctx),
  descriptor: descriptor(
    "zcode",
    "ZCode",
    "app-server",
    [
      "directChat",
      "resume",
      "historyRead",
      "observeLive",
      "steer",
      "cancel",
      "interaction",
      "usage",
    ],
    "a9fe401e v4 commands + wire v3 conversation subscription; installed CLI requires verification",
    "partial",
    "native-models",
  ),
  async discoverModels(ctx) {
    const builtin = builtinConfig(ctx.launch.env?.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE);
    return mergeModelOptions(
      zcodeUserModelOptions(userProviderConfig({ ...ctx.env, ...ctx.launch.env }), builtin),
      zcodeBuiltinModelOptions(builtin),
    );
  },
  async standaloneRead(session, ctx) {
    needCwd(ctx);
    if (!session.nativeSessionId) unsupported("历史读取需要原生会话 ID。");
    const rpc = new JsonRpc(ctx, false);
    try {
      return await readZCodeHistory((params) =>
        rpc.request("v4/conversation/rowsRange", {
          sessionId: session.nativeSessionId,
          ...params,
        }),
      );
    } finally {
      await rpc.close();
    }
  },
  async inspectSessions(sessions, ctx) {
    const states = presenceMap(sessions, "unknown");
    if (!ctx.cwd) return states;
    const rpc = new JsonRpc(ctx, false);
    try {
      const result = await rpc.request("v4/sessionsIndex/reconcile", {
        workspaceId: ctx.cwd,
        sessionIds: sessions.map((session) => session.nativeSessionId),
      });
      if (!Array.isArray(result.sessions)) return states;
      for (const session of sessions) {
        const rows = result.sessions.filter(
          (item: Wire) => item?.sessionId === session.nativeSessionId,
        );
        const row = rows[0];
        if (
          rows.length !== 1 ||
          typeof row.exists !== "boolean" ||
          typeof row.deleted !== "boolean"
        )
          continue;
        states[session.nativeSessionId!] = row.deleted || !row.exists ? "missing" : "present";
      }
    } catch {
      /* Older binaries and unavailable storage do not prove deletion. */
    } finally {
      await rpc.close();
    }
    return states;
  },
  async connect(session, ctx) {
    const cwd = needCwd(ctx);
    const builtin = builtinConfig(ctx.launch.env?.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE);
    if (ctx.configuration && !ctx.configuration.binding)
      unsupported("ZCode configuration 转换尚未验证，请使用原生实例配置；不会改写全局配置。");
    const modelOptions = () =>
      ctx.configuration?.binding
        ? [boundModelOption(ctx.configuration)]
        : mergeModelOptions(
            zcodeModelOptions(snapshot.config, builtin),
            zcodeUserModelOptions(userProviderConfig({ ...ctx.env, ...ctx.launch.env }), builtin),
            zcodeBuiltinModelOptions(builtin),
          ).map((option) => {
            const route = providerModel(option.id);
            const personal = zcodeUserModelOptions(
              userProviderConfig({ ...ctx.env, ...ctx.launch.env }),
              builtin,
            ).find((candidate) => candidate.id === option.id);
            return {
              ...option,
              input: resolveInput(
                ctx,
                route.provider,
                route.model,
                personal?.input ?? option.input,
              ),
            };
          });
    const rpc = new JsonRpc(ctx, false),
      nativeId = session.nativeSessionId ?? `sess_${randomUUID()}`,
      connectionId = randomUUID(),
      clientId = `kodo:${session.hostId}`,
      topic = `conversation/${nativeId}`;
    let snapshot: Wire = {},
      subscriptionId = "",
      lastSeq = -1,
      logEpoch = "",
      frames: ZCodeFrames | undefined,
      closed = false,
      failed = false,
      currentRun: string | null = null,
      settled = false,
      frameOp = 0;
    const children = new NativeSubagents(ctx, () => nativeId);
    const childReads = new Set<string>();
    const dirtyChildren = new Set<string>();
    const readChild = (id: string) => {
      dirtyChildren.add(id);
      if (childReads.has(id)) return;
      childReads.add(id);
      void (async () => {
        while (dirtyChildren.delete(id) && !closed && !failed) {
          try {
            const history = await readZCodeHistory((params) =>
              rpc.request("v4/conversation/rowsRange", { sessionId: id, ...params }),
            );
            if (closed || failed) return;
            for (const r of history.rows) {
              const key = `zcode-child:${id}:${history.atLogEpoch}:${history.atRevision}:${r.rowId}`;
              if (r.kind === "assistantText" || r.kind === "userInput")
                children.emit(
                  id,
                  "message",
                  {
                    ...r,
                    id: `row:${r.rowId}`,
                    role: r.kind === "userInput" ? "user" : "assistant",
                  },
                  key,
                );
              else if (r.kind === "toolCall")
                children.emit(id, "tool", { ...r, id: `row:${r.rowId}` }, key);
            }
          } catch (error) {
            if (!closed && !failed)
              children.emit(id, "error", {
                message: `子代理历史读取失败：${error instanceof Error ? error.message : String(error)}`,
              });
          }
        }
      })().finally(() => childReads.delete(id));
    };
    const rows = new Map<number, Wire>(),
      interactions = new Set<string>(),
      early: Wire[] = [];
    let readyResolve!: () => void, readyReject!: (e: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    void ready.catch(() => {});
    const command = async (type: string, payload: unknown, id: string = randomUUID()) => {
      const ack = await rpc.request(
        "v4/command",
        {
          commandId: id,
          clientId,
          sessionId: type === "createSession" ? null : nativeId,
          type,
          payload,
          issuedAt: Date.now(),
        },
        id,
      );
      if (!["accepted", "duplicate", "noop"].includes(ack.status))
        throw new RpcRejected(
          `ZCode 拒绝命令: ${ack.reasonCode ?? ack.status}${ack.message ? `: ${ack.message}` : ""}`,
        );
      return ack;
    };
    const fail = (error: unknown) => {
      if (failed || closed) return;
      failed = true;
      const e = error instanceof Error ? error : new Error(String(error));
      frames?.clear();
      readyReject(e);
      ctx.emit("disconnected", { message: e.message });
      void rpc.close();
    };
    const row = (r: Wire, historical = false) => {
      rows.set(r.rowId, r);
      if (r.kind === "subagent") {
        const id = r.childSessionId ?? `subagent-row:${logEpoch}:${r.rowId}`;
        if (
          children.register(id, nativeId, {
            name: r.subagentType,
            status: r.status === "success" ? "completed" : r.status,
            toolCallId: r.parentToolCallId,
          })
        ) {
          if (r.summaryText)
            children.emit(
              id,
              "message",
              { id: `summary:${r.rowId}`, role: "assistant", text: r.summaryText },
              `zcode:${logEpoch}:${lastSeq}:${frameOp}:subagent:${r.rowId}`,
            );
          if (typeof r.childSessionId === "string") readChild(r.childSessionId);
        }
      } else if (r.kind === "toolCall")
        ctx.emit(
          "tool",
          { ...r, id: `zcode:${logEpoch}:${r.rowId}`, historical },
          `zcode:${logEpoch}:${lastSeq}:${frameOp}:row:${r.rowId}`,
          r.turnId,
        );
      else if (["assistantText", "userInput"].includes(r.kind)) {
        if (r.kind === "userInput" && !historical) return;
        ctx.emit(
          "message",
          {
            ...r,
            id: `zcode:${logEpoch}:${r.rowId}`,
            role: r.kind === "userInput" ? "user" : "assistant",
            historical,
          },
          r.kind === "userInput" && r.sourceCommandId
            ? `command:${r.sourceCommandId}`
            : `zcode:${logEpoch}:${lastSeq}:${frameOp}:row:${r.rowId}`,
          r.turnId,
        );
      } else if (r.kind === "turnHeader" && r.state === "running") {
        currentRun = r.turnId;
        settled = false;
      }
    };
    const state = (p: Wire, initial = false) => {
      const previous = snapshot.control?.phase;
      snapshot = { ...snapshot, ...p };
      const c = snapshot.control ?? {},
        terminal = ["completedSuccess", "completedInterrupted", "error"].includes(c.phase);
      if (!initial && terminal && previous !== c.phase)
        ctx.emit(
          "turn-ended",
          {
            outcome:
              c.phase === "error"
                ? "failed"
                : c.phase === "completedInterrupted"
                  ? "cancelled"
                  : "completed",
            error: c.lastError,
            backgroundState: "unknown",
          },
          `zcode:${logEpoch}:${lastSeq}:end`,
          currentRun,
        );
      else if (["running", "prewarming"].includes(c.phase)) {
        settled = false;
        ctx.emit("state", { runState: "running" }, undefined, currentRun);
      } else if (initial && terminal) ctx.emit("state", { runState: "idle" });
      const quiet =
        terminal &&
        c.stopState === "idle" &&
        c.activeWorks?.length === 0 &&
        Array.isArray(snapshot.backgroundWorks) &&
        !snapshot.backgroundWorks.some((w: Wire) =>
          ["running", "resultPending"].includes(w.status),
        ) &&
        snapshot.pendingCommands?.length === 0 &&
        snapshot.queue?.items?.length === 0;
      if (initial) settled = quiet;
      else if (!settled && quiet) {
        settled = true;
        ctx.emit(
          "settled",
          {
            outcome:
              c.phase === "error"
                ? "failed"
                : c.phase === "completedInterrupted"
                  ? "cancelled"
                  : "completed",
          },
          `zcode:${logEpoch}:${lastSeq}:settled`,
          currentRun,
        );
      }
      if (p.usage && !initial)
        ctx.emit(
          "usage",
          {
            ...p.usage.cumulative,
            cacheRead: p.usage.cumulative.cacheReadTokens,
            cacheWrite: p.usage.cumulative.cacheWriteTokens,
            scope: "session",
            sourceId: `${nativeId}:total`,
          },
          `zcode:${logEpoch}:${lastSeq}:usage`,
        );
      ctx.emit(
        "state",
        { nativeState: p, nativeGoal: snapshot.goal ?? null },
        `zcode:${logEpoch}:${lastSeq}:${frameOp}:state`,
      );
      for (const item of p.pendingInteractions ?? []) {
        if (interactions.has(item.interactionId)) continue;
        interactions.add(item.interactionId);
        void ctx
          .interact(item.interactionId, {
            protocol: "zcode",
            ...item,
            options: item.payload?.options,
          })
          .then(async (answer: unknown) => {
            if (
              closed ||
              failed ||
              !snapshot.pendingInteractions?.some(
                (i: Wire) => i.interactionId === item.interactionId,
              )
            )
              return;
            const value = answer as Wire;
            await command("resolveInteraction", {
              interactionId: item.interactionId,
              answer: value?.cancelled ? { action: "cancel" } : value,
            });
          })
          .catch((error) =>
            ctx.emit("error", { message: error instanceof Error ? error.message : String(error) }),
          );
      }
    };
    const accept = (wire: Wire) => {
      if (closed || failed || wire.topic !== topic) return;
      if (!frames) {
        if (early.length >= 128) return fail(new Error("ZCode subscription ACK buffer filled."));
        early.push(wire);
        return;
      }
      try {
        const p = frames.accept(wire);
        if (!p) return;
        const initial = lastSeq < 0;
        if (!initial && p.toSeq <= lastSeq) return;
        if (p.payload.kind !== "snapshot" && (initial || p.fromSeq !== lastSeq))
          throw new Error("ZCode 订阅序列有缺口；请恢复原生连接，未重发输入。");
        lastSeq = p.toSeq;
        frameOp = 0;
        if (p.payload.kind === "snapshot") {
          const next = p.payload.snapshot;
          if (next.sessionId !== nativeId || next.logEpoch !== logEpoch)
            throw new Error("ZCode 快照原生身份或纪元与订阅不符。");
          rows.clear();
          for (const r of next.rows.window) row(r, initial);
          state(next, initial);
        } else
          for (const d of p.payload.deltas) {
            frameOp++;
            if (d.row) row(d.row);
            else if (d.op === "row.delta") {
              const r = rows.get(d.rowId);
              if (!r) throw new Error("ZCode 文本增量缺少对应行。");
              if (d.path === "output.text")
                r.output = { ...r.output, text: (r.output?.text ?? "") + d.append };
              else r[d.path] = (r[d.path] ?? "") + d.append;
              if (r.kind === "assistantText" || r.kind === "reasoning")
                ctx.emit(
                  "text-delta",
                  {
                    text: d.append,
                    rowId: d.rowId,
                    ...(r.kind === "reasoning" ? { channel: "thought", itemId: d.rowId } : {}),
                  },
                  `zcode:${logEpoch}:${lastSeq}:${frameOp}:delta:${d.rowId}`,
                  r.turnId,
                );
              else if (r.kind === "toolCall") row(r);
            } else if (d.op === "row.removed") {
              for (const id of rows.keys()) if (id >= d.fromRowId) rows.delete(id);
              ctx.emit("state", { removedNativeRowsFrom: d.fromRowId });
            } else if (d.op === "state.updated") state(d.patch);
          }
        readyResolve();
      } catch (error) {
        fail(error);
      }
    };
    rpc.onClose = fail;
    rpc.onNotification = (method, p) => {
      if (method === "v4/conversation/frame") accept(p);
    };
    const timer = setInterval(() => {
      try {
        frames?.expire();
      } catch (error) {
        fail(error);
      }
    }, 1000);
    timer.unref();
    try {
      if (session.nativeSessionId && ctx.recreateEmptyNativeDraft) {
        let persisted: Wire | undefined;
        try {
          persisted = await rpc.request("v4/sessionsIndex/reconcile", {
            workspaceId: cwd,
            sessionIds: [nativeId],
          });
        } catch (error) {
          if (!(error instanceof RpcRejected && error.rpcCode === -32601)) throw error;
        }
        if (persisted) {
          const record = persisted.sessions?.find((item: Wire) => item.sessionId === nativeId);
          if (!record || typeof record.exists !== "boolean" || typeof record.deleted !== "boolean")
            throw new Error("ZCode 未返回有效会话持久状态，未重建原生会话。");
          if (record.deleted) throw new Error("ZCode 原生会话已删除，未重建原生会话。");
          if (!record.exists)
            await command("createSession", { sessionId: nativeId, workspaceId: cwd });
        }
      } else if (!session.nativeSessionId)
        await command("createSession", { sessionId: nativeId, workspaceId: cwd });
      const result = await rpc.request("v4/conversation/subscribe", {
        topic,
        connectionId,
        clientMode: "desktop-continuous",
        workspace: { workspacePath: cwd, workspaceKey: cwd },
      });
      subscriptionId = result.ack?.subscriptionId;
      logEpoch = result.ack?.logEpoch;
      if (!subscriptionId || !logEpoch || result.ack.mode !== "snapshot")
        throw new Error("ZCode 未返回有效 snapshot 订阅 ACK。");
      frames = new ZCodeFrames(topic, subscriptionId);
      for (const wire of early.splice(0)) accept(wire);
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          ready,
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error("ZCode 初始快照超时。")), 15000);
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
      const supportsImages = (selected?: string | null) => {
        if (ctx.configuration?.binding)
          return ctx.configuration.modelParameters?.input?.includes("image") ?? false;
        const model =
          selected ??
          ctx.model ??
          (snapshot.config?.provider && snapshot.config?.model
            ? `${snapshot.config.provider}/${snapshot.config.model}`
            : undefined);
        return (
          modelOptions()
            .find((option) => option.id === model)
            ?.input?.includes("image") ?? false
        );
      };
      return {
        nativeSessionId: nativeId,
        supportsImages,
        async models() {
          return modelOptions();
        },
        async send(text, id, mode, settings, input) {
          if (failed) throw new Error("ZCode 原生订阅已失联，请恢复并对账。");
          if (input?.images?.length && !supportsImages(settings?.model))
            unsupported("ZCode 当前模型未声明图片输入，图片未发送。");
          const selected = settings?.model ?? ctx.model ?? ctx.configuration?.model;
          const target = selected
            ? providerModel(
                ctx.configuration?.binding && selected === ctx.configuration.model
                  ? boundNativeModel(ctx.configuration)
                  : selected,
              )
            : undefined;
          const effort = settings ? settings.reasoning : ctx.reasoning;
          validateReasoning(
            selected ?? modelOptions()[0]?.id ?? null,
            effort ?? null,
            modelOptions(),
          );
          ctx.assertSendAllowed?.(id);
          const attachments: Wire[] = [];
          for (const image of input?.images ?? []) {
            const bytes = Buffer.from(image.data, "base64");
            if (bytes.length > 20 * 1024 * 1024) unsupported("ZCode 图片超过 20 MiB 上限。");
            const uploadId = randomUUID();
            const params = { connectionId, sessionId: nativeId, uploadId };
            const chunkSize = 512 * 1024;
            try {
              const begin = await rpc.request("v4/attachment/begin", {
                ...params,
                fileName: basename(image.path),
                mime: image.mimeType,
                totalBytes: bytes.length,
                totalChunks: Math.ceil(bytes.length / chunkSize),
                checksum: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
              });
              let ref = begin.ref;
              if (begin.state !== "committed") {
                for (let offset = 0; offset < bytes.length; offset += chunkSize) {
                  ctx.assertSendAllowed?.(id);
                  await rpc.request("v4/attachment/chunk", {
                    ...params,
                    chunkIndex: offset / chunkSize,
                    dataBase64: bytes.subarray(offset, offset + chunkSize).toString("base64"),
                  });
                }
                ref = (await rpc.request("v4/attachment/commit", params)).ref;
              }
              if (typeof ref !== "string" || !ref) throw new Error("ZCode 未确认图片附件引用。");
              attachments.push({
                ref,
                fileName: basename(image.path),
                mime: image.mimeType,
                bytes: bytes.length,
              });
            } catch (error) {
              await rpc.request("v4/attachment/abort", params).catch(() => {});
              throw error;
            }
          }
          ctx.assertSendAllowed?.(id);
          const permissionMode = ctx.permissionMode?.();
          await command(
            "sendText",
            {
              text,
              ...(attachments.length ? { attachments } : {}),
              ...(permissionMode ? { mode: permissionMode } : {}),
              ...(target && mode !== "steer"
                ? {
                    modelSelection: {
                      providerId: target.provider,
                      modelId: target.model,
                      ...(effort ? { options: { reasoningLevel: effort } } : {}),
                    },
                  }
                : {}),
              requestedDelivery:
                mode === "steer" ? "guide" : mode === "queue" ? "queue" : "startNow",
            },
            id,
          );
          return { nativeRunId: null };
        },
        async cancel() {
          const foreground = snapshot.control?.activeWorks?.find(
            (w: Wire) => w.foregroundExecutionId,
          )?.foregroundExecutionId;
          await command("stop", foreground ? { expectedForegroundExecutionId: foreground } : {});
        },
        async read() {
          return readZCodeHistory((params) =>
            rpc.request("v4/conversation/rowsRange", { sessionId: nativeId, ...params }),
          );
        },
        async close() {
          closed = true;
          clearInterval(timer);
          frames?.clear();
          await rpc.close();
        },
      };
    } catch (e) {
      closed = true;
      clearInterval(timer);
      await rpc.close();
      throw e;
    }
  },
};
