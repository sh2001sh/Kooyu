import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkFileLinks } from "../lib/remark-file-links";
import {
  AlertTriangle,
  Brain,
  ChevronLeft,
  ChevronRight,
  Cpu,
  FileCode2,
  FileText,
  Globe,
  Info,
  Lightbulb,
  Search,
  ShieldAlert,
  Sparkles,
  Terminal,
  Wrench,
  Pencil,
  GitBranch,
  Square,
} from "lucide-react";
import {
  conversationEvents,
  type Session,
  type HarnessId,
  type MessageAttachment,
  type RuntimeEvent,
  type SubagentEvent,
} from "@kodo/protocol";
import { assistantContent, isThinkingChannel, splitAssistantText } from "@kodo/protocol/client";
import { useContext, useEffect, useRef, useState } from "react";
import { FilePreviewContext } from "../lib/file-preview-context";
import { workspaceLinkPath } from "../lib/workspace-files";
import { HARNESS_NAMES } from "../lib/harnesses";
import { HarnessBadge } from "./KooyuBrand";
import { CopyButton } from "./Motion";
import { failureText, messageText } from "./TurnCard";
import { useAppPreferences } from "../lib/preferences";
import { SentAttachments } from "./Attachments";
import { AgentNavigationContext } from "../lib/agent-navigation-context";
import { completedTurnFiles } from "../lib/turn-files";
import { TurnFiles } from "./TurnFiles";

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
  const openAgent = useContext(AgentNavigationContext);
  const [open] = useState(false);
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
    <div className="subagent-output" data-agent-id={child.agentId}>
      <button
        type="button"
        className="subagent-output__summary"
        onClick={() => openAgent?.(child.agentId)}
        aria-label={`打开子代理对话 ${child.name || child.agentId}`}
      >
        <ChevronRight size={14} className="tool-card__chevron" aria-hidden="true" />
        <span className="subagent-output__label">子代理 · {child.name || child.agentId}</span>
        <span className={`tool-card__status ${statusClass(status)}`}>{status}</span>
      </button>
      {open && !openAgent && (
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
    </div>
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
  const status = failed
    ? "失败"
    : done
      ? "完成"
      : p.lifecycle === "started"
        ? p.turnEnded
          ? "结果未确认"
          : "进行中"
        : undefined;
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
  if (typeof p.content === "string") return p.content;
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

function toolKindIcon(title: string, p?: Value) {
  const raw = `${title} ${p?.type ?? ""} ${p?.name ?? ""} ${p?.toolName ?? ""}`.toLowerCase();
  if (
    raw.includes("命令") ||
    raw.includes("command") ||
    raw.includes("bash") ||
    raw.includes("shell") ||
    raw.includes("exec")
  ) {
    return <Terminal size={12} />;
  }
  if (
    raw.includes("修改") ||
    raw.includes("write") ||
    raw.includes("edit") ||
    raw.includes("patch") ||
    raw.includes("filechange")
  ) {
    return <FileCode2 size={12} />;
  }
  if (raw.includes("网页") || raw.includes("web") || raw.includes("url") || raw.includes("fetch")) {
    return <Globe size={12} />;
  }
  if (
    raw.includes("搜索") ||
    raw.includes("search") ||
    raw.includes("grep") ||
    raw.includes("glob")
  ) {
    return <Search size={12} />;
  }
  if (raw.includes("read") || raw.includes("读取") || raw.includes("文件")) {
    return <FileText size={12} />;
  }
  if (p?.type === "mcpToolCall" || raw.includes("mcp") || raw.includes(".")) {
    return <Cpu size={12} />;
  }
  return <Wrench size={12} />;
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
          {toolKindIcon(title, p)}
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
  const group = useRef<HTMLDetailsElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const long = rows.length > 6;
  if (rows.length === 1 || (!collapse && !long))
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
    <details ref={group} className={`tool-group ${groupTone}`} open={!collapse || undefined}>
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
      {long && (
        <div className="tool-group__controls" role="group" aria-label="工具列表导航">
          <button
            type="button"
            onClick={() => {
              list.current?.scrollTo({ top: 0 });
              list.current
                ?.querySelector(".tool-card > summary")
                ?.scrollIntoView({ block: "nearest" });
            }}
          >
            首项
          </button>
          <button
            type="button"
            onClick={() => {
              list.current?.scrollTo({ top: list.current.scrollHeight });
              list.current
                ?.querySelector(".tool-card:last-child > summary")
                ?.scrollIntoView({ block: "nearest" });
            }}
          >
            末项
          </button>
          <button
            type="button"
            className="tool-group__collapse"
            onClick={() => {
              if (group.current) {
                group.current.open = false;
                group.current.querySelector("summary")?.focus({ preventScroll: true });
                group.current.scrollIntoView({ block: "nearest" });
              }
            }}
          >
            收起工具调用
          </button>
        </div>
      )}
      <div
        ref={list}
        className="tool-group__list"
        tabIndex={long ? 0 : undefined}
        role={long ? "region" : undefined}
        aria-label={long ? "工具调用列表" : undefined}
      >
        {rows.map((r) => (
          <ToolCall key={r.id} row={r} />
        ))}
      </div>
    </details>
  );
}

/**
 * Reasoning block (§3.2.3): while live it breathes and peeks at the newest line; once the turn
 * moves on it folds itself into a single 已思考 Xs · 点击展开 line (chevron rotates back to 0°).
 */
function Thinking({ text, live, expand }: { text: string; live: boolean; expand: boolean }) {
  const startedAt = useRef<number | null>(live ? performance.now() : null);
  const [seconds, setSeconds] = useState<number | null>(null);
  const [open, setOpen] = useState(live && expand);
  useEffect(() => {
    if (live) {
      startedAt.current ??= performance.now();
      setOpen(expand);
      return;
    }
    if (startedAt.current !== null) {
      setSeconds((performance.now() - startedAt.current) / 1000);
      startedAt.current = null;
    }
    setOpen(false);
  }, [live, expand]);
  const lastLine = text.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? "";
  const elapsed =
    seconds === null ? "" : ` ${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
  return (
    <details
      className={`thinking-block ${live ? "is-live" : ""}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary
        onClick={(event) => {
          event.preventDefault();
          setOpen((prev) => !prev);
        }}
      >
        <span className="thinking-block__icon" aria-hidden="true">
          <Brain size={13} />
        </span>
        {live ? (
          <>
            <span className="thinking-block__label">正在思考…</span>
            {lastLine && !open && <span className="thinking-block__peek">{lastLine}</span>}
          </>
        ) : (
          <>
            <span className="thinking-block__label">已思考{elapsed}</span>
            {lastLine && !open && <span className="thinking-block__peek">{lastLine}</span>}
          </>
        )}
        <ChevronRight size={14} className="tool-card__chevron" aria-hidden="true" />
      </summary>
      <div className="thinking-block__body">{text}</div>
    </details>
  );
}

function extractNodeText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractNodeText).join("");
  if (typeof node === "object" && "props" in node) {
    return extractNodeText(
      (node as React.ReactElement<{ children?: React.ReactNode }>).props.children,
    );
  }
  return "";
}

function MarkdownPre({ children }: React.HTMLAttributes<HTMLPreElement>) {
  const child = Array.isArray(children) ? children[0] : children;
  const codeProps =
    child && typeof child === "object" && "props" in child
      ? (child as React.ReactElement<{ className?: string; children?: React.ReactNode }>).props
      : undefined;
  const rawClass = codeProps?.className ?? "";
  const match = /language-([^\s]+)/.exec(rawClass);
  const rawCode = extractNodeText(codeProps ? codeProps.children : children).replace(/\n$/, "");
  const lines = rawCode.split("\n");
  const lang = (match?.[1] ?? "").toLowerCase();
  const isDiff =
    lang === "diff" ||
    lang === "patch" ||
    (!lang &&
      lines.length >= 2 &&
      lines.some((l) => l.startsWith("@@ ")) &&
      lines.some((l) => l.startsWith("+") || l.startsWith("-")));
  const isShell = ["sh", "bash", "zsh", "shell", "powershell", "ps1", "cmd", "console"].includes(
    lang,
  );
  const displayLang = isDiff ? "diff" : lang || "code";

  return (
    <div className={`md-code-card ${isDiff ? "is-diff" : ""}`}>
      <div className="md-code-card__head">
        <span className="md-code-card__meta">
          {isShell ? (
            <Terminal size={12} aria-hidden="true" />
          ) : (
            <FileCode2 size={12} aria-hidden="true" />
          )}
          <span className="md-code-card__lang">{displayLang}</span>
          {lines.length > 1 && <span className="md-code-card__lines">{lines.length} 行</span>}
        </span>
        <CopyButton text={rawCode} label="复制代码" />
      </div>
      <div className="md-code-card__scroll">
        {!isDiff && lines.length >= 3 && (
          <div className="md-code-gutter" aria-hidden="true">
            {lines.map((_, idx) => (
              <span key={idx}>{idx + 1}</span>
            ))}
          </div>
        )}
        {isDiff ? (
          <pre className="md-code-pre md-code-pre--diff">
            <code className={rawClass || undefined}>
              {lines.map((line, idx) => {
                const cls =
                  line.startsWith("+++") || line.startsWith("---")
                    ? "is-meta"
                    : line.startsWith("+")
                      ? "is-add"
                      : line.startsWith("-")
                        ? "is-del"
                        : line.startsWith("@@")
                          ? "is-hunk"
                          : "";
                return (
                  <span key={idx} className={`md-diff-line ${cls}`}>
                    {line}
                    {idx < lines.length - 1 ? "\n" : ""}
                  </span>
                );
              })}
            </code>
          </pre>
        ) : (
          <pre className="md-code-pre">{children}</pre>
        )}
      </div>
    </div>
  );
}

function MarkdownTable({ children }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="md-table-wrap">
      <table>{children}</table>
    </div>
  );
}

const CALLOUT_META: Record<string, { label: string; tone: string; Icon: typeof Info }> = {
  NOTE: { label: "说明", tone: "note", Icon: Info },
  TIP: { label: "提示", tone: "tip", Icon: Lightbulb },
  IMPORTANT: { label: "重要", tone: "important", Icon: Sparkles },
  WARNING: { label: "注意", tone: "warning", Icon: AlertTriangle },
  CAUTION: { label: "风险", tone: "caution", Icon: ShieldAlert },
};

function MarkdownBlockquote({ children }: React.BlockquoteHTMLAttributes<HTMLQuoteElement>) {
  const text = extractNodeText(children).trimStart();
  const m = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i.exec(text);
  if (m) {
    const key = m[1]!.toUpperCase();
    const meta = CALLOUT_META[key] ?? CALLOUT_META.NOTE!;
    const Icon = meta.Icon;
    const stripped = text.slice(m[0].length).trim();
    return (
      <aside className={`md-callout md-callout--${meta.tone}`}>
        <div className="md-callout__head">
          <Icon size={14} aria-hidden="true" />
          <strong>{meta.label}</strong>
        </div>
        {stripped && <p className="md-callout__body">{stripped}</p>}
      </aside>
    );
  }
  return <blockquote>{children}</blockquote>;
}

function FileLink({ href, children }: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const open = useContext(FilePreviewContext);
  const path = workspaceLinkPath(href);
  return open && path ? (
    <button
      type="button"
      className="file-preview-link"
      title={`在 Kooyu 中查看 ${path}`}
      onClick={() => open(path)}
    >
      <FileCode2 size={12} className="file-preview-link__icon" aria-hidden="true" />
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
      <FileCode2 size={12} className="file-preview-link__icon" aria-hidden="true" />
      查看图片：{alt || path}
    </button>
  ) : (
    <img src={typeof src === "string" ? src : undefined} alt={alt ?? ""} />
  );
}
const markdownComponents = {
  a: FileLink,
  img: FileImage,
  pre: MarkdownPre,
  table: MarkdownTable,
  blockquote: MarkdownBlockquote,
};
const transformFileUrl = (url: string) => (workspaceLinkPath(url) ? url : defaultUrlTransform(url));

function MessageRow({
  row,
  harnessId,
  anchorEventId,
  continuation = false,
  subagent = false,
  onEdit,
  onBranch,
  variants,
}: {
  row: TranscriptRow;
  harnessId: HarnessId;
  anchorEventId?: string;
  continuation?: boolean;
  subagent?: boolean;
  onEdit?: (eventId: string, text: string) => Promise<boolean>;
  onBranch?: (eventId: string) => void;
  variants?: { index: number; count: number; disabled: boolean; select: (offset: number) => void };
}) {
  const hit = row.eventIds.includes(anchorEventId ?? "") || undefined;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.text);
  const [saving, setSaving] = useState(false);
  const editRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) return;
    const el = editRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(56, Math.min(el.scrollHeight, 320))}px`;
  }, [editing, draft]);

  const submitEdit = () => {
    if (saving || !draft.trim()) return;
    setSaving(true);
    void onEdit?.(row.eventIds[0]!, draft)
      .then((saved) => {
        if (saved) setEditing(false);
      })
      .finally(() => setSaving(false));
  };
  if (row.role === "status")
    return (
      <div className="turn turn-status" role="status" id={`message-${row.id}`}>
        <Square size={12} aria-hidden="true" />
        {row.text}
      </div>
    );
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
        className={`turn user-message ${editing ? "is-editing" : ""}`}
        data-search-hit={hit}
        data-nav-user=""
        data-nav-label={row.text.replace(/\s+/g, " ").slice(0, 80)}
        id={`message-${row.id}`}
      >
        <div className="user-turn">
          {row.origin && <div className="turn-author">{row.origin}</div>}
          {row.attachments && <SentAttachments attachments={row.attachments} />}
          {editing ? (
            <form
              className="message-editor"
              onSubmit={(event) => {
                event.preventDefault();
                submitEdit();
              }}
            >
              <textarea
                ref={editRef}
                aria-label="消息内容"
                autoFocus
                rows={2}
                maxLength={200000}
                value={draft}
                disabled={saving}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && !event.nativeEvent.isComposing && !saving) {
                    event.preventDefault();
                    setEditing(false);
                  } else if (
                    (event.metaKey || event.ctrlKey) &&
                    event.key === "Enter" &&
                    !event.nativeEvent.isComposing &&
                    !saving
                  ) {
                    event.preventDefault();
                    submitEdit();
                  }
                }}
              />
              <div className="message-editor__actions">
                <button
                  type="button"
                  className="message-editor__cancel"
                  disabled={saving}
                  onClick={() => setEditing(false)}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="primary message-editor__submit"
                  disabled={saving || !draft.trim()}
                >
                  {saving ? "正在发送…" : "保存并继续"}
                </button>
              </div>
            </form>
          ) : (
            <div className="markdown">
              <Markdown
                remarkPlugins={[remarkGfm, remarkFileLinks]}
                components={markdownComponents}
                urlTransform={transformFileUrl}
              >
                {row.text}
              </Markdown>
            </div>
          )}
        </div>
        {!editing && (
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
            {variants && (
              <span className="message-variants" role="group" aria-label="消息分支">
                <button
                  type="button"
                  className="ios-copy-btn"
                  aria-label="上一个消息分支"
                  disabled={variants.disabled || variants.index === 0}
                  onClick={() => variants.select(-1)}
                >
                  <ChevronLeft size={14} />
                </button>
                <span aria-live="polite">
                  {variants.index + 1} / {variants.count}
                </span>
                <button
                  type="button"
                  className="ios-copy-btn"
                  aria-label="下一个消息分支"
                  disabled={variants.disabled || variants.index === variants.count - 1}
                  onClick={() => variants.select(1)}
                >
                  <ChevronRight size={14} />
                </button>
              </span>
            )}
            {!subagent && onEdit && (
              <button
                type="button"
                className="ios-copy-btn"
                aria-label="编辑消息"
                title="编辑消息"
                onClick={() => {
                  setDraft(row.text);
                  setEditing(true);
                }}
              >
                <Pencil size={14} />
              </button>
            )}
          </div>
        )}
      </article>
    );
  return (
    <article
      className={`turn assistant-turn ${continuation ? "is-cont" : ""}`}
      data-search-hit={hit}
      id={`message-${row.id}`}
    >
      {!continuation && (
        <div className="assistant-turn__header">
          <HarnessBadge harnessId={harnessId} size="sm" shape="squircle" />
          <span className="turn-author">{HARNESS_NAMES[harnessId]}</span>
          {row.createdAt && (
            <time className="assistant-turn__time" dateTime={row.createdAt}>
              {new Date(row.createdAt).toLocaleString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
          )}
        </div>
      )}
      <div className="markdown assistant-turn__markdown">
        <Markdown
          remarkPlugins={[remarkGfm, remarkFileLinks]}
          components={markdownComponents}
          urlTransform={transformFileUrl}
        >
          {row.text}
        </Markdown>
      </div>
      <div className="message-actions message-actions--assistant">
        <CopyButton text={row.text} label="复制" />
        {!subagent && onBranch && row.createdAt && (
          <button type="button" className="ios-copy-btn" onClick={() => onBranch(row.eventIds[0]!)}>
            <GitBranch size={13} />
            分支到新聊天
          </button>
        )}
      </div>
    </article>
  );
}

function buildTranscriptRows(events: RuntimeEvent[]) {
  const rows: TranscriptRow[] = [];
  const fileSummaries = completedTurnFiles(events);
  const replaced = new Set(
    events.flatMap((event) => {
      const value = event.payload as Value;
      const id = value?.replaceEventId;
      return typeof id === "string" ? [id] : [];
    }),
  );
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
    if (e.type === "message" && replaced.has(e.id)) continue;
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
        else if (update.event.type === "error") child.status = "failed";
        else if (
          update.event.type === "tool" &&
          value.type === "tool_result" &&
          [value.tool_use_id, value.toolCallId].some(
            (id) => typeof id === "string" && (id === update.agentId || id === p.toolCallId),
          )
        )
          child.status = value.is_error ? "failed" : "completed";
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
      for (const row of rows)
        if (row.role === "tool" && toolSummary(row.payload as Value).status === "进行中")
          row.payload = { ...(row.payload as Value), turnEnded: true };
      if (p.outcome === "cancelled" && rows.at(-1)?.role !== "status")
        rows.push({ id: e.id, eventIds: [e.id], role: "status", text: "已停止" });
      const message = failureText(p);
      const reasoned = e.type === "turn-ended" || p.error || p.message;
      if (message && reasoned && !rows.some((r) => r.role === "error" && r.text === message))
        rows.push({ id: e.id, eventIds: [e.id], role: "error", text: message, payload: p });
      const files = fileSummaries.get(e.id);
      if (files)
        rows.push({ id: `files:${e.id}`, eventIds: [], role: "files", text: "", payload: files });
    } else if (
      e.type === "state" &&
      (p.message || p.error) &&
      !p.willRetry &&
      !p.retry &&
      p.subtype !== "api_retry" &&
      p.type !== "auto_retry_start"
    ) {
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
  conversation,
  onSelectBranch,
  branchBusy = false,
}: {
  events: RuntimeEvent[];
  harnessId?: HarnessId;
  anchorEventId?: string;
  running?: boolean;
  subagent?: boolean;
  onOpenFile?: (path: string) => void;
  onEdit?: (eventId: string, text: string) => Promise<boolean>;
  onBranch?: (eventId: string) => void;
  conversation?: Session["conversation"];
  onSelectBranch?: (branchId: string) => void;
  branchBusy?: boolean;
}) {
  const inheritedOpenFile = useContext(FilePreviewContext);
  const { settings: preferences } = useAppPreferences();
  const { rows, thinkingPending } = buildTranscriptRows(conversationEvents(events, conversation));
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
        if (block.role === "files")
          return (
            <TurnFiles
              key={block.id}
              files={block.payload as import("../lib/turn-files").TurnFile[]}
            />
          );
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
        if (block.role === "user" || block.role === "error" || block.role === "status") {
          seenAgentInTurn = false;
          const eventId = block.eventIds[0];
          const branch = conversation?.branches.find(
            (b) => b.userEventId === eventId || b.rootEventId === eventId,
          );
          const siblings = branch
            ? conversation!.branches.filter((b) => b.rootEventId === branch.rootEventId)
            : [];
          const choices = branch ? [branch.originalBranchId, ...siblings.map((b) => b.id)] : [];
          const currentIndex = branch
            ? eventId === branch.rootEventId
              ? 0
              : siblings.findIndex((b) => b.userEventId === eventId) + 1
            : 0;
          return (
            <MessageRow
              key={block.id}
              row={block}
              harnessId={harnessId}
              anchorEventId={anchorEventId}
              subagent={subagent}
              onEdit={onEdit}
              variants={
                branch && onSelectBranch
                  ? {
                      index: currentIndex,
                      count: choices.length,
                      disabled: branchBusy,
                      select: (offset) => onSelectBranch(choices[currentIndex + offset]!),
                    }
                  : undefined
              }
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
