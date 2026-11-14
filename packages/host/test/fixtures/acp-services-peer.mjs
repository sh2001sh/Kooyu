// Isolated ACP v1 peer. No model calls.
import { createInterface } from "node:readline";
import { join } from "node:path";
import { appendFileSync } from "node:fs";
const sessionId = "acp-services-session";
const write = (value) =>
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...value }) + String.fromCharCode(10));
const update = (value) => write({ method: "session/update", params: { sessionId, update: value } });
const requests = new Map();
let ordinal = 0,
  cwd,
  activePrompt,
  delayedModel,
  lateRequests;
const request = (method, params) =>
  new Promise((resolve, reject) => {
    const id = "client-" + ++ordinal;
    requests.set(id, { resolve, reject });
    write({ id, method, params: { sessionId, ...params } });
  });
async function handle(message) {
  const { id, method, params } = message;
  if (process.env.SYNTHETIC_WIRE_LOG)
    appendFileSync(process.env.SYNTHETIC_WIRE_LOG, JSON.stringify(message) + "\n");
  if (!method) {
    const pending = requests.get(id);
    requests.delete(id);
    if (message.error) pending?.reject(new Error(message.error.message));
    else pending?.resolve(message.result);
    return;
  }
  if (method === "initialize") {
    if (
      params.clientInfo.name !== "kodo-history" &&
      (!params.clientCapabilities.fs?.readTextFile ||
        !params.clientCapabilities.fs?.writeTextFile ||
        !params.clientCapabilities.terminal)
    )
      throw new Error("Client services not advertised");
    write({
      id,
      result: {
        protocolVersion: 1,
        agentCapabilities: { loadSession: true, sessionCapabilities: { list: {} } },
      },
    });
  } else if (method === "session/list") {
    if (delayedModel) write({ id: delayedModel, result: {} });
    delayedModel = undefined;
    if (activePrompt) write({ id: activePrompt, result: { stopReason: "end_turn" } });
    activePrompt = undefined;
    write({ id, result: { sessions: [] } });
  } else if (["session/new", "session/load", "session/resume"].includes(method)) {
    cwd = params.cwd;
    if (method === "session/load") {
      update({
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "old question" },
      });
      update({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "old reply" },
      });
      update({
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "private thought" },
      });
      update({
        sessionUpdate: "usage_update",
        used: 512,
        size: 4096,
        cost: { amount: 5, currency: "USD" },
      });
    }
    write({
      id,
      result: {
        sessionId,
        ...(process.env.SYNTHETIC_ACP_DELAY_MODEL
          ? {
              models: {
                currentModelId: "first",
                availableModels: [{ modelId: "first" }, { modelId: "second" }],
              },
            }
          : {}),
      },
    });
  } else if (method === "session/set_model" && process.env.SYNTHETIC_ACP_DELAY_MODEL) {
    delayedModel = id;
    update({ sessionUpdate: "test-preparing" });
  } else if (method === "session/prompt") {
    const text = params.prompt[0].text;
    if (text === "late-approvals") {
      lateRequests = Promise.all([
        request("session/request_permission", {
          options: [{ optionId: "native-allow", name: "Allow", kind: "allow_once" }],
          toolCall: { toolCallId: "late-tool" },
        }),
        request("fs/write_text_file", { path: join(cwd, "late.txt"), content: "stale" }).catch(
          (error) => ({ error: error.message }),
        ),
      ]);
      activePrompt = id;
      return;
    }
    if (text === "check-late") {
      update({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "next turn" },
      });
      const [permission, writeResult] = await lateRequests;
      if (permission.outcome.outcome !== "cancelled" || !writeResult.error)
        throw new Error("Stale approvals escaped their original turn");
    }
    if (text === "wait") {
      activePrompt = id;
      update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "working" } });
      return;
    }
    if (text === "services") {
      const path = join(cwd, "acp-created.txt");
      await request("fs/write_text_file", { path, content: "written by approved ACP operation" });
      const read = await request("fs/read_text_file", { path });
      const { terminalId } = await request("terminal/create", {
        command: process.execPath,
        args: ["-e", "process.stdout.write('terminal OK')"],
      });
      await request("terminal/wait_for_exit", { terminalId });
      const output = await request("terminal/output", { terminalId });
      await request("terminal/release", { terminalId });
      update({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: read.content + " / " + output.output },
      });
      const permission = await request("session/request_permission", {
        options: [{ optionId: "native-allow", name: "Allow", kind: "allow_once" }],
        toolCall: { toolCallId: "native-tool" },
      });
      if (permission.outcome.outcome !== "selected")
        throw new Error("Permission translation failed");
    }
    update({
      sessionUpdate: "usage_update",
      used: 123,
      size: 4096,
      cost: { amount: 0.25, currency: "USD" },
    });
    write({ id, result: { stopReason: text === "limited" ? "max_tokens" : "end_turn" } });
  } else if (method === "session/cancel") {
    if (activePrompt) write({ id: activePrompt, result: { stopReason: "cancelled" } });
    activePrompt = undefined;
  } else if (id !== undefined)
    write({ id, error: { code: -32601, message: "Unsupported fixture method" } });
}
createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  void handle(message).catch((error) =>
    write({ id: message.id, error: { code: -32603, message: error.message } }),
  );
});
