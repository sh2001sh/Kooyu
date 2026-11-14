import { useEffect, useState } from "react";
import { Pencil, X } from "lucide-react";
import type { HarnessId } from "@kodo/protocol";
import { api } from "../../lib/host-client";
import { useT } from "../../lib/i18n";

interface ConfigFile {
  path: string;
  exists: boolean;
  content: string;
  format: string;
  version: string;
}

/** The engine's config files, always visible; hover a row to edit it in a dialog. */
export function ConfigFiles({
  harnessId,
  files,
  canEdit,
}: {
  harnessId: HarnessId;
  files: { path: string; exists: boolean }[];
  canEdit: boolean;
}) {
  const t = useT();
  const [editing, setEditing] = useState<string | null>(null);
  if (!files.length) return null;
  return (
    <>
      <p className="sx-subhead">{t("engines.configFiles")}</p>
      <div className="sx-card">
        {files.map((f) => (
          <div className="sx-file" key={f.path}>
            <span className="sx-mono">{f.path}</span>
            {!f.exists && <span className="sx-file__tag">{t("engines.notCreated")}</span>}
            {canEdit && (
              <button
                type="button"
                className="sx-file__edit"
                aria-label={`${t("common.edit")} ${f.path}`}
                title={t("common.edit")}
                onClick={() => setEditing(f.path)}
              >
                <Pencil size={13} />
              </button>
            )}
          </div>
        ))}
      </div>
      {editing && (
        <ConfigFileDialog harnessId={harnessId} path={editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

function ConfigFileDialog({
  harnessId,
  path,
  onClose,
}: {
  harnessId: HarnessId;
  path: string;
  onClose: () => void;
}) {
  const t = useT();
  const [file, setFile] = useState<ConfigFile>();
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api<ConfigFile>(`/harnesses/${harnessId}/config-file?path=${encodeURIComponent(path)}`)
      .then((f) => {
        setFile(f);
        setText(f.content);
      })
      .catch((e: Error) => setError(e.message));
  }, [harnessId, path]);
  const dirty = file !== undefined && text !== file.content;
  const close = () => {
    if (dirty && !window.confirm(t("file.confirmDiscard"))) return;
    onClose();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const save = () => {
    if (!file) return;
    setBusy(true);
    setError("");
    void api<ConfigFile>(`/harnesses/${harnessId}/config-file`, "PUT", {
      path: file.path,
      content: text,
      version: file.version,
    })
      .then(() => onClose())
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <div
      className="sx-dialog-backdrop"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div className="sx-dialog" role="dialog" aria-modal="true" aria-label={t("file.title")}>
        <header className="sx-dialog__head">
          <div>
            <h3>{t("file.title")}</h3>
            <span className="sx-mono">{path}</span>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label={t("common.close")}
            onClick={close}
          >
            <X size={16} />
          </button>
        </header>
        <textarea
          className="sx-dialog__editor"
          spellCheck={false}
          autoFocus
          value={text}
          disabled={!file}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
              e.preventDefault();
              if (dirty) save();
            }
          }}
        />
        <footer className="sx-dialog__foot">
          <span className={error ? "sx-note is-error" : "sx-note"}>{error || t("file.desc")}</span>
          <button type="button" onClick={close} disabled={busy}>
            {dirty ? t("file.discard") : t("common.close")}
          </button>
          <button type="button" className="primary" disabled={!dirty || busy} onClick={save}>
            {busy ? t("save.saving") : t("save.save")}
          </button>
        </footer>
      </div>
    </div>
  );
}
