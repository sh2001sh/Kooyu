import { createServer } from "node:http";
import { createHash, createPublicKey, randomBytes, randomUUID, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, relative, extname } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { Mailbox } from "./mailbox.mjs";
import { WakePush } from "./push.mjs";
import {browserAccount} from "./browser-account.mjs";

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
  "default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
// Each preview gets a fresh hostname. Its own origin lets module imports and
// fetch() carry its host-only session cookie. Workers must not outlive the lease.
const previewCsp =
  "sandbox allow-scripts allow-same-origin; default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'";

export function createRelay({
  origin,
  webRoot,
  createHttpServer = createServer,
  maxHosts = 1000,
  maxPending = 2048,
  proxy = false,
  mailboxPath = ":memory:",
  previewDomain,
  gateway,
}) {
  if (!gateway || !["access","uplink","lease","nonce"].every(k => typeof gateway[k] === "function")) throw Error("Account gateway required");
  const publicUrl = new URL(origin);
  if (previewDomain && (!/^(?:[a-z0-9-]+\.)+[a-z]+$/.test(previewDomain) || publicUrl.hostname === previewDomain ||
    publicUrl.hostname.endsWith("."+previewDomain))) throw Error("Invalid preview domain");
  const previews = new Map();
  if (
    publicUrl.pathname !== "/" ||
    publicUrl.search ||
    publicUrl.hash ||
    publicUrl.username ||
    publicUrl.password
  )
    throw new Error("Invalid Relay origin");
  const mailbox = new Mailbox(mailboxPath);
  const push = new WakePush(mailbox.db, publicUrl.origin);
  const hosts = new Map(),
    pending = new Map(),
    rates = new Map();
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 2 * MAX_BODY,
    perMessageDeflate: false,
  });
  const browserSockets = new WebSocketServer({noServer:true,maxPayload:256,perMessageDeflate:false,
    handleProtocols: protocols => protocols.has("kooyu.events.v1") && "kooyu.events.v1"});
  const upgrades = new Map();
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
  function accessFailure(res,error){
    const code=error?.code==="ERR_JWT_EXPIRED"?"TOKEN_EXPIRED":error?.message;
    switch(code){
      case "ACCOUNT_REQUIRED":return fail(res,401,code,"请先登录并授权此设备。");
      case "TOKEN_EXPIRED":return fail(res,401,code,"连接票据已过期，请重新连接。");
      case "ACCOUNT_DISABLED":return fail(res,403,code,"账号已暂停。");
      case "DEVICE_REVOKED":return fail(res,403,code,"设备授权已撤销。");
      case "TRANSACTION_CLOSED":return fail(res,403,code,"配对申请已关闭。");
      case "SERVICE_BUSY":
      case "SERVICE_UNAVAILABLE":
        res.setHeader("retry-after","5");
        return fail(res,503,code,"授权服务暂时不可用，请稍后重试。");
      default:return fail(res,403,"DEVICE_APPROVAL_REQUIRED","设备授权无效。");
    }
  }

  const v2 = new WeakSet();
  const send = (ws, value) => {
    if (ws.readyState !== WebSocket.OPEN) return false;
    // Reserve room for cancellation of already admitted requests. A stalled
    // peer must either receive cancellation or see its connection close.
    if (value.type === "cancel") {
      if (ws.bufferedAmount > MAX_BUFFER + 2 * MAX_BODY) {
        ws.terminate();
        return false;
      }
    } else if (ws.bufferedAmount > MAX_BUFFER) return false;
    if (v2.has(ws)) {
      const header = Buffer.alloc(6);
      header[0] = 1;
      header.writeUInt32BE(value.streamId ?? 0, 1);
      ws.send(Buffer.concat([header, Buffer.from(JSON.stringify(value))]));
    } else ws.send(JSON.stringify(value));
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
    p.host.streams.delete(p.streamId);
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
  const server = createHttpServer(async (req, res) => {
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("content-security-policy", appCsp);
    res.setHeader("cache-control", "no-store");
    try {
      if (closing) return fail(res, 503, "RELAY_RESTARTING", "连接服务正在重启。");
      const hostname = String(req.headers.host ?? "");
      const previewId = previewDomain && hostname.endsWith("."+previewDomain) ? hostname.slice(0,-previewDomain.length-1) : "";
      const preview = previewId && previews.get(previewId);

      if (previewId) {
        if (!preview || preview.expires <= Date.now() || hosts.get(preview.host.id) !== preview.host || req.method !== "GET")
          return fail(res,404,"NOT_FOUND","预览已过期。");
        const incoming = new URL(req.url,"https://"+hostname);
        if (incoming.host !== hostname) return fail(res,400,"INVALID_INPUT","预览路径无效。");
        if (incoming.searchParams.has("open")) {
          const hash = createHash("sha256").update(incoming.searchParams.get("open")).digest("hex");
          if (gateway && (!preview.claims || preview.openUntil <= Date.now())) return fail(res,403,"DEVICE_APPROVAL_REQUIRED","请在已配对的浏览器中打开预览。");
          if (preview.tokenHash !== hash) return fail(res,403,"INVALID_TOKEN","预览链接已使用或无效。");
          preview.tokenHash = null;
          if (gateway) await gateway.lease(preview.claims);
          preview.session = randomBytes(32).toString("hex");
          res.writeHead(303,{location:"/","set-cookie":"__Host-kooyuPreview="+preview.session+"; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=900"});
          return res.end();
        }
        if (!preview.session || !String(req.headers.cookie ?? "").split(/;\s*/).includes("__Host-kooyuPreview="+preview.session))
          return fail(res,403,"INVALID_TOKEN","请使用本机生成的预览链接。");
      }
      if (!preview && hostname !== publicUrl.host)
        return fail(res, 421, "INVALID_HOST", "访问地址不正确。");
      if (!preview && req.headers.origin && req.headers.origin !== publicUrl.origin)
        return fail(res, 403, "INVALID_ORIGIN", "访问来源未授权。");
      const url = new URL(req.url, origin);
      if (!preview && url.pathname === "/healthz" && req.method === "GET")
        return json(res, 200, { service: "kooyu-relay", status: "ok", version: 1 });
      if (limited(req, "http", 600))
        return fail(res, 429, "RATE_LIMITED", "请求过多，请稍后再试。");
      if(gateway && !preview && url.pathname.startsWith("/v1/browser/"))return await browserAccount(req,res,url,gateway.issuer,origin);
      const delivery = new RegExp("^/v2/mailbox/(" + ID + ")$").exec(url.pathname);
      if (!preview && url.pathname === "/v2/push/key" && req.method === "GET") return json(res,200,{publicKey:push.publicKey});
      if (gateway && url.pathname === "/v1/nonce" && req.method === "POST") return json(res,200,{nonce:gateway.nonce()});
      if (delivery && req.method === "POST") {
        let authorizedDevice;
        if (gateway) {
          try { authorizedDevice=(await gateway.access(req,delivery[1])).pairedClientId; } catch(error) { return accessFailure(res,error); }
        }
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 32768) return fail(res, 413, "TOO_LARGE", "投递内容超过上限。");
          chunks.push(chunk);
        }
        let envelope;
        try { envelope = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
        catch { return fail(res, 400, "INVALID_INPUT", "投递格式无效。"); }
        if(gateway && authorizedDevice!==envelope?.deviceId)return fail(res,403,"DEVICE_REVOKED","设备身份不匹配。");
        const status = mailbox.put(delivery[1], envelope);
        if (status >= 400) return fail(res, status, "MAILBOX_REJECTED", "投递未被接受。");
        return json(res, status, { commandId: envelope.commandId });
      }
      const match = preview ? ["",preview.host.id,url.pathname] : new RegExp("^/h/(" + ID + ")(/api(?:/[^\\s]*)?)$").exec(url.pathname);
      if (match) {
        // An enrolled Host must never execute HTML/JS on this shared origin.
        res.setHeader(
          "content-security-policy",
          preview ? previewCsp : "default-src 'none'; sandbox; frame-ancestors 'none'",
        );
        if (preview) {
          res.setHeader("origin-agent-cluster", "?1");
          res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
        }
        const [, hostId, path] = match;
        let claims;
        if (gateway) {
          try { claims=preview ? preview.claims : await gateway.access(req,hostId,["/api/health","/api/secure/key","/api/secure/channel","/api/pair","/api/pair/native"].includes(path)); } catch(error) { return accessFailure(res,error); }
          if(preview) {
            try { await gateway.lease(claims); } catch(error) { return accessFailure(res,error); }
          }
          const lease=setInterval(()=>gateway.lease(claims).catch(()=>res.destroy()),15000);
          lease.unref();res.once("close",()=>clearInterval(lease));
        }
        if (!["GET", "POST", "PATCH", "PUT", "DELETE"].includes(req.method))
          return fail(res, 405, "INVALID_METHOD", "不支持此方法。");
        if (/^\/api\/pair(?:\/native)?$/.test(path) && limited(req, "pair", 20))
          return fail(res, 429, "RATE_LIMITED", "配对尝试过多，请稍后再试。");
        const host = hosts.get(hostId);
        if (!host)
          return fail(res, 503, "HOST_OFFLINE", "设备未连接。请确认设备已联网并开启手机连接。");
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
        if (hosts.get(hostId) !== host) return fail(res, 503, "HOST_OFFLINE", "设备连接已断开。");
        if (!preview && path === "/api/ws-ticket") {
          if (req.method !== "POST" || req.headers.origin !== publicUrl.origin || !claims?.pairedClientId)
            return fail(res,403,"DEVICE_APPROVAL_REQUIRED","事件连接需要已授权的浏览器。");
          const cookie = new RegExp("(?:^|;\\s*)kooyu_" + hostId + "=([A-Za-z0-9_-]{40,100})(?:;|$)").exec(req.headers.cookie ?? "")?.[1];
          if (!cookie) return fail(res,403,"DEVICE_APPROVAL_REQUIRED","请先完成本地配对。");
          const {after} = JSON.parse(Buffer.concat(chunks).toString());
          if (!Number.isSafeInteger(after) || after < 0) return fail(res,400,"INVALID_CURSOR","事件游标无效。");
          if (upgrades.size >= maxPending) return fail(res,503,"RELAY_BUSY","连接繁忙。");
          const ticket=randomBytes(32).toString("base64url");
          upgrades.set(ticket,{host,claims,cookie,after,expires:Date.now()+30000});
          return json(res,200,{ticket});
        }
        if (!preview && path === "/api/preview/redeem") {
          if (!gateway || !claims?.deviceId || req.method !== "POST") return fail(res,403,"DEVICE_APPROVAL_REQUIRED","请先授权此设备。");
          const body=JSON.parse(Buffer.concat(chunks).toString("utf8"));
          const entry=previews.get(body.id);
          if (!entry || entry.host!==host || entry.claims || entry.expires<=Date.now() ||
              typeof body.open!=="string" || createHash("sha256").update(body.open).digest("hex")!==entry.tokenHash)
            return fail(res,403,"INVALID_TOKEN","预览链接无效或已使用。");
          const open=randomBytes(32).toString("base64url");
          entry.claims=claims;entry.openUntil=Date.now()+30000;
          entry.tokenHash=createHash("sha256").update(open).digest("hex");
          return json(res,200,{url:"https://"+body.id+"."+previewDomain+"/?open="+open});
        }
        // Recheck after asynchronous body reads; simultaneous requests share the cap.
        if (host.requests.size >= 128 || pending.size >= maxPending)
          return fail(res, 503, "RELAY_BUSY", "连接繁忙，请稍后再试。");
        const headers = {};
        if(claims)headers["x-kooyu-device-context"]=claims.pairId ? "pair:"+claims.pairId+":"+claims.cnf.jkt : "device:"+claims.pairedClientId;
        for (const name of requestHeaders)
          if (typeof req.headers[name] === "string") headers[name] = req.headers[name];
        const token = new RegExp("(?:^|;\\s*)kooyu_" + hostId + "=([A-Za-z0-9_-]+)(?:;|$)").exec(
          req.headers.cookie ?? "",
        )?.[1];
        if (token) headers.cookie = "kodo_device=" + token;
        const id = randomUUID();
        const streamId = host.nextStream++;
        if (host.nextStream > 0xffffffff) host.nextStream = 1;
        const p = { streamId, host, hostId, res, preview:!!preview, sealed:!preview && path === "/api/secure/channel", timer: undefined, streaming: false, started: false };
        pending.set(id, p);
        host.streams.set(streamId, id);
        host.requests.add(id);
        touch(id);
        res.on("close", () => release(id, true));
        if (
          !send(host.ws, {
            type: "request",
            streamId,
            id,
            method: req.method,
            path: path + url.search,
            headers:preview ? {} : headers,
            ...(preview ? {previewId} : {}),
            body: Buffer.concat(chunks).toString("base64"),
          })
        ) {
          release(id);
          if (host.ws.readyState === WebSocket.OPEN)
            return fail(res, 503, "RELAY_BUSY", "连接繁忙，请稍后再试。");
          return fail(res, 503, "HOST_OFFLINE", "设备连接不可用。");
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
      if (url.pathname === "/") {
        if (gateway?.issuer && String(req.headers.accept ?? "").includes("text/html")) {
          res.writeHead(302, {
            location: gateway.issuer + "/account/hosts",
            "cache-control": "no-store",
          });
          return res.end();
        }
        return json(res, 200, {
          service: "kooyu-relay",
          message: "请登录 Kooyu 工作台连接你的工作电脑，或使用移动端 App 扫码/登录连接。",
        });
      }
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
      if (!/^\/(?:assets\/|art\/|icon\.svg$|sw\.js$|account-worker\.js$)/.test(url.pathname))
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
  server.on("upgrade", async (req, socket, head) => {
    const browserPath=new RegExp("^/h/("+ID+")/api/events/ws$").exec(req.url);
    if(browserPath){
      const reject=()=>socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      if(closing || req.headers.host!==publicUrl.host || req.headers.origin!==publicUrl.origin ||
          limited(req,"ws-upgrade",60) || browserSockets.clients.size>=maxPending) return reject();
      const protocols=String(req.headers["sec-websocket-protocol"]??"").split(",").map(v=>v.trim());
      const token=protocols.find(p=>p.startsWith("kooyu.ticket."))?.slice(13);
      const grant=upgrades.get(token);
      if(!protocols.includes("kooyu.events.v1") || !grant || grant.expires<=Date.now() ||
          grant.host!==hosts.get(browserPath[1]))return reject();
      upgrades.delete(token);
      try {await gateway.lease(grant.claims);}catch{return reject();}
      if(socket.destroyed || closing || hosts.get(browserPath[1])!==grant.host ||
          grant.host.requests.size>=128 || pending.size>=maxPending)return reject();
      browserSockets.handleUpgrade(req,socket,head,ws=>{
        const id=randomUUID(), host=grant.host,streamId=host.nextStream++;
        if(host.nextStream>0xffffffff)host.nextStream=1;
        const output={
          get writableLength(){return ws.bufferedAmount;},get destroyed(){return ws.readyState!==WebSocket.OPEN;},
          get headersSent(){return pending.get(id)?.started??true;},
          destroy(){ws.terminate();},setHeader(){},flushHeaders(){},
          writeHead(status){if(status!==200 || !pending.get(id)?.streaming)ws.close(4403,"Stream unavailable");},
          write(data){if(ws.readyState===WebSocket.OPEN)ws.send(data);},end(){ws.close();}
        };
        const lease=setInterval(()=>gateway.lease(grant.claims).catch(()=>ws.close(4403,"Lease expired")),15000);
        lease.unref();ws.on("error",()=>{});ws.on("message",()=>ws.close(1008,"Read only"));
        ws.once("close",()=>{clearInterval(lease);release(id,true);});
        pending.set(id,{streamId,host,hostId:host.id,res:output,streaming:true,started:false});
        host.streams.set(streamId,id);host.requests.add(id);touch(id);
        if(!send(host.ws,{type:"request",streamId,id,method:"GET",path:"/api/events?after="+grant.after,
            headers:{cookie:"kodo_device="+grant.cookie,"x-kooyu-device-context":"device:"+grant.claims.pairedClientId},body:""}))
          ws.close(1013,"Relay busy");
      });
      return;
    }
    if (
      closing ||
      !["/v1/host","/v2/host"].includes(req.url) ||
      req.headers.host !== publicUrl.host ||
      req.headers.origin ||
      wss.clients.size >= maxHosts + 32 ||
      limited(req, "upgrade", 30)
    ) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const version = req.url === "/v2/host" ? 2 : 1;
      if (version === 2) v2.add(ws);
      const challenge = "kooyu-relay-v" + version + ":" + randomBytes(32).toString("base64url");
      let host,
        alive = true;
      let authenticating = false;
      const timer = setTimeout(() => ws.close(1008, "Authentication timeout"), 10000);
      timer.unref();
      ws.on("error", () => {});
      ws.on("pong", () => {
        alive = true;
      });
      const heartbeat = setInterval(() => {
        if(host && gateway){
          const received=ws._socket.bytesRead,sent=ws._socket.bytesWritten;
          const metric={id:randomUUID(),received:received-host.received,sent:sent-host.sent};
          void gateway.lease(host.claims,{metric}).then(()=>{host.received=received;host.sent=sent}).catch(()=>ws.close(4403,"Lease expired"));
        }
        if (!alive) return ws.terminate();
        alive = false;
        ws.ping();
      }, 20000);
      heartbeat.unref();
      send(ws, { type: "challenge", challenge, version });
      ws.on("message", async (raw, binary) => {
        try {
          if (binary !== (version === 2)) throw new Error("Unexpected encoding");
          if (binary) {
            if (raw.length < 6) throw new Error("Short header");
            const type = raw[0], stream = raw.readUInt32BE(1);
            if (type === 2 || type === 3) {
              if (!host || !stream || raw.length > 262150) throw new Error("Invalid stream");
              const id = host.streams.get(stream), p = pending.get(id);
              if (!p || !p.started) return;
              if (p.res.writableLength > MAX_BODY) {
                release(id, true); p.res.destroy(); return;
              }
              touch(id); p.res.write(raw.subarray(6)); return;
            }
            if (type !== 1 || raw[5] !== 0) throw new Error("Invalid control frame");
          }
          const m = JSON.parse((binary ? raw.subarray(6) : raw).toString());
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
            if (authenticating) return ws.close(4403,"Authentication pending");
            authenticating = true;
            let claims;
            if (gateway) {
              try { claims=await gateway.uplink(m.ticket,id); } catch {return ws.close(4403,"Account required");}
              if(ws.readyState!==1)return;
            }
            if (hosts.has(id) || hosts.size >= maxHosts) {
              ws.close(1013, "Already connected or capacity reached");
              return;
            }
            clearTimeout(timer);
            host = { id, ws, claims,received:0,sent:0, requests: new Set(), streams: new Map(), nextStream: 1 };
            hosts.set(id, host);
            send(ws, { type: "ready", hostId: id, version, ...(version === 2 && previewDomain ? {previewDomain} : {}) });
            return;
          }
          if (version === 2 && previewDomain && m.type === "preview.register") {
            if (!/^[a-f0-9]{32}$/.test(m.previewId) || !/^[a-f0-9]{64}$/.test(m.tokenHash) || previews.has(m.previewId) ||
                !Number.isSafeInteger(m.expires) || m.expires <= Date.now() || m.expires > Date.now()+900000 || previews.size >= 4096)
              throw Error("Invalid preview registration");
            previews.set(m.previewId,{host,tokenHash:m.tokenHash,expires:m.expires}); return;
          }
          if (version === 2 && m.type === "mailbox.register") {
            mailbox.register(host.id, m.deviceId, m.publicKey, m.expiresAt);
            return;
          }
          if (version === 2 && m.type === "mailbox.sync") {
            mailbox.sync(host.id, m.devices);
            return;
          }
          if (version === 2 && m.type === "push.subscribe") {
            push.subscribe(host.id,m.deviceId,m.endpoint);
            return;
          }
          if (version === 2 && m.type === "push.unsubscribe") {
            push.unsubscribe(host.id,m.deviceId);
            return;
          }
          if (version === 2 && m.type === "push.wake") {
            void push.wake(host.id,m.deviceId).catch(() => {});
            return;
          }
          if (version === 2 && m.type === "mailbox.revoke") {
            mailbox.revoke(host.id, m.deviceId);
            return;
          }
          if (version === 2 && m.type === "mailbox.pull") {
            if(host.pulling)return;host.pulling=true;
            try{for (const envelope of mailbox.pending(host.id)){
              if(gateway){try{await gateway.lease(host.claims,{pairedClientId:envelope.deviceId})}catch{continue}}
              if (!send(ws, { type: "mailbox.delivery", envelope })) break;
            }}finally{host.pulling=false}
            return;
          }
          if (version === 2 && m.type === "mailbox.ack") {
            mailbox.ack(host.id, m.commandId);
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
              p.sealed && type === "application/octet-stream" ? type : p.preview ? type.split(";")[0] : p.streaming
                ? "text/event-stream"
                : type.startsWith("application/json")
                  ? "application/json"
                  : "text/plain; charset=utf-8",
            );
            if (p.streaming) p.res.setHeader("x-accel-buffering", "no");
            const cookie = /^kodo_device=([A-Za-z0-9_-]{40,100});/.exec(
              String(m.headers?.["set-cookie"] ?? ""),
            );
            if (cookie && !p.preview)
              p.res.setHeader(
                "set-cookie",
                "kooyu_" +
                  p.hostId +
                  "=" +
                  cookie[1] +
                  "; HttpOnly; SameSite=Lax; Secure; Path=/h/" +
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
            fail(p.res, 502, "HOST_REQUEST_FAILED", "设备连接中断，请核对操作结果。");
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
            if (p) fail(p.res, 503, "HOST_OFFLINE", "设备连接已断开，请核对操作结果。");
          }
      });
    });
  });
  const prune = setInterval(() => {
    for (const [id,p] of previews) if (p.expires <= Date.now() || hosts.get(p.host.id) !== p.host) previews.delete(id);
    for (const [key,v] of upgrades) if(v.expires<=Date.now())upgrades.delete(key);
    mailbox.prune();
    for (const [k, v] of rates) if (v.until <= Date.now()) rates.delete(k);
  }, 60000);
  prune.unref();
  return {
    server,
    hosts,
    async close() {
      closing = true;
      clearInterval(prune);
      upgrades.clear();for(const ws of browserSockets.clients)ws.terminate();
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
      mailbox.close();
    },
  };
}

