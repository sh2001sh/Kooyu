import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { installedHostBuild } from "@kodo/platform";

const exec = promisify(execFile);
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export async function installerHandoffTicket(
  resources: string,
  data: string,
): Promise<string | undefined> {
  const expected = installedHostBuild(join(resources, "host"));
  if (!expected) return;
  const node = join(resources, "runtime", process.platform === "win32" ? "node.exe" : "node");
  const result = await exec(
    node,
    [
      "--input-type=module",
      "-e",
      `
    import { DatabaseSync } from 'node:sqlite';
    import { existsSync } from 'node:fs';
    import { join } from 'node:path';
    const file=join(process.argv[1],'kodo.sqlite');
    if (existsSync(file)) {
      const db=new DatabaseSync(file);
      try {
        const row=db.prepare("SELECT data FROM records WHERE kind='lifecycle' AND id='upgrade'").get();
        const handoff=row&&JSON.parse(row.data);
        if(handoff?.installer && typeof handoff.ticket==='string') {
          db.prepare("UPDATE records SET data=? WHERE kind='lifecycle' AND id='upgrade'").run(JSON.stringify({...handoff,installer:false,buildId:process.argv[2]}));
          console.log(handoff.ticket);
        }
      } finally {db.close();}
    }
  `,
      data,
      expected,
    ],
    { windowsHide: true },
  );
  return result.stdout.trim() || undefined;
}
/** Local registered hosts only. Explicit service URLs are never managed here. */
export async function reconcileHostBuild(
  resources: string,
  data: string,
  url: string,
  hostId: string,
  runningBuild?: string,
): Promise<boolean> {
  const root = join(resources, "host");
  const expected = installedHostBuild(root);
  if (!expected) throw new Error("后台安装文件不完整，请完成安装后再打开 Kooyu。");
  if (runningBuild === expected) return true;
  const request = async (path: string, body?: unknown) =>
    fetch(url + path, {
      method: body ? "POST" : "GET",
      headers: body ? { "content-type": "application/json" } : {},
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(5000),
    });
  const response = await request("/internal/upgrade", { buildId: expected });
  if (response.ok) {
    for (let attempt = 0; attempt < 100; attempt++) {
      await delay(250);
      try {
        const health = await (await request("/api/health")).json();
        if (health.hostId !== hostId) throw new Error("升级期间 Host 身份发生变化。");
        if (health.buildId === expected) return true;
      } catch (error) {
        if (error instanceof Error && /身份|现有任务/.test(error.message)) throw error;
      }
    }
    throw new Error("后台正在切换新版，请稍后重新打开 Kooyu；现有数据已保留。");
  }
  if (response.status !== 404) throw new Error("后台拒绝版本切换，请检查后台状态后重试。");
  // One-time bridge for versions released before automatic handoff existed.
  const registered = JSON.parse(readFileSync(join(data, "host.json"), "utf8"));
  const pid = registered.pid;
  if (
    !Number.isSafeInteger(pid) ||
    pid <= 0 ||
    registered.hostId !== hostId ||
    registered.url !== url ||
    Number(readFileSync(join(data, "host.lock"), "utf8")) !== pid
  )
    throw new Error("旧后台身份无法核对，未停止任何进程。");
  const node = join(resources, "runtime", process.platform === "win32" ? "node.exe" : "node");
  const entry = resolve(root, "packages/host/dist/main.js");
  if (process.platform !== "win32") throw new Error("此旧版后台需要先退出再启动，原有任务已保留。");
  const processInfo = JSON.parse(
    (
      await exec(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' | Select-Object ExecutablePath,CommandLine | ConvertTo-Json -Compress`,
        ],
        { windowsHide: true },
      )
    ).stdout,
  );
  if (
    resolve(processInfo.ExecutablePath).toLowerCase() !== resolve(node).toLowerCase() ||
    !String(processInfo.CommandLine).toLowerCase().includes(entry.toLowerCase())
  )
    throw new Error("旧后台执行路径不匹配，未停止任何进程。");
  const status = await (await request("/api/work/status")).json();
  if (status.hostId !== hostId || status.pid !== pid) throw new Error("旧后台身份不匹配，未重启。");
  const pauseResponse = await request("/internal/quiesce", {});
  if (!pauseResponse.ok) throw new Error("无法暂停旧后台接收新任务，未重启。");
  const snapshot = await (await request("/api/snapshot")).json();
  for (const session of snapshot.sessions) {
    if (session.phase === "native" || session.runState !== "idle")
      await request(`/api/sessions/${session.id}/stop`, { pause: true, requestId: randomUUID() });
  }
  const frozenResponse = await request("/internal/quiesce", {});
  if (!frozenResponse.ok) throw new Error("无法暂停旧后台接收新任务，未重启。");
  const frozen = await frozenResponse.json();
  try {
    if (frozen.pid !== pid || frozen.hostId !== hostId)
      throw new Error("旧后台尚未空闲，已延后升级。");
    const ticket = randomUUID();
    await exec(
      node,
      [
        "--input-type=module",
        "-e",
        `
      import { DatabaseSync, backup } from 'node:sqlite';
      import { mkdirSync } from 'node:fs';
      import { join } from 'node:path';
      const [data, ticket, buildId] = process.argv.slice(1);
      const db = new DatabaseSync(join(data, 'kodo.sqlite'));
      try {
        mkdirSync(join(data, 'upgrade-backups'), {recursive:true});
        await backup(db, join(data, 'upgrade-backups', Date.now()+'-'+ticket+'.sqlite'));
        const gate = JSON.parse(db.prepare("SELECT data FROM records WHERE kind='lifecycle' AND id='gate'").get().data);
        db.prepare("INSERT OR REPLACE INTO records(kind,id,data) VALUES ('lifecycle','upgrade',?)").run(JSON.stringify({ticket,buildId,generation:gate.generation}));
        const sessionIds=db.prepare("SELECT session_id FROM session_state").all().map(s=>s.session_id);
        db.prepare("INSERT OR REPLACE INTO records(kind,id,data) VALUES ('lifecycle','update-paused',?)").run(JSON.stringify({generation:gate.generation,sessionIds}));
      } finally { db.close(); }
    `,
        data,
        ticket,
        expected,
      ],
      { windowsHide: true },
    );
    if (installedHostBuild(root) !== expected) throw new Error("安装文件发生变化，暂缓后台切换。");
    process.kill(pid);
    for (let attempt = 0; attempt < 60; attempt++) {
      let alive = true;
      try {
        process.kill(pid, 0);
      } catch {
        alive = false;
      }
      if (!alive) {
        process.env.KOOYU_UPGRADE_TICKET = ticket;
        return false;
      }
      await delay(250);
    }
    throw new Error("旧后台尚未退出，请稍后重试。");
  } catch (error) {
    await request("/internal/resume", {
      processIdentity: frozen.processIdentity,
      generation: frozen.generation,
    }).catch(() => {});
    throw error;
  }
}
