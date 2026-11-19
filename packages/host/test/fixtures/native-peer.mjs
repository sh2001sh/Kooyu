// Isolated synthetic protocol peer. No model execution and no production fallback.
import { createInterface } from "node:readline";
import { appendFileSync } from "node:fs";
import { crc32 } from "node:zlib";
import { createHash } from "node:crypto";
const uploads = new Map();
const mode = process.argv[2];
let initialized = false;
let testDshSessionId;
let config = [
  {
    id: "engine",
    category: "model",
    type: "select",
    currentValue: "model-a",
    options: [
      {
        group: "native",
        name: "Native",
        options: [
          { value: "model-a", name: "A" },
          { value: "model-b", name: "B" },
        ],
      },
    ],
  },
  {
    id: "depth",
    category: "thought_level",
    type: "select",
    currentValue: "shallow",
    options: [
      { value: "shallow", name: "Shallow" },
      { value: "native-deep", name: "Deep" },
    ],
  },
];
if (process.env.SYNTHETIC_ACP_MODES === "config")
  config.push({
    id: "run-mode",
    category: "mode",
    type: "select",
    currentValue: "ask",
    options: [
      { value: "ask", name: "Ask" },
      { value: "code", name: "Code" },
    ],
  });
const write = (value) => process.stdout.write(JSON.stringify(value) + "\n");
let zTopic = "",
  zOrdinal = 0,
  zSeq = 0,
  zNative = "";
const zControl = (phase) => ({
  phase,
  stopState: phase === "running" ? "stoppable" : "idle",
  activeWorks:
    phase === "running"
      ? [{ kind: "primaryTurn", foregroundExecutionId: "synthetic-execution" }]
      : [],
});
const zFrame = (payload, fragmented = false) => {
  const f = {
    topic: zTopic,
    subscriptionId: "sub-test",
    fromSeq: payload.kind === "snapshot" ? 0 : zSeq,
    toSeq: ++zSeq,
    sentAt: Date.now(),
    payload,
  };
  const outer = {
    wireVersion: 3,
    deliveryKind: payload.kind === "snapshot" ? "initial" : "online",
    logicalFrameId: `synthetic-${++zOrdinal}`,
    logicalFrameOrdinal: zOrdinal,
    topic: zTopic,
    subscriptionId: "sub-test",
  };
  if (!fragmented) {
    write({ method: "v4/conversation/frame", params: { ...outer, kind: "complete", frame: f } });
    return;
  }
  const bytes = Buffer.from(JSON.stringify(f)),
    mid = Math.floor(bytes.length / 2),
    parts = [bytes.subarray(0, mid), bytes.subarray(mid)];
  // Reverse physical arrival is normal: logical application waits for both.
  for (const i of [1, 0])
    write({
      method: "v4/conversation/frame",
      params: {
        ...outer,
        kind: "fragment",
        fragmentIndex: i,
        fragmentCount: 2,
        logicalBytes: bytes.length,
        checksum: { algorithm: "crc32", value: crc32(bytes).toString(16).padStart(8, "0") },
        dataBase64: parts[i].toString("base64"),
      },
    });
};
for await (const line of createInterface({ input: process.stdin })) {
  const r = JSON.parse(line);
  if (!r.method) {
    if (
      process.env.SYNTHETIC_DSH_APPROVALS &&
      typeof r.id === "string" &&
      r.id.startsWith("test-")
    ) {
      write({
        method: "test/answer",
        params: {
          sessionId: testDshSessionId,
          request: r.id.includes("approval") ? "approval/request" : "question/request",
          answer: r.result,
        },
      });
    }
    continue;
  }
  if (process.env.SYNTHETIC_WIRE_LOG)
    appendFileSync(process.env.SYNTHETIC_WIRE_LOG, JSON.stringify(r) + "\n");
  let result = {};
  if (r.method === "initialize") {
    initialized = true;
    result =
      mode === "acp"
        ? {
            protocolVersion: 1,
            agentCapabilities: {
              loadSession: true,
              ...(process.env.SYNTHETIC_ACP_IMAGE ? { promptCapabilities: { image: true } } : {}),
              ...(process.env.SYNTHETIC_ACP_RESUME
                ? { sessionCapabilities: { resume: true } }
                : {}),
            },
          }
        : mode === "dsh"
          ? { serverInfo: { name: "deepseek-harness-sdk-runtime", version: "synthetic" } }
          : { userAgent: "synthetic-protocol-peer" };
  } else if (mode === "acp" && ["session/new", "session/load", "session/resume"].includes(r.method))
    result = process.env.SYNTHETIC_ACP_CURRENT_ONLY
      ? {
          sessionId: "native-acp-test",
          models: {
            currentModelId: process.env.SYNTHETIC_ACP_CURRENT_ONLY,
            availableModels: [{ modelId: "another-native-picker-entry", name: "Another model" }],
          },
        }
      : {
          sessionId: "native-acp-test",
          configOptions: config,
          ...(process.env.SYNTHETIC_ACP_MODES === "legacy"
            ? {
                modes: {
                  currentModeId: "ask",
                  availableModes: [
                    { id: "ask", name: "Ask" },
                    { id: "code", name: "Code" },
                  ],
                },
              }
            : {}),
        };
  else if (mode === "acp" && r.method === "session/set_config_option") {
    const option = config.find((o) => o.id === r.params.configId);
    if (!option) throw new Error("synthetic unknown config option");
    option.currentValue = r.params.value;
    result = { configOptions: config };
  } else if (mode === "acp" && r.method === "session/set_mode") {
    write({
      method: "session/update",
      params: {
        sessionId: "native-acp-test",
        update: { sessionUpdate: "current_mode_update", currentModeId: r.params.modeId },
      },
    });
  } else if (mode === "acp" && r.method === "session/prompt") {
    if (process.env.SYNTHETIC_PROMPT_REJECT) {
      write({ id: r.id, error: { code: -32000, message: "synthetic API 503" } });
      continue;
    }
    if (!initialized) throw new Error("missing initialization");
    write({
      method: "session/update",
      params: {
        sessionId: "native-acp-test",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "test-tool",
          title: "synthetic tool lifecycle",
          status: "completed",
        },
      },
    });
    result = { stopReason: "end_turn" };
  } else if (mode === "codex" && r.method === "thread/start")
    result = { thread: { id: "native-codex-test" } };
  else if (mode === "codex" && r.method === "thread/read") {
    if (r.params.includeTurns && process.env.SYNTHETIC_CODEX_EMPTY_HISTORY) {
      write({ id: r.id, error: { code: -32601, message: "list_turns is not supported yet" } });
      continue;
    }
    result = { thread: { id: r.params.threadId, turns: [] } };
  } else if (mode === "codex" && r.method === "thread/list")
    result = {
      data: [{ id: r.params.cursor ? "second" : "first" }],
      nextCursor: r.params.cursor && !process.env.SYNTHETIC_CODEX_REPEAT_CURSOR ? null : "page-2",
    };
  else if (mode === "codex" && r.method === "model/list")
    result = {
      data: ["model-a", "model-b"].map((model) => ({
        model,
        displayName: model,
        supportedReasoningEfforts: [{ reasoningEffort: "native-deep" }],
        inputModalities: model === "model-a" ? ["text", "image"] : ["text"],
      })),
      nextCursor: null,
    };
  else if (mode === "codex" && r.method === "turn/start")
    result = { turn: { id: "native-turn-test" } };
  else if (mode === "zcode" && r.method === "v4/command") {
    if (r.params.type === "createSession") zNative = r.params.payload.sessionId;
    if (r.params.type === "sendText") {
      if (process.env.SYNTHETIC_SUBAGENTS)
        zFrame({
          kind: "deltas",
          deltas: [
            {
              op: "row.appended",
              row: {
                rowId: 3,
                turnId: "synthetic-turn",
                kind: "subagent",
                subagentType: "explore",
                status: "success",
                summaryText: "child summary",
                childSessionId: "child",
              },
            },
          ],
        });
      zFrame(
        {
          kind: "deltas",
          deltas: [
            { op: "state.updated", patch: { control: zControl("running") } },
            {
              op: "row.appended",
              row: {
                rowId: 2,
                turnId: "synthetic-turn",
                kind: "assistantText",
                text: "",
                state: "streaming",
              },
            },
            { op: "row.delta", rowId: 2, path: "text", append: "合约 " },
            { op: "row.delta", rowId: 2, path: "text", append: "OK" },
            {
              op: "row.upserted",
              row: {
                rowId: 2,
                turnId: "synthetic-turn",
                kind: "assistantText",
                text: "合约 OK",
                state: "complete",
              },
            },
            {
              op: "state.updated",
              patch: {
                control: zControl("completedSuccess"),
                backgroundWorks: [{ workId: "synthetic-bg", status: "running" }],
                usage: {
                  cumulative: {
                    inputTokens: 3,
                    outputTokens: 2,
                    cacheReadTokens: 1,
                    cacheWriteTokens: 0,
                  },
                },
              },
            },
          ],
        },
        true,
      );
    }
    if (r.params.type === "stop")
      zFrame({ kind: "deltas", deltas: [{ op: "state.updated", patch: { backgroundWorks: [] } }] });
    result = { status: "accepted" };
  } else if (
    mode === "zcode" &&
    r.method === "v4/conversation/subscribe" &&
    r.params.topic.startsWith("sessions-index/")
  ) {
    zTopic = r.params.topic;
    const workspaceId = zTopic.slice("sessions-index/".length);
    result = { ack: { subscriptionId: "sub-test", logEpoch: "epoch-test", mode: "snapshot" } };
    zFrame({
      kind: "snapshot",
      snapshot: {
        protocolVersion: 1,
        workspaceId: process.env.SYNTHETIC_ZCODE_FOREIGN_INDEX ? "foreign" : workspaceId,
        logEpoch: "epoch-test",
        sessions: [{ sessionId: "saved-session", workspaceId, title: "Saved native session" }],
      },
    });
  } else if (mode === "zcode" && r.method === "v4/conversation/subscribe") {
    zTopic = r.params.topic;
    zNative = zTopic.slice("conversation/".length);
    result = { ack: { subscriptionId: "sub-test", logEpoch: "epoch-test", mode: "snapshot" } };
    // A historical completed snapshot must never become a new completion wake.
    zFrame({
      kind: "snapshot",
      snapshot: {
        protocolVersion: 1,
        sessionId: zNative,
        logEpoch: "epoch-test",
        seq: zSeq + 1,
        revision: 1,
        config: {
          provider: "provider",
          model: "model-a",
          thought: "shallow",
          thoughtLevels: ["shallow", "native-deep"],
        },
        control: zControl("completedSuccess"),
        rows: {
          window: [
            {
              rowId: 1,
              turnId: "historical-turn",
              kind: "assistantText",
              text: "synthetic historical reply",
            },
          ],
          totalCount: 1,
          firstRowId: 1,
        },
        pendingCommands: [],
        pendingInteractions: [],
        backgroundWorks: [],
        queue: { items: [], autoDrain: true },
      },
    });
  } else if (mode === "zcode" && r.method === "v4/conversation/rowsRange")
    result = {
      rows: [
        {
          rowId: 2,
          kind: "assistantText",
          text: r.params.sessionId === "child" ? "child output" : "合约 OK",
        },
      ],
      hasMore: false,
      atSeq: zSeq,
      atRevision: 2,
      atLogEpoch: "epoch-test",
    };
  else if (mode === "zcode" && r.method === "v4/attachment/begin") {
    uploads.set(r.params.uploadId, { ...r.params, chunks: [] });
    result = { state: "staging", uploadId: r.params.uploadId, nextChunkIndex: 0 };
  } else if (mode === "zcode" && r.method === "v4/attachment/chunk") {
    const upload = uploads.get(r.params.uploadId);
    if (r.params.chunkIndex !== upload.chunks.length) throw new Error("Invalid chunk index");
    upload.chunks.push(Buffer.from(r.params.dataBase64, "base64"));
    result = { uploadId: r.params.uploadId, nextChunkIndex: upload.chunks.length };
  } else if (mode === "zcode" && r.method === "v4/attachment/commit") {
    const upload = uploads.get(r.params.uploadId);
    const bytes = Buffer.concat(upload.chunks);
    if (
      bytes.length !== upload.totalBytes ||
      upload.chunks.length !== upload.totalChunks ||
      `sha256:${createHash("sha256").update(bytes).digest("hex")}` !== upload.checksum
    )
      throw new Error("Invalid uploaded bytes");
    result = { ref: `attachment:${r.params.uploadId}` };
  } else if (mode === "zcode" && r.method === "v4/attachment/abort") result = {};
  else if (mode === "dsh" && r.method === "session/prompt") {
    if (process.env.SYNTHETIC_DSH_APPROVALS) {
      testDshSessionId = r.params.sessionId;
      for (const kind of ["approval", "question"])
        write({
          id: `test-${kind}-${r.id}`,
          method: `${kind}/request`,
          params: { sessionId: r.params.sessionId },
        });
      // Deliver receipt after request handlers settle, so each test can change modes between turns.
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    result = { messageId: "native-message-test" };
    if (process.env.SYNTHETIC_DSH_STATUS) {
      write({
        method: "session.event",
        params: {
          sessionId: r.params.sessionId,
          event: { seq: 1, type: "turn/end", data: { turn: 1, reason: { kind: "aborted" } } },
        },
      });
      write({
        method: "session.status",
        params: { sessionId: r.params.sessionId, status: "idle" },
      });
    }
  } else if (mode === "dsh" && r.method === "session/wait") {
    await new Promise((resolve) => setTimeout(resolve, 150));
    result = {};
  } else if (mode === "dsh" && r.method === "session/resume") result = {};
  else if (mode === "dsh" && r.method === "session/working-directory/get")
    result = { cwd: process.cwd() };
  else if (["initialized", "shutdown"].includes(r.method)) {
    /* Notification or graceful shutdown. */
  } else {
    if (r.id !== undefined)
      write({
        id: r.id,
        error: { code: -32601, message: `Unknown synthetic contract method: ${r.method}` },
      });
    continue;
  }
  if (r.method === "session/prompt" && process.env.SYNTHETIC_PROMPT_DELAY_MS)
    await new Promise((resolve) =>
      setTimeout(resolve, Number(process.env.SYNTHETIC_PROMPT_DELAY_MS)),
    );
  if (r.id !== undefined) write({ id: r.id, result });
  if (r.method === "shutdown") process.exit(0);
}
