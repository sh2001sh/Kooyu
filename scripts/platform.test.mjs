import assert from "node:assert/strict";
import { test } from "node:test";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { hostDataDirectory, hostEnvironment } from "../packages/platform/dist/index.js";
import { ensureHost } from "../apps/desktop/dist/host-client.js";
import { PROTOCOL_VERSION } from "../packages/protocol/dist/client.js";

test("all launchers share platform directories and support Kooyu default plus legacy Kodo fallback", () => {
  assert.equal(
    hostDataDirectory("darwin", {}, "/home/user"),
    join("/home/user", "Library", "Application Support", "Kooyu", "host"),
  );
  assert.equal(
    hostDataDirectory("linux", { XDG_DATA_HOME: "/data" }, "/home/user"),
    join("/data", "Kooyu", "host"),
  );
  assert.equal(
    hostDataDirectory("win32", { LOCALAPPDATA: "C:/user/data" }, "C:/user"),
    join("C:/user/data", "Kooyu", "host"),
  );
  assert.equal(hostDataDirectory("darwin", { KOOYU_DATA_DIR: "override" }), resolve("override"));
  assert.equal(
    hostDataDirectory("darwin", { KODO_DATA_DIR: "legacy-override" }),
    resolve("legacy-override"),
  );
  const env = hostEnvironment({ PATH: "/usr/bin", ELECTRON_RUN_AS_NODE: "1" }, "darwin");
  assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
  assert.ok(env.PATH.includes("/opt/homebrew/bin"));
});

async function withHostEnvironment(values, work) {
  const keys = ["KODO_HOST_URL", "KODO_HOST_PORT", "KODO_DATA_DIR", "KODO_NODE_PATH"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) {
      if (values[key] === undefined) delete process.env[key];
      else process.env[key] = values[key];
    }
    return await work();
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test("explicit non-JSON services produce a readable port conflict error", async () => {
  const server = createServer((_request, response) => response.end(Buffer.from([255, 128, 0, 1])));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await withHostEnvironment(
      { KODO_HOST_URL: `http://127.0.0.1:${server.address().port}` },
      async () => {
        await assert.rejects(ensureHost(), (error) => {
          assert.match(error.message, /无效 JSON.*端口.*占用/);
          assert.doesNotMatch(error.message, /Unexpected token/);
          return true;
        });
      },
    );
  } finally {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
});

test("occupied default port selects a free port and reopening reuses the registered Host", async () => {
  const root = await mkdtemp(join(tmpdir(), "kooyu-host-launch-"));
  const data = join(root, "data");
  const entry = join(root, "host/packages/host/dist");
  const blocker = createServer((_request, response) => response.end("not a Kooyu Host"));
  let fixturePid;
  try {
    await new Promise((resolve, reject) => {
      blocker.once("error", (error) => (error.code === "EADDRINUSE" ? resolve() : reject(error)));
      blocker.listen(4310, "127.0.0.1", resolve);
    });
    await mkdir(entry, { recursive: true });
    await writeFile(
      join(entry, "main.js"),
      `
      const {createServer}=require('node:http');
      const {writeFileSync}=require('node:fs');
      const {join}=require('node:path');
      const data=process.env.KODO_DATA_DIR;
      const port=Number(process.env.KODO_HOST_PORT);
      const hostId='launcher-fixture';
      writeFileSync(join(data,'host.lock'),String(process.pid));
      createServer((request,response)=>{
        response.setHeader('content-type','application/json');
        response.end(JSON.stringify({status:'ok',protocolVersion:${PROTOCOL_VERSION},hostId}));
      }).listen(port,'127.0.0.1',()=>{
        writeFileSync(join(data,'host.json'),JSON.stringify({pid:process.pid,hostId,
          discoveryVersion:1,protocolVersion:${PROTOCOL_VERSION},url:'http://127.0.0.1:'+port}));
      });
    `,
    );
    await withHostEnvironment(
      { KODO_DATA_DIR: data, KODO_NODE_PATH: process.execPath },
      async () => {
        const url = await ensureHost(root);
        assert.notEqual(new URL(url).port, "4310");
        const first = JSON.parse(await readFile(join(data, "host.json"), "utf8"));
        fixturePid = first.pid;
        assert.equal(await ensureHost(root), url);
        assert.equal(JSON.parse(await readFile(join(data, "host.json"), "utf8")).pid, first.pid);
        await writeFile(
          join(data, "host.json"),
          JSON.stringify({ ...first, hostId: "wrong-host" }),
        );
        await assert.rejects(ensureHost(root), /身份与本地记录不一致/);
      },
    );
  } finally {
    if (!fixturePid) {
      try {
        fixturePid = JSON.parse(await readFile(join(data, "host.json"), "utf8")).pid;
      } catch {}
    }
    if (fixturePid) {
      try {
        process.kill(fixturePid);
      } catch {}
    }
    blocker.closeAllConnections();
    await new Promise((done) => blocker.close(done));
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("invalid configured port is rejected before starting a Host", async () => {
  await withHostEnvironment({ KODO_HOST_PORT: "invalid" }, async () => {
    await assert.rejects(ensureHost(), /1 到 65535/);
  });
});

test("a live data-directory owner is never overwritten when discovery is unavailable", async () => {
  const data = await mkdtemp(join(tmpdir(), "kooyu-live-owner-"));
  try {
    await writeFile(join(data, "host.lock"), String(process.pid));
    await withHostEnvironment({ KODO_DATA_DIR: data }, async () => {
      await assert.rejects(ensureHost(), /已有 Host 正在使用此数据目录/);
      assert.equal(await readFile(join(data, "host.lock"), "utf8"), String(process.pid));
    });
  } finally {
    await rm(data, { recursive: true, force: true });
  }
});
test("desktop reuses compatible Host and fails closed on an incompatible or unhealthy endpoint", async () => {
  let version = PROTOCOL_VERSION,
    status = 200;
  const server = createServer((_req, response) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify({ protocolVersion: version, hostId: "test-host" }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const previous = process.env.KODO_HOST_URL;
  try {
    const url = "http://127.0.0.1:" + server.address().port;
    process.env.KODO_HOST_URL = url;
    assert.equal(await ensureHost(), url);
    version--;
    await assert.rejects(ensureHost(), /协议版本不兼容/);
    status = 503;
    await assert.rejects(ensureHost(), /健康检查失败/);
  } finally {
    if (previous === undefined) delete process.env.KODO_HOST_URL;
    else process.env.KODO_HOST_URL = previous;
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
});
