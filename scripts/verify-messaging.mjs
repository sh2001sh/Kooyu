// Real native conversation verification. Uses existing login/configuration and
// incurs model usage. Creates only isolated local sessions; never deletes native history.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { Store } from "../packages/host/dist/storage/store.js";
import { SessionService } from "../packages/host/dist/session-service.js";
import { createHostHandler } from "../packages/host/dist/http/server.js";

const harness = process.argv[2] ?? "codex";
if (!["kodo", "pi", "codex", "claude-code", "deepseek-harness"].includes(harness))
  throw new Error("Install/login and verify the other native adapters before using this probe.");
const dataDir = resolve(`.local/verification/messaging-${harness}-${Date.now()}`);
mkdirSync(dataDir, { recursive: true });
const store = new Store(join(dataDir, "state.sqlite"));
const service = new SessionService(store, { dataDir });
const server = createServer();
await new Promise((r) => server.listen(0, "127.0.0.1", r));
server.on(
  "request",
  createHostHandler(service, { port: server.address().port, webRoot: resolve("apps/web/dist") }),
);
const url = `http://127.0.0.1:${server.address().port}/api`;
const report = {
  harness,
  startedAt: new Date().toISOString(),
  result: "unverified",
  checks: {},
  limits: [],
};
async function api(path, method = "GET", body) {
  const response = await fetch(url + path, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.error.message), { code: value.error.code });
  return value;
}
async function waitFor(check, ms = 90000) {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error("Native verification deadline exceeded");
    await new Promise((r) => setTimeout(r, 25));
  }
}
function checked(name, value) {
  report.checks[name] = Boolean(value);
  assert.ok(value, name);
}
let session;
try {
  const project = await api("/projects", "POST", {
    name: "Isolated real messaging verification",
    rootPath: process.cwd(),
  });
  const workspace = store.workspaces().find((w) => w.projectId === project.id);
  session = await api("/sessions", "POST", {
    title: "Real messaging verification",
    harnessId: harness,
    kind: harness === "kodo" ? "supervisor" : "direct",
    projectId: project.id,
    workspaceId: workspace.id,
    ...(["kodo", "pi", "deepseek-harness"].includes(harness)
      ? {
          model: `${harness === "deepseek-harness" ? "deepseek-official" : (process.env.KODO_VERIFY_PROVIDER ?? "openai")}/${process.env.KODO_VERIFY_MODEL ?? "deepseek-v4-flash"}`,
        }
      : {}),
  });
  report.sessionId = session.id;
  const path = `/sessions/${session.id}`;
  const first = {
    requestId: randomUUID(),
    text: "For a bounded conversation queue test, write the integers from 1 to 250, one per line. Do not use tools, read files, or change anything.",
    mode: "new",
  };
  await api(path + "/send", "POST", first);
  checked("stableSendId", (await api(path + "/send", "POST", first)).id === first.requestId);
  await waitFor(() => {
    const c = store.command(first.requestId);
    if (["unknown", "rejected"].includes(c?.status)) throw new Error(c.error);
    return (
      store
        .events(session.id)
        .some(
          (e) =>
            e.type === "text-delta" ||
            (harness === "deepseek-harness" &&
              e.type === "state" &&
              ["turn/begin", "turn/start", "step/begin", "step/start"].includes(e.payload?.type)),
        ) && store.session(session.id).runState === "running"
    );
  });
  checked("actualNativeTurnActive", true);
  report.nativeSessionId = store.session(session.id).nativeSessionId;
  await assert.rejects(
    api(path + "/send", "POST", {
      requestId: randomUUID(),
      text: "Do not send while busy",
      mode: "new",
    }),
    { code: "CONFLICT" },
  );
  checked("busyNewRefused", true);
  await assert.rejects(api(path + `/commands/${first.requestId}`, "DELETE"), { code: "CONFLICT" });
  checked("deliveredRecallRefused", true);
  await assert.rejects(api(path, "DELETE"), { code: "CONFLICT" });
  checked("runningDeleteRefused", true);
  const token = randomUUID().slice(0, 8),
    qa = {
      requestId: randomUUID(),
      text: `Reply exactly QA_QUEUE_A_${token}. Do not use tools or change files.`,
      mode: "queue",
    },
    qb = {
      requestId: randomUUID(),
      text: `Reply exactly QA_QUEUE_B_${token}. Do not use tools or change files.`,
      mode: "queue",
    },
    qw = { requestId: randomUUID(), text: `NEVER_DELIVER_WITHDRAWN_${token}`, mode: "queue" };
  for (const q of [qa, qw, qb]) await api(path + "/send", "POST", q);
  checked(
    "queryPendingQueue",
    (await api(path + "?tail=300")).commands
      .filter((c) => [qa.requestId, qw.requestId, qb.requestId].includes(c.id))
      .every((c) => c.status === "accepted"),
  );
  checked(
    "withdrawAccepted",
    (await api(path + `/commands/${qw.requestId}`, "DELETE")).status === "cancelled",
  );
  checked(
    "withdrawIdempotent",
    (await api(path + `/commands/${qw.requestId}`, "DELETE")).status === "cancelled",
  );
  const descriptor = service.snapshot().harnesses.find((h) => h.id === harness);
  let steer;
  if (descriptor.capabilities.steer === "supported") {
    steer = {
      requestId: randomUUID(),
      text: `Also acknowledge QA_STEER_${token} before ending this turn. Do not use tools or change files.`,
      mode: "steer",
    };
    await api(path + "/send", "POST", steer);
    await waitFor(
      () => ["confirmed", "rejected", "unknown"].includes(store.command(steer.requestId)?.status),
      15000,
    );
    const c = store.command(steer.requestId);
    checked("steerNativeAcknowledged", c.status === "confirmed");
    checked("steerDeliveredBeforeQueue", store.command(qa.requestId).status === "accepted");
    const events = store.events(session.id),
      delivered = events.find((e) => e.id === `command:${steer.requestId}`);
    checked(
      "steerDuringActiveTurn",
      !events.some((e) => e.type === "turn-ended" && e.sequence < delivered.sequence),
    );
  } else {
    await assert.rejects(
      api(path + "/send", "POST", {
        requestId: randomUUID(),
        text: "Unsupported steer must not be queued",
        mode: "steer",
      }),
      { code: "UNSUPPORTED" },
    );
    checked("unsupportedSteerRefused", true);
    report.limits.push("该 harness 未提供已验证的 steer；运行中直接插话不可用。");
  }
  await waitFor(() => {
    for (const q of [first, qa, qb]) {
      const c = store.command(q.requestId);
      if (["rejected", "unknown"].includes(c?.status)) throw new Error(c.error);
    }
    return (
      [first, qa, qb].every((q) => store.command(q.requestId)?.status === "confirmed") &&
      store.session(session.id).runState === "idle"
    );
  });
  const events = store.events(session.id, 0, 1000),
    userEvents = events.filter((e) => e.type === "message" && e.payload?.role === "user");
  const deliveredIds = userEvents.map((e) => e.payload.commandId).filter(Boolean);
  checked(
    "FIFOAndNoWithdrawnDelivery",
    JSON.stringify(deliveredIds) ===
      JSON.stringify([
        first.requestId,
        ...(steer ? [steer.requestId] : []),
        qa.requestId,
        qb.requestId,
      ]),
  );
  for (const marker of [
    `QA_QUEUE_A_${token}`,
    `QA_QUEUE_B_${token}`,
    ...(steer ? [`QA_STEER_${token}`] : []),
  ])
    checked(
      `nativeReply:${marker.split(token)[0]}`,
      events.some(
        (e) =>
          e.type === "message" &&
          e.payload?.role !== "user" &&
          JSON.stringify(e.payload).includes(marker),
      ),
    );
  checked("queryConfirmedReceipt", (await api(`/commands/${qb.requestId}`)).status === "confirmed");
  checked(
    "historySearch",
    (await api(`/search?q=QA_QUEUE_B_${token}`)).hits.some((h) => h.sessionId === session.id),
  );
  if (descriptor.capabilities.historyRead === "supported") {
    const history = JSON.stringify(await api(path + "/native"));
    checked("nativeHistoryContainsQueuedInput", history.includes(`QA_QUEUE_B_${token}`));
    checked("nativeHistoryExcludesWithdrawal", !history.includes(qw.text));
  } else report.limits.push("原生历史读取不支持；使用 Host 持久事件核对递送，未伪报原生历史。");
  const deletion = await api(path, "DELETE");
  checked("localDelete", deletion.status === "deleted-locally" && deletion.nativeDeleted === false);
  checked("deleteIdempotent", (await api(path, "DELETE")).status === "deleted-locally");
  await assert.rejects(api(path + "?tail=300"), { code: "NOT_FOUND" });
  checked("deletedHistoryNotQueryable", true);
  checked(
    "deletedNotInSnapshot",
    !(await api("/snapshot")).sessions.some((s) => s.id === session.id),
  );
  checked(
    "deletedNotInSearch",
    !(await api(`/search?q=QA_QUEUE_B_${token}`)).hits.some((h) => h.sessionId === session.id),
  );
  checked(
    "receiptRetainedAfterDelete",
    (await api(`/commands/${qb.requestId}`)).status === "confirmed",
  );
  report.limits.push(
    "删除只移除 Kooyu 本地可见会话；保留原生历史、身份映射和对账记录。已发送消息不支持撤回。",
  );
  report.result = "passed";
} catch (error) {
  report.result = "failed";
  report.error = error.message;
  if (session) {
    report.commands = store
      .commands(session.id)
      .map(({ id, kind, status, error }) => ({ id, kind, status, error }));
    report.session = store.sessions().find((s) => s.id === session.id);
  }
} finally {
  await service.dispose();
  await new Promise((r) => server.close(r));
  store.close();
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(dataDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (report.result !== "passed") process.exitCode = 1;
}
