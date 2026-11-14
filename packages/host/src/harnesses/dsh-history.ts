import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { zstdDecompressSync, createZstdDecompress } from "node:zlib";
import { createReadStream } from "node:fs";
import { unsupported, type AdapterContext, type Wire } from "./adapter.js";
import { dshHome } from "./dsh-native.js";
import { NATIVE_HISTORY_LIMIT } from "./native-history.js";

const validId = (id: unknown): id is string =>
  typeof id === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(id);
const generation = /^session(?:\.v([1-9][0-9]*))?\.jsonl(\.zstd)?$/;

/** DSH appends independent Zstandard frames; Node's one-shot decoder stops at the first. */
function decodeFrames(bytes: Buffer) {
  const chunks: Buffer[] = [];
  let offset = 0,
    total = 0;
  const need = (size: number) => {
    if (offset + size > bytes.length) throw new Error("DSH 压缩历史末帧未完整，请重试。");
  };
  while (offset < bytes.length) {
    const start = offset;
    need(5);
    if (bytes.readUInt32LE(offset) !== 0xfd2fb528) throw new Error("DSH 压缩历史帧损坏。");
    offset += 4;
    const descriptor = bytes[offset++]!;
    if (descriptor & 0x18) throw new Error("DSH 压缩历史帧头损坏。");
    const single = Boolean(descriptor & 0x20),
      sizeFlag = descriptor >>> 6,
      dictionary = descriptor & 3;
    const headerSize =
      (single ? 0 : 1) +
      (dictionary === 3 ? 4 : dictionary) +
      (sizeFlag === 0 ? (single ? 1 : 0) : 1 << sizeFlag);
    need(headerSize);
    offset += headerSize;
    for (;;) {
      need(3);
      const block = bytes.readUIntLE(offset, 3),
        kind = (block >>> 1) & 3;
      offset += 3;
      if (kind === 3) throw new Error("DSH 压缩历史块损坏。");
      const length = kind === 1 ? 1 : block >>> 3;
      need(length);
      offset += length;
      if (block & 1) break;
    }
    if (descriptor & 4) {
      need(4);
      offset += 4;
    }
    if (total >= NATIVE_HISTORY_LIMIT || chunks.length >= 20001)
      unsupported("DSH 历史超过读取上限。");
    const decoded = zstdDecompressSync(bytes.subarray(start, offset), {
      maxOutputLength: NATIVE_HISTORY_LIMIT - total,
    });
    chunks.push(decoded);
    total += decoded.length;
  }
  return Buffer.concat(chunks, total);
}

async function directories(path: string) {
  const entries = await readdir(path, { withFileTypes: true });
  if (entries.length > 10000 || entries.some((entry) => entry.isSymbolicLink()))
    unsupported("DSH 历史目录超限或包含符号链接。");
  return entries.filter((entry) => entry.isDirectory());
}

async function selectedGeneration(path: string) {
  const entries = await readdir(path, { withFileTypes: true });
  const logs = entries
    .filter((entry) => entry.isFile() && generation.test(entry.name))
    .map((entry) => ({ name: entry.name, version: Number(generation.exec(entry.name)![1] ?? 0) }))
    .sort((a, b) => b.version - a.version);
  if (!logs.length || entries.some((entry) => entry.isSymbolicLink()))
    unsupported("DSH 历史缺少已提交日志或包含符号链接。");
  const latest = logs[0]!;
  if (
    !Number.isSafeInteger(latest.version) ||
    logs.filter((log) => log.version === latest.version).length !== 1
  )
    unsupported("DSH 历史世代不明确。");
  const filename = join(path, latest.name),
    before = await lstat(filename);
  if (!before.isFile()) unsupported("DSH 历史日志不兼容。");
  return { filename, before, latest };
}

function validateHeader(header: Wire | undefined, id: string, version: number) {
  if (
    !header ||
    header.type !== "session" ||
    header.id !== id ||
    ![0, 1, 2, 3, 4].includes(header.version) ||
    (version !== 0 && header.version !== version)
  )
    unsupported("DSH 历史身份或格式版本不兼容（只读支持 v0–v4）。");
  return header;
}

async function readHeader(path: string, id: string) {
  const { filename, latest } = await selectedGeneration(path);
  const source = createReadStream(filename, { highWaterMark: 16384 });
  const decoder = latest.name.endsWith(".zstd") ? createZstdDecompress() : null;
  source.on("error", (error) => decoder?.destroy(error));
  const stream = decoder ? source.pipe(decoder) : source;
  let bytes = Buffer.alloc(0);
  try {
    for await (const chunk of stream) {
      bytes = Buffer.concat([bytes, chunk]);
      const end = bytes.indexOf(10);
      if (end >= 0 && end < 65536)
        return validateHeader(
          JSON.parse(bytes.subarray(0, end).toString("utf8")),
          id,
          latest.version,
        );
      if (bytes.length >= 65536) unsupported("DSH 历史头部超过读取上限。");
    }
    unsupported("DSH 历史缺少完整头部。");
  } finally {
    source.destroy();
    decoder?.destroy();
  }
}

async function readGeneration(path: string, id: string) {
  const { filename, before, latest } = await selectedGeneration(path);
  if (before.size > NATIVE_HISTORY_LIMIT) unsupported("DSH 历史超过读取上限。");
  const bytes = await readFile(filename);
  if (bytes.length > NATIVE_HISTORY_LIMIT) unsupported("DSH 历史超过读取上限。");
  const decoded = latest.name.endsWith(".zstd") ? decodeFrames(bytes) : bytes;
  const after = await lstat(filename);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino)
    throw new Error("DSH 历史读取期间发生更新，请重试。");
  const text = decoded.toString("utf8"),
    lines = text.split(/\r?\n/);
  const records: Wire[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (!line) continue;
    try {
      const record = JSON.parse(line);
      if (!record || typeof record !== "object" || Array.isArray(record))
        throw new Error("Invalid DSH record");
      records.push(record);
    } catch (error) {
      if (index === lines.length - 1 && !text.endsWith("\n") && error instanceof SyntaxError) break;
      throw new Error("DSH 历史包含损坏记录。");
    }
    if (records.length > 20000) unsupported("DSH 历史记录超过读取上限。");
  }
  const header = validateHeader(records.shift(), id, latest.version);
  return { nativeSessionId: id, source: "dsh-jsonl", header, events: records };
}

/** Raw native log evidence only; never open, migrate, repair, resume or initialize an agent. */
export async function readDshHistory(ctx: AdapterContext, id: string) {
  if (!validId(id)) unsupported("DSH 历史会话 ID 无效。");
  const root = join(dshHome({ ...ctx.env, ...ctx.launch.env }), "sessions");
  const matches: string[] = [];
  for (const project of await directories(root)) {
    const path = join(root, project.name, id);
    try {
      const entry = await lstat(path);
      if (!entry.isDirectory() || entry.isSymbolicLink()) unsupported("DSH 会话目录不兼容。");
      matches.push(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  if (matches.length !== 1) unsupported("DSH 历史会话不存在或身份不唯一。");
  return readGeneration(matches[0]!, id);
}

export async function listDshHistory(ctx: AdapterContext) {
  const root = join(dshHome({ ...ctx.env, ...ctx.launch.env }), "sessions"),
    data: Wire[] = [];
  const ids = new Set<string>();
  let bytes = 0;
  let projects;
  try {
    projects = await directories(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  for (const project of projects)
    for (const session of await directories(join(root, project.name))) {
      if (!validId(session.name) || ids.has(session.name))
        unsupported("DSH 历史会话身份无效或重复。");
      if (data.length >= 10000) unsupported("DSH 历史列表超过读取上限。");
      ids.add(session.name);
      const header = await readHeader(join(root, project.name, session.name), session.name);
      const row = { ...header };
      bytes += Buffer.byteLength(JSON.stringify(row));
      if (bytes > NATIVE_HISTORY_LIMIT) unsupported("DSH 历史列表超过读取上限。");
      data.push(row);
    }
  return data;
}
