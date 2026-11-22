import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import {
  KodoError,
  HARNESS_IDS,
  type EngineInstallationOption,
  type EngineInstallJob,
  type HarnessId,
} from "@kodo/protocol";
import { executable } from "../harnesses/rpc.js";
import { refreshDesktopInstallations } from "../harnesses/desktop-installations.js";
import { launchDefaults, normalizeAntigravityProxy } from "./config.js";
import type { Store } from "../storage/store.js";

const registry: Partial<
  Record<HarnessId, { packageName: string; bin: string; documentation: string }>
> = {
  codex: {
    packageName: "@openai/codex",
    bin: "codex",
    documentation: "https://developers.openai.com/codex/cli/",
  },
  gemini: {
    packageName: "@google/gemini-cli",
    bin: "gemini",
    documentation: "https://geminicli.com/docs/get-started/installation/",
  },
  opencode: {
    packageName: "opencode-ai",
    bin: "opencode",
    documentation: "https://opencode.ai/docs/",
  },
  "kimi-code": {
    packageName: "@moonshot-ai/kimi-code",
    bin: "kimi",
    documentation: "https://moonshotai.github.io/kimi-code/",
  },
};
const documentation: Record<HarnessId, string> = {
  kodo: "https://github.com/earendil-works/pi",
  pi: "https://github.com/earendil-works/pi",
  codex: registry.codex!.documentation,
  gemini: registry.gemini!.documentation,
  opencode: registry.opencode!.documentation,
  "claude-code": "https://code.claude.com/docs/en/setup",
  "deepseek-harness": "https://github.com/deepseek-ai/DeepSeek-Harness",
  zcode: "https://zcode.z.ai/",
  cursor: "https://cursor.com/docs/cli/installation",
  "kimi-code": registry["kimi-code"]!.documentation,
  antigravity: "https://antigravity.google/docs/cli/overview",
  "grok-build": "https://x.ai/cli",
};
type Override = {
  command?: string;
  args?: string[];
  managedVersion?: string;
  proxyUrl?: string;
  [key: string]: unknown;
};

/** Install into a fresh generation; switch the launch entry only after success. */
export class EngineManager {
  private pending = new Set<Promise<void>>();
  constructor(
    private store: Store,
    private dataDir: string,
    private options: { installPackage?: (packageName: string, root: string) => Promise<void> } = {},
  ) {
    for (const job of store.records<EngineInstallJob>("engine-install-job"))
      if (job.state === "running")
        store.put("engine-install-job", job.harnessId, {
          ...job,
          state: "failed",
          message: "Host 重启中断了安装，原安装仍保留，可以重试。",
          finishedAt: new Date().toISOString(),
        });
  }
  private read(): Partial<Record<HarnessId, Override>> {
    const file = join(this.dataDir, "installations.json");
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  }
  private write(value: Partial<Record<HarnessId, Override>>) {
    const file = join(this.dataDir, "installations.json"),
      temp = `${file}.${randomUUID()}.tmp`;
    mkdirSync(this.dataDir, { recursive: true });
    writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
    renameSync(temp, file);
    refreshDesktopInstallations();
  }
  list(): EngineInstallationOption[] {
    const entries = this.read();
    return HARNESS_IDS.map((harnessId) => ({
      harnessId,
      kind: registry[harnessId]
        ? "managed-npm"
        : ["kodo", "pi", "claude-code"].includes(harnessId)
          ? "bundled"
          : "external",
      packageName: registry[harnessId]?.packageName,
      documentation: documentation[harnessId],
      command: entries[harnessId]?.command,
      args: entries[harnessId]?.args,
      managedVersion: entries[harnessId]?.managedVersion,
      proxyUrl: harnessId === "antigravity" ? entries[harnessId]?.proxyUrl : undefined,
      canRestore: Boolean(this.store.record("engine-install-previous", harnessId)),
      job: this.store.record<EngineInstallJob>("engine-install-job", harnessId),
    }));
  }
  setAntigravityProxy(value: string) {
    const entries = this.read();
    entries.antigravity = {
      ...entries.antigravity,
      proxyUrl: value ? normalizeAntigravityProxy(value) : undefined,
    };
    this.write(entries);
    return this.list();
  }
  configure(harnessId: HarnessId, input: { command: string; args: string[] }) {
    if (this.store.record<EngineInstallJob>("engine-install-job", harnessId)?.state === "running")
      throw new KodoError("CONFLICT", "请等待此引擎安装结束后再更改入口。");
    if (!executable(input.command))
      throw new KodoError("INVALID_INPUT", "启动程序不存在或不可执行，请填写完整路径。");
    const entries = this.read();
    this.store.put("engine-install-previous", harnessId, { value: entries[harnessId] ?? null });
    this.write({
      ...entries,
      [harnessId]: { ...entries[harnessId], ...input, managedVersion: undefined },
    });
    return this.list();
  }
  restore(harnessId: HarnessId) {
    if (this.store.record<EngineInstallJob>("engine-install-job", harnessId)?.state === "running")
      throw new KodoError("CONFLICT", "安装过程中不能切换入口。");
    const previous = this.store.record<{ value: Override | null }>(
      "engine-install-previous",
      harnessId,
    );
    if (!previous) throw new KodoError("NOT_FOUND", "没有可恢复的安装入口。");
    const entries = this.read(),
      current = entries[harnessId] ?? null;
    if (previous.value) entries[harnessId] = previous.value;
    else delete entries[harnessId];
    if (harnessId === "antigravity") {
      entries.antigravity = { ...entries.antigravity, proxyUrl: current?.proxyUrl };
    }
    this.write(entries);
    this.store.put("engine-install-previous", harnessId, { value: current });
    return this.list();
  }
  start(harnessId: HarnessId, action: "install" | "upgrade"): EngineInstallJob {
    if (!registry[harnessId])
      throw new KodoError(
        "UNSUPPORTED",
        "此引擎随应用更新或需要官方安装器，请使用显示的安装说明。",
      );
    if (this.store.record<EngineInstallJob>("engine-install-job", harnessId)?.state === "running")
      throw new KodoError("CONFLICT", "此引擎已在安装中。");
    const job: EngineInstallJob = {
      id: randomUUID(),
      harnessId,
      action,
      state: "running",
      message: "正在下载并安装官方发行包，原入口继续保留…",
      startedAt: new Date().toISOString(),
    };
    this.store.put("engine-install-job", harnessId, job);
    const task = this.install(job).finally(() => this.pending.delete(task));
    this.pending.add(task);
    return job;
  }
  private async install(job: EngineInstallJob) {
    try {
      const spec = registry[job.harnessId]!,
        root = join(this.dataDir, "engines", job.harnessId, job.id);
      mkdirSync(root, { recursive: true });
      await (
        this.options.installPackage ?? ((packageName, root) => this.installNpm(packageName, root))
      )(spec.packageName, root);
      const packageRoot = join(root, "node_modules", spec.packageName),
        manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
      const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[spec.bin];
      if (typeof bin !== "string") throw new Error("发行包未包含已知的启动入口，原入口仍保留。");
      const entry = resolve(packageRoot, bin);
      if (
        !entry.startsWith(resolve(packageRoot) + (process.platform === "win32" ? "\\" : "/")) ||
        !existsSync(entry)
      )
        throw new Error("安装入口校验失败。");
      const node = /[.](?:c?js|mjs)$/.test(extname(entry)),
        entries = this.read();
      this.store.put("engine-install-previous", job.harnessId, {
        value: entries[job.harnessId] ?? null,
      });
      this.write({
        ...entries,
        [job.harnessId]: {
          command: node ? process.execPath : entry,
          args: [...(node ? [entry] : []), ...launchDefaults[job.harnessId].args],
          managedVersion: String(manifest.version),
        },
      });
      this.store.put("engine-install-job", job.harnessId, {
        ...job,
        state: "succeeded",
        version: String(manifest.version),
        message: "安装完成，新会话将使用此版本。",
        finishedAt: new Date().toISOString(),
      });
    } catch (error) {
      this.store.put("engine-install-job", job.harnessId, {
        ...job,
        state: "failed",
        message: error instanceof Error ? error.message : "安装失败，原入口仍保留。",
        finishedAt: new Date().toISOString(),
      });
    }
  }
  private async installNpm(packageName: string, root: string) {
    const npm = executable("npm");
    const npmCli = [
      join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
      ...(npm ? [join(dirname(npm), "node_modules/npm/bin/npm-cli.js")] : []),
    ].find(existsSync);
    if (!npmCli) throw new Error("未发现 npm，请先安装含 npm 的 Node.js 后重试。");
    await new Promise<void>((done, reject) => {
      const child = spawn(
        process.execPath,
        [
          npmCli,
          "install",
          "--prefix",
          root,
          "--no-audit",
          "--no-fund",
          "--registry=https://registry.npmjs.org",
          `${packageName}@latest`,
        ],
        { windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] },
      );
      // Drain output without persisting credentials or arbitrary installer logs.
      child.stdout.resume();
      child.stderr.resume();
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("安装超时，原入口仍保留，请检查网络后重试。"));
      }, 300000);
      child.once("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        if (code === 0) done();
        else
          reject(new Error(`安装失败（退出码 ${code ?? "unknown"}），请检查 npm 和网络后重试。`));
      });
    });
  }
  async close() {
    await Promise.allSettled(this.pending);
  }
}
