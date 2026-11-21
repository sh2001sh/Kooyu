import {
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  verify,
} from "node:crypto";
import { z } from "zod";
import type { SessionService } from "../session-service.js";
import { secretVault } from "../credentials/vault.js";

const envelopeSchema = z
  .object({
    deviceId: z.string().uuid(),
    commandId: z.string().uuid(),
    expiresAt: z.number().int(),
    ciphertext: z
      .string()
      .regex(/^[\w-]+$/)
      .max(32768),
    signature: z.string().regex(/^[\w-]{86}$/),
  })
  .strict();
export class DeviceMailbox {
  constructor(private readonly service: SessionService) {}
  key() {
    const vault = secretVault(),
      account = "mailbox:" + this.service.store.hostId;
    let pem = vault.getSync("Kooyu", account);
    if (!pem) {
      pem = generateKeyPairSync("x25519")
        .privateKey.export({ type: "pkcs8", format: "pem" })
        .toString();
      vault.setSync("Kooyu", account, pem);
    }
    return createPrivateKey(pem);
  }
  publicKey() {
    return createPublicKey(this.key()).export({ type: "spki", format: "der" }).toString("base64");
  }
  deliver(host: string, raw: unknown) {
    const m = envelopeSchema.parse(raw);
    const device = this.service.store.record<{ mailboxVerifyPubKey?: string; expiresAt: string }>(
      "device-public",
      m.deviceId,
    );
    const now = Date.now();
    if (
      !device?.mailboxVerifyPubKey ||
      Date.parse(device.expiresAt) <= now ||
      m.expiresAt <= now ||
      m.expiresAt > now + 12 * 3600000
    )
      return;
    const fields = ["kooyu-mailbox-v2", host, m.deviceId, m.commandId, m.expiresAt];
    const key = createPublicKey({
      key: Buffer.from(device.mailboxVerifyPubKey, "base64"),
      type: "spki",
      format: "der",
    });
    if (
      !verify(
        null,
        Buffer.from(JSON.stringify([...fields, m.ciphertext])),
        key,
        Buffer.from(m.signature, "base64url"),
      )
    )
      return;
    const bytes = Buffer.from(m.ciphertext, "base64url");
    // Ephemeral X25519 SPKI (44 bytes), nonce (12), ciphertext, GCM tag (16).
    if (bytes.length < 73) return;
    const privateKey = this.key();
    let input;
    try {
      const peer = createPublicKey({ key: bytes.subarray(0, 44), format: "der", type: "spki" });
      if (peer.asymmetricKeyType !== "x25519") return;
      const secret = diffieHellman({ privateKey, publicKey: peer });
      const aad = Buffer.from(JSON.stringify(fields));
      const aes = Buffer.from(hkdfSync("sha256", secret, bytes.subarray(44, 56), aad, 32));
      const decipher = createDecipheriv("aes-256-gcm", aes, bytes.subarray(44, 56));
      decipher.setAAD(aad);
      decipher.setAuthTag(bytes.subarray(-16));
      input = z
        .object({ sessionId: z.string().uuid(), text: z.string().min(1).max(16000) })
        .strict()
        .parse(
          JSON.parse(
            Buffer.concat([decipher.update(bytes.subarray(56, -16)), decipher.final()]).toString(
              "utf8",
            ),
          ),
        );
    } catch {
      return;
    }
    this.service.acceptSend(input.sessionId, {
      requestId: m.commandId,
      text: input.text,
      mode: "queue",
    });
  }
}
