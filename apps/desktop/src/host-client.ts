import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, openSync, closeSync, mkdirSync, readFileSync } from "node:fs";
import { hostDataDirectory, hostEnvironment } from "@kodo/platform";
import { PROTOCOL_VERSION } from "@kodo/protocol/client";
import { reconcileHostBuild, installerHandoffTicket } from "./host-upgrade.js";

function isAlive(pid: unknown): pid is number {
  if (!Number.isInteger(pid) || Number(pid) <= 0) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function discovery(data: string): { url: string; hostId: string } | undefined {
  try {
    const record = JSON.parse(readFileSync(join(data, "host.json"), "utf8"));
    if (
      !record ||
      record.discoveryVersion !== 1 ||
      !isAlive(record.pid) ||
      typeof record.hostId !== "string" ||
      !record.hostId ||
      typeof record.url !== "string"
    )
      return;
    const url = new URL(record.url);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      return;
    return { url: url.origin, hostId: record.hostId };
  } catch {
    return;
  }
}

async function availablePort(preferred: number, fallback: boolean): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (fallback && ["EADDRINUSE", "EACCES"].includes(error.code ?? ""))
        availablePort(0, false).then(resolve, reject);
      else reject(new Error("Host 端口不可用，请检查 KOOYU_HOST_PORT 配置。", { cause: error }));
    });
    server.listen(preferred, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("无法分配 Host 端口。"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

export async function ensureHost(resourcesPath?: string): Promise<string> {
  const data = hostDataDirectory();
  const explicitUrl = process.env.KOOYU_HOST_URL ?? process.env.KODO_HOST_URL;
  const explicitPort = process.env.KOOYU_HOST_PORT ?? process.env.KODO_HOST_PORT;
  let port = Number(explicitPort ?? 4310);
  if (!explicitUrl && (!Number.isInteger(port) || port < 1 || port > 65535))
    throw new Error("KOOYU_HOST_PORT 必须是 1 到 65535 之间的端口号。");
  const registered = explicitUrl ? undefined : discovery(data);
  if (registered && explicitPort !== undefined && Number(new URL(registered.url).port) !== port)
    throw new Error("此数据目录已有 Host 使用其他端口，请修正 KOOYU_HOST_PORT；现有任务未被停止。");
  let url = explicitUrl?.replace(/\/$/, "") ?? registered?.url ?? `http://127.0.0.1:${port}`;
  let runningBuild: string | undefined;
  let legacyHandoff = false;
  const health = async (expectedHostId = registered?.hostId) => {
    let r: Response;
    try {
      r = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1000) });
    } catch {
      return false;
    }
    if (!r.ok) throw new Error("Host 健康检查失败，请检查已运行的服务。");
    let info;
    try {
      info = await r.json();
    } catch {
      throw new Error("Host 返回无效 JSON；配置端口可能已被占用。");
    }
    if (
      !info ||
      typeof info.hostId !== "string" ||
      !info.hostId ||
      !Number.isInteger(info.protocolVersion)
    )
      throw new Error("配置地址未能识别为 Kooyu Host，请核对端口配置。");
    runningBuild = info.buildId;
    if (info.protocolVersion !== PROTOCOL_VERSION && (!resourcesPath || explicitUrl || !registered))
      throw new Error("Host 协议版本不兼容，请先处理活动任务后升级或重启 Host。");
    if (expectedHostId && info.hostId !== expectedHostId)
      throw new Error("Host 身份与本地记录不一致，请检查端口占用；原有数据保持不变。");
    return true;
  };
  // Only attach to an explicitly configured endpoint or this data directory's
  // registered Host. An arbitrary listener on 4310 can belong to QQ.
  if ((explicitUrl || explicitPort !== undefined || registered) && (await health())) {
    if (
      !explicitUrl &&
      registered &&
      resourcesPath &&
      existsSync(join(resourcesPath, "host/host-build.json"))
    ) {
      if (await reconcileHostBuild(resourcesPath, data, url, registered.hostId, runningBuild))
        return url;
      // A verified idle legacy Host exited. Reuse its port and database.
      port = Number(new URL(url).port);
      legacyHandoff = true;
    } else return url;
  }
  if (explicitUrl) throw new Error("配置的 KOOYU_HOST_URL 不可用，请启动对应 Host 或修正地址。");
  let owner: number | undefined;
  try {
    owner = Number(readFileSync(join(data, "host.lock"), "utf8"));
  } catch {}
  if (isAlive(owner))
    throw new Error(
      "已有 Host 正在使用此数据目录，但连接不可用。请检查 host-process.log；现有任务未被停止。",
    );
  if (legacyHandoff) {
    for (let attempt = 0; ; attempt++) {
      try {
        port = await availablePort(port, false);
        break;
      } catch (error) {
        if (attempt >= 59) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  } else port = await availablePort(port, explicitPort === undefined);
  url = `http://127.0.0.1:${port}`;
  const entry = resourcesPath
    ? join(resourcesPath, "host", "packages", "host", "dist", "main.js")
    : fileURLToPath(new URL("../../../packages/host/dist/main.js", import.meta.url));
  if (!existsSync(entry)) throw new Error("Host 尚未构建。请运行 npm run build。");
  mkdirSync(data, { recursive: true });
  // A real Node executable is required: Electron's Node has its own SQLite ABI/runtime.
  const node =
      process.env.KOOYU_NODE_PATH ??
      process.env.KODO_NODE_PATH ??
      (resourcesPath
        ? join(resourcesPath, "runtime", process.platform === "win32" ? "node.exe" : "node")
        : "node"),
    log = openSync(join(data, "host-process.log"), "a");
  const env = hostEnvironment({
    ...process.env,
    KOOYU_DATA_DIR: data,
    KOOYU_HOST_PORT: String(port),
    KODO_DATA_DIR: data,
    KODO_HOST_PORT: String(port),
  });
  if (!env.KOOYU_UPGRADE_TICKET && resourcesPath && existsSync(join(data, "kodo.sqlite")))
    env.KOOYU_UPGRADE_TICKET = await installerHandoffTicket(resourcesPath, data);
  delete process.env.KOOYU_UPGRADE_TICKET;
  const child = spawn(node, [entry], {
    detached: true,
    windowsHide: true,
    stdio: ["ignore", log, log],
    env,
  });
  child.unref();
  closeSync(log);
  let spawnError: Error | undefined;
  let exited = false;
  child.once("exit", () => {
    exited = true;
  });
  child.once("error", (error) => {
    spawnError = error;
  });
  for (let attempt = 0; attempt < 60; attempt++) {
    if (spawnError) throw spawnError;
    const started = discovery(data);
    if (started?.url === url && (await health(started.hostId))) return url;
    if (exited) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("Host 未启动，请检查 host-process.log 和 Node >=24.13。");
}
