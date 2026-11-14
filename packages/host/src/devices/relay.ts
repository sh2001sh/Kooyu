import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
} from "node:crypto";
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { request, type ClientRequest } from "node:http";
import { KodoError } from "@kodo/protocol";
import { Entry } from "@napi-rs/keyring";

export const DEFAULT_RELAY_ORIGIN = "https://relay.kooyu.app";
export type RemoteStatus = {
  enabled: boolean;
  state: "disabled" | "connecting" | "connected";
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
  private retry?: ReturnType<typeof setTimeout>;
  private handshake?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private connected = false;
  private attempts = 0;
  private upstreamPort = 0;
  private readonly requests = new Map<string, ClientRequest>();
  private readonly file: string;
  private readonly vault: RelayVault;
  private privateKey?: string;

  constructor(
    dataDir: string,
    origin = DEFAULT_RELAY_ORIGIN,
    allowInsecureTest = false,
    vault?: RelayVault,
  ) {
    const url = new URL(origin);
    if (
      (url.protocol !== "https:" &&
        !(allowInsecureTest && url.protocol === "http:" && url.hostname === "127.0.0.1")) ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      throw new Error("Relay requires an HTTPS origin without paths or credentials.");
    this.origin = url.origin;
    this.file = join(dataDir, "relay-identity.json");
    this.vault =
      vault ?? new Entry("Kooyu", "relay:" + createHash("sha256").update(this.file).digest("hex"));
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
      enabled: this.identity?.enabled === true,
      state: this.connected ? "connected" : this.identity?.enabled ? "connecting" : "disabled",
      origin: this.origin,
      ...(this.hostId ? { url: this.origin + "/h/" + this.hostId + "/" } : {}),
    };
  }
  start(upstreamPort: number): void {
    this.upstreamPort = upstreamPort;
    if (this.identity?.enabled) this.connect();
  }
  private save(): void {
    const temp = this.file + ".tmp";
    writeFileSync(temp, JSON.stringify(this.identity), { mode: 0o600 });
    renameSync(temp, this.file);
  }
  async enable(): Promise<string> {
    if (this.stopped || !this.upstreamPort)
      throw new KodoError("UNAVAILABLE", "远程连接尚未就绪，请稍后重试。");
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
        enabled: true,
      };
      this.save();
    } else if (!this.identity.enabled) {
      this.identity.enabled = true;
      this.save();
    }
    this.loadPrivateKey();
    this.connect();
    const deadline = Date.now() + 12000;
    while (!this.connected && !this.stopped && this.identity.enabled && Date.now() < deadline)
      await new Promise((done) => setTimeout(done, 100));
    if (!this.connected)
      throw new KodoError(
        "UNAVAILABLE",
        "暂时无法连接中继。请检查网络后重新生成配对码，或关闭远程连接。",
      );
    return this.status().url!;
  }
  disable(): void {
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
    clearTimeout(this.retry);
    clearTimeout(this.handshake);
    this.retry = undefined;
    this.connected = false;
    const socket = this.socket;
    this.socket = undefined;
    socket?.close();
    for (const request of this.requests.values()) request.destroy();
    this.requests.clear();
  }
  private send(socket: WebSocket, message: Frame): boolean {
    if (
      socket !== this.socket ||
      socket.readyState !== WebSocket.OPEN ||
      socket.bufferedAmount > 4 * 1024 * 1024
    )
      return false;
    socket.send(JSON.stringify(message));
    return true;
  }
  private connect(): void {
    if (this.stopped || !this.identity?.enabled || this.socket || this.retry) return;
    const url = new URL("/v1/host", this.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url);
    this.socket = socket;
    this.handshake = setTimeout(() => socket.close(), 15000);
    this.handshake.unref();
    socket.addEventListener("error", () => {
      /* close drives retry; never log credentials or frames */
    });
    socket.addEventListener("close", () => {
      if (this.socket !== socket) return;
      this.disconnect();
      if (!this.stopped && this.identity?.enabled) {
        const delay =
          Math.min(30000, 1000 * 2 ** Math.min(this.attempts++, 5)) + Math.random() * 500;
        this.retry = setTimeout(() => {
          this.retry = undefined;
          this.connect();
        }, delay);
        this.retry.unref();
      }
    });
    socket.addEventListener("message", (event) => {
      if (socket !== this.socket) return;
      try {
        if (typeof event.data !== "string" || event.data.length > 2 * 1024 * 1024)
          throw new Error("Invalid frame");
        const m = JSON.parse(event.data) as Frame;
        if (m.type === "challenge" && !this.connected) {
          if (
            m.version !== 1 ||
            typeof m.challenge !== "string" ||
            !m.challenge.startsWith("kooyu-relay-v1:") ||
            m.challenge.length > 100
          )
            throw new Error("Invalid challenge");
          this.send(socket, {
            type: "authenticate",
            publicKey: this.identity!.publicKey,
            signature: sign(null, Buffer.from(m.challenge), this.loadPrivateKey()).toString(
              "base64",
            ),
          });
        } else if (m.type === "ready" && m.hostId === this.hostId && m.version === 1) {
          clearTimeout(this.handshake);
          this.connected = true;
          this.attempts = 0;
        } else if (this.connected && m.type === "cancel") this.requests.get(m.id)?.destroy();
        else if (this.connected && m.type === "request") this.forward(socket, m);
        else throw new Error("Unexpected frame");
      } catch {
        socket.close(1008, "Invalid protocol");
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
    if (
      typeof m.id !== "string" ||
      m.id.length > 64 ||
      this.requests.has(m.id) ||
      this.requests.size >= 128 ||
      typeof m.path !== "string" ||
      m.path.length > 8192 ||
      !m.path.startsWith("/api/") ||
      !["GET", "POST", "PATCH", "PUT", "DELETE"].includes(m.method) ||
      typeof m.body !== "string" ||
      m.body.length > 1400000
    )
      throw new Error("Invalid request");
    const parsed = new URL(m.path, "http://localhost");
    if (!parsed.pathname.startsWith("/api/") || parsed.origin !== "http://localhost")
      throw new Error("Invalid API path");
    const headers: Record<string, string> = {
      host: new URL(this.origin).host,
      "x-forwarded-for": "relay",
    };
    for (const name of [
      "content-type",
      "authorization",
      "origin",
      "last-event-id",
      "x-kooyu-protocol",
      "cookie",
    ]) {
      if (typeof m.headers?.[name] === "string" && m.headers[name].length <= 16384)
        headers[name] = m.headers[name];
    }
    const body = Buffer.from(m.body, "base64");
    if (body.length > 1024 * 1024) throw new Error("Body too large");
    if (body.length) headers["content-length"] = String(body.length);
    const upstream = request(
      {
        hostname: "127.0.0.1",
        port: this.upstreamPort,
        method: m.method,
        path: parsed.pathname + parsed.search,
        headers,
      },
      (res) => {
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
                data: chunk.subarray(offset, offset + 48 * 1024).toString("base64"),
              })
            ) {
              upstream.destroy();
              socket.close(1013, "Backpressure");
              break;
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
