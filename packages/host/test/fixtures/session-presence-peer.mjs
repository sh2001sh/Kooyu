// Read-only native contracts. Tests never mutate a user's native conversations.
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { appendFileSync } from "node:fs";
const mode = process.env.PRESENCE_CASE;
const log = (value) => {
  if (process.env.PRESENCE_LOG)
    appendFileSync(process.env.PRESENCE_LOG, JSON.stringify(value) + "\n");
};
if (process.argv.includes("--port")) {
  createServer((req, res) => {
    log({ method: req.method, path: req.url });
    res.setHeader("content-type", "application/json");
    const id = decodeURIComponent(req.url.split("/").at(-1));
    if (req.url === "/global/health") return res.end('{"healthy":true}');
    if (id === "missing") {
      res.statusCode = 404;
      return res.end("{}");
    }
    if (id === "permission") {
      res.statusCode = 403;
      return res.end("{}");
    }
    if (id === "error") {
      res.statusCode = 500;
      return res.end("{}");
    }
    return res.end(
      JSON.stringify({
        id: id === "wrong-id" ? "another" : id,
        time: { archived: id === "archived" ? 1 : undefined },
      }),
    );
  }).listen(Number(process.argv[process.argv.indexOf("--port") + 1]), "127.0.0.1");
} else if (process.argv.includes("session")) {
  log({ args: process.argv.slice(2) });
  if (mode === "failure") process.exit(1);
  if (mode === "malformed") process.stdout.write("{}");
  else
    process.stdout.write(
      JSON.stringify(
        mode === "limit"
          ? Array.from({ length: 10000 }, () => ({ id: "present" }))
          : [{ id: process.argv.includes("--archived") ? "archived" : "present" }],
      ),
    );
} else {
  const write = (id, result, error) =>
    process.stdout.write(JSON.stringify({ id, ...(error ? { error } : { result }) }) + "\n");
  for await (const line of createInterface({ input: process.stdin })) {
    const { id, method, params } = JSON.parse(line);
    log({ method, params });
    if (id === undefined) continue;
    if (mode === "failure") {
      write(id, null, { code: -32000, message: "storage unavailable" });
      continue;
    }
    if (method === "initialize") write(id, { protocolVersion: 1, agentCapabilities: {} });
    else if (method === "v4/sessionsIndex/reconcile")
      write(id, {
        sessions: params.sessionIds
          .filter((id) => id !== "omitted")
          .map((sessionId) => ({
            sessionId,
            exists: sessionId !== "missing",
            deleted: sessionId === "deleted",
            archived: sessionId === "archived",
            ...(sessionId === "malformed" ? { exists: "false" } : {}),
          })),
      });
    else write(id, null, { code: -32601, message: "Read-only inspection contract" });
  }
}
