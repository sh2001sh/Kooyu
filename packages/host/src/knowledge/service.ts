import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import {
  KodoError,
  knowledgeMountInputSchema,
  type KnowledgeMount,
  type KnowledgeSearchHit,
} from "@kodo/protocol";
import type { Store } from "../storage/store.js";
import { digest } from "../execution/actions.js";

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".astro",
  ".gradle",
  "target",
  "__pycache__",
  ".obsidian",
]);

const TEXT_EXTENSIONS = new Set([
  ".md",
  ".mdx",
  ".txt",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".csv",
  ".html",
  ".xml",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".sql",
  ".sh",
  ".ps1",
]);

const MAX_FILE_BYTES = 512 * 1024;
const MAX_SCAN_FILES = 2500;

// Normalize CJK Kangxi radicals often emitted by PDF/Word exports into standard CJK characters
const RADICALS: Record<string, string> = Object.fromEntries(
  [
    ..."⼾户⻅见⻆角⻓长⻔门⻚页⻛风⻜飞⻢马⻥鱼⻦鸟⻬齐⻮齿⻰龙⻳龟⻉贝⻋车⻘青⻙韦⻝食⻨麦⻩黄⻤鬼",
  ].flatMap((c, i, all) => (i % 2 ? [] : [[c, all[i + 1]!]])),
);

export function normalizeSearchText(text: string): string {
  return text
    .replace(/[\u2E80-\u2FDF\uF900-\uFAFF]/g, (c) => RADICALS[c] ?? c.normalize("NFKC"))
    .replace(/\r\n/g, "\n");
}

function tokenize(query: string): string[] {
  const clean = normalizeSearchText(query).trim().toLowerCase();
  if (!clean) return [];
  const parts = clean.split(/[\s,，。；;、/]+/).filter((t) => t.length >= 1);
  return [...new Set([clean, ...parts])];
}

function within(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return rel === "" || (!isAbsolute(rel) && !rel.startsWith(".."));
}

/**
 * Mounted Local Knowledge Roots (Obsidian Vaults, project `docs/`, personal notes).
 *
 * Zero vector DB / zero embedding API cost: mounts existing local folders read-only
 * and runs deterministic CJK-normalized full-text search with exact file + line anchors.
 */
export class KnowledgeService {
  constructor(private readonly store: Store) {}

  listMounts(): KnowledgeMount[] {
    return this.store
      .records<KnowledgeMount>("knowledge-mount")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  addMount(rawInput: unknown): KnowledgeMount {
    const input = knowledgeMountInputSchema.parse(rawInput);
    const resolvedPath = resolve(input.path);
    if (!existsSync(resolvedPath) || !statSync(resolvedPath).isDirectory()) {
      throw new KodoError("INVALID_INPUT", `目录不存在或不是有效文件夹：${resolvedPath}`);
    }
    const real = realpathSync(resolvedPath);
    const fingerprint = digest({ label: input.label, path: real });
    return this.store.transaction(() => {
      const prior = this.store.record<{ fingerprint: string; value: KnowledgeMount }>(
        "knowledge-mount-req",
        input.requestId,
      );
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          throw new KodoError("CONFLICT", "挂载知识目录请求 ID 冲突。");
        return prior.value;
      }
      const existing = this.listMounts().find((m) => m.path.toLowerCase() === real.toLowerCase());
      if (existing) {
        const updated: KnowledgeMount = { ...existing, label: input.label };
        this.store.put("knowledge-mount", updated.id, updated);
        this.store.put("knowledge-mount-req", input.requestId, { fingerprint, value: updated });
        return updated;
      }
      const mount: KnowledgeMount = {
        id: randomUUID(),
        label: input.label,
        path: real,
        createdAt: new Date().toISOString(),
      };
      this.store.put("knowledge-mount", mount.id, mount);
      this.store.put("knowledge-mount-req", input.requestId, { fingerprint, value: mount });
      return mount;
    });
  }

  removeMount(id: string): { removed: boolean } {
    const existing = this.store.record<KnowledgeMount>("knowledge-mount", id);
    if (!existing) throw new KodoError("NOT_FOUND", "未找到该知识目录挂载。");
    this.store.remove("knowledge-mount", id);
    return { removed: true };
  }

  search(query: string, options: { mountId?: string; limit?: number } = {}): KnowledgeSearchHit[] {
    const tokens = tokenize(query);
    if (!tokens.length) return [];
    const limit = Math.max(1, Math.min(options.limit ?? 15, 40));
    const mounts = this.listMounts().filter(
      (m) => (!options.mountId || m.id === options.mountId) && existsSync(m.path),
    );
    const hits: KnowledgeSearchHit[] = [];
    let filesScanned = 0;

    for (const mount of mounts) {
      const walk = (dir: string, depth: number) => {
        if (depth > 8 || filesScanned >= MAX_SCAN_FILES) return;
        let entries;
        try {
          entries = readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          if (filesScanned >= MAX_SCAN_FILES) return;
          if (entry.name.startsWith(".") && entry.name !== ".github") continue;
          const full = join(dir, entry.name);
          try {
            if (lstatSync(full).isSymbolicLink()) continue;
          } catch {
            continue;
          }
          if (entry.isDirectory()) {
            if (!IGNORED_DIRS.has(entry.name)) walk(full, depth + 1);
            continue;
          }
          if (!entry.isFile()) continue;
          const ext = extname(entry.name).toLowerCase();
          if (!TEXT_EXTENSIONS.has(ext)) continue;
          let size = 0;
          try {
            size = statSync(full).size;
          } catch {
            continue;
          }
          if (size === 0 || size > MAX_FILE_BYTES) continue;
          filesScanned++;

          let content: string;
          try {
            content = normalizeSearchText(readFileSync(full, "utf8"));
          } catch {
            continue;
          }
          const relPath = relative(mount.path, full).replace(/\\/g, "/");
          const lowerRel = relPath.toLowerCase();
          const pathBonus = tokens.reduce((acc, t) => acc + (lowerRel.includes(t) ? 3 : 0), 0);
          const lines = content.split("\n");
          let fileHits = 0;
          for (let i = 0; i < lines.length; i++) {
            const lowerLine = lines[i]!.toLowerCase();
            let score = pathBonus;
            let matched = false;
            for (const token of tokens) {
              if (lowerLine.includes(token)) {
                matched = true;
                score += token === tokens[0] ? 5 : 2;
              }
            }
            if (matched) {
              const start = Math.max(0, i - 1);
              const end = Math.min(lines.length, i + 2);
              hits.push({
                mountId: mount.id,
                mountLabel: mount.label,
                relativePath: relPath,
                absolutePath: full,
                line: i + 1,
                snippet: lines.slice(start, end).join("\n").trim().slice(0, 360),
                score,
              });
              fileHits++;
              if (fileHits >= 3) break;
            }
          }
        }
      };
      walk(mount.path, 0);
    }

    return hits
      .sort((a, b) => b.score - a.score || a.relativePath.localeCompare(b.relativePath))
      .slice(0, limit);
  }

  /** Reads a bounded line slice from a file inside a mounted knowledge root (read-only, traversal-safe). */
  readSlice(
    mountId: string,
    relativePath: string,
    startLine = 1,
    endLine = 120,
  ): {
    mountLabel: string;
    relativePath: string;
    startLine: number;
    endLine: number;
    totalLines: number;
    content: string;
  } {
    const mount = this.store.record<KnowledgeMount>("knowledge-mount", mountId);
    if (!mount) throw new KodoError("NOT_FOUND", "未找到该知识目录挂载。");
    const target = resolve(mount.path, relativePath);
    if (!within(mount.path, target) || !existsSync(target) || lstatSync(target).isSymbolicLink()) {
      throw new KodoError("INVALID_INPUT", "目标文件不在挂载目录内或不存在。");
    }
    const real = realpathSync(target);
    if (!within(mount.path, real)) {
      throw new KodoError("UNAUTHORIZED", "禁止跨出挂载目录读取文件。");
    }
    if (statSync(real).size > MAX_FILE_BYTES) {
      throw new KodoError("INVALID_INPUT", "文件超过 512KB 读取上限。");
    }
    const lines = normalizeSearchText(readFileSync(real, "utf8")).split("\n");
    const from = Math.max(1, Math.min(startLine, lines.length));
    const to = Math.max(from, Math.min(endLine, from + 200, lines.length));
    return {
      mountLabel: mount.label,
      relativePath: relative(mount.path, real).replace(/\\/g, "/"),
      startLine: from,
      endLine: to,
      totalLines: lines.length,
      content: lines.slice(from - 1, to).join("\n"),
    };
  }
}
