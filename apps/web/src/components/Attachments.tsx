import { useRef, useSyncExternalStore } from "react";
import { FileText, Image as ImageIcon, Loader2, Paperclip, Pencil, Plus, X } from "lucide-react";
import type { ManagedFile, MessageAttachment, UploadSession } from "@kodo/protocol";
import { api, apiPath, HostError } from "../lib/host-client";

/**
 * Message attachments are uploaded to the Host as managed files before sending;
 * the message carries only their IDs and the Host decides how each one reaches the
 * harness (inline text, native image, or a Host file reference).
 */
export interface DraftAttachment {
  key: string;
  name: string;
  size: number;
  mediaType: string;
  state: "uploading" | "ready" | "error";
  progress: number;
  fileId?: string;
  error?: string;
  previewUrl?: string;
}

export const MAX_ATTACHMENTS = 10;
const MAX_FILE_BYTES = 32 * 1024 * 1024;
/** Stays under the Relay's per-request body limit when used from a phone. */
const CHUNK_BYTES = 512 * 1024;

// Per-conversation drafts survive switching sessions and the draft → session move.
const drafts = new Map<string, DraftAttachment[]>();
const errors = new Map<string, string>();
const listeners = new Set<() => void>();
const EMPTY: DraftAttachment[] = [];
function emit() {
  for (const listener of listeners) listener();
}
function update(scope: string, change: (items: DraftAttachment[]) => DraftAttachment[]) {
  drafts.set(scope, change(drafts.get(scope) ?? []));
  emit();
}
function setError(scope: string, message: string) {
  if (message) errors.set(scope, message);
  else errors.delete(scope);
  emit();
}
/** Keep the uploaded files when a first send moves from the draft to a real session. */
export function moveAttachments(from: string, to: string) {
  const items = drafts.get(from);
  if (!items?.length) return;
  drafts.set(to, [...(drafts.get(to) ?? []), ...items]);
  drafts.delete(from);
  emit();
}

const guessType = (file: File) =>
  file.type ||
  (/\.(md|markdown)$/i.test(file.name)
    ? "text/markdown"
    : /\.(txt|log|csv|tsv|json|jsonl|ya?ml|toml|xml|ts|tsx|js|py|rs|go|java|sh|sql|diff|patch)$/i.test(
          file.name,
        )
      ? "text/plain"
      : "application/octet-stream");

async function digest(buffer: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function uploadFile(
  file: File,
  sessionId: string | null,
  onProgress: (fraction: number) => void,
): Promise<ManagedFile> {
  const buffer = await file.arrayBuffer();
  const upload = await api<UploadSession>("/files/uploads", "POST", {
    requestId: crypto.randomUUID(),
    displayName: file.name,
    mediaType: guessType(file),
    size: buffer.byteLength,
    sha256: await digest(buffer),
    sessionId,
  });
  let offset = upload.received;
  while (offset < buffer.byteLength) {
    const end = Math.min(offset + CHUNK_BYTES, buffer.byteLength);
    const response = await fetch(apiPath(`/files/uploads/${upload.id}/chunks?offset=${offset}`), {
      method: "PUT",
      headers: { "content-type": "application/octet-stream" },
      body: buffer.slice(offset, end),
      credentials: "same-origin",
    });
    const value = await response.json();
    if (!response.ok)
      throw new HostError(
        value.error?.message ?? `HTTP ${response.status}`,
        value.error?.code ?? "UNKNOWN",
      );
    offset = (value as UploadSession).received;
    onProgress(offset / Math.max(1, buffer.byteLength));
  }
  return api<ManagedFile>(`/files/uploads/${upload.id}/complete`, "POST", {});
}

export function useAttachments(scope: string, sessionId: string | null) {
  const items = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => drafts.get(scope) ?? EMPTY,
  );
  const error = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => errors.get(scope) ?? "",
  );
  const add = async (selected: FileList | File[] | null) => {
    if (!selected?.length) return;
    setError(scope, "");
    const files = Array.from(selected);
    if ((drafts.get(scope)?.length ?? 0) + files.length > MAX_ATTACHMENTS) {
      setError(scope, `一条消息最多附加 ${MAX_ATTACHMENTS} 个文件。`);
      return;
    }
    await Promise.all(
      files.map(async (file) => {
        const key = crypto.randomUUID();
        const mediaType = guessType(file);
        const previewUrl = mediaType.startsWith("image/") ? URL.createObjectURL(file) : undefined;
        const base: DraftAttachment = {
          key,
          name: file.name,
          size: file.size,
          mediaType,
          state: "uploading",
          progress: 0,
          previewUrl,
        };
        if (file.size > MAX_FILE_BYTES) {
          update(scope, (list) => [
            ...list,
            { ...base, state: "error", error: "超过 32 MiB 上限" },
          ]);
          setError(scope, `「${file.name}」超过 32 MiB，未上传。`);
          return;
        }
        update(scope, (list) => [...list, base]);
        const patch = (change: Partial<DraftAttachment>) =>
          update(scope, (list) =>
            list.map((item) => (item.key === key ? { ...item, ...change } : item)),
          );
        try {
          const stored = await uploadFile(file, sessionId, (progress) => patch({ progress }));
          patch({ state: "ready", progress: 1, fileId: stored.id });
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "上传失败";
          patch({ state: "error", error: message });
          setError(scope, `「${file.name}」上传失败：${message}`);
        }
      }),
    );
  };
  return {
    attachments: items,
    error,
    uploading: items.some((item) => item.state === "uploading"),
    failed: items.some((item) => item.state === "error"),
    readyIds: items.filter((item) => item.state === "ready").map((item) => item.fileId!),
    add,
    remove: (key: string) => {
      const removed = (drafts.get(scope) ?? []).find((item) => item.key === key);
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      update(scope, (list) => list.filter((item) => item.key !== key));
      if (!(drafts.get(scope) ?? []).some((item) => item.state === "error")) setError(scope, "");
    },
    clear: () => {
      for (const item of drafts.get(scope) ?? []) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
      drafts.delete(scope);
      setError(scope, "");
    },
    setError: (message: string) => setError(scope, message),
  };
}

export function AttachmentButton({
  loading,
  disabled,
  onAdd,
  label,
  className,
}: {
  loading: boolean;
  disabled?: boolean;
  onAdd: (files: FileList | null) => void;
  label?: string;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        className="visually-hidden"
        aria-label="选择附件"
        onChange={(event) => {
          onAdd(event.target.files);
          event.target.value = "";
        }}
      />
      <button
        type="button"
        className={className ?? "attachment-add-button"}
        aria-label={label ?? "添加附件"}
        title="添加文件或图片（上传到 Host，随消息发送）"
        disabled={disabled || loading}
        onClick={() => input.current?.click()}
      >
        <Plus size={17} />
        {label && <span>{label}</span>}
      </button>
    </>
  );
}

const sizeText = (size: number) =>
  size < 1024
    ? `${size} B`
    : size < 1048576
      ? `${(size / 1024).toFixed(1)} KB`
      : `${(size / 1048576).toFixed(1)} MB`;
const iconFor = (mediaType: string) =>
  mediaType.startsWith("image/") ? ImageIcon : mediaType.startsWith("text/") ? FileText : Paperclip;

export function AttachmentList({
  attachments,
  error,
  disabled,
  onRemove,
  onAnnotate,
}: {
  attachments: DraftAttachment[];
  error: string;
  disabled?: boolean;
  onRemove: (key: string) => void;
  onAnnotate?: (file: DraftAttachment) => void;
}) {
  if (!attachments.length && !error) return null;
  return (
    <div className="composer-attachments" aria-label="附件">
      {attachments.map((file) => {
        const Icon = file.state === "uploading" ? Loader2 : iconFor(file.mediaType);
        return (
          <span
            className={`composer-attachment composer-attachment--${file.state}`}
            key={file.key}
            title={`${file.name} · ${sizeText(file.size)}${file.error ? ` · ${file.error}` : ""}`}
          >
            <Icon
              size={14}
              aria-hidden="true"
              className={file.state === "uploading" ? "spin" : undefined}
            />
            <span>{file.name}</span>
            {file.state === "uploading" && (
              <small aria-label={`${file.name} 上传进度`}>{Math.round(file.progress * 100)}%</small>
            )}
            {onAnnotate &&
              file.state === "ready" &&
              file.mediaType.startsWith("image/") &&
              file.previewUrl && (
                <button
                  type="button"
                  className="nx-attach-annotate-btn"
                  aria-label={`批注图片 ${file.name}`}
                  title="截图批注（画笔 / 箭头 / 框选）"
                  disabled={disabled}
                  onClick={() => onAnnotate(file)}
                >
                  <Pencil size={12} />
                </button>
              )}
            <button
              type="button"
              aria-label={`移除附件 ${file.name}`}
              disabled={disabled}
              onClick={() => onRemove(file.key)}
            >
              <X size={13} />
            </button>
          </span>
        );
      })}
      {error && (
        <span className="attachment-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

/** Attachments shown on a sent message, with how the Host delivered each one. */
export function SentAttachments({ attachments }: { attachments: MessageAttachment[] }) {
  if (!attachments.length) return null;
  const how: Record<NonNullable<MessageAttachment["delivery"]>, string> = {
    "inline-text": "内容已随消息发送",
    image: "已作为图片发送",
    "file-reference": "以 Host 文件路径提供",
  };
  return (
    <div className="message-attachments" aria-label="消息附件">
      {attachments.map((a) => {
        const Icon = iconFor(a.mediaType);
        return (
          <a
            key={a.fileId}
            className="message-attachment"
            href={apiPath(`/files/${a.fileId}/content`)}
            target="_blank"
            rel="noreferrer"
            title={[
              sizeText(a.size),
              a.delivery ? how[a.delivery] : "等待发送",
              a.truncated ? "内容过长已截断" : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          >
            <Icon size={13} aria-hidden="true" />
            <span>{a.displayName}</span>
          </a>
        );
      })}
    </div>
  );
}
