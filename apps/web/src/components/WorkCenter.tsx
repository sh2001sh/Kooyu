import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Plus } from "lucide-react";
import type { Automation, AuthorizationGrant, MemoryEntry, Snapshot } from "@kodo/protocol";
import { scheduleEditorValue, editorTrigger, describeAutomationSchedule } from "@kodo/protocol";
import { ScheduleFields } from "./ScheduleFields";
import { DateTimeSelection } from "./DateTimeSelection";
import { api, hostPath } from "../lib/host-client";
import { SettingsPage, SettingsSection, StatusDot } from "./settings/SettingsKit";
import { Modal } from "./Motion";
import "../styles/work-center.css";
type Row = Record<string, any>;
type Tab = "plans" | "apps" | "memory" | "environments" | "notifications" | "activity";
const tabs: [Tab, string][] = [
  ["plans", "计划"],
  ["apps", "应用与授权"],
  ["memory", "项目记忆"],
  ["environments", "执行环境"],
  ["notifications", "通知"],
  ["activity", "运行与核对"],
];
const words = (value: string) =>
  value
    .split(/[\n,]+/)
    .map((x) => x.trim())
    .filter(Boolean);
const stamp = (s?: string | null) => (s ? new Date(s).toLocaleString() : "—");
const state = (s: string) =>
  ({
    accepted: "已接收",
    dispatched: "已派发",
    confirmed: "已确认",
    unknown: "结果未知",
    cancelled: "已取消",
    pending: "待处理",
    sent: "已送达",
    withdrawn: "已撤回",
    failed: "失败",
    suppressed: "前台已接收",
    observed: "仅观察",
    activated: "已触发",
    online: "在线",
    offline: "离线",
    proposed: "待确认",
    confirmedMemory: "已确认",
  })[s] ?? s;
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="work-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return <p className="work-empty">{children}</p>;
}
function PayloadForm({
  title,
  initial,
  onSubmit,
  button = "保存配置",
  disabled = false,
}: {
  title: string;
  initial: Row;
  onSubmit: (v: Row) => Promise<unknown>;
  button?: string;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(JSON.stringify(initial, null, 2));
  return (
    <details className="work-details">
      <summary>{title}</summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            const p = JSON.parse(value);
            void onSubmit(p);
          } catch {
            e.currentTarget.querySelector("textarea")?.setCustomValidity("请输入有效 JSON 对象");
          }
        }}
      >
        <Field label={title + " JSON"}>
          <textarea
            rows={9}
            value={value}
            onChange={(e) => {
              e.target.setCustomValidity("");
              setValue(e.target.value);
            }}
            spellCheck={false}
          />
        </Field>
        <button disabled={disabled}>{button}</button>
      </form>
    </details>
  );
}
export function WorkCenter({ snapshot }: { snapshot: Snapshot }) {
  const [tab, setTab] = useState<Tab>("plans"),
    [controller, setController] = useState(
      snapshot.sessions.find((s) => s.kind === "supervisor")?.id ?? "",
    );
  const session = snapshot.sessions.find((s) => s.id === controller),
    projectId = session?.projectId ?? null;
  const [data, setData] = useState<Row>({}),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [token, setToken] = useState<Row | null>(null),
    [detail, setDetail] = useState<Row[] | null>(null),
    [preview, setPreview] = useState<string[]>([]);
  const locked = useRef(false),
    mounted = useRef(true),
    request = useRef(0);
  const [plan, setPlan] = useState<Row>({
    name: "",
    promptTemplate: "",
    timing: scheduleEditorValue(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    executorId: "local",
    grantId: "",
    maxRuns: "0",
    maxCostUsd: "0",
    misfirePolicy: "coalesce",
  });
  const [memory, setMemory] = useState<Row>({
    subject: "",
    content: "",
    sourceRefs: "user:work-center",
  });
  const [app, setApp] = useState<Row>({
    applicationId: "github",
    version: "1.0.0",
    name: "",
    token: "",
    auth: "token",
  });
  const [grant, setGrant] = useState({
    connectionId: "",
    operations: "",
    resources: "",
    expiresAt: "",
  });
  const [oauthLink, setOAuthLink] = useState<string | null>(null);
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [appModalOpen, setAppModalOpen] = useState(false);
  const [grantModalOpen, setGrantModalOpen] = useState(false);
  const [memoryModalOpen, setMemoryModalOpen] = useState(false);
  const controllers = snapshot.sessions.filter((s) => s.kind === "supervisor" && !s.archived);
  const local = data.status?.localAdministrator === true;
  const load = useCallback(async () => {
    const generation = ++request.current;
    const endpoints: Record<string, string> = {
      status: "/work/status",
      plans: "/automations",
      grants: "/grants",
      apps: "/applications",
      memory: "/memory" + (projectId ? "?projectId=" + projectId : ""),
      browsers: "/browsers",
      executors: "/executors",
      channels: "/notification-channels",
      apns: "/notification-providers/apns",
      outbound: "/outbound-messages",
      receipts: "/action-receipts",
    };
    const entries = Object.entries(endpoints),
      results = await Promise.allSettled(entries.map(([, p]) => api(p)));
    if (!mounted.current || generation !== request.current) return;
    const next: Row = {};
    let failed = "";
    results.forEach((r, i) => {
      if (r.status === "fulfilled") next[entries[i]![0]] = r.value;
      else failed = r.reason instanceof Error ? r.reason.message : "读取失败";
    });
    setData((old) => ({ ...old, ...next }));
    setLoading(false);
    if (failed) setError("部分数据读取失败：" + failed);
  }, [projectId]);
  useEffect(() => {
    mounted.current = true;
    void load();
    const timer = setInterval(() => void load(), 10000);
    return () => {
      mounted.current = false;
      request.current++;
      clearInterval(timer);
    };
  }, [load]);
  const perform = async (work: () => Promise<unknown>, message = "已保存") => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await work();
      if (mounted.current) {
        setNotice(message);
        await load();
      }
      return result;
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : "操作失败，请刷新后核对结果。");
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const submit = (e: FormEvent, work: () => Promise<unknown>, message?: string) => {
    e.preventDefault();
    void perform(work, message);
  };
  const ownGrants: AuthorizationGrant[] = (data.grants ?? []).filter(
    (g: AuthorizationGrant) => g.controllerSessionId === controller && !g.revoked,
  );
  const eligible = ownGrants.filter(
    (g) =>
      g.operations.includes("automation.execute") && g.resources.includes("session:" + controller),
  );
  const plans: Automation[] = (data.plans ?? []).filter(
    (a: Automation) => a.controllerSessionId === controller,
  );
  const planBody = () => ({
    requestId: crypto.randomUUID(),
    controllerSessionId: controller,
    name: plan.name,
    promptTemplate: plan.promptTemplate,
    trigger: editorTrigger(plan.timing),
    timeZone: plan.timeZone,
    executorId: plan.executorId ?? "local",
    grantId: plan.grantId || eligible[0]?.id,
    misfirePolicy: plan.misfirePolicy,
    enabled: plan.id ? plan.enabled : true,
    limits: {
      ...(plan.maxRuns ? { maxRuns: Number(plan.maxRuns) } : {}),
      ...(plan.maxCostUsd ? { maxCostUsd: Number(plan.maxCostUsd) } : {}),
    },
    ...(plan.id ? { expectedRevision: plan.revision } : {}),
  });
  const connections: Row[] = data.apps?.connections ?? [];
  const versions: Row[] = data.apps?.versions ?? [];
  const selectedConnection = connections.find((c) => c.id === grant.connectionId);
  const remember = (entry?: MemoryEntry) => {
    setMemory(
      entry
        ? { ...entry, sourceRefs: entry.sourceRefs.join("\n") }
        : { subject: "", content: "", sourceRefs: "user:work-center" },
    );
  };
  const saveMemory = (status = "confirmed", entry = memory) =>
    api("/memory" + (entry.id ? "/" + entry.id : ""), entry.id ? "PATCH" : "POST", {
      requestId: crypto.randomUUID(),
      scope: entry.id ? entry.scope : projectId ? "project" : "user",
      projectId: entry.id ? entry.projectId : projectId,
      subject: entry.subject,
      content: entry.content,
      sourceRefs: typeof entry.sourceRefs === "string" ? words(entry.sourceRefs) : entry.sourceRefs,
      status,
      ...(entry.id ? { expectedRevision: entry.revision } : {}),
    });
  const internal = async (action: string, body?: Row) => {
    const r = await fetch(hostPath + "/internal/" + action, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      }),
      value = await r.json();
    if (!r.ok) throw new Error(value.error?.message ?? "运维操作失败");
    return value;
  };
  return (
    <SettingsPage
      title="工作中心"
      actions={
        <button disabled={busy || loading} onClick={() => void perform(load, "已刷新")}>
          刷新
        </button>
      }
    >
      <div className="work-center">
        <div className="work-context">
          <Field label="管理的主对话">
            <select
              value={controller}
              onChange={(e) => {
                setController(e.target.value);
                setPlan((p) => ({ ...p, id: undefined, grantId: "" }));
                setDetail(null);
                setMemory({ subject: "", content: "", sourceRefs: "user:work-center" });
              }}
            >
              <option value="">请选择主对话</option>
              {controllers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </Field>
          <p>
            {session?.projectId
              ? snapshot.projects.find((p) => p.id === session.projectId)?.name
              : "全局范围"}
          </p>
        </div>
        <nav className="work-tabs" aria-label="工作中心分类">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-current={tab === id ? "page" : undefined}
              onClick={() => {
                setTab(id);
                setError("");
                setNotice("");
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="work-notice" role="status">
            {notice}
          </p>
        )}
        {loading && <p role="status">正在读取工作配置…</p>}
        {!controller && <Empty>请选择主对话。</Empty>}
        {tab === "plans" && (
          <>
            <SettingsSection
              title="定时任务"
              actions={
                <button
                  type="button"
                  className="primary"
                  disabled={busy || !controller}
                  onClick={() => {
                    setPlan({
                      name: "",
                      promptTemplate: "",
                      timing: scheduleEditorValue(),
                      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                      executorId: "local",
                      grantId: "",
                      maxRuns: "0",
                      maxCostUsd: "0",
                      misfirePolicy: "coalesce",
                    });
                    setPreview([]);
                    setPlanModalOpen(true);
                  }}
                >
                  <Plus size={14} />
                  <span>新建计划</span>
                </button>
              }
            >
              {!plans.length && <Empty>暂无计划。</Empty>}
              {plans.map((a) => (
                <div className="work-row" key={a.id}>
                  <div>
                    <strong>{a.name}</strong>
                    <p>
                      <StatusDot tone={a.enabled ? "ok" : "off"}>
                        {a.enabled ? "已启用" : "已暂停"}
                      </StatusDot>{" "}
                      · {describeAutomationSchedule(a.trigger)} · {a.timeZone} · 下次{" "}
                      {stamp(a.nextDueAt)}
                    </p>
                    <p>{a.promptTemplate}</p>
                  </div>
                  <div className="work-actions">
                    <button
                      disabled={busy}
                      onClick={() => {
                        setPlan({
                          ...a,
                          timing: scheduleEditorValue(a.trigger),
                          maxRuns: a.limits.maxRuns ?? 0,
                          maxCostUsd: a.limits.maxCostUsd ?? 0,
                        });
                        setPreview([]);
                        setPlanModalOpen(true);
                      }}
                    >
                      编辑
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void perform(
                          () =>
                            a.enabled
                              ? api("/automations/" + a.id + "/pause", "POST", {
                                  expectedRevision: a.revision,
                                })
                              : api("/automations/" + a.id, "PATCH", {
                                  ...a,
                                  requestId: crypto.randomUUID(),
                                  expectedRevision: a.revision,
                                  enabled: true,
                                  id: undefined,
                                  revision: undefined,
                                  dispatchGeneration: undefined,
                                  effectiveAt: undefined,
                                  nextDueAt: undefined,
                                  createdAt: undefined,
                                  updatedAt: undefined,
                                }),
                          a.enabled ? "计划已暂停；当前运行保留" : "计划已启用",
                        )
                      }
                    >
                      {a.enabled ? "暂停计划" : "启用计划"}
                    </button>
                    <button
                      disabled={busy || !a.enabled}
                      onClick={() =>
                        void perform(
                          () =>
                            api("/automations/" + a.id + "/run", "POST", {
                              requestId: crypto.randomUUID(),
                            }),
                          "已登记本次执行",
                        )
                      }
                    >
                      运行一次
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void perform(
                          async () =>
                            setDetail(await api<Row[]>("/automations/" + a.id + "/activations")),
                          "已读取发生记录",
                        )
                      }
                    >
                      发生记录
                    </button>
                  </div>
                </div>
              ))}
              {detail && (
                <div className="work-list" aria-label="计划发生记录">
                  {detail.length ? (
                    detail.map((a) => (
                      <p key={a.id}>
                        {stamp(a.scheduledFor)} · {state(a.status)} · 目标 {a.goalId ?? "尚未创建"}
                      </p>
                    ))
                  ) : (
                    <Empty>尚无发生记录。</Empty>
                  )}
                </div>
              )}
            </SettingsSection>
            {planModalOpen && (
              <Modal
                title={plan.id ? "编辑计划" : "新建计划"}
                onClose={() => {
                  setPlanModalOpen(false);
                  setPreview([]);
                }}
              >
                <form
                  className="work-form work-modal-form"
                  onSubmit={(e) =>
                    submit(
                      e,
                      async () => {
                        await api(
                          "/automations" + (plan.id ? "/" + plan.id : ""),
                          plan.id ? "PATCH" : "POST",
                          planBody(),
                        );
                        setPlan((p) => ({ ...p, id: undefined, name: "", promptTemplate: "" }));
                        setPreview([]);
                        setPlanModalOpen(false);
                      },
                      "计划已保存",
                    )
                  }
                >
                  <Field label="计划名称">
                    <input
                      required
                      placeholder="例如：每周项目汇总"
                      maxLength={100}
                      value={plan.name}
                      onChange={(e) => setPlan({ ...plan, name: e.target.value })}
                    />
                  </Field>
                  <Field label="工作内容与验收要求">
                    <textarea
                      required
                      rows={4}
                      value={plan.promptTemplate}
                      onChange={(e) => setPlan({ ...plan, promptTemplate: e.target.value })}
                    />
                  </Field>
                  <ScheduleFields
                    value={plan.timing}
                    onChange={(timing) => {
                      setPlan({ ...plan, timing });
                      setPreview([]);
                    }}
                    zone={plan.timeZone}
                    onZoneChange={(timeZone) => {
                      setPlan({ ...plan, timeZone });
                      setPreview([]);
                    }}
                  />
                  {!eligible.length && local && (
                    <button
                      type="button"
                      disabled={busy || !controller}
                      onClick={() =>
                        void perform(
                          () =>
                            api("/automations/authorize", "POST", {
                              requestId: crypto.randomUUID(),
                              controllerSessionId: controller,
                            }),
                          "已允许此主对话运行定时任务",
                        )
                      }
                    >
                      允许此主对话运行定时任务
                    </button>
                  )}
                  <details className="work-details">
                    <summary>高级设置</summary>
                    <Field label="计划执行节点">
                      <select
                        value={plan.executorId ?? "local"}
                        onChange={(e) => setPlan({ ...plan, executorId: e.target.value })}
                      >
                        {(data.executors ?? []).map((e: Row) => (
                          <option key={e.id} value={e.id}>
                            {e.name} · {e.status === "online" ? "在线" : "离线"}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <div className="work-grid">
                      <Field label="累计运行上限（0 不限制）">
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={plan.maxRuns}
                          onChange={(e) => setPlan({ ...plan, maxRuns: e.target.value })}
                        />
                      </Field>
                      <Field label="累计费用上限 USD（0 不限制）">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={plan.maxCostUsd}
                          onChange={(e) => setPlan({ ...plan, maxCostUsd: e.target.value })}
                        />
                      </Field>
                    </div>
                    <Field label="错过时点的处理">
                      <select
                        value={plan.misfirePolicy}
                        onChange={(e) => setPlan({ ...plan, misfirePolicy: e.target.value })}
                      >
                        <option value="coalesce">恢复后合并一次</option>
                        <option value="skip">超过一分钟则跳过</option>
                      </select>
                    </Field>
                  </details>
                  <div className="work-actions modal-footer-actions">
                    <button
                      type="button"
                      disabled={busy || !controller}
                      onClick={() =>
                        void perform(async () => {
                          const p = await api<Row>("/automations/preview", "POST", planBody());
                          setPreview(p.occurrences);
                        }, "已生成运行时间预览")
                      }
                    >
                      预览运行时间
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPlanModalOpen(false);
                        setPreview([]);
                      }}
                    >
                      取消
                    </button>
                    <button className="primary" disabled={busy || !controller || !eligible.length}>
                      {busy ? "正在保存…" : "保存计划"}
                    </button>
                  </div>
                  {!!preview.length && (
                    <ol className="work-preview" aria-label="接下来三次运行">
                      {preview.map((s) => (
                        <li key={s}>
                          <time>{s}</time> · {stamp(s)}
                        </li>
                      ))}
                    </ol>
                  )}
                </form>
              </Modal>
            )}
          </>
        )}
        {tab === "apps" && (
          <>
            <SettingsSection
              title="应用连接"
              actions={
                local ? (
                  <button
                    type="button"
                    className="primary"
                    disabled={busy}
                    onClick={() => {
                      setApp({
                        applicationId: "github",
                        version: "1.0.0",
                        name: "",
                        token: "",
                        auth: "token",
                      });
                      setAppModalOpen(true);
                    }}
                  >
                    <Plus size={14} />
                    <span>新建连接</span>
                  </button>
                ) : undefined
              }
            >
              {!connections.length && <Empty>暂无连接应用。</Empty>}
              {connections.map((c) => (
                <div className="work-row" key={c.id}>
                  <div>
                    <strong>{c.name}</strong>
                    <p>
                      {c.applicationId} · {c.version} · {c.enabled ? "启用" : "已停用"}
                    </p>
                    <small>{c.id}</small>
                  </div>
                  <div className="work-actions">
                    <button
                      disabled={!local || busy}
                      onClick={() => {
                        setApp({ ...c, token: "", auth: "token" });
                        setAppModalOpen(true);
                      }}
                    >
                      修改连接
                    </button>
                    <button
                      disabled={!local || busy || !c.enabled}
                      onClick={() =>
                        void perform(
                          () =>
                            api("/applications/connections/" + c.id + "/revoke", "POST", {
                              expectedRevision: c.revision,
                            }),
                          "连接及关联授权已撤销",
                        )
                      }
                    >
                      撤销连接
                    </button>
                  </div>
                </div>
              ))}
              {appModalOpen && local && (
                <Modal
                  title={app.id ? "修改连接" : "新建应用连接"}
                  onClose={() => setAppModalOpen(false)}
                >
                  <form
                    className="work-form work-modal-form"
                    onSubmit={(e) =>
                      submit(e, async () => {
                        await api(
                          "/applications/connections" + (app.id ? "/" + app.id : ""),
                          app.id ? "PATCH" : "POST",
                          {
                            requestId: crypto.randomUUID(),
                            applicationId: app.applicationId,
                            version: app.version,
                            name: app.name || app.applicationId,
                            auth: app.auth,
                            ...(app.token ? { token: app.token } : {}),
                            ...(app.id ? { expectedRevision: app.revision } : {}),
                          },
                        );
                        setApp({ ...app, id: undefined, token: "", name: "" });
                        setAppModalOpen(false);
                      })
                    }
                  >
                    <div className="work-grid">
                      <Field label="应用版本">
                        <select
                          value={app.applicationId + "@" + app.version}
                          onChange={(e) => {
                            const [applicationId, version] = e.target.value.split("@");
                            setApp({ ...app, applicationId, version });
                          }}
                        >
                          {versions.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.manifest.name} · {v.manifest.version}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="连接名称">
                        <input
                          value={app.name}
                          maxLength={100}
                          onChange={(e) => setApp({ ...app, name: e.target.value })}
                        />
                      </Field>
                    </div>
                    <Field label="认证方式">
                      <select
                        value={app.auth}
                        onChange={(e) => setApp({ ...app, auth: e.target.value })}
                      >
                        <option value="token">访问令牌</option>
                        <option value="oauth">OAuth（先创建连接，再配置）</option>
                      </select>
                    </Field>
                    {app.auth === "token" && (
                      <Field label={app.id ? "新访问令牌（留空沿用）" : "访问令牌"}>
                        <input
                          type="password"
                          autoComplete="new-password"
                          value={app.token}
                          onChange={(e) => setApp({ ...app, token: e.target.value })}
                        />
                      </Field>
                    )}
                    <div className="work-actions modal-footer-actions">
                      <button type="button" onClick={() => setAppModalOpen(false)}>
                        取消
                      </button>
                      <button disabled={busy} className="primary">
                        {app.id ? "更新连接并撤销旧授权" : "保存应用连接"}
                      </button>
                    </div>
                  </form>
                </Modal>
              )}
              {local && (
                <PayloadForm
                  title="导入应用清单"
                  initial={{
                    schemaVersion: 1,
                    id: "my-mcp",
                    version: "1.0.0",
                    name: "My MCP",
                    publisher: "local",
                    description: "",
                    runtime: "remote-mcp",
                    endpoint: "https://example.com/mcp",
                    requestedPermissions: ["mcp.example"],
                    skills: [],
                    filesManifest: {},
                  }}
                  disabled={busy}
                  onSubmit={(v) => perform(() => api("/applications", "POST", v))}
                />
              )}
              {local && (
                <PayloadForm
                  title="OAuth 客户端配置"
                  initial={{
                    connectionId: app.id ?? "",
                    expectedRevision: app.revision ?? 1,
                    clientId: "",
                    authorizationEndpoint: "https://example.com/authorize",
                    tokenEndpoint: "https://example.com/token",
                    redirectUri: location.origin + hostPath + "/api/oauth/callback",
                    scopes: [],
                  }}
                  disabled={busy}
                  onSubmit={(v) => perform(() => api("/oauth/configure", "POST", v))}
                />
              )}
              {connections
                .filter((c) => c.enabled)
                .map((c) => (
                  <button
                    key={c.id}
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        const r = await api<Row>("/oauth/start", "POST", { connectionId: c.id });
                        const url = new URL(r.url);
                        if (url.protocol !== "https:") throw new Error("授权服务必须使用 HTTPS。");
                        setOAuthLink(url.href);
                      }, "授权地址已生成，请继续在浏览器完成授权")
                    }
                  >
                    {c.name} · 开始 OAuth
                  </button>
                ))}
            </SettingsSection>
            {oauthLink && (
              <p className="work-list">
                <a href={oauthLink} target="_blank" rel="noopener noreferrer">
                  在浏览器继续授权
                </a>{" "}
                · 完成后返回此页刷新连接。
              </p>
            )}
            <SettingsSection
              title="明确授权"
              actions={
                local ? (
                  <button
                    type="button"
                    className="primary"
                    disabled={busy}
                    onClick={() => {
                      setGrant({
                        connectionId: connections[0]?.id ?? "",
                        operations: "",
                        resources: "",
                        expiresAt: "",
                      });
                      setGrantModalOpen(true);
                    }}
                  >
                    <Plus size={14} />
                    <span>新建授权</span>
                  </button>
                ) : undefined
              }
            >
              {!ownGrants.length && <Empty>此主对话尚无外部操作授权。</Empty>}
              {ownGrants.map((g) => (
                <div className="work-row" key={g.id}>
                  <div>
                    <strong>{g.operations.join("、")}</strong>
                    <p>{g.resources.join("、")}</p>
                    <small>
                      {g.applicationId
                        ? g.applicationId + " · " + g.applicationVersion
                        : "主对话工具"}{" "}
                      · {g.expiresAt ? "到期 " + stamp(g.expiresAt) : "无固定到期"}
                    </small>
                  </div>
                  <button
                    disabled={!local || busy}
                    onClick={() =>
                      void perform(
                        () =>
                          api("/grants/" + g.id + "/revoke", "POST", {
                            expectedRevision: g.revision,
                          }),
                        "授权已撤销",
                      )
                    }
                  >
                    撤销授权
                  </button>
                </div>
              ))}
              {grantModalOpen && local && (
                <Modal title="新建授权" onClose={() => setGrantModalOpen(false)}>
                  <form
                    className="work-form work-modal-form"
                    onSubmit={(e) =>
                      submit(
                        e,
                        async () => {
                          await api("/grants", "POST", {
                            requestId: crypto.randomUUID(),
                            controllerSessionId: controller,
                            connectionId: grant.connectionId || null,
                            applicationId: selectedConnection?.applicationId ?? null,
                            applicationVersion: selectedConnection?.version ?? null,
                            operations: words(grant.operations),
                            resources: words(grant.resources),
                            expiresAt: grant.expiresAt
                              ? new Date(grant.expiresAt).toISOString()
                              : null,
                          });
                          setGrantModalOpen(false);
                        },
                        "授权已保存",
                      )
                    }
                  >
                    <Field label="授权的应用连接">
                      <select
                        value={grant.connectionId}
                        onChange={(e) => setGrant({ ...grant, connectionId: e.target.value })}
                      >
                        <option value="">主对话工具（计划 / 浏览器）</option>
                        {connections
                          .filter((c) => c.enabled)
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name} · {c.version}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field label="允许的操作（每行一个）">
                      <textarea
                        required
                        rows={2}
                        value={grant.operations}
                        placeholder="automation.execute"
                        onChange={(e) => setGrant({ ...grant, operations: e.target.value })}
                      />
                    </Field>
                    <Field label="允许的资源（每行一个，精确匹配）">
                      <textarea
                        required
                        rows={2}
                        value={grant.resources}
                        placeholder={
                          "session:" + controller + " 或 owner/repo 或 https://example.com"
                        }
                        onChange={(e) => setGrant({ ...grant, resources: e.target.value })}
                      />
                    </Field>
                    <Field label="到期时间（可选，本地时间）">
                      <DateTimeSelection
                        type="datetime-local"
                        value={grant.expiresAt}
                        onChange={(e) => setGrant({ ...grant, expiresAt: e.target.value })}
                      />
                    </Field>
                    <div className="work-actions modal-footer-actions">
                      <button type="button" onClick={() => setGrantModalOpen(false)}>
                        取消
                      </button>
                      <button className="primary" disabled={busy || !controller}>
                        授予以上范围
                      </button>
                    </div>
                  </form>
                </Modal>
              )}
            </SettingsSection>
            {local && (
              <SettingsSection title="GitHub 事件入口">
                <PayloadForm
                  title="配置 GitHub Webhook"
                  initial={{
                    requestId: "",
                    name: "GitHub",
                    automationId: plans.find((p) => p.trigger.kind === "webhook")?.id ?? "",
                    secret: "",
                    repositories: [],
                    actors: [],
                    events: ["issues"],
                    mode: "observe",
                  }}
                  disabled={busy}
                  onSubmit={(v) =>
                    perform(() =>
                      api("/webhooks", "POST", { ...v, requestId: crypto.randomUUID() }),
                    )
                  }
                />
                <button
                  disabled={busy}
                  onClick={() =>
                    void perform(
                      async () => setDetail((await api<Row>("/webhooks")).connections),
                      "已读取事件入口",
                    )
                  }
                >
                  查看事件入口
                </button>
                {detail && <pre className="work-json">{JSON.stringify(detail, null, 2)}</pre>}
              </SettingsSection>
            )}
          </>
        )}
        {tab === "memory" && (
          <SettingsSection
            title={projectId ? "项目约定与记忆" : "全局约定与记忆"}
            actions={
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => {
                  remember();
                  setMemoryModalOpen(true);
                }}
              >
                <Plus size={14} />
                <span>新建记忆</span>
              </button>
            }
          >
            {!(data.memory ?? []).length && <Empty>暂无记忆。</Empty>}
            {(data.memory ?? [])
              .filter((m: MemoryEntry) => m.status !== "deleted")
              .map((m: MemoryEntry) => (
                <div className="work-row" key={m.id}>
                  <div>
                    <strong>{m.subject}</strong>
                    <p>{m.content}</p>
                    <small>
                      {state(m.status)} · 修订 {m.revision} · 来源 {m.sourceRefs.join("、")}
                    </small>
                  </div>
                  <div className="work-actions">
                    {m.status === "proposed" && (
                      <button
                        disabled={busy}
                        onClick={() => void perform(() => saveMemory("confirmed", m), "记忆已确认")}
                      >
                        确认记忆
                      </button>
                    )}
                    <button
                      onClick={() => {
                        remember(m);
                        setMemoryModalOpen(true);
                      }}
                    >
                      纠正
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void perform(() => saveMemory("deleted", m), "记忆已删除，下轮不再使用")
                      }
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
            {memoryModalOpen && (
              <Modal
                title={memory.id ? "纠正记忆" : "新建记忆"}
                onClose={() => setMemoryModalOpen(false)}
              >
                <form
                  className="work-form work-modal-form"
                  onSubmit={(e) =>
                    submit(
                      e,
                      async () => {
                        await saveMemory();
                        remember();
                        setMemoryModalOpen(false);
                      },
                      "记忆已保存，下轮生效",
                    )
                  }
                >
                  <Field label="记忆主题">
                    <input
                      required
                      maxLength={200}
                      value={memory.subject}
                      onChange={(e) => setMemory({ ...memory, subject: e.target.value })}
                    />
                  </Field>
                  <Field label="约定内容">
                    <textarea
                      required
                      rows={4}
                      value={memory.content}
                      onChange={(e) => setMemory({ ...memory, content: e.target.value })}
                    />
                  </Field>
                  <Field label="来源引用（每行一个）">
                    <textarea
                      required
                      rows={2}
                      value={memory.sourceRefs}
                      onChange={(e) => setMemory({ ...memory, sourceRefs: e.target.value })}
                    />
                  </Field>
                  <div className="work-actions modal-footer-actions">
                    <button type="button" onClick={() => setMemoryModalOpen(false)}>
                      取消
                    </button>
                    <button className="primary" disabled={busy}>
                      保存已确认记忆
                    </button>
                  </div>
                </form>
              </Modal>
            )}
          </SettingsSection>
        )}
        {tab === "environments" && (
          <>
            <SettingsSection title="受管浏览器">
              {!data.browsers?.available && (
                <Empty>
                  尚未安装 Chromium。请在 Host 运行 npx playwright install chromium，或设置
                  KOOYU_CHROMIUM_PATH。
                </Empty>
              )}
              {(data.browsers?.environments ?? [])
                .filter((b: Row) => b.controllerSessionId === controller)
                .map((b: Row) => (
                  <div className="work-row" key={b.id}>
                    <div>
                      <strong>{b.name}</strong>
                      <p>{b.origins.join("、")}</p>
                      <small>
                        {b.lease?.owner === "user"
                          ? "用户控制"
                          : b.lease
                            ? "Agent 租约至 " + stamp(new Date(b.lease.expiresAt).toISOString())
                            : "无有效租约"}{" "}
                        · 代次 {b.generation}
                      </small>
                    </div>
                    <div className="work-actions">
                      <button
                        disabled={!local || busy || !data.browsers?.available}
                        onClick={() =>
                          void perform(
                            () =>
                              api("/browsers/" + b.id + "/control", "POST", {
                                expectedGeneration: b.generation,
                              }),
                            "已暂停 Agent 浏览器写入，请在 Host 浏览器窗口登录",
                          )
                        }
                      >
                        手动登录 / 接管
                      </button>
                      <button
                        disabled={!local || busy || b.lease?.owner !== "user"}
                        onClick={() =>
                          void perform(
                            () =>
                              api("/browsers/" + b.id + "/return", "POST", {
                                expectedGeneration: b.generation,
                              }),
                            "浏览器已交还 Agent",
                          )
                        }
                      >
                        交还控制权
                      </button>
                    </div>
                  </div>
                ))}
              {local && (
                <form
                  className="work-form"
                  onSubmit={(e) => {
                    const f = new FormData(e.currentTarget);
                    submit(
                      e,
                      () =>
                        api("/browsers", "POST", {
                          name: f.get("name"),
                          controllerSessionId: controller,
                          origins: words(String(f.get("origins"))),
                        }),
                      "浏览器环境已创建，请授予 browser.read / browser.write 与站点范围",
                    );
                  }}
                >
                  <Field label="浏览器环境名称">
                    <input required name="name" maxLength={100} />
                  </Field>
                  <Field label="允许的站点 origin（每行一个）">
                    <textarea required name="origins" rows={3} placeholder="https://example.com" />
                  </Field>
                  <button disabled={busy || !controller}>创建浏览器环境</button>
                  <p className="detail-empty-note">
                    手动登录需 Host 有图形桌面；无桌面服务器请先在同一运行环境配置显示服务。
                  </p>
                </form>
              )}
            </SettingsSection>
            <SettingsSection title="执行节点">
              {(data.executors ?? []).map((e: Row) => (
                <div className="work-row" key={e.id}>
                  <div>
                    <strong>{e.name}</strong>
                    <p>
                      {state(e.status)} · {e.kind} ·{" "}
                      {e.capabilities.join("、") || "等待节点上报能力"}
                    </p>
                    <small>{e.id}</small>
                  </div>
                  {e.id !== "local" && (
                    <button
                      disabled={!local || busy || !e.enabled}
                      onClick={() =>
                        void perform(
                          () => api("/executors/" + e.id + "/revoke", "POST", {}),
                          "执行节点已撤销",
                        )
                      }
                    >
                      撤销节点
                    </button>
                  )}
                </div>
              ))}
              {local && (
                <>
                  <form
                    className="work-form"
                    onSubmit={(e) => {
                      const f = new FormData(e.currentTarget);
                      submit(
                        e,
                        async () =>
                          setToken(await api<Row>("/executors", "POST", { name: f.get("name") })),
                        "已生成独立节点凭据，请保存到节点私有 token 文件",
                      );
                    }}
                  >
                    <Field label="新节点名称">
                      <input name="name" required maxLength={100} />
                    </Field>
                    <button disabled={busy}>生成节点凭据</button>
                  </form>
                  {token && (
                    <div className="work-secret">
                      <p>仅在本次页面显示。保存后关闭。</p>
                      <pre>
                        {JSON.stringify({ executorId: token.id, token: token.token }, null, 2)}
                      </pre>
                      <button onClick={() => setToken(null)}>关闭凭据</button>
                    </div>
                  )}
                  <PayloadForm
                    title="添加节点工作目录"
                    initial={{ executorId: "", projectId: projectId, rootPath: "" }}
                    disabled={busy}
                    onSubmit={({ executorId, ...v }) =>
                      perform(() => api("/executors/" + executorId + "/workspace", "POST", v))
                    }
                  />
                </>
              )}
            </SettingsSection>
          </>
        )}
        {tab === "notifications" && (
          <SettingsSection title="结果提醒">
            {(data.channels ?? []).map((c: Row) => (
              <div className="work-row" key={c.id}>
                <div>
                  <strong>
                    {c.kind === "bark"
                      ? "Bark 推送"
                      : c.kind === "apns"
                        ? "iOS APNs 推送"
                        : "客户端系统通知"}
                  </strong>
                  <p>
                    {c.enabled ? "已启用" : "已关闭"} · {c.preview ? "包含预览" : "隐藏正文"}
                  </p>
                  {c.unavailableReason && <p>{c.unavailableReason}</p>}
                </div>
                <button
                  disabled={busy || (c.kind === "apns" && !c.enabled)}
                  onClick={() =>
                    void perform(
                      () =>
                        api("/notification-channels", "PUT", {
                          ...(local ? { deviceId: c.deviceId } : {}),
                          kind: c.kind,
                          enabled: !c.enabled,
                          preview: c.preview,
                          expectedRevision: c.revision,
                        }),
                      c.enabled ? "提醒已关闭" : "提醒已启用",
                    )
                  }
                >
                  {c.enabled ? "关闭提醒" : c.kind === "apns" ? "请在 iOS 中重新注册" : "开启提醒"}
                </button>
              </div>
            ))}
            <form
              className="work-form"
              onSubmit={(e) => {
                const f = new FormData(e.currentTarget),
                  kind = String(f.get("kind"));
                submit(
                  e,
                  async () => {
                    if (kind === "client") {
                      if (!("Notification" in window))
                        throw new Error("当前环境不支持系统通知，可使用 Bark。");
                      if ((await Notification.requestPermission()) !== "granted")
                        throw new Error("系统通知未获允许，请在浏览器设置中开启或使用 Bark。");
                    }
                    return api("/notification-channels", "PUT", {
                      kind,
                      enabled: true,
                      preview: f.get("preview") === "on",
                      ...(f.get("endpoint") ? { endpoint: f.get("endpoint") } : {}),
                      expectedRevision:
                        (data.channels ?? []).find(
                          (c: Row) => c.kind === kind && (!local || c.deviceId === "desktop"),
                        )?.revision ?? 0,
                    });
                  },
                  "提醒通道已保存",
                );
              }}
            >
              <Field label="通知通道">
                <select name="kind">
                  <option value="client">客户端系统通知（需保持客户端运行）</option>
                  <option value="bark">Bark</option>
                </select>
              </Field>
              <Field label="Bark 地址（仅 Bark 必填）">
                <input
                  name="endpoint"
                  type="password"
                  placeholder="https://api.day.app/设备密钥"
                  autoComplete="new-password"
                />
              </Field>
              <label className="work-check">
                <input name="preview" type="checkbox" />
                允许锁屏显示正文预览
              </label>
              <button disabled={busy}>启用结果提醒</button>
            </form>
            <details className="work-details">
              <summary>iOS APNs 服务</summary>
              <p>
                {data.apns?.enabled ? "Host 推送服务已启用" : "Host 推送服务未启用"} · 配置修订{" "}
                {data.apns?.revision ?? 0}
              </p>
              <p>
                Apple 接受推送不等于设备已收到或事项已处理。设备令牌由 iOS
                注册；更换服务配置后需在设备上重新注册。
              </p>
              {local && (
                <form
                  className="work-form"
                  key={data.apns?.revision ?? 0}
                  onSubmit={(e) => {
                    const f = new FormData(e.currentTarget);
                    submit(
                      e,
                      () =>
                        api("/notification-providers/apns", "PUT", {
                          expectedRevision: data.apns?.revision ?? 0,
                          enabled: f.get("enabled") === "on",
                          teamId: String(f.get("teamId")).trim(),
                          keyId: String(f.get("keyId")).trim(),
                          topic: String(f.get("topic")).trim(),
                          environment: f.get("environment"),
                          ...(String(f.get("privateKey")).trim()
                            ? { privateKey: String(f.get("privateKey")) }
                            : {}),
                        }),
                      "APNs 服务已保存，请在 iOS 应用中重新注册提醒",
                    );
                  }}
                >
                  <Field label="Apple Team ID">
                    <input
                      name="teamId"
                      defaultValue={data.apns?.teamId ?? ""}
                      required
                      pattern="[A-Z0-9]{10}"
                      autoComplete="off"
                    />
                  </Field>
                  <Field label="APNs Key ID">
                    <input
                      name="keyId"
                      defaultValue={data.apns?.keyId ?? ""}
                      required
                      pattern="[A-Z0-9]{10}"
                      autoComplete="off"
                    />
                  </Field>
                  <Field label="应用 Bundle ID（Topic）">
                    <input
                      name="topic"
                      defaultValue={data.apns?.topic ?? "app.kooyu.ios"}
                      required
                    />
                  </Field>
                  <Field label="APNs 签名环境">
                    <select name="environment" defaultValue={data.apns?.environment ?? "sandbox"}>
                      <option value="sandbox">开发沙盒（Debug）</option>
                      <option value="production">生产环境（Release / TestFlight）</option>
                    </select>
                  </Field>
                  <Field label="APNs 私钥（PEM .p8；已配置时留空保留）">
                    <textarea
                      name="privateKey"
                      rows={5}
                      autoComplete="off"
                      spellCheck={false}
                      required={!data.apns?.configured}
                    />
                  </Field>
                  <label className="work-check">
                    <input
                      name="enabled"
                      type="checkbox"
                      defaultChecked={data.apns?.enabled ?? true}
                    />
                    启用 Host 的 APNs 服务
                  </label>
                  <button disabled={busy}>保存 APNs 服务</button>
                </form>
              )}
            </details>
          </SettingsSection>
        )}
        {tab === "activity" && (
          <>
            <SettingsSection title="Host 运行状态">
              <div className="work-list">
                <p>
                  <StatusDot tone={data.status?.frozen ? "warn" : "ok"}>
                    {data.status?.frozen ? "新执行已冻结" : "接受新执行"}
                  </StatusDot>
                </p>
                <p>
                  运行中 {data.status?.inFlight ?? "—"} · 后台工作 {data.status?.background ?? "—"}{" "}
                  · 容量 {data.status?.capacity?.active?.length ?? 0} /{" "}
                  {data.status?.capacity?.limit ?? "—"}
                </p>
                <p>
                  {data.status?.readyForMaintenance
                    ? "已排空，可停止 Host 后执行离线备份"
                    : "尚未确认排空，请核对运行与未知回执"}
                </p>
                {local && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void perform(
                        () =>
                          data.status.frozen
                            ? internal("resume", {
                                processIdentity: data.status.processIdentity,
                                generation: data.status.generation,
                              })
                            : internal("quiesce"),
                        data.status?.frozen ? "已恢复派发" : "已冻结所有新派发",
                      )
                    }
                  >
                    {data.status?.frozen ? "恢复新执行" : "冻结新执行"}
                  </button>
                )}
              </div>
            </SettingsSection>
            <SettingsSection title="动作与业务回复">
              {![...(data.receipts ?? []), ...(data.outbound ?? [])].length && (
                <Empty>尚无动作回执或业务回复。</Empty>
              )}
              {[
                ...(data.receipts ?? []).map((r: Row) => ({ ...r, recordType: "action-receipts" })),
                ...(data.outbound ?? []).map((r: Row) => ({
                  ...r,
                  recordType: "outbound-messages",
                })),
              ]
                .filter(
                  (r: Row) =>
                    !controller ||
                    r.sessionId === controller ||
                    r.controllerSessionId === controller,
                )
                .map((r: Row) => (
                  <div className="work-row" key={r.id}>
                    <div>
                      <strong>{r.operation ?? r.toolCallId ?? "外部动作"}</strong>
                      <p>
                        {state(r.status)} · {r.resource ?? r.id}
                      </p>
                    </div>
                    {r.status === "pending" && r.recordType === "outbound-messages" && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void perform(
                            () => api("/outbound-messages/" + r.id + "/withdraw", "POST", {}),
                            "待发回复已撤回",
                          )
                        }
                      >
                        撤回
                      </button>
                    )}
                    {r.status === "unknown" && local && (
                      <PayloadForm
                        title="登记核对证据"
                        initial={{
                          resolution: r.recordType === "outbound-messages" ? "sent" : "confirmed",
                          evidence: "",
                        }}
                        disabled={busy}
                        onSubmit={(v) =>
                          perform(
                            () => api("/" + r.recordType + "/" + r.id + "/reconcile", "POST", v),
                            "核对证据已保存",
                          )
                        }
                      />
                    )}
                  </div>
                ))}
            </SettingsSection>
          </>
        )}
      </div>
    </SettingsPage>
  );
}
