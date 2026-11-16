// Process-level TLS/public isolation and private administration; no model calls.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { createServer } from "node:net";
import { request } from "node:https";

const temp = mkdtempSync(join(tmpdir(), "kooyu-admin-acceptance-"));
let child,
  diagnostics = "";
const freePort = async () => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
};
try {
  const openssl =
    process.env.OPENSSL_BINARY ??
    (process.platform === "win32" && existsSync("C:/Program Files/Git/usr/bin/openssl.exe")
      ? "C:/Program Files/Git/usr/bin/openssl.exe"
      : "openssl");
  const cert = join(temp, "cert.pem"),
    key = join(temp, "key.pem");
  const generated = spawnSync(
    openssl,
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      key,
      "-out",
      cert,
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost,DNS:host.example,IP:127.0.0.1",
    ],
    { windowsHide: true },
  );
  if (generated.status !== 0)
    throw new Error("OpenSSL is required for the temporary TLS certificate");
  const publicPort = await freePort();
  let adminPort = await freePort();
  while (adminPort === publicPort) adminPort = await freePort();
  const env = {
    ...process.env,
    KODO_DATA_DIR: join(temp, "data"),
    KODO_HOST_PORT: String(publicPort),
    KODO_ADMIN_PORT: String(adminPort),
    KODO_BIND: "127.0.0.1",
    KODO_PUBLIC_ORIGIN: "https://host.example",
    KODO_TLS_CERT: cert,
    KODO_TLS_KEY: key,
    // Deliberately unavailable vault, without touching the user's real keyring.
    KOOYU_CREDENTIAL_BACKEND: "file",
    KOOYU_VAULT_KEY_FILE: join(temp, "missing-key"),
    KOOYU_ADMIN_URL: `http://127.0.0.1:${adminPort}`,
  };
  child = spawn(process.execPath, [resolve("packages/host/dist/main.js")], {
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => {
    diagnostics += d;
  });
  child.stderr.on("data", (d) => {
    diagnostics += d;
  });
  const until = Date.now() + 30000;
  while (!existsSync(join(env.KODO_DATA_DIR, "host.json"))) {
    if (child.exitCode !== null || Date.now() > until)
      throw new Error("Host did not start: " + diagnostics.slice(-4000));
    await new Promise((done) => setTimeout(done, 100));
  }
  const admin = (method, path, body) => {
    const result = spawnSync(
      process.execPath,
      [resolve("scripts/host-admin.mjs"), method, path, ...(body ? ["-"] : [])],
      {
        env,
        input: body ? JSON.stringify(body) : undefined,
        encoding: "utf8",
        windowsHide: true,
        timeout: 15000,
      },
    );
    assert.equal(result.status, 0, result.stderr + result.stdout);
    return JSON.parse(result.stdout);
  };
  const health = admin("GET", "/internal/health");
  assert.equal(health.frozen, false);
  const invitation = admin("POST", "/api/pairing");
  assert.match(invitation.code, /^[A-F0-9]{32}$/);
  assert.equal(new URL(invitation.url).origin, "https://host.example");
  const frozen = admin("POST", "/internal/quiesce");
  assert.equal(frozen.frozen, true);
  admin("POST", "/internal/resume", {
    processIdentity: frozen.processIdentity,
    generation: frozen.generation,
  });
  assert.equal(admin("GET", "/internal/health").frozen, false);
  const remoteStatus = (path) =>
    new Promise((done, reject) => {
      const req = request(
        {
          hostname: "127.0.0.1",
          port: publicPort,
          path,
          ca: readFileSync(cert),
          headers: { host: "host.example", "x-forwarded-for": "192.0.2.1" },
        },
        (res) => {
          res.resume();
          res.on("end", () => done(res.statusCode));
        },
      );
      req.on("error", reject);
      req.end();
    });
  assert.equal(await remoteStatus("/api/grants"), 401);
  assert.equal(await remoteStatus("/internal/health"), 401);
  const discovery = JSON.parse(readFileSync(join(env.KODO_DATA_DIR, "host.json"), "utf8"));
  assert.equal(discovery.adminUrl, env.KOOYU_ADMIN_URL);
  console.log(
    JSON.stringify({
      tlsHost: true,
      loopbackAdminCli: true,
      publicPairingOrigin: true,
      quiesceResume: true,
      unauthenticatedPublicAdminRejected: true,
      modelInference: false,
    }),
  );
} finally {
  if (child && child.exitCode === null) {
    const stopped = once(child, "exit");
    if (process.platform === "win32")
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    else child.kill("SIGTERM");
    await stopped;
  }
  rmSync(temp, { recursive: true, force: true });
}
