import { createInterface } from "node:readline";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
const mode = process.env.ACP_LIST_CASE;
const write = (id, result) =>
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, method, params } = JSON.parse(line);
  if (process.env.ACP_LIST_LOG)
    appendFileSync(process.env.ACP_LIST_LOG, JSON.stringify({ method, params }) + "\n");
  if (method === "initialize") {
    write(id, {
      protocolVersion: mode === "version" ? 2 : 1,
      agentCapabilities: mode === "absent" ? {} : { sessionCapabilities: { list: {} } },
    });
  } else if (method === "session/list") {
    if (mode === "method" || mode === "auth" || (mode === "late-method" && params.cursor)) {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          error: { code: mode === "auth" ? -32000 : -32601, message: "fixture native error" },
        }) + "\n",
      );
      return;
    }
    const item = (sessionId, cwd = params.cwd) => ({ sessionId, cwd, title: sessionId });
    if (mode === "invalid") return write(id, { sessions: [{ sessionId: "invalid" }] });
    if (mode === "limit")
      return write(id, { sessions: Array.from({ length: 20001 }, () => item("same")) });
    if (mode === "empty") return write(id, { sessions: [] });
    write(id, {
      sessions: params.cursor
        ? [item("first"), item("second")]
        : [item("first"), item("outside", join(params.cwd, "other"))],
      ...(params.cursor && mode !== "repeat" ? {} : { nextCursor: "page-two" }),
    });
  } else {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: "Inspection must not create a session" },
      }) + "\n",
    );
  }
});
