import { delegatedOperations, type DeviceAccess } from "@kodo/protocol";
import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Bell,
  BellOff,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Laptop,
  LogOut,
  Play,
  QrCode,
  RefreshCw,
  Shield,
  ShieldAlert,
  Smartphone,
  Trash2,
  UserCheck,
} from "lucide-react";
import QRCode from "qrcode";
import type { InboxItem, ProviderConfiguration, Snapshot, Usage } from "@kodo/protocol";
import { api, remoteClient } from "../lib/host-client";
import { canPostMail, logoutWebDevice, pairWebDevice } from "../lib/mailbox";
import { HARNESS_NAMES, formatDate } from "../lib/harnesses";
import { InteractionCard } from "./Composer";
import { KooyuBrandMark } from "./KooyuBrand";
import { GlobalMemorySettings } from "./settings/GlobalMemorySettings";
import { AppearanceSettings } from "./settings/AppearanceSettings";
import { GeneralSettings } from "./settings/GeneralSettings";
import { EngineSettings } from "./settings/EngineSettings";
import { ProviderSettings } from "./settings/ProviderSettings";
import { AdvancedSettings } from "./settings/AdvancedSettings";
import { ImportSettings } from "./settings/ImportSettings";
import { SettingsPage, SettingsRow, SettingsSection, StatusDot } from "./settings/SettingsKit";
import { useT } from "../lib/i18n";
import { WorkCenter } from "./WorkCenter";
import type { SettingsSectionId } from "./SettingsNavigation";

import { UsagePage } from "./UsageAnalytics";
export { UsagePage };

type Wire = Record<string, any>;
type Action = (work: () => Promise<unknown>) => Promise<void>;

export function InboxPage({
  snapshot,
  pending,
  act,
  onOpenSession,
}: {
  snapshot?: Snapshot;
  pending: InboxItem[];
  act: Action;
  onOpenSession: (sessionId: string) => void;
}) {
  const t = useT();
  const [filter, setFilter] = useState<"pending" | "errors" | "recent">("pending");
  const visibleItems = pending.filter((item) => {
    if (filter === "errors") return item.type === "error" || item.type === "limit";
    if (filter === "recent") return item.type === "notification";
    return true;
  });
  const errorCount = pending.filter((i) => i.type === "error" || i.type === "limit").length;
  const recentCount = pending.filter((i) => i.type === "notification").length;

  const summarizePayload = (payload: unknown): string | null => {
    if (!payload || typeof payload !== "object") return null;
    const p = payload as Record<string, any>;
    const text =
      p.message ??
      p.error?.message ??
      (typeof p.error === "string" ? p.error : undefined) ??
      p.summary ??
      p.reason ??
      p.title;
    return typeof text === "string" && text.trim() ? text.trim() : null;
  };

  return (
    <div className="inbox-shell">
      <div className="inbox-filters" role="tablist" aria-label={t("inbox.pending")}>
        <button
          type="button"
          role="tab"
          aria-selected={filter === "pending"}
          className={`inbox-filter-pill ${filter === "pending" ? "is-active" : ""}`}
          onClick={() => setFilter("pending")}
        >
          {t("inbox.pending")} ({pending.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={filter === "errors"}
          className={`inbox-filter-pill ${filter === "errors" ? "is-active" : ""}`}
          onClick={() => setFilter("errors")}
        >
          {t("inbox.errors")} ({errorCount})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={filter === "recent"}
          className={`inbox-filter-pill ${filter === "recent" ? "is-active" : ""}`}
          onClick={() => setFilter("recent")}
        >
          {t("inbox.recent")} ({recentCount})
        </button>
        {pending.length > 0 && (
          <button
            type="button"
            className="quiet-btn inbox-filter-action"
            style={{ marginLeft: "auto" }}
            onClick={() => void act(() => api("/inbox/read-all", "POST", {}))}
          >
            <CheckCheck size={14} />
            {t("inbox.markAllRead")}
          </button>
        )}
      </div>

      {visibleItems.length === 0 ? (
        <div className="empty-small settings-group">
          <span className="empty-small__badge" aria-hidden="true">
            <Check size={22} />
          </span>
          <h2>{t("inbox.empty")}</h2>
        </div>
      ) : (
        <div className="card-stack">
          {visibleItems.map((i) => {
            const session = snapshot?.sessions.find((s) => s.id === i.sessionId);
            const title = session?.title ?? "未知会话";
            const summary = summarizePayload(i.payload);
            const typeText =
              i.type === "interaction"
                ? "等待原生交互"
                : i.type === "limit"
                  ? "托管达到限制"
                  : i.type === "notification"
                    ? "会话通知"
                    : "运行需要检查";
            return (
              <section className="inbox-item settings-group" key={i.id}>
                <div className="inbox-item__top">
                  <span className={`inbox-item__icon is-${i.type}`} aria-hidden="true">
                    {i.type === "interaction" ? (
                      <ShieldAlert size={16} />
                    ) : (
                      <AlertCircle size={16} />
                    )}
                  </span>
                  <div className="inbox-item__meta">
                    <strong>{title}</strong>
                    <span>
                      {session ? `${HARNESS_NAMES[session.harnessId]} · ` : ""}
                      {typeText}
                    </span>
                  </div>
                  <time className="inbox-item__time">{formatDate(i.createdAt)}</time>
                </div>

                {i.type === "interaction" ? (
                  <div className="inbox-item__interaction">
                    <InteractionCard item={i} act={act} />
                  </div>
                ) : (
                  <div className="inbox-item__body">
                    {summary && <p className="inbox-item__summary">{summary}</p>}
                    <details className="inbox-item__raw">
                      <summary>查看技术详情</summary>
                      <pre>{JSON.stringify(i.payload, null, 2)}</pre>
                    </details>
                  </div>
                )}

                <div className="actions">
                  {typeof i.payload === "object" &&
                    i.payload !== null &&
                    (i.payload as Wire).type === "intake-proposal" &&
                    typeof (i.payload as Wire).intakeEventId === "string" && (
                      <button
                        type="button"
                        className="nx-btn nx-btn--coral"
                        onClick={() =>
                          void act(() =>
                            api(
                              `/intake/${encodeURIComponent(String((i.payload as Wire).intakeEventId))}/approve`,
                              "POST",
                              {},
                            ),
                          )
                        }
                      >
                        <Play size={13} />
                        {t("inbox.approveIntake")}
                      </button>
                    )}
                  <button
                    type="button"
                    className="primary"
                    onClick={() => onOpenSession(i.sessionId)}
                  >
                    {t("inbox.open")}
                    <ChevronRight size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void act(() => api(`/inbox/${encodeURIComponent(i.id)}/read`, "POST", {}))
                    }
                  >
                    {t("inbox.markRead")}
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() =>
                      void act(() => api(`/inbox/${encodeURIComponent(i.id)}`, "DELETE"))
                    }
                  >
                    <Trash2 size={14} />
                    {t("inbox.delete")}
                  </button>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function HealthPage({
  snapshot,
  act,
  section,
  onSectionChange,
  providerConfig,
  onProviderConfigLoaded,
  usage,
  onOpenSession,
}: {
  snapshot: Snapshot;
  act: Action;
  usage?: { records: Usage[]; budgets: Wire[] };
  section: SettingsSectionId;
  onSectionChange: (next: SettingsSectionId) => void;
  providerConfig?: ProviderConfiguration;
  onProviderConfigLoaded?: (next: ProviderConfiguration) => void;
  onOpenSession?: (sessionId: string) => void;
}) {
  return (
    <div className="page-stack">
      {section === "appearance" && <AppearanceSettings />}
      {section === "work" && <WorkCenter snapshot={snapshot} />}
      {section === "memory" && (
        <GlobalMemorySettings key={snapshot.hostId} hostId={snapshot.hostId} snapshot={snapshot} />
      )}
      {section === "general" && (
        <GeneralSettings
          snapshot={snapshot}
          onOpenAppearance={() => onSectionChange("appearance")}
        />
      )}
      {section === "harnesses" && (
        <EngineSettings
          snapshot={snapshot}
          act={act}
          onOpenProviders={() => onSectionChange("providers")}
        />
      )}
      {section === "providers" && (
        <ProviderSettings snapshot={snapshot} act={act} onLoaded={onProviderConfigLoaded} />
      )}
      {section === "usage" && <UsagePage snapshot={snapshot} usage={usage} act={act} />}
      {section === "import" && (
        <ImportSettings snapshot={snapshot} act={act} onOpenSession={onOpenSession} />
      )}
      {section === "devices" && <DevicesPage snapshot={snapshot} act={act} />}
      {section === "advanced" && (
        <AdvancedSettings
          snapshot={snapshot}
          act={act}
          providerConfig={providerConfig}
          onProviderConfigLoaded={onProviderConfigLoaded}
        />
      )}
    </div>
  );
}

function DevicePermissions({ id }: { id: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [access, setAccess] = useState<DeviceAccess>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const path = "/devices/" + id + "/access";
  useEffect(() => {
    let active = true;
    void api<DeviceAccess>(path)
      .then((a) => {
        if (active) setAccess(a);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [path]);
  const labels = {
    "goals.check": t("devices.perm.goalsCheck"),
    "terminal.access": t("devices.perm.terminal"),
    "workspaces.git.push": t("devices.perm.gitPush"),
  };
  return (
    <div className="nx-device-perms">
      <button
        type="button"
        className="nx-btn nx-btn--sm nx-btn--ghost"
        aria-expanded={open}
        style={{ alignSelf: "flex-start", paddingLeft: 2 }}
        onClick={() => setOpen((v) => !v)}
      >
        <Shield size={12} />
        <span>
          {t("devices.permissions")}
          {access ? ` (${access.operations.length}/${delegatedOperations.length})` : ""}
        </span>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      {open && (
        <div className="nx-perm-list">
          {access &&
            delegatedOperations.map((op) => {
              const checked = access.operations.includes(op);
              return (
                <div className="nx-perm-row" key={op}>
                  <span>{labels[op]}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={checked}
                    aria-label={labels[op]}
                    className={`sx-toggle ${checked ? "is-on" : ""}`}
                    disabled={busy}
                    onClick={async () => {
                      const operations = checked
                        ? access.operations.filter((x) => x !== op)
                        : [...access.operations, op];
                      setBusy(true);
                      try {
                        setAccess(
                          await api<DeviceAccess>(path, "PUT", {
                            operations,
                            expectedRevision: access.revision,
                          }),
                        );
                        setError("");
                      } catch (e) {
                        setError(e instanceof Error ? e.message : String(e));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <span className="sx-toggle__thumb" />
                  </button>
                </div>
              );
            })}
          {error && (
            <p className="nx-feedback nx-feedback--error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function DevicesPage({ snapshot, act }: { snapshot: Snapshot; act: Action }) {
  const t = useT();
  const [pair, setPair] = useState<Wire>();
  const [qr, setQr] = useState("");
  const [remote, setRemote] = useState<Wire>();
  const [pending, setPending] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const [copiedCode, setCopiedCode] = useState(false);
  const [requests, setRequests] = useState<{ id: string; device_name: string }[]>([]);
  const [binding, setBinding] = useState<{
    userCode: string;
    verificationUri: string;
    expiresAt: number;
  }>();
  const [pushReady, setPushReady] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [now, setNow] = useState(Date.now());

  const devices: Snapshot["devices"] = remote?.devices ?? snapshot.devices;
  const initialDevices = useRef(snapshot.devices.length);
  const remaining = pair ? Math.max(0, Math.ceil((Date.parse(pair.expiresAt) - now) / 1000)) : 0;

  const account = remote?.account as
    | {
        configured?: boolean;
        bound?: boolean;
        origin?: string;
        hostId?: string;
        pending?: { userCode: string; verificationUri: string; expiresAt: number };
      }
    | undefined;
  const accountConfigured = Boolean(account?.configured);
  const accountBound = Boolean(account?.bound);
  const accountRequired = Boolean(remote?.accountRequired);
  const accountOrigin = account?.origin || "";

  const refreshRemote = async () => {
    try {
      const next = await api<Wire>("/remote");
      setRemote(next);
      if (next?.account?.pending && !next?.account?.bound) {
        setBinding((cur) => cur ?? next.account.pending);
      } else if (next?.account?.bound) {
        setBinding(undefined);
      }
    } catch {
      /* Keep last known state on transient refresh failure. */
    }
  };

  useEffect(() => {
    if (!binding) return;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api<Wire>("/remote/account/poll", "POST", {});
        if (cancelled) return;
        if (next.state === "approved") {
          setBinding(undefined);
          setProblem("");
          setNotice("此工作电脑已成功绑定到您的 Kooyu 账号。");
          await refreshRemote();
          return;
        }
        timeout = setTimeout(poll, Math.max(4, next.interval ?? 5) * 1000);
      } catch (error) {
        if (!cancelled) {
          setBinding(undefined);
          setProblem(error instanceof Error ? error.message : "账号授权失败，请重试。");
        }
      }
    };
    timeout = setTimeout(poll, 4000);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [binding]);

  useEffect(() => {
    if (!remoteClient || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
    void (async () => {
      if (!(await canPostMail())) return;
      const registration = await navigator.serviceWorker.ready;
      setPushEnabled(!!(await registration.pushManager.getSubscription()));
      setPushReady(true);
    })().catch(() => {});
  }, []);

  useEffect(() => {
    if (remoteClient) return;
    let cancelled = false;
    const tick = () => {
      void api<Wire>("/remote")
        .then((next) => {
          if (cancelled) return;
          setRemote(next);
          if (next?.account?.pending && !next?.account?.bound) {
            setBinding((cur) => cur ?? next.account.pending);
          } else if (next?.account?.bound) {
            setBinding(undefined);
          }
        })
        .catch(() => {});
    };
    tick();
    const timer = setInterval(tick, 3500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (remoteClient || !accountBound) {
      setRequests([]);
      return;
    }
    let cancelled = false;
    const pull = () => {
      void api<Wire>("/remote/account/requests", "POST", {})
        .then((res) => {
          if (!cancelled) setRequests(Array.isArray(res.items) ? res.items : []);
        })
        .catch(() => {});
    };
    pull();
    const timer = setInterval(pull, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [accountBound]);

  useEffect(() => {
    if (!pair) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pair]);

  useEffect(() => {
    if (devices.length > initialDevices.current && pair) {
      setPair(undefined);
      setQr("");
    }
    initialDevices.current = devices.length;
  }, [devices.length, pair]);

  const startAccountBind = async () => {
    if (accountBusy) return;
    setAccountBusy(true);
    setProblem("");
    setNotice("");
    try {
      const next = await api<{ userCode: string; verificationUri: string; expiresAt: number }>(
        "/remote/account/start",
        "POST",
        {},
      );
      setBinding(next);
      try {
        await navigator.clipboard?.writeText(next.userCode);
      } catch {
        /* Clipboard permission is optional. */
      }
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "发起账号绑定失败，请重试。");
    } finally {
      setAccountBusy(false);
    }
  };

  const cancelAccountBind = async () => {
    if (accountBusy) return;
    setAccountBusy(true);
    setProblem("");
    try {
      await api("/remote/account/cancel", "POST", {});
      setBinding(undefined);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "取消绑定失败。");
    } finally {
      setAccountBusy(false);
    }
  };

  const logoutAccount = async () => {
    if (accountBusy) return;
    setAccountBusy(true);
    setProblem("");
    setNotice("");
    try {
      await api("/remote/account/logout", "POST", {});
      setBinding(undefined);
      setRequests([]);
      setPair(undefined);
      setQr("");
      setNotice("此电脑已退出 Kooyu 账号并关闭远程通道。");
      await refreshRemote();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "退出电脑账号失败。");
    } finally {
      setAccountBusy(false);
    }
  };

  const refreshRequestsManual = async () => {
    setProblem("");
    setNotice("");
    try {
      const res = await api<Wire>("/remote/account/requests", "POST", {});
      const items = Array.isArray(res.items) ? res.items : [];
      setRequests(items);
      if (items.length === 0) setNotice("当前暂无待批准的远程连接申请。");
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "刷新申请列表失败。");
    }
  };

  const decideRequest = async (id: string, approve: boolean) => {
    setProblem("");
    setNotice("");
    try {
      await api("/remote/account/decide", "POST", { id, approve });
      setRequests((all) => all.filter((item) => item.id !== id));
      setNotice(approve ? "已批准该设备的远程连接请求。" : "已拒绝该连接请求。");
      await refreshRemote();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "处理连接申请失败。");
    }
  };

  const generate = async () => {
    if (pending) return;
    setPending(true);
    setProblem("");
    setNotice("");
    setPair(undefined);
    setQr("");
    try {
      const next = await api<Wire>("/pairing", "POST", {});
      const image = await QRCode.toDataURL(next.url);
      initialDevices.current = devices.length;
      setNow(Date.now());
      setQr(image);
      setPair(next);
      setRemote(await api<Wire>("/remote"));
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "连接失败，请重试。");
    } finally {
      setPending(false);
    }
  };

  const remoteStatusTone: "ok" | "warn" | "busy" | "off" =
    remote?.state === "connected"
      ? "ok"
      : remote?.state === "connecting"
        ? "busy"
        : remote?.state === "limited" || remote?.state === "blocked"
          ? "warn"
          : "off";
  const remoteStatusLabel =
    remote?.state === "connected"
      ? "远程通道已在线"
      : remote?.state === "connecting"
        ? "正在连接中继…"
        : remote?.state === "limited"
          ? "远程通道暂时受限"
          : remote?.state === "blocked"
            ? "远程权限已停用"
            : "远程通道未开启";

  const qrDisabled = pending || remoteClient || (accountRequired && !accountBound);

  return (
    <SettingsPage
      title="手机连接"
      description="绑定 Kooyu 账号以在桌面端、网页端和移动端远程连接此电脑；移动端也支持直接扫码配对"
    >
      {!remoteClient && (accountConfigured || accountRequired) && (
        <SettingsSection
          title="Kooyu 账号与远程绑定"
          description="桌面端和网页端均需先登录 Kooyu 账号，才可发现并连接这台工作电脑"
        >
          <SettingsRow
            label={
              <span className="remote-account-title">
                <Laptop size={15} aria-hidden="true" />
                {accountBound ? "此电脑已绑定 Kooyu 账号" : "尚未绑定 Kooyu 账号"}
                <StatusDot tone={accountBound ? "ok" : binding ? "busy" : "off"}>
                  {accountBound ? "已绑定" : binding ? "等待确认" : "未绑定"}
                </StatusDot>
              </span>
            }
            description={
              accountBound
                ? `绑定标识 ${account?.hostId?.slice(0, 8) ?? "—"} · 可在官网工作台、其他桌面端或移动端登录连接`
                : accountConfigured
                  ? "绑定后将自动关联到您的个人工作台，并支持远程连接请求审批"
                  : "此构建未配置官方账号服务地址，请先完成账号服务配置"
            }
          >
            {accountBound ? (
              <div className="remote-btn-row">
                {accountOrigin && (
                  <a
                    className="nx-btn"
                    href={`${accountOrigin}/account/hosts`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink size={13} />
                    打开工作台
                  </a>
                )}
                <button
                  type="button"
                  className="nx-btn"
                  disabled={accountBusy}
                  onClick={() => void refreshRequestsManual()}
                >
                  <RefreshCw size={13} />
                  检查申请
                </button>
                <button
                  type="button"
                  className="destructive-btn"
                  disabled={accountBusy}
                  onClick={() => void logoutAccount()}
                >
                  <LogOut size={13} />
                  退出账号
                </button>
              </div>
            ) : !binding ? (
              <button
                type="button"
                className="primary"
                disabled={accountBusy || !accountConfigured}
                onClick={() => void startAccountBind()}
              >
                <UserCheck size={14} />
                {accountBusy ? "正在生成授权码…" : "登录并绑定此电脑"}
              </button>
            ) : (
              <button
                type="button"
                className="nx-btn"
                disabled={accountBusy}
                onClick={() => void cancelAccountBind()}
              >
                取消绑定
              </button>
            )}
          </SettingsRow>

          {binding && !accountBound && (
            <div className="remote-auth-box">
              <div className="remote-auth-box__head">
                <strong>完成网页端账号授权</strong>
                <span>点击下方按钮前往 Kooyu 官网确认绑定（授权码将自动填入）</span>
              </div>
              <div className="remote-auth-code-row">
                <code className="remote-auth-code">{binding.userCode}</code>
                <button
                  type="button"
                  className="nx-btn"
                  onClick={() => {
                    void navigator.clipboard?.writeText(binding.userCode).then(() => {
                      setCopiedCode(true);
                      setTimeout(() => setCopiedCode(false), 1800);
                    });
                  }}
                >
                  {copiedCode ? <Check size={13} /> : <Copy size={13} />}
                  {copiedCode ? "已复制" : "复制授权码"}
                </button>
                <a
                  className="primary remote-auth-link"
                  href={binding.verificationUri}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={13} />
                  前往官网确认授权
                </a>
              </div>
              <p className="remote-auth-hint">
                正在自动监听授权结果，在官网点击「确认授权」后此处将立即更新。
              </p>
            </div>
          )}

          {accountBound && requests.length > 0 && (
            <div className="remote-approval-list" role="region" aria-label="待批准的远程连接申请">
              <div className="remote-approval-list__head">
                <Shield size={14} />
                <strong>待批准的远程连接申请（{requests.length}）</strong>
              </div>
              {requests.map((r) => (
                <div className="remote-approval-item" key={r.id}>
                  <div className="remote-approval-item__info">
                    <strong>{r.device_name || "远程客户端"}</strong>
                    <span>请求远程访问并控制此工作电脑，请确认是否为本人操作</span>
                  </div>
                  <div className="remote-btn-row">
                    <button
                      type="button"
                      className="primary"
                      onClick={() => void decideRequest(r.id, true)}
                    >
                      <Check size={13} />
                      批准连接
                    </button>
                    <button
                      type="button"
                      className="nx-btn"
                      onClick={() => void decideRequest(r.id, false)}
                    >
                      拒绝
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SettingsSection>
      )}

      <SettingsSection
        title={remoteClient ? "当前远程会话" : "移动端扫码与远程通道"}
        description={
          remoteClient
            ? "您当前正通过远程客户端访问工作电脑；设备管理请在工作电脑本地操作"
            : "移动端 App 既可登录账号发现，也可直接扫描下方二维码快速配对"
        }
        actions={
          !remoteClient ? (
            <StatusDot tone={remoteStatusTone}>{remoteStatusLabel}</StatusDot>
          ) : (
            <StatusDot tone="ok">已连接工作电脑</StatusDot>
          )
        }
      >
        <div className="pairing-card">
          {remoteClient ? (
            <div className="remote-client-bar">
              <div className="pairing-card__info">
                <strong>当前浏览器 / 客户端已获授权</strong>
                <p>如需管理其它设备或撤销权限，请在工作电脑本地的「设置 → 手机连接」中操作。</p>
              </div>
              <div className="remote-btn-row">
                {pushReady && (
                  <button
                    type="button"
                    className={`nx-btn ${pushEnabled ? "" : "nx-btn--primary"}`}
                    disabled={pending}
                    onClick={async () => {
                      setPending(true);
                      setProblem("");
                      try {
                        const registration = await navigator.serviceWorker.ready;
                        const current = await registration.pushManager.getSubscription();
                        if (current && pushEnabled) {
                          await api("/push/web", "DELETE");
                          await current.unsubscribe();
                          setPushEnabled(false);
                        } else {
                          const response = await fetch("/v2/push/key");
                          if (!response.ok) throw Error("无法读取推送公钥。");
                          const key = (await response.json()).publicKey as string;
                          const sub =
                            current ??
                            (await registration.pushManager.subscribe({
                              userVisibleOnly: true,
                              applicationServerKey: Uint8Array.from(
                                atob(key.replaceAll("-", "+").replaceAll("_", "/")),
                                (c) => c.charCodeAt(0),
                              ),
                            }));
                          try {
                            await api("/push/web", "PUT", { endpoint: sub.endpoint });
                          } catch (error) {
                            if (!current) await sub.unsubscribe();
                            throw error;
                          }
                          setPushEnabled(true);
                        }
                      } catch (e) {
                        setProblem(e instanceof Error ? e.message : String(e));
                      } finally {
                        setPending(false);
                      }
                    }}
                  >
                    {pushEnabled ? <BellOff size={14} /> : <Bell size={14} />}
                    {pushEnabled ? t("devices.pushDisable") : t("devices.pushEnable")}
                  </button>
                )}
                {location.origin !== "https://device.kooyu.invalid" && (
                  <button
                    type="button"
                    className="destructive-btn"
                    onClick={() =>
                      void logoutWebDevice().catch((e) =>
                        setProblem(e instanceof Error ? e.message : String(e)),
                      )
                    }
                  >
                    <LogOut size={13} />
                    退出此浏览器授权
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="pairing-card__hero">
                <span className="pairing-card__icon" aria-hidden="true">
                  <QrCode size={24} />
                </span>
                <div className="pairing-card__info">
                  <strong>移动端扫码快速配对</strong>
                  <p>
                    {accountRequired && !accountBound
                      ? "请先在上方登录并绑定 Kooyu 账号，完成后即可开启远程通道并生成扫码二维码。"
                      : remote?.problem?.message
                        ? remote.problem.message
                        : remote?.state === "connected"
                          ? "远程通道已就绪。点击生成二维码后，使用 Android / iOS 版 Kooyu 扫码连接。"
                          : remote?.enabled
                            ? "正在建立远程通道连接，请保持此电脑联网。"
                            : "点击生成二维码将自动开启本机远程通道，随时可以关闭。"}
                  </p>
                </div>
                <div className="remote-btn-row">
                  <button
                    type="button"
                    className="primary pairing-card__btn"
                    disabled={qrDisabled}
                    onClick={() => void generate()}
                  >
                    {pending ? "正在建立连接…" : pair ? "重新生成二维码" : "生成配对二维码"}
                  </button>
                  {remote?.enabled && (
                    <button
                      type="button"
                      className="destructive-btn"
                      disabled={pending}
                      onClick={() =>
                        void act(async () => {
                          const next = await api<Wire>("/remote", "DELETE");
                          setRemote(next);
                          setPair(undefined);
                          setQr("");
                        })
                      }
                    >
                      关闭远程
                    </button>
                  )}
                </div>
              </div>

              {pair && remaining > 0 && (
                <div className="pairing-code">
                  <div className="pairing-code__qr">
                    <img src={qr} alt="手机配对二维码" width="184" height="184" />
                  </div>
                  <strong className="pairing-code__value">{pair.code}</strong>
                  <span>单次使用 · 剩余 {remaining} 秒 · 请使用手机端 Kooyu App 扫码</span>
                </div>
              )}
              {pair && remaining === 0 && (
                <p role="status" className="remote-status-note">
                  配对二维码已过期，请点击「重新生成二维码」。
                </p>
              )}
              <p className="detail-empty-note">
                桌面端与网页端需通过 Kooyu 账号登录连接；移动端 App
                支持扫码或账号登录连接。原生客户端通过端到端加密通信，代码与密钥始终留在您的设备本地。
              </p>
            </>
          )}

          {notice && (
            <p role="status" className="remote-notice-banner">
              {notice}
            </p>
          )}
          {problem && (
            <p role="alert" className="form-error">
              {problem}
            </p>
          )}
        </div>
      </SettingsSection>

      <SettingsSection
        title="已授权设备"
        description="管理已获得此工作电脑远程访问权限的客户端与权限范围"
      >
        {devices.length === 0 ? (
          <div className="sx-empty detail-empty-note">暂无已授权的远程设备</div>
        ) : (
          devices.map((d) => (
            <div className="device-row sx-row" key={d.id}>
              <div className="device-row__info">
                <Smartphone size={18} className="device-row__icon" />
                <div className="device-row__text">
                  <strong>{d.name}</strong>
                  <time>{formatDate(d.createdAt)}</time>
                  {d.expiresAt && <span>有效期至 {formatDate(d.expiresAt)}</span>}
                  {!remoteClient && <DevicePermissions id={d.id} />}
                </div>
              </div>
              <button
                type="button"
                className="destructive-btn"
                disabled={remoteClient}
                onClick={() => void act(() => api(`/devices/${d.id}`, "DELETE"))}
              >
                撤销访问
              </button>
            </div>
          ))
        )}
      </SettingsSection>
    </SettingsPage>
  );
}

export function PairScreen({ onDone }: { onDone: () => void }) {
  const hashInfo = (() => {
    try {
      const p = new URLSearchParams(location.hash.slice(1));
      const pair = p.get("pair") ?? "";
      const hasClaim = Boolean(p.get("claim") && p.get("transaction") && p.get("host"));
      return { pair, isAccountRequest: pair === "REQUEST" && hasClaim };
    } catch {
      return { pair: "", isAccountRequest: false };
    }
  })();

  const [code, setCode] = useState(hashInfo.pair);
  const [name, setName] = useState(hashInfo.isAccountRequest ? "网页工作台" : "我的设备");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [accountIssuer, setAccountIssuer] = useState<string | null>(null);
  const [configState, setConfigState] = useState<"checking" | "account" | "self-hosted">(
    hashInfo.isAccountRequest ? "account" : "checking",
  );
  const submitting = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void fetch("/v1/browser/config", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-kooyu-request": "1" },
      body: "{}",
      signal: AbortSignal.timeout(5000),
    })
      .then(async (res) => {
        if (cancelled) return;
        if (res.ok) {
          const data = (await res.json()) as { issuer?: string };
          if (typeof data.issuer === "string" && data.issuer.startsWith("https://")) {
            setAccountIssuer(data.issuer);
            setConfigState("account");
            return;
          }
        }
        setConfigState(hashInfo.isAccountRequest ? "account" : "self-hosted");
      })
      .catch(() => {
        if (!cancelled) setConfigState(hashInfo.isAccountRequest ? "account" : "self-hosted");
      });
    return () => {
      cancelled = true;
    };
  }, [hashInfo.isAccountRequest]);

  const submitPair = (pairCode: string) => {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError("");
    void pairWebDevice(pairCode.trim(), name.trim())
      .then(onDone)
      .catch((err) => setError(err instanceof Error ? err.message : "连接失败，请重试。"))
      .finally(() => {
        submitting.current = false;
        setPending(false);
      });
  };

  if (configState === "checking") {
    return (
      <div className="pair-screen pair-screen--card">
        <span className="pair-screen__mark" aria-hidden="true">
          <KooyuBrandMark size={28} />
        </span>
        <h1>正在检查远程连接状态…</h1>
        <p className="pair-screen__sub">请稍候，正在核验工作台访问通道。</p>
      </div>
    );
  }

  if (configState === "account" && !hashInfo.isAccountRequest) {
    const issuer = accountIssuer ?? "https://kooyu.app";
    const loginHref = `${issuer}/login?next=${encodeURIComponent("/account/hosts")}`;
    const workbenchHref = `${issuer}/account/hosts`;
    return (
      <div className="pair-screen pair-screen--card">
        <div className="pair-screen__brand">
          <span className="pair-screen__mark" aria-hidden="true">
            <KooyuBrandMark size={26} />
          </span>
          <span className="pair-screen__badge">Kooyu 远程工作台</span>
        </div>
        <h1>登录以连接工作电脑</h1>
        <p className="pair-screen__sub">
          桌面端与网页端需先登录 Kooyu 账号，从工作台选择已绑定的电脑并完成授权。
        </p>
        <div className="pair-screen__actions">
          <a className="primary pair-screen__cta" href={loginHref}>
            <UserCheck size={16} />
            登录 Kooyu 账号
          </a>
          <a className="nx-btn pair-screen__secondary" href={workbenchHref}>
            <ExternalLink size={14} />
            前往我的工作台
          </a>
        </div>
        <p className="pair-screen__foot">手机端支持扫码配对或账号登录连接。</p>
      </div>
    );
  }

  if (hashInfo.isAccountRequest) {
    const workbenchHref = `${accountIssuer ?? "https://kooyu.app"}/account/hosts`;
    return (
      <div className="pair-screen pair-screen--card">
        <div className="pair-screen__brand">
          <span className="pair-screen__mark" aria-hidden="true">
            <KooyuBrandMark size={26} />
          </span>
          <span className="pair-screen__badge">账号远程授权</span>
        </div>
        <h1>连接我的工作电脑</h1>
        <p className="pair-screen__sub">
          确认此浏览器的设备名称后点击连接，并在目标电脑的「设置 →
          手机连接」中点击批准即可进入远程工作台。
        </p>
        <form
          className="ios-form pair-screen__form"
          onSubmit={(e) => {
            e.preventDefault();
            submitPair("REQUEST");
          }}
        >
          <label>
            此浏览器设备名称
            <input
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：办公室 Chrome"
            />
          </label>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <button
            className="primary pair-screen__cta"
            type="submit"
            disabled={pending || !name.trim()}
          >
            {pending ? "正在等待工作电脑批准…" : "发起连接并等待电脑批准"}
          </button>
          {pending && (
            <p className="pair-screen__waiting" role="status">
              请保持此页面打开，并在工作电脑的「设置 → 手机连接」点击「批准连接」。
            </p>
          )}
        </form>
        <div className="pair-screen__back">
          <a href={workbenchHref}>返回 Kooyu 官网工作台</a>
        </div>
      </div>
    );
  }

  return (
    <div className="pair-screen pair-screen--card">
      <div className="pair-screen__brand">
        <span className="pair-screen__mark" aria-hidden="true">
          <KooyuBrandMark size={26} />
        </span>
        <span className="pair-screen__badge">自建中继连接</span>
      </div>
      <h1>连接 Kooyu Host</h1>
      <p className="pair-screen__sub">输入目标工作电脑生成的配对码，完成此设备的本地授权。</p>
      <form
        className="ios-form pair-screen__form"
        onSubmit={(e) => {
          e.preventDefault();
          submitPair(code);
        }}
      >
        <label>
          配对码
          <input
            required
            autoComplete="one-time-code"
            maxLength={64}
            autoCapitalize="characters"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </label>
        <label>
          设备名称
          <input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <button
          className="primary pair-screen__cta"
          type="submit"
          disabled={pending || !code.trim() || !name.trim()}
        >
          {pending ? "正在连接…" : "授权此设备并连接"}
        </button>
      </form>
    </div>
  );
}
