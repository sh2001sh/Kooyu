import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_MAX_INLINE_CHARS = 16_000;
const HEAD_PREVIEW_CHARS = 6_000;
const TAIL_PREVIEW_CHARS = 3_000;

export interface SpillResult {
  spilled: boolean;
  text: string;
  totalChars: number;
  path?: string;
}

function safeLabel(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "output"
  );
}

function timestampSlug(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/**
 * Inline & Spill helper: keeps small payloads inline; writes oversized tool outputs
 * or worker reports atomically to `<dataDir>/kodo/spill/` and returns a bounded preview
 * with the full file path so main conversation context stays lean.
 */
export function spillLargeText(
  dataDir: string,
  label: string,
  text: string,
  maxInlineChars = DEFAULT_MAX_INLINE_CHARS,
): SpillResult {
  if (text.length <= maxInlineChars) {
    return { spilled: false, text, totalChars: text.length };
  }
  const spillDir = join(dataDir, "kodo", "spill");
  mkdirSync(spillDir, { recursive: true });
  const fileName = `${timestampSlug()}-${safeLabel(label)}-${randomUUID().slice(0, 8)}.txt`;
  const target = join(spillDir, fileName);
  const tmp = `${target}.${randomUUID().slice(0, 8)}.tmp`;
  writeFileSync(tmp, text, { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, target);

  const head = text.slice(0, HEAD_PREVIEW_CHARS).trimEnd();
  const tail = text.slice(-TAIL_PREVIEW_CHARS).trimStart();
  const omitted = Math.max(0, text.length - head.length - tail.length);
  const preview = [
    head,
    "",
    `... [已自动落盘：共 ${text.length} 字符，此处省略 ${omitted} 字符；完整内容已保存至 ${target}] ...`,
    "",
    tail,
  ].join("\n");

  return {
    spilled: true,
    text: preview,
    totalChars: text.length,
    path: target,
  };
}
