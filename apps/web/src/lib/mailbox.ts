import { api, hostPath } from "./host-client";
import { logoutBrowserDevice, startBrowserPair } from "./cloud-browser";

import { sealMailboxMessage, type LocalKeys } from "@kodo/protocol/mailbox";
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const desktop = location.origin === "https://device.kooyu.invalid";

async function keys(value?: LocalKeys | null): Promise<LocalKeys | undefined> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open("kooyu-device-mailbox", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("keys");
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("keys", value === undefined ? "readonly" : "readwrite");
      const store = tx.objectStore("keys");
      const read = value === undefined ? store.get(hostPath) : undefined;
      if (value) store.put(value, hostPath);
      else if (value === null) store.delete(hostPath);
      tx.oncomplete = () => resolve(read?.result);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export async function pairWebDevice(code: string, name: string) {
  const finish =
    hostPath && !desktop && location.hash.includes("&claim=")
      ? await startBrowserPair(hostPath.slice(3), location.hash.slice(1), name)
      : undefined;
  let pair: CryptoKeyPair | undefined;
  if (hostPath) {
    try {
      await crypto.subtle.generateKey("X25519", false, ["deriveBits"]);
      pair = (await crypto.subtle.generateKey("Ed25519", false, [
        "sign",
        "verify",
      ])) as CryptoKeyPair;
    } catch {
      /* Older paired browsers retain the v1 online channel. */
    }
  }
  const mailboxVerifyPubKey =
    pair && encode(new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey)));
  const result = await api<{ device: { id: string }; mailboxEncryptionKey?: string }>(
    "/pair",
    "POST",
    { code: code.replace(/^V2-/i, ""), name, mailboxVerifyPubKey },
  );
  if (finish) await finish();
  if (hostPath)
    await keys(
      pair && result.mailboxEncryptionKey
        ? {
            signingKey: pair.privateKey,
            encryptionKey: result.mailboxEncryptionKey,
            deviceId: result.device.id,
          }
        : null,
    );
}
export async function canPostMail() {
  if (desktop) return (await fetch("/desktop/mailbox")).ok;
  return !!hostPath && !!(await keys());
}

export async function prepareMail(sessionId: string, text: string) {
  if (desktop) {
    const result = await fetch("/desktop/mailbox", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, text }),
    });
    if (!result.ok) throw Error("无法加密离线消息，请检查配对状态及消息大小。");
    return (await result.json()) as Awaited<ReturnType<typeof sealMailboxMessage>>;
  }
  const local = await keys();
  if (!local) throw Error("请先配对支持离线信箱的 Host。");
  return sealMailboxMessage(hostPath.slice(3), local, sessionId, text);
}
export async function postMail(envelope: Awaited<ReturnType<typeof prepareMail>>) {
  const response = await fetch("/v2/mailbox/" + hostPath.slice(3), {
    method: "POST",
    redirect: "error",
    credentials: "omit",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(envelope),
  });
  if (!response.ok) throw Error("离线信箱未确认投递（HTTP " + response.status + "）。");
}

export async function logoutWebDevice() {
  await logoutBrowserDevice(hostPath.slice(3));
  await keys(null);
  location.reload();
}
