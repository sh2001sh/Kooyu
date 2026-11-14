import { test } from "node:test";
import assert from "node:assert/strict";
import type { BindingRuntime } from "@kodo/protocol";
import { Gateway, toChat } from "../src/providers/gateway.js";

const configuration: BindingRuntime = {
  id: "synthetic-gateway",
  name: "Isolated contract fixture",
  provider: "synthetic",
  revision: 1,
  model: "example",
  protocol: "openai-completions",
  baseUrl: "http://127.0.0.1:1/v1",
  credentialRef: null,
  modelParameters: {
    reasoning: true,
    reasoningOptions: [{ type: "effort", values: ["low", "high"] }],
    thinkingLevelMap: { medium: null, high: "high" },
  },
};
const usage = { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 };
function stream(chunks: unknown[], separator = "\n\n") {
  const body =
    chunks.map((data) => `data: ${JSON.stringify(data)}${separator}`).join("") +
    `data: [DONE]${separator}`;
  // Bytewise fragments exercise CRLF, UTF-8 and JSON token boundaries.
  const bytes = new TextEncoder().encode(body);
  return new Response(
    new ReadableStream({
      start(c) {
        for (let i = 0; i < bytes.length; i += 5) c.enqueue(bytes.slice(i, i + 5));
        c.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}
const input = {
  stream: true,
  input: [{ role: "user", content: "你好" }],
  max_output_tokens: 100,
  reasoning: { effort: "high" },
};

test("Responses and Messages convert full text/tool history with stable call IDs and declared effort", () => {
  const r = toChat(
    {
      ...input,
      input: [
        { role: "user", content: [{ type: "input_text", text: "Hello" }] },
        { type: "function_call", call_id: "call-1", name: "read", arguments: '{"path":"a"}' },
        { type: "function_call_output", call_id: "call-1", output: "found" },
      ],
      tools: [{ type: "function", name: "read", parameters: { type: "object" } }],
    },
    "responses",
    configuration,
  );
  assert.equal(r.model, "example");
  assert.equal(r.reasoning_effort, "high");
  assert.equal(r.messages[1].tool_calls[0].id, "call-1");
  assert.equal(r.messages[2].tool_call_id, "call-1");
  const m = toChat(
    {
      messages: [
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "tool-2", name: "read", input: { p: 2 } }],
        },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "tool-2", content: "ok" }] },
      ],
      max_tokens: 100,
      output_config: { effort: "low" },
    },
    "messages",
    configuration,
  );
  assert.equal(m.messages[0].tool_calls[0].function.arguments, '{"p":2}');
  assert.equal(m.messages[1].tool_call_id, "tool-2");
  assert.equal(m.reasoning_effort, "low");
});

test("unsupported modalities, hosted state, error tool results and disabled effort are rejected explicitly", () => {
  for (const body of [
    { ...input, previous_response_id: "old" },
    { ...input, tools: [{ type: "web_search" }] },
    { ...input, input: [{ type: "reasoning", encrypted_content: "x" }] },
    { ...input, reasoning: { effort: "medium" } },
  ])
    assert.throws(() => toChat(body, "responses", configuration));
  assert.throws(
    () =>
      toChat(
        {
          messages: [
            {
              role: "user",
              content: [
                { type: "tool_result", tool_use_id: "x", is_error: true, content: "failed" },
              ],
            },
          ],
        },
        "messages",
        configuration,
      ),
    /不支持/,
  );
});

test("SSE CRLF text, usage and tool argument fragments produce complete native Responses events", async () => {
  let upstreamBody: any, upstreamAuth: string | undefined;
  const g = new Gateway(async (_url, init) => {
    upstreamBody = JSON.parse(String(init!.body));
    upstreamAuth = (init!.headers as Record<string, string>).Authorization;
    return stream(
      [
        { choices: [{ delta: { content: "你好" } }] },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: "native-call", function: { name: "read", arguments: '{"p":' } },
                ],
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: { tool_calls: [{ index: 0, function: { arguments: "1}" } }] },
              finish_reason: "tool_calls",
            },
          ],
        },
        { choices: [], usage },
      ],
      "\r\n\r\n",
    );
  });
  try {
    const r = await g.route(configuration, "SYNTHETIC_UPSTREAM_SECRET");
    const result = await fetch(`${r.baseUrl}/responses`, {
      method: "POST",
      headers: { authorization: `Bearer ${r.token}` },
      body: JSON.stringify(input),
    });
    const data = await result.text();
    assert.equal(result.status, 200);
    assert.match(data, /response.output_text.delta/);
    assert.match(data, /你好/);
    assert.match(data, /response.function_call_arguments.delta/);
    assert.match(data, /native-call/);
    assert.match(data, /"input_tokens":11/);
    assert.match(data, /response.completed/);
    assert.ok(!data.includes("SYNTHETIC_UPSTREAM_SECRET"));
    assert.equal(upstreamBody.reasoning_effort, "high");
    assert.equal(upstreamAuth, "Bearer SYNTHETIC_UPSTREAM_SECRET");
  } finally {
    await g.close();
  }
});

test("length termination stays incomplete and a missing terminal or usage never becomes success", async () => {
  for (const mode of ["length", "no-terminal", "no-usage"]) {
    const g = new Gateway(async () =>
      stream([
        {
          choices: [
            {
              delta: { content: "Partial" },
              ...(mode !== "no-terminal"
                ? { finish_reason: mode === "length" ? "length" : "stop" }
                : {}),
            },
          ],
          ...(mode !== "no-usage" ? { usage } : {}),
        },
      ]),
    );
    try {
      const r = await g.route(configuration, null),
        res = await fetch(`${r.baseUrl}/responses`, {
          method: "POST",
          headers: { authorization: `Bearer ${r.token}` },
          body: JSON.stringify(input),
        });
      const text = await res.text();
      assert.ok(!text.includes("event: response.completed\n"));
      assert.match(text, mode === "length" ? /event: response.incomplete/ : /event: error/);
    } finally {
      await g.close();
    }
  }
});

test("gateway auth and upstream failure make no extra attempts; Messages JSON usage is preserved", async () => {
  let attempts = 0;
  const g = new Gateway(async () => {
    attempts++;
    return attempts === 1
      ? new Response("private diagnostic", { status: 429 })
      : Response.json({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage });
  });
  try {
    const r = await g.route(configuration, null),
      body = JSON.stringify({ messages: [{ role: "user", content: "hi" }], max_tokens: 100 });
    assert.equal((await fetch(`${r.baseUrl}/messages`, { method: "POST", body })).status, 401);
    assert.equal(attempts, 0);
    const failed = await fetch(`${r.baseUrl}/messages`, {
      method: "POST",
      headers: { "x-api-key": r.token },
      body,
    });
    assert.equal(failed.status, 422);
    assert.equal(failed.headers.get("x-should-retry"), "false");
    assert.ok(!(await failed.text()).includes("private diagnostic"));
    assert.equal(attempts, 1);
    const value: any = await (
      await fetch(`${r.baseUrl}/messages`, {
        method: "POST",
        headers: { "x-api-key": r.token },
        body,
      })
    ).json();
    assert.equal(value.content[0].text, "ok");
    assert.deepEqual(value.usage, { input_tokens: 11, output_tokens: 7 });
    assert.equal(attempts, 2);
  } finally {
    await g.close();
  }
});

test("disconnect aborts the single upstream request; Host close aborts other in-flight requests", async () => {
  let signal: AbortSignal | undefined;
  const g = new Gateway(async (_url, init) => {
    signal = init!.signal!;
    return new Promise((_resolve, reject) => {
      signal!.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
    });
  });
  try {
    const r = await g.route(configuration, null),
      controller = new AbortController();
    const pending = fetch(`${r.baseUrl}/responses`, {
      method: "POST",
      headers: { authorization: `Bearer ${r.token}` },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    void pending.catch(() => {});
    while (!signal) await new Promise((r) => setTimeout(r, 1));
    controller.abort();
    await assert.rejects(pending);
    for (let i = 0; i < 100 && !signal.aborted; i++) await new Promise((r) => setTimeout(r, 5));
    assert.equal(signal.aborted, true);
  } finally {
    await g.close();
  }
});
