import { test } from "node:test";
import assert from "node:assert/strict";
import type { BindingRuntime } from "@kodo/protocol";
import { Gateway } from "../src/providers/gateway.js";
import { geminiToChat } from "../src/providers/gemini-chat.js";

const configuration: BindingRuntime = {
  id: "synthetic-gemini-gateway",
  revision: 1,
  name: "Synthetic bound model",
  provider: "synthetic",
  model: "example",
  protocol: "openai-completions",
  baseUrl: "http://127.0.0.1:1/v1",
  credentialRef: null,
  binding: { harnessId: "gemini", reasoning: null } as BindingRuntime["binding"],
  modelParameters: {
    contextWindow: 100000,
    maxOutputTokens: 1000,
    reasoning: true,
    reasoningOptions: [{ type: "effort", values: ["low", "high"] }],
  },
};
const usage = { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 };
const input = {
  systemInstruction: { parts: [{ text: "Be exact" }] },
  contents: [{ role: "user", parts: [{ text: "Hello" }] }],
  generationConfig: { maxOutputTokens: 50, thinkingConfig: { thinkingLevel: "HIGH" } },
};

test("Gemini request maps text, tool history, schema and declared effort to Chat", () => {
  const result = geminiToChat(
    {
      ...input,
      contents: [
        { role: "user", parts: [{ text: "Read" }] },
        {
          role: "model",
          parts: [{ functionCall: { id: "call-1", name: "read", args: { p: 1 } } }],
        },
        {
          role: "user",
          parts: [{ functionResponse: { name: "read", response: { value: "ok" } } }],
        },
      ],
      tools: [
        {
          functionDeclarations: [
            {
              name: "read",
              parameters: { type: "OBJECT", properties: { p: { type: "INTEGER" } } },
            },
          ],
        },
      ],
    },
    configuration,
    true,
  );
  assert.equal(result.model, "example");
  assert.equal(result.messages[0].role, "system");
  assert.equal(result.messages[2].tool_calls[0].id, "call-1");
  assert.equal(result.messages[3].tool_call_id, "call-1");
  assert.equal(result.tools[0].function.parameters.properties.p.type, "integer");
  assert.equal(result.reasoning_effort, "high");
  assert.equal(result.stream_options.include_usage, true);
});

test("Gemini bridge rejects modalities and settings that cannot preserve semantics", () => {
  for (const changed of [
    {
      contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/png", data: "AA" } }] }],
    },
    { generationConfig: { thinkingConfig: { thinkingBudget: 1024 } } },
    { tools: [{ googleSearch: {} }] },
    { safetySettings: [{ category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" }] },
    { generationConfig: { responseMimeType: "application/json" } },
  ])
    assert.throws(() => geminiToChat({ ...input, ...changed }, configuration, false));
});

test("Gemini model listing, generation, streaming and countTokens enforce route and real usage", async () => {
  const seen: unknown[] = [];
  const gateway = new Gateway(async (_url, init) => {
    const body = JSON.parse(String(init!.body));
    seen.push(body);
    if (body.stream)
      return new Response(
        [
          `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello" } }] })}`,
          `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}`,
          `data: ${JSON.stringify({ choices: [], usage })}`,
          "data: [DONE]",
          "",
        ].join("\n\n"),
        { headers: { "content-type": "text/event-stream" } },
      );
    return Response.json({
      choices: [{ message: { content: "Hello" }, finish_reason: "stop" }],
      usage,
    });
  });
  try {
    const route = await gateway.route(configuration, "SYNTHETIC_UPSTREAM_KEY");
    const base = route.baseUrl.replace(/\/v1$/, "");
    const headers = { "x-goog-api-key": route.token };
    assert.equal((await fetch(`${base}/v1beta/models`)).status, 401);
    const models = await (await fetch(`${base}/v1beta/models`, { headers })).json();
    assert.equal(models.models[0].name, "models/example");
    assert.equal(models.models[0].inputTokenLimit, 100000);
    assert.equal(
      (
        await fetch(`${base}/v1beta/models/wrong:generateContent`, {
          method: "POST",
          headers,
          body: JSON.stringify(input),
        })
      ).status,
      400,
    );
    const count = await fetch(`${base}/v1beta/models/example:countTokens`, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    });
    assert.equal(count.status, 400);
    assert.match(await count.text(), /不能伪造 token 数/);
    const plain = await fetch(`${base}/v1beta/models/example:generateContent`, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    });
    const reply = await plain.json();
    assert.equal(reply.candidates[0].content.parts[0].text, "Hello");
    assert.equal(reply.usageMetadata.totalTokenCount, 18);
    const streamed = await fetch(`${base}/v1beta/models/example:streamGenerateContent?alt=sse`, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    });
    const events = await streamed.text();
    assert.match(events, /Hello/);
    assert.match(events, /"finishReason":"STOP"/);
    assert.match(events, /"totalTokenCount":18/);
    assert.equal(seen.length, 2);
    assert.equal(JSON.stringify(seen).includes("SYNTHETIC_UPSTREAM_KEY"), false);
  } finally {
    await gateway.close();
  }
});

test("Gemini upstream errors and missing usage never become a successful candidate", async () => {
  for (const response of [
    new Response("private upstream message", { status: 429 }),
    Response.json({ choices: [{ message: { content: "partial" }, finish_reason: "stop" }] }),
  ]) {
    let calls = 0;
    const gateway = new Gateway(async () => {
      calls++;
      return response;
    });
    try {
      const route = await gateway.route(configuration, null);
      const result = await fetch(
        `${route.baseUrl.replace(/\/v1$/, "")}/v1beta/models/example:generateContent`,
        {
          method: "POST",
          headers: { "x-goog-api-key": route.token },
          body: JSON.stringify(input),
        },
      );
      assert.equal(result.status, 422);
      assert.ok(!(await result.text()).includes("private upstream message"));
      assert.equal(calls, 1);
    } finally {
      await gateway.close();
    }
  }
});
