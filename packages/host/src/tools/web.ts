import { createHash, randomUUID } from "node:crypto";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import type { Readable } from "node:stream";
import {
  KodoError,
  webSearchConfigSchema,
  type WebSearchProvider,
  type WebSearchStatus,
  type WebSource,
} from "@kodo/protocol";
import type { Store } from "../storage/store.js";
import type { ProviderVault } from "../providers/service.js";

// ---------- address policy ----------
const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, incl. cloud metadata 169.254.169.254
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7], // unique local, incl. fd00:ec2::254 metadata
  ["fe80::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
  ["64:ff9b::", 96], // NAT64 can reach private IPv4 through a translator
] as const)
  blocked.addSubnet(net, prefix, "ipv6");

/** Ordinary web reads only reach public unicast addresses. */
export function isPublicAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const family = isIP(bare);
  if (!family) return false;
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(bare);
    if (mapped) return isPublicAddress(mapped[1]!);
    if (/^::ffff:/i.test(bare)) return false;
    return !blocked.check(bare, "ipv6");
  }
  return !blocked.check(bare, "ipv4");
}

class BlockedAddress extends Error {
  constructor(host: string) {
    super(`拒绝访问非公网地址：${host}。内网资源请通过已授权的应用或浏览器环境处理。`);
  }
}

const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return (callback as (e: Error) => void)(error);
    const list = addresses as unknown as LookupAddress[];
    if (!list.length || list.some((a) => !isPublicAddress(a.address)))
      return (callback as (e: Error) => void)(new BlockedAddress(hostname));
    if ((options as { all?: boolean }).all)
      return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
    callback(null, list[0]!.address, list[0]!.family);
  });
};

// ---------- text extraction ----------
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  copy: "©",
  reg: "®",
  laquo: "«",
  raquo: "»",
};
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      return Number.isFinite(code) && code > 0 && code < 0x110000
        ? String.fromCodePoint(code)
        : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}
export function extractHtml(html: string): { title: string | null; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(
      /<(script|style|noscript|svg|template|iframe|head|canvas|form)\b[\s\S]*?<\/\1\s*>/gi,
      " ",
    )
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(
      /<\/(p|div|section|article|li|h[1-6]|tr|table|ul|ol|pre|blockquote|header|footer|main|nav)\s*>/gi,
      "\n",
    )
    .replace(/<(h[1-6])\b[^>]*>/gi, "\n\n## ")
    .replace(/<[^>]+>/g, " ");
  const text = decodeEntities(body)
    .replace(/[ \t\f\v\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const title = titleMatch
    ? decodeEntities(titleMatch[1]!.replace(/\s+/g, " ")).trim() || null
    : null;
  return { title, text };
}
const stripTags = (text: string) => decodeEntities(text.replace(/<[^>]+>/g, "")).trim();

// ---------- fetching ----------
export interface FetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
}
export interface FetchedPage {
  url: string;
  status: number;
  contentType: string | null;
  body: Buffer;
  truncated: boolean;
  redirects: string[];
}
const USER_AGENT = "KooyuHost/0.2 (self-hosted assistant; +https://github.com/sh2001sh)";

export interface WebServiceOptions {
  vault: ProviderVault;
  fetcher?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  /** Tests only: let fetches reach loopback fixtures. Never set in production. */
  allowPrivateNetwork?: boolean;
}

export interface FetchResult {
  source: WebSource;
  text: string | null;
}

/**
 * Host-side web retrieval. Every retrieval is stored as a WebSource so reports cite
 * what was actually read. Fetched text is data for the model, never instructions.
 */
export class WebService {
  private readonly fetcher: typeof fetch;
  private readonly env: NodeJS.ProcessEnv;
  constructor(
    private readonly store: Store,
    private readonly options: WebServiceOptions,
  ) {
    this.fetcher = options.fetcher ?? fetch;
    this.env = options.env ?? process.env;
  }

  // ----- sources -----
  private record(source: WebSource): WebSource {
    this.store.db
      .prepare("INSERT INTO web_sources VALUES (?,?,?,?,?)")
      .run(source.id, source.sessionId, source.goalId, source.accessedAt, JSON.stringify(source));
    return source;
  }
  sources(filter: { sessionId?: string; goalId?: string; limit?: number } = {}): WebSource[] {
    const where: string[] = [],
      args: string[] = [];
    if (filter.sessionId) {
      where.push("session_id=?");
      args.push(filter.sessionId);
    }
    if (filter.goalId) {
      where.push("goal_id=?");
      args.push(filter.goalId);
    }
    return this.store.db
      .prepare(
        `SELECT data FROM web_sources ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY accessed_at DESC, rowid DESC LIMIT ?`,
      )
      .all(...args, Math.min(filter.limit ?? 100, 500))
      .map((r) => JSON.parse(String(r.data)) as WebSource);
  }
  source(id: string): WebSource {
    const row = this.store.db.prepare("SELECT data FROM web_sources WHERE id=?").get(id);
    if (!row) throw new KodoError("NOT_FOUND", "来源记录不存在。");
    return JSON.parse(String(row.data)) as WebSource;
  }

  // ----- fetch -----
  private requestOnce(url: URL, timeoutMs: number): Promise<IncomingMessage> {
    return new Promise((resolve, reject) => {
      const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
        url,
        {
          method: "GET",
          headers: {
            "User-Agent": USER_AGENT,
            Accept:
              "text/html,application/xhtml+xml,text/plain,application/json,text/markdown;q=0.9,*/*;q=0.5",
            "Accept-Encoding": "gzip, deflate, br",
          },
          ...(this.options.allowPrivateNetwork ? {} : { lookup: guardedLookup }),
          timeout: timeoutMs,
        },
        resolve,
      );
      request.on("timeout", () => request.destroy(new Error("网页读取超时。")));
      request.on("error", reject);
      request.end();
    });
  }
  private async readBody(response: IncomingMessage, maxBytes: number) {
    const encoding = String(response.headers["content-encoding"] ?? "").toLowerCase();
    let stream: Readable = response;
    if (encoding === "gzip" || encoding === "x-gzip") stream = response.pipe(createGunzip());
    else if (encoding === "deflate") stream = response.pipe(createInflate());
    else if (encoding === "br") stream = response.pipe(createBrotliDecompress());
    const chunks: Buffer[] = [];
    let size = 0,
      truncated = false;
    try {
      for await (const chunk of stream) {
        const buffer = chunk as Buffer;
        if (size + buffer.length > maxBytes) {
          chunks.push(buffer.subarray(0, maxBytes - size));
          size = maxBytes;
          truncated = true;
          break;
        }
        chunks.push(buffer);
        size += buffer.length;
      }
    } finally {
      response.destroy();
    }
    return { body: Buffer.concat(chunks), truncated };
  }
  /** Fetch with redirect, size and time limits; each hop re-checks the destination. */
  async fetchPage(input: string, options: FetchOptions = {}): Promise<FetchedPage> {
    const maxBytes = options.maxBytes ?? 2 * 1024 * 1024,
      timeoutMs = options.timeoutMs ?? 20000,
      maxRedirects = options.maxRedirects ?? 5;
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      throw new KodoError("INVALID_INPUT", "网址无效。");
    }
    const redirects: string[] = [];
    for (let hop = 0; ; hop++) {
      if (url.protocol !== "http:" && url.protocol !== "https:")
        throw new KodoError("INVALID_INPUT", "只支持 http/https 网页。");
      if (url.username || url.password)
        throw new KodoError("INVALID_INPUT", "网址不能包含账号或密码。");
      const host = url.hostname.replace(/^\[|\]$/g, "");
      if (!this.options.allowPrivateNetwork && isIP(host) && !isPublicAddress(host))
        throw new KodoError("UNAUTHORIZED", new BlockedAddress(host).message);
      let response: IncomingMessage;
      try {
        response = await this.requestOnce(url, timeoutMs);
      } catch (error) {
        if (error instanceof BlockedAddress) throw new KodoError("UNAUTHORIZED", error.message);
        throw new KodoError(
          "UNAVAILABLE",
          `网页读取失败：${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location) {
        response.destroy();
        if (hop >= maxRedirects) throw new KodoError("UNAVAILABLE", "网页重定向次数过多。");
        redirects.push(url.toString());
        url = new URL(location, url);
        continue;
      }
      const { body, truncated } = await this.readBody(response, maxBytes);
      return {
        url: url.toString(),
        status,
        contentType: response.headers["content-type"] ?? null,
        body,
        truncated,
        redirects,
      };
    }
  }

  /** Read one page as text and store it as a source. Unsupported formats say so. */
  async fetch(
    input: { url: string; maxChars?: number },
    context: { sessionId: string | null; goalId: string | null },
  ): Promise<FetchResult> {
    const accessedAt = new Date().toISOString();
    const base = {
      id: randomUUID(),
      sessionId: context.sessionId,
      goalId: context.goalId,
      kind: "fetch" as const,
      request: input.url,
      provider: null,
      providerRequestId: null,
      accessedAt,
    };
    let page: FetchedPage;
    try {
      page = await this.fetchPage(input.url);
    } catch (error) {
      this.record({
        ...base,
        url: null,
        title: null,
        status: "failed",
        snippet: null,
        sha256: null,
        contentType: null,
        truncated: false,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    const type = (page.contentType ?? "").split(";")[0]!.trim().toLowerCase();
    const charset = /charset=([^;]+)/i
      .exec(page.contentType ?? "")?.[1]
      ?.trim()
      .replace(/"/g, "");
    const decode = () => {
      try {
        return new TextDecoder(charset || "utf-8").decode(page.body);
      } catch {
        return new TextDecoder("utf-8").decode(page.body);
      }
    };
    const sha256 = createHash("sha256").update(page.body).digest("hex");
    const textual =
      type.startsWith("text/") ||
      type === "application/json" ||
      type === "application/xml" ||
      type === "application/xhtml+xml" ||
      type.endsWith("+json") ||
      type.endsWith("+xml") ||
      type === "";
    let title: string | null = null,
      text: string | null = null;
    if (textual) {
      const raw = decode();
      if (
        type === "text/html" ||
        type === "application/xhtml+xml" ||
        (!type && /<html/i.test(raw))
      ) {
        const extracted = extractHtml(raw);
        title = extracted.title;
        text = extracted.text;
      } else text = raw;
    }
    const maxChars = Math.min(Math.max(input.maxChars ?? 20000, 1000), 100000);
    const clipped = text !== null && text.length > maxChars;
    if (clipped) text = text!.slice(0, maxChars);
    const httpFailed = page.status >= 400;
    const source = this.record({
      ...base,
      url: page.url,
      title,
      status: httpFailed
        ? "failed"
        : !textual
          ? "unsupported"
          : page.truncated || clipped
            ? "partial"
            : "ok",
      snippet: text ? text.slice(0, 500) : null,
      sha256,
      contentType: page.contentType,
      truncated: page.truncated || clipped,
      error: httpFailed ? `HTTP ${page.status}` : !textual ? `暂不支持提取 ${type} 内容。` : null,
    });
    return { source, text };
  }

  // ----- search -----
  private settings() {
    return (
      this.store.record<{
        provider: WebSearchProvider | null;
        endpoint: string | null;
        credentialRef: string | null;
        revision: number;
      }>("web-search-config", "global") ?? {
        provider: null,
        endpoint: null,
        credentialRef: null,
        revision: 0,
      }
    );
  }
  status(): WebSearchStatus {
    const envProvider = this.env.KOOYU_SEARCH_PROVIDER as WebSearchProvider | undefined;
    const saved = this.settings();
    if (envProvider && ["brave", "tavily", "searxng"].includes(envProvider))
      return {
        provider: envProvider,
        endpoint: envProvider === "searxng" ? (this.env.KOOYU_SEARXNG_URL ?? null) : null,
        configured:
          envProvider === "searxng"
            ? Boolean(this.env.KOOYU_SEARXNG_URL)
            : Boolean(this.env.KOOYU_SEARCH_API_KEY),
        source: "environment",
        revision: saved.revision,
      };
    return {
      provider: saved.provider,
      endpoint: saved.endpoint,
      configured:
        saved.provider === "searxng"
          ? Boolean(saved.endpoint)
          : Boolean(saved.provider && saved.credentialRef),
      source: saved.provider ? "settings" : null,
      revision: saved.revision,
    };
  }
  async configure(value: unknown): Promise<WebSearchStatus> {
    const input = webSearchConfigSchema.parse(value);
    const current = this.settings();
    if (current.revision !== input.expectedRevision)
      throw new KodoError("CONFLICT", "检索配置已在另一窗口修改，请刷新后重试。");
    if (input.provider === "searxng" && !(input.endpoint ?? current.endpoint))
      throw new KodoError("INVALID_INPUT", "SearXNG 需要服务地址。");
    let credentialRef = current.credentialRef;
    if (input.apiKey) {
      credentialRef = credentialRef ?? `web-search:${randomUUID()}`;
      await this.options.vault.set(credentialRef, input.apiKey);
    }
    if (!input.provider && credentialRef) {
      await this.options.vault.delete(credentialRef).catch(() => {});
      credentialRef = null;
    }
    this.store.transaction(() => {
      const latest = this.settings();
      if (latest.revision !== current.revision)
        throw new KodoError("CONFLICT", "检索配置已在另一窗口修改，请刷新后重试。");
      this.store.put("web-search-config", "global", {
        provider: input.provider,
        endpoint: input.provider === "searxng" ? (input.endpoint ?? current.endpoint) : null,
        credentialRef,
        revision: current.revision + 1,
      });
    });
    return this.status();
  }
  private async credentials(): Promise<{
    provider: WebSearchProvider;
    key: string | null;
    endpoint: string | null;
  } | null> {
    const status = this.status();
    if (!status.configured || !status.provider) return null;
    if (status.source === "environment")
      return {
        provider: status.provider,
        key: this.env.KOOYU_SEARCH_API_KEY ?? null,
        endpoint: status.endpoint,
      };
    const saved = this.settings();
    const key = saved.credentialRef ? await this.options.vault.get(saved.credentialRef) : null;
    if (status.provider !== "searxng" && !key)
      throw new KodoError("UNAVAILABLE", "凭据库中缺少检索服务 key，请重新配置。");
    return { provider: status.provider, key, endpoint: saved.endpoint };
  }

  /** Configured search API. "No results" and "search failed" are recorded differently. */
  async search(
    input: { query: string; count?: number },
    context: { sessionId: string | null; goalId: string | null },
  ): Promise<WebSource> {
    const query = input.query.trim();
    if (!query || query.length > 500) throw new KodoError("INVALID_INPUT", "检索词需要 1-500 字。");
    const count = Math.min(Math.max(input.count ?? 8, 1), 20);
    const config = await this.credentials();
    if (!config) throw new KodoError("UNAVAILABLE", "尚未配置网页检索服务。");
    const base = {
      id: randomUUID(),
      sessionId: context.sessionId,
      goalId: context.goalId,
      kind: "search" as const,
      request: query,
      url: null,
      title: null,
      provider: config.provider,
      sha256: null,
      contentType: null,
      truncated: false,
      accessedAt: new Date().toISOString(),
    };
    try {
      const { results, requestId } = await this.callProvider(config, query, count);
      return this.record({
        ...base,
        providerRequestId: requestId,
        status: results.length ? "ok" : "no-results",
        snippet: null,
        error: null,
        results,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.record({
        ...base,
        providerRequestId: null,
        status: "failed",
        snippet: null,
        error: message,
      });
      throw error instanceof KodoError
        ? error
        : new KodoError("UNAVAILABLE", `检索失败：${message}`);
    }
  }
  private async callProvider(
    config: { provider: WebSearchProvider; key: string | null; endpoint: string | null },
    query: string,
    count: number,
  ): Promise<{
    results: { title: string; url: string; snippet: string }[];
    requestId: string | null;
  }> {
    const signal = AbortSignal.timeout(20000);
    const ensure = async (response: Response) => {
      if (!response.ok)
        throw new KodoError(
          "UNAVAILABLE",
          `检索服务返回 HTTP ${response.status}${response.status === 401 || response.status === 403 ? "（凭据无效或无权限）" : ""}。`,
        );
      return (await response.json()) as Record<string, any>;
    };
    if (config.provider === "brave") {
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.searchParams.set("q", query);
      url.searchParams.set("count", String(count));
      const response = await this.fetcher(url, {
        headers: { Accept: "application/json", "X-Subscription-Token": config.key ?? "" },
        signal,
      });
      const body = await ensure(response);
      return {
        results: ((body.web?.results ?? []) as any[]).slice(0, count).map((r) => ({
          title: stripTags(String(r.title ?? "")),
          url: String(r.url ?? ""),
          snippet: stripTags(String(r.description ?? "")),
        })),
        requestId: response.headers.get("x-request-id"),
      };
    }
    if (config.provider === "tavily") {
      const response = await this.fetcher("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.key ?? ""}`,
        },
        body: JSON.stringify({ query, max_results: count, search_depth: "basic" }),
        signal,
      });
      const body = await ensure(response);
      return {
        results: ((body.results ?? []) as any[]).slice(0, count).map((r) => ({
          title: String(r.title ?? ""),
          url: String(r.url ?? ""),
          snippet: String(r.content ?? "").slice(0, 1000),
        })),
        requestId: typeof body.request_id === "string" ? body.request_id : null,
      };
    }
    const url = new URL(
      "search",
      config.endpoint!.endsWith("/") ? config.endpoint! : `${config.endpoint}/`,
    );
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    const response = await this.fetcher(url, { headers: { Accept: "application/json" }, signal });
    const body = await ensure(response);
    return {
      results: ((body.results ?? []) as any[]).slice(0, count).map((r) => ({
        title: String(r.title ?? ""),
        url: String(r.url ?? ""),
        snippet: String(r.content ?? "").slice(0, 1000),
      })),
      requestId: null,
    };
  }
}
