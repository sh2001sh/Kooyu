import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  chmodSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_UPDATE_SETTINGS,
  KodoError,
  type AppUpdateAsset,
  type AppUpdateAssetPlatform,
  type AppUpdateDownloadState,
  type AppUpdateRelease,
  type AppUpdateStatus,
} from "@kodo/protocol";
import { appSettings } from "./configuration/preferences.js";
import type { Store } from "./storage/store.js";

const CHECK_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_INSTALLER_BYTES = 512 * 1024 * 1024;
const STORE_KIND = "app-update";
const STORE_KEY = "state";

interface PersistedUpdateCache {
  checkedAt: string | null;
  latest: AppUpdateRelease | null;
  downloadedTag: string | null;
  downloadedAssetName: string | null;
  downloadedPath: string | null;
  sha256Verified: boolean;
}

interface GithubReleaseAssetWire {
  name?: string;
  browser_download_url?: string;
  size?: number;
}

interface GithubReleaseWire {
  tag_name?: string;
  name?: string;
  body?: string;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string;
  html_url?: string;
  assets?: GithubReleaseAssetWire[];
}

export function resolveCurrentAppVersion(): string {
  const fromEnv = process.env.KOOYU_APP_VERSION?.trim();
  if (fromEnv && /^\d+\.\d+\.\d+/.test(fromEnv)) return fromEnv;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) {
      try {
        const parsed = JSON.parse(readFileSync(candidate, "utf8")) as { version?: string };
        if (
          typeof parsed.version === "string" &&
          /^\d+\.\d+\.\d+/.test(parsed.version) &&
          parsed.version !== "0.0.0"
        ) {
          return parsed.version;
        }
      } catch {}
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "0.2.1";
}

export function parseReleaseTag(
  tag: string,
  githubPrerelease = false,
): { version: string; buildNumber: number | null; prerelease: boolean } | null {
  const clean = tag.trim();
  const stable = /^v?(\d+\.\d+\.\d+)$/.exec(clean);
  if (stable) {
    return { version: stable[1]!, buildNumber: null, prerelease: githubPrerelease };
  }
  const preview = /^preview-(\d+\.\d+\.\d+)-(\d+)$/.exec(clean);
  if (preview) {
    return {
      version: preview[1]!,
      buildNumber: Number(preview[2]),
      prerelease: true,
    };
  }
  const generic = /^v?(\d+\.\d+\.\d+)(?:-[A-Za-z0-9.-]+)?$/.exec(clean);
  if (generic) {
    return {
      version: generic[1]!,
      buildNumber: null,
      prerelease: true,
    };
  }
  return null;
}

export function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export function compareReleases(
  a: Pick<AppUpdateRelease, "version" | "prerelease" | "buildNumber">,
  b: Pick<AppUpdateRelease, "version" | "prerelease" | "buildNumber">,
): number {
  const v = compareSemver(a.version, b.version);
  if (v !== 0) return v;
  // Same X.Y.Z: stable outranks prerelease.
  if (a.prerelease !== b.prerelease) return a.prerelease ? -1 : 1;
  return (a.buildNumber ?? 0) - (b.buildNumber ?? 0);
}

export function isReleaseNewer(
  currentVersion: string,
  candidate: Pick<AppUpdateRelease, "version" | "prerelease" | "buildNumber">,
  channel: "stable" | "preview",
): boolean {
  const cmp = compareSemver(candidate.version, currentVersion);
  if (cmp > 0) return true;
  if (cmp < 0) return false;
  // On preview channel, allow upgrading to a numbered preview build of the same X.Y.Z.
  return channel === "preview" && candidate.prerelease && (candidate.buildNumber ?? 0) > 0;
}

export function classifyReleaseAsset(name: string): AppUpdateAssetPlatform {
  const low = name.toLowerCase();
  if (low.endsWith(".exe")) return "windows";
  if (low.endsWith(".dmg")) {
    return low.includes("arm64") ? "macos-arm64" : "macos-x64";
  }
  if (low.endsWith(".appimage")) return "linux-appimage";
  if (low.endsWith(".deb")) return "linux-deb";
  if (low.endsWith(".apk")) return "android";
  if (low.includes("ios") && low.endsWith(".zip")) return "ios";
  return "other";
}

export function pickRecommendedAsset(
  assets: AppUpdateAsset[],
  platform: string = process.platform,
  arch: string = process.arch,
): AppUpdateAsset | null {
  if (platform === "win32") {
    return assets.find((a) => a.platform === "windows") ?? null;
  }
  if (platform === "darwin") {
    const preferred = arch === "arm64" ? "macos-arm64" : "macos-x64";
    return (
      assets.find((a) => a.platform === preferred) ??
      assets.find((a) => a.platform === "macos-arm64" || a.platform === "macos-x64") ??
      null
    );
  }
  if (platform === "linux") {
    return (
      assets.find((a) => a.platform === "linux-appimage") ??
      assets.find((a) => a.platform === "linux-deb") ??
      null
    );
  }
  return null;
}

export function parseSha256Sums(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(line);
    if (match) {
      map.set(basename(match[2]!.trim()), match[1]!.toLowerCase());
    }
  }
  return map;
}

function safeFileSegment(value: string): string {
  const clean = basename(value).replace(/[^A-Za-z0-9._-]/g, "_");
  if (!clean || clean === "." || clean === "..") {
    throw new KodoError("INVALID_INPUT", "无效的更新文件名。");
  }
  return clean;
}

function assertSafeHttpsUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new KodoError("INVALID_INPUT", "更新下载地址无效。");
  }
  if (parsed.protocol !== "https:") {
    throw new KodoError("INVALID_INPUT", "出于安全要求，仅允许通过 HTTPS 下载更新包。");
  }
  return parsed.toString();
}

async function computeFileSha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(readFileSync(filePath));
  return hash.digest("hex");
}

function emptyDownload(): AppUpdateDownloadState {
  return {
    state: "idle",
    tag: null,
    assetName: null,
    downloadedBytes: 0,
    totalBytes: null,
    localPath: null,
    sha256Verified: false,
    error: null,
  };
}

export interface AppUpdaterOptions {
  prepareInstall?: () => Promise<void>;
  rollbackInstall?: () => void;
  fetcher?: typeof fetch;
  currentVersion?: string;
  platform?: string;
  arch?: string;
  launcher?: (localPath: string, platform: string) => void | Promise<void>;
  onInstallLaunched?: (platform: string) => void;
}

function runShellLauncher(command: string, args: string[], env?: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolveDone, rejectDone) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
      ...(env ? { env } : {}),
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer | string) => {
      if (stderr.length < 2048) stderr += String(chunk);
    });
    child.once("error", (err) => rejectDone(err));
    child.once("close", (code) => {
      if (code === 0) resolveDone();
      else
        rejectDone(new Error(stderr.trim() || `${command} exited with code ${code ?? "unknown"}`));
    });
  });
}

async function launchInstallerByPlatform(resolvedPath: string, platform: string): Promise<void> {
  if (platform === "win32") {
    try {
      await runShellLauncher(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-WindowStyle",
          "Hidden",
          "-Command",
          "Start-Process -FilePath $env:KOOYU_INSTALLER_PATH",
        ],
        { ...process.env, KOOYU_INSTALLER_PATH: resolvedPath },
      );
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code === "ENOENT") {
        await runShellLauncher("cmd.exe", ["/d", "/c", "start", "", resolvedPath]);
        return;
      }
      const detail = err instanceof Error ? err.message : String(err);
      throw new KodoError(
        "UNAVAILABLE",
        `未能启动 Kooyu 安装程序（${detail.split(/\r?\n/)[0]?.slice(0, 120) || "启动被取消或拦截"}），可点击「打开所在目录」手动运行安装包。`,
      );
    }
  }
  if (platform === "darwin") {
    await runShellLauncher("open", [resolvedPath]);
    return;
  }
  if (resolvedPath.toLowerCase().endsWith(".appimage")) {
    chmodSync(resolvedPath, 0o755);
  }
  await runShellLauncher("xdg-open", [dirname(resolvedPath)]);
}

async function revealPathByPlatform(resolvedPath: string, platform: string): Promise<void> {
  if (platform === "win32") {
    const child = spawn("explorer.exe", [`/select,${resolvedPath}`], {
      detached: true,
      windowsHide: false,
      stdio: "ignore",
    });
    child.once("error", () => {});
    child.unref();
    return;
  }
  if (platform === "darwin") {
    await runShellLauncher("open", ["-R", resolvedPath]);
    return;
  }
  await runShellLauncher("xdg-open", [dirname(resolvedPath)]);
}

export class AppUpdater {
  private readonly npmDistribution = process.env.KOOYU_DISTRIBUTION === "npm";
  private readonly prepareInstall?: () => Promise<void>;
  private readonly rollbackInstall?: () => void;
  private readonly fetcher: typeof fetch;
  private readonly currentVersion: string;
  private readonly platform: string;
  private readonly arch: string;
  private readonly updatesDir: string;
  private readonly launcher?: (localPath: string, platform: string) => void | Promise<void>;
  private readonly onInstallLaunched?: (platform: string) => void;

  private state: AppUpdateStatus["state"] = "idle";
  private checkedAt: string | null = null;
  private latest: AppUpdateRelease | null = null;
  private error: string | null = null;
  private downloadState: AppUpdateDownloadState = emptyDownload();
  private checkInFlight: Promise<AppUpdateStatus> | null = null;
  private downloadAbort: AbortController | null = null;

  constructor(
    private readonly store: Store,
    dataDir: string,
    options: AppUpdaterOptions = {},
  ) {
    this.fetcher = options.fetcher ?? fetch;
    this.currentVersion = options.currentVersion ?? resolveCurrentAppVersion();
    this.platform = options.platform ?? process.platform;
    this.arch = options.arch ?? process.arch;
    this.updatesDir = join(dataDir, "updates");
    this.launcher = options.launcher;
    this.prepareInstall = options.prepareInstall;
    this.rollbackInstall = options.rollbackInstall;
    this.onInstallLaunched = options.onInstallLaunched;
    this.hydrateFromStore();
  }

  private hydrateFromStore() {
    const cached = this.store.record<PersistedUpdateCache>(STORE_KIND, STORE_KEY);
    if (!cached) return;
    this.checkedAt = cached.checkedAt ?? null;
    this.latest = cached.latest ?? null;
    if (this.latest) {
      const cfg = this.config();
      this.state = isReleaseNewer(this.currentVersion, this.latest, cfg.channel)
        ? "available"
        : "up-to-date";
    }
    if (
      cached.downloadedPath &&
      cached.downloadedTag &&
      cached.downloadedAssetName &&
      existsSync(cached.downloadedPath)
    ) {
      try {
        const size = statSync(cached.downloadedPath).size;
        this.downloadState = {
          state: "ready",
          tag: cached.downloadedTag,
          assetName: cached.downloadedAssetName,
          downloadedBytes: size,
          totalBytes: size,
          localPath: cached.downloadedPath,
          sha256Verified: Boolean(cached.sha256Verified),
          error: null,
        };
      } catch {}
    }
  }

  private persist() {
    const payload: PersistedUpdateCache = {
      checkedAt: this.checkedAt,
      latest: this.latest,
      downloadedTag: this.downloadState.state === "ready" ? this.downloadState.tag : null,
      downloadedAssetName:
        this.downloadState.state === "ready" ? this.downloadState.assetName : null,
      downloadedPath: this.downloadState.state === "ready" ? this.downloadState.localPath : null,
      sha256Verified: this.downloadState.state === "ready" && this.downloadState.sha256Verified,
    };
    this.store.put(STORE_KIND, STORE_KEY, payload);
  }

  private config() {
    const settings = appSettings(this.store);
    return settings.update ?? DEFAULT_UPDATE_SETTINGS;
  }

  status(): AppUpdateStatus {
    const cfg = this.config();
    if (this.npmDistribution)
      return {
        distribution: "npm",
        updateCommand: "npm install -g kooyu@latest",
        currentVersion: this.currentVersion,
        platform: this.platform,
        arch: this.arch,
        channel: cfg.channel,
        autoCheck: false,
        repository: cfg.repository,
        state: "idle",
        checkedAt: null,
        updateAvailable: false,
        latest: null,
        error: null,
        download: emptyDownload(),
      };
    const updateAvailable = Boolean(
      this.latest && isReleaseNewer(this.currentVersion, this.latest, cfg.channel),
    );
    return {
      currentVersion: this.currentVersion,
      platform: this.platform,
      arch: this.arch,
      channel: cfg.channel,
      autoCheck: cfg.autoCheck,
      repository: cfg.repository,
      state:
        this.state === "checking" || this.state === "error" || this.state === "idle"
          ? this.state
          : updateAvailable
            ? "available"
            : "up-to-date",
      checkedAt: this.checkedAt,
      updateAvailable,
      latest: this.latest,
      error: this.error,
      download: { ...this.downloadState },
    };
  }

  async check(overrides?: {
    channel?: "stable" | "preview";
    repository?: string;
  }): Promise<AppUpdateStatus> {
    if (this.npmDistribution) return this.status();
    if (this.checkInFlight) return this.checkInFlight;
    const cfg = this.config();
    const channel = overrides?.channel ?? cfg.channel;
    const rawRepo = (overrides?.repository ?? cfg.repository).trim();
    const repo = rawRepo.toLowerCase() === "sh2001sh/kodo" ? "sh2001sh/Kooyu" : rawRepo;
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
      throw new KodoError("INVALID_INPUT", "无效的更新仓库地址，格式应为 owner/repo。");
    }

    this.state = "checking";
    this.error = null;
    const work = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
      try {
        const apiUrl = `https://api.github.com/repos/${repo}/releases?per_page=15`;
        const res = await this.fetcher(apiUrl, {
          headers: {
            accept: "application/vnd.github+json",
            "user-agent": `Kooyu/${this.currentVersion}`,
          },
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new KodoError(
            "UNAVAILABLE",
            `检查更新失败（GitHub API HTTP ${res.status}），请稍后重试。`,
          );
        }
        const rawReleases = (await res.json()) as GithubReleaseWire[];
        if (!Array.isArray(rawReleases)) {
          throw new KodoError("UNAVAILABLE", "更新源返回格式无效。");
        }

        const parsedCandidates: Array<{ wire: GithubReleaseWire; release: AppUpdateRelease }> = [];
        for (const wire of rawReleases) {
          if (wire.draft || !wire.tag_name) continue;
          const parsedTag = parseReleaseTag(wire.tag_name, Boolean(wire.prerelease));
          if (!parsedTag) continue;
          if (channel === "stable" && parsedTag.prerelease) continue;

          const assets: AppUpdateAsset[] = [];
          for (const asset of wire.assets ?? []) {
            if (!asset.name || !asset.browser_download_url) continue;
            if (asset.name === "SHA256SUMS.txt") continue;
            const plat = classifyReleaseAsset(asset.name);
            assets.push({
              name: asset.name,
              downloadUrl: asset.browser_download_url,
              size: Number(asset.size) || 0,
              sha256: null,
              platform: plat,
            });
          }

          parsedCandidates.push({
            wire,
            release: {
              tag: wire.tag_name,
              version: parsedTag.version,
              buildNumber: parsedTag.buildNumber,
              prerelease: parsedTag.prerelease,
              title: wire.name?.trim() || `Kooyu ${parsedTag.version}`,
              notes: (wire.body ?? "").trim(),
              publishedAt: wire.published_at ?? null,
              htmlUrl:
                wire.html_url ??
                `https://github.com/${repo}/releases/tag/${encodeURIComponent(wire.tag_name)}`,
              assets,
              recommendedAsset: pickRecommendedAsset(assets, this.platform, this.arch),
              androidAsset: assets.find((a) => a.platform === "android") ?? null,
            },
          });
        }

        parsedCandidates.sort((a, b) => compareReleases(b.release, a.release));
        const top = parsedCandidates[0] ?? null;

        if (top) {
          const checksumAsset = (top.wire.assets ?? []).find(
            (a) => a.name === "SHA256SUMS.txt" && a.browser_download_url,
          );
          if (checksumAsset?.browser_download_url) {
            try {
              const sumRes = await this.fetcher(checksumAsset.browser_download_url, {
                headers: { "user-agent": `Kooyu/${this.currentVersion}` },
                signal: controller.signal,
              });
              if (sumRes.ok) {
                const sums = parseSha256Sums(await sumRes.text());
                for (const asset of top.release.assets) {
                  asset.sha256 = sums.get(asset.name) ?? null;
                }
                top.release.recommendedAsset = pickRecommendedAsset(
                  top.release.assets,
                  this.platform,
                  this.arch,
                );
                top.release.androidAsset =
                  top.release.assets.find((a) => a.platform === "android") ?? null;
              }
            } catch {
              // Checksum fetch is best-effort during check; verified if present on download.
            }
          }
        }

        this.latest = top?.release ?? null;
        this.checkedAt = new Date().toISOString();
        const available = Boolean(
          this.latest && isReleaseNewer(this.currentVersion, this.latest, channel),
        );
        this.state = available ? "available" : "up-to-date";
        this.error = null;
        if (
          this.downloadState.state === "ready" &&
          this.latest &&
          this.downloadState.tag !== this.latest.tag
        ) {
          this.downloadState = emptyDownload();
        }
        this.persist();
        return this.status();
      } catch (err) {
        this.state = "error";
        this.error =
          err instanceof Error && err.name === "AbortError"
            ? "检查更新超时，请检查网络连接。"
            : err instanceof Error
              ? err.message
              : String(err);
        return this.status();
      } finally {
        clearTimeout(timer);
        this.checkInFlight = null;
      }
    })();

    this.checkInFlight = work;
    return work;
  }

  async startDownload(options?: { assetName?: string }): Promise<AppUpdateStatus> {
    if (this.npmDistribution)
      throw new KodoError(
        "UNSUPPORTED",
        "请停止 Kooyu，运行 npm install -g kooyu@latest 后重新启动；临时运行使用 npx kooyu@latest。",
      );
    if (this.downloadState.state === "downloading" || this.downloadState.state === "verifying") {
      return this.status();
    }
    if (!this.latest) {
      await this.check();
    }
    const release = this.latest;
    if (!release) {
      throw new KodoError("NOT_FOUND", "当前没有可下载的版本信息，请先检查更新。");
    }
    const asset = options?.assetName
      ? (release.assets.find((a) => a.name === options.assetName) ?? null)
      : release.recommendedAsset;
    if (!asset) {
      throw new KodoError(
        "UNAVAILABLE",
        `版本 ${release.version} 未包含适配当前平台（${this.platform}/${this.arch}）的安装包。`,
      );
    }

    const downloadUrl = assertSafeHttpsUrl(asset.downloadUrl);
    const safeTag = safeFileSegment(release.tag);
    const safeName = safeFileSegment(asset.name);
    const targetDir = join(this.updatesDir, safeTag);
    const finalPath = join(targetDir, safeName);
    const partPath = `${finalPath}.part`;

    // Reuse existing verified download immediately.
    if (existsSync(finalPath)) {
      const existingSha = await computeFileSha256(finalPath);
      if (!asset.sha256 || existingSha === asset.sha256.toLowerCase()) {
        const size = statSync(finalPath).size;
        this.downloadState = {
          state: "ready",
          tag: release.tag,
          assetName: asset.name,
          downloadedBytes: size,
          totalBytes: size,
          localPath: finalPath,
          sha256Verified: Boolean(asset.sha256),
          error: null,
        };
        this.persist();
        return this.status();
      }
      rmSync(finalPath, { force: true });
    }

    mkdirSync(targetDir, { recursive: true });
    this.downloadState = {
      state: "downloading",
      tag: release.tag,
      assetName: asset.name,
      downloadedBytes: 0,
      totalBytes: asset.size > 0 ? asset.size : null,
      localPath: null,
      sha256Verified: false,
      error: null,
    };

    const controller = new AbortController();
    this.downloadAbort = controller;
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

    void (async () => {
      try {
        const res = await this.fetcher(downloadUrl, {
          headers: { "user-agent": `Kooyu/${this.currentVersion}` },
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          throw new Error(`下载失败（HTTP ${res.status}）`);
        }
        const contentLen = Number(res.headers.get("content-length") ?? 0);
        if (contentLen > MAX_INSTALLER_BYTES) {
          throw new Error("安装包体积超出安全限制。");
        }
        if (contentLen > 0) {
          this.downloadState.totalBytes = contentLen;
        }

        const hash = createHash("sha256");
        const out = createWriteStream(partPath);
        const reader = res.body.getReader();
        let received = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value) continue;
            received += value.byteLength;
            if (received > MAX_INSTALLER_BYTES) {
              throw new Error("安装包体积超出安全限制。");
            }
            hash.update(value);
            if (!out.write(value)) {
              await new Promise<void>((resolveDrain) => out.once("drain", resolveDrain));
            }
            this.downloadState.downloadedBytes = received;
          }
          await new Promise<void>((resolveEnd, rejectEnd) => {
            out.on("error", rejectEnd);
            out.end(() => resolveEnd());
          });
        } catch (streamErr) {
          out.destroy();
          rmSync(partPath, { force: true });
          throw streamErr;
        }

        this.downloadState.state = "verifying";
        const digest = hash.digest("hex").toLowerCase();
        if (asset.sha256 && digest !== asset.sha256.toLowerCase()) {
          rmSync(partPath, { force: true });
          throw new Error("安装包 SHA-256 校验未通过，已自动丢弃，请重新下载。");
        }

        renameSync(partPath, finalPath);
        this.downloadState = {
          state: "ready",
          tag: release.tag,
          assetName: asset.name,
          downloadedBytes: received,
          totalBytes: received,
          localPath: finalPath,
          sha256Verified: Boolean(asset.sha256),
          error: null,
        };
        this.persist();
      } catch (err) {
        rmSync(partPath, { force: true });
        this.downloadState = {
          ...this.downloadState,
          state: "error",
          error:
            err instanceof Error && err.name === "AbortError"
              ? "下载已取消或超时。"
              : err instanceof Error
                ? err.message
                : String(err),
        };
      } finally {
        clearTimeout(timer);
        if (this.downloadAbort === controller) this.downloadAbort = null;
      }
    })();

    return this.status();
  }

  async install(): Promise<{ launched: boolean; localPath: string; message: string }> {
    if (this.npmDistribution)
      throw new KodoError(
        "UNSUPPORTED",
        "npm 版本请使用 npm install -g kooyu@latest 更新，然后重新启动。",
      );
    const dl = this.downloadState;
    if (dl.state !== "ready" || !dl.localPath) {
      throw new KodoError("CONFLICT", "更新包尚未下载就绪，请先下载更新。");
    }
    const resolvedPath = resolve(dl.localPath);
    const resolvedBase = resolve(this.updatesDir);
    if (!resolvedPath.startsWith(resolvedBase)) {
      throw new KodoError("INVALID_INPUT", "更新包路径校验失败。");
    }
    if (!existsSync(resolvedPath)) {
      this.downloadState = emptyDownload();
      this.persist();
      throw new KodoError("NOT_FOUND", "已下载的安装包不存在，请重新下载。");
    }

    const expectedSha = this.latest?.assets.find((a) => a.name === dl.assetName)?.sha256;
    if (expectedSha) {
      const actualSha = await computeFileSha256(resolvedPath);
      if (actualSha !== expectedSha.toLowerCase()) {
        rmSync(resolvedPath, { force: true });
        this.downloadState = emptyDownload();
        this.persist();
        throw new KodoError("CONFLICT", "安装前 SHA-256 校验不一致，已清理损坏文件，请重新下载。");
      }
    }

    // Only invoke optional prepareInstall hook on win32 when explicitly supplied.
    // Packaged Windows NSIS installers handle safe Host quiesce/backup/stop right at install time.
    const shouldPrepare = this.platform === "win32" && Boolean(this.prepareInstall);
    if (shouldPrepare) await this.prepareInstall?.();
    try {
      if (this.launcher) {
        await this.launcher(resolvedPath, this.platform);
      } else {
        await launchInstallerByPlatform(resolvedPath, this.platform);
      }
    } catch (err) {
      if (shouldPrepare) this.rollbackInstall?.();
      throw err;
    }

    // Keep download state "ready" so the user can re-launch or reveal the installer if they cancel the wizard.
    this.downloadState = { ...this.downloadState, state: "ready", error: null };
    if (this.onInstallLaunched) {
      this.onInstallLaunched(this.platform);
    }
    return {
      launched: true,
      localPath: resolvedPath,
      message:
        this.platform === "win32"
          ? "已启动 Kooyu 安装程序，请在弹出的安装向导中按提示完成升级（开始安装时将自动保存进度并重启应用）。"
          : this.platform === "darwin"
            ? "已打开 Kooyu 安装镜像（DMG），请将 Kooyu 拖入「应用程序」覆盖升级。"
            : "已打开更新包目录，请运行或安装新版本。",
    };
  }

  async revealDownloaded(): Promise<{ revealed: boolean; localPath: string }> {
    const dl = this.downloadState;
    if (!dl.localPath) {
      throw new KodoError("NOT_FOUND", "当前没有已下载的安装包。");
    }
    const resolvedPath = resolve(dl.localPath);
    const resolvedBase = resolve(this.updatesDir);
    if (!resolvedPath.startsWith(resolvedBase) || !existsSync(resolvedPath)) {
      throw new KodoError("NOT_FOUND", "已下载的安装包不存在，请重新下载。");
    }
    await revealPathByPlatform(resolvedPath, this.platform);
    return { revealed: true, localPath: resolvedPath };
  }

  close() {
    this.downloadAbort?.abort();
    this.downloadAbort = null;
  }
}
