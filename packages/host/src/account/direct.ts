import { createHash, randomBytes } from "node:crypto";
import { request as forward, type IncomingMessage, type ServerResponse } from "node:http";
import {
  createRemoteJWKSet,
  decodeProtectedHeader,
  calculateJwkThumbprint,
  importJWK,
  jwtVerify,
} from "jose";
import type { HostAccount } from "./host-account.js";

/** A LAN/VPN TLS listener forwards verified native requests to the same private Host listener as Relay. */
export function directGateway(
  account: HostAccount,
  origin: string,
  relay: string,
  privatePort: () => number,
) {
  const keys = createRemoteJWKSet(new URL("/.well-known/jwks.json", account.origin));
  const nonces = new Map<string, number>();
  return async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader("cache-control", "no-store");
    const reject = (status: number) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: "DEVICE_APPROVAL_REQUIRED" } }));
    };
    try {
      if (
        req.headers.host !== new URL(origin).host ||
        req.headers.origin ||
        !("encrypted" in req.socket)
      )
        return reject(403);
      const target = new URL(req.url ?? "/", origin);
      if (target.origin !== origin) return reject(403);
      if (target.pathname === "/v1/nonce" && req.method === "POST") {
        for (const [key, end] of nonces) {
          if (end > Date.now()) break;
          nonces.delete(key);
        }
        if (nonces.size >= 4096) return reject(429);
        const nonce = randomBytes(32).toString("base64url");
        nonces.set(nonce, Date.now() + 60000);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ nonce }));
        return;
      }
      const route = /^\/h\/([a-f0-9]{64})(\/api\/(?:health|secure\/key|secure\/channel))$/.exec(
        target.pathname,
      );
      if (!route || !privatePort()) return reject(404);
      const scope = req.headers["x-kooyu-purpose"] === "pair" ? "relay:pair" : "relay:access";
      const ticket = req.headers["x-kooyu-ticket"],
        raw = req.headers.dpop;
      if (
        typeof ticket !== "string" ||
        ticket.length > 6000 ||
        typeof raw !== "string" ||
        raw.length > 4000
      )
        return reject(403);
      const { payload: c } = await jwtVerify(ticket, keys, {
        issuer: account.origin,
        audience: scope,
        typ: "at+jwt",
        algorithms: ["ES256"],
        requiredClaims: ["exp", "iat", "jti", "sub"],
      });
      const jwk = decodeProtectedHeader(raw).jwk;
      if (
        c.scope !== scope ||
        c.relayHostId !== route[1] ||
        !jwk ||
        "d" in jwk ||
        jwk.crv !== "P-256"
      )
        return reject(403);
      const jkt = await calculateJwkThumbprint(jwk);
      if ((c.cnf as { jkt?: string })?.jkt !== jkt) return reject(403);
      const { payload: p } = await jwtVerify(raw, await importJWK(jwk, "ES256"), {
        algorithms: ["ES256"],
        typ: "dpop+jwt",
        maxTokenAge: "60s",
        clockTolerance: 3,
      });
      if (
        p.htm !== req.method ||
        p.htu !== origin + target.pathname ||
        p.ath !== createHash("sha256").update(ticket).digest("base64url") ||
        typeof p.jti !== "string" ||
        typeof p.nonce !== "string" ||
        (nonces.get(p.nonce) ?? 0) <= Date.now()
      )
        return reject(403);
      nonces.delete(p.nonce);
      const lease = async () => {
        if (c.exp! * 1000 <= Date.now()) throw Error("Expired");
        await account.hostRequest("pairing/direct-lease", {
          hostId: c.hostId,
          pairId: c.pairId,
          grantId: c.grantId,
          deviceId: c.deviceId,
          pairedClientId: c.pairedClientId,
          jkt,
        });
      };
      await lease();
      const upstream = forward(
        {
          hostname: "127.0.0.1",
          port: privatePort(),
          method: req.method,
          path: route[2],
          headers: {
            host: new URL(relay).host,
            "x-forwarded-for": "direct",
            "content-type": "application/json",
            "x-kooyu-device-context": c.pairId
              ? "pair:" + c.pairId + ":" + jkt
              : "device:" + c.pairedClientId,
          },
        },
        (reply) => {
          res.writeHead(reply.statusCode ?? 502, {
            "content-type": reply.headers["content-type"] ?? "application/octet-stream",
            "cache-control": "no-store",
          });
          reply.pipe(res);
        },
      );
      const timer = setInterval(() => void lease().catch(() => res.destroy()), 15000);
      timer.unref();
      res.once("close", () => {
        clearInterval(timer);
        upstream.destroy();
      });
      upstream.on("error", () => res.destroy());
      req.pipe(upstream);
    } catch {
      if (!res.headersSent) reject(403);
      else res.destroy();
    }
  };
}
