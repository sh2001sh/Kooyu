import { SignJWT, exportJWK } from "jose";
type Stored = {
  key: CryptoKeyPair;
  hostId: string;
  ath: string;
  issuer: string;
  pair?: { transactionId: string; secret: string };
};
async function store(host: string, value?: Stored | null): Promise<Stored | undefined> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("kooyu-account-device", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("hosts");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("hosts", value === undefined ? "readonly" : "readwrite");
      const s = tx.objectStore("hosts");
      const r = value === null ? s.delete(host) : value ? s.put(value, host) : s.get(host);
      tx.oncomplete = () => resolve(value ?? r.result);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
const hash = async (v: string) =>
  btoa(
    String.fromCharCode(
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v))),
    ),
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
async function proof(s: Stored, url: string, method: string, nonce: string, ath: string) {
  return new SignJWT({ htu: url, htm: method, nonce, ath })
    .setProtectedHeader({ alg: "ES256", typ: "dpop+jwt", jwk: await exportJWK(s.key.publicKey) })
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .sign(s.key.privateKey);
}
async function call(path: string, body: unknown = {}, dpop?: string) {
  const r = await fetch("/v1/browser/" + path, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      "x-kooyu-request": "1",
      ...(dpop ? { dpop } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw Error("设备授权失败（" + r.status + "）");
  return r.json();
}
async function step(s: Stored, path: string, name?: string) {
  const pair = s.pair!;
  return call(
    path,
    { ...pair, hostId: s.hostId, name },
    await proof(s, s.issuer + "/api/device-auth/v1/" + path, "POST", s.ath, s.ath),
  );
}
export async function startBrowserPair(host: string, fragment: string, name: string) {
  const p = new URLSearchParams(fragment);
  const secret = p.get("claim"),
    transactionId = p.get("transaction"),
    hostId = p.get("host");
  if (!secret || !transactionId || !hostId) throw Error("请使用已绑定电脑生成的新二维码。");
  await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller)
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(Error("工作台加载中，请刷新后重试。")), 6000);
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        () => {
          clearTimeout(t);
          resolve();
        },
        { once: true },
      );
    });
  const { issuer } = await call("config");
  const key = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
    "verify",
  ]);
  const s = { issuer, key, hostId, ath: await hash(secret), pair: { transactionId, secret } };
  let state = await step(s, "pairing/claim", name);
  const deadline = Date.now() + 300000;
  while (state.state === "approval_required" && Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 5000));
    state = await step(s, "pairing/claim", name);
  }
  if (state.state === "approval_required") throw Error("电脑批准请求已到期。");
  await store(host, s);
  return async () => {
    const v = await step(s, "pairing/finish");
    if (v.state !== "active") throw Error("等待电脑确认");
    await store(host, { issuer, key, hostId, ath: v.ath });
  };
}
const tickets = new Map<string, { ath: string; value: string; until: number }>();
export async function browserFetch(req: Request, host: string) {
  const s = await store(host);
  if (!s) return fetch(req);
  let cached = tickets.get(host);
  if (!cached || cached.ath !== s.ath || cached.until <= Date.now()) {
    const { nonce } = await call("nonce");
    if (!s.pair) s.ath = (await call("credential-hash", { hostId: s.hostId })).ath;
    const { ticket, ath } = await call(
      "ticket",
      { nonce, hostId: s.hostId, role: s.pair ? "pair" : "device", secret: s.pair?.secret },
      await proof(s, s.issuer + "/api/device-auth/v1/ticket", "POST", nonce, s.ath),
    );
    if (ath && !s.pair) {
      s.ath = ath;
      await store(host, s);
    }
    cached = { ath: s.ath, value: ticket, until: Date.now() + 540000 };
    tickets.set(host, cached);
  }
  const nonceResponse = await fetch("/v1/nonce", {
    method: "POST",
    signal: AbortSignal.timeout(8000),
  });
  if (!nonceResponse.ok) throw Error("远程服务繁忙");
  const { nonce } = await nonceResponse.json(),
    url = new URL(req.url);
  const headers = new Headers(req.headers);
  headers.set("x-kooyu-ticket", cached.value);
  headers.set("x-kooyu-purpose", s.pair ? "pair" : "access");
  headers.set(
    "dpop",
    await proof(s, url.origin + url.pathname, req.method, nonce, await hash(cached.value)),
  );
  return fetch(new Request(req, { headers, redirect: "error" }));
}

export async function logoutBrowserDevice(host: string) {
  const saved = await store(host);
  if (saved && !saved.pair) {
    const { nonce } = await call("nonce");
    const { ath } = await call("credential-hash", { hostId: saved.hostId });
    await call(
      "logout",
      { hostId: saved.hostId, nonce },
      await proof(saved, saved.issuer + "/api/device-auth/v1/logout", "POST", nonce, ath),
    );
  }
  await store(host, null);
  tickets.delete(host);
}
