import { boundModelOption } from "../providers/model-option.js";
import { createServer } from "node:net";
import {
  descriptor,
  needCwd,
  unsupported,
  type HarnessAdapter,
  type AdapterContext,
  type NativeRuntime,
  type Wire,
} from "./adapter.js";
import { launch } from "./rpc.js";
import { openCodeModelOptions, providerModel, validateReasoning } from "./model-options.js";
import { randomUUID } from "node:crypto";
import { OpenCodeEvents } from "./opencode-events.js";
import { NativeSubagents } from "./subagents.js";
import { readOpenCodeTree } from "./opencode-history.js";
import { NativeInteractions } from "./native-interactions.js";
import type { PermissionMode, Session } from "@kodo/protocol";
import { presenceMap, type SessionPresenceMap } from "./session-presence.js";
class OpenCodeHttpError extends Error {
  constructor(
    path: string,
    readonly status: number,
  ) {
    super("OpenCode " + path + ": HTTP " + status);
  }
}
export const opencodeAdapter: HarnessAdapter = {
  descriptor: descriptor(
    "opencode",
    "OpenCode",
    "http",
    ["directChat", "historyRead", "resume", "observeLive", "cancel", "interaction", "usage"],
    "V1 headless HTTP /session and SSE /event; background settled not inferred",
    "partial",
    "native-models",
  ),
  connect: connectOpenCode,
  standaloneRead: (session, ctx) => connectOpenCode(session, ctx, "read"),
  standaloneList: (session, ctx) => connectOpenCode(session, ctx, "list"),
  inspectSessions: (sessions, ctx) =>
    connectOpenCode(sessions[0]!, ctx, "presence", sessions) as Promise<SessionPresenceMap>,
};

function connectOpenCode(session: Session, ctx: AdapterContext): Promise<NativeRuntime>;
function connectOpenCode(
  session: Session,
  ctx: AdapterContext,
  inspection: "read" | "list" | "presence",
  sessions?: Session[],
): Promise<unknown>;
async function connectOpenCode(
  session: Session,
  ctx: AdapterContext,
  inspection?: "read" | "list" | "presence",
  sessions?: Session[],
) {
  const cwd = needCwd(ctx);
  if (ctx.configuration && !ctx.configuration.binding)
    unsupported("OpenCode configuration 隔离转换尚未验证，请使用原生配置。");
  const port = await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
  const password = ctx.launch.source === "desktop-bundled" ? randomUUID() : null;
  const authHeaders: Record<string, string> = password
    ? { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` }
    : {};
  const child = launch({
    ...ctx,
    env: { ...ctx.env, ...(password ? { OPENCODE_SERVER_PASSWORD: password } : {}) },
    launch: {
      ...ctx.launch,
      command: ctx.launch.command,
      args: [...ctx.launch.args, "--hostname", "127.0.0.1", "--port", String(port)],
    },
  });
  child.stdout.resume();
  child.stderr.resume();
  let startupError: Error | undefined;
  let stopping: Promise<void> | undefined;
  child.once("error", (error) => {
    startupError = error;
  });
  const base = `http://127.0.0.1:${port}`,
    abort = new AbortController();
  let nativeId = session.nativeSessionId ?? "";
  const children = new NativeSubagents(ctx, () => nativeId);
  const childEvents = new Map<string, OpenCodeEvents>();
  const interactions = new NativeInteractions(ctx);
  let appliedPermissionMode: PermissionMode | null = null;
  const events = new OpenCodeEvents((type, payload, eventId, runId) => {
    const value = payload as Wire;
    ctx.emit(
      type,
      type === "usage" && ctx.configuration?.binding ? { ...value, costUsd: null } : payload,
      eventId,
      runId,
    );
  });
  const request = async (path: string, method = "GET", body?: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-opencode-directory": cwd,
        ...authHeaders,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30000)]),
    });
    if (!response.ok) throw new OpenCodeHttpError(path, response.status);
    return response.status === 204 ? {} : ((await response.json()) as Wire);
  };
  const ask = (type: "permission.asked" | "question.asked", params: Wire) => {
    if (
      (params.sessionID !== nativeId && !children.has(params.sessionID)) ||
      typeof params.id !== "string" ||
      !params.id
    )
      return;
    interactions.ask(params.id, { protocol: "opencode", type, params }, async (answer) => {
      const path =
        "/" +
        (type === "permission.asked" ? "permission" : "question") +
        "/" +
        encodeURIComponent(params.id);
      if (type === "question.asked" && (answer as Wire)?.cancelled === true)
        return request(path + "/reject", "POST");
      return request(path + "/reply", "POST", answer);
    });
  };
  const setPermissionMode = async (mode: PermissionMode | null) => {
    if (mode !== null && !["opencode-ask", "opencode-deny", "opencode-allow"].includes(mode))
      unsupported("OpenCode 只支持当前会话的原生工具审批规则。");
    if (mode === appliedPermissionMode) return;
    const permission = mode
      ? [
          {
            permission: "*",
            pattern: "*",
            action: mode === "opencode-ask" ? "ask" : mode === "opencode-deny" ? "deny" : "allow",
          },
        ]
      : [];
    await request(`/session/${encodeURIComponent(nativeId)}`, "PATCH", { permission });
    const confirmed = await request(`/session/${encodeURIComponent(nativeId)}`);
    if (JSON.stringify(confirmed.permission ?? []) !== JSON.stringify(permission))
      throw new Error("OpenCode 未确认工具审批规则，后续发送已中止。");
    appliedPermissionMode = mode;
  };
  try {
    let ready = false;
    for (let n = 0; n < 60; n++) {
      if (startupError) throw startupError;
      try {
        await request("/global/health");
        ready = true;
        break;
      } catch {
        if (child.exitCode !== null || child.signalCode !== null) break;
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    if (!ready) throw startupError ?? new Error("OpenCode V1 server 未就绪。");
    if (inspection) {
      if (inspection === "presence") {
        const states = presenceMap(sessions ?? [], "unknown");
        for (const item of sessions ?? []) {
          const id = item.nativeSessionId!;
          try {
            const found = await request("/session/" + encodeURIComponent(id));
            if (found.id === id) states[id] = "present";
          } catch (error) {
            if (error instanceof OpenCodeHttpError && error.status === 404) states[id] = "missing";
          }
        }
        await stop();
        return states;
      }
      if (inspection === "read" && !nativeId) unsupported("历史读取需要原生会话 ID。");
      try {
        return inspection === "list"
          ? await request("/session")
          : await readOpenCodeTree(request, nativeId);
      } finally {
        await stop();
      }
    }
    if (nativeId) await request(`/session/${encodeURIComponent(nativeId)}`);
    else nativeId = (await request("/session", "POST", { title: session.title })).id;
    if (session.permissionMode) await setPermissionMode(session.permissionMode);
    let recovering = Boolean(session.nativeSessionId);
    let historicalReplay = false;
    let bufferedBytes = 0;
    const buffered: Wire[] = [];
    const registerChild = (info: Wire) => {
      if (
        children.register(info.id, info.parentID, { name: info.title }) &&
        !childEvents.has(info.id)
      )
        childEvents.set(
          info.id,
          new OpenCodeEvents((type, payload, key) => {
            if (
              type !== "subagent" &&
              (!historicalReplay || ["message", "tool", "text-delta"].includes(type))
            )
              children.emit(info.id, type, payload, key);
          }),
        );
    };
    const acceptEvent = (e: Wire) => {
      const p = e.properties ?? {},
        eventSession = p.sessionID ?? p.part?.sessionID ?? p.info?.sessionID;
      if (["session.created", "session.updated"].includes(e.type) && p.info?.parentID)
        registerChild(p.info);
      if (eventSession !== nativeId && !children.has(eventSession)) return;
      if (["permission.replied", "question.replied", "question.rejected"].includes(e.type)) {
        if (typeof p.requestID === "string") interactions.resolve(p.requestID);
        return;
      }
      const translator = eventSession === nativeId ? events : childEvents.get(eventSession);
      if (e.type === "session.status" && children.has(eventSession))
        children.emit(eventSession, "state", {
          runState: p.status?.type === "busy" ? "running" : p.status?.type,
        });
      if (translator?.accept(e.type, p)) return;
      if (e.type === "permission.asked" || e.type === "question.asked") ask(e.type, p);
    };
    const response = await fetch(`${base}/event`, {
      headers: { "x-opencode-directory": cwd, ...authHeaders },
      signal: abort.signal,
    });
    if (!response.ok || !response.body) throw new Error("OpenCode SSE 未连接。");
    void (async () => {
      let buffer = "";
      const decoder = new TextDecoder();
      for await (const chunk of response.body!) {
        buffer += decoder.decode(chunk, { stream: true });
        // Normalize after joining chunks: CR and LF can arrive separately.
        buffer = buffer.replaceAll("\r\n", "\n");
        if (buffer.length > 8 * 1024 * 1024) throw new Error("OpenCode SSE 事件超过读取上限。");
        let boundary;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = block
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5))
            .join("\n");
          if (!data) continue;
          const e = JSON.parse(data) as Wire;
          if (recovering) {
            bufferedBytes += Buffer.byteLength(data);
            if (bufferedBytes > 8 * 1024 * 1024) throw new Error("OpenCode 恢复事件超过读取上限。");
            buffered.push(e);
          } else acceptEvent(e);
        }
      }
      if (!abort.signal.aborted) throw new Error("OpenCode SSE 已结束，原生运行状态需要对账。");
    })().catch((error) => {
      interactions.close();
      if (!abort.signal.aborted) {
        abort.abort();
        ctx.emit("disconnected", { message: error.message });
      }
    });
    child.once("exit", (code) => {
      interactions.close();
      if (!abort.signal.aborted)
        ctx.emit("disconnected", { message: `OpenCode server 已退出 (${code})。` });
    });
    const readHistory = async () => {
      const history = await readOpenCodeTree(request, nativeId);
      for (const child of history.subagents) {
        registerChild(child.info);
        if (child.error) {
          children.emit(child.agentId, "state", { historyError: child.error });
          continue;
        }
        // Historical output uses the same keys as SSE but never replays billing or turn ends.
        const translator = childEvents.get(child.agentId)!;
        historicalReplay = true;
        try {
          for (const row of child.messages) {
            translator.accept("message.updated", { info: row.info });
            for (const part of row.parts) translator.accept("message.part.updated", { part });
          }
        } finally {
          historicalReplay = false;
        }
      }
      return history;
    };
    if (recovering) {
      try {
        await readHistory();
      } catch (error) {
        ctx.emit("state", { historyError: (error as Error).message });
      }
      recovering = false;
      for (const event of buffered) acceptEvent(event);
      buffered.length = 0;
    }
    // Subscribe first: resolutions received during snapshots must win over old pending rows.
    const snapshots = await Promise.all([request("/permission"), request("/question")]);
    for (let i = 0; i < snapshots.length; i++) {
      const rows = snapshots[i];
      if (!Array.isArray(rows)) throw new Error("OpenCode 待处理交互列表格式不兼容。");
      for (const row of rows)
        if (row && typeof row === "object")
          ask(i === 0 ? "permission.asked" : "question.asked", row);
    }
    const runtime: NativeRuntime = {
      nativeSessionId: nativeId,
      async models() {
        return openCodeModelOptions(await request("/provider"));
      },
      setPermissionMode,
      async send(text, _id, mode, settings) {
        if (mode === "steer") unsupported("OpenCode steer 尚未验证。");
        const requestedPermissionMode = ctx.permissionMode?.();
        if (requestedPermissionMode !== appliedPermissionMode)
          await setPermissionMode(requestedPermissionMode ?? null);
        const selected =
          settings?.model ??
          ctx.model ??
          (ctx.configuration
            ? `${ctx.configuration.provider}/${ctx.configuration.model}`
            : undefined);
        const qualified = ctx.configuration?.binding
          ? `${ctx.configuration.provider}/${ctx.configuration.model}`
          : selected;
        const target = qualified ? providerModel(qualified) : undefined;
        const effort = settings ? settings.reasoning : ctx.reasoning;
        validateReasoning(
          selected ?? null,
          effort ?? null,
          ctx.configuration?.binding
            ? [boundModelOption(ctx.configuration)]
            : effort
              ? openCodeModelOptions(await request("/provider"))
              : [],
        );
        ctx.assertSendAllowed?.(_id);
        events.start();
        await request(`/session/${encodeURIComponent(nativeId)}/prompt_async`, "POST", {
          parts: [{ type: "text", text }],
          ...(target ? { model: { providerID: target.provider, modelID: target.model } } : {}),
          ...(effort ? { variant: effort } : {}),
        });
        return { nativeRunId: null };
      },
      async cancel() {
        await request(`/session/${encodeURIComponent(nativeId)}/abort`, "POST");
      },
      async read() {
        return readHistory();
      },
      async list() {
        return request("/session");
      },
      close: stop,
    };
    return runtime;
  } catch (e) {
    await stop();
    throw e;
  }
  function stop(): Promise<void> {
    if (stopping) return stopping;
    interactions.close();
    abort.abort();
    stopping =
      child.pid === undefined || child.exitCode !== null || child.signalCode !== null
        ? Promise.resolve()
        : new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("OpenCode 进程退出尚未确认。")), 3000);
            child.once("exit", () => {
              clearTimeout(timer);
              resolve();
            });
            child.kill();
          });
    return stopping;
  }
}
