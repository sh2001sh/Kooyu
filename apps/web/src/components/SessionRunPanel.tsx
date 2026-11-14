import type { Command, RuntimeEvent, Session, SubagentEvent } from "@kodo/protocol";
import { TurnTimeline } from "./SessionInsights";
import { formatDate } from "../lib/harnesses";

export function SessionRunPanel({
  session,
  events,
  commands,
}: {
  session: Session;
  events: RuntimeEvent[];
  commands: Command[];
}) {
  const agents = new Map<string, SubagentEvent>();
  let tasks: { content: string; status: string }[] = [];
  for (const event of events) {
    const p = event.payload as Record<string, any>;
    if (event.type === "subagent" && typeof p?.agentId === "string")
      agents.set(p.agentId, { ...agents.get(p.agentId), ...p, agentId: p.agentId });
    if (event.type === "tool" && p?.name === "TodoWrite" && Array.isArray(p.input?.todos))
      tasks = p.input.todos
        .filter((task: any) => typeof task?.content === "string")
        .map((task: any) => ({ content: task.content, status: String(task.status ?? "pending") }));
  }
  const queued = commands.filter((command) =>
    ["accepted", "queued", "dispatched", "unknown"].includes(command.status),
  );
  const status: Record<string, string> = {
    completed: "已完成",
    running: "运行中",
    in_progress: "进行中",
    pending: "待处理",
    failed: "失败",
    cancelled: "已取消",
    stopped: "已停止",
    shutdown: "已停止",
    accepted: "已接收",
    queued: "排队中",
    dispatched: "已发送",
    unknown: "结果待确认",
  };
  return (
    <div className="detail-stack">
      <section className="run-panel-section">
        <h3>任务与后台执行</h3>
        {!tasks.length && !agents.size && !queued.length && (
          <p className="workspace-browser__note">
            暂无原生任务或子代理记录。运行过程见下方时间线。
          </p>
        )}
        {tasks.map((task, i) => (
          <div className="run-panel-row" key={i}>
            <span>{task.content}</span>
            <small>{status[task.status] ?? task.status}</small>
          </div>
        ))}
        {[...agents.values()].map((agent) => (
          <div className="run-panel-row" key={agent.agentId}>
            <span title={agent.agentId}>{agent.name || agent.agentId}</span>
            <small>{status[agent.status ?? ""] ?? agent.status ?? "状态未知"}</small>
          </div>
        ))}
        {queued.map((command) => (
          <div className="run-panel-row" key={command.id}>
            <span>{command.kind === "send" ? "消息" : command.kind}</span>
            <small>{status[command.status] ?? command.status}</small>
          </div>
        ))}
      </section>
      <TurnTimeline events={events} running={session.runState === "running"} />
      <details className="raw-events">
        <summary>原始事件与命令</summary>
        <div className="ios-inset-group">
          {events
            .filter((e) => !["text-delta", "message", "tool"].includes(e.type))
            .slice(-200)
            .map((event) => (
              <details className="timeline-event" key={event.sequence}>
                <summary>
                  <span>{event.type}</span>
                  <time>{formatDate(event.createdAt)}</time>
                </summary>
                <pre>{JSON.stringify(event.payload, null, 2)}</pre>
              </details>
            ))}
          {commands.slice(-100).map((command) => (
            <details className="timeline-event" key={command.id}>
              <summary>
                <span>
                  {command.kind} · {command.status}
                </span>
                <time>{formatDate(command.createdAt)}</time>
              </summary>
              <pre>{JSON.stringify(command, null, 2)}</pre>
            </details>
          ))}
        </div>
      </details>
    </div>
  );
}
