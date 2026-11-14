import { useCallback, useEffect, useState } from "react";
import { Plus, RefreshCw, Upload } from "lucide-react";
import type {
  HarnessId,
  HarnessSkill,
  HarnessSkillDirectory,
  HarnessSkillFile,
  HarnessSkillListing,
  Snapshot,
} from "@kodo/protocol";
import { api } from "../../lib/host-client";

export function SkillsBlock({
  harnessId,
  snapshot,
  canEdit,
}: {
  harnessId: HarnessId;
  snapshot: Snapshot;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false),
    [workspace, setWorkspace] = useState("");
  const [data, setData] = useState<HarnessSkillListing>(),
    [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [query, setQuery] = useState("");
  const [mode, setMode] = useState<"create" | "import" | "attach" | null>(null);
  const [editor, setEditor] = useState<HarnessSkillFile>();
  const endpoint = `/harnesses/${harnessId}/skills`,
    scope = workspace ? `?workspaceId=${encodeURIComponent(workspace)}` : "";
  const load = useCallback(async () => {
    setData(await api<HarnessSkillListing>(endpoint + scope));
  }, [endpoint, scope]);
  useEffect(() => {
    if (!open) return;
    let current = true;
    setLoading(true);
    setError("");
    setData(undefined);
    void api<HarnessSkillListing>(endpoint + scope)
      .then((result) => {
        if (current) setData(result);
      })
      .catch((e: Error) => {
        if (current) setError(e.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [open, endpoint, scope]);
  const run = async (work: () => Promise<unknown>, message?: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      await load();
      if (message) setNotice(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Skills 操作失败，请刷新后重试。");
    } finally {
      setBusy(false);
    }
  };
  const edit = (skill: HarnessSkill) =>
    void run(async () => {
      const separator = scope ? "&" : "?";
      setEditor(
        await api<HarnessSkillFile>(
          `${endpoint}/file${scope}${separator}path=${encodeURIComponent(skill.path)}`,
        ),
      );
    });
  const writable = data?.directories.filter((directory) => directory.writable) ?? [];
  const visible =
    data?.skills.filter((skill) =>
      `${skill.name} ${skill.description} ${skill.path}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
    ) ?? [];
  return (
    <details
      className="sx-more sx-skills"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Skills 管理{data ? ` · ${data.skills.length}` : ""}</summary>
      {open && (
        <div className="sx-skills__body">
          <p className="sx-note">
            管理已识别目录中的
            SKILL.md。修改在新对话或引擎重新加载后生效；原生禁用列表和权限设置仍可能限制加载。编辑前保留备份，移出时保留完整技能目录。
          </p>
          {!canEdit && (
            <p className="sx-note">请在运行 Host 的本机编辑或安装 Skills；此设备可查看。</p>
          )}
          <div className="sx-skills__toolbar">
            <label>
              目录范围
              <select
                aria-label="Skills 目录范围"
                value={workspace}
                disabled={busy || Boolean(editor) || Boolean(mode)}
                onChange={(event) => setWorkspace(event.target.value)}
              >
                <option value="">用户目录</option>
                {snapshot.workspaces.map((item) => (
                  <option key={item.id} value={item.id}>
                    用户 + {item.rootPath}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={busy || loading}
              onClick={() => void run(async () => {})}
            >
              <RefreshCw size={13} /> 刷新 Skills
            </button>
            {canEdit && (
              <>
                <button
                  type="button"
                  disabled={busy || Boolean(editor) || Boolean(mode) || !writable.length}
                  onClick={() => setMode("create")}
                >
                  <Plus size={13} /> 新建 Skill
                </button>
                <button
                  type="button"
                  disabled={busy || Boolean(editor) || Boolean(mode) || !writable.length}
                  onClick={() => setMode("import")}
                >
                  <Upload size={13} /> 导入本机 Skill
                </button>
                <button
                  type="button"
                  disabled={busy || Boolean(editor) || Boolean(mode)}
                  onClick={() => setMode("attach")}
                >
                  添加管理目录
                </button>
              </>
            )}
          </div>
          {error && (
            <p className="sx-note is-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="sx-note" role="status">
              {notice}
            </p>
          )}
          {loading && (
            <p className="sx-note" role="status">
              正在读取 Skills…
            </p>
          )}
          {data?.warnings.map((warning, index) => (
            <p className="sx-note" key={index}>
              {warning}
            </p>
          ))}
          {mode && (
            <SkillCreateForm
              key={mode}
              kind={mode}
              directories={writable}
              busy={busy}
              onCancel={() => setMode(null)}
              onSubmit={(body) =>
                run(
                  async () => {
                    if (mode === "attach")
                      await api(endpoint + "/directories" + scope, "POST", body);
                    else await api(endpoint + scope, "POST", body);
                    setMode(null);
                  },
                  mode === "attach"
                    ? "已添加管理目录；请确认引擎的原生配置会加载此路径。"
                    : "技能已保存，请新建对话或在引擎中重新加载 Skills。",
                )
              }
            />
          )}
          {editor && (
            <SkillEditor
              key={editor.path}
              file={editor}
              canEdit={canEdit}
              shared={Boolean(
                data?.directories.find((directory) => directory.path === editor.directory)?.shared,
              )}
              busy={busy}
              onCancel={() => setEditor(undefined)}
              onSave={(content) =>
                run(async () => {
                  setEditor(
                    await api<HarnessSkillFile>(endpoint + scope, "POST", {
                      operation: "save",
                      path: editor.path,
                      version: editor.version,
                      content,
                    }),
                  );
                }, "SKILL.md 已保存，原版本已备份。")
              }
            />
          )}
          {data && (
            <details className="sx-more">
              <summary>Skills 目录 · {data.directories.length}</summary>
              <ul className="sx-skills__directories">
                {data.directories.map((directory) => (
                  <li key={directory.path}>
                    <span>
                      <strong>{directory.label}</strong>
                      {directory.shared ? " · 共享" : ""}
                      {!directory.exists ? " · 尚未创建" : ""}
                      <code>{directory.path}</code>
                    </span>
                    {canEdit && directory.custom && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () =>
                              api(endpoint + "/directories" + scope, "DELETE", {
                                path: directory.path,
                              }),
                            "已移除管理目录，文件保持原样。",
                          )
                        }
                      >
                        取消管理
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {data && (
            <>
              <label className="sx-skills__search">
                搜索 Skills
                <input
                  type="search"
                  aria-label="搜索 Skills"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="名称、描述或路径"
                />
              </label>
              {!visible.length && (
                <p className="sx-note">
                  {query
                    ? "没有匹配的 Skills。"
                    : "此范围内尚未发现 SKILL.md，可以新建或导入技能。"}
                </p>
              )}
              <ul className="sx-skills__list" aria-label={`${harnessId} Skills 列表`}>
                {visible.map((skill) => {
                  const shared = data.directories.find(
                    (directory) => directory.path === skill.directory,
                  )?.shared;
                  return (
                    <li key={skill.path} className="sx-skill">
                      <div className="sx-skill__info">
                        <strong>{skill.name}</strong>
                        <span className="sx-file__tag">
                          {skill.enabled ? "已启用" : "已停用"}
                          {shared ? " · 共享" : ""}
                          {!skill.writable ? " · 只读" : ""}
                        </span>
                        {skill.description && <p>{skill.description}</p>}
                        <code>{skill.path}</code>
                        {skill.issue && <p className="sx-note is-error">{skill.issue}</p>}
                      </div>
                      <div className="sx-skill__actions">
                        <button
                          type="button"
                          disabled={busy || Boolean(mode) || Boolean(editor)}
                          onClick={() => edit(skill)}
                        >
                          {canEdit && skill.writable ? "编辑 Skill" : "查看 Skill"}
                        </button>
                        {canEdit && skill.writable && (
                          <>
                            <button
                              type="button"
                              disabled={busy || Boolean(editor)}
                              onClick={() =>
                                void run(
                                  () =>
                                    api(endpoint + scope, "POST", {
                                      operation: "toggle",
                                      path: skill.path,
                                      version: skill.version,
                                      enabled: !skill.enabled,
                                    }),
                                  `${skill.name} ${skill.enabled ? "已停用" : "已启用"}${shared ? "（共享目录同步生效）" : ""}。`,
                                )
                              }
                            >
                              {skill.enabled ? "停用 Skill" : "启用 Skill"}
                            </button>
                            <button
                              type="button"
                              disabled={busy || Boolean(editor)}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `将 ${skill.name} 移到 Host 的技能回收目录？${shared ? "这是共享技能，其他读取此目录的引擎也将无法发现它。" : ""}完整文件会保留，可手动移回恢复。`,
                                  )
                                )
                                  void run(async () => {
                                    const result = await api<{ path: string }>(
                                      endpoint + scope,
                                      "POST",
                                      {
                                        operation: "archive",
                                        path: skill.path,
                                        version: skill.version,
                                      },
                                    );
                                    setNotice(`已移出，恢复目录：${result.path}`);
                                  });
                              }}
                            >
                              移出 Skill
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}
    </details>
  );
}

function SkillCreateForm({
  kind,
  directories,
  busy,
  onCancel,
  onSubmit,
}: {
  kind: "create" | "import" | "attach";
  directories: HarnessSkillDirectory[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [directory, setDirectory] = useState(directories[0]?.path ?? ""),
    [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [body, setBody] = useState(""),
    [source, setSource] = useState("");
  return (
    <form
      className="sx-skills__editor"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit(
          kind === "attach"
            ? { path: source.trim() }
            : kind === "import"
              ? {
                  operation: "import",
                  directory,
                  source: source.trim(),
                  ...(name.trim() ? { name: name.trim() } : {}),
                }
              : {
                  operation: "create",
                  directory,
                  name: name.trim(),
                  content: `---\nname: ${JSON.stringify(name.trim())}\ndescription: ${JSON.stringify(description.trim())}\n---\n\n${body.trim()}\n`,
                },
        );
      }}
    >
      <h4>
        {kind === "create" ? "新建 Skill" : kind === "import" ? "导入本机 Skill" : "添加管理目录"}
      </h4>
      <fieldset disabled={busy}>
        {kind !== "attach" && (
          <label>
            目标 Skills 目录
            <select
              aria-label="目标 Skills 目录"
              value={directory}
              onChange={(event) => setDirectory(event.target.value)}
            >
              {directories.map((root) => (
                <option key={root.path} value={root.path}>
                  {root.label} · {root.path}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind !== "create" && (
          <label>
            {kind === "attach" ? "管理目录绝对路径" : "本机 Skill 源目录"}
            <input
              required
              aria-label={kind === "attach" ? "管理目录绝对路径" : "本机 Skill 源目录"}
              value={source}
              onChange={(event) => setSource(event.target.value)}
            />
          </label>
        )}
        {kind !== "attach" && (
          <label>
            技能目录名{kind === "import" ? "（留空沿用原目录名）" : ""}
            <input
              required={kind === "create"}
              aria-label="技能目录名"
              maxLength={64}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="小写字母、数字和连字符"
            />
          </label>
        )}
        {kind === "create" && (
          <>
            <label>
              技能描述
              <input
                required
                aria-label="技能描述"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <label>
              技能正文
              <textarea
                required
                aria-label="技能正文"
                rows={8}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder="写明何时使用、步骤和约束。"
              />
            </label>
          </>
        )}
        {kind === "import" && (
          <p className="sx-note">
            复制 SKILL.md 及脚本、参考资料等完整资源；不覆盖已有目录，不执行导入内容。
          </p>
        )}
        {kind === "attach" && (
          <p className="sx-note">这里只添加管理入口，不会修改引擎的原生加载配置。</p>
        )}
        {directories.find((root) => root.path === directory)?.shared && kind !== "attach" && (
          <p className="sx-note">这是共享目录，其他读取此目录的引擎也能发现该技能。</p>
        )}
        <div className="sx-form__actions">
          <button type="button" onClick={onCancel}>
            取消
          </button>
          <button className="primary">
            {busy
              ? "正在保存…"
              : kind === "import"
                ? "导入 Skill"
                : kind === "attach"
                  ? "添加目录"
                  : "保存新 Skill"}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
function SkillEditor({
  file,
  shared,
  canEdit,
  busy,
  onCancel,
  onSave,
}: {
  file: HarnessSkillFile;
  shared: boolean;
  canEdit: boolean;
  busy: boolean;
  onCancel: () => void;
  onSave: (content: string) => Promise<void>;
}) {
  const [text, setText] = useState(file.content);
  const dirty = text !== file.content;
  return (
    <form
      className="sx-skills__editor"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave(text);
      }}
    >
      <h4>
        {file.writable && canEdit ? "编辑" : "查看"} {file.name}
      </h4>
      <code>{file.path}</code>
      {shared && <p className="sx-note">共享目录：保存会影响其他读取此目录的引擎。</p>}
      <label>
        SKILL.md 内容
        <textarea
          aria-label="SKILL.md 内容"
          rows={14}
          readOnly={!file.writable || !canEdit}
          disabled={busy}
          spellCheck={false}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <div className="sx-form__actions">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (!dirty || window.confirm("放弃未保存的 Skill 修改？")) onCancel();
          }}
        >
          关闭编辑器
        </button>
        {canEdit && file.writable && (
          <button className="primary" disabled={busy || !dirty}>
            {busy ? "正在保存…" : "保存 Skill"}
          </button>
        )}
      </div>
    </form>
  );
}
