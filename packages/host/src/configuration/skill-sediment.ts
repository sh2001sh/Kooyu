import { randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import {
  KodoError,
  sedimentSkillInputSchema,
  type CuratedSkillRecord,
  type SedimentSkillInput,
} from "@kodo/protocol";

const SECRET_PATTERN =
  /(?:sk-[A-Za-z0-9_-]{12,}|-----BEGIN .*PRIVATE KEY|Bearer\s+[A-Za-z0-9._-]{12,})/;
const HISTORY_KEEP = 5;

interface SkillIndexEntry {
  title: string;
  description: string;
  version: number;
  fromSessionId: string | null;
  fromHarnessId: string | null;
  uses: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  sharedPath: string | null;
}

type SkillIndex = Record<string, SkillIndexEntry>;

function assertSafeSubpath(baseDir: string, relPath: string): string {
  const clean = normalize(relPath).replace(/\\/g, "/");
  if (!clean || isAbsolute(clean) || clean.startsWith("..") || clean.includes("/../")) {
    throw new KodoError("INVALID_INPUT", `附件路径不合法：${relPath}`);
  }
  const full = resolve(baseDir, clean);
  const rel = relative(resolve(baseDir), full);
  if (!rel || isAbsolute(rel) || rel.startsWith("..")) {
    throw new KodoError("INVALID_INPUT", `附件路径越界：${relPath}`);
  }
  return full;
}

function assertNoSymlinkInside(dir: string): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (lstatSync(full).isSymbolicLink()) {
      throw new KodoError("INVALID_INPUT", `技能目录禁止包含符号链接：${entry.name}`);
    }
    if (entry.isDirectory() && entry.name !== ".history") {
      assertNoSymlinkInside(full);
    }
  }
}

function renderSkillMarkdown(
  input: Pick<SedimentSkillInput, "name" | "title" | "description" | "body">,
): string {
  const safeQuote = (v: string) => JSON.stringify(v.replace(/\r?\n/g, " ").trim());
  return [
    "---",
    `name: ${input.name}`,
    `description: ${safeQuote(input.description)}`,
    "metadata:",
    `  title: ${safeQuote(input.title)}`,
    "---",
    "",
    input.body.trim(),
    "",
  ].join("\n");
}

function listHistoryVersions(skillDir: string): number[] {
  const historyDir = join(skillDir, ".history");
  if (!existsSync(historyDir)) return [];
  return readdirSync(historyDir)
    .map((entry) => Number(entry))
    .filter((n) => Number.isInteger(n) && n > 0)
    .sort((a, b) => b - a);
}

/**
 * Cross-Harness Versioned Skill Sedimentation Service.
 *
 * Distills proven workflows from Kooyu or any managed Harness (Claude Code, Codex, Gemini, etc.)
 * into validated, versioned `SKILL.md` bundles under `<dataDir>/kodo/skills/` with 5-version
 * rollback history and optional distribution into `~/.agents/skills/` for cross-Harness reuse.
 */
export class SkillSedimentService {
  readonly rootDir: string;
  readonly sharedAgentsDir: string;
  private readonly locks = new Set<string>();

  constructor(dataDir: string, options: { sharedAgentsDir?: string } = {}) {
    this.rootDir = join(dataDir, "kodo", "skills");
    this.sharedAgentsDir = options.sharedAgentsDir ?? join(homedir(), ".agents", "skills");
    mkdirSync(this.rootDir, { recursive: true });
  }

  private indexPath(): string {
    return join(this.rootDir, "skills.json");
  }

  private readIndex(): SkillIndex {
    const file = this.indexPath();
    if (!existsSync(file)) return {};
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as SkillIndex)
        : {};
    } catch {
      return {};
    }
  }

  private writeIndex(index: SkillIndex): void {
    mkdirSync(this.rootDir, { recursive: true });
    const target = this.indexPath();
    const tmp = `${target}.${randomUUID().slice(0, 8)}.tmp`;
    writeFileSync(tmp, JSON.stringify(index, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
    renameSync(tmp, target);
  }

  private withLock<T>(key: string, fn: () => T): T {
    if (this.locks.has(key)) {
      throw new KodoError("CONFLICT", `技能「${key}」正在沉淀或回滚中，请稍后重试。`);
    }
    this.locks.add(key);
    try {
      return fn();
    } finally {
      this.locks.delete(key);
    }
  }

  list(): CuratedSkillRecord[] {
    const index = this.readIndex();
    const records: CuratedSkillRecord[] = [];
    for (const [name, meta] of Object.entries(index)) {
      const skillDir = join(this.rootDir, name);
      if (!existsSync(join(skillDir, "SKILL.md"))) continue;
      records.push({
        name,
        title: meta.title,
        description: meta.description,
        version: meta.version,
        historyVersions: listHistoryVersions(skillDir),
        path: join(skillDir, "SKILL.md"),
        sharedPath: meta.sharedPath,
        fromSessionId: meta.fromSessionId,
        fromHarnessId: meta.fromHarnessId,
        uses: meta.uses,
        enabled: meta.enabled,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
      });
    }
    return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  read(name: string): { record: CuratedSkillRecord; content: string } {
    const record = this.list().find((item) => item.name === name);
    if (!record) throw new KodoError("NOT_FOUND", `未找到沉淀技能：${name}`);
    return { record, content: readFileSync(record.path, "utf8") };
  }

  /**
   * Atomically creates or updates a curated skill with snapshot backup, format validation,
   * secret screening, 5-version `.history` retention, and optional cross-Harness distribution.
   */
  sediment(rawInput: unknown): {
    record: CuratedSkillRecord;
    updated: boolean;
    distributedToShared: boolean;
  } {
    const input = sedimentSkillInputSchema.parse(rawInput);
    const markdown = renderSkillMarkdown(input);
    const allTexts = [
      input.title,
      input.description,
      input.body,
      ...(input.scripts ?? []).map((f) => f.content),
      ...(input.references ?? []).map((f) => f.content),
    ];
    if (allTexts.some((t) => SECRET_PATTERN.test(t))) {
      throw new KodoError("INVALID_INPUT", "技能内容或附件中检测到密钥/私钥，已拒绝沉淀。");
    }

    return this.withLock(input.name, () => {
      const index = this.readIndex();
      const prior = index[input.name];
      const skillDir = join(this.rootDir, input.name);
      const historyDir = join(skillDir, ".history");
      const now = new Date().toISOString();

      // Snapshot previous version into `.history/<ver>` before mutating
      if (prior && existsSync(skillDir)) {
        assertNoSymlinkInside(skillDir);
        const snapDir = join(historyDir, String(prior.version));
        mkdirSync(snapDir, { recursive: true });
        for (const entry of readdirSync(skillDir)) {
          if (entry === ".history" || entry === "__pycache__") continue;
          cpSync(join(skillDir, entry), join(snapDir, entry), { recursive: true });
        }
        // Keep only the latest HISTORY_KEEP snapshots
        const versions = listHistoryVersions(skillDir);
        for (const oldVer of versions.slice(HISTORY_KEEP)) {
          rmSync(join(historyDir, String(oldVer)), { recursive: true, force: true });
        }
      }

      // Stage new bundle cleanly, then replace working contents (preserving `.history`)
      const stageDir = join(this.rootDir, `.stage-${input.name}-${randomUUID().slice(0, 8)}`);
      try {
        mkdirSync(stageDir, { recursive: true });
        writeFileSync(join(stageDir, "SKILL.md"), markdown, { encoding: "utf8", mode: 0o600 });
        for (const script of input.scripts ?? []) {
          const target = assertSafeSubpath(join(stageDir, "scripts"), script.path);
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, script.content, { encoding: "utf8", mode: 0o600 });
        }
        for (const ref of input.references ?? []) {
          const target = assertSafeSubpath(join(stageDir, "references"), ref.path);
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, ref.content, { encoding: "utf8", mode: 0o600 });
        }

        mkdirSync(skillDir, { recursive: true });
        for (const entry of readdirSync(skillDir)) {
          if (entry === ".history") continue;
          rmSync(join(skillDir, entry), { recursive: true, force: true });
        }
        for (const entry of readdirSync(stageDir)) {
          cpSync(join(stageDir, entry), join(skillDir, entry), { recursive: true });
        }
      } finally {
        rmSync(stageDir, { recursive: true, force: true });
      }

      // Optional cross-Harness distribution into `~/.agents/skills/<name>`
      let sharedPath: string | null = null;
      let distributedToShared = false;
      if (input.distributeToShared) {
        try {
          mkdirSync(this.sharedAgentsDir, { recursive: true });
          const dest = join(this.sharedAgentsDir, input.name);
          if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
          mkdirSync(dest, { recursive: true });
          for (const entry of readdirSync(skillDir)) {
            if (entry === ".history") continue;
            cpSync(join(skillDir, entry), join(dest, entry), { recursive: true });
          }
          sharedPath = join(dest, "SKILL.md");
          distributedToShared = true;
        } catch {
          sharedPath = null;
          distributedToShared = false;
        }
      }

      const nextVersion = prior ? prior.version + 1 : 1;
      index[input.name] = {
        title: input.title,
        description: input.description,
        version: nextVersion,
        fromSessionId: input.fromSessionId ?? prior?.fromSessionId ?? null,
        fromHarnessId: input.fromHarnessId ?? prior?.fromHarnessId ?? null,
        uses: prior?.uses ?? 0,
        enabled: prior?.enabled ?? true,
        createdAt: prior?.createdAt ?? now,
        updatedAt: now,
        sharedPath,
      };
      this.writeIndex(index);

      const record: CuratedSkillRecord = {
        name: input.name,
        ...index[input.name]!,
        historyVersions: listHistoryVersions(skillDir),
        path: join(skillDir, "SKILL.md"),
      };
      return { record, updated: Boolean(prior), distributedToShared };
    });
  }

  /** Restores a skill from `.history/<version>/`, bumping version and re-syncing shared copy. */
  rollback(name: string, targetVersion?: number): CuratedSkillRecord {
    return this.withLock(name, () => {
      const index = this.readIndex();
      const current = index[name];
      if (!current) throw new KodoError("NOT_FOUND", `未找到沉淀技能：${name}`);
      const skillDir = join(this.rootDir, name);
      const versions = listHistoryVersions(skillDir);
      if (!versions.length) {
        throw new KodoError("CONFLICT", `技能「${name}」没有可回滚的历史版本。`);
      }
      const chosen = targetVersion ?? versions[0]!;
      const snapDir = join(skillDir, ".history", String(chosen));
      if (!existsSync(join(snapDir, "SKILL.md"))) {
        throw new KodoError("NOT_FOUND", `未找到技能「${name}」的历史版本 v${chosen}。`);
      }

      // Save current version to history before restoring
      const backupDir = join(skillDir, ".history", String(current.version));
      mkdirSync(backupDir, { recursive: true });
      for (const entry of readdirSync(skillDir)) {
        if (entry === ".history") continue;
        cpSync(join(skillDir, entry), join(backupDir, entry), { recursive: true });
      }

      // Restore chosen snapshot
      for (const entry of readdirSync(skillDir)) {
        if (entry === ".history") continue;
        rmSync(join(skillDir, entry), { recursive: true, force: true });
      }
      for (const entry of readdirSync(snapDir)) {
        cpSync(join(snapDir, entry), join(skillDir, entry), { recursive: true });
      }

      // Prune old history beyond HISTORY_KEEP
      for (const oldVer of listHistoryVersions(skillDir).slice(HISTORY_KEEP)) {
        rmSync(join(skillDir, ".history", String(oldVer)), { recursive: true, force: true });
      }

      // Re-sync shared agents copy if previously distributed
      if (current.sharedPath) {
        try {
          const dest = join(this.sharedAgentsDir, name);
          if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
          mkdirSync(dest, { recursive: true });
          for (const entry of readdirSync(skillDir)) {
            if (entry === ".history") continue;
            cpSync(join(skillDir, entry), join(dest, entry), { recursive: true });
          }
        } catch {}
      }

      const now = new Date().toISOString();
      index[name] = {
        ...current,
        version: current.version + 1,
        updatedAt: now,
      };
      this.writeIndex(index);

      return {
        name,
        ...index[name]!,
        historyVersions: listHistoryVersions(skillDir),
        path: join(skillDir, "SKILL.md"),
      };
    });
  }

  /** Archives a curated skill into `.archive/` without permanent data loss. */
  archive(name: string): { archived: boolean; archivePath: string } {
    return this.withLock(name, () => {
      const index = this.readIndex();
      if (!index[name]) throw new KodoError("NOT_FOUND", `未找到沉淀技能：${name}`);
      const skillDir = join(this.rootDir, name);
      const archiveRoot = join(this.rootDir, ".archive");
      mkdirSync(archiveRoot, { recursive: true });
      const archivePath = join(archiveRoot, `${name}-${Date.now()}`);
      if (existsSync(skillDir)) {
        renameSync(skillDir, archivePath);
      }
      if (index[name]!.sharedPath) {
        try {
          rmSync(join(this.sharedAgentsDir, name), { recursive: true, force: true });
        } catch {}
      }
      delete index[name];
      this.writeIndex(index);
      return { archived: true, archivePath };
    });
  }
}
