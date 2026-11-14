import { openSync, closeSync, readSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";

type Entry = { files?: Record<string, Entry>; size?: number; offset?: string; unpacked?: boolean };
const headers = new Map<string, { stamp: string; base: number; size: number; root: Entry }>();
function metadata(archive: string, relative: string) {
  if (relative.split(/[\\/]/).some((p) => !p || p === "." || p === "..")) return null;
  const stat = statSync(archive),
    stamp = `${stat.mtimeMs}:${stat.size}`;
  let header = headers.get(archive);
  if (header?.stamp !== stamp) {
    const fd = openSync(archive, "r");
    try {
      const prefix = Buffer.alloc(16);
      if (readSync(fd, prefix, 0, 16, 0) !== 16) return null;
      const length = prefix.readUInt32LE(12);
      if (length > 16 * 1024 * 1024) return null;
      const data = Buffer.alloc(length);
      if (readSync(fd, data, 0, length, 16) !== length) return null;
      header = {
        stamp,
        base: 8 + prefix.readUInt32LE(4),
        size: stat.size,
        root: JSON.parse(data.toString()),
      };
      if (headers.size > 32) headers.clear();
      headers.set(archive, header);
    } finally {
      closeSync(fd);
    }
  }
  let entry: Entry | undefined = header.root;
  for (const part of relative.split(/[\\/]/)) entry = entry?.files?.[part];
  if (!entry || typeof entry.size !== "number") return null;
  const offset = header.base + Number(entry.offset);
  if (
    !entry.unpacked &&
    (!Number.isSafeInteger(offset) || offset < header.base || offset + entry.size > header.size)
  )
    return null;
  return { entry, offset };
}
export function asarContains(archive: string, relative: string): boolean {
  try {
    return Boolean(metadata(archive, relative));
  } catch {
    return false;
  }
}
/** Read installed metadata in place, without extracting or changing the application. */
export function readAsarText(
  archive: string,
  relative: string,
  limit = 2 * 1024 * 1024,
): string | null {
  let fd: number | undefined;
  try {
    const found = metadata(archive, relative);
    if (!found || found.entry.size! > limit) return null;
    if (found.entry.unpacked) return readFileSync(join(`${archive}.unpacked`, relative), "utf8");
    fd = openSync(archive, "r");
    const content = Buffer.alloc(found.entry.size!);
    return readSync(fd, content, 0, content.length, found.offset) === content.length
      ? content.toString("utf8")
      : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
