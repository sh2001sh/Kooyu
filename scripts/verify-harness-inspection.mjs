// Read-only native protocol acceptance: no prompt, session/new, start or resume.
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { instanceEnv, nativeLaunch } from "../packages/host/dist/configuration/config.js";
import { JsonRpc } from "../packages/host/dist/harnesses/rpc.js";
import { cursorAdapter } from "../packages/host/dist/harnesses/cursor.js";
import { codexAdapter } from "../packages/host/dist/harnesses/codex.js";
import { opencodeAdapter } from "../packages/host/dist/harnesses/opencode.js";
import { listAcpSessions } from "../packages/host/dist/harnesses/acp-sessions.js";

const dataDir =
  process.env.KODO_DATA_DIR ??
  join(process.env.LOCALAPPDATA ?? join(homedir(), ".local", "share"), "Kodo", "host");
const context = async (id, cwd = process.cwd()) => ({
  cwd,
  dataDir,
  env: await instanceEnv(id, undefined, dataDir),
  launch: nativeLaunch(dataDir, id),
  emit: () => {},
  interact: async () => ({ outcome: { outcome: "cancelled" } }),
});
const results = [];
for (const id of ["cursor", "grok-build", "kimi-code"]) {
  try {
    const sessions = await listAcpSessions(await context(id));
    results.push({
      id,
      check: "standalone ACP session/list",
      ok: sessions !== null,
      count: sessions?.length,
    });
  } catch (error) {
    results.push({ id, check: "standalone ACP session/list", ok: false, error: error.message });
  }
}
for (const id of ["gemini", "cursor", "kimi-code", "grok-build"]) {
  let rpc;
  try {
    rpc = new JsonRpc(await context(id));
    const result = await rpc.request("initialize", {
      protocolVersion: 1,
      clientInfo: { name: "kodo-read-only-verification", version: "0.1.0" },
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    });
    results.push({
      id,
      check: "ACP initialize",
      ok: result.protocolVersion === 1,
      agent: result.agentInfo,
      capabilities: result.agentCapabilities,
    });
  } catch (error) {
    results.push({ id, check: "ACP initialize", ok: false, error: error.message });
  } finally {
    if (rpc)
      await rpc
        .close()
        .catch((error) => results.push({ id, check: "close", ok: false, error: error.message }));
  }
}
try {
  const root = join(homedir(), ".cursor", "acp-sessions");
  let candidate;
  for (const id of await readdir(root)) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) continue;
    try {
      const meta = JSON.parse(await readFile(join(root, id, "meta.json"), "utf8"));
      // Only inspect this repository's isolated verification sessions, not unrelated chats.
      if (
        typeof meta.cwd === "string" &&
        meta.cwd.includes("agent-harness") &&
        /[\\/]\.local[\\/]/.test(meta.cwd)
      ) {
        candidate = { id, cwd: meta.cwd };
        break;
      }
    } catch {
      /* A session can be removed while listing. */
    }
  }
  if (candidate) {
    const sessions = await cursorAdapter.standaloneList({}, await context("cursor", candidate.cwd));
    results.push({
      id: "cursor",
      check: "native list finds existing isolated session",
      ok: sessions.some((session) => session.id === candidate.id),
      count: sessions.length,
    });
    const result = await cursorAdapter.standaloneRead(
      { nativeSessionId: candidate.id },
      await context("cursor", candidate.cwd),
    );
    results.push({
      id: "cursor",
      check: "isolated existing session load history",
      ok: true,
      messages: result.messages.length,
    });
  } else
    results.push({
      id: "cursor",
      check: "isolated existing session load history",
      skipped: "No isolated verification session found",
    });
} catch (error) {
  results.push({
    id: "cursor",
    check: "isolated existing session load history",
    ok: false,
    error: error.message,
  });
}
try {
  const result = await codexAdapter.standaloneList({}, await context("codex"));
  results.push({
    id: "codex",
    check: "standalone thread/list",
    ok: true,
    count: result.data.length,
  });
} catch (error) {
  results.push({ id: "codex", check: "standalone thread/list", ok: false, error: error.message });
}
try {
  const result = await opencodeAdapter.standaloneList({}, await context("opencode"));
  results.push({
    id: "opencode",
    check: "standalone GET /session",
    ok: Array.isArray(result),
    count: result.length,
  });
} catch (error) {
  results.push({
    id: "opencode",
    check: "standalone GET /session",
    ok: false,
    error: error.message,
  });
}
await mkdir(".local", { recursive: true });
await writeFile(
  ".local/harness-inspection.json",
  JSON.stringify({ date: new Date().toISOString(), results }, null, 2),
);
console.log(JSON.stringify(results, null, 2));
if (results.some((result) => result.ok === false)) process.exitCode = 1;
