import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ClientMutationReceipt,
  GlobalMemorySettings as MemorySettings,
  MemoryEntry,
} from "@kodo/protocol";
import { api, apiPath, HostError } from "../../lib/host-client";
import { SettingsPage, SettingsSection, SettingsRow, Toggle } from "./SettingsKit";

export function GlobalMemorySettings({ hostId }: { hostId: string }) {
  const [settings, setSettings] = useState<MemorySettings>();
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
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
    [content, setContent] = useState("");
  const key = `kooyu.memory.receipt:${apiPath("")}:${hostId}`;
  const [pending, setPending] = useState<string | null>(() => localStorage.getItem(key));
  const reload = useCallback(async () => {
    const [config, memories] = await Promise.all([
      api<MemorySettings>("/memory/settings"),
      api<MemoryEntry[]>("/memory"),
    ]);
    setSettings(config);
    setEntries(memories.filter((e) => e.scope === "user"));
  }, []);
  useEffect(() => {
    void reload().catch((e) => setError((e as Error).message));
  }, [reload]);
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
  };
  const saveEntry = (entry: MemoryEntry, status: "confirmed" | "deleted") =>
    mutate(`/memory/${entry.id}`, "PATCH", {
      expectedRevision: entry.revision,
      scope: "user",
      projectId: null,
      subject: entry.subject,
      content: entry.content,
      sourceRefs: entry.sourceRefs,
      status,
    });
  const disabled = busy || !!pending;
  return (
    <SettingsPage
      title="全局记忆"
      description="Kooyu 主对话记住稳定偏好与长期约定，同一设备的桌面和已配对手机共用。"
    >
      <div role="status" aria-live="polite">
        {notice}
      </div>
      {error && (
        <p className="sx-note is-error" role="alert">
          {error}
        </p>
      )}
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
      <SettingsSection
        title="记忆偏好"
        description="设置立即保存；关闭后保留已有记忆，可随时重新启用。"
      >
        {!settings ? (
          <SettingsRow label="正在读取配置">
            <button onClick={() => void reload().catch((e) => setError((e as Error).message))}>
              重新读取
            </button>
          </SettingsRow>
        ) : (
          <>
            <SettingsRow
              label="启用全局记忆"
              description="在 Kooyu 主对话中使用并形成跨项目的用户偏好。关闭后不再读取或形成新记忆。"
            >
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
            <SettingsRow
              label="自动保存对话记忆"
              description="自动提炼稳定偏好并保存；关闭后，新记忆仅作为待确认建议。"
            >
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
        title="已保存的全局记忆"
        description="可在对话中说“记住我偏好……”或“忘记……”。项目资料保存在项目约定，临时任务进度不进入全局记忆。"
        actions={
          <div className="actions">
            <button
              disabled={busy}
              onClick={() => void reload().catch((e) => setError((e as Error).message))}
            >
              刷新全局记忆
            </button>
            <button disabled={disabled} onClick={() => edit(null)}>
              新增记忆
            </button>
          </div>
        }
      >
        {settings && !entries.length && (
          <SettingsRow
            label="还没有全局记忆"
            description="告诉 Kooyu 你的稳定偏好，或在这里手动添加。"
          />
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
            void mutate(editing ? `/memory/${editing.id}` : "/memory", editing ? "PATCH" : "POST", {
              scope: "user",
              projectId: null,
              subject,
              content,
              sourceRefs: editing?.sourceRefs ?? ["user:settings"],
              status: "confirmed",
              ...(editing ? { expectedRevision: editing.revision } : {}),
            }).then((ok) => {
              if (ok) setEditing(undefined);
            });
          }}
        >
          <SettingsSection title={editing ? "编辑记忆" : "新增记忆"}>
            <SettingsRow label="记忆主题" htmlFor="global-memory-subject">
              <input
                id="global-memory-subject"
                required
                maxLength={200}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </SettingsRow>
            <SettingsRow label="记忆内容" htmlFor="global-memory-content" stacked>
              <textarea
                id="global-memory-content"
                required
                rows={5}
                maxLength={12000}
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            </SettingsRow>
            <SettingsRow label="保存后下轮生效">
              <button type="button" onClick={() => setEditing(undefined)}>
                取消
              </button>
              <button type="submit" disabled={disabled || !subject.trim() || !content.trim()}>
                保存并确认
              </button>
            </SettingsRow>
          </SettingsSection>
        </form>
      )}
    </SettingsPage>
  );
}
