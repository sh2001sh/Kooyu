import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, ChevronRight, ShieldAlert, Smartphone } from "lucide-react";
import QRCode from "qrcode";
import type { InboxItem, ProviderConfiguration, Snapshot, Usage } from "@kodo/protocol";
import { api, remoteClient } from "../lib/host-client";
import { formatDate } from "../lib/harnesses";
import { KodoMark } from "./KodoBrand";
import { GeneralSettings } from "./settings/GeneralSettings";
import { EngineSettings } from "./settings/EngineSettings";
import { ProviderSettings } from "./settings/ProviderSettings";
import { AdvancedSettings } from "./settings/AdvancedSettings";
import { SettingsPage, SettingsSection } from "./settings/SettingsKit";
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
  return (
    <>
      {pending.length === 0 ? (
        <div className="empty-small settings-group">
          <span className="empty-small__badge" aria-hidden="true">
            <Check size={22} />
          </span>
          <h2>暂无待处理事项</h2>
        </div>
      ) : (
        <div className="card-stack">
          {pending.map((i) => {
            const title = snapshot?.sessions.find((s) => s.id === i.sessionId)?.title ?? "未知会话";
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
                    <span>{typeText}</span>
                  </div>
                  <time className="inbox-item__time">{formatDate(i.createdAt)}</time>
                </div>
                <pre>{JSON.stringify(i.payload, null, 2)}</pre>
                <div className="actions">
                  <button
                    type="button"
                    className="primary"
                    onClick={() => onOpenSession(i.sessionId)}
                  >
                    打开会话
                    <ChevronRight size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void act(() => api(`/inbox/${encodeURIComponent(i.id)}/read`, "POST", {}))
                    }
                  >
                    标记已读
                  </button>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
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
}: {
  snapshot: Snapshot;
  act: Action;
  usage?: { records: Usage[]; budgets: Wire[] };
  section: SettingsSectionId;
  onSectionChange: (next: SettingsSectionId) => void;
  providerConfig?: ProviderConfiguration;
  onProviderConfigLoaded?: (next: ProviderConfiguration) => void;
}) {
  return (
    <div className="page-stack">
      {section === "general" && <GeneralSettings snapshot={snapshot} />}
      {section === "harnesses" && (
        <EngineSettings
          snapshot={snapshot}
          act={act}
          onOpenProviders={() => onSectionChange("providers")}
        />
      )}
      {section === "providers" && <ProviderSettings act={act} onLoaded={onProviderConfigLoaded} />}
      {section === "usage" && <UsagePage snapshot={snapshot} usage={usage} act={act} />}
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

export function DevicesPage({ snapshot, act }: { snapshot: Snapshot; act: Action }) {
  const [pair, setPair] = useState<Wire>();
  const [qr, setQr] = useState("");
  const [remote, setRemote] = useState<Wire>();
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState("");
  const [now, setNow] = useState(Date.now());
  const devices: Snapshot["devices"] = remote?.devices ?? snapshot.devices;
  const initialDevices = useRef(snapshot.devices.length);
  const remaining = pair ? Math.max(0, Math.ceil((Date.parse(pair.expiresAt) - now) / 1000)) : 0;
  useEffect(() => {
    if (remoteClient) return;
    let cancelled = false;
    const refresh = () => {
      void api<Wire>("/remote")
        .then((next) => {
          if (!cancelled) setRemote(next);
        })
        .catch(() => {});
    };
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
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
  const generate = async () => {
    if (pending) return;
    setPending(true);
    setProblem("");
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

  return (
    <SettingsPage
      title="手机连接"
      description="扫描二维码或输入配对码，在手机上远程查看与操控 Kooyu"
    >
      <SettingsSection
        title="快速配对"
        description={
          remoteClient
            ? "配对和设备撤销需要在电脑端操作"
            : "无需配置网络。开启远程连接后，用手机相机扫码"
        }
      >
        <div className="pairing-card">
          <div className="pairing-card__hero">
            <span className="pairing-card__icon" aria-hidden="true">
              <Smartphone size={28} />
            </span>
            <div className="pairing-card__info">
              <strong>手机即时伴侣</strong>
              <p>
                {remoteClient
                  ? "当前已连接电脑"
                  : remote?.state === "connected"
                    ? "远程连接已建立"
                    : remote?.enabled
                      ? "正在连接中继，请保持电脑联网"
                      : "生成二维码时开启远程连接，可随时关闭"}
              </p>
            </div>
            <button
              type="button"
              className="primary pairing-card__btn"
              disabled={pending || remoteClient}
              onClick={() => void generate()}
            >
              {pending ? "正在建立连接…" : pair ? "重新生成配对码" : "生成配对码"}
            </button>
          </div>
          {problem && (
            <p role="alert" className="form-error">
              {problem}
            </p>
          )}
          {pair && remaining > 0 && (
            <div className="pairing-code">
              <div className="pairing-code__qr">
                <img src={qr} alt="手机配对二维码" width="184" height="184" />
              </div>
              <strong className="pairing-code__value">{pair.code}</strong>
              <span>单次使用，剩余 {remaining} 秒</span>
              <a href={pair.url} target="_blank" rel="noreferrer">
                打开配对页面
              </a>
            </div>
          )}
          {pair && remaining === 0 && <p role="status">配对码已过期，请重新生成。</p>}
          {!remoteClient && remote?.enabled && (
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
              关闭远程连接
            </button>
          )}
          <p className="detail-empty-note">
            电脑需保持开机联网。中继使用 HTTPS 加密传输，不保存会话正文；当前版本非端到端加密。
          </p>
        </div>
      </SettingsSection>

      <SettingsSection title="已配对设备" description="管理已获得此 Host 访问权限的移动端设备">
        {devices.length === 0 ? (
          <div className="sx-empty detail-empty-note">暂无已配对设备</div>
        ) : (
          devices.map((d) => (
            <div className="device-row sx-row" key={d.id}>
              <div className="device-row__info">
                <Smartphone size={18} className="device-row__icon" />
                <div className="device-row__text">
                  <strong>{d.name}</strong>
                  <time>{formatDate(d.createdAt)}</time>
                  {d.expiresAt && <span>有效期至 {formatDate(d.expiresAt)}</span>}
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
  const [code, setCode] = useState(() => {
    try {
      return decodeURIComponent(location.hash.replace(/^#pair=/, ""));
    } catch {
      return "";
    }
  });
  const [name, setName] = useState("我的手机");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);

  return (
    <div className="pair-screen settings-group">
      <span className="welcome-mark" aria-hidden="true">
        <KodoMark size={30} />
      </span>
      <h1>连接 Kooyu Host</h1>
      <form
        className="ios-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (submitting.current) return;
          submitting.current = true;
          setPending(true);
          setError("");
          void api("/pair", "POST", { code: code.trim(), name: name.trim() })
            .then(onDone)
            .catch((err) => setError(err.message))
            .finally(() => {
              submitting.current = false;
              setPending(false);
            });
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
          className="primary"
          type="submit"
          disabled={pending || !code.trim() || !name.trim()}
        >
          {pending ? "正在连接…" : "配对并连接"}
        </button>
      </form>
    </div>
  );
}
