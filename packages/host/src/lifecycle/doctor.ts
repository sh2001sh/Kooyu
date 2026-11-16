import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rmSync, statfsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionService } from "../session-service.js";
import { secretVault } from "../credentials/vault.js";

export interface DoctorCheck {
  id: string;
  label: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}
export interface DoctorReport {
  checkedAt: string;
  /** Process alive is not the same as "work can succeed"; each layer is listed. */
  status: "ok" | "degraded" | "failing";
  checks: DoctorCheck[];
}

const gitVersion = () =>
  new Promise<string | null>((resolve) =>
    execFile("git", ["--version"], { timeout: 5000, windowsHide: true }, (error, stdout) =>
      resolve(error ? null : String(stdout).trim()),
    ),
  );

/**
 * Host self-check: runtime, data directory, database, credential vault, tools and
 * user-facing backlog. It reads state only; it never repairs or restarts anything.
 */
export async function runDoctor(service: SessionService): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const add = (id: string, label: string, status: DoctorCheck["status"], detail: string) =>
    checks.push({ id, label, status, detail });

  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  add(
    "node",
    "Node.js 运行时",
    major > 24 || (major === 24 && minor >= 13) ? "ok" : "fail",
    `v${process.versions.node}（需要 ≥ 24.13）`,
  );

  try {
    const probe = join(service.dataDir, `.doctor-${randomUUID()}`);
    writeFileSync(probe, "ok", { mode: 0o600 });
    rmSync(probe, { force: true });
    add("data-dir", "数据目录可写", "ok", service.dataDir);
  } catch (error) {
    add("data-dir", "数据目录可写", "fail", error instanceof Error ? error.message : String(error));
  }

  try {
    const free = statfsSync(service.dataDir);
    const bytes = Number(free.bavail) * Number(free.bsize);
    add(
      "disk",
      "可用磁盘空间",
      bytes < 1024 ** 3 ? "warn" : "ok",
      `${(bytes / 1024 ** 3).toFixed(1)} GiB`,
    );
  } catch {
    add("disk", "可用磁盘空间", "warn", "无法读取磁盘空间。");
  }

  try {
    const quick = service.store.db.prepare("PRAGMA quick_check").get();
    const version = service.store.db.prepare("PRAGMA user_version").get()?.user_version;
    const ok = Object.values(quick ?? {})[0] === "ok";
    add(
      "database",
      "SQLite 数据库",
      ok ? "ok" : "fail",
      `${ok ? "完整性检查通过" : "完整性检查失败"}；schema v${version}`,
    );
  } catch (error) {
    add(
      "database",
      "SQLite 数据库",
      "fail",
      error instanceof Error ? error.message : String(error),
    );
  }

  const vault = secretVault().status();
  add(
    "vault",
    "凭据库",
    vault.available ? "ok" : "fail",
    vault.available
      ? vault.backend === "system"
        ? "系统凭据库（实际读写在首次使用时验证）"
        : `加密文件：${vault.location}`
      : (vault.reason ?? "不可用"),
  );

  const git = await gitVersion();
  add(
    "git",
    "Git（目标基线与改动归因）",
    git ? "ok" : "warn",
    git ?? "未找到 git，目标将无法记录改动基线。",
  );

  const search = service.web.status();
  add(
    "web-search",
    "网页检索",
    search.configured ? "ok" : "warn",
    search.configured
      ? `${search.provider}（${search.source === "environment" ? "环境变量" : "设置"}；未做在线验证）`
      : "未配置检索服务；仍可读取指定网页。",
  );

  const snapshot = service.snapshot();
  const launchable = snapshot.harnesses.filter((h) => h.health?.launchable).length;
  add(
    "harnesses",
    "可启动的 Harness",
    launchable ? "ok" : "warn",
    `${launchable}/${snapshot.harnesses.length} 个可启动；登录与模型可用性未验证。`,
  );

  const pending = snapshot.inbox.filter((i) => !i.resolved).length;
  const review = service.goals.list().filter((g) => g.status === "awaiting-review").length;
  const blocked = service.goals.list().filter((g) => g.status === "blocked").length;
  add(
    "attention",
    "等待你处理",
    "ok",
    `收件箱 ${pending} 项；待验收目标 ${review} 个；受阻目标 ${blocked} 个。`,
  );

  const status = checks.some((c) => c.status === "fail")
    ? "failing"
    : checks.some((c) => c.status === "warn")
      ? "degraded"
      : "ok";
  return { checkedAt: new Date().toISOString(), status, checks };
}
