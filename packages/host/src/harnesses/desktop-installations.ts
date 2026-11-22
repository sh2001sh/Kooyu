import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { HarnessId } from "@kodo/protocol";
import type { DesktopInstallation, NativeLaunch } from "./launch-types.js";
import { readAsarText, asarContains } from "./asar.js";

const names: Record<HarnessId, RegExp> = {
  kodo: /^(?:Kooyu|Kodo)(?: Desktop)?(?:\s|$)/i,
  pi: /^pi(?: Desktop)?$/i,
  codex: /^(?:OpenAI[ .-])?Codex(?:\s|$)/i,
  "claude-code": /^(?:Anthropic[ .-])?Claude(?: Code)?(?:\s|$)/i,
  "deepseek-harness": /^(?:DeepSeek[ .-]?Harness|DSH)(?:\s|$)/i,
  zcode: /^ZCode(?:\s|$)/i,
  opencode: /^@?OpenCode(?:-aidesktop| Desktop)?(?:\s|$)/i,
  gemini: /^Gemini(?: CLI| Desktop)?(?:\s|$)/i,
  cursor: /^Cursor(?:\s|$)/i,
  "kimi-code": /^Kimi(?: Code| Desktop)?(?:\s|$)/i,
  antigravity: /^Antigravity(?:\s|$)/i,
  "grok-build": /^Grok(?: Build| Desktop)?(?:\s|$)/i,
};

const folders: Record<HarnessId, string[]> = {
  kodo: ["Kooyu", "Kodo"],
  pi: ["pi", "Pi Desktop"],
  codex: ["Codex", "OpenAI/Codex"],
  "claude-code": ["Claude", "AnthropicClaude", "Anthropic/Claude"],
  "deepseek-harness": ["DeepSeek Harness", "DSH"],
  zcode: ["ZCode"],
  opencode: ["OpenCode", "@opencode-aidesktop", "ai.opencode.desktop"],
  gemini: ["Gemini", "Gemini CLI", "Gemini Desktop"],
  cursor: ["Cursor", "cursor"],
  "kimi-code": ["Kimi Code", "Kimi"],
  antigravity: ["Antigravity", "antigravity"],
  "grok-build": ["Grok Build", "Grok"],
};

function directories(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(path, d.name));
  } catch {
    return [];
  }
}
function directory(path: string) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
let cached: { at: number; records: DesktopInstallation[] } | undefined;
let scanGeneration = 0;
export function desktopInstallationGeneration(): number {
  return scanGeneration;
}
export function refreshDesktopInstallations(): void {
  cached = undefined;
  scanGeneration++;
}

/** Installed application names and paths only; never inspect login databases or process arguments. */
function windowsApplications(): DesktopInstallation[] {
  if (process.platform !== "win32") return [];
  try {
    const script =
      "$ErrorActionPreference='SilentlyContinue'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new(); " +
      "$roots=@('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'); " +
      "$records=@(Get-ItemProperty $roots | Where-Object { $_.DisplayName -match 'Kooyu|Kodo|Codex|Claude|DeepSeek|ZCode|OpenCode|Gemini|Cursor|Kimi|Grok|^pi$' } | Select-Object DisplayName,DisplayVersion,InstallLocation,DisplayIcon); " +
      "$records+=@(Get-AppxPackage | Where-Object { $_.Name -match 'Codex|Claude|DeepSeek|ZCode|OpenCode|Gemini|Cursor|Kimi|Grok' } | ForEach-Object { [pscustomobject]@{DisplayName=$_.Name;DisplayVersion=[string]$_.Version;InstallLocation=$_.InstallLocation} }); $records | ConvertTo-Json -Compress";
    const output = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { encoding: "utf8", windowsHide: true, timeout: 5000, maxBuffer: 1024 * 1024 },
    );
    const records = JSON.parse(output.replace(/^\uFEFF/, "") || "[]");
    return (Array.isArray(records) ? records : [records]).flatMap((r) => {
      const icon = String(r.DisplayIcon ?? "")
        .replace(/,\s*-?\d+$/, "")
        .replace(/^"|"$/g, "");
      const root = r.InstallLocation || (icon ? dirname(icon) : null);
      return root && directory(root)
        ? [{ name: String(r.DisplayName), path: resolve(root), version: r.DisplayVersion ?? null }]
        : [];
    });
  } catch {
    return [];
  }
}

export function desktopInstallations(
  id: HarnessId,
  extra?: string,
  records?: DesktopInstallation[],
): DesktopInstallation[] {
  if (!records && (!cached || Date.now() - cached.at > 60000))
    cached = { at: Date.now(), records: windowsApplications() };
  const found = (records ?? cached?.records ?? []).filter((r) => names[id].test(r.name));
  const local = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
  const roots =
    process.platform === "win32"
      ? [
          join(local, "Programs"),
          local,
          process.env.ProgramFiles,
          process.env["ProgramFiles(x86)"],
          join(process.env.ProgramData ?? "C:/ProgramData", process.env.USERNAME ?? "", ""),
        ]
      : process.platform === "darwin"
        ? ["/Applications", join(homedir(), "Applications")]
        : ["/opt", join(homedir(), ".local", "opt"), join(homedir(), ".local", "share")];
  for (const root of roots)
    if (root)
      for (const folder of folders[id]) {
        const candidate = join(root, process.platform === "darwin" ? `${folder}.app` : folder);
        const appDirs = [
          candidate,
          ...directories(candidate).filter((p) => /^app-/i.test(basename(p))),
        ];
        const productExe = {
          kodo: folder === "Kooyu" ? "Kooyu" : "Kodo",
          pi: "pi",
          codex: "Codex",
          "claude-code": "claude",
          "deepseek-harness": "DeepSeek Harness",
          zcode: "ZCode",
          opencode: "OpenCode",
          gemini: "Gemini",
          cursor: "Cursor",
          "kimi-code": "Kimi",
          antigravity: "Antigravity",
          "grok-build": "Grok",
        }[id];
        const evidence =
          appDirs.some(
            (p) =>
              existsSync(join(p, "resources/app.asar")) ||
              existsSync(join(p, "Contents/Info.plist")) ||
              existsSync(join(p, `${productExe}.exe`)),
          ) ||
          (id === "codex" &&
            directories(join(candidate, "bin")).some((p) => existsSync(join(p, "codex.exe"))));
        if (directory(candidate) && evidence)
          found.push({ name: folder, path: candidate, version: null });
      }
  if (process.platform === "linux" && !records) {
    for (const root of ["/usr/share/applications", join(homedir(), ".local/share/applications")]) {
      try {
        for (const name of readdirSync(root).filter((n) => n.endsWith(".desktop"))) {
          const text = readFileSync(join(root, name), "utf8"),
            appName = /^Name=(.+)$/m.exec(text)?.[1];
          const exe = /^Exec=(?:"([^"]+)"|([^\s]+))/m.exec(text);
          const path = exe?.[1] ?? exe?.[2];
          if (appName && names[id].test(appName) && path?.startsWith("/") && existsSync(path))
            found.push({ name: appName, path: dirname(path), version: null });
        }
      } catch {
        /* A missing desktop directory is ordinary. */
      }
    }
  }
  if (extra && existsSync(extra)) {
    const path = directory(extra) ? resolve(extra) : dirname(resolve(extra));
    const known = found.find((r) =>
      process.platform === "win32" ? r.path.toLowerCase() === path.toLowerCase() : r.path === path,
    );
    found.unshift(known ?? { name: `${id}（指定桌面应用）`, path, version: null });
  }
  const unique = new Map<string, DesktopInstallation>();
  for (const item of found) {
    const key = process.platform === "win32" ? item.path.toLowerCase() : item.path;
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()];
}

export function bundledLaunch(
  id: HarnessId,
  app: DesktopInstallation,
  args: string[],
): NativeLaunch | null {
  const roots = [
    app.path,
    ...(directory(join(app.path, "app")) ? [join(app.path, "app")] : []),
    ...directories(app.path)
      .filter((p) => /^app-/i.test(basename(p)))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true })),
  ];
  const binaries: Partial<Record<HarnessId, string[]>> = {
    codex: ["codex"],
    "claude-code": ["claude-code", "claude"],
    "deepseek-harness": ["dsh"],
    zcode: ["zcode"],
    opencode: ["opencode", "opencode-cli"],
    gemini: ["gemini"],
    cursor: ["agent", "cursor-agent"],
    "kimi-code": ["kimi"],
    antigravity: ["agy"],
    "grok-build": ["grok"],
  };
  for (const root of roots) {
    const resources =
      process.platform === "darwin" ? join(root, "Contents", "Resources") : join(root, "resources");
    if (id === "zcode") {
      const entry = join(resources, "glm", "zcode.cjs");
      if (existsSync(entry))
        return {
          command: process.execPath,
          args: [entry, ...args],
          source: "desktop-bundled",
          ...(existsSync(join(resources, "config/provider/zcode-builtin.json"))
            ? {
                env: {
                  ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: join(
                    resources,
                    "config/provider/zcode-builtin.json",
                  ),
                },
              }
            : {}),
        };
    }
    if (id === "deepseek-harness") {
      const entry = join(
        resources,
        "app.asar",
        "dsh",
        "node_modules",
        "@deepseek-ai",
        "dsh-desktop-host",
        "lib",
        "cli.js",
      );
      const exe =
        process.platform === "darwin"
          ? join(root, "Contents/MacOS/DeepSeek Harness")
          : join(root, "DeepSeek Harness.exe");
      if (
        existsSync(exe) &&
        readAsarText(
          join(resources, "app.asar"),
          "dsh/node_modules/@deepseek-ai/dsh-desktop-host/package.json",
        )
      )
        return {
          command: exe,
          args: ["--expose-internals", entry, ...args],
          env: { ELECTRON_RUN_AS_NODE: "1" },
          source: "desktop-bundled",
        };
    }
    if (id === "opencode") {
      const archive = join(resources, "app.asar"),
        sidecar = readAsarText(archive, "out/main/sidecar.js");
      const chunk = sidecar && /import\(["']\.\/(chunks\/[^"']+\.js)["']\)/.exec(sidecar)?.[1];
      const exe =
        process.platform === "darwin"
          ? join(root, "Contents/MacOS/OpenCode")
          : join(root, "OpenCode.exe");
      if (chunk && existsSync(exe) && asarContains(archive, `out/main/${chunk}`)) {
        let runner = fileURLToPath(new URL("./desktop-opencode.js", import.meta.url));
        if (!existsSync(runner))
          runner = fileURLToPath(new URL("./desktop-opencode.ts", import.meta.url));
        return {
          command: exe,
          args: [runner, "--native-entry", join(archive, "out/main", chunk)],
          env: { ELECTRON_RUN_AS_NODE: "1" },
          source: "desktop-bundled",
        };
      }
    }
    const binDirs = [
      join(resources, "bin"),
      join(resources, "app", "bin"),
      join(resources, "cli"),
      join(root, "bin"),
    ];
    if (id === "codex") binDirs.push(...directories(join(root, "bin")));
    for (const dir of binDirs)
      for (const name of binaries[id] ?? []) {
        for (const ext of process.platform === "win32" ? [".exe", ""] : [""]) {
          const path = join(dir, name + ext);
          if (existsSync(path) && !directory(path))
            return { command: path, args, source: "desktop-bundled" };
        }
      }
  }
  return null;
}
