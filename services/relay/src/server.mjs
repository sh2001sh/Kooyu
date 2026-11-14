import { createServer } from "node:http";
import { createHash, createPublicKey, randomBytes, randomUUID, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, relative, extname } from "node:path";
import { WebSocketServer, WebSocket } from "ws";

const MAX_BODY = 1024 * 1024,
  MAX_BUFFER = 4 * MAX_BODY,
  ID = "[a-f0-9]{64}";
const requestHeaders = [
  "content-type",
  "authorization",
  "origin",
  "last-event-id",
  "x-kooyu-protocol",
];
const mime = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};
const appCsp =
  "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

export function createRelay({
  origin,
  webRoot,
  maxHosts = 1000,
  maxPending = 2048,
  proxy = false,
}) {
  const publicUrl = new URL(origin);
  if (
    publicUrl.pathname !== "/" ||
    publicUrl.search ||
    publicUrl.hash ||
    publicUrl.username ||
    publicUrl.password
  )
    throw new Error("Invalid Relay origin");
  const hosts = new Map(),
    pending = new Map(),
    rates = new Map();
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 2 * MAX_BODY,
    perMessageDeflate: false,
  });
  let closing = false;
  const json = (res, status, body) => {
    if (res.destroyed) return;
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };
  const fail = (res, status, code, message) => json(res, status, { error: { code, message } });
  const send = (ws, value) => {
    if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > MAX_BUFFER) return false;
    ws.send(JSON.stringify(value));
    return true;
  };
  const clientIp = (req) =>
    proxy
      ? String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress)
          .split(",")
          .at(-1)
          .trim()
      : req.socket.remoteAddress;
  const limited = (req, kind, limit) => {
    const key = kind + ":" + clientIp(req),
      now = Date.now();
    let entry = rates.get(key);
    if (!entry || now >= entry.until) {
      if (rates.size >= 20000 && !entry) return true;
      rates.set(key, (entry = { count: 0, until: now + 60000 }));
    }
    return ++entry.count > limit;
  };
  const release = (id, cancel = false) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    p.host.requests.delete(id);
    clearTimeout(p.timer);
    if (cancel) send(p.host.ws, { type: "cancel", id });
  };
  const touch = (id) => {
    const p = pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    p.timer = setTimeout(
      () => {
        release(id, true);
        fail(p.res, 504, "RELAY_TIMEOUT", "连接超时，请核对操作结果后重试。");
      },
      p.streaming ? 45000 : 120000,
    );
    p.timer.unref();
  };
  const server = createServer(async (req, res) => {
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("content-security-policy", appCsp);
    res.setHeader("cache-control", "no-store");
    try {
      if (closing) return fail(res, 503, "RELAY_RESTARTING", "连接服务正在重启。");
      if (req.headers.host !== publicUrl.host)
        return fail(res, 421, "INVALID_HOST", "访问地址不正确。");
      if (req.headers.origin && req.headers.origin !== publicUrl.origin)
        return fail(res, 403, "INVALID_ORIGIN", "访问来源未授权。");
      const url = new URL(req.url, origin);
      if (url.pathname === "/healthz" && req.method === "GET")
        return json(res, 200, { service: "kooyu-relay", status: "ok", version: 1 });
      if (limited(req, "http", 600))
        return fail(res, 429, "RATE_LIMITED", "请求过多，请稍后再试。");
      const match = new RegExp("^/h/(" + ID + ")(/api(?:/[^\\s]*)?)$").exec(url.pathname);
      if (match) {
        // An enrolled Host must never execute HTML/JS on this shared origin.
        res.setHeader(
          "content-security-policy",
          "default-src 'none'; sandbox; frame-ancestors 'none'",
        );
        const [, hostId, path] = match;
        if (!["GET", "POST", "PATCH", "PUT", "DELETE"].includes(req.method))
          return fail(res, 405, "INVALID_METHOD", "不支持此方法。");
        if (/^\/api\/pair(?:\/native)?$/.test(path) && limited(req, "pair", 20))
          return fail(res, 429, "RATE_LIMITED", "配对尝试过多，请稍后再试。");
        const host = hosts.get(hostId);
        if (!host)
          return fail(res, 503, "HOST_OFFLINE", "电脑未连接。请确认电脑已联网并开启手机连接。");
        if (host.requests.size >= 128 || pending.size >= maxPending)
          return fail(res, 503, "RELAY_BUSY", "连接繁忙，请稍后再试。");
        if (Number(req.headers["content-length"] ?? 0) > MAX_BODY)
          return fail(res, 413, "TOO_LARGE", "请求内容过大。");
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > MAX_BODY) {
            fail(res, 413, "TOO_LARGE", "请求内容过大。");
            return;
          }
          chunks.push(chunk);
        }
        if (hosts.get(hostId) !== host) return fail(res, 503, "HOST_OFFLINE", "电脑连接已断开。");
        // Recheck after asynchronous body reads; simultaneous requests share the cap.
        if (host.requests.size >= 128 || pending.size >= maxPending)
          return fail(res, 503, "RELAY_BUSY", "连接繁忙，请稍后再试。");
        const headers = {};
        for (const name of requestHeaders)
          if (typeof req.headers[name] === "string") headers[name] = req.headers[name];
        const token = new RegExp("(?:^|;\\s*)kooyu_" + hostId + "=([A-Za-z0-9_-]+)(?:;|$)").exec(
          req.headers.cookie ?? "",
        )?.[1];
        if (token) headers.cookie = "kodo_device=" + token;
        const id = randomUUID();
        const p = { host, hostId, res, timer: undefined, streaming: false, started: false };
        pending.set(id, p);
        host.requests.add(id);
        touch(id);
        res.on("close", () => release(id, true));
        if (
          !send(host.ws, {
            type: "request",
            id,
            method: req.method,
            path: path + url.search,
            headers,
            body: Buffer.concat(chunks).toString("base64"),
          })
        ) {
          release(id);
          return fail(res, 503, "HOST_OFFLINE", "电脑连接不可用。");
        }
        return;
      }
      if (!["GET", "HEAD"].includes(req.method)) return fail(res, 404, "NOT_FOUND", "接口不存在。");
      const hostPage = new RegExp("^/h/(" + ID + ")/?$").exec(url.pathname);
      const manifest = new RegExp("^/h/(" + ID + ")/manifest.webmanifest$").exec(url.pathname);
      if (manifest) {
        const base = "/h/" + manifest[1] + "/";
        res.setHeader("content-type", "application/manifest+json");
        return res.end(
          JSON.stringify({
            name: "Kooyu",
            short_name: "Kooyu",
            id: base,
            start_url: base,
            scope: base,
            display: "standalone",
            background_color: "#f4f1ed",
            theme_color: "#f17561",
            icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
          }),
        );
      }
      if (url.pathname === "/")
        return json(res, 200, {
          service: "kooyu-relay",
          message: "请在电脑端打开「手机连接」，扫描二维码连接你的电脑。",
        });
      if (!webRoot) return fail(res, 404, "NOT_FOUND", "页面不存在。");
      if (hostPage) {
        let html = await readFile(resolve(webRoot, "index.html"), "utf8");
        html = html.replace(
          'href="/manifest.webmanifest"',
          'href="/h/' + hostPage[1] + '/manifest.webmanifest"',
        );
        res.setHeader("content-type", "text/html; charset=utf-8");
        return res.end(req.method === "HEAD" ? undefined : html);
      }
      if (!/^\/(?:assets\/|art\/|icon\.svg$|sw\.js$)/.test(url.pathname))
        return fail(res, 404, "NOT_FOUND", "页面不存在。");
      const file = resolve(webRoot, "." + decodeURIComponent(url.pathname));
      if (relative(resolve(webRoot), file).startsWith(".."))
        return fail(res, 404, "NOT_FOUND", "页面不存在。");
      const content = await readFile(file);
      res.setHeader("content-type", mime[extname(file)] ?? "application/octet-stream");
      res.end(req.method === "HEAD" ? undefined : content);
    } catch {
      fail(res, 400, "INVALID_REQUEST", "无法完成请求，请重新连接。");
    }
  });
  server.headersTimeout = 15000;
  server.requestTimeout = 30000;
  server.on("upgrade", (req, socket, head) => {
    if (
      closing ||
      req.url !== "/v1/host" ||
      req.headers.host !== publicUrl.host ||
      req.headers.origin ||
      wss.clients.size >= maxHosts + 32 ||
      limited(req, "upgrade", 30)
    ) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const challenge = "kooyu-relay-v1:" + randomBytes(32).toString("base64url");
      let host,
        alive = true;
      const timer = setTimeout(() => ws.close(1008, "Authentication timeout"), 10000);
      timer.unref();
      ws.on("error", () => {});
      ws.on("pong", () => {
        alive = true;
      });
      const heartbeat = setInterval(() => {
        if (!alive) return ws.terminate();
        alive = false;
        ws.ping();
      }, 20000);
      heartbeat.unref();
      send(ws, { type: "challenge", challenge, version: 1 });
      ws.on("message", (raw, binary) => {
        try {
          if (binary) throw new Error("Binary message");
          const m = JSON.parse(raw.toString());
          if (!host) {
            if (
              m.type !== "authenticate" ||
              typeof m.publicKey !== "string" ||
              m.publicKey.length > 256 ||
              typeof m.signature !== "string" ||
              m.signature.length > 128
            )
              throw new Error("Invalid identity");
            const der = Buffer.from(m.publicKey, "base64"),
              key = createPublicKey({ key: der, format: "der", type: "spki" });
            if (
              key.asymmetricKeyType !== "ed25519" ||
              !verify(null, Buffer.from(challenge), key, Buffer.from(m.signature, "base64"))
            )
              throw new Error("Invalid signature");
            const id = createHash("sha256").update(der).digest("hex");
            if (hosts.has(id) || hosts.size >= maxHosts) {
              ws.close(1013, "Already connected or capacity reached");
              return;
            }
            clearTimeout(timer);
            host = { id, ws, requests: new Set() };
            hosts.set(id, host);
            send(ws, { type: "ready", hostId: id, version: 1 });
            return;
          }
          const p = pending.get(m.id);
          if (!p || p.host !== host) return;
          touch(m.id);
          if (m.type === "head") {
            if (
              p.started ||
              !Number.isInteger(m.status) ||
              m.status < 200 ||
              m.status > 599 ||
              (m.status >= 300 && m.status < 400)
            )
              throw new Error("Invalid response");
            p.started = true;
            const type = String(m.headers?.["content-type"] ?? "application/json");
            p.streaming = type.startsWith("text/event-stream");
            p.res.setHeader(
              "content-type",
              p.streaming
                ? "text/event-stream"
                : type.startsWith("application/json")
                  ? "application/json"
                  : "text/plain; charset=utf-8",
            );
            if (p.streaming) p.res.setHeader("x-accel-buffering", "no");
            const cookie = /^kodo_device=([A-Za-z0-9_-]{40,100});/.exec(
              String(m.headers?.["set-cookie"] ?? ""),
            );
            if (cookie)
              p.res.setHeader(
                "set-cookie",
                "kooyu_" +
                  p.hostId +
                  "=" +
                  cookie[1] +
                  "; HttpOnly; SameSite=Strict; Secure; Path=/h/" +
                  p.hostId +
                  "/api; Max-Age=2592000",
              );
            p.res.writeHead(m.status);
            p.res.flushHeaders();
          } else if (m.type === "chunk") {
            if (!p.started || typeof m.data !== "string" || m.data.length > 100000)
              throw new Error("Invalid chunk");
            if (p.res.writableLength > MAX_BODY) {
              release(m.id, true);
              p.res.destroy();
              return;
            }
            p.res.write(Buffer.from(m.data, "base64"));
          } else if (m.type === "end") {
            release(m.id);
            p.res.end();
          } else if (m.type === "error") {
            release(m.id);
            fail(p.res, 502, "HOST_REQUEST_FAILED", "电脑连接中断，请核对操作结果。");
          } else throw new Error("Invalid frame");
        } catch {
          ws.close(1008, "Invalid protocol");
        }
      });
      ws.on("close", () => {
        clearTimeout(timer);
        clearInterval(heartbeat);
        if (host && hosts.get(host.id) === host) hosts.delete(host.id);
        if (host)
          for (const id of [...host.requests]) {
            const p = pending.get(id);
            release(id);
            if (p) fail(p.res, 503, "HOST_OFFLINE", "电脑连接已断开，请核对操作结果。");
          }
      });
    });
  });
  const prune = setInterval(() => {
    for (const [k, v] of rates) if (v.until <= Date.now()) rates.delete(k);
  }, 60000);
  prune.unref();
  return {
    server,
    hosts,
    async close() {
      closing = true;
      clearInterval(prune);
      for (const ws of wss.clients) ws.terminate();
      for (const id of [...pending.keys()]) {
        const p = pending.get(id);
        release(id);
        p.res.destroy();
      }
      await new Promise((done) => {
        server.close(done);
        server.closeAllConnections();
      });
      wss.close();
    },
  };
}
