import { useContext, useState } from "react";
import { Files, FileCode2, ChevronDown, ArrowUpRight } from "lucide-react";
import { FilePreviewContext, FileChangesContext } from "../lib/file-preview-context";
import type { TurnFile } from "../lib/turn-files";

export function TurnFiles({ files }: { files: TurnFile[] }) {
  const open = useContext(FilePreviewContext);
  const changes = useContext(FileChangesContext);
  const [expanded, setExpanded] = useState(false);

  const totalAdded = files.reduce((sum, f) => sum + (f.added ?? 0), 0);
  const totalRemoved = files.reduce((sum, f) => sum + (f.removed ?? 0), 0);

  return (
    <section className="turn-files" aria-label="本轮编辑的文件">
      <header className="turn-files__head">
        <span className="turn-files__icon" aria-hidden="true">
          <Files size={14} />
        </span>
        <strong>本轮编辑 {files.length} 个文件</strong>
        {(totalAdded > 0 || totalRemoved > 0) && (
          <span className="turn-files__totals" aria-hidden="true">
            {totalAdded > 0 && <span className="turn-files__added">+{totalAdded}</span>}
            {totalRemoved > 0 && <span className="turn-files__removed">−{totalRemoved}</span>}
          </span>
        )}
        {changes && (
          <button type="button" className="turn-files__diff-btn" onClick={changes}>
            <span>查看变更</span>
            <ArrowUpRight size={12} aria-hidden="true" />
          </button>
        )}
      </header>
      <ul className="turn-files__list">
        {(expanded ? files : files.slice(0, 3)).map((file) => {
          const normalized = file.path.replace(/\\/g, "/");
          const slashIdx = normalized.lastIndexOf("/");
          const base = slashIdx >= 0 ? normalized.slice(slashIdx + 1) : normalized;
          const dir = slashIdx >= 0 ? normalized.slice(0, slashIdx + 1) : "";
          return (
            <li key={file.path}>
              <button
                type="button"
                aria-label={file.path}
                disabled={!open}
                title={`在 Kooyu 中查看 ${file.path}`}
                onClick={() => open?.(file.path)}
              >
                <FileCode2 size={13} className="turn-files__file-icon" aria-hidden="true" />
                <span className="turn-files__basename" aria-hidden="true">
                  {base}
                </span>
                {dir && (
                  <span className="turn-files__dir" aria-hidden="true">
                    {dir}
                  </span>
                )}
              </button>
              <span className="turn-files__stats">
                {file.added !== undefined && (
                  <span className="turn-files__added">+{file.added}</span>
                )}
                {file.removed !== undefined && (
                  <span className="turn-files__removed">−{file.removed}</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {files.length > 3 && (
        <button
          type="button"
          className="turn-files__more"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "收起文件列表" : `再显示 ${files.length - 3} 个文件`}
          <ChevronDown size={13} aria-hidden="true" />
        </button>
      )}
    </section>
  );
}
