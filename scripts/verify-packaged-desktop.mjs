import assert from "node:assert/strict";
import { _electron as electron } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { PROTOCOL_VERSION } from "../packages/protocol/dist/client.js";

const defaults = {
  win32: "release/desktop/win-unpacked/Kooyu.exe",
  darwin: `release/desktop/mac${process.arch === "arm64" ? "-arm64" : ""}/Kooyu.app/Contents/MacOS/Kooyu`,
  linux: "release/desktop/linux-unpacked/kooyu",
};
const executable = resolve(process.argv[2] ?? defaults[process.platform]);
const resources =
  process.platform === "darwin"
    ? resolve(dirname(executable), "../Resources")
    : join(dirname(executable), "resources");
const data = resolve(`.local/verification/packaged-${Date.now()}`);
mkdirSync(data, { recursive: true });
const reservation = createServer();
reservation.listen(0, "127.0.0.1");
await once(reservation, "listening");
const port = reservation.address().port;
await new Promise((done) => reservation.close(done));
let url = `http://127.0.0.1:${port}`;
const automaticPort = process.argv.includes("--default-port");
const report = {
  executable,
  data,
  automaticPort,
  startedAt: new Date().toISOString(),
  result: "failed",
};
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (
    key.toUpperCase() === "ELECTRON_RUN_AS_NODE" ||
    [
      "KODO_HOST_URL",
      "KODO_HOST_PORT",
      "KODO_NODE_PATH",
      "KODO_DEV_URL",
      "KODO_PUBLIC_ORIGIN",
      "KODO_TLS_CERT",
      "KODO_TLS_KEY",
      "KODO_BIND",
    ].includes(key.toUpperCase())
  )
    delete env[key];
}
Object.assign(env, { KODO_DATA_DIR: data });
if (!automaticPort) env.KODO_HOST_PORT = String(port);
let app, hostPid;
async function closeUI() {
  if (!app) return;
  const current = app;
  app = undefined;
  const pid = await current.evaluate(() => process.pid);
  let timer;
  const closing = current.close();
  const closed = await Promise.race([
    closing.then(() => true),
    new Promise((done) => {
      timer = setTimeout(() => done(false), 5000);
    }),
  ]);
  clearTimeout(timer);
  if (!closed) {
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch {
      alive = false;
    }
    if (alive) process.kill(pid);
    current.process().kill();
    void closing.catch(() => {});
    assert.equal(alive, false, "Packaged UI must exit promptly");
  }
}
async function api(path, body) {
  const response = await fetch(url + "/api" + path, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.ok, true, `Packaged Host ${path}: ${response.status}`);
  return response.json();
}
async function launchUI() {
  app = await electron.launch({ executablePath: executable, env, timeout: 30000 });
  const page = await app.firstWindow({ timeout: 20000 });
  if (automaticPort) {
    url = JSON.parse(readFileSync(join(data, "host.json"), "utf8")).url;
    report.hostUrl = url;
  }
  // A new isolated Host correctly shows first-run setup before the workbench.
  // Exercise its explicit skip action without adding credentials or providers.
  if ((await api("/onboarding")).status === "active") {
    await page.getByRole("button", { name: "跳过引导", exact: true }).click({ timeout: 20000 });
    assert.equal((await api("/onboarding")).status, "skipped");
    report.firstRunShownAndSkipped = true;
  }
  await page.getByText("Host 已连接", { exact: true }).waitFor({ timeout: 20000 });
  return page;
}
try {
  for (const workspace of ["host", "platform", "protocol"])
    assert.equal(
      existsSync(join(resources, "host/node_modules/@kodo", workspace, "package.json")),
      true,
      `Packaged ${workspace} workspace dependency is missing`,
    );
  const runtime = join(resources, "runtime", process.platform === "win32" ? "node.exe" : "node");
  report.node = JSON.parse(
    execFileSync(
      runtime,
      [
        "-p",
        "JSON.stringify({version:process.versions.node,platform:process.platform,arch:process.arch})",
      ],
      { env, encoding: "utf8" },
    ),
  );
  assert.equal(report.node.version, "24.13.0");
  assert.equal(report.node.platform, process.platform);
  assert.equal(report.node.arch, process.arch);
  const page = await launchUI();
  const health = await api("/health");
  assert.equal(health.protocolVersion, PROTOCOL_VERSION);
  const discovery = JSON.parse(readFileSync(join(data, "host.json"), "utf8"));
  hostPid = discovery.pid;
  report.hostPid = hostPid;
  report.hostId = health.hostId;
  const session = await api("/sessions", {
    title: "Packaged application smoke (no model request)",
    harnessId: "kodo",
    kind: "supervisor",
  });
  await api("/verification");
  await page.screenshot({ path: join(data, "desktop.png") });
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.hide();
    window.show();
  });
  report.windowReopened = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].isVisible(),
  );
  assert.equal(report.windowReopened, true);
  await closeUI();
  assert.equal((await api("/health")).hostId, health.hostId);
  report.hostSurvivedUIExit = true;
  await launchUI();
  assert.equal(JSON.parse(readFileSync(join(data, "host.json"), "utf8")).pid, hostPid);
  assert.equal((await api("/health")).hostId, health.hostId);
  assert.ok((await api("/snapshot")).sessions.some((s) => s.id === session.id));
  report.reusedHostAndSession = true;
  await closeUI();
  report.result = "passed";
} catch (error) {
  report.error = error.message;
  const failurePage = app?.windows()[0];
  if (failurePage) {
    report.failureUrl = failurePage.url();
    await failurePage.screenshot({ path: join(data, "failure.png") }).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  await closeUI().catch((error) => {
    report.cleanupError = error.message;
  });
  if (!hostPid) {
    try {
      hostPid = JSON.parse(readFileSync(join(data, "host.json"), "utf8")).pid;
    } catch {}
  }
  if (hostPid) {
    try {
      process.kill(hostPid, "SIGTERM");
    } catch {}
  }
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(data, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
