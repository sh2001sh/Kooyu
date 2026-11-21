import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
} from "node:crypto";
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { request, type ClientRequest } from "node:http";
import { KodoError } from "@kodo/protocol";
import { secretVault } from "../credentials/vault.js";

import { HostAccount, type HostAccountStatus } from "../account/host-account.js";
import { RelayWriter } from "./relay-writer.js";
import { distribution } from "../distribution.js";

export const DEFAULT_RELAY_ORIGIN = distribution.relay?.origin ?? "";
export type RemoteStatus = {
  enabled: boolean;
  state: "disabled" | "connecting" | "connected" | "limited" | "blocked";
  configured: boolean;
  accountRequired?: boolean;
  account?: HostAccountStatus;
  problem?: { code: string; message: string; retryAt?: number };
  url?: string;
  origin: string;
};
type Identity = { publicKey: string; enabled: boolean };
export interface RelayVault {
  getPassword(): string | null;
  setPassword(value: string): void;
}
type Frame = Record<string, any>;

/** The private loopback upstream MUST use forceRemote: true, never the desktop handler. */
export class RelayConnector {
  readonly origin: string;
  private identity?: Identity;
  private socket?: WebSocket;
  private writer?: RelayWriter;
  private retry?: ReturnType<typeof setTimeout>;
  private handshake?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private connected = false;
  private readonly version: 1 | 2;
  private attempts = 0;
  private upstreamPort = 0;
  private readonly requests = new Map<string, ClientRequest>();
  private readonly file: string;
  private readonly vault: RelayVault;
  private privateKey?: string;
  account?: HostAccount;
  private accountRequired = false;
  requireAccount() {
    this.accountRequired = true;
  }
  configureAccount(origin: string, localId: string) {
    this.account = new HostAccount(origin, localId, () => {
      this.prepareIdentity();
      return this.loadPrivateKey();
    });
  }
  private mailboxDevices?: () => Array<{
    id: string;
    expiresAt: string;
    mailboxVerifyPubKey?: string;
  }>;
  private mailboxDelivery?: (host: string, envelope: unknown) => void;
  private mailboxPoll?: ReturnType<typeof setInterval>;
  private problem?: RemoteStatus["problem"];
  private previewDomain?: string;
  get previewAvailable() {
    return this.connected && !!this.previewDomain;
  }
  private previews = new Map<string, { url: URL; expires: number }>();

  sharePreview(result: { url: string; expiresAt: string }) {
    if (!this.previewDomain || !this.connected || !this.socket)
      throw new KodoError("UNAVAILABLE", "Relay 尚未配置独立的预览域名。");
    const url = new URL(result.url),
      id = url.hostname.split(".")[0]!;
    if (!/^[a-f0-9]{32}\.localhost$/.test(url.hostname) || url.protocol !== "http:" || !url.port)
      throw new KodoError("INVALID_INPUT", "需要本机创建的隔离预览。");
    const expires = Date.parse(result.expiresAt);
    for (const [key, value] of this.previews)
      if (value.expires <= Date.now()) this.previews.delete(key);
    this.previews.set(id, { url, expires });
    const token = randomBytes(32).toString("base64url");
    if (
      !this.send(this.socket, {
        type: "preview.register",
        previewId: id,
        tokenHash: createHash("sha256").update(token).digest("hex"),
        expires,
      })
    )
      throw new KodoError("UNAVAILABLE", "预览连接繁忙。");
    return {
      ...result,
      url: this.origin + "/h/" + this.hostId + "/#preview=" + id + "&open=" + token,
    };
  }

  setMailboxDelivery(deliver: (host: string, envelope: unknown) => void) {
    this.mailboxDelivery = deliver;
  }
  get mailboxEnabled() {
    return this.version === 2;
  }
  encryptionIdentity(encryptionKey: string) {
    if (!this.identity || !this.mailboxEnabled)
      throw new KodoError("UNSUPPORTED", "此 Host 未开启 Relay v2。");
    const signature = sign(
      null,
      Buffer.from("kooyu-tunnel-v2:" + encryptionKey),
      this.loadPrivateKey(),
    ).toString("base64");
    return { publicKey: this.identity.publicKey, encryptionKey, signature };
  }
  pushDevice(deviceId: string, endpoint?: string, wake = false) {
    if (!this.socket || !this.connected || this.version !== 2) return false;
    return this.send(this.socket, {
      type: wake ? "push.wake" : endpoint ? "push.subscribe" : "push.unsubscribe",
      deviceId,
      endpoint,
    });
  }

  setMailboxDevices(read: NonNullable<RelayConnector["mailboxDevices"]>) {
    this.mailboxDevices = read;
  }

  syncMailboxDevices() {
    if (!this.socket || !this.connected || this.version !== 2 || !this.mailboxDevices) return;
    const devices = this.mailboxDevices().filter(
      (d) => d.mailboxVerifyPubKey && Date.parse(d.expiresAt) > Date.now(),
    );
    if (
      !this.send(this.socket, {
        type: "mailbox.sync",
        devices: devices.map((d) => ({
          deviceId: d.id,
          publicKey: d.mailboxVerifyPubKey,
          expiresAt: Date.parse(d.expiresAt),
        })),
      })
    )
      this.socket.close(4001, "Resync required");
  }

  constructor(
    dataDir: string,
    origin = DEFAULT_RELAY_ORIGIN,
    allowInsecureTest = false,
    vault?: RelayVault,
  ) {
    const url = origin ? new URL(origin) : undefined;
    if (
      url &&
      ((url.protocol !== "https:" &&
        !(allowInsecureTest && url.protocol === "http:" && url.hostname === "127.0.0.1")) ||
        url.pathname !== "/" ||
        url.search ||
        url.hash ||
        url.username ||
        url.password)
    )
      throw new Error("Relay requires an HTTPS origin without paths or credentials.");
    this.origin = url?.origin ?? "";
    this.version =
      process.env.KOOYU_RELAY_PROTOCOL === "2" ||
      (process.env.KOOYU_RELAY_PROTOCOL === undefined &&
        this.origin === DEFAULT_RELAY_ORIGIN &&
        distribution.relay?.protocol === 2)
        ? 2
        : 1;
    this.file = join(dataDir, "relay-identity.json");
    this.vault =
      vault ??
      (() => {
        const account = "relay:" + createHash("sha256").update(this.file).digest("hex");
        return {
          getPassword: () => secretVault().getSync("Kooyu", account),
          setPassword: (value: string) => secretVault().setSync("Kooyu", account, value),
        };
      })();
    if (existsSync(this.file)) {
      const i = JSON.parse(readFileSync(this.file, "utf8")) as Identity;
      if (typeof i.publicKey !== "string" || typeof i.enabled !== "boolean")
        throw new Error("Invalid saved Relay identity.");
      this.identity = i;
    }
  }

  private get hostId(): string | undefined {
    return this.identity
      ? createHash("sha256").update(Buffer.from(this.identity.publicKey, "base64")).digest("hex")
      : undefined;
  }
  status(): RemoteStatus {
    return {
      enabled: Boolean(this.origin) && this.identity?.enabled === true,
      configured: Boolean(this.origin),
      accountRequired: this.accountRequired,
      account: this.account
        ? this.account.status()
        : { configured: false, bound: false, origin: "" },
      state:
        !this.origin || !this.identity?.enabled
          ? "disabled"
          : this.problem
            ? this.problem.code === "IDENTITY_REVOKED"
              ? "blocked"
              : "limited"
            : this.connected
              ? "connected"
              : "connecting",
      ...(this.problem ? { problem: this.problem } : {}),
      origin: this.origin,
      ...(this.hostId ? { url: this.origin + "/h/" + this.hostId + "/" } : {}),
    };
  }
  start(upstreamPort: number): void {
    this.upstreamPort = upstreamPort;
    if (this.identity?.enabled && (!this.accountRequired || this.account)) this.connect();
  }
  private save(): void {
    const temp = this.file + ".tmp";
    writeFileSync(temp, JSON.stringify(this.identity), { mode: 0o600 });
    renameSync(temp, this.file);
  }
  private prepareIdentity() {
    if (!this.identity) {
      const keys = generateKeyPairSync("ed25519");
      const secret = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
      try {
        this.vault.setPassword(secret);
      } catch {
        throw new KodoError("UNAVAILABLE", "无法保存设备身份，请解锁系统凭据库后重试。");
      }
      this.privateKey = secret;
      this.identity = {
        publicKey: keys.publicKey.export({ type: "spki", format: "der" }).toString("base64"),
        enabled: false,
      };
      this.save();
    }
  }
  async enable(): Promise<string> {
    if (this.accountRequired && !this.account)
      throw new KodoError("UNAUTHORIZED", "开启远程连接需要配置 Kooyu 账号服务。");
    if (!this.origin)
      throw new KodoError("UNAVAILABLE", "此构建未配置 Relay。请使用官方发行版或配置自建 Relay。");
    if (this.stopped || !this.upstreamPort)
      throw new KodoError("UNAVAILABLE", "远程连接尚未就绪，请稍后重试。");
    if (this.accountRequired && this.account) await this.account.ensureBound();
    this.prepareIdentity();
    if (!this.identity) throw new Error("Missing Relay identity");
    if (!this.identity.enabled) {
      this.identity.enabled = true;
      this.save();
    }
    this.loadPrivateKey();
    if (this.problem) this.disconnect();
    this.problem = undefined;
    this.connect();
    const deadline = Date.now() + 12000;
    while (
      !this.connected &&
      !this.problem &&
      !this.stopped &&
      this.identity.enabled &&
      Date.now() < deadline
    )
      await new Promise((done) => setTimeout(done, 100));
    const problem = this.status().problem;
    if (problem) throw new KodoError("UNAVAILABLE", problem.message);
    if (!this.connected)
      throw new KodoError(
        "UNAVAILABLE",
        "暂时无法连接中继。请检查网络后重新生成配对码，或关闭远程连接。",
      );
    return this.status().url!;
  }
  disable(): void {
    this.problem = undefined;
    if (this.identity) {
      this.identity.enabled = false;
      this.save();
    }
    this.disconnect();
  }
  stop(): void {
    this.stopped = true;
    this.disconnect();
  }
  private disconnect(): void {
    clearInterval(this.mailboxPoll);
    this.previewDomain = undefined;
    this.previews.clear();
    clearTimeout(this.retry);
    clearTimeout(this.handshake);
    this.retry = undefined;
    this.connected = false;
    const socket = this.socket;
    this.writer?.close();
    this.writer = undefined;
    this.socket = undefined;
    socket?.close();
    for (const request of this.requests.values()) request.destroy();
    this.requests.clear();
  }
  private packet(message: Frame, media = false) {
    const header = Buffer.alloc(6);
    header[0] = message.type === "chunk" ? (media ? 3 : 2) : 1;
    header.writeUInt32BE(message.streamId ?? 0, 1);
    header[5] = media ? 1 : 0;
    return Buffer.concat([header, message.bytes ?? Buffer.from(JSON.stringify(message))]);
  }

  private send(socket: WebSocket, message: Frame): boolean {
    if (socket !== this.socket || socket.readyState !== WebSocket.OPEN) return false;
    if (this.writer) return this.writer.reliable(this.packet(message));
    if (socket.bufferedAmount > 4 * 1024 * 1024) return false;
    socket.send(JSON.stringify(message));
    return true;
  }
  private connect(): void {
    if (!this.origin || this.stopped || !this.identity?.enabled || this.socket || this.retry)
      return;
    const url = new URL("/v" + this.version + "/host", this.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    if (this.version === 2) this.writer = new RelayWriter(socket);
    this.handshake = setTimeout(() => socket.close(), 15000);
    this.handshake.unref();
    socket.addEventListener("error", () => {
      /* close drives retry; never log credentials or frames */
    });
    socket.addEventListener("close", (event) => {
      if (this.socket !== socket) return;
      if (!this.problem && (event.code === 4403 || event.code === 4429))
        this.problem = {
          code: event.code === 4403 ? "IDENTITY_REVOKED" : "RELAY_QUOTA_EXCEEDED",
          message:
            event.code === 4403
              ? "此设备的远程连接权限已停用。"
              : "远程连接暂时受限，请稍后重试；本地任务继续运行。",
        };
      this.disconnect();
      if (!this.stopped && this.identity?.enabled && this.problem?.code !== "IDENTITY_REVOKED") {
        const delay = this.problem
          ? Math.min(
              3600000,
              Math.max(60000, (this.problem.retryAt ?? Date.now() + 60000) - Date.now()),
            )
          : Math.min(30000, 1000 * 2 ** Math.min(this.attempts++, 5)) + Math.random() * 500;
        this.retry = setTimeout(() => {
          this.retry = undefined;
          this.connect();
        }, delay);
        this.retry.unref();
      }
    });
    socket.addEventListener("message", async (event) => {
      if (socket !== this.socket) return;
      try {
        let text: string;
        if (this.version === 2) {
          if (!(event.data instanceof ArrayBuffer) || event.data.byteLength > 2 * 1024 * 1024)
            throw new Error("Invalid binary frame");
          const data = Buffer.from(event.data);
          if (data.length < 6 || data[0] !== 1 || data[5] !== 0)
            throw new Error("Invalid control header");
          text = data.subarray(6).toString("utf8");
        } else {
          if (typeof event.data !== "string" || event.data.length > 2 * 1024 * 1024)
            throw new Error("Invalid frame");
          text = event.data;
        }
        const m = JSON.parse(text) as Frame;
        if (
          m.type === "relay.error" &&
          typeof m.code === "string" &&
          typeof m.message === "string"
        ) {
          this.problem = {
            code: m.code.slice(0, 80),
            message: m.message.slice(0, 400),
            ...(Number.isSafeInteger(m.retryAt) && m.retryAt > Date.now()
              ? { retryAt: m.retryAt }
              : {}),
          };
        } else if (m.type === "challenge" && !this.connected) {
          if (
            m.version !== this.version ||
            typeof m.challenge !== "string" ||
            !m.challenge.startsWith("kooyu-relay-v" + this.version + ":") ||
            m.challenge.length > 100
          )
            throw new Error("Invalid challenge");
          this.send(socket, {
            type: "authenticate",
            ...(this.account ? { ticket: await this.account.ticket() } : {}),
            publicKey: this.identity!.publicKey,
            signature: sign(null, Buffer.from(m.challenge), this.loadPrivateKey()).toString(
              "base64",
            ),
          });
        } else if (m.type === "ready" && m.hostId === this.hostId && m.version === this.version) {
          clearTimeout(this.handshake);
          this.problem = undefined;
          this.connected = true;
          if (
            this.version === 2 &&
            typeof m.previewDomain === "string" &&
            /^[a-z0-9.-]+$/.test(m.previewDomain) &&
            m.previewDomain !== new URL(this.origin).hostname
          )
            this.previewDomain = m.previewDomain;
          this.attempts = 0;
          this.syncMailboxDevices();
          if (this.version === 2 && this.mailboxDelivery) {
            const pull = () => this.send(socket, { type: "mailbox.pull" });
            pull();
            this.mailboxPoll = setInterval(pull, 15000);
            this.mailboxPoll.unref();
          }
        } else if (
          this.connected &&
          this.version === 2 &&
          this.mailboxDelivery &&
          m.type === "mailbox.delivery"
        ) {
          try {
            this.mailboxDelivery(this.hostId!, m.envelope);
            this.send(socket, { type: "mailbox.ack", commandId: m.envelope.commandId });
          } catch {
            /* Retain unacknowledged mail through transient Host failures. */
          }
        } else if (this.connected && m.type === "cancel") this.requests.get(m.id)?.destroy();
        else if (this.connected && m.type === "request") this.forward(socket, m);
        else throw new Error("Unexpected frame");
      } catch {
        // WHATWG WebSocket clients only accept 1000 or application codes 3000–4999.
        socket.close(4008, "Invalid protocol");
      }
    });
  }
  private loadPrivateKey(): string {
    try {
      const key = this.privateKey ?? this.vault.getPassword();
      if (
        !key ||
        createPublicKey(createPrivateKey(key))
          .export({ type: "spki", format: "der" })
          .toString("base64") !== this.identity?.publicKey
      )
        throw new Error("Missing key");
      this.privateKey = key;
      return key;
    } catch {
      throw new KodoError("UNAVAILABLE", "无法读取设备身份，请解锁系统凭据库后重试。");
    }
  }
  private forward(socket: WebSocket, m: Frame): void {
    const preview = m.previewId ? this.previews.get(m.previewId) : undefined;
    if (m.previewId && (!preview || preview.expires <= Date.now() || m.method !== "GET")) {
      this.send(socket, { type: "error", id: m.id });
      return;
    }
    if (
      typeof m.id !== "string" ||
      m.id.length > 64 ||
      this.requests.has(m.id) ||
      this.requests.size >= 128 ||
      typeof m.path !== "string" ||
      m.path.length > 8192 ||
      !(preview ? m.path.startsWith("/") : m.path.startsWith("/api/")) ||
      !["GET", "POST", "PATCH", "PUT", "DELETE"].includes(m.method) ||
      typeof m.body !== "string" ||
      m.body.length > 1400000
    )
      throw new Error("Invalid request");
    const parsed = new URL(m.path, "http://localhost");
    if ((!preview && !parsed.pathname.startsWith("/api/")) || parsed.origin !== "http://localhost")
      throw new Error("Invalid API path");
    const headers: Record<string, string> = {
      host: preview?.url.host ?? new URL(this.origin).host,
      "x-forwarded-for": "relay",
    };
    for (const name of [
      "content-type",
      "authorization",
      "origin",
      "last-event-id",
      "x-kooyu-protocol",
      "x-kooyu-device-context",
      "cookie",
    ]) {
      if (!preview && typeof m.headers?.[name] === "string" && m.headers[name].length <= 16384)
        headers[name] = m.headers[name];
    }
    const body = Buffer.from(m.body, "base64");
    if (body.length > 1024 * 1024) throw new Error("Body too large");
    if (body.length) headers["content-length"] = String(body.length);
    const upstream = request(
      {
        hostname: "127.0.0.1",
        port: preview ? Number(preview.url.port) : this.upstreamPort,
        method: m.method,
        path: parsed.pathname + parsed.search,
        headers,
      },
      (res) => {
        const writer = this.writer;
        if (
          writer &&
          !preview &&
          m.method === "GET" &&
          res.statusCode === 200 &&
          /^\/api\/browsers\/[^/]+\/frame$/.test(parsed.pathname)
        ) {
          const head = this.packet({
            type: "head",
            id: m.id,
            status: 200,
            headers: { "content-type": "application/json" },
          });
          const end = this.packet({ type: "end", id: m.id });
          const parts = [head];
          let size = 0;
          const drop = () => {
            writer.reliable(head);
            writer.reliable(
              this.packet({
                type: "chunk",
                streamId: m.streamId,
                bytes: Buffer.from('{"dropped":true}'),
              }),
            );
            writer.reliable(end);
          };
          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size <= 1024 * 1024) {
              for (let i = 0; i < chunk.length; i += 48 * 1024)
                parts.push(
                  this.packet(
                    {
                      type: "chunk",
                      streamId: m.streamId,
                      bytes: chunk.subarray(i, i + 48 * 1024),
                    },
                    true,
                  ),
                );
            }
          });
          res.on("end", () => {
            if (size > 1024 * 1024) drop();
            else writer.picture([...parts, end], drop);
          });
          res.on("error", () => this.send(socket, { type: "error", id: m.id }));
          return;
        }
        if (
          !this.send(socket, {
            type: "head",
            id: m.id,
            status: res.statusCode,
            headers: {
              "content-type": res.headers["content-type"],
              "set-cookie": res.headers["set-cookie"]?.[0],
            },
          })
        ) {
          upstream.destroy();
          return;
        }
        res.on("data", (chunk: Buffer) => {
          for (let offset = 0; offset < chunk.length; offset += 48 * 1024)
            if (
              !this.send(socket, {
                type: "chunk",
                id: m.id,
                streamId: m.streamId,
                ...(this.version === 2
                  ? { bytes: chunk.subarray(offset, offset + 48 * 1024) }
                  : { data: chunk.subarray(offset, offset + 48 * 1024).toString("base64") }),
              })
            ) {
              upstream.destroy();
              if (this.version === 1) socket.close(4013, "Backpressure");
              break;
            }
          if (writer?.congested) {
            res.pause();
            const cleanup = () => {
              clearInterval(resume);
              res.off("close", cleanup);
            };
            const resume = setInterval(() => {
              if (!writer.congested || res.destroyed) {
                cleanup();
                if (!res.destroyed) res.resume();
              }
            }, 10);
            res.once("close", cleanup);
          }
        });
        res.on("end", () => this.send(socket, { type: "end", id: m.id }));
        res.on("error", () => this.send(socket, { type: "error", id: m.id }));
      },
    );
    this.requests.set(m.id, upstream);
    upstream.setTimeout(60000, () => upstream.destroy());
    upstream.on("error", () => this.send(socket, { type: "error", id: m.id }));
    upstream.on("close", () => this.requests.delete(m.id));
    upstream.end(body.length ? body : undefined);
  }
}
