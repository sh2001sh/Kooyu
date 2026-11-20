import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const npm = process.env.npm_execpath;
if (!npm) throw new Error("Use npm run verify:npm.");
const root = resolve(".");
const testRoot = process.env.KOOYU_NPM_TEST_ROOT ?? tmpdir();
await mkdir(testRoot, { recursive: true });
const temp = await mkdtemp(join(testRoot, "kooyu-npm-install-"));
const run = (args, options = {}) =>
  new Promise((done, reject) => {
    const p = spawn(process.execPath, args, {
      cwd: temp,
      windowsHide: true,
      ...options,
      env: { ...process.env, TEMP: temp, TMP: temp, ...options.env },
    });
    let output = "";
    p.stdout.on("data", (b) => {
      output += b;
    });
    p.stderr.on("data", (b) => {
      output += b;
    });
    p.once("error", reject);
    p.once("close", (code) =>
      code === 0 ? done(output) : reject(new Error(`Exit ${code}: ${output}`)),
    );
  });
const explicit = process.argv[2];
let archive;
if (explicit) archive = resolve(explicit);
else {
  const packed = JSON.parse(
    await run([npm, "pack", "--json", "--pack-destination", temp], {
      cwd: join(root, "release/npm"),
    }),
  )[0];
  const paths = packed.files.map((f) => f.path);
  assert(paths.includes("bin/kooyu.mjs"));
  assert(paths.includes("runtime/apps/web/dist/index.html"));
  assert(paths.includes("node_modules/@kodo/platform/dist/index.js"));
  assert(paths.includes("node_modules/@kodo/protocol/dist/index.js"));
  assert(
    !paths.some((p) =>
      /(?:^|\/)(?:\.env[^/]*|\.npmrc|\.git|\.local|src|test|tests)(?:\/|$)|\.(?:keystore|jks|p12|sqlite|node)$/.test(
        p,
      ),
    ),
  );
  archive = join(temp, packed.filename);
}
console.log(`Installing isolated package: ${archive}`);
await run([
  npm,
  "install",
  "--prefix",
  temp,
  "--no-audit",
  "--no-fund",
  "--registry=https://registry.npmjs.org/",
  archive,
]);
const installed = join(temp, "node_modules/kooyu");
const bin = join(installed, "bin/kooyu.mjs");
const pkg = JSON.parse(await readFile(join(installed, "package.json"), "utf8"));
assert.equal((await run([bin, "--version"])).trim(), pkg.version);
assert.match(await run([bin, "--help"]), /data-dir/);
assert.equal(
  (await run([npm, "exec", "--prefix", temp, "--offline", "--", "kooyu", "--version"])).trim(),
  pkg.version,
);
await assert.rejects(run([bin, "--port", "0"]), /between 1 and 65535/);
await assert.rejects(run([bin, "unknown"]), /Unknown command/);
await assert.rejects(run([bin, "--unknown"]), /Unknown option/);
await assert.rejects(
  run([bin, "--host", "0.0.0.0", "--data-dir", join(temp, "remote-data")], {
    env: { KODO_TLS_CERT: "", KODO_TLS_KEY: "" },
  }),
  /Non-loopback binding requires/,
);
const probe = createServer();
probe.listen(0, "127.0.0.1");
await once(probe, "listening");
const port = probe.address().port;
await new Promise((done) => probe.close(done));
const data = join(temp, "data");
const p = spawn(process.execPath, [bin, "start", "--port", String(port), "--data-dir", data], {
  cwd: temp,
  windowsHide: true,
  env: {
    ...process.env,
    KODO_BIND: "127.0.0.1",
    KODO_ADMIN_PORT: "",
    KODO_TLS_CERT: "",
    KODO_TLS_KEY: "",
    KODO_RELAY_ORIGIN: "https://127.0.0.1:1",
    KOOYU_CREDENTIAL_BACKEND: "file",
    KOOYU_VAULT_KEY_FILE: "",
    TEMP: temp,
    TMP: temp,
  },
});
let output = "";
p.stdout.on("data", (b) => {
  output += b;
});
p.stderr.on("data", (b) => {
  output += b;
});
const base = `http://127.0.0.1:${port}`;
try {
  const end = Date.now() + 60000;
  let ready = false;
  while (Date.now() < end) {
    if (p.exitCode !== null) throw new Error(`Host exited: ${output}`);
    try {
      ready = (await fetch(base + "/api/health", { signal: AbortSignal.timeout(1000) })).ok;
    } catch {}
    if (ready) break;
    await delay(250);
  }
  assert(ready, `Host did not start: ${output}`);
  const html = await (await fetch(base)).text();
  assert.match(html, /<html/);
  const asset = html.match(/src="([^"]+\.js)"/)[1];
  assert((await fetch(new URL(asset, base))).ok, "Built JavaScript is missing");
  const snapshot = await fetch(base + "/api/snapshot");
  assert(snapshot.ok);
  assert(Array.isArray((await snapshot.json()).sessions));
  const update = await (await fetch(base + "/api/app-update")).json();
  assert.equal(update.distribution, "npm");
  assert.equal(update.currentVersion, pkg.version);
  assert.equal(update.latest, null);
  assert.equal(update.autoCheck, false);
  assert.equal(update.updateCommand, "npm install -g kooyu@latest");
  for (const action of ["download", "install"]) {
    const response = await fetch(base + "/api/app-update/" + action, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert(!response.ok, "npm Host must not run desktop installers");
    assert.match(await response.text(), /npm/);
  }
  const conflict = run([bin, "--port", String(port), "--data-dir", data]);
  await assert.rejects(conflict, /already owns this data directory/);
  console.log(
    `Verified kooyu@${pkg.version}: installed dependencies, CLI, browser assets, APIs, data lock and npm updates.`,
  );
} finally {
  p.kill("SIGTERM");
  await Promise.race([once(p, "close"), delay(10000)]);
  if (p.exitCode === null) p.kill("SIGKILL");
}
console.log(`Package and isolated test data retained at ${temp}`);
