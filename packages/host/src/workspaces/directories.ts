import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { KodoError } from "@kodo/protocol";

export async function listDirectories(input?: string) {
  const path = input ?? homedir();
  if (!isAbsolute(path)) throw new KodoError("INVALID_INPUT", "请选择当前主机上的目录。");
  const current = resolve(path);
  try {
    if (!(await stat(current)).isDirectory()) throw new Error("Not a directory");
    const entries = await readdir(current, { withFileTypes: true });
    const directories = await Promise.all(
      entries.map(async (entry) => {
        if (entry.isDirectory()) return entry.name;
        if (!entry.isSymbolicLink()) return null;
        try {
          return (await stat(join(current, entry.name))).isDirectory() ? entry.name : null;
        } catch {
          return null;
        }
      }),
    );
    const roots =
      process.platform === "win32"
        ? Array.from({ length: 26 }, (_, i) => `${String.fromCharCode(65 + i)}:\\`).filter(
            existsSync,
          )
        : ["/"];
    return {
      path: current,
      home: homedir(),
      parent: dirname(current) === current ? null : dirname(current),
      roots,
      directories: directories
        .filter((name): name is string => name !== null)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .map((name) => ({ name, path: join(current, name) })),
    };
  } catch {
    throw new KodoError("INVALID_INPUT", "无法读取所选目录，请检查目录是否存在及访问权限。");
  }
}
