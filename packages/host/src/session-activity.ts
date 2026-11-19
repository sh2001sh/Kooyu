import {
  KodoError,
  type AgentSummary,
  type RuntimeEvent,
  type SessionActivity,
} from "@kodo/protocol";
import type { Store } from "./storage/store.js";
import { acceptTodos, type TodoState } from "./harnesses/todos.js";
import type { Wire } from "./harnesses/adapter.js";

interface Projection {
  schemaVersion: 2;
  cursor: number;
  root: TodoState;
  agents: Record<string, AgentSummary & { tasks: TodoState }>;
}

/** Durable, incremental projection independent of the parent's bounded transcript window. */
export function sessionActivity(store: Store, sessionId: string): SessionActivity {
  store.session(sessionId);
  if (store.record("deleted-session", sessionId)) throw new KodoError("NOT_FOUND", "会话已删除。");
  return store.transaction(() => {
    const prior = store.record<Projection>("session-activity", sessionId);
    const saved = prior?.schemaVersion === 2 ? prior : undefined;
    const state: Projection = saved ?? {
      schemaVersion: 2,
      cursor: 0,
      root: { calls: {} },
      agents: {},
    };
    const previousCursor = state.cursor;
    for (;;) {
      const events = store.events(sessionId, state.cursor, 1000);
      for (const event of events) {
        state.cursor = event.sequence;
        const p = (event.payload ?? {}) as Wire;
        if (event.type !== "subagent") {
          acceptTodos(state.root, event.type, p, event.createdAt);
          continue;
        }
        if (
          typeof p.agentId !== "string" ||
          !p.agentId ||
          ["__proto__", "constructor", "prototype"].includes(p.agentId)
        )
          continue;
        const child = state.agents[p.agentId] ?? {
          agentId: p.agentId,
          updatedAt: event.createdAt,
          tasks: { calls: {} },
        };
        for (const field of ["name", "parentAgentId", "status"] as const)
          if (typeof p[field] === "string") child[field] = p[field];
        child.updatedAt = event.createdAt;
        if (p.event) {
          const inner = p.event.payload ?? {};
          if (["turn-ended", "settled"].includes(p.event.type) && typeof inner.outcome === "string")
            child.status = inner.outcome;
          if (p.event.type === "state" && typeof inner.runState === "string")
            child.status = inner.runState;
          if (p.event.type === "error") child.status = "failed";
          if (
            p.event.type === "tool" &&
            inner.type === "tool_result" &&
            [inner.tool_use_id, inner.toolCallId].some(
              (id) => typeof id === "string" && (id === p.agentId || id === p.toolCallId),
            )
          )
            child.status = inner.is_error ? "failed" : "completed";
          acceptTodos(child.tasks, p.event.type, inner, event.createdAt);
        }
        state.agents[p.agentId] = child;
      }
      if (events.length < 1000) break;
    }
    if (!saved || state.cursor !== previousCursor) store.put("session-activity", sessionId, state);
    return {
      sessionId,
      cursor: state.cursor,
      todos: state.root.list,
      agents: Object.values(state.agents).map(({ tasks, ...agent }) => ({
        ...agent,
        todos: tasks.list,
      })),
    };
  });
}

export function agentTranscript(store: Store, sessionId: string, agentId: string, before?: number) {
  const activity = sessionActivity(store, sessionId);
  const agent = activity.agents.find((item) => item.agentId === agentId);
  if (!agent) throw new KodoError("NOT_FOUND", "此会话没有该子代理。");
  const rows = store.db
    .prepare(
      `SELECT sequence,data FROM events WHERE session_id=?
    AND json_extract(data,'$.type')='subagent' AND json_extract(data,'$.payload.agentId')=?
    AND json_type(data,'$.payload.event.type')='text'
    ${before === undefined ? "" : "AND sequence<?"}
    ORDER BY sequence DESC LIMIT 301`,
    )
    .all(sessionId, agentId, ...(before === undefined ? [] : [before]));
  const events = rows
    .slice(0, 300)
    .reverse()
    .map((row) => {
      const event = JSON.parse(String(row.data)) as RuntimeEvent;
      const inner = (event.payload as Wire).event;
      return {
        ...event,
        sequence: Number(row.sequence),
        type: inner.type,
        payload:
          inner.type === "tool" && inner.payload?.type === "tool_result"
            ? {
                ...inner.payload,
                toolCallId: inner.payload.toolCallId ?? inner.payload.tool_use_id,
                status: inner.payload.is_error ? "failed" : "completed",
              }
            : inner.payload,
      } as RuntimeEvent;
    });
  return { agent, events, olderCursor: rows.length > 300 ? events[0]!.sequence : null };
}
