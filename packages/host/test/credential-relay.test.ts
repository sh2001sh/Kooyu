import assert from "node:assert/strict";
import { test } from "node:test";
import { CredentialRelay } from "../src/providers/credential-relay.js";
import type { BindingRuntime } from "@kodo/protocol";

// Isolated synthetic wire data. These tests do not claim native model execution.
for (const [protocol, path, base] of [
  ["openai-completions", "chat/completions", "https://synthetic.invalid/v1"],
  ["openai-responses", "responses", "https://synthetic.invalid/v1"],
  ["anthropic-messages", "messages", "https://synthetic.invalid"],
] as const)
  test(`credential relay preserves ${protocol} bytes and authenticates upstream without exposing the key`, async () => {
    const payload =
      '{"model":"synthetic","messages":[{"role":"user","content":"测试"}],"stream":true}';
    let calls = 0;
    const relay = new CredentialRelay(async (url, init) => {
      calls++;
      assert.equal(String(url), `${base}${protocol === "anthropic-messages" ? "/v1" : ""}/${path}`);
      assert.equal(Buffer.from(init!.body as Buffer).toString(), payload);
      const headers = init!.headers as Record<string, string>;
      assert.equal(
        headers[protocol === "anthropic-messages" ? "x-api-key" : "authorization"],
        protocol === "anthropic-messages"
          ? "SYNTHETIC_UPSTREAM_KEY"
          : "Bearer SYNTHETIC_UPSTREAM_KEY",
      );
      assert.equal(
        headers[protocol === "anthropic-messages" ? "authorization" : "x-api-key"],
        undefined,
      );
      assert.equal(init!.redirect, "error");
      return new Response("event: synthetic\ndata: 合约\n\n", {
        headers: { "content-type": "text/event-stream", "x-request-id": "synthetic" },
      });
    });
    try {
      const route = await relay.route(
        { id: "synthetic", revision: 1, protocol, baseUrl: base } as BindingRuntime,
        "SYNTHETIC_UPSTREAM_KEY",
      );
      assert.equal(JSON.stringify(route).includes("SYNTHETIC_UPSTREAM_KEY"), false);
      const r = await fetch(`${route.baseUrl}/${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${route.token}` },
        body: payload,
      });
      assert.equal(r.status, 200);
      assert.equal(r.headers.get("x-request-id"), "synthetic");
      assert.equal(await r.text(), "event: synthetic\ndata: 合约\n\n");
      assert.equal(calls, 1);
    } finally {
      await relay.close();
    }
  });

test("credential relay keeps failed upstream results and never retries an uncertain request", async () => {
  let calls = 0;
  const relay = new CredentialRelay(async () => {
    calls++;
    throw new Error("synthetic transport loss");
  });
  try {
    const route = await relay.route(
      {
        id: "synthetic",
        revision: 1,
        protocol: "openai-responses",
        baseUrl: "https://synthetic.invalid/v1",
      } as BindingRuntime,
      null,
    );
    const r = await fetch(`${route.baseUrl}/responses`, {
      method: "POST",
      headers: { authorization: `Bearer ${route.token}` },
      body: "{}",
    });
    assert.equal(r.status, 422);
    assert.equal(r.headers.get("x-should-retry"), "false");
    assert.equal(calls, 1);
    assert.match(await r.text(), /未自动重发/);
  } finally {
    await relay.close();
  }
});

test("credential relay aborts upstream streaming when the native client disconnects", async () => {
  let cancelled!: () => void;
  const aborted = new Promise<void>((resolve) => {
    cancelled = resolve;
  });
  const relay = new CredentialRelay(async (_url, init) => {
    init!.signal!.addEventListener("abort", cancelled, { once: true });
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data: synthetic\n\n"));
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const route = await relay.route(
      {
        id: "synthetic-cancel",
        revision: 1,
        protocol: "openai-responses",
        baseUrl: "https://synthetic.invalid/v1",
      } as BindingRuntime,
      null,
    );
    const r = await fetch(`${route.baseUrl}/responses`, {
      method: "POST",
      headers: { authorization: `Bearer ${route.token}` },
      body: "{}",
    });
    const reader = r.body!.getReader();
    await reader.read();
    await reader.cancel();
    await Promise.race([
      aborted,
      new Promise<void>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Upstream cancellation missing")), 2000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    await relay.close();
  }
});
