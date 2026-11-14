import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import { KodoError, type BindingRuntime } from "@kodo/protocol";
import type { Wire } from "../harnesses/adapter.js";
import { effortValues } from "./catalog.js";

function plain(parts: Wire[]): string {
  if (!Array.isArray(parts)) throw new KodoError("INVALID_INPUT", "Gemini 内容块无效。");
  return parts
    .map((part) => {
      if (typeof part.text !== "string" || part.thought || part.thoughtSignature)
        throw new KodoError("UNSUPPORTED", "Gemini 网关不支持图片、签名思考或非文本内容块。");
      return part.text;
    })
    .join("");
}

function schema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(schema);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key === "type" && typeof item === "string" ? item.toLowerCase() : schema(item),
    ]),
  );
}

export function geminiToChat(body: Wire, configuration: BindingRuntime, stream: boolean): Wire {
  if (!Array.isArray(body.contents) || !body.contents.length)
    throw new KodoError("INVALID_INPUT", "Gemini 请求缺少对话内容。");
  if (body.cachedContent || body.safetySettings?.length)
    throw new KodoError("UNSUPPORTED", "Gemini 缓存和安全设置不能由此网关等价转换。");
  const config = body.generationConfig ?? {};
  if (
    config.responseSchema ||
    config.responseJsonSchema ||
    (config.responseMimeType && config.responseMimeType !== "text/plain") ||
    (config.candidateCount && config.candidateCount !== 1)
  )
    throw new KodoError("UNSUPPORTED", "Gemini 结构化输出或多候选请求尚未转换。");
  const messages: Wire[] = [];
  if (body.systemInstruction)
    messages.push({ role: "system", content: plain(body.systemInstruction.parts) });
  const pending = new Map<string, string[]>();
  for (const [contentIndex, content] of body.contents.entries()) {
    const role = content.role === "model" ? "assistant" : content.role;
    if (role !== "assistant" && role !== "user")
      throw new KodoError("UNSUPPORTED", "Gemini 消息角色无法转换。");
    if (!Array.isArray(content.parts))
      throw new KodoError("INVALID_INPUT", "Gemini 消息缺少 parts。");
    let text = "";
    const calls: Wire[] = [];
    const results: Wire[] = [];
    for (const [partIndex, part] of content.parts.entries()) {
      if (part.thought) throw new KodoError("UNSUPPORTED", "思考内容无法跨协议保留。");
      if (typeof part.text === "string") {
        text += part.text;
      } else if (role === "assistant" && part.functionCall) {
        const call = part.functionCall;
        if (
          typeof call.name !== "string" ||
          !call.name ||
          !call.args ||
          typeof call.args !== "object"
        )
          throw new KodoError("INVALID_INPUT", "Gemini 函数调用无效。");
        const id =
          typeof call.id === "string" && call.id ? call.id : `call_${contentIndex}_${partIndex}`;
        pending.set(call.name, [...(pending.get(call.name) ?? []), id]);
        calls.push({
          id,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.args) },
        });
      } else if (role === "user" && part.functionResponse) {
        const response = part.functionResponse;
        const queue = pending.get(response.name) ?? [];
        const id = response.id ?? queue.shift();
        if (!id || !response.response)
          throw new KodoError("UNSUPPORTED", "Gemini 工具结果没有可对应的函数调用。");
        results.push({
          role: "tool",
          tool_call_id: id,
          content: JSON.stringify(response.response),
        });
      } else {
        throw new KodoError("UNSUPPORTED", "Gemini 网关仅支持文本与函数工具内容。");
      }
    }
    messages.push(...results);
    if (text || calls.length)
      messages.push({
        role,
        content: text || null,
        ...(calls.length ? { tool_calls: calls } : {}),
      });
  }
  const tools: Wire[] = [];
  for (const tool of body.tools ?? []) {
    if (!Array.isArray(tool.functionDeclarations))
      throw new KodoError("UNSUPPORTED", "Gemini 搜索、代码执行和托管工具尚未转换。");
    for (const declaration of tool.functionDeclarations) {
      const parameters = declaration.parametersJsonSchema ?? declaration.parameters;
      if (!declaration.name || !parameters)
        throw new KodoError("INVALID_INPUT", "Gemini 函数声明缺少名称或参数结构。");
      tools.push({
        type: "function",
        function: {
          name: declaration.name,
          description: declaration.description,
          parameters: schema(parameters),
        },
      });
    }
  }
  const thinking = config.thinkingConfig;
  if (thinking?.thinkingBudget !== undefined && thinking.thinkingBudget !== 0)
    throw new KodoError(
      "UNSUPPORTED",
      `Gemini token budget ${String(thinking.thinkingBudget)} 不能等价转换为 Chat 档位。`,
    );
  let effort: string | undefined;
  if (thinking?.thinkingLevel) {
    effort = String(thinking.thinkingLevel).toLowerCase();
    const mapped = configuration.modelParameters?.thinkingLevelMap?.[effort as "high"];
    if (mapped === null) throw new KodoError("UNSUPPORTED", "此思考档位已禁用。");
    effort = mapped ?? effort;
    if (!effortValues(configuration.modelParameters ?? {})?.includes(effort))
      throw new KodoError("UNSUPPORTED", "上游模型未声明此思考档位。");
  }
  if (thinking?.thinkingBudget === 0 && configuration.modelParameters?.reasoning !== false)
    throw new KodoError("UNSUPPORTED", "上游未确认可关闭思考。");
  const mode = body.toolConfig?.functionCallingConfig;
  if (body.toolConfig && !mode) throw new KodoError("UNSUPPORTED", "Gemini 工具配置不能等价转换。");
  const toolChoice = mode?.mode === "ANY" ? "required" : mode?.mode === "NONE" ? "none" : undefined;
  if (mode?.allowedFunctionNames?.length)
    throw new KodoError("UNSUPPORTED", "按函数名限制的 Gemini 工具配置尚未转换。");
  return {
    model: configuration.model,
    messages,
    ...(tools.length ? { tools } : {}),
    ...(toolChoice ? { tool_choice: toolChoice } : {}),
    ...(effort ? { reasoning_effort: effort } : {}),
    ...(config.maxOutputTokens ? { max_completion_tokens: config.maxOutputTokens } : {}),
    ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
    ...(config.topP !== undefined ? { top_p: config.topP } : {}),
    ...(config.stopSequences ? { stop: config.stopSequences } : {}),
    stream,
    ...(stream ? { stream_options: { include_usage: true } } : {}),
  };
}

export function geminiModel(configuration: BindingRuntime): Wire {
  return {
    name: `models/${configuration.model}`,
    displayName: configuration.name,
    supportedGenerationMethods: ["generateContent", "streamGenerateContent"],
    ...(configuration.modelParameters?.contextWindow
      ? { inputTokenLimit: configuration.modelParameters.contextWindow }
      : {}),
    ...(configuration.modelParameters?.maxOutputTokens
      ? { outputTokenLimit: configuration.modelParameters.maxOutputTokens }
      : {}),
  };
}

export async function geminiFromChat(
  upstream: Response,
  res: ServerResponse,
  configuration: BindingRuntime,
  stream: boolean,
): Promise<void> {
  const responseId = randomUUID();
  const calls = new Map<number, Wire>();
  let usage: Wire | undefined;
  let finish: string | undefined;
  let output = "";
  const emit = (value: Wire) => res.write(`data: ${JSON.stringify(value)}\n\n`);
  const handle = (chunk: Wire) => {
    if (chunk.usage) usage = chunk.usage;
    const choice = chunk.choices?.[0];
    if (!choice) return;
    finish = choice.finish_reason ?? finish;
    const delta = choice.delta ?? choice.message ?? {};
    if (delta.refusal || delta.function_call)
      throw new KodoError("UNSUPPORTED", "上游返回无法转换的内容类型。");
    if (delta.content) {
      if (typeof delta.content !== "string")
        throw new KodoError("UNSUPPORTED", "上游返回非文本内容。");
      output += delta.content;
      if (stream)
        emit({
          responseId,
          modelVersion: configuration.model,
          candidates: [{ content: { role: "model", parts: [{ text: delta.content }] } }],
        });
    }
    for (const call of delta.tool_calls ?? []) {
      const index = call.index ?? calls.size;
      const old = calls.get(index) ?? { id: "", name: "", arguments: "" };
      if (call.id) old.id = call.id;
      if (call.function?.name) old.name += call.function.name;
      if (call.function?.arguments) old.arguments += call.function.arguments;
      calls.set(index, old);
    }
  };
  if (stream) {
    if (!upstream.headers.get("content-type")?.includes("text/event-stream") || !upstream.body)
      throw new KodoError("UNAVAILABLE", "上游未返回 Chat SSE。");
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const bytes of upstream.body) {
      buffer += decoder.decode(bytes, { stream: true });
      if (buffer.length > 8 * 1024 * 1024 || output.length > 16 * 1024 * 1024)
        throw new KodoError("UNAVAILABLE", "上游流超过网关大小限制。");
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, boundary.index).replace(/\r/g, "");
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data && data !== "[DONE]") {
          const chunk = JSON.parse(data);
          if (chunk.error) throw new KodoError("UNAVAILABLE", "上游流返回错误。");
          handle(chunk);
        }
      }
    }
    if (buffer.trim() && buffer.trim() !== "data: [DONE]")
      throw new KodoError("UNAVAILABLE", "上游流未完整结束。");
  } else handle(await upstream.json());
  if (
    !usage ||
    typeof usage.prompt_tokens !== "number" ||
    typeof usage.completion_tokens !== "number"
  )
    throw new KodoError("UNAVAILABLE", "上游缺少可核对的用量，网关不伪造成功终态。");
  if (!finish || !["stop", "length", "tool_calls"].includes(finish))
    throw new KodoError("UNSUPPORTED", "上游结束原因无法转换。");
  const parts: Wire[] = [];
  if (!stream && output) parts.push({ text: output });
  for (const call of calls.values()) {
    if (!call.id || !call.name || !call.arguments)
      throw new KodoError("UNAVAILABLE", "上游函数调用不完整。");
    const args = JSON.parse(call.arguments);
    if (!args || typeof args !== "object" || Array.isArray(args))
      throw new KodoError("UNSUPPORTED", "上游函数参数不是对象。");
    parts.push({ functionCall: { id: call.id, name: call.name, args } });
  }
  const result = {
    responseId,
    modelVersion: configuration.model,
    candidates: [
      {
        content: { role: "model", parts },
        finishReason: finish === "length" ? "MAX_TOKENS" : "STOP",
      },
    ],
    usageMetadata: {
      promptTokenCount: usage.prompt_tokens,
      candidatesTokenCount: usage.completion_tokens,
      totalTokenCount: usage.total_tokens ?? usage.prompt_tokens + usage.completion_tokens,
    },
  };
  if (stream) {
    emit(result);
    res.end();
  } else {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(result));
  }
}
