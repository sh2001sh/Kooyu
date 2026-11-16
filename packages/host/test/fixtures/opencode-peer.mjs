// Isolated synthetic OpenCode V1 peer. This is contract testing, not a harness.
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";
const port = Number(process.argv[process.argv.indexOf("--port") + 1]),
  sessionID = "synthetic-opencode-session";
let stream;
let permission = [];
const recoveredQuestion = {
  id: "question-1",
  sessionID,
  questions: [
    {
      question: "Recovered?",
      header: "Recover",
      options: [{ label: "Yes", description: "continue" }],
    },
  ],
};
const recoveredPermission = {
  id: "permission-1",
  sessionID,
  permission: "read",
  patterns: ["marker.txt"],
  metadata: {},
  always: [],
};
const emit = (type, properties) =>
  stream?.write(`data: ${JSON.stringify({ type, properties })}\n\n`);
createServer(async (req, res) => {
  const path = req.url,
    method = req.method;
  let body = "";
  for await (const chunk of req) body += chunk;
  const data = body ? JSON.parse(body) : null;
  if (process.env.SYNTHETIC_WIRE_LOG)
    appendFileSync(process.env.SYNTHETIC_WIRE_LOG, JSON.stringify({ path, method, data }) + "\n");
  const json = (value) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(value));
  };
  if (path === "/provider")
    return json({
      all: [
        {
          id: "provider",
          models: {
            "model-a": {
              variants: { "native-deep": {} },
              capabilities: { input: { text: true, image: true } },
            },
            "model-b": { variants: { "native-deep": {} }, modalities: { input: ["text"] } },
          },
        },
      ],
      connected: ["provider"],
    });
  if (path === "/global/health") return json({ healthy: true, version: "isolated-test" });
  if (path === "/config") return json({ model: "provider/model-a" });
  if (path === "/permission" || path === "/question") {
    if (!process.env.SYNTHETIC_OPENCODE_RECOVER) return json([]);
    const item = path === "/permission" ? recoveredPermission : recoveredQuestion;
    emit(path === "/permission" ? "permission.asked" : "question.asked", item);
    emit(path === "/permission" ? "permission.asked" : "question.asked", item);
    return json([item, { ...item, id: "foreign", sessionID: "different-session" }]);
  }
  if (path === "/session" && method === "POST") return json({ id: sessionID, permission });
  if (path === `/session/${sessionID}` && method === "PATCH") {
    if (!process.env.SYNTHETIC_OPENCODE_IGNORE_PERMISSION) permission = data.permission;
    return json({ id: sessionID, permission });
  }
  if (path === `/session/${sessionID}` && method === "GET")
    return json({ id: sessionID, permission });
  if (path === "/event") {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(": synthetic contract\n\n");
    stream = res;
    return;
  }
  if (path === `/session/${sessionID}/prompt_async` && method === "POST") {
    if (!["text", "file"].includes(data.parts?.[0]?.type))
      throw new Error("V1 prompt parts required");
    res.writeHead(204);
    res.end();
    if (process.env.SYNTHETIC_SUBAGENTS) {
      emit("session.created", { info: { id: "child", parentID: sessionID, title: "Child" } });
      emit("session.created", { info: { id: "foreign", parentID: "unrelated" } });
      for (const id of ["child", "foreign"]) {
        emit("message.updated", { info: { id: "same-message", sessionID: id, role: "assistant" } });
        emit("message.part.updated", {
          part: {
            id: "same-part",
            messageID: "same-message",
            sessionID: id,
            type: "text",
            text: id + " output",
          },
        });
        emit("session.idle", { sessionID: id });
      }
    }
    if (process.env.SYNTHETIC_OPENCODE_INTERACTION) {
      emit("question.asked", {
        id: "question-1",
        sessionID,
        questions: [
          { header: "Choice", question: "Choose", options: [{ label: "A", description: "first" }] },
        ],
      });
      return;
    }
    if (process.env.SYNTHETIC_SSE_SPLIT) {
      emit("message.updated", { info: { id: "assistant-1", sessionID, role: "assistant" } });
      stream.write(
        "data: " +
          JSON.stringify({
            type: "message.part.delta",
            properties: {
              sessionID,
              messageID: "assistant-1",
              partID: "text-1",
              field: "text",
              delta: "split CRLF",
            },
          }) +
          "\r",
      );
      setTimeout(() => stream.end("\n\r\n"), 15);
      return;
    }
    emit("message.updated", { info: { id: "assistant-1", sessionID, role: "assistant" } });
    emit("message.part.updated", {
      part: {
        id: "tool-1",
        sessionID,
        messageID: "assistant-1",
        type: "tool",
        tool: "synthetic-contract",
        state: { status: "completed" },
      },
    });
    emit("message.updated", {
      info: {
        id: "assistant-1",
        sessionID,
        role: "assistant",
        tokens: { input: 5, output: 2, cache: { read: 0, write: 0 } },
        cost: 0.001,
      },
    });
    emit("session.idle", { sessionID });
    return;
  }
  if (path === `/session/${sessionID}/abort` && method === "POST") return json(true);
  if (path === `/session/${sessionID}/message`) return json([]);
  if (path === `/session/${sessionID}/children`)
    return json(
      process.env.SYNTHETIC_RECOVER_CHILDREN
        ? [{ id: "child", parentID: sessionID, title: "Saved child" }]
        : [],
    );
  if (process.env.SYNTHETIC_RECOVER_CHILDREN) {
    if (path === "/session/child/children")
      return json([{ id: "grandchild", parentID: "child", title: "Saved grandchild" }]);
    if (path === "/session/grandchild/children") return json([]);
    for (const id of ["child", "grandchild"])
      if (path === `/session/${id}/message`)
        return json([
          {
            info: {
              id: id + "-message",
              sessionID: id,
              role: "assistant",
              tokens: { input: 500, output: 500 },
              cost: 9,
            },
            parts: [
              {
                id: id + "-thought",
                messageID: id + "-message",
                sessionID: id,
                type: "reasoning",
                text: id + " saved reasoning",
              },
              {
                id: id + "-part",
                messageID: id + "-message",
                sessionID: id,
                type: "text",
                text: id + " saved output",
              },
            ],
          },
        ]);
  }
  if (path === "/session") {
    if (process.env.SYNTHETIC_OPENCODE_RESOLVE) {
      emit("permission.replied", { sessionID, requestID: "permission-1", reply: "reject" });
      emit("question.replied", { sessionID, requestID: "question-1", answers: [["Yes"]] });
      emit("permission.asked", recoveredPermission);
      emit("question.asked", recoveredQuestion);
    }
    return json([{ id: sessionID }]);
  }
  if (path === "/permission/permission-1/reply") return json(true);
  if (path === "/question/question-1/reject" || path === "/question/question-1/reply") {
    emit("session.idle", { sessionID });
    return json(true);
  }
  res.writeHead(404);
  res.end();
}).listen(port, "127.0.0.1");
