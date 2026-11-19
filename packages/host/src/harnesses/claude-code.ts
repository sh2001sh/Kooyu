import { boundModelOption } from "../providers/model-option.js";
import { randomUUID } from "node:crypto";
import { claudeModelOptions, validateReasoning } from "./model-options.js";
import { nativeParameters } from "./model-metadata.js";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { query, listSessions, type Query } from "@anthropic-ai/claude-agent-sdk";
import {
  descriptor,
  needCwd,
  unsupported,
  type HarnessAdapter,
  type Wire,
  type AdapterContext,
} from "./adapter.js";
import { executable } from "./rpc.js";
import { captureNativeCommand } from "./native-command.js";
import { inspectClaudeFiles } from "./session-presence.js";
import { homedir } from "node:os";
import { NativeSubagents } from "./subagents.js";
import type { ClaudeHistory } from "./claude-history.js";
import { resolveInput } from "./input-modalities.js";

/**
 * Claude Code's own models all take images, but a custom ANTHROPIC_BASE_URL (process
 * env or native settings files) may point at a relay or another vendor whose image
 * support is unknown. Unknown is treated as unsupported.
 */
export function claudeUsesCustomEndpoint(env: NodeJS.ProcessEnv, cwd: string | null): boolean {
  return claudeEndpoint(env, cwd) !== null;
}

// Conflicting or unreadable settings cannot establish a safe route identity.
function claudeEndpoint(env: NodeJS.ProcessEnv, cwd: string | null): string | null | undefined {
  const endpoints = new Set<string>();
  if (env.ANTHROPIC_BASE_URL) endpoints.add(env.ANTHROPIC_BASE_URL.replace(/\/+$/, ""));
  const home = env.CLAUDE_CONFIG_DIR ?? join(env.USERPROFILE ?? env.HOME ?? homedir(), ".claude");
  const files = [
    join(home, "settings.json"),
    ...(cwd
      ? [join(cwd, ".claude", "settings.json"), join(cwd, ".claude", "settings.local.json")]
      : []),
  ];
  for (const file of files) {
    let raw: string;
    try {
      raw = readFileSync(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      return undefined;
    }
    try {
      const url = (JSON.parse(raw) as Wire)?.env?.ANTHROPIC_BASE_URL;
      if (typeof url === "string" && url) endpoints.add(url.replace(/\/+$/, ""));
    } catch {
      return undefined;
    }
  }
  return endpoints.size > 1 ? undefined : (endpoints.values().next().value ?? null);
}

/** SDK history APIs read process.env: isolate per-binding homes in a bounded child. */
async function claudeHistory(ctx: AdapterContext, nativeId?: string): Promise<unknown> {
  const dir = needCwd(ctx);
  const env = { ...ctx.env, ...ctx.launch.env };
  if (!nativeId && env.CLAUDE_CONFIG_DIR === process.env.CLAUDE_CONFIG_DIR)
    return listSessions({ dir });
  const source =
    "const sdk = await import(" +
    JSON.stringify(import.meta.resolve("@anthropic-ai/claude-agent-sdk")) +
    "); " +
    (nativeId
      ? "const { readClaudeTree } = await import(" +
        JSON.stringify(
          new URL("./claude-history" + extname(import.meta.url), import.meta.url).href,
        ) +
        "); const result = await readClaudeTree(sdk, " +
        JSON.stringify(nativeId) +
        ", " +
        JSON.stringify(dir) +
        ");"
      : "const result = await sdk.listSessions(" + JSON.stringify({ dir }) + ");") +
    "process.stdout.write(JSON.stringify(result));";
  const output = await captureNativeCommand(
    {
      ...ctx,
      env,
      launch: { command: process.execPath, args: [], env: { ELECTRON_RUN_AS_NODE: "1" } },
    },
    ["--input-type=module", "-e", source],
  );
  return JSON.parse(output);
}
export function nativeClaudeExecutable(command = "claude"): string | null {
  const path = executable(command);
  if (!path) return null;
  if (process.platform === "win32" && extname(path).toLowerCase() === ".cmd") {
    const native = join(
      dirname(path),
      "node_modules",
      "@anthropic-ai",
      "claude-code",
      "bin",
      "claude.exe",
    );
    if (existsSync(native)) return native;
    return null;
  }
  return realpathSync(path);
}
export async function discoverClaudeModels(ctx: AdapterContext, runQuery: typeof query = query) {
  const cwd = ctx.cwd ?? process.cwd();

  // SDK control handshake only: no user prompt and no model request.
  let finish!: () => void;
  const waiting = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const native = nativeClaudeExecutable(
    ctx.launch.command === "claude-sdk" ? "claude" : ctx.launch.command,
  );
  const probe = runQuery({
    prompt: (async function* () {
      await waiting;
      yield* [];
    })(),
    options: {
      cwd,
      env: ctx.env,
      persistSession: false,
      ...(native || ctx.launch.command !== "claude-sdk"
        ? { pathToClaudeCodeExecutable: native ?? ctx.launch.command }
        : {}),
    },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const models = await Promise.race([
      probe.supportedModels(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Claude 原生模型目录握手超时。")), 20000);
      }),
    ]);
    return claudeModelOptions(models);
  } finally {
    clearTimeout(timer);
    finish();
    probe.close();
  }
}
export function claudeAdapterWithQuery(runQuery: typeof query = query): HarnessAdapter {
  return {
    descriptor: descriptor(
      "claude-code",
      "Claude Code · Agent SDK",
      "sdk",
      ["directChat", "historyRead", "resume", "observeLive", "cancel", "interaction", "usage"],
      "Agent SDK 0.3.322 with installed native CLI when available; bundled CLI persistence differs; subscription compatibility not claimed",
      "implemented",
    ),
    discoverModels: (ctx) => discoverClaudeModels(ctx, runQuery),
    standaloneRead: (session, ctx) => {
      if (!session.nativeSessionId) unsupported("没有可读取的原生会话。");
      return claudeHistory(ctx, session.nativeSessionId);
    },
    standaloneList: (_session, ctx) => claudeHistory(ctx),
    inspectSessions: (sessions, ctx) =>
      inspectClaudeFiles(
        sessions,
        ctx.launch.env?.CLAUDE_CONFIG_DIR ??
          ctx.env.CLAUDE_CONFIG_DIR ??
          join(homedir(), ".claude"),
      ),
    async connect(session, ctx) {
      const cwd = needCwd(ctx);
      const nativeId = session.nativeSessionId ?? randomUUID();
      const children = new NativeSubagents(ctx, () => nativeId);
      const taskAgents = new Map<string, string>();
      const toolOwners = new Map<string, string>();
      let started = Boolean(session.nativeSessionId),
        active: { query: Query; cancellation?: Promise<void> } | undefined;
      const reported = new Map<string, ReturnType<typeof nativeParameters>>();
      const readHistory = async () => {
        const history = (await claudeHistory(ctx, nativeId)) as ClaudeHistory;
        const identities = new Map<string, string>([[nativeId, nativeId]]);
        for (const child of history.subagents) {
          // The SDK's metadata links stored agent IDs to the tool IDs used by live events.
          const id = child.toolCallId ?? child.agentId;
          const parent = identities.get(child.parentAgentId);
          if (
            !parent ||
            !children.register(id, parent, child.toolCallId ? { toolCallId: child.toolCallId } : {})
          )
            throw new Error("Claude 子代理恢复身份冲突。");
          identities.set(child.agentId, id);
        }
        for (const child of history.subagents) {
          const id = identities.get(child.agentId)!;
          if (child.error) {
            children.emit(id, "state", { historyError: child.error });
            continue;
          }
          for (const row of child.messages ?? []) {
            const message = row.message as Wire;
            if (row.type === "assistant")
              children.emit(id, "message", { ...message, id: row.uuid }, row.uuid);
            else if (row.type === "user") children.emit(id, "tool", message, row.uuid);
            const content = Array.isArray(message.content) ? message.content : [];
            for (const [index, block] of content.entries()) {
              if (block.type === "thinking" && typeof block.thinking === "string")
                children.emit(
                  id,
                  "message",
                  { id: `${row.uuid}:thinking:${index}`, text: block.thinking, channel: "thought" },
                  `${row.uuid}:thinking:${index}`,
                );
              if (block.type === "tool_use") {
                toolOwners.set(block.id, id);
                children.emit(
                  id,
                  "tool",
                  { ...block, toolCallId: block.id, lifecycle: "started" },
                  `${row.uuid}:tool:${block.id}`,
                );
              }
            }
          }
        }
        return history;
      };
      if (session.nativeSessionId) {
        try {
          await readHistory();
        } catch (error) {
          ctx.emit("state", { historyError: (error as Error).message });
        }
      }
      const supportsImages = (selected?: string | null) => {
        if (ctx.configuration?.binding?.route === "gateway") return false;
        if (ctx.configuration?.binding || ctx.configuration?.baseUrl)
          return Boolean(ctx.configuration.modelParameters?.input?.includes("image"));
        const env = { ...ctx.env, ...ctx.launch.env };
        const endpoint = claudeEndpoint(env, cwd);
        if (endpoint === undefined) return false;
        const model = selected ?? ctx.model ?? env.ANTHROPIC_MODEL;
        if (!model) return endpoint === null;
        return (
          resolveInput(
            ctx,
            "anthropic",
            model,
            endpoint === null ? ["text", "image"] : undefined,
            endpoint ? { baseUrl: endpoint, api: "anthropic-messages" } : undefined,
          )?.includes("image") ?? false
        );
      };
      return {
        nativeSessionId: nativeId,
        supportsImages,
        async models() {
          return (await discoverClaudeModels(ctx, runQuery)).map((model) => {
            const limits = reported.get(model.resolvedModel ?? model.id);
            return limits
              ? {
                  ...model,
                  ...limits,
                  parameterSources: { ...model.parameterSources, ...limits.parameterSources },
                }
              : model;
          });
        },
        async send(text, commandId, mode, settings, input) {
          if (mode === "steer") unsupported("此 SDK 接入尚未验证 steer。");
          if (input?.images?.length && !supportsImages(settings?.model))
            unsupported("Claude 当前模型或网关未声明图片输入，图片未发送。");
          const targetModel = settings?.model ?? ctx.model ?? ctx.configuration?.model;
          const effort = settings ? settings.reasoning : ctx.reasoning;
          if (effort)
            validateReasoning(
              targetModel ?? "default",
              effort,
              ctx.configuration?.binding
                ? [boundModelOption(ctx.configuration)]
                : await discoverClaudeModels(ctx, runQuery),
            );
          ctx.assertSendAllowed?.(commandId);
          const options: Parameters<typeof query>[0]["options"] = {
            cwd,
            env: ctx.env,
            includePartialMessages: true,
            forwardSubagentText: true,
            persistSession: true,
            ...(started ? { resume: nativeId } : { sessionId: nativeId }),
            ...(targetModel ? { model: targetModel } : {}),
            ...(effort
              ? {
                  effort: effort as "low" | "medium" | "high" | "xhigh" | "max",
                }
              : {}),
            permissionMode:
              ctx.permissionMode?.() === "accept-edits"
                ? "acceptEdits"
                : ctx.permissionMode?.() === "bypass-permissions"
                  ? "bypassPermissions"
                  : "default",
            ...(ctx.permissionMode?.() === "bypass-permissions"
              ? { allowDangerouslySkipPermissions: true }
              : {}),
            canUseTool: async (toolName, input, options) => {
              const result = (await ctx.interact(options.toolUseID, {
                protocol: "claude",
                toolName,
                input,
              })) as Wire;
              if (result.behavior !== "allow" || options.signal.aborted)
                return { behavior: "deny", message: "用户拒绝或取消了此操作。" };
              if (toolName === "AskUserQuestion") {
                const questions = input.questions as Wire[] | undefined;
                const answers = result.updatedInput?.answers;
                if (
                  !Array.isArray(questions) ||
                  !questions.length ||
                  !answers ||
                  questions.some(
                    (question) =>
                      typeof question.question !== "string" ||
                      !Object.hasOwn(answers, question.question) ||
                      typeof answers[question.question] !== "string" ||
                      !answers[question.question].trim(),
                  )
                )
                  return { behavior: "deny", message: "问题尚未完整回答。" };
                return {
                  behavior: "allow",
                  updatedInput: {
                    ...input,
                    answers: Object.fromEntries(
                      questions.map((question) => [question.question, answers[question.question]]),
                    ),
                  },
                };
              }
              return { behavior: "allow", updatedInput: input };
            },
          };
          const native = nativeClaudeExecutable(
            ctx.launch.command === "claude-sdk" ? "claude" : ctx.launch.command,
          );
          if (native) options.pathToClaudeCodeExecutable = native;
          else if (ctx.launch.command !== "claude-sdk")
            options.pathToClaudeCodeExecutable = ctx.launch.command;
          let outcome = "unknown";
          let execution: typeof active;
          const cancellationConfirmed = async () =>
            execution?.cancellation
              ? execution.cancellation.then(
                  () => true,
                  () => false,
                )
              : false;
          const cancelledResult = async (event: Wire) =>
            (await cancellationConfirmed()) &&
            !event.startup_failure_reason &&
            (!event.is_error ||
              (event.subtype === "error_during_execution" &&
                (event.errors ?? []).every((error: unknown) => claudeInterruptError(error))));
          try {
            const images = input?.images ?? [];
            // Images go as Messages API image blocks in one streamed user message.
            const prompt = images.length
              ? (async function* () {
                  yield {
                    type: "user" as const,
                    parent_tool_use_id: null,
                    message: {
                      role: "user" as const,
                      content: [
                        ...images.map((image) => ({
                          type: "image" as const,
                          source: {
                            type: "base64" as const,
                            media_type: image.mimeType as
                              "image/png" | "image/jpeg" | "image/gif" | "image/webp",
                            data: image.data,
                          },
                        })),
                        ...(text ? [{ type: "text" as const, text }] : []),
                      ],
                    },
                  };
                })()
              : text;
            execution = { query: runQuery({ prompt, options }) };
            active = execution;
            for await (const value of execution.query) {
              const e = value as Wire;
              if (
                e.type === "system" &&
                ["task_started", "task_progress", "task_notification"].includes(e.subtype)
              ) {
                const id = e.tool_use_id ?? taskAgents.get(e.task_id) ?? e.task_id;
                const parent =
                  taskAgents.get(e.parent_task_id) ?? toolOwners.get(e.tool_use_id) ?? nativeId;
                const isAgent =
                  e.task_type === "local_agent" || e.subagent_type || children.has(id);
                if (
                  isAgent &&
                  children.register(id, parent, {
                    ...(e.description ? { name: e.description } : {}),
                    ...(e.tool_use_id ? { toolCallId: e.tool_use_id } : {}),
                    status: e.subtype === "task_notification" ? e.status : "running",
                  })
                ) {
                  taskAgents.set(e.task_id, id);
                  children.emit(id, "state", e, e.uuid);
                  if (e.summary)
                    children.emit(
                      id,
                      "message",
                      { role: "assistant", text: e.summary },
                      e.uuid ? `${e.uuid}:summary` : undefined,
                    );
                  continue;
                }
              }
              const childId =
                typeof e.parent_tool_use_id === "string" ? e.parent_tool_use_id : undefined;
              if (childId)
                children.register(childId, toolOwners.get(childId) ?? nativeId, {
                  toolCallId: childId,
                });
              const emit: typeof ctx.emit = childId
                ? (type, payload, key) => {
                    if (type !== "subagent") children.emit(childId, type, payload, key);
                  }
                : ctx.emit;
              if (childId && e.type === "result") {
                children.emit(
                  childId,
                  "turn-ended",
                  {
                    outcome: (await cancelledResult(e))
                      ? "cancelled"
                      : e.is_error
                        ? "failed"
                        : "completed",
                  },
                  e.uuid,
                );
                continue;
              }
              if (e.type === "system" && e.subtype === "init") {
                if (e.session_id !== nativeId)
                  throw new Error("Claude 原生 session ID 与请求不一致。");
                ctx.emit("state", e);
                started = true;
              } else if (
                e.type === "stream_event" &&
                e.event?.type === "content_block_delta" &&
                e.event.delta?.type === "text_delta"
              )
                emit("text-delta", { text: e.event.delta.text, itemId: e.event.index });
              else if (
                e.type === "stream_event" &&
                e.event?.type === "content_block_delta" &&
                e.event.delta?.type === "thinking_delta"
              )
                emit("text-delta", {
                  text: e.event.delta.thinking,
                  channel: "thought",
                  itemId: e.event.index,
                });
              else if (e.type === "assistant") {
                emit("message", { ...e.message, id: e.uuid }, e.uuid);
                for (const block of e.message.content ?? [])
                  if (block.type === "tool_use") {
                    toolOwners.set(block.id, childId ?? nativeId);
                    if (["Agent", "Task"].includes(block.name))
                      children.register(block.id, childId ?? nativeId, {
                        name: block.input?.description,
                        toolCallId: block.id,
                        status: "running",
                      });
                    emit(
                      "tool",
                      { ...block, toolCallId: block.id, lifecycle: "started" },
                      `${e.uuid}:tool:${block.id}`,
                    );
                  }
              } else if (e.type === "user") {
                const results = (e.message.content ?? []).filter(
                  (block: Wire) => block.type === "tool_result",
                );
                if (!results.length) emit("tool", e.message, e.uuid);
                for (const block of results)
                  emit(
                    "tool",
                    {
                      ...block,
                      toolCallId: block.tool_use_id,
                      lifecycle: "completed",
                      status: block.is_error ? "failed" : "completed",
                    },
                    `${e.uuid}:result:${block.tool_use_id}`,
                  );
                for (const block of e.message.content ?? [])
                  if (block.type === "tool_result" && children.has(block.tool_use_id)) {
                    children.emit(block.tool_use_id, "tool", block, e.uuid);
                  }
              } else if (e.type === "result") {
                outcome = (await cancelledResult(e))
                  ? "cancelled"
                  : e.is_error
                    ? "failed"
                    : "completed";
                for (const [id, usage] of Object.entries(e.modelUsage ?? {})) {
                  const value = usage as Wire;
                  reported.set(
                    id,
                    nativeParameters(
                      {
                        contextWindow: value.contextWindow,
                        maxOutputTokens: value.maxOutputTokens,
                      },
                      {
                        kind: "native-runtime",
                        label: "Claude 原生 modelUsage 运行报告",
                      },
                    ),
                  );
                }
                ctx.emit(
                  "usage",
                  {
                    ...e.usage,
                    costUsd: ctx.configuration?.binding ? null : e.total_cost_usd,
                    modelUsage: e.modelUsage,
                    ...(typeof e.duration_ms === "number" &&
                    Number.isFinite(e.duration_ms) &&
                    e.duration_ms >= 0
                      ? { durationMs: Math.round(e.duration_ms) }
                      : {}),
                    scope: "turn",
                    sourceId: e.uuid,
                  },
                  e.uuid ? `usage:${e.uuid}` : undefined,
                );
                ctx.emit(
                  "turn-ended",
                  {
                    outcome,
                    subtype: e.subtype,
                    errors: e.errors,
                    backgroundState: "unknown",
                    commandId,
                  },
                  `result:${commandId}`,
                );
              } else emit("state", e, e.uuid);
            }
            if (outcome === "unknown" && (await cancellationConfirmed())) {
              outcome = "cancelled";
              ctx.emit(
                "turn-ended",
                { outcome, commandId, backgroundState: "unknown" },
                `result:${commandId}`,
              );
            }
            if (outcome === "unknown")
              throw new Error("Claude SDK 流结束但未收到原生 result，执行状态未知。");
          } catch (error) {
            if (
              outcome !== "failed" &&
              (await cancellationConfirmed()) &&
              claudeInterruptError(error)
            ) {
              if (outcome !== "cancelled") {
                outcome = "cancelled";
                ctx.emit(
                  "turn-ended",
                  { outcome, commandId, backgroundState: "unknown" },
                  `result:${commandId}`,
                );
              }
            } else if (outcome === "unknown") {
              ctx.emit("disconnected", {
                message: error instanceof Error ? error.message : "Claude SDK 连接中断。",
              });
              throw error;
            }
          } finally {
            if (active === execution) active = undefined;
          }
          if (outcome === "cancelled") ctx.emit("state", { stopped: true, commandId });
          return { nativeRunId: null };
        },
        async cancel() {
          if (!active) unsupported("没有活动的 Claude SDK 请求，未发送取消。");
          try {
            const execution = active;
            execution.cancellation ??= Promise.resolve()
              .then(() => execution.query.interrupt())
              .then(() => {});
            await execution.cancellation;
          } catch (error) {
            ctx.emit("disconnected", {
              message: error instanceof Error ? error.message : "Claude SDK 取消结果未知。",
            });
            throw error;
          }
        },
        async read() {
          return readHistory();
        },
        async list() {
          return claudeHistory(ctx);
        },
        async close() {
          try {
            active?.query.close();
          } finally {
            ctx.emit("disconnected", { reason: "closed" });
          }
        },
      };
    },
  };
}
export const claudeCodeAdapter = claudeAdapterWithQuery();

/** Only interruption signatures following an acknowledged local interrupt are cancellation. */
function claudeInterruptError(value: unknown): boolean {
  if (value instanceof Error && value.name === "AbortError") return true;
  const message = value instanceof Error ? value.message : typeof value === "string" ? value : "";
  return (
    /^(?:Claude Code returned an error result: )?\[ede_diagnostic\] result_type=user last_content_type=n\/a stop_reason=null\s*$/.test(
      message,
    ) ||
    /^(?:request |operation |query |the operation was )?(?:interrupted|aborted)(?: by (?:the )?user)?[.!]?$/i.test(
      message,
    )
  );
}
