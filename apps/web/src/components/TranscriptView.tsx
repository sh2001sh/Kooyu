import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertTriangle,
  Brain,
  ChevronRight,
  Wrench,
  Pencil,
  MoreHorizontal,
  GitBranch,
} from "lucide-react";
import type { HarnessId, MessageAttachment, RuntimeEvent, SubagentEvent } from "@kodo/protocol";
import { assistantContent, isThinkingChannel, splitAssistantText } from "@kodo/protocol/client";
import { useContext, useState } from "react";
import { FilePreviewContext } from "../lib/file-preview-context";
import { workspaceLinkPath } from "../lib/workspace-files";
import { HARNESS_NAMES } from "../lib/harnesses";
import { HarnessBadge } from "./KodoBrand";
import { CopyButton } from "./Motion";
import { failureText, messageText } from "./TurnCard";
import { useAppPreferences } from "../lib/preferences";
import { SentAttachments } from "./Attachments";

type Value = Record<string, any>;

interface TranscriptRow {
  id: string;
  eventIds: string[];
  role: "user" | "assistant" | "tool" | "thinking" | "error" | string;
  text: string;
  payload?: unknown;
  origin?: string;
  attachments?: MessageAttachment[];
  createdAt?: string;
}

interface ChildTranscript {
  agentId: string;
  name?: string;
  parentAgentId?: string;
  status?: string;
  events: RuntimeEvent[];
}

function SubagentOutput({ child, harnessId }: { child: ChildTranscript; harnessId: HarnessId }) {
  const [open, setOpen] = useState(false);
  const labels: Record<string, string> = {
    running: "进行中",
    busy: "进行中",
    pendingInit: "启动中",
    completed: "完成",
    idle: "空闲",
    failed: "失败",
    errored: "失败",
    cancelled: "已取消",
    stopped: "已停止",
    shutdown: "已停止",
  };
  const status = labels[child.status ?? ""] ?? child.status ?? "状态未知";
  const output = buildTranscriptRows(child.events)
    .rows.map((row) => (row.role === "tool" ? toolOutput(row.payload as Value) : row.text))
    .filter(Boolean)
    .join("\n");
  return (
    <details
      className="subagent-output"
      data-agent-id={child.agentId}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        <ChevronRight size={14} className="tool-card__chevron" aria-hidden="true" />
        <span className="subagent-output__label">子代理 · {child.name || child.agentId}</span>
        <span className={`tool-card__status ${statusClass(status)}`}>{status}</span>
      </summary>
      {open && (
        <div className="subagent-output__body">
          <div className="subagent-output__meta">
            <code>{child.agentId}</code>
            <CopyButton text={output} label="复制子代理输出" />
          </div>
          {child.parentAgentId && <small>父代理：{child.parentAgentId}</small>}
          {output ? (
            <Transcript
              events={child.events}
              harnessId={harnessId}
              running={status === "进行中"}
              subagent
            />
          ) : (
            <p className="subagent-output__empty">尚未收到原生子代理输出；当前仅有状态通知。</p>
          )}
        </div>
      )}
    </details>
  );
}

/** Drop the shell wrapper Codex adds on Windows so the command itself is visible. */
function bareCommand(value: unknown): string {
  let text = String(value ?? "").trim();
  const wrapped = /powershell\.exe"?\s+-Command\s+(.*)$/is.exec(text);
  if (wrapped) text = wrapped[1]!.trim();
  if (text.length > 1 && text.startsWith("'") && text.endsWith("'")) text = text.slice(1, -1);
  return text;
}

/** A readable one-line description of a native tool call. */
export function toolSummary(p: Value): { title: string; detail: string; status?: string } {
  const failed =
    p.status === "failed" ||
    p.is_error === true ||
    p.isError === true ||
    (typeof p.exitCode === "number" && p.exitCode !== 0);
  const done =
    p.status === "completed" || p.lifecycle === "completed" || typeof p.exitCode === "number";
  const status = failed ? "失败" : done ? "完成" : p.lifecycle === "started" ? "进行中" : undefined;
  if (p.type === "commandExecution")
    return { title: "运行命令", detail: bareCommand(p.command), status };
  if (p.type === "fileChange")
    return {
      title: "修改文件",
      detail: (p.changes ?? []).map((c: Value) => c.path).join(", "),
      status,
    };
  if (p.type === "mcpToolCall") return { title: `${p.server}.${p.tool}`, detail: "", status };
  if (p.type === "webSearch") return { title: "网页搜索", detail: p.query ?? "", status };
  if (p.type === "tool_use") {
    const input = p.input ?? {};
    return {
      title: p.name ?? "工具",
      detail: String(
        input.command ??
          input.file_path ??
          input.path ??
          input.pattern ??
          input.url ??
          input.description ??
          "",
      ),
      status,
    };
  }
  if (p.role === "toolResult") return { title: `${p.toolName ?? "工具"} 结果`, detail: "", status };
  if (Array.isArray(p.content) && p.content.some((c: Value) => c?.type === "tool_result"))
    return { title: "工具结果", detail: "", status };
  const name = p.title ?? p.toolName ?? p.name ?? p.tool ?? p.type ?? "工具调用";
  const input = p.input ?? p.rawInput ?? p.args ?? p.arguments ?? p.state?.input ?? {};
  return {
    title: String(name),
    detail:
      input && typeof input === "object"
        ? String(input.command ?? input.path ?? input.filePath ?? "")
        : "",
    status,
  };
}

function toolOutput(p: Value): string {
  if (typeof p.aggregatedOutput === "string" && p.aggregatedOutput) return p.aggregatedOutput;
  if (typeof p.state?.output === "string") return p.state.output;
  if (Array.isArray(p.content)) {
    const text = p.content
      .map((c: Value) =>
        typeof c?.text === "string"
          ? c.text
          : typeof c?.content === "string"
            ? c.content
            : typeof c?.content?.text === "string"
              ? c.content.text
              : Array.isArray(c?.content)
                ? c.content.map((x: Value) => x?.text ?? "").join("\n")
                : "",
      )
      .filter(Boolean)
      .join("\n");
    if (text) return text;
  }
  if (typeof p.rawOutput === "string") return p.rawOutput;
  return JSON.stringify(p, null, 2);
}

function statusClass(status?: string): string {
  if (status === "失败") return "is-failed";
  if (status === "进行中") return "is-running";
  if (status === "完成") return "is-done";
  return "";
}

function ToolCall({ row }: { row: TranscriptRow }) {
  const p = row.payload as Value;
  const { title, detail, status } = toolSummary(p);
  const output = toolOutput(p);
  const tone = statusClass(status);
  return (
    <details className={`tool-card ${tone}`}>
      <summary>
        <span className={`tool-card__icon ${tone}`} aria-hidden="true">
          <Wrench size={12} />
        </span>
        <span className="tool-card__title">{title}</span>
        {detail && <code className="tool-card__detail">{detail}</code>}
        {status && <span className={`tool-card__status ${tone}`}>{status}</span>}
        <ChevronRight size={14} className="tool-card__chevron" aria-hidden="true" />
      </summary>
      <div className="tool-card__body">
        <div className="tool-card__actions">
          <CopyButton text={output} label="复制输出" />
        </div>
        <pre>{output.length > 20000 ? `${output.slice(0, 20000)}\n…（已截断）` : output}</pre>
      </div>
    </details>
  );
}

function ToolGroup({ rows, collapse }: { rows: TranscriptRow[]; collapse: boolean }) {
  if (rows.length === 1 || !collapse)
    return (
      <>
        {rows.map((r) => (
          <ToolCall key={r.id} row={r} />
        ))}
      </>
    );
  const summaries = rows.map((r) => toolSummary(r.payload as Value));
  const failed = summaries.filter((s) => s.status === "失败").length;
  const active = summaries.filter((s) => s.status === "进行中").length;
  const names = [...new Set(summaries.map((s) => s.title))];
  const groupTone = failed > 0 ? "is-failed" : active > 0 ? "is-running" : "is-done";
  return (
    <details className={`tool-group ${groupTone}`}>
      <summary>
        <span className={`tool-card__icon ${groupTone}`} aria-hidden="true">
          <Wrench size={12} />
        </span>
        <span className="tool-group__title">{rows.length} 次工具调用</span>
        <span className="tool-group__chips">
          {names.slice(0, 3).map((name) => (
            <span key={name} className="tool-group__chip">
              {name}
            </span>
          ))}
          {names.length > 3 && <span className="tool-group__chip">+{names.length - 3}</span>}
        </span>
        {active > 0 && <span className="tool-card__status is-running">{active} 进行中</span>}
        {failed > 0 && <span className="tool-card__status is-failed">{failed} 失败</span>}
        <ChevronRight size={14} className="tool-card__chevron" aria-hidden="true" />
      </summary>
      <div className="tool-group__list">
        {rows.map((r) => (
          <ToolCall key={r.id} row={r} />
        ))}
      </div>
    </details>
  );
}

function Thinking({ text, live, expand }: { text: string; live: boolean; expand: boolean }) {
  return (
    <details
      className={`thinking-block ${live ? "is-live" : ""}`}
      open={(live && expand) || undefined}
    >
      <summary>
        <span className="thinking-block__icon" aria-hidden="true">
          <Brain size={13} />
        </span>
        <span>{live ? "正在思考…" : "思考过程"}</span>
        <ChevronRight size={14} className="tool-card__chevron" aria-hidden="true" />
      </summary>
      <div className="thinking-block__body">{text}</div>
    </details>
  );
}

function FileLink({ href, children }: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const open = useContext(FilePreviewContext);
  const path = workspaceLinkPath(href);
  return open && path ? (
    <button type="button" className="file-preview-link" onClick={() => open(path)}>
      {children}
    </button>
  ) : (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}
function FileImage({ src, alt }: { src?: string | Blob; alt?: string }) {
  const open = useContext(FilePreviewContext);
  const path = typeof src === "string" ? workspaceLinkPath(src) : null;
  return open && path ? (
    <button type="button" className="file-preview-link" onClick={() => open(path)}>
      查看图片：{alt || path}
    </button>
  ) : (
    <img src={typeof src === "string" ? src : undefined} alt={alt ?? ""} />
  );
}
const markdownLinks = { a: FileLink, img: FileImage };
const transformFileUrl = (url: string) => (workspaceLinkPath(url) ? url : defaultUrlTransform(url));

function MessageRow({
  row,
  harnessId,
  anchorEventId,
  continuation = false,
  subagent = false,
  onEdit,
  onBranch,
}: {
  row: TranscriptRow;
  harnessId: HarnessId;
  anchorEventId?: string;
  continuation?: boolean;
  subagent?: boolean;
  onEdit?: (eventId: string, text: string) => void;
  onBranch?: (eventId: string) => void;
}) {
  const hit = row.eventIds.includes(anchorEventId ?? "") || undefined;
  if (row.role === "error")
    return (
      <div className="turn turn-error" role="alert" id={`message-${row.id}`}>
        <AlertTriangle size={14} aria-hidden="true" />
        <div className="turn-error__body">
          <strong>{subagent ? "子代理本轮失败" : `${HARNESS_NAMES[harnessId]} 本轮失败`}</strong>
          <span>{row.text}</span>
          {typeof (row.payload as Value)?.error?.detail === "string" && (
            <details>
              <summary>详细信息</summary>
              <pre>{(row.payload as Value).error.detail}</pre>
            </details>
          )}
        </div>
      </div>
    );
  if (row.role === "user")
    return (
      <article
        className="turn user-turn"
        data-search-hit={hit}
        data-nav-user=""
        data-nav-label={row.text.replace(/\s+/g, " ").slice(0, 80)}
        id={`message-${row.id}`}
      >
        {row.origin && <div className="turn-author">{row.origin}</div>}
        {row.attachments && <SentAttachments attachments={row.attachments} />}
        <div className="markdown">
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={markdownLinks}
            urlTransform={transformFileUrl}
          >
            {row.text}
          </Markdown>
        </div>
        <div className="message-actions">
          {row.createdAt && (
            <time dateTime={row.createdAt}>
              {new Date(row.createdAt).toLocaleString(undefined, {
                weekday: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
          )}
          <CopyButton text={row.text} label="复制消息" />
          {!subagent && onEdit && (
            <button
              type="button"
              className="ios-copy-btn"
              aria-label="编辑消息"
              title="编辑并分支"
              onClick={() => onEdit(row.eventIds[0]!, row.text)}
            >
              <Pencil size={14} />
            </button>
          )}
        </div>
      </article>
    );
  return (
    <article
      className={`turn assistant-turn ${continuation ? "is-cont" : ""}`}
      data-search-hit={hit}
      id={`message-${row.id}`}
    >
      {continuation ? (
        <div className="assistant-turn__float-tools">
          <CopyButton text={row.text} label="复制" />
        </div>
      ) : (
        <div className="assistant-turn__header">
          <HarnessBadge harnessId={harnessId} size="xs" shape="circle" />
          <span className="turn-author">{HARNESS_NAMES[harnessId]}</span>
          <div className="assistant-turn__tools">
            <CopyButton text={row.text} label="复制" />
          </div>
        </div>
      )}
      <div className="markdown">
        <Markdown
          remarkPlugins={[remarkGfm]}
          components={markdownLinks}
          urlTransform={transformFileUrl}
        >
          {row.text}
        </Markdown>
      </div>
      <div className="message-actions">
        {row.createdAt && (
          <time dateTime={row.createdAt}>
            {new Date(row.createdAt).toLocaleString(undefined, {
              weekday: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </time>
        )}
        {!subagent && onBranch && row.createdAt && (
          <details className="message-more">
            <summary aria-label="更多消息操作">
              <MoreHorizontal size={16} />
            </summary>
            <button type="button" onClick={() => onBranch(row.eventIds[0]!)}>
              <GitBranch size={14} />
              分支到新聊天
            </button>
          </details>
        )}
      </div>
    </article>
  );
}

function buildTranscriptRows(events: RuntimeEvent[]) {
  const rows: TranscriptRow[] = [];
  const children = new Map<string, ChildTranscript>();
  let stream = "";
  let streamKey = "";
  let streamIds: string[] = [];
  let thought = "";
  let thoughtKey = "";
  let thoughtItem: unknown;

  const flushThought = () => {
    if (thought.trim()) {
      const id = thoughtItem === undefined ? thoughtKey : `thought:${thoughtItem}`;
      const row = { id, eventIds: [], role: "thinking", text: thought.trim() };
      const index = rows.findIndex((r) => r.id === id);
      if (index < 0) rows.push(row);
      else rows[index] = row;
    }
    thought = "";
    thoughtItem = undefined;
  };
  const flush = () => {
    flushThought();
    if (stream) {
      const parts = splitAssistantText(stream);
      if (parts.thinking.trim())
        rows.push({
          id: `${streamKey}:analysis`,
          eventIds: streamIds,
          role: "thinking",
          text: parts.thinking,
        });
      if (parts.text)
        rows.push({ id: streamKey, eventIds: streamIds, role: "assistant", text: parts.text });
      stream = "";
      streamIds = [];
    }
  };

  for (const e of events) {
    const p = (e.payload ?? {}) as Value;
    if (e.type === "subagent") {
      const update = p as SubagentEvent;
      if (typeof update.agentId !== "string" || !update.agentId) continue;
      let child = children.get(update.agentId);
      if (!child) {
        flush();
        child = { agentId: update.agentId, events: [] };
        children.set(update.agentId, child);
        rows.push({
          id: `subagent:${update.agentId}`,
          eventIds: [e.id],
          role: "subagent",
          text: "",
          payload: child,
        });
      }
      if (update.name) child.name = update.name;
      if (update.parentAgentId) child.parentAgentId = update.parentAgentId;
      if (update.status) child.status = update.status;
      if (update.event && update.event.type !== ("subagent" as string)) {
        const value = (update.event.payload ?? {}) as Value;
        if (update.event.type === "turn-ended") child.status = value.outcome ?? child.status;
        else if (update.event.type === "state" && value.runState) child.status = value.runState;
        child.events.push({ ...e, type: update.event.type, payload: update.event.payload });
      }
    } else if (e.type === "text-delta" && isThinkingChannel(p.channel)) {
      // A new reasoning item starts a separate block.
      if (thought && p.itemId !== undefined && p.itemId !== thoughtItem) flushThought();
      if (!thought) thoughtKey = `thought:${e.id}`;
      thoughtItem = p.itemId;
      thought += typeof p.text === "string" ? p.text : "";
    } else if (e.type === "text-delta") {
      flushThought();
      if (!stream) streamKey = e.id;
      stream += typeof p.text === "string" ? p.text : "";
      streamIds.push(e.id);
    } else if (e.type === "message") {
      const parts =
        p.role === "user" ? { text: messageText(p), thinking: "" } : assistantContent(p);
      const text = parts.text;
      const attachments =
        p.role === "user" && Array.isArray(p.attachments)
          ? (p.attachments as MessageAttachment[])
          : undefined;
      if (parts.thinking) {
        // A stored reasoning part is a full snapshot; replace its streamed prefix.
        const priorThought = rows.at(-1);
        const replacesStreamedThought =
          p.id === undefined &&
          !thought &&
          priorThought?.role === "thinking" &&
          parts.thinking.trim().startsWith(priorThought.text.trim());
        if (thought && p.id !== undefined && p.id !== thoughtItem) flushThought();
        thoughtItem = replacesStreamedThought ? undefined : (p.id ?? thoughtItem ?? e.id);
        thoughtKey = replacesStreamedThought ? priorThought.id : `thought:${thoughtItem}`;
        thought = parts.thinking;
      }
      if (!text && !attachments?.length) {
        // A final reasoning-only snapshot must also replace its streamed wrapper.
        if (parts.thinking && !isThinkingChannel(p.channel) && !isThinkingChannel(p.type)) {
          stream = "";
          streamIds = [];
        }
        continue;
      }
      const role = p.role ?? "assistant";
      flushThought();
      if (role === "user") flush();
      else {
        stream = "";
        streamIds = [];
      }
      const id = p.id ? `message:${p.id}` : e.id;
      const row: TranscriptRow = {
        id,
        eventIds: [e.id],
        role,
        text,
        createdAt: e.createdAt,
        ...(attachments?.length ? { attachments } : {}),
        origin:
          p.origin === "supervisor"
            ? "由主对话发送"
            : p.origin === "wake"
              ? "持久事件唤醒"
              : undefined,
      };
      const index = rows.findIndex((r) => r.id === id);
      if (index < 0) rows.push(row);
      else rows[index] = { ...row, eventIds: [...rows[index]!.eventIds, e.id] };
    } else if (e.type === "tool") {
      // Older event logs may contain non-tool app-server items.
      if (["userMessage", "reasoning"].includes(p.type)) continue;
      flush();
      const key = p.toolCallId ?? p.id ?? p.part?.id;
      const id = key ? `tool:${key}` : e.id;
      const row: TranscriptRow = { id, eventIds: [e.id], role: "tool", text: "", payload: p };
      const index = rows.findIndex((r) => r.id === id);
      if (index < 0) rows.push(row);
      else
        rows[index] = {
          ...row,
          payload: { ...(rows[index]!.payload as Value), ...p },
          eventIds: [...rows[index]!.eventIds, e.id],
        };
    } else if (e.type === "turn-ended" || e.type === "settled") {
      flush();
      const message = failureText(p);
      const reasoned = e.type === "turn-ended" || p.error || p.message;
      if (message && reasoned && !rows.some((r) => r.role === "error" && r.text === message))
        rows.push({ id: e.id, eventIds: [e.id], role: "error", text: message, payload: p });
    } else if (e.type === "state" && (p.message || p.error)) {
      flush();
      const message = typeof p.message === "string" ? p.message : String(p.error ?? "");
      if (message && !rows.some((r) => r.role === "error" && r.text === message))
        rows.push({
          id: e.id,
          eventIds: [e.id],
          role: "error",
          text: message,
          payload: p,
        });
    } else if (e.type === "error" || e.type === "disconnected") {
      flush();
      const message = typeof p.message === "string" ? p.message : "";
      if (message && rows.at(-1)?.text !== message)
        rows.push({
          id: e.id,
          eventIds: [e.id],
          role: "error",
          text: e.type === "disconnected" ? `原生连接已断开：${message}` : message,
          payload: p,
        });
    }
  }
  const thinkingPending =
    (Boolean(thought.trim()) && !stream) ||
    (Boolean(splitAssistantText(stream).thinking.trim()) && !splitAssistantText(stream).text);
  flush();
  return { rows, thinkingPending };
}

export function Transcript({
  events,
  harnessId = "kodo",
  anchorEventId,
  running = false,
  subagent = false,
  onOpenFile,
  onEdit,
  onBranch,
}: {
  events: RuntimeEvent[];
  harnessId?: HarnessId;
  anchorEventId?: string;
  running?: boolean;
  subagent?: boolean;
  onOpenFile?: (path: string) => void;
  onEdit?: (eventId: string, text: string) => void;
  onBranch?: (eventId: string) => void;
}) {
  const inheritedOpenFile = useContext(FilePreviewContext);
  const { settings: preferences } = useAppPreferences();
  const { rows, thinkingPending } = buildTranscriptRows(events);
  const thinkingNow = running && thinkingPending;

  // Consecutive tool calls collapse into one group so the answer stays readable.
  const blocks: (TranscriptRow | TranscriptRow[])[] = [];
  for (const row of rows) {
    const last = blocks.at(-1);
    if (row.role === "tool" && Array.isArray(last)) last.push(row);
    else blocks.push(row.role === "tool" ? [row] : row);
  }

  let seenAgentInTurn = false;
  return (
    <FilePreviewContext.Provider value={onOpenFile ?? inheritedOpenFile}>
      {blocks.map((block, index) => {
        if (Array.isArray(block)) {
          return <ToolGroup key={block[0]!.id} rows={block} collapse={preferences.collapseTools} />;
        }
        if (block.role === "thinking") {
          return (
            <Thinking
              key={block.id}
              text={block.text}
              live={thinkingNow && index === blocks.length - 1}
              expand={preferences.expandThinking}
            />
          );
        }
        if (block.role === "subagent")
          return (
            <SubagentOutput
              key={block.id}
              child={block.payload as ChildTranscript}
              harnessId={harnessId}
            />
          );
        if (block.role === "user" || block.role === "error") {
          seenAgentInTurn = false;
          return (
            <MessageRow
              key={block.id}
              row={block}
              harnessId={harnessId}
              anchorEventId={anchorEventId}
              subagent={subagent}
              onEdit={onEdit}
            />
          );
        }
        const continuation = seenAgentInTurn;
        seenAgentInTurn = true;
        return (
          <MessageRow
            key={block.id}
            row={block}
            harnessId={harnessId}
            anchorEventId={anchorEventId}
            continuation={continuation}
            onBranch={onBranch}
          />
        );
      })}
    </FilePreviewContext.Provider>
  );
}
