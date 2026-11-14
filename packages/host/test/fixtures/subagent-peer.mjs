// Synthetic wire-contract peer; never invokes a model or production harness.
import { createInterface } from "node:readline";
const mode = process.argv[2];
const write = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const notify = (method, params) => write({ jsonrpc: "2.0", method, params });
const root = "root-agent";
function acpChildren() {
  const ext = (sessionId, update) =>
    notify(
      update.sessionUpdate === "subagent_finished"
        ? "_x.ai/session/update"
        : "_x.ai/session_notification",
      { sessionId, update },
    );
  ext(root, {
    sessionUpdate: "subagent_spawned",
    parent_session_id: root,
    child_session_id: "child",
    description: "Read child",
  });
  ext("child", {
    sessionUpdate: "subagent_spawned",
    parent_session_id: "child",
    child_session_id: "grandchild",
  });
  ext("unrelated", {
    sessionUpdate: "subagent_spawned",
    parent_session_id: "unrelated",
    child_session_id: "foreign",
  });
  for (const sessionId of ["child", "grandchild", "foreign"]) {
    notify("session/update", {
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: sessionId + " output" },
      },
    });
    notify("session/update", {
      sessionId,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "same-tool",
        title: "Read",
        rawInput: { path: "marker.txt" },
      },
    });
  }
  ext(root, {
    sessionUpdate: "subagent_finished",
    child_session_id: "child",
    status: "completed",
    output: "child final output",
  });
  notify("session/update", {
    sessionId: root,
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "root output" },
    },
  });
}
for await (const line of createInterface({ input: process.stdin })) {
  const r = JSON.parse(line);
  let result = {};
  if (
    r.method === "initialize" &&
    mode === "cursor" &&
    !r.params.clientCapabilities?._meta?.subagents
  )
    throw new Error("Cursor child capability not negotiated");
  if (r.method === "initialize")
    result = ["acp", "cursor"].includes(mode)
      ? {
          protocolVersion: 1,
          agentCapabilities: { loadSession: true },
          agentInfo: { name: "synthetic" },
        }
      : { serverInfo: { name: "deepseek-harness-sdk-runtime" } };
  else if (r.method === "session/new") result = { sessionId: root };
  else if (r.method === "session/load") {
    if (mode === "acp")
      notify("_x.ai/session_notification", {
        sessionId: root,
        update: {
          sessionUpdate: "subagent_finished",
          child_session_id: "replayed-child",
          parent_session_id: root,
          status: "completed",
          output: "historical replay content",
        },
      });
    else
      notify("session/update", {
        sessionId: root,
        update: {
          sessionUpdate: "subagent_spawned",
          subagentSessionId: "replayed-child",
          name: "restored child",
          task: "historical replay content",
        },
      });
    result = { sessionId: root };
  } else if (r.method === "thread/start") result = { thread: { id: root, turns: [] } };
  else if (r.method === "session/prompt" && mode === "cursor") {
    for (const [id, parent] of [
      ["child", root],
      ["grandchild", "child"],
      ["foreign", "unrelated"],
    ]) {
      notify("session/update", {
        sessionId: parent,
        update: {
          sessionUpdate: "subagent_spawned",
          subagentSessionId: id,
          name: id,
          task: "read files",
          capabilities: {},
          _meta: { cursor: { agentId: id, toolCallId: "task-" + id } },
        },
      });
      notify("session/update", {
        sessionId: id,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: id + " output" },
        },
      });
      notify("session/update", {
        sessionId: parent,
        update: {
          sessionUpdate: "subagent_state_update",
          subagentSessionId: id,
          state: "completed",
        },
      });
    }
    notify("session/update", {
      sessionId: "child",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "child final output" },
      },
    });
    result = { stopReason: "end_turn" };
  } else if (r.method === "session/prompt" && mode === "acp") {
    acpChildren();
    result = { stopReason: "end_turn" };
  } else if (r.method === "session/prompt" && mode === "dsh") {
    const parent = r.params.sessionId;
    notify("subagent.started", { parentSessionId: parent, childSessionId: "child" });
    notify("subagent.started", { parentSessionId: "child", childSessionId: "grandchild" });
    notify("subagent.started", { parentSessionId: "unrelated", childSessionId: "foreign" });
    for (const sessionId of ["child", "grandchild", "foreign", parent]) {
      notify("session.event", {
        sessionId,
        event: {
          seq: 1,
          type: "assistant/message",
          data: {
            message: {
              role: "assistant",
              content: [{ type: "text", text: sessionId + " output" }],
            },
          },
        },
      });
      notify("session.event", {
        sessionId,
        event: { seq: 2, type: "turn/end", data: { reason: { kind: "completed" } } },
      });
      notify("session.status", { sessionId, status: "idle" });
    }
    notify("subagent.finished", {
      parentSessionId: parent,
      childSessionId: "child",
      status: "ok",
      lastAssistantMessage: [{ type: "text", text: "child final output" }],
    });
    result = { messageId: "queued" };
  } else if (r.method === "turn/start") {
    for (const [id, parent] of [
      ["child", root],
      ["grandchild", "child"],
      ["foreign", "unrelated"],
    ]) {
      notify("thread/started", {
        thread: {
          id,
          source: { subagent: { thread_spawn: { parent_thread_id: parent, agent_nickname: id } } },
        },
      });
      notify("item/agentMessage/delta", { threadId: id, itemId: "same-id", delta: id + " output" });
      notify("item/completed", {
        threadId: id,
        item: { type: "agentMessage", id: "same-id", text: id + " output" },
      });
      notify("turn/completed", { threadId: id, turn: { id: "same-turn", status: "completed" } });
    }
    notify("item/completed", {
      threadId: root,
      item: {
        type: "collabAgentToolCall",
        id: "wait-1",
        tool: "wait",
        receiverThreadIds: ["child"],
        agentsStates: { child: { status: "completed", message: "child final output" } },
      },
    });
    notify("item/completed", {
      threadId: root,
      item: { type: "agentMessage", id: "root-output", text: "root output" },
    });
    notify("turn/completed", { threadId: root, turn: { id: "root-turn", status: "completed" } });
    result = { turn: { id: "root-turn" } };
  }
  if (r.id !== undefined) write({ jsonrpc: "2.0", id: r.id, result });
}
