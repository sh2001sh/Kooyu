import { WorkspaceTerminal } from "./WorkspaceTerminal";
import { GitDelivery } from "./GitDelivery";
import { useEffect, useMemo, useRef, useState } from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Code2,
  Download,
  ExternalLink,
  Eye,
  File,
  Folder,
  Globe,
  MessageSquarePlus,
  RefreshCw,
  Search,
  Share2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type {
  RuntimeEvent,
  Workspace,
  WorkspaceChanges,
  WorkspaceFileList,
  WorkspaceFilePreview,
  WorkspaceFileDiff,
} from "@kodo/protocol";
import { api, apiPath } from "../lib/host-client";
import { useT } from "../lib/i18n";
import { involvedFiles, workspaceLinkPath, workspaceErrorMessage } from "../lib/workspace-files";

function buildInteractiveArtifactDoc(name: string, content: string, token: string): string {
  const shim = `<script>(function(){var T=${JSON.stringify(token)};function send(m){try{parent.postMessage({type:"kooyu-artifact-error",token:T,message:String(m)},"*");}catch(e){}}var orig=console.error;console.error=function(){try{send(Array.prototype.slice.call(arguments).map(function(a){return typeof a==="object"?JSON.stringify(a):String(a)}).join(" "));}catch(e){}return orig&&orig.apply(console,arguments);};window.addEventListener("error",function(ev){send(ev.message+(ev.lineno?" (line "+ev.lineno+")":""));});window.addEventListener("unhandledrejection",function(ev){send("Unhandled promise rejection: "+(ev.reason&&ev.reason.message||ev.reason));});})();</script>`;
  if (/\.svg$/i.test(name)) {
    return `<!doctype html><html><head><meta charset="utf-8">${shim}<style>html,body{margin:0;height:100%;display:grid;place-items:center;background:#fff;overflow:auto;}svg{max-width:100%;max-height:100%;}</style></head><body>${content}</body></html>`;
  }
  if (/<head[\s>]/i.test(content)) {
    return content.replace(/<head([^>]*)>/i, `<head$1>${shim}`);
  }
  if (/<html[\s>]/i.test(content)) {
    return content.replace(/<html([^>]*)>/i, `<html$1><head>${shim}</head>`);
  }
  return `<!doctype html><html><head><meta charset="utf-8">${shim}</head><body>${content}</body></html>`;
}

const labels = {
  added: "新增",
  modified: "修改",
  deleted: "删除",
  renamed: "重命名",
  untracked: "未跟踪",
  conflict: "冲突",
};
const sizeLabel = (size: number) =>
  size < 1024
    ? size + " B"
    : size < 1024 * 1024
      ? (size / 1024).toFixed(1) + " KiB"
      : (size / 1024 / 1024).toFixed(1) + " MiB";
interface WorkspacePanelProps {
  workspace?: Workspace;
  mode: "files" | "changes";
  events: RuntimeEvent[];
  requestedPath?: string;
  requestKey?: number;
  onOpenFile: (path: string) => void;
  onSendToAgent?: (text: string) => void;
}
export function WorkspacePanel(props: WorkspacePanelProps) {
  if (!props.workspace)
    return (
      <div className="detail-empty-note">此会话未绑定工作位置。请先在会话详情中选择工作位置。</div>
    );
  return (
    <WorkspaceBrowser
      key={props.workspace.id + props.mode}
      {...props}
      workspace={props.workspace}
    />
  );
}
function WorkspaceBrowser({
  workspace,
  mode,
  events,
  requestedPath,
  requestKey = 0,
  onOpenFile,
  onSendToAgent,
}: WorkspacePanelProps & { workspace: Workspace }) {
  const t = useT();
  const [directory, setDirectory] = useState("");
  const [listing, setListing] = useState<WorkspaceFileList>();
  const [changes, setChanges] = useState<WorkspaceChanges>();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"workspace" | "session">("workspace");
  const [selected, setSelected] = useState("");
  const [preview, setPreview] = useState<WorkspaceFilePreview>();
  const [diff, setDiff] = useState<WorkspaceFileDiff>();
  const [sandbox, setSandbox] = useState("");
  const [devOpen, setDevOpen] = useState(false);
  const [devPort, setDevPort] = useState("");
  const [devPreview, setDevPreview] = useState("");
  const [devError, setDevError] = useState("");
  const [liveMode, setLiveMode] = useState(false);
  const [consoleErrors, setConsoleErrors] = useState<string[]>([]);
  const previewToken = useMemo(() => crypto.randomUUID(), [selected, preview?.modifiedAt]);
  const [source, setSource] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [revision, setRevision] = useState(0);
  const openGeneration = useRef(0);
  const base = "/workspaces/" + workspace.id;
  const relevant = involvedFiles(events);
  const lastOutput = events
    .filter((e) => ["tool", "turn-ended", "settled", "subagent"].includes(e.type))
    .at(-1)?.sequence;
  const [outputRevision, setOutputRevision] = useState(0);
  useEffect(() => {
    const timer = window.setTimeout(() => setOutputRevision((value) => value + 1), 400);
    return () => window.clearTimeout(timer);
  }, [lastOutput]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const load =
      mode === "changes"
        ? api<WorkspaceChanges>(base + "/changes").then((value) => {
            if (!cancelled) setChanges(value);
          })
        : api<WorkspaceFileList>(base + "/files?path=" + encodeURIComponent(directory)).then(
            (value) => {
              if (!cancelled) setListing(value);
            },
          );
    void load
      .catch((e) => {
        if (!cancelled) setError(workspaceErrorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [base, mode, directory, revision, outputRevision]);
  // External harness edits may not emit a file event; poll only while the panel is visible.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") setRevision((n) => n + 1);
    }, 8000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (requestedPath && mode === "files") {
      setSelected(requestedPath);
      setPreview(undefined);
      setZoom(1);
      setSource(false);
    }
  }, [requestedPath, requestKey, mode]);
  useEffect(() => {
    const generation = ++openGeneration.current;
    if (!selected) return;
    setOpening(true);
    setPreviewError("");
    const task =
      mode === "changes"
        ? api<WorkspaceFileDiff>(base + "/changes/diff?path=" + encodeURIComponent(selected)).then(
            (value) => {
              if (openGeneration.current === generation) setDiff(value);
            },
          )
        : api<WorkspaceFilePreview>(
            base + "/files/preview?path=" + encodeURIComponent(selected),
          ).then((value) => {
            if (openGeneration.current === generation) setPreview(value);
          });
    void task
      .catch((e) => {
        if (openGeneration.current === generation) {
          setPreview(undefined);
          setDiff(undefined);
          setPreviewError(workspaceErrorMessage(e));
        }
      })
      .finally(() => {
        if (openGeneration.current === generation) setOpening(false);
      });
    return () => {
      ++openGeneration.current;
    };
  }, [base, selected, mode, revision, outputRevision, requestKey]);
  useEffect(() => {
    setConsoleErrors([]);
    if (!liveMode) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; token?: string; message?: string } | null;
      if (data?.type !== "kooyu-artifact-error" || data.token !== previewToken || !data.message)
        return;
      setConsoleErrors((prev) =>
        prev.includes(data.message!) ? prev : [...prev.slice(-9), data.message!],
      );
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [liveMode, previewToken]);

  const open = (path: string) => {
    setSandbox("");
    setConsoleErrors([]);
    setLiveMode(/\.(html?|svg)$/i.test(path));
    setSelected(path);
    setPreview(undefined);
    setDiff(undefined);
    setPreviewError("");
    setZoom(1);
    setSource(false);
    if (mode === "files") onOpenFile(path);
  };
  const entries =
    scope === "session"
      ? relevant.map((path) => ({ name: path, path, kind: "file" as const }))
      : (listing?.entries ?? []);
  const visible = entries.filter((entry) =>
    entry.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const contentUrl = preview
    ? apiPath(base + "/files/content?path=" + encodeURIComponent(preview.path))
    : "";
  const markdown = /\.(md|markdown|mdown)$/i.test(preview?.name ?? "");
  const interactiveArtifact = Boolean(
    preview?.kind === "text" && /\.(html?|svg)$/i.test(preview.name),
  );
  return (
    <div className="workspace-browser">
      <div className="workspace-browser__toolbar">
        <span title={workspace.rootPath}>{mode === "changes" ? "工作区改动" : "工作区文件"}</span>
        <button
          type="button"
          className="icon-button"
          aria-label="刷新文件与改动"
          onClick={() => setRevision((n) => n + 1)}
        >
          <RefreshCw size={15} />
        </button>
      </div>
      <WorkspaceTerminal workspaceId={workspace.id} onSendToAgent={onSendToAgent} />
      {mode === "files" && (
        <section className="nx-card" aria-label={t("preview.devServer")}>
          <button
            type="button"
            className="nx-card__toggle"
            aria-expanded={devOpen}
            onClick={() => setDevOpen((v) => !v)}
          >
            <span className="nx-card__toggle-lead">
              <Globe size={15} />
              <span>{t("preview.devServer")}</span>
            </span>
            {devOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button>
          {devOpen && (
            <div className="nx-card__body">
              <form
                style={{ display: "flex", flexDirection: "column", gap: 8 }}
                onSubmit={async (event) => {
                  event.preventDefault();
                  setDevError("");
                  setDevPreview("");
                  try {
                    const share =
                      (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") ===
                      "share";
                    const result = await api<{ url: string }>(base + "/preview", "POST", {
                      port: Number(devPort),
                      share,
                    });
                    setDevPreview(result.url);
                  } catch (err) {
                    setDevError(workspaceErrorMessage(err));
                  }
                }}
              >
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span className="nx-section-label">{t("preview.localPort")}</span>
                  <input
                    className="nx-input"
                    type="number"
                    min="1024"
                    max="65535"
                    placeholder="5173"
                    required
                    value={devPort}
                    onChange={(event) => {
                      setDevPort(event.target.value);
                      setDevPreview("");
                    }}
                  />
                </label>
                <div className="delegation-card__actions">
                  <button type="submit" className="nx-btn nx-btn--sm nx-btn--primary">
                    <ExternalLink size={12} />
                    {t("preview.openLink")}
                  </button>
                  <button type="submit" value="share" className="nx-btn nx-btn--sm">
                    <Share2 size={12} />
                    {t("preview.shareLink")}
                  </button>
                </div>
              </form>
              {devPreview && (
                <a
                  className="nx-feedback nx-feedback--ok"
                  href={devPreview}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("preview.openTab")} · {devPreview}
                </a>
              )}
              {devError && (
                <p className="nx-feedback nx-feedback--error" role="alert">
                  {devError}
                </p>
              )}
            </div>
          )}
        </section>
      )}
      {mode === "files" ? (
        <>
          <div className="workspace-browser__scope" aria-label="文件范围">
            <button
              type="button"
              aria-pressed={scope === "workspace"}
              onClick={() => setScope("workspace")}
            >
              工作区
            </button>
            <button
              type="button"
              aria-pressed={scope === "session"}
              onClick={() => setScope("session")}
            >
              会话涉及{relevant.length ? " · " + relevant.length : ""}
            </button>
          </div>
          {scope === "workspace" && (
            <div className="workspace-browser__breadcrumb">
              <button
                type="button"
                disabled={!directory}
                onClick={() => setDirectory(directory.split("/").slice(0, -1).join("/"))}
                aria-label="上一级目录"
              >
                <ArrowLeft size={14} />
              </button>
              <button type="button" onClick={() => setDirectory("")}>
                根目录
              </button>
              <span title={directory}>{directory && " / " + directory}</span>
            </div>
          )}
          <label className="workspace-browser__search">
            <Search size={14} />
            <input
              aria-label="筛选文件"
              placeholder="筛选当前列表…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {scope === "session" && (
            <p className="workspace-browser__note">
              根据工具记录列出涉及文件，不代表均由本会话修改。
            </p>
          )}
          {error ? (
            <p role="alert" className="workspace-browser__error">
              {error}
            </p>
          ) : (
            <div className="workspace-browser__list" aria-label="文件列表" aria-busy={loading}>
              {visible.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  className={selected === entry.path ? "is-selected" : ""}
                  onClick={() =>
                    entry.kind === "directory"
                      ? (setDirectory(entry.path), setQuery(""))
                      : open(entry.path)
                  }
                  title={entry.path}
                >
                  {entry.kind === "directory" ? <Folder size={16} /> : <File size={16} />}
                  <span>{entry.name}</span>
                  {entry.kind === "directory" && <ChevronRight size={13} />}
                </button>
              ))}
              {!visible.length && (
                <p className="workspace-browser__note">
                  {loading && !listing
                    ? "正在读取文件…"
                    : query
                      ? "没有匹配文件。"
                      : scope === "session"
                        ? "尚无文件记录。可切换到工作区浏览文件。"
                        : "此文件夹为空。"}
                </p>
              )}
              {listing?.truncated && scope === "workspace" && (
                <p className="workspace-browser__note">
                  仅显示前 1,000 项，可进入子目录或直接输入文件路径。
                </p>
              )}
            </div>
          )}
          <form
            className="workspace-browser__path"
            onSubmit={(e) => {
              e.preventDefault();
              const value = String(new FormData(e.currentTarget).get("path") ?? "").trim();
              if (value) open(value);
            }}
          >
            <input name="path" aria-label="文件路径" placeholder="输入文件路径…" required />
            <button type="submit">打开</button>
          </form>
        </>
      ) : (
        <>
          <p className="workspace-browser__note">
            {changes?.git
              ? (changes.branch ?? "detached HEAD") +
                " · " +
                (changes.baseline === "HEAD" ? "对比 HEAD" : "尚无提交") +
                "；共享工作区，作者归属未知。"
              : loading
                ? "正在检查工作区…"
                : "此位置没有可读取的 Git 仓库，可切换到文件查看内容。"}
          </p>
          {(error || changes?.error) && (
            <p role="alert" className="workspace-browser__error">
              {error || changes?.error}
            </p>
          )}
          <div className="workspace-browser__list" aria-label="改动文件列表" aria-busy={loading}>
            {changes?.files.map((change) => (
              <button
                key={change.path}
                type="button"
                className={selected === change.path ? "is-selected" : ""}
                onClick={() => open(change.path)}
                title={
                  change.previousPath ? change.previousPath + " → " + change.path : change.path
                }
              >
                <span
                  className={"workspace-change-status workspace-change-status--" + change.status}
                >
                  {labels[change.status]}
                </span>
                <span>{change.path}</span>
              </button>
            ))}
            {changes?.git && !changes.error && !changes.files.length && (
              <p className="workspace-browser__note">
                {loading ? "正在检查改动…" : "工作区没有未提交改动。"}
              </p>
            )}
          </div>
        </>
      )}
      {mode === "changes" && changes?.git && (
        <GitDelivery
          key={workspace.id + selected}
          base={base}
          path={selected}
          refresh={() => setRevision((n) => n + 1)}
          onSendToAgent={onSendToAgent}
        />
      )}
      {selected && (
        <section className="workspace-preview" aria-label="文件预览" aria-busy={opening}>
          <div className="workspace-preview__header">
            <strong title={selected}>{preview?.name ?? selected}</strong>
            <div className="delegation-card__actions">
              {interactiveArtifact && (
                <div className="nx-segmented" role="group" aria-label="预览切换">
                  <button type="button" aria-pressed={!liveMode} onClick={() => setLiveMode(false)}>
                    <Code2 size={11} style={{ verticalAlign: "-1px", marginRight: 3 }} />
                    {t("preview.code")}
                  </button>
                  <button type="button" aria-pressed={liveMode} onClick={() => setLiveMode(true)}>
                    <Eye size={11} style={{ verticalAlign: "-1px", marginRight: 3 }} />
                    {t("preview.live")}
                  </button>
                </div>
              )}
              {/\.(html?|svg)$/i.test(selected) && (
                <button
                  type="button"
                  className="nx-btn nx-btn--sm"
                  onClick={async () => {
                    try {
                      const next = (
                        await api<{ url: string }>(base + "/preview", "POST", { path: selected })
                      ).url;
                      setSandbox(next);
                    } catch (e) {
                      setPreviewError(workspaceErrorMessage(e));
                    }
                  }}
                >
                  <ExternalLink size={11} />
                  {t("preview.isolated")}
                </button>
              )}
              <button
                type="button"
                className="nx-btn nx-btn--sm nx-btn--ghost"
                onClick={() => {
                  setSelected("");
                  setPreview(undefined);
                  setDiff(undefined);
                  setSandbox("");
                  setConsoleErrors([]);
                  if (mode === "files") onOpenFile("");
                }}
              >
                收起
              </button>
            </div>
          </div>
          {sandbox && (
            <a
              className="nx-feedback nx-feedback--ok"
              href={sandbox}
              target="_blank"
              rel="noreferrer"
            >
              {t("preview.openTab")} · {sandbox}
            </a>
          )}
          {opening && !preview && !diff ? (
            <p className="workspace-browser__note">正在加载预览…</p>
          ) : previewError ? (
            <p role="alert" className="workspace-browser__error">
              {previewError}
            </p>
          ) : mode === "changes" ? (
            <>
              <button
                type="button"
                className="workspace-preview__open"
                onClick={() => onOpenFile(selected)}
              >
                查看当前文件
              </button>
              <pre className="workspace-diff">
                {diff?.text.split("\n").map((line, i) => (
                  <span
                    key={i}
                    className={
                      line.startsWith("+")
                        ? "diff-add"
                        : line.startsWith("-")
                          ? "diff-remove"
                          : line.startsWith("@@")
                            ? "diff-hunk"
                            : ""
                    }
                  >
                    {line + "\n"}
                  </span>
                ))}
              </pre>
            </>
          ) : (
            preview && (
              <>
                <div className="workspace-preview__tools">
                  <small>{sizeLabel(preview.size)}</small>
                  {preview.size <= 32 * 1024 * 1024 && (
                    <a href={contentUrl + "&download=1"} download={preview.name}>
                      <Download size={13} />
                      下载
                    </a>
                  )}
                  {markdown && (
                    <button type="button" aria-pressed={source} onClick={() => setSource(!source)}>
                      {source ? "阅读预览" : "查看源码"}
                    </button>
                  )}
                  {preview.kind === "image" && (
                    <>
                      <button
                        type="button"
                        aria-label="缩小图片"
                        disabled={zoom <= 0.25}
                        onClick={() => setZoom((n) => Math.max(0.25, n - 0.25))}
                      >
                        <ZoomOut size={14} />
                      </button>
                      <button type="button" onClick={() => setZoom(1)}>
                        {Math.round(zoom * 100)}%
                      </button>
                      <button
                        type="button"
                        aria-label="放大图片"
                        disabled={zoom >= 4}
                        onClick={() => setZoom((n) => Math.min(4, n + 0.25))}
                      >
                        <ZoomIn size={14} />
                      </button>
                    </>
                  )}
                </div>
                {preview.kind === "text" ? (
                  interactiveArtifact && liveMode ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <iframe
                        key={previewToken}
                        title={preview.name}
                        className="nx-live-frame"
                        sandbox="allow-scripts"
                        srcDoc={buildInteractiveArtifactDoc(
                          preview.name,
                          preview.text ?? "",
                          previewToken,
                        )}
                      />
                      {consoleErrors.length > 0 && (
                        <div className="nx-console-tray" role="alert">
                          <div className="nx-row">
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
                                fontWeight: 600,
                              }}
                            >
                              <AlertTriangle size={13} />
                              <span>Console Errors ({consoleErrors.length})</span>
                            </span>
                            {onSendToAgent && (
                              <button
                                type="button"
                                className="nx-btn nx-btn--sm nx-btn--coral"
                                onClick={() =>
                                  onSendToAgent(
                                    `实时预览 \`${preview.path}\` 时捕获到前端控制台报错，请定位并修复：\n\`\`\`\n${consoleErrors.join("\n")}\n\`\`\``,
                                  )
                                }
                              >
                                <MessageSquarePlus size={12} />
                                {t("preview.sendConsoleErr")}
                              </button>
                            )}
                          </div>
                          <pre>{consoleErrors.join("\n")}</pre>
                        </div>
                      )}
                    </div>
                  ) : markdown && !source ? (
                    <PreviewMarkdown file={preview} base={base} onOpenFile={onOpenFile} />
                  ) : (
                    <pre className="workspace-preview__code">{preview.text}</pre>
                  )
                ) : preview.kind === "image" ? (
                  <div className="workspace-preview__image">
                    <img
                      src={contentUrl + "&v=" + encodeURIComponent(preview.modifiedAt)}
                      alt={preview.name}
                      style={{ width: zoom * 100 + "%", maxWidth: "none" }}
                      onError={() => setPreviewError("图片无法解码，请下载后查看或刷新文件。")}
                    />
                  </div>
                ) : preview.kind === "pdf" ? (
                  <object
                    className="workspace-preview__pdf"
                    data={contentUrl}
                    type="application/pdf"
                    aria-label={preview.name}
                  >
                    <p>当前浏览器无法内嵌 PDF，请使用下载查看。</p>
                  </object>
                ) : (
                  <p className="workspace-browser__note">{preview.reason}</p>
                )}
              </>
            )
          )}
        </section>
      )}
    </div>
  );
}
function PreviewMarkdown({
  file,
  base,
  onOpenFile,
}: {
  file: WorkspaceFilePreview;
  base: string;
  onOpenFile: (path: string) => void;
}) {
  const resolve = (url?: string) => {
    const path = workspaceLinkPath(url);
    return path && !/^(?:[a-z]:[\\/]|\/)/i.test(path)
      ? file.path.split("/").slice(0, -1).concat(path).join("/")
      : path;
  };
  return (
    <div className="markdown workspace-preview__markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => (workspaceLinkPath(url) ? url : defaultUrlTransform(url))}
        components={{
          a: ({ href, children }) => {
            const path = resolve(href);
            return path ? (
              <button type="button" className="file-preview-link" onClick={() => onOpenFile(path)}>
                {children}
              </button>
            ) : (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
          img: ({ src, alt }) => {
            const path = typeof src === "string" ? resolve(src) : null;
            return path ? (
              <img
                src={apiPath(base + "/files/content?path=" + encodeURIComponent(path))}
                alt={alt ?? ""}
              />
            ) : (
              <span>{alt || "外部图片"}</span>
            );
          },
        }}
      >
        {file.text}
      </Markdown>
    </div>
  );
}
