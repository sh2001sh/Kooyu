import { normalize } from "node:path";
import type { HarnessId } from "@kodo/protocol";

type Wire = Record<string, any>;

export interface RawNativeCandidate {
  harnessId: HarnessId;
  nativeSessionId: string;
  title: string;
  cwd: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  model: string | null;
  messageCount: number | null;
  sdkFilePath?: string | null;
}

export interface ImportedTranscriptMessage {
  role: "user" | "assistant";
  text: string;
  createdAt?: string;
}

export function normalizePathKey(value: string): string {
  const cleaned = normalize(value).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? cleaned.toLowerCase() : cleaned;
}

export function toIsoTimestamp(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    // Distinguish seconds vs milliseconds epoch timestamps
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  return null;
}

function cleanTitle(raw: unknown, fallbackId: string): string {
  if (typeof raw === "string") {
    const firstLine = raw
      .replace(/\r/g, "")
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean);
    if (firstLine) return firstLine.slice(0, 120);
  }
  return `导入会话 ${fallbackId.slice(0, 8)}`;
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (typeof part === "string") {
        if (part.trim()) parts.push(part.trim());
      } else if (part && typeof part === "object") {
        const p = part as Wire;
        if (p.type === "thinking" || p.type === "tool_use" || p.type === "tool_result") continue;
        if (typeof p.text === "string" && p.text.trim()) parts.push(p.text.trim());
        else if (typeof p.content === "string" && p.content.trim()) parts.push(p.content.trim());
      }
    }
    return parts.join("\n").trim();
  }
  if (content && typeof content === "object") {
    const c = content as Wire;
    if (typeof c.text === "string") return c.text.trim();
    if (typeof c.content === "string") return c.content.trim();
  }
  return "";
}

/** Normalize adapter.standaloneList() output into uniform candidate entries. */
export function normalizeNativeListing(
  harnessId: HarnessId,
  raw: unknown,
  fallbackCwd: string | null,
): RawNativeCandidate[] {
  const rows: Wire[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? Array.isArray((raw as Wire).data)
        ? (raw as Wire).data
        : Array.isArray((raw as Wire).sessions)
          ? (raw as Wire).sessions
          : Array.isArray((raw as Wire).items)
            ? (raw as Wire).items
            : []
      : [];

  const result: RawNativeCandidate[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    // Skip subagent / child sessions across harnesses
    if (row.source?.subagent || row.parentID || row.parentSessionId) continue;

    const nativeSessionId =
      typeof row.sessionId === "string" && row.sessionId
        ? row.sessionId
        : typeof row.id === "string" && row.id
          ? row.id
          : null;
    if (!nativeSessionId || seen.has(nativeSessionId)) continue;
    seen.add(nativeSessionId);

    const cwd =
      typeof row.cwd === "string" && row.cwd.trim()
        ? row.cwd.trim()
        : typeof row.workDir === "string" && row.workDir.trim()
          ? row.workDir.trim()
          : typeof row.directory === "string" && row.directory.trim()
            ? row.directory.trim()
            : typeof row.projectPath === "string" && row.projectPath.trim()
              ? row.projectPath.trim()
              : fallbackCwd;

    const titleCandidate =
      row.customTitle ??
      row.summary ??
      row.title ??
      row.name ??
      row.preview ??
      row.firstPrompt ??
      row.firstMessage;

    const createdAt = toIsoTimestamp(
      row.createdAt ?? row.created_at ?? row.created ?? row.time?.created ?? row.startTime,
    );
    const updatedAt =
      toIsoTimestamp(
        row.updatedAt ??
          row.updated_at ??
          row.lastModified ??
          row.modified ??
          row.time?.updated ??
          row.lastUpdated,
      ) ?? createdAt;

    const model =
      typeof row.model === "string" && row.model.trim()
        ? row.model.trim()
        : typeof row.modelId === "string" && row.modelId.trim()
          ? row.modelId.trim()
          : null;

    const messageCount =
      typeof row.messageCount === "number" && Number.isFinite(row.messageCount)
        ? row.messageCount
        : typeof row.turnCount === "number" && Number.isFinite(row.turnCount)
          ? row.turnCount
          : null;

    result.push({
      harnessId,
      nativeSessionId,
      title: cleanTitle(titleCandidate, nativeSessionId),
      cwd,
      createdAt,
      updatedAt,
      model,
      messageCount,
      sdkFilePath: typeof row.path === "string" ? row.path : null,
    });
  }
  return result;
}

/** Extract user/assistant messages from adapter.standaloneRead() output for imported transcripts. */
export function extractImportedMessages(
  harnessId: HarnessId,
  raw: unknown,
  limit = 500,
): ImportedTranscriptMessage[] {
  const out: ImportedTranscriptMessage[] = [];
  const push = (role: "user" | "assistant", text: string, createdAt?: string | null) => {
    const cleaned = text.trim();
    if (!cleaned || out.length >= limit) return;
    out.push({ role, text: cleaned, ...(createdAt ? { createdAt } : {}) });
  };

  if (!raw || typeof raw !== "object") return out;

  // 1. Codex: { thread: { turns: [{ items: [...] }] } }
  if (harnessId === "codex" && Array.isArray((raw as Wire).thread?.turns)) {
    for (const turn of (raw as Wire).thread.turns as Wire[]) {
      for (const item of (turn.items ?? []) as Wire[]) {
        if (item.type === "userMessage") {
          const text = textFromContent(item.content ?? item.text);
          push("user", text, toIsoTimestamp(item.createdAt ?? turn.createdAt));
        } else if (item.type === "agentMessage" || item.type === "assistantMessage") {
          const text = textFromContent(item.text ?? item.content);
          push("assistant", text, toIsoTimestamp(item.createdAt ?? turn.completedAt));
        }
      }
    }
    return out;
  }

  // 2. Grok markdown transcript: { format: "markdown", transcript: string }
  if (harnessId === "grok-build" && typeof (raw as Wire).transcript === "string") {
    const transcript = String((raw as Wire).transcript);
    const blocks = transcript.split(/^##\s+(User|Assistant)\s*$/gim);
    for (let i = 1; i < blocks.length; i += 2) {
      const role = blocks[i]?.toLowerCase() === "user" ? "user" : "assistant";
      const body = blocks[i + 1] ?? "";
      push(role, body);
    }
    if (!out.length && transcript.trim()) push("assistant", transcript.trim());
    return out;
  }

  // 3. OpenCode: { messages: [{ info: { role, time }, parts: [...] }] }
  if (harnessId === "opencode" && Array.isArray((raw as Wire).messages)) {
    for (const row of (raw as Wire).messages as Wire[]) {
      const role = row.info?.role ?? row.role;
      if (role !== "user" && role !== "assistant") continue;
      const parts = Array.isArray(row.parts)
        ? row.parts.filter((p: Wire) => p?.type === "text" && typeof p.text === "string")
        : [];
      const text = parts.length
        ? parts.map((p: Wire) => p.text).join("\n")
        : textFromContent(row.content ?? row.text);
      push(role, text, toIsoTimestamp(row.info?.time?.created ?? row.createdAt));
    }
    return out;
  }

  // 4. DeepSeek Harness: { events: [...] }
  if (harnessId === "deepseek-harness" && Array.isArray((raw as Wire).events)) {
    for (const ev of (raw as Wire).events as Wire[]) {
      const msg = ev.message ?? ev;
      const role = msg.role;
      if (role !== "user" && role !== "assistant") continue;
      push(
        role,
        textFromContent(msg.content ?? msg.text),
        toIsoTimestamp(ev.timestamp ?? ev.createdAt),
      );
    }
    return out;
  }

  // 5. Generic messages array: Claude Code, Kodo/pi SDK, Gemini, Kimi, ZCode, ACP/Cursor
  const messages: Wire[] = Array.isArray(raw)
    ? (raw as Wire[])
    : Array.isArray((raw as Wire).messages)
      ? ((raw as Wire).messages as Wire[])
      : Array.isArray((raw as Wire).turns)
        ? ((raw as Wire).turns as Wire[])
        : [];

  for (const row of messages) {
    if (!row || typeof row !== "object") continue;
    const inner = row.message && typeof row.message === "object" ? (row.message as Wire) : row;
    const rawRole = inner.role ?? row.type ?? row.role;
    const role: "user" | "assistant" | null =
      rawRole === "user"
        ? "user"
        : rawRole === "assistant" || rawRole === "model" || rawRole === "gemini"
          ? "assistant"
          : null;
    if (!role) continue;
    const text = textFromContent(inner.content ?? inner.text ?? row.text ?? row.content);
    push(role, text, toIsoTimestamp(row.timestamp ?? row.createdAt ?? inner.timestamp));
  }

  return out;
}
