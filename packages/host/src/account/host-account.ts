import {
  createHash,
  randomUUID,
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
  sign,
} from "node:crypto";
import { hostname } from "node:os";
import { SignJWT, calculateJwkThumbprint } from "jose";
import { KodoError } from "@kodo/protocol";
import { secretVault } from "../credentials/vault.js";

type Pending = {
  deviceCode: string;
  userCode: string;
  nonce: string;
  expires: number;
  next: number;
  interval: number;
};
type Binding = { key: string; hostId?: string; renewal?: string };
export type HostAccountStatus = {
  configured: boolean;
  bound: boolean;
  origin: string;
  hostId?: string;
  pending?: { userCode: string; verificationUri: string; expiresAt: number };
};
export class HostAccount {
  private pending?: Pending;
  private generation = 0;
  private polling = false;
  constructor(
    readonly origin: string,
    readonly localId: string,
    private readonly relayKey: () => string,
  ) {
    const url = new URL(origin);
    if (url.origin !== origin || url.protocol !== "https:")
      throw Error("Account service requires a configured HTTPS origin");
  }
  private get vaultId() {
    return "binding:" + this.localId + ":" + this.origin;
  }
  private read(create = false): Binding {
    const value = secretVault().getSync("Kooyu", this.vaultId);
    if (value) return JSON.parse(value);
    if (!create) throw new KodoError("UNAUTHORIZED", "请先登录 Kooyu 并绑定电脑。");
    const key = generateKeyPairSync("ec", { namedCurve: "P-256" })
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString();
    const binding = { key };
    this.save(binding);
    return binding;
  }
  private save(b: Binding) {
    secretVault().setSync("Kooyu", this.vaultId, JSON.stringify(b));
  }
  private async post(path: string, body: unknown, headers: Record<string, string> = {}) {
    const response = await fetch(this.origin + "/api/device-auth/v1/" + path, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(8000),
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    if (response.status === 429)
      throw new KodoError(
        "UNAVAILABLE",
        "账号请求过于频繁，请在 " +
          (Number(response.headers.get("retry-after")) || 60) +
          " 秒后重试。",
      );
    if (!response.ok)
      throw new KodoError(
        response.status === 403 ? "UNAUTHORIZED" : "UNAVAILABLE",
        "账号服务返回 " + response.status + "，请重新检查授权。",
      );
    return response.json();
  }
  private async headers(path: string, b: Binding, token: string, nonce: string) {
    const privateKey = createPrivateKey(b.key),
      jwk = createPublicKey(privateKey).export({ format: "jwk" });
    const dpop = await new SignJWT({
      htu: this.origin + "/api/device-auth/v1/" + path,
      htm: "POST",
      nonce,
      ath: createHash("sha256").update(token).digest("base64url"),
    })
      .setProtectedHeader({ alg: "ES256", typ: "dpop+jwt", jwk })
      .setJti(randomUUID())
      .setIssuedAt()
      .sign(privateKey);
    return { authorization: "DPoP " + token, dpop };
  }
  async start() {
    const gen = ++this.generation;
    this.pending = undefined;
    const b = this.read(true),
      jkt = await calculateJwkThumbprint(createPublicKey(b.key).export({ format: "jwk" }));
    const relayPublicKey = createPublicKey(this.relayKey())
      .export({ type: "spki", format: "pem" })
      .toString();
    const result = await this.post("start", {
      localId: this.localId,
      relayPublicKey,
      jkt,
      name: hostname(),
      platform: process.platform,
      version: process.env.npm_package_version ?? "development",
    });
    if (gen !== this.generation) throw new KodoError("UNAVAILABLE", "此授权申请已取消。");
    this.pending = {
      deviceCode: result.deviceCode,
      userCode: result.userCode,
      expires: Date.now() + result.expiresIn * 1000,
      next: Date.now() + result.interval * 1000,
      interval: result.interval,
      nonce: result.nonce,
    };
    return {
      userCode: result.userCode,
      verificationUri: this.activationUrl(result.userCode),
      expiresAt: this.pending.expires,
    };
  }
  private activationUrl(userCode: string) {
    return this.origin + "/activate?code=" + encodeURIComponent(userCode);
  }
  status(): HostAccountStatus {
    let hostId: string | undefined;
    let bound = false;
    try {
      const raw = secretVault().getSync("Kooyu", this.vaultId);
      if (raw) {
        const parsed = JSON.parse(raw) as Binding;
        if (parsed.hostId) hostId = parsed.hostId;
        bound = Boolean(parsed.hostId && parsed.renewal);
      }
    } catch {
      /* Vault may be locked or unavailable; report unbound without throwing. */
    }
    const activePending =
      this.pending && this.pending.expires > Date.now()
        ? {
            userCode: this.pending.userCode,
            verificationUri: this.activationUrl(this.pending.userCode),
            expiresAt: this.pending.expires,
          }
        : undefined;
    return {
      configured: true,
      bound,
      origin: this.origin,
      ...(hostId ? { hostId } : {}),
      ...(activePending ? { pending: activePending } : {}),
    };
  }
  async cancel() {
    const p = this.pending;
    this.generation++;
    this.pending = undefined;
    if (p) {
      const b = this.read();
      await this.post(
        "cancel",
        { deviceCode: p.deviceCode },
        await this.headers("cancel", b, p.deviceCode, p.nonce),
      );
    }
  }
  async logout() {
    await this.cancel();
    const b = this.read();
    await this.hostRequest("pairing/logout");
    this.save({ key: b.key });
  }
  async poll() {
    const p = this.pending;
    if (!p || Date.now() > p.expires)
      throw new KodoError("UNAVAILABLE", "授权已到期，请重新发起。");
    if (this.polling || Date.now() < p.next) return { state: "pending", interval: p.interval };
    this.polling = true;
    try {
      const b = this.read(),
        jkt = await calculateJwkThumbprint(createPublicKey(b.key).export({ format: "jwk" }));
      const relaySignature = sign(
        null,
        Buffer.from("kooyu:bind:v1:" + p.nonce + ":" + jkt),
        this.relayKey(),
      ).toString("base64url");
      const result = await this.post(
        "poll",
        { deviceCode: p.deviceCode, relaySignature },
        await this.headers("poll", b, p.deviceCode, p.nonce),
      );
      if (this.pending !== p) throw new KodoError("UNAVAILABLE", "此授权申请已取消。");
      if (result.state === "approved") {
        this.save({ ...b, hostId: result.hostId, renewal: result.renewal });
        this.pending = undefined;
        return { state: "approved" };
      }
      p.interval = result.interval;
      p.next = Date.now() + p.interval * 1000;
      return { state: result.state, interval: p.interval };
    } finally {
      this.polling = false;
    }
  }
  async hostRequest(path: string, body: Record<string, unknown> = {}) {
    const b = this.read();
    if (!b.renewal) throw new KodoError("UNAUTHORIZED", "此电脑尚未绑定账号。");
    const { nonce } = await this.post("nonce", {});
    return this.post(path, { ...body, nonce }, await this.headers(path, b, b.renewal, nonce));
  }
  ensureBound() {
    const binding = this.read();
    if (!binding.hostId || !binding.renewal)
      throw new KodoError("UNAUTHORIZED", "请先登录 Kooyu 并绑定电脑。");
  }
  async ticket() {
    const b = this.read();
    if (!b.renewal || !b.hostId) throw new KodoError("UNAUTHORIZED", "请先登录 Kooyu 并绑定电脑。");
    const { nonce } = await this.post("nonce", {});
    const { ticket, renewal } = await this.post(
      "ticket",
      { nonce, hostId: b.hostId, role: "host", rotate: true },
      await this.headers("ticket", b, b.renewal, nonce),
    );
    if (renewal && this.read().renewal === b.renewal) this.save({ ...b, renewal });
    return ticket;
  }
}
