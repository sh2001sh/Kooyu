import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, normalize } from "node:path";
import { randomUUID } from "node:crypto";
import { parse as parseYaml } from "yaml";
import { KodoError, type HarnessId } from "@kodo/protocol";
import { nativeConfigLocations } from "../harnesses/native-defaults.js";

const MAX_BYTES = 2 * 1024 * 1024;

export interface ConfigFileContent {
  path: string;
  exists: boolean;
  content: string;
  format: "json" | "jsonc" | "toml" | "yaml" | "text";
  /** Opaque version used to refuse writes over a file changed elsewhere. */
  version: string;
}

function formatOf(path: string): ConfigFileContent["format"] {
  const ext = extname(path).toLowerCase();
  if (ext === ".json") return "json";
  if (ext === ".jsonc") return "jsonc";
  if (ext === ".toml") return "toml";
  if (ext === ".yml" || ext === ".yaml") return "yaml";
  return "text";
}

function versionOf(path: string): string {
  try {
    const s = statSync(path);
    return `${s.size}:${s.mtimeMs}`;
  } catch {
    return "absent";
  }
}

/**
 * Only the native config files Kodo lists for a harness may be read or written,
 * so this endpoint can never touch arbitrary files on disk.
 */
function allowedPath(harnessId: HarnessId, path: string, dataDir: string): string {
  const key = (p: string) =>
    process.platform === "win32" ? normalize(p).toLowerCase() : normalize(p);
  const match = nativeConfigLocations(harnessId, process.env, join(dataDir, "kodo")).find(
    (l) => key(l.path) === key(path),
  );
  if (!match) throw new KodoError("UNAUTHORIZED", "只能编辑该引擎列出的配置文件。");
  return match.path;
}

export function readConfigFile(
  harnessId: HarnessId,
  path: string,
  dataDir: string,
): ConfigFileContent {
  const file = allowedPath(harnessId, path, dataDir);
  const exists = existsSync(file);
  if (exists && statSync(file).size > MAX_BYTES)
    throw new KodoError("INVALID_INPUT", "配置文件过大，请用文本编辑器打开。");
  return {
    path: file,
    exists,
    content: exists ? readFileSync(file, "utf8") : "",
    format: formatOf(file),
    version: versionOf(file),
  };
}

const LINE_BREAK = /\r?\n/;
const TABLE_HEADER = /^\[\[?[^\]]+\]\]?\s*(#.*)?$/;
const KEY_VALUE = /^("[^"]*"|'[^']*'|[A-Za-z0-9_.-]+)\s*=\s*(.+)$/;

function bracketBalance(text: string): number {
  let balance = 0;
  for (const ch of text) {
    if (ch === "[" || ch === "{") balance++;
    else if (ch === "]" || ch === "}") balance--;
  }
  return balance;
}

/** Light TOML check: every line is a table header, key = value, comment or continuation. */
export function checkToml(content: string): void {
  let depth = 0;
  let multiline: string | null = null;
  content.split(LINE_BREAK).forEach((raw, index) => {
    const line = raw.trim();
    if (multiline) {
      if (line.includes(multiline)) multiline = null;
      return;
    }
    if (!line || line.startsWith("#")) return;
    if (depth > 0) {
      depth += bracketBalance(line);
      return;
    }
    if (TABLE_HEADER.test(line)) return;
    const pair = KEY_VALUE.exec(line);
    if (!pair) throw new Error(`第 ${index + 1} 行不是有效的 TOML`);
    const value = pair[2]!;
    const quote = value.startsWith('"""') ? '"""' : value.startsWith("'''") ? "'''" : null;
    if (quote) {
      if (value.indexOf(quote, 3) < 0) multiline = quote;
      return;
    }
    depth = bracketBalance(value.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, ""));
    if (depth < 0) throw new Error(`第 ${index + 1} 行括号不匹配`);
  });
  if (depth !== 0 || multiline) throw new Error("括号或多行字符串没有闭合");
}

/** Refuse content that would leave the harness unable to start. */
function validate(format: ConfigFileContent["format"], content: string) {
  try {
    if (format === "json") JSON.parse(content);
    else if (format === "toml") checkToml(content);
    else if (format === "yaml") parseYaml(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new KodoError("INVALID_INPUT", `格式不正确，未保存：${message.split(LINE_BREAK)[0]}`);
  }
}

export function writeConfigFile(
  harnessId: HarnessId,
  input: { path: string; content: string; version: string },
  dataDir: string,
): ConfigFileContent {
  const file = allowedPath(harnessId, input.path, dataDir);
  if (Buffer.byteLength(input.content) > MAX_BYTES)
    throw new KodoError("INVALID_INPUT", "内容过大。");
  if (versionOf(file) !== input.version)
    throw new KodoError("CONFLICT", "文件已在别处修改，请重新打开后再编辑。");
  validate(formatOf(file), input.content);
  // Keep the previous version next to Kodo's data so a bad edit can be undone.
  if (existsSync(file)) {
    const backups = join(dataDir, "config-backups", harnessId);
    mkdirSync(backups, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    copyFileSync(file, join(backups, `${basename(file)}.${stamp}.bak`));
  }
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, input.content, "utf8");
  renameSync(temp, file);
  return readConfigFile(harnessId, file, dataDir);
}
