// Real installed Grok process + deterministic loopback model fixture.
// The model endpoint is local and the requested read targets a generated marker.
// This is a runtime integration check, not authenticated model acceptance.
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { nativeLaunch } from "../packages/host/dist/configuration/config.js";
import { grokBuildAdapter } from "../packages/host/dist/harnesses/grok-build.js";

const root = resolve(".local/verification/grok-native-tools-" + Date.now());
const home = join(root, "home"),
  workspace = join(root, "workspace");
await mkdir(home, { recursive: true });
await mkdir(workspace);
const marker = join(workspace, "marker.txt"),
  token = "NATIVE_READ_" + randomUUID();
await writeFile(marker, token);
const report = {
  kind: "real-native-runtime-with-synthetic-local-model",
  ok: false,
  requests: 0,
  tools: [],
  readResult: null,
};
const background = process.argv.includes("--background");
const verifySubagent = background || process.argv.includes("--subagent");
report.subagentVerification = verifySubagent;
report.backgroundVerification = background;
const server = createServer(async (req, res) => {
  try {
    if (req.method !== "POST" || !req.url?.startsWith("/v1/messages")) {
      res.writeHead(404, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "Unsupported local fixture endpoint" }));
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    if (req.url.startsWith("/v1/messages/count_tokens")) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ input_tokens: 32 }));
    }
    report.requests++;
    if (report.requests > 24) throw new Error("Native fixture request limit reached");
    const read = body.tools?.find((tool) => /^(Read|read_file)$/i.test(tool.name));
    const spawn = body.tools?.find((tool) => /^(spawn_subagent|task|Task)$/.test(tool.name));
    const results = (body.messages ?? [])
      .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
      .filter((block) => block.type === "tool_result");
    let content, stopReason;
    if (results.length) {
      const resultText = JSON.stringify(results.at(-1).content);
      if (!report.readResult?.includes(token)) report.readResult = resultText;
      content = [
        { type: "text", text: report.readResult.includes(token) ? token : "NATIVE_READ_FAILED" },
      ];
      stopReason = "end_turn";
    } else if (
      verifySubagent &&
      spawn &&
      !JSON.stringify(body.messages).includes("KODO_CHILD_READ")
    ) {
      report.spawnSchema = spawn.input_schema;
      content = [
        {
          type: "tool_use",
          id: "fixture_spawn",
          name: spawn.name,
          input: {
            description: "Verify native child read",
            prompt: "KODO_CHILD_READ Read the file " + marker + " and return its contents.",
            background,
          },
        },
      ];
      stopReason = "tool_use";
    } else if (read) {
      report.readSchema = read.input_schema;
      const properties = read.input_schema?.properties ?? {};
      const key = ["target_file", "file_path", "path", "filePath"].find((key) => properties[key]);
      if (!key) throw new Error("Native read schema has no recognized path field");
      report.tools = body.tools.map((tool) => tool.name);
      content = [
        { type: "tool_use", id: "fixture_read", name: read.name, input: { [key]: marker } },
      ];
      stopReason = "tool_use";
    } else {
      content = [{ type: "text", text: "Native tool verification" }];
      stopReason = "end_turn";
    }
    const message = {
      id: "msg_fixture_" + report.requests,
      type: "message",
      role: "assistant",
      model: body.model,
      content,
      stop_reason: stopReason,
      stop_sequence: null,
      usage: { input_tokens: 32, output_tokens: 8 },
    };
    if (!body.stream) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(message));
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    const emit = (type, data) =>
      res.write("event: " + type + "\ndata: " + JSON.stringify({ type, ...data }) + "\n\n");
    emit("message_start", { message: { ...message, content: [], stop_reason: null } });
    const block = content[0];
    emit("content_block_start", {
      index: 0,
      content_block:
        block.type === "tool_use" ? { ...block, input: {} } : { type: "text", text: "" },
    });
    emit("content_block_delta", {
      index: 0,
      delta:
        block.type === "tool_use"
          ? { type: "input_json_delta", partial_json: JSON.stringify(block.input) }
          : { type: "text_delta", text: block.text },
    });
    emit("content_block_stop", { index: 0 });
    emit("message_delta", {
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: 8 },
    });
    emit("message_stop", {});
    res.end();
  } catch (error) {
    report.providerError = error.message;
    res.writeHead(500, { "content-type": "application/json" });
    res.end(
      JSON.stringify({ type: "error", error: { type: "api_error", message: error.message } }),
    );
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
await writeFile(
  join(home, "config.toml"),
  [
    "[models]",
    'default = "native-fixture"',
    '[model."native-fixture"]',
    'model = "native-fixture"',
    'name = "Synthetic local model"',
    'base_url = "http://127.0.0.1:' + port + '/v1"',
    'env_key = "KODO_GROK_FIXTURE_KEY"',
    'api_backend = "messages"',
    "context_window = 65536",
    "max_completion_tokens = 1024",
    "",
  ].join("\n"),
);
let runtime, timer;
let stderr = "";
try {
  const launch = nativeLaunch(join(process.env.LOCALAPPDATA, "Kodo", "host"), "grok-build");
  const binaryIndex = process.argv.indexOf("--binary");
  if (binaryIndex >= 0) {
    if (!process.argv[binaryIndex + 1])
      throw new Error("--binary requires a native executable path");
    launch.command = resolve(process.argv[binaryIndex + 1]);
    launch.args = ["agent", "stdio"];
  }
  report.executableVersion = execFileSync(
    launch.command,
    [...launch.args.slice(0, -2), "--version"],
    {
      cwd: workspace,
      env: { ...process.env, ...launch.env, GROK_HOME: home },
      encoding: "utf8",
      windowsHide: true,
      timeout: 30000,
    },
  ).trim();
  report.launch = { command: launch.command, args: launch.args };
  if (process.argv.includes("--no-leader")) {
    launch.args = [...launch.args.slice(0, -1), "--no-leader", "stdio"];
    report.route = "no-leader";
  }
  runtime = await grokBuildAdapter.connect(
    { id: randomUUID(), nativeSessionId: null },
    {
      cwd: workspace,
      dataDir: root,
      env: {
        ...process.env,
        GROK_HOME: home,
        KODO_GROK_FIXTURE_KEY: "local-fixture-only",
        RUST_LOG: "info",
      },
      launch,
      onStderr: (text) => {
        stderr = (stderr + text).slice(-262144);
      },
      onNativeNotification: (method, params) => {
        if (method !== "session/update" && (report.notifications ??= []).length < 80)
          report.notifications.push({ method, params });
      },
      emit: (type, payload) => {
        if (type === "tool") (report.toolEvents ??= []).push(payload);
        if (type === "subagent") (report.subagentEvents ??= []).push(payload);
        if (type === "turn-ended") report.outcome = payload.outcome;
      },
      interact: async (_id, request) => {
        const option = request.options?.find((option) => option.kind === "allow_once");
        return {
          outcome: option
            ? { outcome: "selected", optionId: option.optionId }
            : { outcome: "cancelled" },
        };
      },
    },
  );
  await Promise.race([
    runtime.send("Read the file " + marker + " and return its contents.", randomUUID(), "new"),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Native read verification timed out")), 45000);
    }),
  ]);
  if (background) {
    const deadline = Date.now() + 45000;
    while (
      Date.now() < deadline &&
      !report.subagentEvents?.some(
        (event) =>
          event.event?.type === "message" && JSON.stringify(event.event.payload).includes(token),
      )
    )
      await new Promise((resolve) => setTimeout(resolve, 100));
  }
  report.ok = Boolean(report.readResult?.includes(token)) && report.outcome === "completed";
  if (verifySubagent)
    report.ok &&= Boolean(
      report.subagentEvents?.some(
        (event) =>
          event.event?.type === "message" && JSON.stringify(event.event.payload).includes(token),
      ),
    );
} catch (error) {
  report.error = error.message;
} finally {
  clearTimeout(timer);
  await runtime?.close();
  await writeFile(join(root, "native-stderr.log"), stderr);
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2));
}
console.log(
  JSON.stringify(
    {
      ...report,
      tools: report.tools.length,
      toolEvents: report.toolEvents?.length,
      subagentEvents: report.subagentEvents?.length,
      notifications: report.notifications?.length,
      report: join(root, "report.json"),
    },
    null,
    2,
  ),
);
if (!report.ok) process.exitCode = 1;
