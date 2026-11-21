export type LocalKeys = { signingKey: CryptoKey; encryptionKey: string; deviceId: string };
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const url64 = (bytes: Uint8Array) =>
  encode(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const utf8 = new TextEncoder();

export async function sealMailboxMessage(
  host: string,
  local: LocalKeys,
  sessionId: string,
  text: string,
) {
  const commandId = crypto.randomUUID(),
    expiresAt = Date.now() + 12 * 3600000;
  const fields = ["kooyu-mailbox-v2", host, local.deviceId, commandId, expiresAt];
  const aad = utf8.encode(JSON.stringify(fields));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const hostKey = await crypto.subtle.importKey(
    "spki",
    Uint8Array.from(atob(local.encryptionKey), (c) => c.charCodeAt(0)),
    "X25519",
    false,
    [],
  );
  const ephemeral = (await crypto.subtle.generateKey("X25519", false, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const shared = await crypto.subtle.deriveBits(
    { name: "X25519", public: hostKey },
    ephemeral.privateKey,
    256,
  );
  const hkdf = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  const aes = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: nonce, info: aad },
    hkdf,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const body = utf8.encode(JSON.stringify({ sessionId, text }));
  if (body.length > 23500 || text.length > 16000) throw Error("离线消息超过大小限制。");
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: aad },
    aes,
    body,
  );
  const publicBytes = new Uint8Array(await crypto.subtle.exportKey("spki", ephemeral.publicKey));
  const packet = new Uint8Array(publicBytes.length + nonce.length + encrypted.byteLength);
  packet.set(publicBytes);
  packet.set(nonce, publicBytes.length);
  packet.set(new Uint8Array(encrypted), publicBytes.length + nonce.length);
  const ciphertext = url64(packet);
  const signature = url64(
    new Uint8Array(
      await crypto.subtle.sign(
        "Ed25519",
        local.signingKey,
        utf8.encode(JSON.stringify([...fields, ciphertext])),
      ),
    ),
  );
  return { deviceId: local.deviceId, commandId, expiresAt, ciphertext, signature };
}
