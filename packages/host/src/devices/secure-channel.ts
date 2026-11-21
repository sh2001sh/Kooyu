import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPublicKey,
  diffieHellman,
  hkdfSync,
} from "node:crypto";
import { request, type ServerResponse } from "node:http";
import { once } from "node:events";
import { z } from "zod";
import { KodoError } from "@kodo/protocol";
import type { DeviceMailbox } from "./mailbox.js";
import type { Store } from "../storage/store.js";
import type { Pairing } from "./pairing.js";

const envelopeSchema = z
  .object({
    ephemeral: z.string().max(64),
    nonce: z.string().max(20),
    ciphertext: z.string().max(1000000),
    expires: z.number().int(),
  })
  .strict();
const innerSchema = z
  .object({
    method: z.enum(["GET", "POST", "DELETE", "PATCH", "PUT"]),
    path: z.string().startsWith("/api/").max(8192),
    token: z.string().max(128).optional(),
    contentType: z.enum(["application/json", "application/octet-stream"]).optional(),
    body: z.string().max(900000).optional(),
    protocol: z.string().max(4).optional(),
  })
  .strict();

export async function secureChannel(
  raw: unknown,
  key: DeviceMailbox,
  pairing: Pairing,
  store: Store,
  upstream: { port: number; host: string; origin?: string; cloudContext?: string },
  response: ServerResponse,
) {
  const m = envelopeSchema.parse(raw);
  const now = Date.now();
  if (m.expires < now || m.expires > now + 120000)
    throw new KodoError("CONFLICT", "加密请求已过期。");
  const nonce = Buffer.from(m.nonce, "base64"),
    cipher = Buffer.from(m.ciphertext, "base64");
  const aad = Buffer.from("kooyu-tunnel-v2:" + m.ephemeral + ":" + m.nonce + ":" + m.expires);
  const privateKey = key.key();
  const { input, replyKey } = (() => {
    try {
      if (nonce.length !== 12 || cipher.length < 17) throw Error();
      const peer = createPublicKey({
        key: Buffer.from(m.ephemeral, "base64"),
        type: "spki",
        format: "der",
      });
      const shared = diffieHellman({ privateKey, publicKey: peer });
      const material = Buffer.from(hkdfSync("sha256", shared, nonce, aad, 64));
      const dec = createDecipheriv("aes-256-gcm", material.subarray(0, 32), nonce);
      dec.setAAD(aad);
      dec.setAuthTag(cipher.subarray(-16));
      const input = innerSchema.parse(
        JSON.parse(
          Buffer.concat([dec.update(cipher.subarray(0, -16)), dec.final()]).toString("utf8"),
        ),
      );
      return { input, replyKey: material.subarray(32) };
    } catch {
      throw new KodoError("UNAUTHORIZED", "加密请求校验失败。");
    }
  })();
  const target = new URL(input.path, "http://localhost");
  if (
    target.origin !== "http://localhost" ||
    !target.pathname.startsWith("/api/") ||
    target.pathname.startsWith("/api/secure/")
  )
    throw new KodoError("INVALID_INPUT", "加密请求路径无效。");
  if (
    !(input.method === "POST" && target.pathname === "/api/pair/native") &&
    !pairing.authenticate(input.token ?? "")
  )
    throw new KodoError("UNAUTHORIZED", "设备配对已失效。");
  if (
    upstream.cloudContext?.startsWith("pair:") &&
    !(input.method === "POST" && target.pathname === "/api/pair/native")
  )
    throw new KodoError("UNAUTHORIZED", "配对票据仅用于建立本机配对。");
  const id = createHash("sha256").update(aad).digest("hex");
  store.db.prepare("DELETE FROM secure_requests WHERE expires<?").run(now);
  if (
    !store.db.prepare("INSERT OR IGNORE INTO secure_requests VALUES(?,?)").run(id, m.expires)
      .changes
  )
    throw new KodoError("CONFLICT", "加密请求已经处理。");
  const body = Buffer.from(input.body ?? "", "base64");
  const req = request({
    hostname: "127.0.0.1",
    port: upstream.port,
    path: target.pathname + target.search,
    method: input.method,
    headers: {
      host: upstream.host,
      "x-forwarded-for": "relay",
      "content-length": body.length,
      ...(upstream.cloudContext ? { "x-kooyu-device-context": upstream.cloudContext } : {}),
      ...(upstream.origin ? { origin: upstream.origin } : {}),
      ...(input.token ? { authorization: "Bearer " + input.token } : {}),
      ...(input.protocol ? { "x-kooyu-protocol": input.protocol } : {}),
      ...(input.contentType ? { "content-type": input.contentType } : {}),
    },
  });
  response.on("close", () => req.destroy());
  const ready = once(req, "response");
  req.end(body);
  const [res] = (await ready) as [import("node:http").IncomingMessage];
  res.setTimeout(60000, () => res.destroy());
  response.writeHead(200, {
    "content-type": "application/octet-stream",
    "cache-control": "no-store",
  });
  let seq = 0;
  // Each record authenticates its type, length and implicit sequence number.
  async function record(type: number, data: Buffer) {
    if (response.destroyed) throw Error("Encrypted stream closed");
    const iv = Buffer.alloc(12);
    iv.writeBigUInt64BE(BigInt(seq++), 4);
    const header = Buffer.alloc(5);
    header[0] = type;
    header.writeUInt32BE(data.length + 16, 1);
    const enc = createCipheriv("aes-256-gcm", replyKey, iv);
    enc.setAAD(Buffer.concat([aad, header]));
    const frame = Buffer.concat([header, enc.update(data), enc.final(), enc.getAuthTag()]);
    if (!response.write(frame)) {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          response.off("drain", drain);
          response.off("close", close);
        };
        const drain = () => {
          cleanup();
          resolve();
        };
        const close = () => {
          cleanup();
          reject(Error("Encrypted stream closed"));
        };
        response.once("drain", drain);
        response.once("close", close);
      });
    }
  }
  try {
    await record(
      1,
      Buffer.from(
        JSON.stringify({
          status: res.statusCode,
          contentType: res.headers["content-type"] ?? "application/octet-stream",
        }),
      ),
    );
    for await (const chunk of res) {
      const bytes = Buffer.from(chunk);
      for (let offset = 0; offset < bytes.length; offset += 65536)
        await record(2, bytes.subarray(offset, offset + 65536));
    }
    await record(3, Buffer.alloc(0));
    response.end();
  } catch {
    response.destroy();
  } finally {
    res.destroy();
    req.destroy();
  }
}
