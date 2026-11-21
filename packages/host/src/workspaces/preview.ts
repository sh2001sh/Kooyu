import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { connect as netConnect, type Socket } from "node:net";
import { randomBytes } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { KodoError, type Workspace } from "@kodo/protocol";
import { workspacePath } from "./files.js";

const media: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".map": "application/json; charset=utf-8",
};

const ALLOWED_PROXY_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const STRIPPED_REQ_HEADERS = new Set([
  "host",
  "cookie",
  "authorization",
  "proxy-authorization",
  "x-forwarded-for",
  "x-real-ip",
]);
const STRIPPED_RES_HEADERS = new Set([
  "set-cookie",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "content-security-policy",
  "content-security-policy-report-only",
]);
const MAX_PROXY_BODY_BYTES = 16 * 1024 * 1024;
const STATIC_SANDBOX_CSP =
  "sandbox allow-scripts; default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'";
// Dev servers run on an isolated random *.localhost origin; keep sandbox allow-scripts
// while permitting dev assets, inline dev styles, and HMR ws: back to the preview origin.
const DEV_SERVER_CSP =
  "sandbox allow-scripts allow-forms; default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: ws: wss:; img-src * data: blob:; font-src * data:; connect-src 'self' ws: wss:; base-uri 'none'; object-src 'none'";

export class PreviewService {
  private servers = new Map<Server, ReturnType<typeof setTimeout>>();
  private opening = 0;
  private disposed = false;

  async open(workspace: Workspace, file: string) {
    const { file: entry } = await workspacePath(workspace, file);
    const ext = extname(file).toLowerCase();
    if (![".html", ".htm", ".svg"].includes(ext) || !(await stat(entry)).isFile())
      throw new KodoError("INVALID_INPUT", "请选择 HTML 或 SVG 入口文件。");
    const root = dirname(entry);
    return this.listen(
      async (req, res) => {
        if (req.method !== "GET" && req.method !== "HEAD") {
          res.writeHead(405).end();
          return;
        }
        const path = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
        const parts = path.split("/").filter(Boolean);
        if (parts.some((part) => part.startsWith(".") || /[\\:\0]/.test(part))) throw new Error();
        const target = await realpath(path === "/" ? entry : resolve(root, ...parts));
        const rel = relative(root, target);
        const mime = media[extname(target).toLowerCase()];
        if (isAbsolute(rel) || rel.startsWith(".." + sep) || rel === ".." || !mime)
          throw new Error();
        const info = await stat(target);
        if (!info.isFile() || info.size > MAX_PROXY_BODY_BYTES) throw new Error();
        res.setHeader("content-type", mime);
        if (req.method === "HEAD") {
          res.setHeader("content-length", String(info.size));
          res.end();
          return;
        }
        res.end(await readFile(target));
      },
      { csp: STATIC_SANDBOX_CSP, allowMethods: new Set(["GET", "HEAD"]) },
    );
  }

  openPort(port: number, hostPort: number | undefined) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === hostPort)
      throw new KodoError("INVALID_INPUT", "请选择有效的本机开发服务器端口。");
    return this.listen(
      (req, res) => {
        const path = req.url ?? "/";
        if (!path.startsWith("/") || path.startsWith("//")) throw new Error();
        const headers: Record<string, string | string[]> = {};
        for (const [k, v] of Object.entries(req.headers)) {
          if (!v || STRIPPED_REQ_HEADERS.has(k.toLowerCase())) continue;
          headers[k] = v;
        }
        headers.host = `127.0.0.1:${port}`;
        const upstream = httpRequest(
          {
            hostname: "127.0.0.1",
            port,
            path,
            method: req.method ?? "GET",
            headers,
            timeout: 30_000,
          },
          (source) => {
            const status = source.statusCode ?? 502;
            const outHeaders: Record<string, string | string[]> = {};
            for (const [k, v] of Object.entries(source.headers)) {
              if (!v || STRIPPED_RES_HEADERS.has(k.toLowerCase())) continue;
              if (k.toLowerCase() === "location") {
                const loc = Array.isArray(v) ? v[0]! : v;
                // Rewrite same-port loopback redirects to stay inside the isolated preview origin;
                // refuse external redirects with 404 and no Location header.
                if (loc.startsWith("/") && !loc.startsWith("//")) {
                  outHeaders.location = loc;
                } else {
                  let allowedLocalRedirect = false;
                  try {
                    const parsed = new URL(loc);
                    if (
                      ["127.0.0.1", "localhost"].includes(parsed.hostname) &&
                      Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80)) === port
                    ) {
                      outHeaders.location = parsed.pathname + parsed.search + parsed.hash;
                      allowedLocalRedirect = true;
                    }
                  } catch {}
                  if (!allowedLocalRedirect) {
                    source.destroy();
                    res.writeHead(404).end();
                    return;
                  }
                }
                continue;
              }
              outHeaders[k] = v;
            }
            if (!outHeaders["content-type"] && status !== 204 && status !== 304) {
              outHeaders["content-type"] = "application/octet-stream";
            }
            res.writeHead(status, outHeaders);
            if (req.method === "HEAD" || status === 204 || status === 304) {
              source.resume();
              res.end();
              return;
            }
            let size = 0;
            source.on("data", (chunk: Buffer) => {
              size += chunk.length;
              if (size > MAX_PROXY_BODY_BYTES) upstream.destroy(new Error("预览超过大小上限。"));
            });
            source.on("error", () => res.destroy());
            source.pipe(res);
          },
        );
        let reqBytes = 0;
        req.on("data", (chunk: Buffer) => {
          reqBytes += chunk.length;
          if (reqBytes > MAX_PROXY_BODY_BYTES) upstream.destroy(new Error("请求超过大小上限。"));
        });
        req.on("error", () => upstream.destroy());
        res.on("close", () => upstream.destroy());
        upstream.on("timeout", () => upstream.destroy(new Error("开发服务器响应超时。")));
        upstream.on("error", () => {
          if (!res.headersSent) res.writeHead(502).end();
          else res.destroy();
        });
        req.pipe(upstream);
      },
      {
        csp: DEV_SERVER_CSP,
        allowMethods: ALLOWED_PROXY_METHODS,
        onUpgrade: (req, socket, head) => {
          const path = req.url ?? "/";
          if (!path.startsWith("/") || path.startsWith("//")) {
            socket.destroy();
            return;
          }
          const upstream = netConnect(port, "127.0.0.1", () => {
            const rawLines: string[] = [`${req.method ?? "GET"} ${path} HTTP/1.1`];
            for (let i = 0; i < req.rawHeaders.length; i += 2) {
              const name = req.rawHeaders[i]!;
              const value = req.rawHeaders[i + 1] ?? "";
              if (STRIPPED_REQ_HEADERS.has(name.toLowerCase())) continue;
              rawLines.push(`${name}: ${value}`);
            }
            rawLines.push(`Host: 127.0.0.1:${port}`, "", "");
            upstream.write(rawLines.join("\r\n"));
            if (head.length) upstream.write(head);
            upstream.pipe(socket);
            socket.pipe(upstream);
          });
          upstream.on("error", () => socket.destroy());
          socket.on("error", () => upstream.destroy());
          socket.on("close", () => upstream.destroy());
          upstream.on("close", () => socket.destroy());
        },
      },
    );
  }

  private async listen(
    serve: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void,
    options: {
      csp: string;
      allowMethods: Set<string>;
      onUpgrade?: (req: IncomingMessage, socket: Socket, head: Buffer) => void;
    },
  ) {
    if (this.disposed) throw new KodoError("UNAVAILABLE", "预览服务已关闭。");
    if (this.servers.size + this.opening >= 16)
      throw new KodoError("CONFLICT", "预览数量已达上限。");
    const hostname = randomBytes(16).toString("hex") + ".localhost";
    const isValidHost = (req: IncomingMessage) => {
      const address = server.address();
      return (
        address !== null &&
        typeof address !== "string" &&
        req.headers.host === hostname + ":" + address.port
      );
    };
    const server = createServer(async (req, res) => {
      if (!isValidHost(req) || !options.allowMethods.has(req.method ?? "")) {
        res.writeHead(403).end();
        return;
      }
      try {
        res.setHeader("x-content-type-options", "nosniff");
        res.setHeader("referrer-policy", "no-referrer");
        res.setHeader("cache-control", "no-store");
        res.setHeader("access-control-allow-origin", "null");
        res.setHeader("content-security-policy", options.csp);
        await serve(req, res);
      } catch {
        if (!res.headersSent) res.writeHead(404).end();
        else res.destroy();
      }
    });
    if (options.onUpgrade) {
      server.on("upgrade", (req, socket, head) => {
        if (!isValidHost(req)) {
          socket.destroy();
          return;
        }
        options.onUpgrade!(req, socket as Socket, head);
      });
    }
    this.opening++;
    try {
      await new Promise<void>((ok, fail) => {
        server.once("error", fail);
        server.listen(0, "127.0.0.1", ok);
      });
    } finally {
      this.opening--;
    }
    if (this.disposed) {
      this.close(server);
      throw new KodoError("UNAVAILABLE", "预览服务已关闭。");
    }
    server.unref();
    const timer = setTimeout(() => this.close(server), 15 * 60 * 1000);
    timer.unref();
    this.servers.set(server, timer);
    const port = (server.address() as { port: number }).port;
    return {
      url: "http://" + hostname + ":" + port + "/",
      expiresAt: new Date(Date.now() + 900000).toISOString(),
    };
  }

  private close(server: Server) {
    clearTimeout(this.servers.get(server));
    this.servers.delete(server);
    server.close();
    server.closeAllConnections();
  }

  dispose() {
    this.disposed = true;
    for (const server of this.servers.keys()) this.close(server);
  }
}
