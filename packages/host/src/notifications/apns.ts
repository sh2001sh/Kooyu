import { createHash, createPrivateKey, randomUUID, sign, type KeyObject } from "node:crypto";
import { connect, type ClientHttp2Stream, type OutgoingHttpHeaders } from "node:http2";
import { z } from "zod";
import { KodoError, type NotificationItem, type NotificationDelivery } from "@kodo/protocol";
import type { ProviderVault } from "../providers/service.js";
import type { Store } from "../storage/store.js";

interface Configuration {
  revision: number;
  enabled: boolean;
  teamId: string;
  keyId: string;
  topic: string;
  environment: "sandbox" | "production";
  credentialRef: string;
}
const configurationSchema = z
  .object({
    expectedRevision: z.number().int().min(0),
    enabled: z.boolean(),
    teamId: z.string().regex(/^[A-Z0-9]{10}$/),
    keyId: z.string().regex(/^[A-Z0-9]{10}$/),
    topic: z
      .string()
      .min(3)
      .max(255)
      .regex(/^[A-Za-z0-9-]+(?:[.][A-Za-z0-9-]+)+$/),
    environment: z.enum(["sandbox", "production"]),
    privateKey: z.string().min(1).max(16384).optional(),
  })
  .strict();
export interface ApnsRequest {
  origin: "https://api.push.apple.com" | "https://api.sandbox.push.apple.com";
  path: string;
  headers: OutgoingHttpHeaders;
  body: string;
  signal: AbortSignal;
}
export type ApnsTransport = (request: ApnsRequest) => Promise<{ status: number; body: string }>;

/** One bounded, certificate-verified HTTP/2 connection. Never follows redirects. */
export function createApnsHttp2Transport(connector: typeof connect = connect): ApnsTransport {
  return (input) =>
    new Promise((resolve, reject) => {
      input.signal.throwIfAborted();
      const session = connector(input.origin);
      let stream: ClientHttp2Stream | undefined;
      let settled = false;
      const finish = (error?: Error, result?: { status: number; body: string }) => {
        if (settled) return;
        settled = true;
        input.signal.removeEventListener("abort", abort);
        stream?.destroy();
        session.destroy();
        if (error) reject(error);
        else resolve(result!);
      };
      const abort = () => finish(new Error("APNs request timed out or was cancelled"));
      input.signal.addEventListener("abort", abort, { once: true });
      session.on("error", () => finish(new Error("APNs TLS/HTTP2 connection failed")));
      session.on("close", () => finish(new Error("APNs connection closed before response")));
      session.on("goaway", () => finish(new Error("APNs connection drained")));
      session.once("connect", () => {
        if (settled) return;
        try {
          stream = session.request({ ...input.headers, ":method": "POST", ":path": input.path });
          let status = 0;
          let length = 0;
          const chunks: Buffer[] = [];
          stream.on("response", (headers) => {
            status = Number(headers[":status"] ?? 0);
          });
          stream.on("data", (chunk: Buffer) => {
            length += chunk.length;
            if (length > 16384) finish(new Error("APNs response exceeded limit"));
            else chunks.push(chunk);
          });
          stream.on("error", () => finish(new Error("APNs request failed")));
          stream.on("end", () =>
            finish(undefined, { status, body: Buffer.concat(chunks).toString("utf8") }),
          );
          stream.on("close", () => finish(new Error("APNs response interrupted")));
          stream.end(input.body);
        } catch {
          finish(new Error("APNs request could not start"));
        }
      });
    });
}
export const apnsHttp2Transport = createApnsHttp2Transport();

export type ApnsResult =
  | { kind: "accepted" }
  | { kind: "cancelled" }
  | { kind: "failed" | "retry" | "invalid-device"; error: string };

function signingKey(value: string): KeyObject {
  try {
    const key = createPrivateKey(value);
    if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1")
      throw new Error("wrong curve");
    return key;
  } catch {
    throw new KodoError("INVALID_INPUT", "APNs 私钥必须是有效的 P-256 PEM 签名密钥。");
  }
}

/** Credentials stay in the configured Vault; devices can register tokens, never signing keys. */
export class ApnsProvider {
  private cached?: { ref: string; token: string; issuedAt: number };
  constructor(
    private readonly store: Store,
    private readonly vault: ProviderVault,
    private readonly transport: ApnsTransport = apnsHttp2Transport,
  ) {}
  private config() {
    return this.store.record<Configuration>("notification-provider", "apns");
  }
  status() {
    const c = this.config();
    if (!c) return { configured: false, enabled: false, revision: 0 };
    const { credentialRef: _ref, ...publicConfig } = c;
    return { ...publicConfig, configured: true };
  }
  async configure(value: unknown, invalidate: () => void) {
    const p = configurationSchema.parse(value);
    const old = this.config();
    if ((old?.revision ?? 0) !== p.expectedRevision)
      throw new KodoError("CONFLICT", "APNs 配置已修改。");
    if (!p.privateKey && (!old || old.teamId !== p.teamId || old.keyId !== p.keyId))
      throw new KodoError("INVALID_INPUT", "首次配置或更换 APNs 签名身份需要私钥。");
    let ref = old?.credentialRef;
    if (p.privateKey) {
      signingKey(p.privateKey);
      ref = "notification:apns:" + randomUUID();
      await this.vault.set(ref, p.privateKey);
    }
    try {
      this.store.transaction(() => {
        if ((this.config()?.revision ?? 0) !== p.expectedRevision)
          throw new KodoError("CONFLICT", "APNs 配置已修改。");
        this.store.put("notification-provider", "apns", {
          enabled: p.enabled,
          revision: p.expectedRevision + 1,
          teamId: p.teamId,
          keyId: p.keyId,
          topic: p.topic,
          environment: p.environment,
          credentialRef: ref!,
        } satisfies Configuration);
        invalidate();
      });
    } catch (error) {
      if (ref && ref !== old?.credentialRef) await this.vault.delete(ref).catch(() => {});
      throw error;
    }
    this.cached = undefined;
    if (old?.credentialRef && old.credentialRef !== ref)
      await this.vault.delete(old.credentialRef).catch(() => {});
    return this.status();
  }
  async send(
    deviceToken: string,
    providerRevision: number,
    item: NotificationItem,
    delivery: NotificationDelivery,
    preview: boolean,
    allowed: () => boolean,
  ): Promise<ApnsResult> {
    const c = this.config();
    if (!c?.enabled || c.revision !== providerRevision) return { kind: "cancelled" };
    if (!/^(?:[a-f0-9]{2}){16,256}$/.test(deviceToken))
      return { kind: "invalid-device", error: "APNs 设备令牌无效" };
    const privateKey = await this.vault.get(c.credentialRef);
    if (!privateKey) return { kind: "failed", error: "APNs 签名凭据不可用" };
    const now = Math.floor(Date.now() / 1000);
    if (
      !this.cached ||
      this.cached.ref !== c.credentialRef ||
      now - this.cached.issuedAt >= 3000 ||
      now < this.cached.issuedAt
    ) {
      const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: c.keyId })).toString(
        "base64url",
      );
      const claims = Buffer.from(JSON.stringify({ iss: c.teamId, iat: now })).toString("base64url");
      const message = header + "." + claims;
      const signature = sign("sha256", Buffer.from(message), {
        key: signingKey(privateKey),
        dsaEncoding: "ieee-p1363",
      });
      this.cached = {
        ref: c.credentialRef,
        issuedAt: now,
        token: message + "." + signature.toString("base64url"),
      };
    }
    const body = JSON.stringify({
      aps: {
        alert: {
          title: item.title,
          body: preview ? (item.preview ?? "Kooyu 有新事项") : "请打开 Kooyu 查看",
        },
        sound: "default",
        "thread-id": "kooyu",
      },
      kooyu: { hostId: item.link.hostId, notificationId: item.id },
    });
    if (Buffer.byteLength(body) > 4096) return { kind: "failed", error: "APNs 通知超过 4096 字节" };
    if (!allowed() || this.config()?.revision !== c.revision) return { kind: "cancelled" };
    const identity = createHash("sha256").update(delivery.id).digest();
    identity[6] = (identity[6]! & 0x0f) | 0x50;
    identity[8] = (identity[8]! & 0x3f) | 0x80;
    const digest = identity.toString("hex");
    const response = await this.transport({
      origin:
        c.environment === "production"
          ? "https://api.push.apple.com"
          : "https://api.sandbox.push.apple.com",
      path: "/3/device/" + deviceToken,
      headers: {
        authorization: "bearer " + this.cached.token,
        "apns-topic": c.topic,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "apns-expiration": String(Math.floor(Date.parse(delivery.expiresAt) / 1000)),
        "apns-collapse-id": createHash("sha256").update(item.id).digest("hex"),
        "apns-id": `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`,
        "content-type": "application/json",
      },
      body,
      signal: AbortSignal.timeout(15000),
    });
    if (response.status === 200) return { kind: "accepted" };
    let reason: unknown;
    try {
      reason = (JSON.parse(response.body) as { reason?: unknown }).reason;
    } catch {
      /* Treat malformed provider failures by HTTP status. */
    }
    if (
      (response.status === 410 && reason === "Unregistered") ||
      (response.status === 400 &&
        ["BadDeviceToken", "DeviceTokenNotForTopic"].includes(String(reason)))
    )
      return { kind: "invalid-device", error: "APNs 设备令牌失效，请在设备上重新注册" };
    if (response.status === 429 || response.status === 500 || response.status === 503)
      return { kind: "retry", error: "APNs 暂时不可用，将有限重试" };
    // Never persist the provider response body, token, request path or signing identity.
    return {
      kind: "failed",
      error: "APNs 拒绝通知（HTTP " + response.status + "），请核对服务端配置",
    };
  }
}
