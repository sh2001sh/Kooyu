import { createServer, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { BindingRuntime } from "@kodo/protocol";
import { KodoError } from "@kodo/protocol";
import type { Wire } from "../harnesses/adapter.js";
import { effortValues } from "./catalog.js";
import { geminiFromChat, geminiModel, geminiToChat } from "./gemini-chat.js";

function text(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) throw new KodoError("UNSUPPORTED", "网关仅支持文本与函数工具内容。");
  return content
    .map((part: Wire) => {
      if (
        !["text", "input_text", "output_text"].includes(part.type) ||
        typeof part.text !== "string"
      )
        throw new KodoError("UNSUPPORTED", "此转换路径不支持图片、加密推理或其他内容块。");
      return part.text;
    })
    .join("");
}
export function toChat(
  body: Wire,
  kind: "responses" | "messages",
  configuration: BindingRuntime,
): Wire {
  if (body.previous_response_id || body.background || body.truncation === "auto")
    throw new KodoError("UNSUPPORTED", "此网关要求完整历史，不支持远端响应状态或自动截断。");
  const messages: Wire[] = [];
  if (kind === "responses") {
    if (body.instructions) messages.push({ role: "system", content: text(body.instructions) });
    const input =
      typeof body.input === "string" ? [{ role: "user", content: body.input }] : body.input;
    if (!Array.isArray(input)) throw new KodoError("INVALID_INPUT", "Responses input 无效。");
    for (const item of input) {
      if (item.type === "function_call")
        messages.push({
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: item.call_id,
              type: "function",
              function: { name: item.name, arguments: item.arguments },
            },
          ],
        });
      else if (item.type === "function_call_output")
        messages.push({ role: "tool", tool_call_id: item.call_id, content: text(item.output) });
      else if (
        (!item.type || item.type === "message") &&
        ["user", "assistant", "system", "developer"].includes(item.role)
      )
        messages.push({ role: item.role, content: text(item.content) });
      else
        throw new KodoError(
          "UNSUPPORTED",
          "此网关不支持 Responses 的推理状态、托管工具或自定义工具类型。",
        );
    }
  } else {
    if (body.system) messages.push({ role: "system", content: text(body.system) });
    if (!Array.isArray(body.messages)) throw new KodoError("INVALID_INPUT", "Messages 历史无效。");
    for (const m of body.messages) {
      if (!["user", "assistant", "system", "developer"].includes(m.role))
        throw new KodoError(
          "INVALID_INPUT",
          `消息角色无效：${typeof m.role === "string" ? m.role.slice(0, 30) : typeof m.role}。`,
        );
      if (typeof m.content === "string") {
        messages.push({ role: m.role, content: m.content });
        continue;
      }
      if (!Array.isArray(m.content)) throw new KodoError("INVALID_INPUT", "消息内容无效。");
      const content: string[] = [],
        calls: Wire[] = [],
        results: Wire[] = [];
      for (const block of m.content) {
        if (block.type === "text") content.push(text([block]));
        else if (block.type === "tool_use")
          calls.push({
            id: block.id,
            type: "function",
            function: { name: block.name, arguments: JSON.stringify(block.input) },
          });
        else if (block.type === "tool_result" && !block.is_error)
          results.push({
            role: "tool",
            tool_call_id: block.tool_use_id,
            content: typeof block.content === "string" ? block.content : text(block.content ?? []),
          });
        else throw new KodoError("UNSUPPORTED", "该转换不支持图像、签名思考或服务器工具块。");
      }
      if (results.length) messages.push(...results);
      if (content.length || calls.length)
        messages.push({
          role: m.role,
          content: content.join(""),
          ...(calls.length ? { tool_calls: calls } : {}),
        });
    }
  }
  if (body.tools !== undefined && !Array.isArray(body.tools))
    throw new KodoError("INVALID_INPUT", "工具列表无效。");
  const tools = (body.tools ?? []).map((tool: Wire) => {
    if (
      (kind === "responses" && tool.type !== "function") ||
      (kind === "messages" && tool.type && tool.type !== "custom")
    )
      throw new KodoError("UNSUPPORTED", "该转换仅支持 JSON Schema 函数工具。");
    if (!tool.name || !(tool.parameters ?? tool.input_schema))
      throw new KodoError("INVALID_INPUT", "工具定义无效。");
    return {
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters ?? tool.input_schema,
        ...(tool.strict !== undefined ? { strict: tool.strict } : {}),
      },
    };
  });
  let choice = body.tool_choice;
  if (kind === "messages" && choice)
    choice =
      choice.type === "tool"
        ? { type: "function", function: { name: choice.name } }
        : choice.type === "any"
          ? "required"
          : choice.type;
  else if (choice?.type === "function")
    choice = { type: "function", function: { name: choice.name } };
  const effort =
    body.reasoning?.effort ?? body.output_config?.effort ?? configuration.binding?.reasoning;
  if (
    body.thinking?.type === "enabled" ||
    body.reasoning?.summary ||
    (body.text?.format && body.text.format.type !== "text")
  )
    throw new KodoError("UNSUPPORTED", "此转换未验证 token budget、思考摘要或结构化输出。");
  const explicit = effort
    ? configuration.modelParameters?.thinkingLevelMap?.[effort as "high"]
    : undefined;
  if (explicit === null) throw new KodoError("UNSUPPORTED", "此档位在模型映射中已禁用。");
  const mapped = effort ? (explicit ?? effort) : undefined;
  if (effort && !effortValues(configuration.modelParameters ?? {})?.includes(mapped))
    throw new KodoError("UNSUPPORTED", "所选模型未声明网关请求的思考档位。");
  return {
    model: configuration.model,
    messages,
    ...(tools.length ? { tools } : {}),
    ...(choice ? { tool_choice: choice } : {}),
    ...(mapped ? { reasoning_effort: mapped } : {}),
    ...(body.max_output_tokens || body.max_tokens
      ? { max_completion_tokens: body.max_output_tokens ?? body.max_tokens }
      : {}),
    ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
    ...(body.top_p !== undefined ? { top_p: body.top_p } : {}),
    ...(body.stop_sequences ? { stop: body.stop_sequences } : {}),
    stream: Boolean(body.stream),
    ...(body.stream ? { stream_options: { include_usage: true } } : {}),
  };
}

export class Gateway {
  private server?: Server;
  private starting?: Promise<void>;
  private baseUrl = "";
  private closed = false;
  readonly failures: { bindingId?: string; message: string }[] = [];
  private routes = new Map<
    string,
    { configuration: BindingRuntime; key: string | null; token: string }
  >();
  private active = new Set<AbortController>();
  constructor(private fetcher: typeof fetch = fetch) {}
  async route(configuration: BindingRuntime, key: string | null) {
    if (this.closed) throw new KodoError("UNAVAILABLE", "网关已关闭。");
    const id = `${configuration.id}:${configuration.revision}`;
    if (!this.starting) this.starting = this.start();
    await this.starting;
    if (this.closed) throw new KodoError("UNAVAILABLE", "网关已关闭。");
    let route = this.routes.get(id);
    if (!route) {
      route = { configuration, key, token: randomUUID() };
      this.routes.set(id, route);
    }
    return { baseUrl: `${this.baseUrl}/${encodeURIComponent(id)}/v1`, token: route.token };
  }
  private async start() {
    this.server = createServer((req, res) => {
      void (async () => {
        const abort = new AbortController();
        let gemini = false;
        this.active.add(abort);
        res.on("close", () => {
          if (!res.writableEnded) abort.abort();
        });
        try {
          const url = new URL(req.url ?? "/", "http://127.0.0.1"),
            match = /^\/([^/]+)\/v1\/(responses|messages)$/.exec(url.pathname),
            geminiMatch =
              /^\/([^/]+)\/(?:v1beta|v1)\/models(?:\/([^/:]+)(?::(generateContent|streamGenerateContent|countTokens))?)?$/.exec(
                url.pathname,
              );
          gemini = Boolean(geminiMatch);
          const route =
            match || geminiMatch
              ? this.routes.get(decodeURIComponent((match ?? geminiMatch)![1]!))
              : undefined;
          if (!match && !geminiMatch)
            throw new KodoError("UNSUPPORTED", "网关没有此下游协议路径。");
          if (
            !route ||
            (req.headers.authorization !== `Bearer ${route.token}` &&
              req.headers["x-api-key"] !== route.token &&
              req.headers["x-goog-api-key"] !== route.token &&
              url.searchParams.get("key") !== route.token)
          )
            throw new KodoError("UNAUTHORIZED", "网关认证失败。");
          if (geminiMatch) {
            if (route.configuration.binding?.harnessId !== "gemini")
              throw new KodoError("UNSUPPORTED", "该绑定未启用 Gemini 协议路径。");
            const model = geminiMatch[2] ? decodeURIComponent(geminiMatch[2]) : null;
            if (model && model !== route.configuration.model)
              throw new KodoError("UNSUPPORTED", "Gemini 请求模型与固定绑定不一致。");
            if (req.method === "GET" && !geminiMatch[3]) {
              res.writeHead(200, { "content-type": "application/json" });
              res.end(
                JSON.stringify(
                  model
                    ? geminiModel(route.configuration)
                    : { models: [geminiModel(route.configuration)] },
                ),
              );
              return;
            }
            if (req.method !== "POST" || !model || !geminiMatch[3])
              throw new KodoError("UNSUPPORTED", "Gemini 请求方法或路径不受支持。");
            if (geminiMatch[3] === "countTokens")
              throw new KodoError(
                "UNSUPPORTED",
                "Chat 上游没有精确 countTokens 接口，不能伪造 token 数。",
              );
          } else if (req.method !== "POST") {
            throw new KodoError("UNSUPPORTED", "该网关请求方法不受支持。");
          }
          if (
            match &&
            route.configuration.binding &&
            match[2] !==
              (route.configuration.binding.harnessId === "codex" ? "responses" : "messages")
          )
            throw new KodoError("UNSUPPORTED", "该绑定未启用此下游协议。");
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 8 * 1024 * 1024) throw new KodoError("INVALID_INPUT", "网关请求过大。");
            chunks.push(chunk);
          }
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8")),
            kind = match?.[2] as "responses" | "messages" | undefined,
            chat = gemini
              ? geminiToChat(body, route.configuration, geminiMatch![3] === "streamGenerateContent")
              : toChat(body, kind!, route.configuration);
          const upstream = await this.fetcher(
            `${route.configuration.baseUrl!.replace(/\/$/, "")}/chat/completions`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(route.key ? { Authorization: `Bearer ${route.key}` } : {}),
              },
              body: JSON.stringify(chat),
              redirect: "error",
              signal: abort.signal,
            },
          );
          if (!upstream.ok) {
            await upstream.body?.cancel();
            throw new KodoError("UNAVAILABLE", `上游返回 HTTP ${upstream.status}，未自动重发。`);
          }
          if (gemini)
            await geminiFromChat(
              upstream,
              res,
              route.configuration,
              geminiMatch![3] === "streamGenerateContent",
            );
          else await translate(upstream, res, kind!, body, route.configuration);
        } catch (error) {
          if (!res.destroyed && !res.writableEnded) {
            const message =
              error instanceof KodoError ? error.message : "网关转换失败，结果未确认；未自动重发。";
            this.failures.push({ message });
            if (this.failures.length > 50) this.failures.shift();
            if (res.headersSent)
              if (gemini) res.destroy();
              else
                res.end(
                  `event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "gateway_error", message } })}\n\n`,
                );
            else {
              res.writeHead(
                error instanceof KodoError && ["UNSUPPORTED", "INVALID_INPUT"].includes(error.code)
                  ? 400
                  : error instanceof KodoError && error.code === "UNAUTHORIZED"
                    ? 401
                    : 422,
                { "Content-Type": "application/json", "x-should-retry": "false" },
              );
              res.end(
                JSON.stringify({
                  error: gemini
                    ? { code: res.statusCode, status: "FAILED_PRECONDITION", message }
                    : { type: "gateway_error", message },
                }),
              );
            }
          }
        } finally {
          abort.abort();
          this.active.delete(abort);
        }
      })();
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(0, "127.0.0.1", () => resolve());
    });
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("网关地址不可用。");
    this.baseUrl = `http://127.0.0.1:${address.port}`;
  }
  async close() {
    this.closed = true;
    await this.starting?.catch(() => {});
    for (const abort of this.active) abort.abort();
    this.routes.clear();
    if (this.server) {
      this.server.closeAllConnections();
      await new Promise<void>((r) => this.server!.close(() => r()));
    }
  }
}

async function translate(
  upstream: Response,
  res: ServerResponse,
  kind: "responses" | "messages",
  request: Wire,
  configuration: BindingRuntime,
) {
  const id = `${kind === "responses" ? "resp" : "msg"}_${randomUUID()}`,
    messageId = `msg_${randomUUID()}`;
  let sequence = 0,
    content = "",
    usage: Wire | undefined,
    finish: string | undefined,
    textStarted = false;
  const calls = new Map<number, Wire>();
  const event = (type: string, payload: Wire) =>
    res.write(
      `event: ${type}\ndata: ${JSON.stringify({ type, ...(kind === "responses" ? { sequence_number: sequence++ } : {}), ...payload })}\n\n`,
    );
  const base = {
    id,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    model: configuration.model,
    output: [],
  };
  if (request.stream) {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
    if (kind === "responses")
      event("response.created", { response: { ...base, status: "in_progress", usage: null } });
    else
      event("message_start", {
        message: {
          id,
          type: "message",
          role: "assistant",
          model: configuration.model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      });
  }
  const delta = (chunk: Wire) => {
    if (chunk.usage) usage = chunk.usage;
    const choice = chunk.choices?.[0];
    if (!choice) return;
    finish = choice.finish_reason ?? finish;
    const d = choice.delta ?? choice.message ?? {};
    if (typeof d.content === "string" && d.content) {
      if (request.stream && !textStarted) {
        if (kind === "responses") {
          event("response.output_item.added", {
            output_index: 0,
            item: {
              id: messageId,
              type: "message",
              role: "assistant",
              content: [],
              status: "in_progress",
            },
          });
          event("response.content_part.added", {
            output_index: 0,
            item_id: messageId,
            content_index: 0,
            part: { type: "output_text", text: "", annotations: [] },
          });
        } else
          event("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
      }
      textStarted = true;
      content += d.content;
      if (request.stream) {
        if (kind === "responses")
          event("response.output_text.delta", {
            item_id: messageId,
            output_index: 0,
            content_index: 0,
            delta: d.content,
          });
        else
          event("content_block_delta", {
            index: 0,
            delta: { type: "text_delta", text: d.content },
          });
      }
    }
    for (const call of d.tool_calls ?? []) {
      const index = call.index ?? calls.size,
        old = calls.get(index) ?? { id: "", name: "", arguments: "", fragments: [] };
      if (call.id) old.id = call.id;
      if (call.function?.name) old.name += call.function.name;
      if (call.function?.arguments) {
        old.arguments += call.function.arguments;
        old.fragments.push(call.function.arguments);
      }
      calls.set(index, old);
    }
    if (d.refusal || d.function_call)
      throw new KodoError("UNSUPPORTED", "上游返回此路径未支持的内容类型。");
  };
  if (request.stream) {
    if (!upstream.headers.get("content-type")?.includes("text/event-stream") || !upstream.body)
      throw new Error("上游未返回 SSE。");
    let buffer = "";
    const decoder = new TextDecoder();
    for await (const bytes of upstream.body) {
      buffer += decoder.decode(bytes, { stream: true });
      if (buffer.length > 8 * 1024 * 1024 || content.length > 16 * 1024 * 1024)
        throw new Error("上游事件过大。");
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, boundary.index).replace(/\r/g, "");
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = frame
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart())
          .join("\n");
        if (data && data !== "[DONE]") {
          const value = JSON.parse(data);
          if (value.error) throw new Error("上游流错误。");
          delta(value);
        }
      }
    }
    if (buffer.trim() && buffer.trim() !== "data: [DONE]") throw new Error("上游事件未完整结束。");
  } else delta(await upstream.json());
  if (
    !usage ||
    typeof usage.prompt_tokens !== "number" ||
    typeof usage.completion_tokens !== "number"
  )
    throw new KodoError("UNAVAILABLE", "上游缺少可核对的用量，网关未伪造零用量或成功终态。");
  if (!finish || !["stop", "length", "tool_calls"].includes(finish))
    throw new KodoError("UNSUPPORTED", "上游结束原因未被该转换路径支持。");
  const normalized = [...calls.values()];
  for (const c of normalized) {
    if (!c.id || !c.name || !c.arguments) throw new Error("上游工具调用不完整。");
    const value = JSON.parse(c.arguments);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("上游工具参数不是对象。");
  }
  const responseUsage = {
    input_tokens: usage.prompt_tokens,
    output_tokens: usage.completion_tokens,
    total_tokens: usage.total_tokens ?? usage.prompt_tokens + usage.completion_tokens,
    ...(usage.prompt_tokens_details ? { input_tokens_details: usage.prompt_tokens_details } : {}),
    ...(usage.completion_tokens_details
      ? { output_tokens_details: usage.completion_tokens_details }
      : {}),
  };
  const textItem = {
    id: messageId,
    type: "message",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: content, annotations: [] }],
  };
  const output = [
    ...(content ? [textItem] : []),
    ...normalized.map((c) => ({
      id: `fc_${c.id}`,
      type: "function_call",
      call_id: c.id,
      name: c.name,
      arguments: c.arguments,
      status: "completed",
    })),
  ];
  if (request.stream) {
    if (textStarted) {
      if (kind === "responses") {
        event("response.output_text.done", {
          item_id: messageId,
          output_index: 0,
          content_index: 0,
          text: content,
        });
        event("response.content_part.done", {
          item_id: messageId,
          output_index: 0,
          content_index: 0,
          part: textItem.content[0],
        });
        event("response.output_item.done", { output_index: 0, item: textItem });
      } else event("content_block_stop", { index: 0 });
    }
    for (let i = 0; i < normalized.length; i++) {
      const c = normalized[i]!,
        index = i + (content ? 1 : 0),
        item = output[index]!;
      JSON.parse(c.arguments);
      if (kind === "responses") {
        event("response.output_item.added", {
          output_index: index,
          item: { ...item, arguments: "", status: "in_progress" },
        });
        for (const part of c.fragments)
          event("response.function_call_arguments.delta", {
            item_id: item.id,
            output_index: index,
            delta: part,
          });
        event("response.function_call_arguments.done", {
          item_id: item.id,
          output_index: index,
          arguments: c.arguments,
          name: c.name,
        });
        event("response.output_item.done", { output_index: index, item });
      } else {
        event("content_block_start", {
          index,
          content_block: { type: "tool_use", id: c.id, name: c.name, input: {} },
        });
        for (const part of c.fragments)
          event("content_block_delta", {
            index,
            delta: { type: "input_json_delta", partial_json: part },
          });
        event("content_block_stop", { index });
      }
    }
    if (kind === "responses")
      event(finish === "length" ? "response.incomplete" : "response.completed", {
        response: {
          ...base,
          status: finish === "length" ? "incomplete" : "completed",
          output,
          usage: responseUsage,
          ...(finish === "length" ? { incomplete_details: { reason: "max_output_tokens" } } : {}),
        },
      });
    else {
      event("message_delta", {
        delta: {
          stop_reason: normalized.length
            ? "tool_use"
            : finish === "length"
              ? "max_tokens"
              : "end_turn",
          stop_sequence: null,
        },
        usage: { input_tokens: usage.prompt_tokens, output_tokens: usage.completion_tokens },
      });
      event("message_stop", {});
    }
    res.end();
  } else {
    const value =
      kind === "responses"
        ? {
            ...base,
            status: finish === "length" ? "incomplete" : "completed",
            output,
            usage: responseUsage,
          }
        : {
            id,
            type: "message",
            role: "assistant",
            model: configuration.model,
            content: [
              ...(content ? [{ type: "text", text: content }] : []),
              ...normalized.map((c) => ({
                type: "tool_use",
                id: c.id,
                name: c.name,
                input: JSON.parse(c.arguments),
              })),
            ],
            stop_reason: normalized.length
              ? "tool_use"
              : finish === "length"
                ? "max_tokens"
                : "end_turn",
            stop_sequence: null,
            usage: { input_tokens: usage.prompt_tokens, output_tokens: usage.completion_tokens },
          };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(value));
  }
}
