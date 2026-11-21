import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  createHash,
  randomUUID,
} from "node:crypto";
import { SignJWT, calculateJwkThumbprint } from "jose";
import { app, clipboard, dialog, shell } from "electron";

export type DeviceCredential = {
  hostId: string;
  key: string;
  renewal: string;
  directOrigin?: string;
};
type Invitation = { transaction: string; claim: string; hostId: string };
function config() {
  const d = app.isPackaged
    ? JSON.parse(readFileSync(join(process.resourcesPath, "host", "distribution.json"), "utf8"))
    : {};
  const issuer = process.env.KOOYU_ACCOUNT_ORIGIN ?? d.accountOrigin,
    relay = process.env.KOOYU_RELAY_ORIGIN ?? process.env.KODO_RELAY_ORIGIN ?? d.relay?.origin;
  if (
    !issuer ||
    new URL(issuer).origin !== issuer ||
    !issuer.startsWith("https://") ||
    !relay ||
    new URL(relay).origin !== relay ||
    !relay.startsWith("https://")
  )
    throw Error("未配置受信任的账号服务和 Relay。");
  return { issuer, relay };
}
export function accountConfigured(): boolean {
  try {
    config();
    return true;
  } catch {
    return false;
  }
}
const hash = (v: string) => createHash("sha256").update(v).digest("base64url");
export class DesktopAccount {
  persistRenewal?: (updated: DeviceCredential) => void;
  private ticket?: { value: string; until: number };
  private loading?: Promise<string>;
  constructor(
    private readonly base: URL,
    readonly credential: DeviceCredential,
    private invitation?: Invitation,
  ) {
    if (!invitation && base.origin !== config().relay && base.origin !== credential.directOrigin)
      throw Error("配对邀请与配置的 Relay 不匹配。");
  }
  private async post(path: string, body: unknown, headers: Record<string, string> = {}) {
    const r = await fetch(config().issuer + "/api/device-auth/v1/" + path, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw Error("设备授权失败 (" + r.status + ")");
    return r.json();
  }
  private proof(htu: string, htm: string, nonce: string, token: string) {
    const key = createPrivateKey(this.credential.key);
    return new SignJWT({ htu, htm, nonce, ath: hash(token) })
      .setIssuedAt()
      .setJti(randomUUID())
      .setProtectedHeader({
        alg: "ES256",
        typ: "dpop+jwt",
        jwk: createPublicKey(key).export({ format: "jwk" }),
      })
      .sign(key);
  }
  private async pair(path: string) {
    const inv = this.invitation!;
    const dpop = await this.proof(
      config().issuer + "/api/device-auth/v1/" + path,
      "POST",
      hash(inv.claim),
      inv.claim,
    );
    return this.post(
      path,
      { transactionId: inv.transaction, secret: inv.claim, name: "Kooyu Desktop" },
      { dpop },
    );
  }
  static async discover() {
    const { issuer, relay } = config();
    const pair = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const key = pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const client = new DesktopAccount(new URL(relay), { key, renewal: "", hostId: "" });
    const jkt = await calculateJwkThumbprint(pair.publicKey.export({ format: "jwk" }));
    const login = await client.post("discovery/start", { name: "Kooyu Desktop", jkt });
    const activationUrl = issuer + "/activate?code=" + encodeURIComponent(login.userCode);
    try {
      clipboard.writeText(login.userCode);
    } catch {
      /* ignore */
    }
    const confirmation = await dialog.showMessageBox({
      message: "登录 Kooyu 账号",
      detail:
        "将在浏览器打开官网授权页并自动填入授权码：" +
        login.userCode +
        "\n（授权码已同时复制到剪贴板）",
      buttons: ["前往官网授权", "取消"],
      cancelId: 1,
    });
    if (confirmation.response !== 0) return;
    await shell.openExternal(activationUrl);
    const deadline = Date.now() + 300000;
    let token = "";
    while (Date.now() < deadline && !token) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const dpop = await client.proof(
        issuer + "/api/device-auth/v1/discovery/poll",
        "POST",
        hash(login.deviceCode),
        login.deviceCode,
      );
      const result = await client.post(
        "discovery/poll",
        { deviceCode: login.deviceCode },
        { authorization: "DPoP " + login.deviceCode, dpop },
      );
      token = result.token ?? "";
    }
    if (!token) throw Error("登录请求已到期。");
    async function authorized(step: string, body: Record<string, string> = {}) {
      const path = "discovery/" + step;
      const { nonce } = await client.post("nonce", {});
      const dpop = await client.proof(issuer + "/api/device-auth/v1/" + path, "POST", nonce, token);
      return client.post(path, { ...body, nonce }, { authorization: "DPoP " + token, dpop });
    }
    const hosts: { name: string; id: string; relay_id: string }[] = [];
    let cursor: string | undefined;
    do {
      const page = await authorized("hosts", cursor ? { cursor } : {});
      hosts.push(...page.items.filter((host: { enabled: boolean }) => host.enabled));
      cursor = page.nextCursor;
    } while (cursor);
    if (!hosts.length) throw Error("账号下暂无可连接的电脑。");
    let offset = 0;
    while (true) {
      const page = hosts.slice(offset, offset + 5);
      const more = offset + page.length < hosts.length;
      const buttons = [...page.map((h) => h.name), ...(more ? ["下一页"] : []), "取消"];
      const { response } = await dialog.showMessageBox({
        message: "选择工作电脑",
        detail: "选择后请在该电脑上批准连接。",
        buttons,
        cancelId: buttons.length - 1,
      });
      if (response === buttons.length - 1) return;
      if (response === page.length) {
        offset += page.length;
        continue;
      }
      const host = page[response];
      if (!host) return;
      const result = await authorized("request", { hostId: host.id, name: "Kooyu Desktop" });
      const url = new URL("/h/" + host.relay_id + "/", relay);
      url.hash = new URLSearchParams({
        pair: "REQUEST",
        transaction: result.transactionId,
        claim: result.secret,
        host: host.id,
      }).toString();
      return url.href;
    }
  }
  static async start(base: URL, inv: Invitation) {
    const key = generateKeyPairSync("ec", { namedCurve: "P-256" })
      .privateKey.export({ format: "pem", type: "pkcs8" })
      .toString();
    const account = new DesktopAccount(base, { key, hostId: inv.hostId, renewal: "" }, inv);
    const deadline = Date.now() + 300000;
    let result = await account.pair("pairing/claim");
    while (result.state === "approval_required") {
      if (Date.now() >= deadline) throw Error("电脑批准请求已到期。");
      await new Promise((resolve) => setTimeout(resolve, 5000));
      result = await account.pair("pairing/claim");
    }
    if (base.origin !== config().relay) {
      if (
        result.directOrigin !== base.origin ||
        !base.pathname.startsWith("/h/" + result.relayHostId + "/")
      )
        throw Error("电脑直连地址与账号记录不匹配。");
      account.credential.directOrigin = base.origin;
    }
    return account;
  }
  async logout() {
    const token = this.credential.renewal;
    const { nonce } = await this.post("nonce", {});
    const dpop = await this.proof(
      config().issuer + "/api/device-auth/v1/logout",
      "POST",
      nonce,
      token,
    );
    await this.post("logout", { nonce }, { authorization: "DPoP " + token, dpop });
    this.ticket = undefined;
  }
  async finish() {
    const result = await this.pair("pairing/finish");
    if (result.state !== "active") throw Error("电脑尚未确认设备。");
    this.credential.renewal = result.renewal;
    this.invitation = undefined;
    this.ticket = undefined;
  }
  private async issue() {
    const { nonce } = await this.post("nonce", {});
    const token = this.invitation?.claim ?? this.credential.renewal;
    const dpop = await this.proof(
      config().issuer + "/api/device-auth/v1/ticket",
      "POST",
      nonce,
      token,
    );
    const result = await this.post(
      "ticket",
      {
        hostId: this.credential.hostId,
        nonce,
        role: this.invitation ? "pair" : "device",
        rotate: !!this.persistRenewal,
      },
      { authorization: "DPoP " + token, dpop },
    );
    if (result.renewal) {
      this.credential.renewal = result.renewal;
      this.persistRenewal?.(this.credential);
    }
    this.ticket = { value: result.ticket, until: Date.now() + 540000 };
    return result.ticket;
  }
  async headers(url: URL, method: string) {
    if (url.origin !== this.base.origin) throw Error("远程地址不匹配。");
    const token =
      this.ticket && this.ticket.until > Date.now()
        ? this.ticket.value
        : await (this.loading ??= this.issue().finally(() => (this.loading = undefined)));
    const response = await fetch(new URL("/v1/nonce", url), {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw Error("远程服务暂时不可用。");
    const { nonce } = await response.json();
    return {
      "x-kooyu-ticket": token,
      "x-kooyu-purpose": this.invitation ? "pair" : "access",
      dpop: await this.proof(url.origin + url.pathname, method, nonce, token),
    };
  }
}
