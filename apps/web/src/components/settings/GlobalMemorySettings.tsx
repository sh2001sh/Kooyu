import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  FileText,
  FolderOpen,
  Radar,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import type {
  AgentDoc,
  AgentDocName,
  ClientMutationReceipt,
  ConsolidationProposal,
  CuratedSkillRecord,
  GlobalMemorySettings as MemorySettings,
  HeartbeatStatus,
  KnowledgeMount,
  MemoryEntry,
  Snapshot,
} from "@kodo/protocol";
import { api, apiPath, HostError } from "../../lib/host-client";
import { SettingsPage, SettingsSection, SettingsRow, Toggle } from "./SettingsKit";

const DOC_ORDER: AgentDocName[] = [
  "SOUL.md",
  "USER.md",
  "MEMORY.md",
  "RULES.md",
  "HEARTBEAT.md",
  "AGENTS.md",
  "ROUTING.md",
];

const DOC_META: Record<AgentDocName, { label: string; hint: string }> = {
  "SOUL.md": {
    label: "SOUL.md",
    hint: "定义 Kooyu 主代理的人格、沟通风格与工作原则（下轮对话自动热加载，不影响 Host 安全边界）",
  },
  "USER.md": {
    label: "USER.md",
    hint: "记录你的称呼、技术栈、日常节奏与长期目标，跨所有会话自动生效",
  },
  "MEMORY.md": {
    label: "MEMORY.md",
    hint: "自由编写个人 Markdown 长期笔记；下方标记区块会与结构化全局记忆自动保持同步",
  },
  "RULES.md": {
    label: "RULES.md",
    hint: "自然语言行为边界（Ask 执行前先问我 / Allow 直接执行）；在决策卡点选「以后同类直接照做」会自动沉淀到这里",
  },
  "HEARTBEAT.md": {
    label: "HEARTBEAT.md",
    hint: "零 Token 全 Harness 健康巡检雷达配置与自定义预检脚本；一切正常时完全静默零打扰，有异常才提醒你",
  },
  "AGENTS.md": {
    label: "AGENTS.md",
    hint: "自我进化工程工作手册：沉淀跨项目构建/测试踩坑经验与交付规范，夜间记忆蒸馏也可向此提交待确认提案",
  },
  "ROUTING.md": {
    label: "ROUTING.md",
    hint: "多 Harness 智能路由与限流/配额耗尽自动接力链配置，让 Kooyu 自动为你选择最合适的编程引擎",
  },
};

export function GlobalMemorySettings({ hostId, snapshot }: { hostId: string; snapshot: Snapshot }) {
  const [settings, setSettings] = useState<MemorySettings>();
  const [projectId, setProjectId] = useState("");
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [docs, setDocs] = useState<AgentDoc[]>([]);
  const [heartbeat, setHeartbeat] = useState<HeartbeatStatus | null>(null);
  const [proposals, setProposals] = useState<ConsolidationProposal[]>([]);
  const [mounts, setMounts] = useState<KnowledgeMount[]>([]);
  const [curatedSkills, setCuratedSkills] = useState<CuratedSkillRecord[]>([]);
  const [mountLabel, setMountLabel] = useState("");
  const [mountPath, setMountPath] = useState("");
  const [patrolling, setPatrolling] = useState(false);
  const [activeDoc, setActiveDoc] = useState<AgentDocName>("SOUL.md");
  const [docDraft, setDocDraft] = useState("");
  const [docDirty, setDocDirty] = useState(false);
  const [copiedPath, setCopiedPath] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<MemoryEntry | null | undefined>();
  const editor = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (editing !== undefined) {
      editor.current?.scrollIntoView({ block: "start" });
      editor.current?.querySelector("input")?.focus({ preventScroll: true });
    }
  }, [editing]);
  const [subject, setSubject] = useState(""),
    [content, setContent] = useState(""),
    [sourceRefsText, setSourceRefsText] = useState("");
  const key = `kooyu.memory.receipt:${apiPath("")}:${hostId}`;
  const [pending, setPending] = useState<string | null>(() => localStorage.getItem(key));
  const reload = useCallback(async () => {
    const [config, memories, loadedDocs, hb, loadedProposals, loadedMounts, loadedSkills] =
      await Promise.all([
        api<MemorySettings>("/memory/settings"),
        api<MemoryEntry[]>(
          "/memory" + (projectId ? "?projectId=" + encodeURIComponent(projectId) : ""),
        ),
        api<AgentDoc[]>("/memory/docs").catch(() => [] as AgentDoc[]),
        api<HeartbeatStatus>("/heartbeat").catch(() => null),
        api<ConsolidationProposal[]>("/memory/proposals?status=pending").catch(
          () => [] as ConsolidationProposal[],
        ),
        api<KnowledgeMount[]>("/knowledge/mounts").catch(() => [] as KnowledgeMount[]),
        api<CuratedSkillRecord[]>("/skills/curated").catch(() => [] as CuratedSkillRecord[]),
      ]);
    setSettings(config);
    setEntries(
      memories.filter(
        (e) =>
          e.status !== "deleted" && (projectId ? e.projectId === projectId : e.scope === "user"),
      ),
    );
    setDocs(loadedDocs);
    setHeartbeat(hb);
    setProposals(loadedProposals);
    setMounts(loadedMounts);
    setCuratedSkills(loadedSkills);
  }, [projectId]);
  useEffect(() => {
    void reload().catch((e) => setError((e as Error).message));
  }, [reload]);

  const currentDoc = docs.find((d) => d.name === activeDoc);
  useEffect(() => {
    if (!currentDoc || docDirty) return;
    setDocDraft(currentDoc.content);
  }, [currentDoc, docDirty]);

  const switchDoc = (name: AgentDocName) => {
    if (name === activeDoc) return;
    if (
      docDirty &&
      !window.confirm(`当前 ${activeDoc} 有未保存的修改，切换将放弃未保存内容。继续？`)
    )
      return;
    const target = docs.find((d) => d.name === name);
    setActiveDoc(name);
    setDocDraft(target?.content ?? "");
    setDocDirty(false);
    setCopiedPath(false);
  };

  const clearPending = () => {
    localStorage.removeItem(key);
    setPending(null);
  };
  const checkReceipt = async () => {
    if (!pending) return;
    setBusy(true);
    setError("");
    try {
      const receipt = await api<ClientMutationReceipt>(`/client/operations/${pending}`);
      if (receipt.status === "confirmed" || receipt.status === "failed") {
        clearPending();
        await reload();
        if (receipt.status === "failed")
          throw new Error(receipt.error?.message ?? "保存失败，请刷新后重试。");
        setNotice("已核对保存结果。");
      } else setError("结果仍待核对，请先刷新记忆列表；不会自动重发。");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const mutate = async (path: string, method: "POST" | "PATCH", body: unknown) => {
    if (pending) return false;
    const requestId = crypto.randomUUID();
    setBusy(true);
    setError("");
    setNotice("");
    localStorage.setItem(key, requestId);
    setPending(requestId);
    try {
      const result = await api<ClientMutationReceipt>("/client/operations", "POST", {
        requestId,
        path: "/api" + path,
        method,
        body,
      });
      if (result.status === "confirmed" || result.status === "failed") clearPending();
      if (result.status !== "confirmed")
        throw new Error(result.error?.message ?? "保存结果未知，请核对回执。");
      await reload();
      setNotice("已保存，下轮生效。");
      return true;
    } catch (e) {
      if (e instanceof HostError) clearPending();
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const edit = (entry: MemoryEntry | null) => {
    setEditing(entry);
    setSubject(entry?.subject ?? "");
    setContent(entry?.content ?? "");
    setSourceRefsText(entry?.sourceRefs.join("\n") ?? "");
  };
  const saveEntry = (entry: MemoryEntry, status: "confirmed" | "deleted") =>
    mutate(`/memory/${entry.id}`, "PATCH", {
      expectedRevision: entry.revision,
      scope: entry.scope,
      projectId: entry.projectId,
      subject: entry.subject,
      content: entry.content,
      sourceRefs: entry.sourceRefs,
      status,
    });
  const selectedProject = snapshot.projects.find((p) => p.id === projectId);
  const disabled = busy || !!pending;
  return (
    <SettingsPage
      title="人格与记忆"
      description="管理主代理本地 SOUL.md、USER.md、MEMORY.md、RULES.md 与 HEARTBEAT.md 文档，以及自动同步的结构化记忆条目"
    >
      <div role="status" aria-live="polite" className={notice ? "remote-notice-banner" : undefined}>
        {notice}
      </div>
      {error && (
        <p className="sx-note is-error" role="alert">
          {error}
        </p>
      )}
      {docs.length > 0 && (
        <SettingsSection
          title="主代理文档 · SOUL / RULES / HEARTBEAT"
          description="保存在本机数据目录，既可在此编辑，也可用任意外部编辑器直接修改，下一轮对话即时热加载"
        >
          <div className="agent-docs-panel">
            <div className="agent-docs-bar">
              <div className="nx-segmented" role="tablist" aria-label="人格、规则与记忆文档">
                {DOC_ORDER.map((name) => (
                  <button
                    key={name}
                    type="button"
                    role="tab"
                    aria-selected={activeDoc === name}
                    aria-pressed={activeDoc === name}
                    onClick={() => switchDoc(name)}
                  >
                    {DOC_META[name].label}
                  </button>
                ))}
              </div>
              {currentDoc && (
                <div className="agent-docs-path">
                  <FileText size={13} aria-hidden="true" />
                  <code title={currentDoc.path}>{currentDoc.path}</code>
                  <button
                    type="button"
                    className="nx-btn nx-btn--sm nx-btn--ghost"
                    onClick={() => {
                      void navigator.clipboard?.writeText(currentDoc.path).then(() => {
                        setCopiedPath(true);
                        setTimeout(() => setCopiedPath(false), 1600);
                      });
                    }}
                  >
                    {copiedPath ? <Check size={12} /> : <Copy size={12} />}
                    <span>{copiedPath ? "已复制路径" : "复制路径"}</span>
                  </button>
                </div>
              )}
            </div>

            <p className="agent-docs-hint">{DOC_META[activeDoc].hint}</p>

            {activeDoc === "HEARTBEAT.md" && heartbeat && (
              <div className="agent-docs-foot" style={{ paddingTop: 0 }}>
                <span className="agent-docs-meta">
                  <Radar size={12} style={{ verticalAlign: "-2px", marginRight: 5 }} />零 Token
                  巡检雷达：{heartbeat.enabled ? "已开启" : "已关闭"} · 每{" "}
                  {heartbeat.intervalMinutes} 分钟 · 卡顿阈值 {heartbeat.stallMinutes} 分钟 ·{" "}
                  {heartbeat.activeAnomalies.length
                    ? `发现 ${heartbeat.activeAnomalies.length} 项异常`
                    : heartbeat.lastCheckedAt
                      ? "一切正常（静默）"
                      : "尚未巡检"}
                </span>
                <button
                  type="button"
                  className="nx-btn nx-btn--sm"
                  disabled={disabled || patrolling}
                  onClick={() => {
                    setPatrolling(true);
                    setError("");
                    void api<HeartbeatStatus>("/heartbeat/run", "POST", {})
                      .then((next) => {
                        setHeartbeat(next);
                        setNotice(
                          next.activeAnomalies.length
                            ? `零 Token 巡检完成：发现 ${next.activeAnomalies.length} 项需关注状态。`
                            : "零 Token 巡检完成：全部 Harness 与目标状态正常。",
                        );
                      })
                      .catch((e) => setError(e instanceof HostError ? e.message : "巡检失败"))
                      .finally(() => setPatrolling(false));
                  }}
                >
                  {patrolling ? "巡检中…" : "立即零 Token 巡检"}
                </button>
              </div>
            )}

            <textarea
              className="agent-docs-editor"
              aria-label={`${activeDoc} 内容`}
              rows={11}
              maxLength={32000}
              disabled={disabled || !currentDoc}
              value={docDraft}
              onChange={(e) => {
                setDocDraft(e.target.value);
                setDocDirty(e.target.value !== (currentDoc?.content ?? ""));
              }}
            />

            <div className="agent-docs-foot">
              <span className="agent-docs-meta">
                {docDraft.length.toLocaleString()} / 32,000 字符
                {docDirty ? " · 有未保存更改" : " · 已同步"}
              </span>
              <div className="actions">
                <button
                  type="button"
                  className="nx-btn nx-btn--sm"
                  disabled={disabled || !currentDoc}
                  onClick={() => {
                    if (!currentDoc) return;
                    if (!window.confirm(`将 ${activeDoc} 恢复为默认模板？`)) return;
                    void mutate(`/memory/docs/${activeDoc}/reset`, "POST", {}).then((ok) => {
                      if (ok) setDocDirty(false);
                    });
                  }}
                >
                  <RotateCcw size={12} />
                  恢复默认模板
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={disabled || !currentDoc || !docDirty}
                  onClick={() => {
                    if (!currentDoc) return;
                    void mutate(`/memory/docs/${activeDoc}`, "PATCH", {
                      expectedRevision: currentDoc.revision,
                      content: docDraft,
                    }).then((ok) => {
                      if (ok) setDocDirty(false);
                    });
                  }}
                >
                  保存 {activeDoc}
                </button>
              </div>
            </div>
          </div>
        </SettingsSection>
      )}
      <SettingsSection title="记忆适用范围">
        <SettingsRow label="适用范围" htmlFor="memory-scope-select">
          <select
            id="memory-scope-select"
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              setEditing(undefined);
              setError("");
              setNotice("");
            }}
          >
            <option value="">全局 · 所有项目</option>
            {snapshot.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </SettingsRow>
      </SettingsSection>
      {pending && (
        <SettingsSection title="待核对的保存操作">
          <SettingsRow label="保存结果待确认" description="请先核对回执，不会自动重发。">
            <button disabled={busy} onClick={() => void checkReceipt()}>
              核对保存结果
            </button>
            <button
              disabled={busy}
              onClick={() => {
                if (window.confirm("已核对列表中的实际结果？解除等待不会重新提交原操作。"))
                  clearPending();
              }}
            >
              已核对，解除等待
            </button>
          </SettingsRow>
        </SettingsSection>
      )}
      <SettingsSection title="记忆偏好">
        {!settings ? (
          <SettingsRow label="正在读取配置">
            <button onClick={() => void reload().catch((e) => setError((e as Error).message))}>
              重新读取
            </button>
          </SettingsRow>
        ) : (
          <>
            <SettingsRow label="启用全局记忆">
              <Toggle
                label="启用全局记忆"
                checked={settings.enabled}
                disabled={disabled}
                onChange={(enabled) =>
                  void mutate("/memory/settings", "PATCH", {
                    expectedRevision: settings.revision,
                    enabled,
                    automaticSaving: settings.automaticSaving,
                  })
                }
              />
            </SettingsRow>
            <SettingsRow label="自动保存对话记忆">
              <Toggle
                label="自动保存对话记忆"
                checked={settings.automaticSaving}
                disabled={disabled || !settings.enabled}
                onChange={(automaticSaving) =>
                  void mutate("/memory/settings", "PATCH", {
                    expectedRevision: settings.revision,
                    enabled: settings.enabled,
                    automaticSaving,
                  })
                }
              />
            </SettingsRow>
          </>
        )}
      </SettingsSection>
      <SettingsSection
        title={selectedProject ? `${selectedProject.name} · 项目约定` : "已保存的结构化全局记忆"}
        actions={
          <div className="actions">
            <button
              disabled={busy}
              onClick={() => void reload().catch((e) => setError((e as Error).message))}
            >
              刷新记忆
            </button>
            <button disabled={disabled} onClick={() => edit(null)}>
              {selectedProject ? "新增约定" : "新增记忆"}
            </button>
          </div>
        }
      >
        {settings && !entries.length && (
          <SettingsRow label={selectedProject ? "还没有项目约定" : "还没有全局记忆"} />
        )}
        {entries.map((entry) => (
          <SettingsRow
            key={entry.id}
            stacked
            label={entry.subject}
            description={entry.status === "confirmed" ? "已确认 · 下轮使用" : "待确认 · 尚未使用"}
          >
            <div className="global-memory-entry">
              <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{entry.content}</p>
              <details>
                <summary>查看来源</summary>
                {entry.sourceRefs.map((ref, i) => (
                  <p key={i} style={{ overflowWrap: "anywhere" }}>
                    {ref}
                  </p>
                ))}
              </details>
              <div className="actions">
                <button disabled={disabled} onClick={() => edit(entry)}>
                  编辑
                </button>
                {entry.status === "proposed" && (
                  <button disabled={disabled} onClick={() => void saveEntry(entry, "confirmed")}>
                    确认记忆
                  </button>
                )}
                <button
                  disabled={disabled}
                  onClick={() => {
                    if (window.confirm(`删除“${entry.subject}”？下轮起不再使用。`))
                      void saveEntry(entry, "deleted");
                  }}
                >
                  删除
                </button>
              </div>
            </div>
          </SettingsRow>
        ))}
      </SettingsSection>
      {editing !== undefined && (
        <form
          ref={editor}
          onSubmit={(e) => {
            e.preventDefault();
            const parsedSources = sourceRefsText
              .split(/\n+/)
              .map((line) => line.trim())
              .filter(Boolean);
            const resolvedSubject =
              subject.trim() || content.trim().split(/\n/)[0]?.slice(0, 200) || "长期约定";
            void mutate(editing ? `/memory/${editing.id}` : "/memory", editing ? "PATCH" : "POST", {
              scope: editing ? editing.scope : projectId ? "project" : "user",
              projectId: editing ? editing.projectId : projectId || null,
              subject: resolvedSubject,
              content,
              sourceRefs: parsedSources.length
                ? parsedSources
                : (editing?.sourceRefs ?? ["user:settings"]),
              status: "confirmed",
              ...(editing ? { expectedRevision: editing.revision } : {}),
            }).then((ok) => {
              if (ok) setEditing(undefined);
            });
          }}
        >
          <SettingsSection
            title={
              editing
                ? editing.scope === "project"
                  ? "编辑项目约定"
                  : "编辑记忆"
                : selectedProject
                  ? "新增项目约定"
                  : "新增记忆"
            }
          >
            <SettingsRow label="主题（可选）" htmlFor="global-memory-subject">
              <input
                id="global-memory-subject"
                maxLength={200}
                placeholder="留空则自动截取正文首行"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </SettingsRow>
            <SettingsRow label="约定内容" htmlFor="global-memory-content" stacked>
              <textarea
                id="global-memory-content"
                required
                rows={5}
                maxLength={12000}
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            </SettingsRow>
            <SettingsRow label="来源依据（可选）" stacked>
              <details>
                <summary>展开编辑补充来源（每行一条）</summary>
                <textarea
                  rows={2}
                  placeholder="例如：AGENTS.md 或对话来源说明"
                  value={sourceRefsText}
                  onChange={(e) => setSourceRefsText(e.target.value)}
                />
              </details>
            </SettingsRow>
            <SettingsRow label="保存后下轮生效">
              <button type="button" onClick={() => setEditing(undefined)}>
                取消
              </button>
              <button type="submit" disabled={disabled || !content.trim()}>
                保存并确认
              </button>
            </SettingsRow>
          </SettingsSection>
        </form>
      )}

      <SettingsSection
        title="记忆与手册蒸馏提案"
        description="从最近 7 天每日日志与 Goal 复盘中提取可沉淀条目；经你一键确认后才写入 MEMORY.md 或 AGENTS.md"
      >
        <div className="agent-docs-panel">
          <div className="agent-docs-foot" style={{ paddingTop: 0 }}>
            <span className="agent-docs-meta">
              <Sparkles size={12} style={{ verticalAlign: "-2px", marginRight: 5 }} />
              {proposals.length ? `待审阅 ${proposals.length} 条蒸馏提案` : "当前无待审阅提案"}
            </span>
            <button
              type="button"
              className="nx-btn nx-btn--sm"
              disabled={disabled}
              onClick={() => {
                setError("");
                void api<ConsolidationProposal[]>("/memory/proposals/generate", "POST", {})
                  .then((created) => {
                    setNotice(
                      created.length
                        ? `已提炼 ${created.length} 条新提案，请确认是否沉淀。`
                        : "扫描完成，暂无新的未收录规律。",
                    );
                    return reload();
                  })
                  .catch((e) => setError(e instanceof HostError ? e.message : "蒸馏失败"));
              }}
            >
              立即复盘提炼
            </button>
          </div>
          {proposals.map((p) => (
            <div key={p.id} className="agent-docs-foot">
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ fontSize: 13 }}>
                  [{p.targetDoc}] {p.title}
                </strong>
                <p className="agent-docs-hint" style={{ marginTop: 2 }}>
                  {p.content}
                </p>
              </div>
              <div className="actions">
                <button
                  type="button"
                  className="primary"
                  disabled={disabled}
                  onClick={() => {
                    void api(`/memory/proposals/${p.id}/approve`, "POST", {
                      requestId: crypto.randomUUID(),
                    })
                      .then(() => {
                        setNotice(`已沉淀至 ${p.targetDoc}，下轮对话自动生效。`);
                        return reload();
                      })
                      .catch((e) => setError(e instanceof HostError ? e.message : "确认失败"));
                  }}
                >
                  写入 {p.targetDoc}
                </button>
                <button
                  type="button"
                  className="nx-btn nx-btn--sm"
                  disabled={disabled}
                  onClick={() => {
                    void api(`/memory/proposals/${p.id}/dismiss`, "POST", {})
                      .then(() => reload())
                      .catch((e) => setError(e instanceof HostError ? e.message : "忽略失败"));
                  }}
                >
                  忽略
                </button>
              </div>
            </div>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection
        title="挂载本机知识目录（Obsidian / 项目文档）"
        description="零向量库负担，直接只读挂载本机 Markdown 或代码目录，Kooyu 主助手可按精确路径与行号即时检索引用"
      >
        <div className="agent-docs-panel">
          <div className="agent-docs-foot" style={{ paddingTop: 0 }}>
            <input
              placeholder="目录名称（如 Obsidian Vault）"
              value={mountLabel}
              onChange={(e) => setMountLabel(e.target.value)}
              style={{ flex: "0 1 200px" }}
            />
            <input
              placeholder="本机绝对路径（如 E:/Notes/Vault）"
              value={mountPath}
              onChange={(e) => setMountPath(e.target.value)}
              style={{ flex: 1, minWidth: 220 }}
            />
            <button
              type="button"
              className="primary"
              disabled={disabled || !mountLabel.trim() || !mountPath.trim()}
              onClick={() => {
                setError("");
                void api<KnowledgeMount>("/knowledge/mounts", "POST", {
                  requestId: crypto.randomUUID(),
                  label: mountLabel.trim(),
                  path: mountPath.trim(),
                })
                  .then(() => {
                    setMountLabel("");
                    setMountPath("");
                    setNotice("知识目录已挂载，主助手现在可直接检索引用。");
                    return reload();
                  })
                  .catch((e) => setError(e instanceof HostError ? e.message : "挂载失败"));
              }}
            >
              挂载目录
            </button>
          </div>
          {mounts.map((m) => (
            <div key={m.id} className="agent-docs-foot">
              <span className="agent-docs-path">
                <FolderOpen size={13} aria-hidden="true" />
                <strong>{m.label}</strong>
                <code title={m.path}>{m.path}</code>
              </span>
              <button
                type="button"
                className="nx-btn nx-btn--sm"
                disabled={disabled}
                onClick={() => {
                  void api(`/knowledge/mounts/${m.id}`, "DELETE")
                    .then(() => reload())
                    .catch((e) => setError(e instanceof HostError ? e.message : "移除失败"));
                }}
              >
                <Trash2 size={12} />
                移除
              </button>
            </div>
          ))}
        </div>
      </SettingsSection>

      {curatedSkills.length > 0 && (
        <SettingsSection
          title="跨 Harness 沉淀技能（支持 5 版回滚）"
          description="由成功任务提炼并可自动同步至 ~/.agents/skills 供全部编程引擎复用的版本化技能"
        >
          <div className="agent-docs-panel">
            {curatedSkills.map((sk) => (
              <div key={sk.name} className="agent-docs-foot">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: 13 }}>
                    {sk.title} (<code>{sk.name}</code> · v{sk.version})
                  </strong>
                  <p className="agent-docs-hint" style={{ marginTop: 2 }}>
                    {sk.description}
                    {sk.fromHarnessId ? ` · 来源：${sk.fromHarnessId}` : ""}
                    {sk.sharedPath ? " · 已分发跨引擎共享" : ""}
                  </p>
                </div>
                {sk.historyVersions.length > 0 && (
                  <button
                    type="button"
                    className="nx-btn nx-btn--sm"
                    disabled={disabled}
                    onClick={() => {
                      void api(`/skills/curated/${sk.name}/rollback`, "POST", {})
                        .then(() => {
                          setNotice(`技能 ${sk.name} 已回滚至历史版本。`);
                          return reload();
                        })
                        .catch((e) => setError(e instanceof HostError ? e.message : "回滚失败"));
                    }}
                  >
                    <RotateCcw size={12} />
                    回滚上一版
                  </button>
                )}
              </div>
            ))}
          </div>
        </SettingsSection>
      )}
    </SettingsPage>
  );
}
