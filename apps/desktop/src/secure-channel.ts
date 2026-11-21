import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  verify,
  type KeyObject,
} from "node:crypto";

const invalid = () => new Error("无法校验远程设备的加密响应。");

export function desktopInvitation(text: string) {
  const url = new URL(text.trim());
  const params = new URLSearchParams(url.hash.slice(1));
  const code =
    params.get("pair") === "REQUEST"
      ? "REQUEST"
      : /^V2-([a-f0-9]{32})$/i.exec(params.get("pair") ?? "")?.[1];
  const transaction = params.get("transaction") ?? "",
    claim = params.get("claim") ?? "",
    hostId = params.get("host") ?? "";
  if (
    !/^[a-f0-9-]{36}$/.test(transaction) ||
    !/^[-\w]{43}$/.test(claim) ||
    !/^[a-f0-9-]{36}$/.test(hostId)
  )
    throw Error("请在绑定账号的电脑上重新生成邀请。");
  const host = /^\/h\/([a-f0-9]{64})\/?$/.exec(url.pathname)?.[1];
  if (url.protocol !== "https:" || url.username || url.password || url.search || !host || !code)
    throw new Error("请先复制远程设备设置中的 HTTPS V2 配对链接。");
  return {
    base: new URL("/h/" + host + "/", url.origin),
    host,
    code,
    invitation: { transaction, claim, hostId },
  };
}

export async function verifyDesktopHost(
  base: URL,
  host: string,
  headers: Record<string, string> = {},
) {
  const response = await fetch(new URL("api/secure/key", base), {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw invalid();
  const descriptor = await response.json();
  const der = Buffer.from(descriptor.publicKey, "base64");
  const signer = createPublicKey({ key: der, format: "der", type: "spki" });
  if (
    signer.asymmetricKeyType !== "ed25519" ||
    createHash("sha256").update(der).digest("hex") !== host ||
    !verify(
      null,
      Buffer.from("kooyu-tunnel-v2:" + descriptor.encryptionKey),
      signer,
      Buffer.from(descriptor.signature, "base64"),
    )
  )
    throw invalid();
  const key = createPublicKey({
    key: Buffer.from(descriptor.encryptionKey, "base64"),
    format: "der",
    type: "spki",
  });
  if (key.asymmetricKeyType !== "x25519") throw invalid();
  return key;
}

export async function desktopChannel(
  base: URL,
  peer: KeyObject,
  input: {
    path: string;
    method: string;
    token?: string;
    body?: string;
    contentType?: string;
    protocol?: string;
  },
  signal?: AbortSignal,
  admission: Record<string, string> = {},
) {
  const ephemeral = generateKeyPairSync("x25519"),
    nonce = randomBytes(12);
  const pub = ephemeral.publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const expires = Date.now() + 60000;
  const aad = Buffer.from(`kooyu-tunnel-v2:${pub}:${nonce.toString("base64")}:${expires}`);
  const shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: peer });
  const keys = Buffer.from(hkdfSync("sha256", shared, nonce, aad, 64));
  const cipher = createCipheriv("aes-256-gcm", keys.subarray(0, 32), nonce);
  cipher.setAAD(aad);
  const bytes = Buffer.concat([
    cipher.update(JSON.stringify(input), "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const abort = new AbortController();
  const requestSignal = signal ? AbortSignal.any([abort.signal, signal]) : abort.signal;
  const timer = setTimeout(() => abort.abort(), 20000);
  try {
    const outer = await fetch(new URL("api/secure/channel", base), {
      method: "POST",
      redirect: "error",
      signal: requestSignal,
      headers: { "content-type": "application/json", ...admission },
      body: JSON.stringify({
        ephemeral: pub,
        nonce: nonce.toString("base64"),
        expires,
        ciphertext: bytes.toString("base64"),
      }),
    });
    if (!outer.ok || !outer.body) {
      await outer.body?.cancel();
      return Response.json(
        { error: { message: "远程设备未确认加密请求。" } },
        { status: outer.ok ? 502 : outer.status },
      );
    }
    const reader = outer.body.getReader();
    let pending: Buffer<ArrayBufferLike> = Buffer.alloc(0),
      sequence = 0;
    async function read(n: number) {
      while (pending.length < n) {
        const next = await reader.read();
        if (next.done) throw invalid();
        pending = Buffer.concat([pending, next.value]);
      }
      const value = pending.subarray(0, n);
      pending = pending.subarray(n);
      return value;
    }
    async function record() {
      const header = await read(5),
        size = header.readUInt32BE(1);
      if (size < 16 || size > 65552) throw invalid();
      const ciphertext = await read(size),
        iv = Buffer.alloc(12);
      iv.writeBigUInt64BE(BigInt(sequence++), 4);
      const dec = createDecipheriv("aes-256-gcm", keys.subarray(32), iv);
      dec.setAAD(Buffer.concat([aad, header]));
      dec.setAuthTag(ciphertext.subarray(-16));
      return {
        type: header[0],
        bytes: Buffer.concat([dec.update(ciphertext.subarray(0, -16)), dec.final()]),
      };
    }
    const first = await record();
    if (first.type !== 1) throw invalid();
    const head = JSON.parse(first.bytes.toString("utf8"));
    const headers = {
      "content-type": head.contentType,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    };
    if ([204, 205, 304].includes(head.status)) {
      const end = await record();
      if (end.type !== 3 || end.bytes.length) throw invalid();
      await reader.cancel();
      return new Response(null, { status: head.status, headers });
    }
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const frame = await record();
          if (frame.type === 2) controller.enqueue(frame.bytes);
          else if (frame.type === 3 && !frame.bytes.length) {
            controller.close();
            await reader.cancel();
          } else throw invalid();
        } catch (error) {
          abort.abort();
          controller.error(error);
        }
      },
      cancel() {
        abort.abort();
        return reader.cancel().catch(() => {});
      },
    });
    return new Response(stream, { status: head.status, headers });
  } catch (error) {
    abort.abort();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
