import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { KodoError, type BindingRuntime } from "@kodo/protocol";

/** Same-protocol forwarding for native schemas without environment-key references. */
export class CredentialRelay {
  private server?: Server;
  private starting?: Promise<void>;
  private baseUrl = "";
  private closed = false;
  private routes = new Map<
    string,
    { configuration: BindingRuntime; key: string | null; token: string }
  >();
  private active = new Set<AbortController>();
  constructor(private fetcher: typeof fetch = fetch) {}
  async route(configuration: BindingRuntime, key: string | null) {
    if (this.closed) throw new KodoError("UNAVAILABLE", "凭据中继已关闭。");
    this.starting ??= this.start();
    await this.starting;
    if (this.closed) throw new KodoError("UNAVAILABLE", "凭据中继已关闭。");
    const id = `${configuration.id}:${configuration.revision}`;
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
        this.active.add(abort);
        res.on("close", () => {
          if (!res.writableEnded) abort.abort();
        });
        try {
          const url = new URL(req.url ?? "/", "http://127.0.0.1");
          const match =
            /^\/([^/]+)\/v1\/(chat\/completions|responses|messages(?:\/count_tokens)?)$/.exec(
              url.pathname,
            );
          const route = match ? this.routes.get(decodeURIComponent(match[1]!)) : undefined;
          if (
            !route ||
            (req.headers.authorization !== `Bearer ${route.token}` &&
              req.headers["x-api-key"] !== route.token)
          )
            throw new KodoError("UNAUTHORIZED", "本地凭据中继认证失败。");
          const expected = {
            "openai-completions": "chat/completions",
            "openai-responses": "responses",
            "anthropic-messages": "messages",
          }[route.configuration.protocol as "openai-completions"];
          if (
            req.method !== "POST" ||
            !(
              match![2] === expected ||
              (expected === "messages" && match![2] === "messages/count_tokens")
            )
          )
            throw new KodoError("UNSUPPORTED", "该绑定未启用此原生协议路径。");
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 32 * 1024 * 1024)
              throw new KodoError("INVALID_INPUT", "原生请求超过中继大小限制。");
            chunks.push(chunk);
          }
          let base = route.configuration.baseUrl!.replace(/\/$/, "");
          if (expected === "messages" && !base.endsWith("/v1")) base += "/v1";
          const headers: Record<string, string> = { "content-type": "application/json" };
          for (const name of ["anthropic-version", "anthropic-beta", "accept"])
            if (typeof req.headers[name] === "string") headers[name] = req.headers[name];
          if (route.key)
            headers[expected === "messages" ? "x-api-key" : "authorization"] =
              expected === "messages" ? route.key : `Bearer ${route.key}`;
          const upstream = await this.fetcher(`${base}/${match![2]}${url.search}`, {
            method: "POST",
            headers,
            body: Buffer.concat(chunks),
            signal: abort.signal,
            redirect: "error",
          });
          for (const name of [
            "content-type",
            "x-request-id",
            "request-id",
            "retry-after",
            "x-should-retry",
          ])
            if (upstream.headers.has(name)) res.setHeader(name, upstream.headers.get(name)!);
          res.statusCode = upstream.status;
          if (upstream.body) await pipeline(Readable.fromWeb(upstream.body as never), res);
          else res.end();
        } catch (error) {
          if (!res.destroyed && !res.writableEnded) {
            if (res.headersSent) res.destroy();
            else {
              res.writeHead(
                error instanceof KodoError && error.code === "UNAUTHORIZED" ? 401 : 422,
                { "content-type": "application/json", "x-should-retry": "false" },
              );
              res.end(
                JSON.stringify({
                  error: {
                    message:
                      error instanceof KodoError
                        ? error.message
                        : "原生上游结果未确认，中继未自动重发。",
                  },
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
      this.server!.listen(0, "127.0.0.1", resolve);
    });
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("本地中继地址不可用。");
    this.baseUrl = `http://127.0.0.1:${address.port}`;
  }
  async close() {
    this.closed = true;
    await this.starting?.catch(() => {});
    for (const abort of this.active) abort.abort();
    this.routes.clear();
    if (this.server) {
      this.server.closeAllConnections();
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    }
  }
}
