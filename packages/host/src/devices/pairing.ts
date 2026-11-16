import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { KodoError } from "@kodo/protocol";
import type { Store } from "../storage/store.js";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export const DEVICE_TOKEN_TTL_MS = 30 * 86400000;
export class Pairing {
  private invitation: { digest: string; expiresAt: number; attempts: number } | undefined;
  constructor(
    private readonly store: Store,
    private readonly now = Date.now,
  ) {}
  create() {
    const code = randomBytes(16).toString("hex").toUpperCase();
    this.invitation = { digest: hash(code), expiresAt: this.now() + 120000, attempts: 0 };
    return { code, expiresAt: new Date(this.invitation.expiresAt).toISOString() };
  }
  pair(code: string, name: string) {
    const i = this.invitation;
    if (
      !i ||
      this.now() >= i.expiresAt ||
      i.attempts++ >= 5 ||
      !timingSafeEqual(Buffer.from(hash(code.toUpperCase())), Buffer.from(i.digest))
    )
      throw new KodoError("UNAUTHORIZED", "配对码无效或已过期，请在桌面重新生成。");
    this.invitation = undefined;
    const id = randomUUID(),
      token = randomBytes(32).toString("base64url"),
      device = {
        id,
        name: name.slice(0, 100) || "手机",
        createdAt: new Date(this.now()).toISOString(),
        expiresAt: new Date(this.now() + DEVICE_TOKEN_TTL_MS).toISOString(),
      };
    this.store.transaction(() => {
      this.store.put("device-secret", id, { ...device, digest: hash(token) });
      this.store.put("device-public", id, device);
    });
    return { token, device };
  }
  invalidate(): void {
    this.invitation = undefined;
  }
  authenticate(token: string): boolean {
    const digest = hash(token);
    return this.store
      .records<{ digest: string; createdAt: string; expiresAt?: string }>("device-secret")
      .some((d) => {
        const expiry = d.expiresAt
          ? Date.parse(d.expiresAt)
          : Date.parse(d.createdAt) + DEVICE_TOKEN_TTL_MS;
        return (
          Number.isFinite(expiry) &&
          this.now() < expiry &&
          timingSafeEqual(Buffer.from(d.digest), Buffer.from(digest))
        );
      });
  }
  deviceId(token: string): string | undefined {
    if (!this.authenticate(token)) return undefined;
    const digest = hash(token);
    return this.store
      .records<{ id: string; digest: string }>("device-secret")
      .find((d) => d.digest === digest)?.id;
  }
  revoke(id: string): void {
    this.store.transaction(() => {
      this.store.remove("device-secret", id);
      this.store.remove("device-public", id);
      this.store.remove("client-access", id);
    });
  }
}
