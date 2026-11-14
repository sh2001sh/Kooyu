import { useRef, useState } from "react";
import { FileText, Plus, X } from "lucide-react";

export interface TextAttachment {
  id: string;
  name: string;
  content: string;
  size: number;
}

const MAX_FILE_BYTES = 64 * 1024;
const MAX_TOTAL_BYTES = 160 * 1024;
const MAX_FILES = 4;
const textExtension =
  /\.(txt|md|markdown|json|jsonl|csv|tsv|log|ya?ml|toml|xml|html?|css|scss|js|jsx|mjs|cjs|ts|tsx|py|rs|go|java|kt|swift|c|h|cpp|hpp|cs|sh|ps1|sql|diff|patch)$/i;

export function messageWithTextAttachments(text: string, attachments: TextAttachment[]): string {
  if (!attachments.length) return text;
  return [
    text.trim(),
    ...attachments.map((file) =>
      [
        `--- 附加文本文件：${file.name.replace(/[\r\n]/g, " ")} ---`,
        file.content,
        "--- 文件结束 ---",
      ].join("\n"),
    ),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function useTextAttachments() {
  const [attachments, setAttachments] = useState<TextAttachment[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const add = async (selected: FileList | null) => {
    if (!selected?.length) return;
    setLoading(true);
    setError("");
    try {
      const next = [...attachments];
      for (const file of Array.from(selected)) {
        if (next.length >= MAX_FILES) throw new Error(`一次最多附加 ${MAX_FILES} 个文本文件。`);
        if (!file.type.startsWith("text/") && !textExtension.test(file.name))
          throw new Error("当前只支持文本文件；图片和二进制附件尚未接入原生 Harness。");
        if (file.size > MAX_FILE_BYTES) throw new Error("单个文本文件不能超过 64 KiB。");
        if (next.reduce((sum, item) => sum + item.size, 0) + file.size > MAX_TOTAL_BYTES)
          throw new Error("文本附件总大小不能超过 160 KiB。");
        const content = await file.text();
        if (content.includes("\0")) throw new Error("文件包含二进制内容，无法作为文本发送。");
        next.push({ id: crypto.randomUUID(), name: file.name, content, size: file.size });
      }
      setAttachments(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取附件失败。");
    } finally {
      setLoading(false);
    }
  };

  return {
    attachments,
    loading,
    error,
    add,
    remove: (id: string) => setAttachments((current) => current.filter((item) => item.id !== id)),
    clear: () => {
      setAttachments([]);
      setError("");
    },
    setError,
  };
}

export function TextAttachmentButton({
  loading,
  disabled,
  onAdd,
}: {
  loading: boolean;
  disabled?: boolean;
  onAdd: (files: FileList | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        accept="text/*,.md,.markdown,.json,.jsonl,.csv,.tsv,.log,.yaml,.yml,.toml,.xml,.html,.css,.scss,.js,.jsx,.mjs,.cjs,.ts,.tsx,.py,.rs,.go,.java,.kt,.swift,.c,.h,.cpp,.hpp,.cs,.sh,.ps1,.sql,.diff,.patch"
        className="visually-hidden"
        aria-label="选择文本附件"
        onChange={(event) => {
          onAdd(event.target.files);
          event.target.value = "";
        }}
      />
      <button
        type="button"
        className="attachment-add-button"
        aria-label="添加文本附件"
        title="添加文本文件，内容将随消息发送"
        disabled={disabled || loading}
        onClick={() => input.current?.click()}
      >
        <Plus size={17} />
      </button>
    </>
  );
}

export function TextAttachmentList({
  attachments,
  error,
  disabled,
  onRemove,
}: {
  attachments: TextAttachment[];
  error: string;
  disabled?: boolean;
  onRemove: (id: string) => void;
}) {
  if (!attachments.length && !error) return null;
  return (
    <div className="composer-attachments" aria-label="文本附件">
      {attachments.map((file) => (
        <span className="composer-attachment" key={file.id} title={`${file.name} · ${file.size} B`}>
          <FileText size={14} aria-hidden="true" />
          <span>{file.name}</span>
          <button
            type="button"
            aria-label={`移除附件 ${file.name}`}
            disabled={disabled}
            onClick={() => onRemove(file.id)}
          >
            <X size={13} />
          </button>
        </span>
      ))}
      {error && (
        <span className="attachment-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
