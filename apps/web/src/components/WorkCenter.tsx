import { BrowserControl } from "./BrowserControl";
import { GitHubLogin } from "./GitHubLogin";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Plus } from "lucide-react";
import QRCode from "qrcode";
import type { AuthorizationGrant, Session, Snapshot } from "@kodo/protocol";
import { DateTimeSelection } from "./DateTimeSelection";
import { api, hostPath } from "../lib/host-client";
import { SettingsPage, SettingsSection, StatusDot } from "./settings/SettingsKit";
import { Modal } from "./Motion";
import "../styles/work-center.css";
type Row = Record<string, any>;
type Tab = "apps" | "environments" | "notifications" | "activity";
const tabs: [Tab, string][] = [
  ["apps", "应用与授权"],
  ["environments", "执行环境"],
  ["notifications", "通知"],
  ["activity", "运行与核对"],
];
const introductions: Record<Tab, string> = {
  apps: "连接 GitHub、Slack 等外部服务，并指定主对话可以操作的范围。日常本地聊天无需配置。",
  environments: "任务默认在本机运行。只有需要自动操作网页或在另一台电脑执行时，才需要添加环境。",
  notifications: "任务完成或需要你处理时发送提醒。桌面通知无需填写地址；手机推送可选 Bark。",
  activity: "查看后台任务状态、外部操作结果，以及需要人工核对的记录。",
};
const permissionNames: Record<string, string> = {
  "automation.execute": "运行定时任务",
  "browser.read": "读取网页",
  "browser.write": "操作网页",
  "github.issues.read": "读取 Issue",
  "github.issues.create": "创建 Issue",
  "github.comments.create": "发表评论",
  "slack.history.read": "读取频道历史",
  "slack.messages.create": "发送频道消息",
  "telegram.messages.create": "回复已绑定的 Telegram 会话",
};
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
  const [tab, setTab] = useState<Tab>("apps"),
    [controller, setController] = useState(
      snapshot.sessions.find((s) => s.kind === "supervisor" && !s.archived)?.id ?? "",
    );
  const [createdController, setCreatedController] = useState<Session | null>(null);
  const session =
    snapshot.sessions.find((s) => s.id === controller) ??
    (createdController?.id === controller ? createdController : undefined);
  const [controllerModalOpen, setControllerModalOpen] = useState(false);
  const [controllerProject, setControllerProject] = useState("");
  const [notificationKind, setNotificationKind] = useState("client");
  const [data, setData] = useState<Row>({}),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [token, setToken] = useState<Row | null>(null),
    [detail, setDetail] = useState<Row[] | null>(null);
  const locked = useRef(false),
    mounted = useRef(true),
    request = useRef(0);
  const [app, setApp] = useState<Row>({
    applicationId: "github",
    version: "1.0.0",
    name: "",
    token: "",
    auth: "oauth",
  });
  const [grant, setGrant] = useState({
    connectionId: "",
    operations: "",
    resources: "",
    expiresAt: "",
  });
  const [oauthLink, setOAuthLink] = useState<string | null>(null);
  const [appModalOpen, setAppModalOpen] = useState(false);
  const [weixinQr, setWeixinQr] = useState<{ id: string; image: string }>();
  const [weixinCode, setWeixinCode] = useState("");
  const [grantModalOpen, setGrantModalOpen] = useState(false);
  const controllers = snapshot.sessions.filter((s) => s.kind === "supervisor" && !s.archived);
  if (createdController && !controllers.some((s) => s.id === createdController.id))
    controllers.push(createdController);
  const local = data.status?.localAdministrator === true;
  const load = useCallback(async () => {
    const generation = ++request.current;
    const endpoints: Record<string, string> = {
      status: "/work/status",
      plans: "/automations",
      grants: "/grants",
      apps: "/applications",
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
  }, []);
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
    (g: AuthorizationGrant) =>
      g.controllerSessionId === controller &&
      !g.revoked &&
      (!g.expiresAt || Date.parse(g.expiresAt) > Date.now()),
  );
  const plans: Row[] = (data.plans ?? []).filter((a: Row) => a.controllerSessionId === controller);
  const connections: Row[] = data.apps?.connections ?? [];
  const versions: Row[] = data.apps?.versions ?? [];
  const selectedConnection = connections.find((c) => c.id === grant.connectionId);
  const grantOperations: string[] = selectedConnection
    ? (versions.find(
        (v) =>
          v.manifest.id === selectedConnection.applicationId &&
          v.manifest.version === selectedConnection.version,
      )?.manifest.requestedPermissions ?? [])
    : ["automation.execute", "browser.read", "browser.write"];
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
      title="自动化与通知"
      description="管理外部应用连接、主对话授权、执行环境、通知通道与运行核对。定时计划请前往「工作 -> 自动计划」，记忆与约定请前往设置中的「记忆与约定」。"
      actions={
        <button disabled={busy || loading} onClick={() => void perform(load, "已刷新")}>
          刷新
        </button>
      }
    >
      <div className="work-center">
        {["apps", "environments"].includes(tab) && (
          <div className="work-context">
            <Field label="管理的主对话">
              <select
                value={controller}
                onChange={(e) => {
                  setController(e.target.value);
                }}
              >
                <option value="">
                  {controllers.length ? "请选择主对话" : "尚无主对话，请先创建"}
                </option>
                {controllers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </Field>
            <button
              type="button"
              disabled={busy || loading || !local}
              onClick={() => {
                setControllerProject(session?.projectId ?? "");
                setControllerModalOpen(true);
              }}
            >
              新建主对话
            </button>
            <p>
              {session?.projectId
                ? snapshot.projects.find((p) => p.id === session.projectId)?.name
                : controller
                  ? "全局范围"
                  : "未选择主对话"}
            </p>
          </div>
        )}
        <nav className="work-tabs" aria-label="自动化与通知分类">
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
        <p className="work-intro">{introductions[tab]}</p>
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
        {loading && <p role="status">正在读取自动化与通知配置…</p>}
        {!controller && ["apps", "environments"].includes(tab) && (
          <p className="work-hint">
            {controllers.length
              ? "请选择上方的主对话，管理它的操作权限和执行环境。"
              : "你还没有 Kooyu 主对话。普通引擎对话用于直接聊天，主对话负责管理计划与自动工作。"}
            {!local && !loading && " 请在运行 Kooyu 的电脑上创建主对话和授权。"}
          </p>
        )}
        {controllerModalOpen && (
          <Modal title="新建主对话" onClose={() => setControllerModalOpen(false)}>
            <form
              className="work-form work-modal-form"
              onSubmit={(e) =>
                submit(
                  e,
                  async () => {
                    const project = snapshot.projects.find((p) => p.id === controllerProject);
                    const next = await api<Session>("/sessions", "POST", {
                      title: project ? `${project.name} 主对话` : "Kooyu 主对话",
                      harnessId: "kodo",
                      kind: "supervisor",
                      projectId: controllerProject || null,
                    });
                    setCreatedController(next);
                    setController(next.id);
                    setControllerModalOpen(false);
                  },
                  "主对话已创建",
                )
              }
            >
              <p className="work-hint">主对话会管理计划并接收执行结果。创建后不会立即运行任务。</p>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <Field label="主对话所属项目">
                <select
                  value={controllerProject}
                  onChange={(e) => setControllerProject(e.target.value)}
                >
                  <option value="">全局 · 跨项目工作</option>
                  {snapshot.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="work-actions modal-footer-actions">
                <button type="button" onClick={() => setControllerModalOpen(false)}>
                  取消
                </button>
                <button className="primary" disabled={busy || !local}>
                  {busy ? "正在创建…" : "创建主对话"}
                </button>
              </div>
            </form>
          </Modal>
        )}
        {tab === "apps" && (
          <>
            <SettingsSection
              title="应用连接"
              description="先连接账号，再授予具体操作范围。连接本身不会允许主对话发送消息或修改外部内容。"
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
                        auth: "oauth",
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
              {local && <GitHubLogin onConnected={load} />}
              {!connections.length && (
                <Empty>
                  还没有连接应用。需要读取 GitHub Issue 或使用 Slack 时，再添加对应连接。
                </Empty>
              )}
              {local && (
                <div
                  className="work-row"
                  style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}
                >
                  <div className="nx-row">
                    <div>
                      <strong>微信 ClawBot</strong>
                      <p>微信扫码绑定到当前主对话，无需配置回调域名。</p>
                    </div>
                    <button
                      type="button"
                      className="nx-btn nx-btn--primary"
                      disabled={busy || !controller}
                      onClick={() =>
                        void perform(async () => {
                          const result = await api<{ id: string; qrContent: string }>(
                            "/im/weixin/qr",
                            "POST",
                            { controllerId: controller },
                          );
                          setWeixinQr({
                            id: result.id,
                            image: await QRCode.toDataURL(result.qrContent),
                          });
                          setWeixinCode("");
                        }, "请用微信扫描二维码")
                      }
                    >
                      微信扫码连接
                    </button>
                  </div>
                  {weixinQr && (
                    <div className="nx-card">
                      <div className="nx-card__body" style={{ alignItems: "center" }}>
                        <img
                          src={weixinQr.image}
                          alt="微信机器人配对二维码"
                          style={{
                            width: 176,
                            height: 176,
                            borderRadius: 12,
                            background: "#fff",
                            padding: 6,
                          }}
                        />
                        <div
                          style={{
                            width: "100%",
                            maxWidth: 280,
                            display: "flex",
                            flexDirection: "column",
                            gap: 8,
                          }}
                        >
                          <Field label="微信验证码（如有）">
                            <input
                              className="nx-input"
                              value={weixinCode}
                              onChange={(e) => setWeixinCode(e.target.value)}
                            />
                          </Field>
                          <button
                            type="button"
                            className="nx-btn nx-btn--coral"
                            disabled={busy}
                            onClick={() =>
                              void perform(async () => {
                                const result = await api<{ status: string }>(
                                  "/im/weixin/status",
                                  "POST",
                                  { id: weixinQr.id, code: weixinCode || undefined },
                                );
                                if (result.status === "binded_redirect") {
                                  setWeixinQr(undefined);
                                  setWeixinCode("");
                                  throw new Error(
                                    "微信提示此机器人已绑定。请查看已有连接，或用另一个机器人扫码。",
                                  );
                                }
                                if (
                                  result.status === "expired" ||
                                  result.status === "verify_code_blocked"
                                ) {
                                  setWeixinQr(undefined);
                                  setWeixinCode("");
                                  throw new Error("本次扫码已失效，请重新获取二维码。");
                                }
                                if (result.status === "need_verifycode")
                                  throw new Error("请填写微信显示的验证码，再检查扫码结果。");
                                if (result.status !== "confirmed")
                                  throw new Error("请在微信完成扫码确认后再次检查。");
                                setWeixinQr(undefined);
                                setWeixinCode("");
                              }, "微信会话已绑定")
                            }
                          >
                            检查扫码结果
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {local &&
                versions
                  .filter((v) => v.manifest.stdio?.command?.startsWith("kooyu-bundled:"))
                  .map(({ manifest }) => (
                    <div className="work-row" key={manifest.id}>
                      <div>
                        <strong>{manifest.name}</strong>
                        <p>{manifest.description}</p>
                      </div>
                      <button
                        type="button"
                        className="nx-btn"
                        disabled={
                          busy ||
                          connections.some((c) => c.applicationId === manifest.id && c.enabled)
                        }
                        onClick={() =>
                          void perform(
                            () =>
                              api("/applications/connections", "POST", {
                                requestId: crypto.randomUUID(),
                                applicationId: manifest.id,
                                version: manifest.version,
                                name: manifest.name,
                              }),
                            "本地 MCP 已启用",
                          )
                        }
                      >
                        {connections.some((c) => c.applicationId === manifest.id && c.enabled)
                          ? "已启用"
                          : "启用本地 MCP"}
                      </button>
                    </div>
                  ))}
              {connections.map((c) => (
                <div className="work-row" key={c.id}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong>{c.name}</strong>
                    <p>
                      {c.applicationId} · {c.version} · {c.enabled ? "启用" : "已停用"}
                    </p>
                    {local &&
                      c.enabled &&
                      ["telegram", "wecom", "feishu"].includes(c.applicationId) && (
                        <form
                          className="work-form"
                          style={{ marginTop: 10 }}
                          onSubmit={(event) => {
                            const fields = new FormData(event.currentTarget);
                            const groupChat = fields.get("groupChat") === "on";
                            const triggerPrefix = String(fields.get("triggerPrefix") ?? "").trim();
                            submit(
                              event,
                              () =>
                                api("/im/bindings", "POST", {
                                  connectionId: c.id,
                                  controllerId: controller,
                                  ownerExternalUserId: fields.get("owner"),
                                  chatId: fields.get("chat"),
                                  intakeMode: fields.get("intakeMode") || "propose",
                                  groupChat,
                                  ...(groupChat && triggerPrefix ? { triggerPrefix } : {}),
                                  ...(fields.get("appId") ? { appId: fields.get("appId") } : {}),
                                }),
                              "已绑定，消息将按准入策略接入当前主对话",
                            );
                          }}
                        >
                          {c.applicationId !== "telegram" && (
                            <Field label="机器人应用 ID">
                              <input name="appId" required />
                            </Field>
                          )}
                          <Field label="允许接收的用户 ID">
                            <input name="owner" required />
                          </Field>
                          <Field label="会话 / 群组 ID">
                            <input name="chat" required />
                          </Field>
                          <Field label="准入模式">
                            <select name="intakeMode" defaultValue="propose">
                              <option value="observe">仅观察记录</option>
                              <option value="propose">建议（进入收件箱待批准）</option>
                              <option value="auto">自动派发执行</option>
                            </select>
                          </Field>
                          <label className="work-check">
                            <input type="checkbox" name="groupChat" />
                            群聊模式（未 @ 时 0-Token 静默缓存上下文）
                          </label>
                          <Field label="群聊触发前缀（群聊模式生效）">
                            <input
                              name="triggerPrefix"
                              defaultValue="@Kooyu"
                              placeholder="@Kooyu"
                            />
                          </Field>
                          <div className="delegation-card__actions">
                            <button
                              type="submit"
                              className="nx-btn nx-btn--primary"
                              disabled={busy || !controller}
                            >
                              绑定到当前主对话
                            </button>
                            <button
                              type="button"
                              className="nx-btn"
                              disabled={busy}
                              onClick={() =>
                                void perform(
                                  () => api("/im/bindings/" + c.id, "DELETE"),
                                  "已解除绑定",
                                )
                              }
                            >
                              解除绑定
                            </button>
                          </div>
                        </form>
                      )}
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
                    {error && (
                      <p className="form-error" role="alert">
                        {error}
                      </p>
                    )}
                    <div className="work-grid">
                      <Field label="选择应用">
                        <select
                          value={app.applicationId + "@" + app.version}
                          onChange={(e) => {
                            const [applicationId, version] = e.target.value.split("@");
                            setApp({
                              ...app,
                              applicationId,
                              version,
                              auth: applicationId === "github" ? "oauth" : "token",
                            });
                          }}
                        >
                          {versions.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.manifest.name}
                              {v.manifest.runtime !== "builtin" ? ` · ${v.manifest.version}` : ""}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="连接名称（可选）">
                        <input
                          value={app.name}
                          maxLength={100}
                          placeholder="例如：我的 GitHub"
                          onChange={(e) => setApp({ ...app, name: e.target.value })}
                        />
                      </Field>
                    </div>
                    {app.applicationId === "github" && app.auth === "oauth" && (
                      <GitHubLogin
                        onConnected={async () => {
                          await load();
                          setAppModalOpen(false);
                        }}
                      />
                    )}
                    <Field label="认证方式">
                      <select
                        value={app.auth}
                        onChange={(e) => setApp({ ...app, auth: e.target.value })}
                      >
                        <option value="token">访问令牌</option>
                        <option value="oauth">
                          {app.applicationId === "github"
                            ? "GitHub 浏览器登录"
                            : "浏览器授权（需管理员先配置 OAuth）"}
                        </option>
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
                    <p className="work-hint">
                      访问令牌用于连接对应账号，保存在本机凭据库中。只需开通任务实际需要的账号权限。
                    </p>
                    <div className="work-actions modal-footer-actions">
                      <button type="button" onClick={() => setAppModalOpen(false)}>
                        取消
                      </button>
                      <button
                        disabled={busy || (app.applicationId === "github" && app.auth === "oauth")}
                        className="primary"
                      >
                        {app.id ? "更新连接并撤销旧授权" : "保存应用连接"}
                      </button>
                    </div>
                  </form>
                </Modal>
              )}
              {local && (
                <details className="work-details">
                  <summary>高级集成：自定义应用与 OAuth</summary>
                  <p>
                    内置应用可直接使用访问令牌连接。自定义 MCP
                    服务或部署浏览器授权时，再填写以下配置。
                  </p>
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
                </details>
              )}
              {connections
                .filter((c) => c.enabled && c.applicationId !== "github")
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
              description="指定所选主对话可以做什么、可以操作哪些仓库或频道。定时任务的运行授权可在保存计划时直接勾选。"
              actions={
                local ? (
                  <button
                    type="button"
                    className="primary"
                    disabled={busy || !controller}
                    onClick={() => {
                      setGrant({
                        connectionId: "",
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
                    <strong>
                      {g.operations
                        .map((operation) => permissionNames[operation] ?? operation)
                        .join("、")}
                    </strong>
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
                    {error && (
                      <p className="form-error" role="alert">
                        {error}
                      </p>
                    )}
                    <Field label="授权的应用连接">
                      <select
                        value={grant.connectionId}
                        onChange={(e) =>
                          setGrant({
                            ...grant,
                            connectionId: e.target.value,
                            operations: "",
                            resources: "",
                          })
                        }
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
                    <fieldset className="work-permissions">
                      <legend>允许主对话做什么</legend>
                      {grantOperations.map((operation) => (
                        <label className="work-check" key={operation}>
                          <input
                            type="checkbox"
                            checked={words(grant.operations).includes(operation)}
                            onChange={(e) => {
                              const operations = words(grant.operations).filter(
                                (v) => v !== operation,
                              );
                              if (e.target.checked) operations.push(operation);
                              setGrant({
                                ...grant,
                                operations: operations.join("\n"),
                                resources:
                                  operation === "automation.execute" &&
                                  e.target.checked &&
                                  !grant.resources
                                    ? `session:${controller}`
                                    : grant.resources,
                              });
                            }}
                          />
                          {permissionNames[operation] ?? operation}
                        </label>
                      ))}
                    </fieldset>
                    <p className="work-hint">
                      {selectedConnection?.applicationId === "github"
                        ? "资源填写仓库名，例如 owner/repo。"
                        : selectedConnection?.applicationId === "slack"
                          ? "资源填写允许访问的 Slack 频道 ID。"
                          : "定时任务会自动填写当前主对话范围；网页权限填写允许访问的网站，例如 https://example.com。"}
                    </p>
                    <details className="work-details">
                      <summary>高级：手动填写操作名称</summary>
                      <Field label="允许的操作（每行一个）">
                        <textarea
                          rows={2}
                          value={grant.operations}
                          placeholder="automation.execute"
                          onChange={(e) => setGrant({ ...grant, operations: e.target.value })}
                        />
                      </Field>
                    </details>
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
                      <button
                        className="primary"
                        disabled={busy || !controller || !words(grant.operations).length}
                      >
                        授予以上范围
                      </button>
                    </div>
                  </form>
                </Modal>
              )}
            </SettingsSection>
            {local && (
              <details className="work-details">
                <summary>高级：GitHub 事件触发</summary>
                <p>需要在 Issue 等事件发生时触发工作，再配置 Webhook。定时计划无需配置。</p>
                <PayloadForm
                  title="配置 GitHub Webhook"
                  initial={{
                    requestId: "",
                    name: "GitHub",
                    automationId: plans.find((p: Row) => p.trigger.kind === "webhook")?.id ?? "",
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
              </details>
            )}
          </>
        )}
        {tab === "environments" && (
          <>
            <div className="work-runtime-default">
              <StatusDot tone="ok">默认在本机执行</StatusDot>
              <p>本机聊天和计划使用现有引擎与项目目录，无需新增节点。</p>
            </div>
            <details className="work-details">
              <summary>网页自动操作（可选）</summary>
              <p>独立浏览器用于让主对话访问指定网站。需要登录时可手动接管，再交还给主对话。</p>
              <SettingsSection title="受管浏览器">
                {!data.browsers?.available && (
                  <details className="work-details">
                    <summary>浏览器组件尚未就绪 · 查看安装说明</summary>
                    <p>
                      尚未安装 Chromium。请在 Host 运行 npx playwright install chromium，或设置
                      KOOYU_CHROMIUM_PATH。
                    </p>
                  </details>
                )}
                {(data.browsers?.environments ?? [])
                  .filter((b: Row) => b.controllerSessionId === controller)
                  .map((b: Row) => (
                    <div className="work-row" key={b.id}>
                      <div>
                        <strong>{b.name}</strong>
                        {local && b.lease?.owner === "user" && (
                          <BrowserControl key={b.generation} id={b.id} generation={b.generation} />
                        )}
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
                              "已接管浏览器，请在实时画面中登录",
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
                            name: String(f.get("name")).trim() || "网页任务浏览器",
                            controllerSessionId: controller,
                            origins: words(String(f.get("origins"))).map(
                              (value) => new URL(value).origin,
                            ),
                          }),
                        "浏览器环境已创建，请授予 browser.read / browser.write 与站点范围",
                      );
                    }}
                  >
                    <Field label="浏览器环境名称（可选）">
                      <input name="name" maxLength={100} placeholder="网页任务浏览器" />
                    </Field>
                    <Field label="允许访问的网站（每行一个）">
                      <textarea
                        required
                        name="origins"
                        rows={3}
                        placeholder="https://example.com"
                      />
                    </Field>
                    <button disabled={busy || !controller || !data.browsers?.available}>
                      创建浏览器环境
                    </button>
                    {!controller && (
                      <p className="work-hint">先在上方选择或创建主对话，再添加网页环境。</p>
                    )}
                    <p className="detail-empty-note">
                      手动登录需 Host 有图形桌面；无桌面服务器请先在同一运行环境配置显示服务。
                    </p>
                  </form>
                )}
              </SettingsSection>
            </details>
            <details className="work-details">
              <summary>在其他电脑执行（可选）</summary>
              <p>将任务交给另一台电脑或服务器。仅使用本机时可以跳过。</p>
              <SettingsSection title="执行节点">
                {(data.executors ?? []).map((e: Row) => (
                  <div className="work-row" key={e.id}>
                    <div>
                      <strong>{e.name}</strong>
                      <p>
                        {state(e.status)} · {e.kind === "local" ? "本机" : "远程电脑"} ·{" "}
                        {e.capabilities.join("、") || "等待节点上报能力"}
                      </p>
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
                    <details className="work-details">
                      <summary>添加节点工作目录</summary>
                      <form
                        onSubmit={(e) => {
                          const f = new FormData(e.currentTarget);
                          submit(
                            e,
                            () =>
                              api(`/executors/${f.get("executorId")}/workspace`, "POST", {
                                projectId: f.get("projectId") || null,
                                rootPath: String(f.get("rootPath")).trim(),
                              }),
                            "节点工作目录已登记",
                          );
                        }}
                      >
                        <Field label="执行电脑">
                          <select required name="executorId" defaultValue="">
                            <option value="" disabled>
                              请选择已连接的远程电脑
                            </option>
                            {(data.executors ?? [])
                              .filter((e: Row) => e.id !== "local" && e.enabled)
                              .map((e: Row) => (
                                <option key={e.id} value={e.id}>
                                  {e.name}
                                </option>
                              ))}
                          </select>
                        </Field>
                        <Field label="所属项目">
                          <select name="projectId" defaultValue={session?.projectId ?? ""}>
                            <option value="">不关联项目</option>
                            {snapshot.projects.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="该电脑上的文件夹路径">
                          <input
                            required
                            name="rootPath"
                            placeholder="例如：D:\\projects\\my-app 或 /srv/my-app"
                          />
                        </Field>
                        <button disabled={busy}>保存工作目录</button>
                      </form>
                    </details>
                  </>
                )}
              </SettingsSection>
            </details>
          </>
        )}
        {tab === "notifications" && (
          <SettingsSection
            title="结果提醒"
            description="桌面通知需要 Kooyu 界面保持运行并获得系统通知权限。页面内的待处理记录始终可以查看。"
          >
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
                <select
                  name="kind"
                  value={notificationKind}
                  onChange={(e) => setNotificationKind(e.target.value)}
                >
                  <option value="client">客户端系统通知（需保持客户端运行）</option>
                  <option value="bark">Bark</option>
                </select>
              </Field>
              {notificationKind === "bark" ? (
                <>
                  <p className="work-hint">
                    在手机 Bark
                    应用中复制推送地址并粘贴到下方。发送手机提醒时，推送服务会接收通知内容。
                  </p>
                  <Field label="Bark 推送地址">
                    <input
                      required
                      name="endpoint"
                      type="password"
                      placeholder="https://api.day.app/设备密钥"
                      autoComplete="new-password"
                    />
                  </Field>
                </>
              ) : (
                <p className="work-hint">无需填写地址。点击下方按钮后，允许系统通知即可。</p>
              )}
              <label className="work-check">
                <input name="preview" type="checkbox" />
                允许通知显示正文预览
              </label>
              <button disabled={busy}>启用结果提醒</button>
            </form>
            <details className="work-details">
              <summary>iOS APNs 服务</summary>
              <p>
                自部署 iOS 推送服务时使用，需 Apple 开发者账号和推送密钥。桌面通知和 Bark
                无需配置此项。
              </p>
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
