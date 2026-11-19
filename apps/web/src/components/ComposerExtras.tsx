import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { LayoutTemplate, Paperclip, Upload } from "lucide-react";
import { WORK_QUICK_TEMPLATES } from "../lib/harnesses";
import { AttachmentButton } from "./Attachments";
import { Modal } from "./Motion";

/** Shared file drag-and-drop state and handlers for composer containers. */
export function useFileDropZone(enabled: boolean, onFiles: (files: FileList) => void) {
  const [dragOver, setDragOver] = useState(false);
  const depth = useRef(0);
  const handlers = {
    onDragEnter: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      depth.current += 1;
      setDragOver(true);
    },
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: () => {
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragOver(false);
    },
    onDrop: (e: DragEvent) => {
      depth.current = 0;
      setDragOver(false);
      if (!e.dataTransfer.files?.length) return;
      e.preventDefault();
      if (enabled) onFiles(e.dataTransfer.files);
    },
  };
  return { dragOver, handlers };
}

/** Filter quick task templates when user types a leading slash (`/`) in the composer. */
export function matchSlashTemplates(compose: string): [string, string][] {
  if (!compose.startsWith("/") || compose.includes("\n") || compose.length > 24) return [];
  const query = compose.slice(1).trim().toLocaleLowerCase();
  if (!query) return WORK_QUICK_TEMPLATES;
  return WORK_QUICK_TEMPLATES.filter(
    ([title, body]) =>
      title.toLocaleLowerCase().includes(query) || body.toLocaleLowerCase().includes(query),
  );
}

/** Shared dropzone hook props and visual overlay for both DraftWorkspace and Composer. */
export function ComposerDropOverlay({ active, label }: { active: boolean; label: string }) {
  if (!active) return null;
  return (
    <div className="composer-dropzone" aria-hidden="true">
      <Upload size={18} />
      <span>{label}</span>
    </div>
  );
}

/** Shared `/` slash command template popover rendered cleanly above a composer textarea. */
export function SlashTemplateMenu({
  compose,
  onSelect,
}: {
  compose: string;
  onSelect: (text: string) => void;
}) {
  const matches = matchSlashTemplates(compose);
  if (!matches.length) return null;
  return (
    <div className="composer-slash-menu" role="listbox" aria-label="快捷任务模板">
      <div className="composer-slash-menu__title">快捷任务模板</div>
      {matches.map(([title, text]) => (
        <button
          key={title}
          type="button"
          role="option"
          aria-selected={false}
          className="composer-slash-menu__item"
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(text);
          }}
        >
          <LayoutTemplate size={14} aria-hidden="true" />
          <span className="composer-slash-menu__copy">
            <strong>{title}</strong>
            <small>{text.trim()}</small>
          </span>
        </button>
      ))}
    </div>
  );
}

/** Mobile (<=760px) unified `+` sheet containing file attachment upload, permissions, and templates. */
export function MobileComposerPlusSheet({
  open,
  onClose,
  disabled,
  onAddFiles,
  permissionsNode,
  onSelectTemplate,
}: {
  open: boolean;
  onClose: () => void;
  disabled?: boolean;
  onAddFiles: (files: FileList | null) => void;
  permissionsNode?: ReactNode;
  onSelectTemplate: (text: string) => void;
}) {
  if (!open) return null;
  return (
    <Modal title="添加与设置" onClose={onClose}>
      <div className="ios-group-block">
        <div className="ios-group-label">文件与附件</div>
        <div className="ios-inset-group">
          <div className="mobile-plus-row">
            <Paperclip size={16} aria-hidden="true" />
            <AttachmentButton
              loading={false}
              disabled={disabled}
              label="添加文件或图片"
              className="mobile-plus-attach-btn"
              onAdd={(files) => {
                onAddFiles(files);
                onClose();
              }}
            />
          </div>
        </div>
      </div>

      {permissionsNode && (
        <div className="ios-group-block">
          <div className="ios-group-label">会话权限</div>
          <div className="ios-inset-group mobile-plus-permissions">{permissionsNode}</div>
        </div>
      )}

      <div className="ios-group-block">
        <div className="ios-group-label">常用任务模板</div>
        <div className="ios-inset-group">
          {WORK_QUICK_TEMPLATES.map(([title, text]) => (
            <button
              key={title}
              type="button"
              className="ios-sheet-action-row"
              onClick={() => {
                onSelectTemplate(text);
                onClose();
              }}
            >
              <LayoutTemplate size={16} aria-hidden="true" />
              <span className="mobile-plus-tpl">
                <strong>{title}</strong>
                <small>{text.trim()}</small>
              </span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
