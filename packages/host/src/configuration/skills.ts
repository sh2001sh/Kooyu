import { createHash, randomUUID } from "node:crypto";
import {
  accessSync,
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  parse,
  relative,
  resolve,
} from "node:path";
import { parse as parseYaml } from "yaml";
import {
  KodoError,
  type HarnessId,
  type HarnessSkill,
  type HarnessSkillDirectory,
  type HarnessSkillFile,
  type HarnessSkillListing,
} from "@kodo/protocol";
import type { Store } from "../storage/store.js";

const DISABLED = ".kodo-disabled";
const MAX_BYTES = 256 * 1024;
const MAX_ENTRIES = 10000;
const key = (path: string) =>
  process.platform === "win32" ? normalize(resolve(path)).toLowerCase() : resolve(path);
const within = (root: string, path: string) => {
  const rel = relative(resolve(root), resolve(path));
  return (
    rel === "" ||
    (!isAbsolute(rel) &&
      rel !== ".." &&
      !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`))
  );
};

function writable(path: string): boolean {
  let parent = path;
  while (!existsSync(parent) && dirname(parent) !== parent) parent = dirname(parent);
  try {
    accessSync(parent, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
function metadata(content: string, fallback: string, validate = false) {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  try {
    if (!match) throw new Error("缺少 YAML frontmatter（---）。");
    const parsed = parseYaml(match[1]!, { maxAliasCount: 20 }) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("元数据必须是对象。");
    const name = parsed.name === undefined ? fallback : parsed.name;
    if (typeof name !== "string" || !name.trim() || name.length > 100 || /[\r\n/\\]/.test(name))
      throw new Error("name 必须是有效的技能名称。");
    if (typeof parsed.description !== "string" || !parsed.description.trim())
      throw new Error("description 不能为空。");
    if (validate && !content.slice(match[0].length).trim()) throw new Error("技能正文不能为空。");
    return { name: name.trim(), description: parsed.description.trim() };
  } catch (error) {
    const issue = error instanceof Error ? error.message : String(error);
    if (validate) throw new KodoError("INVALID_INPUT", `SKILL.md 格式不正确：${issue}`);
    return { name: fallback, description: "", issue };
  }
}
function readText(path: string) {
  if (statSync(path).size > MAX_BYTES)
    throw new KodoError("INVALID_INPUT", "SKILL.md 超过 256 KB，请在文本编辑器中处理。");
  return readFileSync(path, "utf8");
}
function version(content: string, enabled: boolean) {
  return createHash("sha256")
    .update(enabled ? "enabled:" : "disabled:")
    .update(content)
    .digest("hex");
}
function linked(root: string, path: string) {
  for (let current = path; within(root, current); current = dirname(current)) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) return true;
    if (key(current) === key(root) || dirname(current) === current) break;
  }
  return false;
}

/** Native directories only. Unverified engines can explicitly attach their configured directory. */
export class HarnessSkills {
  private home: string;
  private env: NodeJS.ProcessEnv;
  constructor(
    private store: Store,
    private dataDir: string,
    private harness: HarnessId,
    private options: { home?: string; env?: NodeJS.ProcessEnv; workspace?: string } = {},
  ) {
    this.home = options.home ?? homedir();
    this.env = options.env ?? process.env;
  }
  directories(): HarnessSkillDirectory[] {
    const { home, env, harness: h } = this;
    const shared = join(home, ".agents", "skills");
    const roots: { path: string; label: string; shared?: boolean; custom?: boolean }[] = [];
    const add = (path: string, label: string, isShared = false) =>
      roots.push({ path, label, shared: isShared });
    if (h === "kodo" || h === "pi") {
      add(join(this.dataDir, h, "skills"), `${h === "kodo" ? "Kooyu" : "pi SDK"} 运行目录`);
      add(shared, "用户共享目录", true);
    }
    if (h === "codex") {
      add(shared, "用户共享目录", true);
      add(join(env.CODEX_HOME ?? join(home, ".codex"), "skills"), "Codex 用户目录");
    }
    if (h === "claude-code")
      add(join(env.CLAUDE_CONFIG_DIR ?? join(home, ".claude"), "skills"), "Claude Code 用户目录");
    if (h === "deepseek-harness") {
      add(join(env.DSH_HOME ?? join(home, ".dsh"), "skills"), "DeepSeek 用户目录");
      add(join(env.AGENTS_HOME ?? join(home, ".agents"), "skills"), "用户共享目录", true);
    }
    if (h === "opencode") {
      add(
        join(
          env.OPENCODE_CONFIG_DIR ?? join(env.XDG_CONFIG_HOME ?? join(home, ".config"), "opencode"),
          "skills",
        ),
        "OpenCode 用户目录",
      );
      add(shared, "用户共享目录", true);
      add(join(env.CLAUDE_CONFIG_DIR ?? join(home, ".claude"), "skills"), "Claude 兼容目录", true);
    }
    if (h === "gemini" || h === "cursor") {
      add(join(home, h === "gemini" ? ".gemini" : ".cursor", "skills"), "引擎用户目录");
      add(shared, "用户共享目录", true);
    }
    if (this.options.workspace) {
      const work = this.options.workspace;
      if (["kodo", "pi"].includes(h)) add(join(work, ".pi", "skills"), "项目 pi 目录", true);
      if (["kodo", "pi", "codex", "deepseek-harness", "opencode", "gemini", "cursor"].includes(h))
        add(join(work, ".agents", "skills"), "项目共享目录", true);
      const folder = {
        "claude-code": ".claude",
        "deepseek-harness": ".dsh",
        opencode: ".opencode",
        gemini: ".gemini",
        cursor: ".cursor",
      }[h as "claude-code"];
      if (folder) add(join(work, folder, "skills"), "项目引擎目录");
      if (h === "opencode") add(join(work, ".claude", "skills"), "项目 Claude 兼容目录", true);
    }
    for (const path of this.store.record<string[]>("harness-skill-directories", h) ?? [])
      roots.push({ path, label: "自定义目录（需引擎自行加载）", custom: true });
    const unique = new Map<string, HarnessSkillDirectory>();
    for (const root of roots) {
      const path = resolve(root.path);
      if (!unique.has(key(path)))
        unique.set(key(path), {
          ...root,
          path,
          exists: existsSync(path),
          shared: Boolean(root.shared),
          writable: !linked(path, path) && writable(path),
        });
    }
    return [...unique.values()];
  }
  list(): HarnessSkillListing {
    const directories = this.directories(),
      skills: HarnessSkill[] = [],
      warnings: string[] = [];
    if (!directories.some((directory) => !directory.custom))
      warnings.push(
        "尚未确认此引擎的标准 Skills 目录。可添加其原生配置使用的目录；添加目录不会替引擎配置加载路径。",
      );
    const seen = new Set<string>();
    let count = 0;
    for (const root of directories) {
      const visit = (directory: string, depth: number, readOnly = false) => {
        if (depth > 10 || count >= MAX_ENTRIES) return;
        count++;
        try {
          const real = realpathSync(directory);
          if (seen.has(key(real))) return;
          seen.add(key(real));
          const path = join(directory, "SKILL.md");
          const disabled = `${path}${DISABLED}`;
          const enabled = existsSync(path);
          if (enabled || existsSync(disabled)) {
            const actual = enabled ? path : disabled;
            const content = readText(actual);
            const meta = metadata(content, basename(directory));
            skills.push({
              ...meta,
              path,
              directory: root.path,
              enabled,
              version: version(content, enabled),
              writable:
                root.writable && !readOnly && !linked(root.path, actual) && writable(actual),
              ...(enabled && existsSync(disabled)
                ? { issue: "启用和停用文件同时存在，请手动处理冲突。", writable: false }
                : {}),
            });
            return;
          }
          for (const entry of readdirSync(directory, { withFileTypes: true })) {
            if ([".git", "node_modules"].includes(entry.name)) continue;
            if (entry.isDirectory() || entry.isSymbolicLink()) {
              const child = join(directory, entry.name);
              try {
                if (statSync(child).isDirectory())
                  visit(
                    child,
                    depth + 1,
                    readOnly || entry.isSymbolicLink() || entry.name === ".system",
                  );
              } catch {
                warnings.push("无法读取技能目录：" + child);
              }
            }
          }
        } catch (error) {
          warnings.push(`${directory}：${error instanceof Error ? error.message : String(error)}`);
        }
      };
      if (root.exists) visit(root.path, 0, !root.writable);
    }
    if (count >= MAX_ENTRIES) warnings.push("目录项过多，仅显示前 10000 项扫描结果。");
    return {
      directories,
      skills: skills.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path)),
      warnings,
    };
  }
  read(path: string): HarnessSkillFile {
    const skill = this.list().skills.find((item) => key(item.path) === key(path));
    if (!skill) throw new KodoError("NOT_FOUND", "技能未在此引擎的已识别目录中找到，请刷新列表。");
    const content = readText(skill.enabled ? skill.path : `${skill.path}${DISABLED}`);
    return { ...skill, version: version(content, skill.enabled), content };
  }
  private checked(path: string, expectedVersion: string) {
    const skill = this.read(path);
    if (!skill.writable)
      throw new KodoError("UNAUTHORIZED", "系统、符号链接或只读技能不能在此处修改。");
    if (skill.version !== expectedVersion)
      throw new KodoError("CONFLICT", "技能已在别处修改，请重新打开后再操作。");
    return skill;
  }
  private backup(skill: HarnessSkillFile) {
    const dir = join(this.dataDir, "skill-backups", this.harness);
    mkdirSync(dir, { recursive: true });
    const id = createHash("sha256").update(skill.path).digest("hex").slice(0, 16);
    writeFileSync(join(dir, `${id}-${randomUUID()}.md`), skill.content, { flag: "wx" });
  }
  save(path: string, content: string, expectedVersion: string) {
    const skill = this.checked(path, expectedVersion);
    if (Buffer.byteLength(content) > MAX_BYTES)
      throw new KodoError("INVALID_INPUT", "SKILL.md 超过 256 KB。");
    metadata(content, basename(dirname(path)), true);
    if (content === skill.content) return skill;
    this.backup(skill);
    const actual = skill.enabled ? skill.path : `${skill.path}${DISABLED}`,
      temp = `${actual}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temp, content, { flag: "wx" });
      renameSync(temp, actual);
    } finally {
      if (existsSync(temp)) rmSync(temp);
    }
    return this.read(path);
  }
  toggle(path: string, enabled: boolean, expectedVersion: string) {
    const skill = this.checked(path, expectedVersion);
    if (skill.enabled === enabled) return skill;
    this.backup(skill);
    const source = skill.enabled ? skill.path : `${skill.path}${DISABLED}`,
      target = enabled ? skill.path : `${skill.path}${DISABLED}`;
    if (existsSync(target)) throw new KodoError("CONFLICT", "目标文件已存在，请刷新后处理冲突。");
    renameSync(source, target);
    return this.read(path);
  }
  private target(directory: string, name: string) {
    const root = this.directories().find((item) => key(item.path) === key(directory));
    if (!root || !root.writable)
      throw new KodoError("UNAUTHORIZED", "请选择此引擎的可写 Skills 目录。");
    if (
      !/^[a-z0-9][a-z0-9-]{0,63}$/.test(name) ||
      /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(name)
    )
      throw new KodoError("INVALID_INPUT", "目录名称只能包含小写字母、数字和连字符，最多 64 位。");
    const dest = join(root.path, name);
    if (existsSync(dest)) throw new KodoError("CONFLICT", "此目录已存在，不会覆盖已有技能。");
    if (linked(root.path, dest)) throw new KodoError("UNAUTHORIZED", "不能通过符号链接写入技能。");
    return dest;
  }
  create(directory: string, name: string, content: string) {
    if (Buffer.byteLength(content) > MAX_BYTES)
      throw new KodoError("INVALID_INPUT", "SKILL.md 超过 256 KB。");
    metadata(content, name, true);
    const dest = this.target(directory, name);
    mkdirSync(dirname(dest), { recursive: true });
    mkdirSync(dest);
    writeFileSync(join(dest, "SKILL.md"), content, { flag: "wx" });
    return this.read(join(dest, "SKILL.md"));
  }
  import(directory: string, source: string, name?: string) {
    if (!isAbsolute(source)) throw new KodoError("INVALID_INPUT", "请输入本机技能目录的绝对路径。");
    const src = resolve(source),
      dest = this.target(directory, name || basename(src));
    if (!existsSync(src) || !statSync(src).isDirectory() || within(src, dest))
      throw new KodoError("INVALID_INPUT", "源目录无效，或目标位于源目录内。");
    metadata(readText(join(src, "SKILL.md")), basename(src), true);
    const files: string[] = [];
    let bytes = 0;
    const collect = (current: string) => {
      if (lstatSync(current).isSymbolicLink())
        throw new KodoError("INVALID_INPUT", "导入不复制符号链接，请选择完整的本机技能目录。");
      if (statSync(current).isDirectory()) {
        for (const entry of readdirSync(current)) {
          if ([".git", "node_modules"].includes(entry)) continue;
          collect(join(current, entry));
        }
      } else {
        bytes += statSync(current).size;
        files.push(current);
        if (files.length > 1000 || bytes > 20 * 1024 * 1024)
          throw new KodoError("INVALID_INPUT", "技能最多包含 1000 个文件、20 MB。");
      }
    };
    collect(src);
    mkdirSync(dirname(dest), { recursive: true });
    mkdirSync(dest);
    try {
      for (const file of files) {
        const target = join(dest, relative(src, file));
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(file, target, constants.COPYFILE_EXCL);
      }
    } catch (error) {
      rmSync(dest, { recursive: true, force: true });
      throw error;
    }
    return this.read(join(dest, "SKILL.md"));
  }
  archive(path: string, expectedVersion: string) {
    const skill = this.checked(path, expectedVersion),
      source = dirname(skill.path);
    if (key(source) === key(skill.directory))
      throw new KodoError(
        "INVALID_INPUT",
        "不能移出整个 Skills 根目录，请在文本编辑器中处理此入口文件。",
      );
    // Move the complete bundle, including scripts/assets; never permanently delete it.
    const trash = join(this.dataDir, "skill-trash", this.harness);
    mkdirSync(trash, { recursive: true });
    let target = join(trash, `${basename(source)}-${randomUUID()}`);
    try {
      renameSync(source, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
      const localTrash = join(dirname(skill.directory), ".kodo-skill-trash", this.harness);
      mkdirSync(localTrash, { recursive: true });
      target = join(localTrash, `${basename(source)}-${randomUUID()}`);
      renameSync(source, target);
    }
    return { archived: true, path: target };
  }
  attach(path: string) {
    if (
      !isAbsolute(path) ||
      key(path) === key(parse(resolve(path)).root) ||
      key(path) === key(this.home)
    )
      throw new KodoError(
        "INVALID_INPUT",
        "请选择明确的 Skills 目录，不能选择磁盘根目录或用户根目录。",
      );
    if (existsSync(path) && !statSync(path).isDirectory())
      throw new KodoError("INVALID_INPUT", "该路径不是目录。");
    const custom = this.store.record<string[]>("harness-skill-directories", this.harness) ?? [];
    if (custom.length >= 16) throw new KodoError("INVALID_INPUT", "最多添加 16 个自定义目录。");
    if (!this.directories().some((root) => key(root.path) === key(path)))
      this.store.put("harness-skill-directories", this.harness, [...custom, resolve(path)]);
    return this.list();
  }
  detach(path: string) {
    const custom = this.store.record<string[]>("harness-skill-directories", this.harness) ?? [];
    this.store.put(
      "harness-skill-directories",
      this.harness,
      custom.filter((root) => key(root) !== key(path)),
    );
    return this.list();
  }
}
