// Read-only installed-runtime acceptance. Never saves transcript bodies or sends model prompts.
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { instanceEnv, nativeLaunch } from "../packages/host/dist/configuration/config.js";
import { deepSeekAdapter } from "../packages/host/dist/harnesses/deepseek-harness.js";
import { zcodeAdapter } from "../packages/host/dist/harnesses/zcode.js";
import { codexAdapter } from "../packages/host/dist/harnesses/codex.js";
import { opencodeAdapter } from "../packages/host/dist/harnesses/opencode.js";
import { claudeCodeAdapter } from "../packages/host/dist/harnesses/claude-code.js";

const dataDir =
  process.env.KODO_DATA_DIR ??
  join(process.env.LOCALAPPDATA ?? join(homedir(), ".local", "share"), "Kodo", "host");
const root = resolve(".local/verification/history-trees-" + Date.now());
await mkdir(root, { recursive: true });
const checks = [];
const adapters = [deepSeekAdapter, zcodeAdapter, codexAdapter, opencodeAdapter, claudeCodeAdapter];
const requested = process.argv.slice(2);
for (const id of requested)
  if (!adapters.some((adapter) => adapter.descriptor.id === id))
    throw new Error("Unknown history inspection harness: " + id);
for (const adapter of adapters.filter(
  (adapter) => !requested.length || requested.includes(adapter.descriptor.id),
)) {
  const id = adapter.descriptor.id;
  try {
    const ctx = {
      cwd: process.cwd(),
      dataDir,
      env: await instanceEnv(id, undefined, dataDir),
      launch: nativeLaunch(dataDir, id),
      emit: () => {
        throw new Error("Offline inspection emitted a live event");
      },
      interact: async () => {
        throw new Error("Offline inspection requested interaction");
      },
    };
    const listing = await adapter.standaloneList({}, ctx);
    const rows = Array.isArray(listing) ? listing : (listing.data ?? listing.sessions);
    if (!Array.isArray(rows)) throw new Error("Invalid native listing");
    checks.push({
      id,
      check: "independent native list",
      ok: true,
      count: rows.length,
      ...(id === "zcode" ? { coverage: listing.coverage, complete: listing.complete } : {}),
    });
    // Only this repository's isolated verification workspaces are eligible for transcript reads.
    const candidates = rows.filter(
      (row) =>
        typeof (row.cwd ?? row.directory) === "string" &&
        (row.cwd ?? row.directory).toLowerCase().startsWith(process.cwd().toLowerCase()) &&
        /[\\/]\.local[\\/]/.test(row.cwd ?? row.directory),
    );
    // Prefer this batch's authenticated child runs over old empty inspection drafts.
    const candidate =
      candidates.find((row) => /[\\/]subagent-/.test(row.cwd ?? row.directory)) ?? candidates[0];
    if (candidate && adapter.standaloneRead) {
      const history = await adapter.standaloneRead(
        { nativeSessionId: candidate.id ?? candidate.sessionId },
        { ...ctx, cwd: candidate.cwd ?? candidate.directory },
      );
      checks.push({
        id,
        check: "isolated existing native history",
        ok: true,
        records:
          history.events?.length ?? history.messages?.length ?? history.thread?.turns?.length,
        descendants: history.subagents?.length,
        complete: history.complete,
      });
    } else
      checks.push({
        id,
        check: "isolated existing native history",
        status: "not-run",
        reason: "No eligible isolated verification session in native index",
      });
  } catch (error) {
    checks.push({ id, check: "native inspection", ok: false, error: error.message });
  }
}
const report = { kind: "read-only-installed-native-protocol", checks };
await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, report: join(root, "report.json") }, null, 2));
if (checks.some((check) => check.ok === false)) process.exitCode = 1;
