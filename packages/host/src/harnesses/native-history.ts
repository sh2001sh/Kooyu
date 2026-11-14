import { readFile, stat } from "node:fs/promises";
import { unsupported, type Wire } from "./adapter.js";

export const NATIVE_HISTORY_LIMIT = 8 * 1024 * 1024;

/** Native logs may be read while the CLI is appending the final record. */
export async function readCompleteJsonLines(path: string): Promise<Wire[]> {
  const file = await stat(path);
  if (!file.isFile() || file.size > NATIVE_HISTORY_LIMIT)
    unsupported("原生历史文件不存在或超过单次读取上限。");
  const bytes = await readFile(path);
  if (bytes.length > NATIVE_HISTORY_LIMIT) unsupported("原生历史超过单次读取上限。");
  const content = bytes.toString("utf8");
  const lines = content.split(/\r?\n/);
  const complete = content.endsWith("\n") ? lines.length - 1 : lines.length;
  const records: Wire[] = [];
  for (let i = 0; i < complete; i++) {
    const line = lines[i];
    if (!line) continue;
    try {
      const record: unknown = JSON.parse(line);
      if (!record || typeof record !== "object" || Array.isArray(record))
        unsupported("原生历史包含无效记录。");
      records.push(record as Wire);
    } catch (error) {
      // A last line without a newline can still be in flight.
      if (i === complete - 1 && !content.endsWith("\n") && error instanceof SyntaxError) break;
      unsupported("原生历史包含损坏的完整记录。");
    }
  }
  return records;
}
