import { acpHarness } from "./acp.js";
import {
  unsupported,
  type AdapterContext,
  type HarnessAdapter,
  type NativeRuntime,
  type Wire,
} from "./adapter.js";
import type { HarnessModelOption, PermissionMode, Session } from "@kodo/protocol";
import { captureNativeCommand } from "./native-command.js";
import { readCompleteJsonLines } from "./native-history.js";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { NativeSubagents } from "./subagents.js";
import { launch } from "./rpc.js";
import { boundNativeModel } from "../providers/native-config.js";
import { NativeInteractions } from "./native-interactions.js";
import { kimiInteractionResponse } from "./kimi-interactions.js";
import { presenceMap } from "./session-presence.js";

const acp = acpHarness("kimi-code", "Kimi Code");
function usesKimiServer(ctx: AdapterContext): boolean {
  if (ctx.launch.args.at(-1) !== "acp") return false;
  const entry = (ctx.launch.args.at(-2) ?? "").replaceAll("\\", "/");
  const command = ctx.launch.command.replaceAll("\\", "/");
  return (
    entry.toLowerCase().endsWith("/@moonshot-ai/kimi-code/dist/main.mjs") ||
    /(?:^|[/])kimi(?:\.cmd|\.exe)?$/i.test(command)
  );
}
async function listKimi(ctx: AdapterContext, all: boolean, archived = true): Promise<Wire[]> {
  const args = ctx.launch.args;
  if (args.at(-1) !== "acp") unsupported("该 Kimi 入口未声明可调用的原生 session 命令。");
  const output = await captureNativeCommand(ctx, [
    ...args.slice(0, -1),
    "session",
    "list",
    ...(all ? ["--all"] : []),
    ...(archived ? ["--archived"] : []),
    "--json",
    "--limit",
    all ? "10000" : "1000",
  ]);
  const listing = JSON.parse(output) as Wire[];
  if (!Array.isArray(listing)) unsupported("Kimi 原生会话列表格式不兼容。");
  return listing;
}
async function readKimi(session: Session, ctx: AdapterContext) {
  const nativeId = session.nativeSessionId;
  if (!nativeId) unsupported("Kimi 会话没有原生 ID。");
  const listing = await listKimi(ctx, true);
  const selected = listing.find((item) => item.id === nativeId);
  if (typeof selected?.sessionDir !== "string")
    unsupported("Kimi 原生会话列表中没有此会话的历史位置。");
  const home =
    ctx.launch.env?.KIMI_CODE_HOME ?? ctx.env.KIMI_CODE_HOME ?? join(homedir(), ".kimi-code");
  const base = await realpath(join(home, "sessions"));
  const sessionPath = await realpath(resolve(selected.sessionDir));
  const underBase = relative(base, sessionPath);
  if (!underBase || underBase === ".." || underBase.startsWith(".." + sep) || isAbsolute(underBase))
    unsupported("Kimi 返回了会话目录以外的历史位置。");
  const wirePath = await realpath(join(sessionPath, "agents", "main", "wire.jsonl"));
  const withinSession = relative(sessionPath, wirePath);
  if (
    !withinSession ||
    withinSession === ".." ||
    withinSession.startsWith(".." + sep) ||
    isAbsolute(withinSession)
  )
    unsupported("Kimi 历史文件不在已确认的会话目录内。");
  const messages = (await readCompleteJsonLines(wirePath))
    .filter((record) => record.type === "agent.message.appended")
    .map((record) => record.message?.message)
    .filter((message) => ["user", "assistant", "tool"].includes(message?.role));
  return { nativeSessionId: nativeId, messages };
}
async function listKimiSummaries(_session: Session, ctx: AdapterContext) {
  const listing = await listKimi(ctx, false);
  return listing.map((item) => ({
    id: item.id,
    title: item.title,
    workDir: item.workDir,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    archived: item.archived,
  }));
}
async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolvePort(port)));
    });
  });
}
function apiData(value: Wire, path: string): Wire {
  if (value.code !== 0) throw new Error(`Kimi Server ${path}: ${String(value.msg ?? value.code)}`);
  return value.data ?? {};
}
async function connectKimiServer(session: Session, ctx: AdapterContext): Promise<NativeRuntime> {
  const cwd = ctx.cwd;
  if (!cwd) unsupported("Kimi Server 需要明确的工作目录。");
  if (!usesKimiServer(ctx)) unsupported("该 Kimi 入口未声明可调用的 Server API 子命令。");
  const args = ctx.launch.args;
  const port = await freePort();
  const abort = new AbortController();
  const interactions = new NativeInteractions(ctx);
  let closeSocket = () => {};
  let stopping: Promise<void> | undefined;
  const child = launch({
    ...ctx,
    launch: {
      ...ctx.launch,
      args: [...args.slice(0, -1), "web", "--no-open", "--port", String(port)],
    },
  });
  let output = "",
    token = "",
    activePromptId: string | null = null,
    closed = false;
  child.stdout.on("data", (chunk: Buffer) => {
    output = (output + chunk.toString("utf8")).slice(-16000);
    const match = /#token=([^\s]+)/.exec(output);
    if (match?.[1]) token = match[1];
  });
  child.stderr.resume();
  const base = `http://127.0.0.1:${port}`;
  const headers = () => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });
  const request = async (path: string, method = "GET", body?: unknown): Promise<Wire> => {
    if (closed || abort.signal.aborted) throw new Error("Kimi Server 连接已关闭。");
    if (!token) throw new Error("Kimi Server 尚未提供本地认证令牌。");
    const response = await fetch(`${base}${path}`, {
      method,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30000)]),
    });
    const value = (await response.json()) as Wire;
    if (!response.ok) throw new Error(`Kimi Server ${path}: HTTP ${response.status}`);
    return apiData(value, path);
  };
  let startupError: Error | undefined;
  child.once("error", (error) => (startupError = error));
  child.once("exit", (code) => {
    interactions.close();
    abort.abort();
    if (!closed)
      ctx.emit("disconnected", { message: `Kimi Server 已退出 (${code ?? "signal"})。` });
  });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (startupError) throw startupError;
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error("Kimi Server 启动失败。");
      try {
        const response = await fetch(`${base}/api/v1/healthz`, {
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok && token) {
          ready = true;
          break;
        }
      } catch {
        // Startup is bounded below; the local health endpoint may not be ready yet.
      }
      await new Promise((resolveReady) => setTimeout(resolveReady, 250));
    }
    if (!ready) throw new Error("Kimi Server 未在时限内就绪或没有提供认证令牌。");
    let nativeId = session.nativeSessionId;
    let initialNativePermissionMode: string | null = null;
    if (nativeId) {
      const existing = await request(`/api/v1/sessions/${encodeURIComponent(nativeId)}`);
      if (existing.id !== nativeId) throw new Error("Kimi Server 未确认原生会话 ID。");
      if (typeof existing.agent_config?.permission_mode === "string")
        initialNativePermissionMode = existing.agent_config.permission_mode;
    } else {
      const created = await request("/api/v1/sessions", "POST", {
        title: session.title,
        metadata: { cwd },
      });
      nativeId = created.id;
      if (typeof nativeId !== "string" || !nativeId.startsWith("session_"))
        throw new Error("Kimi Server 未返回有效的原生会话 ID。");
      if (typeof created.agent_config?.permission_mode === "string")
        initialNativePermissionMode = created.agent_config.permission_mode;
    }
    const socket = new WebSocket(`ws://127.0.0.1:${port}/api/v1/ws`, `kimi-code.bearer.${token}`);
    const pending = new Map<string, (frame: Wire) => void>();
    const rejectPending = () => {
      for (const [id, resolveAck] of pending) {
        pending.delete(id);
        resolveAck({ code: -1, msg: "WebSocket closed" });
      }
    };
    closeSocket = () => {
      rejectPending();
      socket.close();
    };
    const frameKinds = new Map<string, string>();
    const children = new NativeSubagents(ctx, () => "main");
    const seenText = new Map<string, number>();
    // Transcript sequence numbers restart with each server subscription.
    const subscriptionId = randomUUID();
    let permissionMode = session.permissionMode?.startsWith("kimi:")
      ? session.permissionMode
      : null;
    let nativePermissionMode = initialNativePermissionMode;
    const socketReady = new Promise<void>((resolveSocket, rejectSocket) => {
      const timer = setTimeout(
        () => rejectSocket(new Error("Kimi Server WebSocket 握手超时。")),
        10000,
      );
      socket.addEventListener(
        "open",
        () => {
          clearTimeout(timer);
          resolveSocket();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          rejectSocket(new Error("Kimi Server WebSocket 连接失败。"));
        },
        { once: true },
      );
    });
    const sendWire = (frame: Wire) => {
      if (closed || abort.signal.aborted || socket.readyState !== 1)
        throw new Error("Kimi Server WebSocket 已关闭。");
      socket.send(JSON.stringify(frame));
    };
    const rpc = (type: string, payload: Wire): Promise<Wire> => {
      const id = randomUUID();
      return new Promise((resolveAck, rejectAck) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          rejectAck(new Error(`Kimi Server ${type} 响应超时。`));
        }, 10000);
        pending.set(id, (frame) => {
          clearTimeout(timer);
          if (frame.code !== 0)
            rejectAck(new Error(`Kimi Server ${type}: ${String(frame.msg ?? frame.code)}`));
          else resolveAck(frame);
        });
        try {
          sendWire({ type, id, payload });
        } catch (error) {
          clearTimeout(timer);
          pending.delete(id);
          rejectAck(error);
        }
      });
    };
    const onFrame = (event: MessageEvent) => {
      if (closed || abort.signal.aborted) return;
      let frame: Wire;
      try {
        frame = JSON.parse(String(event.data)) as Wire;
      } catch {
        return;
      }
      if (frame.type === "ack" && typeof frame.id === "string") {
        pending.get(frame.id)?.(frame);
        pending.delete(frame.id);
        return;
      }
      if (frame.session_id && frame.session_id !== nativeId) return;
      const agentId = typeof frame.agent_id === "string" ? frame.agent_id : "main";
      const isChild = agentId !== "main";
      if (isChild) children.register(agentId, "main");
      const emit: typeof ctx.emit = isChild
        ? (type, payload, key) => {
            if (type !== "subagent") children.emit(agentId, type, payload, key);
          }
        : ctx.emit;
      const frameKey = (id: string) => JSON.stringify([agentId, id]);
      if (frame.type === "ping") {
        sendWire({ type: "pong", id: frame.id, payload: {} });
        return;
      }
      if (frame.type === "agent") {
        if (isChild) {
          children.emit(agentId, "state", { ...frame, runState: frame.status });
          return;
        }
        if (typeof frame.permission_mode === "string") nativePermissionMode = frame.permission_mode;
        ctx.emit("state", { ...frame, runState: frame.status });
        return;
      }
      if (frame.type === "event.session.work_changed") {
        ctx.emit("state", { ...frame.payload, runState: frame.payload?.busy ? "running" : "idle" });
        return;
      }
      if (frame.type === "usage") {
        emit("usage", { ...frame, scope: "session" });
        return;
      }
      if (frame.type === "interaction") {
        if (
          frame.session_id !== nativeId ||
          typeof frame.interaction_id !== "string" ||
          !frame.interaction_id
        )
          return;
        if (frame.status === "ended") {
          interactions.resolve(frame.interaction_id);
          return;
        }
        if (frame.status !== "pending" || !["approval", "question"].includes(frame.kind)) return;
        const approval = frame.kind === "approval";
        interactions.ask(
          frame.interaction_id,
          {
            protocol: "kimi",
            method: approval ? "approval/request" : "question/request",
            params: frame.request,
          },
          async (answer) => {
            return request(
              `/api/v1/sessions/${encodeURIComponent(nativeId!)}/interactions/${encodeURIComponent(String(frame.interaction_id))}`,
              "POST",
              kimiInteractionResponse(approval ? "approval" : "question", answer),
            );
          },
        );
        return;
      }
      const transcript = frame.payload as Wire | undefined;
      if (frame.type !== "transcript.ops" || !Array.isArray(transcript?.ops)) return;
      for (let index = 0; index < transcript.ops.length; index++) {
        const op = transcript.ops[index] as Wire;
        const eventId = `${nativeId}:subscription:${subscriptionId}:${agentId}:${String(transcript.seq ?? 0)}:${index}`;
        if (op.op === "frame.upsert" && op.frame?.frameId) {
          const value = op.frame as Wire;
          frameKinds.set(
            frameKey(value.frameId),
            value.role === "user" ? "user" : String(value.kind ?? "text"),
          );
          if (value.kind === "tool")
            emit(
              "tool",
              {
                ...value,
                status: value.state === "done" ? "completed" : value.state,
              },
              eventId,
            );
          else if (
            (value.kind === "text" || value.kind === "thinking") &&
            typeof value.text === "string" &&
            value.role !== "user"
          ) {
            const previousLength = seenText.get(frameKey(value.frameId)) ?? 0;
            if (value.text.length > previousLength) {
              emit(
                "text-delta",
                {
                  text: value.text.slice(previousLength),
                  channel: value.kind === "thinking" ? "thought" : "assistant",
                },
                eventId,
              );
              seenText.set(frameKey(value.frameId), value.text.length);
            }
          }
        } else if (op.op === "append" && typeof op.text === "string") {
          const frameId = op.target?.frameId;
          const kind = typeof frameId === "string" ? frameKinds.get(frameKey(frameId)) : undefined;
          const previousLength =
            typeof frameId === "string" ? (seenText.get(frameKey(frameId)) ?? 0) : 0;
          const offset = Number(op.offset);
          const unseen =
            Number.isSafeInteger(offset) && offset >= 0
              ? op.text.slice(Math.max(0, previousLength - offset))
              : "";
          if (kind && kind !== "user" && unseen)
            emit(
              "text-delta",
              { text: unseen, channel: kind === "thinking" ? "thought" : "assistant" },
              eventId,
            );
          if (typeof frameId === "string" && kind && Number.isSafeInteger(offset) && offset >= 0)
            seenText.set(frameKey(frameId), Math.max(previousLength, offset + op.text.length));
        } else if (
          op.op === "turn.upsert" &&
          op.turn &&
          ["completed", "cancelled", "failed", "interrupted"].includes(op.turn.state)
        ) {
          const outcome =
            op.turn.state === "completed"
              ? "completed"
              : op.turn.state === "failed"
                ? "failed"
                : "cancelled";
          emit(
            "turn-ended",
            { outcome, backgroundState: "unknown", turn: op.turn },
            eventId,
            op.turn.triggerPromptId ?? activePromptId,
          );
          if (!isChild && op.turn.triggerPromptId === activePromptId) activePromptId = null;
          if (op.turn.usage)
            emit(
              "usage",
              { ...op.turn.usage, scope: "session" },
              `${eventId}:usage`,
              op.turn.triggerPromptId ?? null,
            );
        }
      }
    };
    socket.addEventListener("message", onFrame);
    socket.addEventListener("close", () => {
      rejectPending();
      interactions.close();
      abort.abort();
      if (!closed) ctx.emit("disconnected", { message: "Kimi Server WebSocket 已断开。" });
    });
    try {
      await socketReady;
      await rpc("client_hello", { client_id: "kodo" });
      const subscribed = await rpc("subscribe_v2", {
        session_id: nativeId,
        transcript: { "*": "delta" },
      });
      if (!(subscribed.payload?.accepted ?? []).includes(nativeId))
        throw new Error("Kimi Server 未接受原生会话订阅。");
      if (permissionMode) {
        const selected = permissionMode.slice(5);
        const profile = await request(
          `/api/v1/sessions/${encodeURIComponent(nativeId)}/profile`,
          "POST",
          {
            agent_config: { permission_mode: selected },
          },
        );
        if (profile.agent_config?.permission_mode !== selected)
          throw new Error("Kimi Server 未确认初始权限模式。");
        nativePermissionMode = selected;
      }
    } catch (error) {
      await stop();
      throw error;
    }
    return {
      nativeSessionId: nativeId,
      capabilities: { steer: "supported", resume: "supported", historyRead: "supported" },
      async models(): Promise<HarnessModelOption[]> {
        const catalog = await request("/api/v1/models");
        if (!Array.isArray(catalog.items)) unsupported("Kimi Server 模型目录格式不兼容。");
        return catalog.items
          .filter(
            (item: Wire) => typeof item.provider === "string" && typeof item.model === "string",
          )
          .map((item: Wire) => ({
            id: `${item.provider}/${item.model}`,
            name: typeof item.display_name === "string" ? item.display_name : item.model,
            source: "discovered" as const,
            ...(Number.isSafeInteger(item.max_context_size)
              ? { contextWindow: item.max_context_size }
              : {}),
            ...(Array.isArray(item.support_efforts)
              ? {
                  reasoning: item.support_efforts.filter(
                    (value: unknown) => typeof value === "string",
                  ),
                }
              : {}),
          }));
      },
      async permissionOptions() {
        return {
          current:
            permissionMode ??
            (nativePermissionMode ? (`kimi:${nativePermissionMode}` as PermissionMode) : null),
          options: [
            { value: "kimi:manual" as const, label: "逐项审批" },
            { value: "kimi:auto" as const, label: "自动判断" },
            { value: "kimi:yolo" as const, label: "跳过审批" },
          ],
        };
      },
      async setPermissionMode(mode) {
        if (!mode?.startsWith("kimi:") || !["manual", "auto", "yolo"].includes(mode.slice(5)))
          unsupported("Kimi Server 仅支持 manual、auto 和 yolo。");
        const selected = mode.slice(5);
        const profile = await request(
          `/api/v1/sessions/${encodeURIComponent(nativeId!)}/profile`,
          "POST",
          { agent_config: { permission_mode: selected } },
        );
        if (profile.agent_config?.permission_mode !== selected)
          throw new Error("Kimi Server 未确认权限模式变更。");
        permissionMode = mode;
        nativePermissionMode = selected;
      },
      async send(text, commandId, mode, settings) {
        const promptId = commandId || randomUUID();
        const body: Wire = { content: [{ type: "text", text }], prompt_id: promptId };
        // A live steer belongs to the active turn; do not reset its model or permissions.
        if (mode !== "steer") {
          let model = settings?.model ?? ctx.model;
          if (ctx.configuration?.binding && (model === ctx.configuration.model || !model))
            model = boundNativeModel(ctx.configuration);
          const thinking = settings ? settings.reasoning : ctx.reasoning;
          if (model) body.model = model;
          if (thinking) body.thinking = thinking;
          const selectedPermission = ctx.permissionMode?.() ?? permissionMode;
          if (selectedPermission) {
            if (
              !selectedPermission.startsWith("kimi:") ||
              !["manual", "auto", "yolo"].includes(selectedPermission.slice(5))
            )
              unsupported("Kimi Server 不支持所选权限模式。");
            body.permission_mode = selectedPermission.slice(5);
            permissionMode = selectedPermission;
          }
        }
        ctx.assertSendAllowed?.(commandId);
        const result = await request(
          `/api/v1/sessions/${encodeURIComponent(nativeId!)}/prompts`,
          "POST",
          body,
        );
        const submittedPromptId = String(result.prompt_id ?? promptId);
        if (result.status === "running" || (!activePromptId && mode !== "steer"))
          activePromptId = submittedPromptId;
        if (mode === "steer") {
          const result = await request(
            `/api/v1/sessions/${encodeURIComponent(nativeId!)}/prompts::steer`,
            "POST",
            {
              prompt_ids: [submittedPromptId],
            },
          );
          if (result.steered !== true)
            throw new Error("Kimi 已接收输入但未确认 steer；请核对原生队列，未重发。");
        }
        return { nativeRunId: submittedPromptId };
      },
      async cancel() {
        const current = await request(`/api/v1/sessions/${encodeURIComponent(nativeId!)}`);
        const id = typeof current.current_prompt_id === "string" ? current.current_prompt_id : null;
        if (!id) unsupported("没有活动的 Kimi Server 回合，未发送取消。");
        await request(
          `/api/v1/sessions/${encodeURIComponent(nativeId!)}/prompts/${encodeURIComponent(id)}:abort`,
          "POST",
        );
        if (activePromptId === id) activePromptId = null;
      },
      async read() {
        return request(
          `/api/v1/sessions/${encodeURIComponent(nativeId!)}/transcript?agent_id=main`,
        );
      },
      close: stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
  function stop(): Promise<void> {
    if (stopping) return stopping;
    closed = true;
    interactions.close();
    abort.abort();
    closeSocket();
    stopping =
      child.pid === undefined || child.exitCode !== null || child.signalCode !== null
        ? Promise.resolve()
        : new Promise<void>((resolveClose, rejectClose) => {
            const timer = setTimeout(
              () => rejectClose(new Error("Kimi Server 进程退出尚未确认。")),
              3000,
            );
            child.once("exit", () => {
              clearTimeout(timer);
              resolveClose();
            });
            child.kill();
          });
    return stopping;
  }
}
export const kimiCodeAdapter: HarnessAdapter = {
  ...acp,
  descriptor: {
    ...acp.descriptor,
    transport: "http",
    evidence:
      acp.descriptor.evidence +
      "; Kimi Server API 2.5 native session path; ACP retained for legacy IDs",
    capabilities: { ...acp.descriptor.capabilities, historyRead: "supported" },
  },
  standaloneRead: readKimi,
  standaloneList: listKimiSummaries,
  async inspectSessions(sessions, ctx) {
    const states = presenceMap(sessions, "unknown");
    try {
      const outcomes = await Promise.allSettled([
        listKimi(ctx, true, false),
        listKimi(ctx, true, true),
      ]);
      if (outcomes.some((outcome) => outcome.status === "rejected")) return states;
      const pages = outcomes.map((outcome) =>
        outcome.status === "fulfilled" ? outcome.value : [],
      );
      const listing = pages.flat();
      const complete =
        pages.every((page) => page.length < 10000) &&
        listing.every((item) => typeof item?.id === "string" && item.id);
      for (const session of sessions)
        states[session.nativeSessionId!] = listing.some(
          (item) => item.id === session.nativeSessionId,
        )
          ? "present"
          : complete
            ? "missing"
            : "unknown";
    } catch {
      /* Unsupported CLI versions, authentication and failed exports are not absence. */
    }
    return states;
  },
  async connect(session, ctx) {
    if (session.permissionMode?.startsWith("kimi:") && !usesKimiServer(ctx))
      unsupported("该 Kimi 安装没有已验证的 Server API 入口，无法应用所选权限模式。");
    if (
      usesKimiServer(ctx) &&
      !session.permissionMode?.startsWith("acp:") &&
      (!session.nativeSessionId || session.nativeSessionId.startsWith("session_"))
    )
      return connectKimiServer(session, ctx);
    const runtime = await acp.connect(session, ctx);
    return {
      ...runtime,
      read: () => readKimi({ ...session, nativeSessionId: runtime.nativeSessionId }, ctx),
      list: () => listKimiSummaries(session, ctx),
    };
  },
};
