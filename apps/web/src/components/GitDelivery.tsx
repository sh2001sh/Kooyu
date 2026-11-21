import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  Layers,
  MinusCircle,
  PlusCircle,
  Sparkles,
  Trash2,
} from "lucide-react";
import { api } from "../lib/host-client";
import { useT } from "../lib/i18n";

export function GitDelivery({
  base,
  path,
  refresh,
  onSendToAgent,
}: {
  base: string;
  path: string;
  refresh: () => void;
  onSendToAgent?: (prompt: string) => void;
}) {
  const t = useT();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    text: string;
    tone: "neutral" | "ok" | "error";
    url?: string;
  } | null>(null);
  const [conflictFiles, setConflictFiles] = useState<string[]>([]);
  const [branches, setBranches] = useState<{ workspaceId: string; branchName: string }[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [hunks, setHunks] = useState<{ id: string; text: string }[]>([]);
  const [confirmTarget, setConfirmTarget] = useState<
    { kind: "file"; path: string } | { kind: "hunk"; path: string; id: string } | null
  >(null);

  useEffect(() => {
    if (!expanded) return;
    let current = true;
    api<typeof branches>(base + "/git/branches").then(
      (rows) => {
        if (current) setBranches(rows);
      },
      (error) => {
        if (current) setFeedback({ text: String(error), tone: "error" });
      },
    );
    return () => {
      current = false;
    };
  }, [expanded, base]);

  useEffect(() => {
    setHunks([]);
    setConfirmTarget(null);
    setFeedback(null);
  }, [path, base]);

  async function run(action: string, body: Record<string, unknown>) {
    setBusy(true);
    setFeedback(null);
    setConflictFiles([]);
    setConfirmTarget(null);
    try {
      const result = await api(base + "/git/" + action, "POST", body);
      if (action === "hunks") {
        const list = result as typeof hunks;
        setHunks(list);
        if (!list.length) setFeedback({ text: t("git.noHunks"), tone: "neutral" });
      } else if (action === "suggest-message") {
        const suggested = (result as { message?: string }).message ?? "";
        if (suggested) setMessage(suggested);
      } else if (action === "pr") {
        const prUrl = String((result as { url: string }).url);
        setFeedback({ text: prUrl, tone: "ok", url: prUrl });
        refresh();
      } else {
        setHunks([]);
        setFeedback({ text: t("git.done"), tone: "ok" });
        refresh();
      }
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      if (text.startsWith("MERGE_CONFLICT:")) {
        setConflictFiles(
          text
            .slice("MERGE_CONFLICT:".length)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        );
        setFeedback({
          text: `合入存在冲突：${text.slice("MERGE_CONFLICT:".length)}`,
          tone: "error",
        });
      } else {
        setFeedback({ text, tone: "error" });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="nx-card" aria-label={t("git.title")}>
      <button
        type="button"
        className="nx-card__toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="nx-card__toggle-lead">
          <GitCommitHorizontal size={15} />
          <span>{t("git.title")}</span>
        </span>
        {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      </button>

      {expanded && (
        <div className="nx-card__body">
          {branches.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="nx-section-label">{t("git.worktrees")}</span>
              {branches.map(({ workspaceId, branchName }) => (
                <div className="nx-row" key={workspaceId}>
                  <span className="nx-code-pill">
                    <GitBranch size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} />
                    {branchName}
                  </span>
                  <div className="delegation-card__actions">
                    <button
                      type="button"
                      className="nx-btn nx-btn--sm"
                      disabled={busy}
                      onClick={() => void run("merge", { worktreeId: workspaceId, mode: "ff" })}
                    >
                      <GitMerge size={12} />
                      {t("git.mergeFf")}
                    </button>
                    <button
                      type="button"
                      className="nx-btn nx-btn--sm"
                      disabled={busy}
                      onClick={() => void run("merge", { worktreeId: workspaceId, mode: "squash" })}
                    >
                      {t("git.mergeSquash")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {conflictFiles.length > 0 && (
            <div className="nx-confirm-bar">
              <span>冲突文件：{conflictFiles.join("、")}</span>
              <div className="delegation-card__actions">
                <button
                  type="button"
                  className="nx-btn nx-btn--sm"
                  disabled={busy}
                  onClick={() => void run("abort-merge", {})}
                >
                  {t("git.abortMerge")}
                </button>
                {onSendToAgent && (
                  <button
                    type="button"
                    className="nx-btn nx-btn--sm nx-btn--coral"
                    onClick={() =>
                      onSendToAgent(
                        `当前工作区 Git 合入产生冲突，请检查并解决以下文件的冲突，然后运行测试验证：\n${conflictFiles.map((f) => `- ${f}`).join("\n")}`,
                      )
                    }
                  >
                    {t("git.askAgentConflict")}
                  </button>
                )}
              </div>
            </div>
          )}

          {path && (
            <div className="delegation-card__actions">
              <button
                type="button"
                className="nx-btn nx-btn--sm"
                disabled={busy}
                onClick={() => void run("stage", { path })}
              >
                <PlusCircle size={12} />
                {t("git.stageFile")}
              </button>
              <button
                type="button"
                className="nx-btn nx-btn--sm"
                disabled={busy}
                onClick={() => void run("unstage", { path })}
              >
                <MinusCircle size={12} />
                {t("git.unstageFile")}
              </button>
              <button
                type="button"
                className="nx-btn nx-btn--sm"
                disabled={busy}
                onClick={() => void run("hunks", { path })}
              >
                <Layers size={12} />
                {t("git.loadHunks")}
              </button>
              <button
                type="button"
                className="nx-btn nx-btn--sm nx-btn--danger"
                disabled={busy}
                onClick={() => setConfirmTarget({ kind: "file", path })}
              >
                <Trash2 size={12} />
                {t("git.discardFile")}
              </button>
            </div>
          )}

          {confirmTarget && (
            <div className="nx-confirm-bar" role="alert">
              <span>{t("git.confirmDiscard")}</span>
              <div className="delegation-card__actions">
                <button
                  type="button"
                  className="nx-btn nx-btn--sm"
                  onClick={() => setConfirmTarget(null)}
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  className="nx-btn nx-btn--sm nx-btn--danger"
                  disabled={busy}
                  onClick={() =>
                    confirmTarget.kind === "file"
                      ? void run("discard-file", { path: confirmTarget.path, confirmed: true })
                      : void run("discard-hunk", {
                          path: confirmTarget.path,
                          id: confirmTarget.id,
                          confirmed: true,
                        })
                  }
                >
                  {t("git.confirmYes")}
                </button>
              </div>
            </div>
          )}

          {hunks.map((h) => (
            <div className="nx-hunk-card" key={h.id}>
              <pre className="workspace-diff">
                {h.text.split("\n").map((line, i) => (
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
                    {line}
                    {"\n"}
                  </span>
                ))}
              </pre>
              <div className="nx-hunk-card__bar">
                <button
                  type="button"
                  className="nx-btn nx-btn--sm"
                  disabled={busy}
                  onClick={() => void run("stage-hunk", { path, id: h.id })}
                >
                  {t("git.stageHunk")}
                </button>
                <button
                  type="button"
                  className="nx-btn nx-btn--sm nx-btn--danger"
                  disabled={busy}
                  onClick={() => setConfirmTarget({ kind: "hunk", path, id: h.id })}
                >
                  {t("git.discardHunk")}
                </button>
              </div>
            </div>
          ))}

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div className="nx-row">
              <span className="nx-section-label">Commit / PR</span>
              <button
                type="button"
                className="nx-btn nx-btn--sm nx-btn--ghost"
                disabled={busy}
                onClick={() => void run("suggest-message", {})}
              >
                <Sparkles size={12} />
                {t("git.suggestMsg")}
              </button>
            </div>
            <input
              className="nx-input"
              aria-label={t("git.msgPlaceholder")}
              placeholder={t("git.msgPlaceholder")}
              value={message}
              disabled={busy}
              onChange={(e) => setMessage(e.target.value)}
            />
            <div className="delegation-card__actions">
              <button
                type="button"
                className="nx-btn nx-btn--sm nx-btn--primary"
                disabled={busy || !message.trim()}
                onClick={() => void run("commit", { message })}
              >
                <GitCommitHorizontal size={13} />
                {t("git.commit")}
              </button>
              <button
                type="button"
                className="nx-btn nx-btn--sm"
                disabled={busy || !message.trim()}
                onClick={() => void run("pr", { title: message, body: "" })}
              >
                <GitPullRequest size={13} />
                {t("git.createPr")}
              </button>
            </div>
          </div>

          {feedback && (
            <p
              className={`nx-feedback ${
                feedback.tone === "error"
                  ? "nx-feedback--error"
                  : feedback.tone === "ok"
                    ? "nx-feedback--ok"
                    : ""
              }`}
              role="status"
            >
              {feedback.url ? (
                <a href={feedback.url} target="_blank" rel="noreferrer">
                  {feedback.url}
                </a>
              ) : (
                feedback.text
              )}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
