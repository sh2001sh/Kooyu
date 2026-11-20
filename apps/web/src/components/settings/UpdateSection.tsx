import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Download,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sparkles,
} from "lucide-react";
import { DEFAULT_UPDATE_SETTINGS, type AppUpdateStatus } from "@kodo/protocol";
import { api, remoteClient } from "../../lib/host-client";
import { formatDate } from "../../lib/harnesses";
import { useT } from "../../lib/i18n";
import { useAppPreferences } from "../../lib/preferences";
import { KodoMark } from "../KodoBrand";
import { SettingsRow, SettingsSection, SxSelect, Toggle } from "./SettingsKit";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UpdateSection() {
  const t = useT();
  const { settings, update } = useAppPreferences();
  const updatePrefs = settings.update ?? DEFAULT_UPDATE_SETTINGS;

  const [status, setStatus] = useState<AppUpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [actionMsg, setActionMsg] = useState("");
  const [actionError, setActionError] = useState("");

  const fetchStatus = useCallback(async () => {
    try {
      const next = await api<AppUpdateStatus>("/app-update");
      setStatus(next);
      return next;
    } catch {
      return null;
    }
  }, []);

  const checkNow = useCallback(
    async (channelOverride?: "stable" | "preview") => {
      if (checking) return;
      setChecking(true);
      setActionError("");
      setActionMsg("");
      try {
        const next = await api<AppUpdateStatus>("/app-update/check", "POST", {
          channel: channelOverride ?? updatePrefs.channel,
          repository: updatePrefs.repository,
        });
        setStatus(next);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err));
      } finally {
        setChecking(false);
      }
    },
    [checking, updatePrefs.channel, updatePrefs.repository],
  );

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    const onExternalCheck = () => void checkNow();
    window.addEventListener("kooyu:check-updates", onExternalCheck);
    return () => window.removeEventListener("kooyu:check-updates", onExternalCheck);
  }, [checkNow]);

  const downloading =
    status?.download.state === "downloading" || status?.download.state === "verifying";

  useEffect(() => {
    if (!downloading) return;
    const timer = setInterval(() => {
      void fetchStatus();
    }, 450);
    return () => clearInterval(timer);
  }, [downloading, fetchStatus]);

  const startDownload = async () => {
    setActionError("");
    setActionMsg("");
    try {
      const next = await api<AppUpdateStatus>("/app-update/download", "POST", {});
      setStatus(next);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const launchInstall = async () => {
    if (installing) return;
    setInstalling(true);
    setActionError("");
    try {
      const res = await api<{ launched: boolean; localPath: string; message: string }>(
        "/app-update/install",
        "POST",
        {},
      );
      setActionMsg(res.message);
      void fetchStatus();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setInstalling(false);
    }
  };

  const changeChannel = (channel: "stable" | "preview") => {
    void update((cur) => ({
      ...cur,
      update: { ...(cur.update ?? DEFAULT_UPDATE_SETTINGS), channel },
    })).then(() => void checkNow(channel));
  };

  const toggleAutoCheck = (autoCheck: boolean) => {
    void update((cur) => ({
      ...cur,
      update: { ...(cur.update ?? DEFAULT_UPDATE_SETTINGS), autoCheck },
    }));
  };

  const latest = status?.latest ?? null;
  const dl = status?.download;
  const dlPercent =
    dl && dl.totalBytes && dl.totalBytes > 0
      ? Math.min(100, Math.round((dl.downloadedBytes / dl.totalBytes) * 100))
      : null;

  const isChecking = checking || status?.state === "checking";

  if (status?.distribution === "npm")
    return (
      <SettingsSection title={t("update.section")}>
        <SettingsRow label={`Kooyu v${status.currentVersion} · npm`}>
          <a href="https://www.npmjs.com/package/kooyu" target="_blank" rel="noreferrer">
            npm
          </a>
        </SettingsRow>
        <p className="sx-note">
          停止当前服务后，在运行 Host 的设备上执行以下命令，再重新启动。应用数据会保留。
        </p>
        <pre>
          <code>{status.updateCommand}</code>
        </pre>
        <p className="sx-note">
          临时运行使用 <code>npx kooyu@latest</code>。
        </p>
      </SettingsSection>
    );
  return (
    <SettingsSection title={t("update.section")}>
      <div className="sx-update-hero">
        <div className="sx-update-hero__id">
          <span className="sx-update-hero__icon" aria-hidden="true">
            <KodoMark size={24} />
          </span>
          <div className="sx-update-hero__meta">
            <div className="sx-update-hero__title-row">
              <strong>Kooyu v{status?.currentVersion ?? "0.2.1"}</strong>
              {status?.updateAvailable && latest ? (
                <span className="sx-update-badge is-new">
                  <Sparkles size={11} aria-hidden="true" />
                  <span>
                    {t("update.available")} v{latest.version}
                  </span>
                </span>
              ) : status?.state === "up-to-date" ? (
                <span className="sx-update-badge is-current">
                  <CheckCircle2 size={11} aria-hidden="true" />
                  <span>{t("update.upToDate")}</span>
                </span>
              ) : null}
            </div>
            <span className="sx-update-hero__sub">
              {status?.checkedAt
                ? `${status.repository} · ${formatDate(status.checkedAt)}`
                : (status?.repository ?? updatePrefs.repository)}
            </span>
          </div>
        </div>
        <button
          type="button"
          className="quiet-btn sx-update-check-btn"
          disabled={isChecking}
          onClick={() => void checkNow()}
        >
          <RefreshCw size={13} className={isChecking ? "spin" : ""} aria-hidden="true" />
          <span>{isChecking ? t("update.checking") : t("update.check")}</span>
        </button>
      </div>

      {(actionError || status?.error || dl?.error) && (
        <div className="sx-update-alert is-error" role="alert">
          {actionError || dl?.error || status?.error}
        </div>
      )}

      {actionMsg && (
        <div className="sx-update-alert is-success" role="status">
          <CheckCircle2 size={14} aria-hidden="true" />
          <span>{actionMsg}</span>
        </div>
      )}

      {status?.updateAvailable && latest && (
        <div className="sx-update-card">
          <div className="sx-update-card__head">
            <div>
              <strong>{latest.title}</strong>
              <div className="sx-update-card__tags">
                <span className="sx-tag">{latest.tag}</span>
                <span className="sx-tag">
                  {latest.prerelease ? t("update.channel.preview") : t("update.channel.stable")}
                </span>
                {latest.recommendedAsset && (
                  <span className="sx-tag">
                    {latest.recommendedAsset.name} · {formatBytes(latest.recommendedAsset.size)}
                  </span>
                )}
              </div>
            </div>
            <a
              href={latest.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="sx-apply-mini-btn sx-update-link"
            >
              <span>{t("update.openRelease")}</span>
              <ExternalLink size={11} aria-hidden="true" />
            </a>
          </div>

          {latest.notes && (
            <details className="sx-update-notes" open>
              <summary>{t("update.releaseNotes")}</summary>
              <pre>{latest.notes}</pre>
            </details>
          )}

          {downloading && dl && (
            <div className="sx-update-progress" role="status" aria-live="polite">
              <div className="sx-update-progress__meta">
                <span>
                  {dl.state === "verifying"
                    ? t("update.verifying")
                    : `${t("update.downloading")} ${dl.assetName ?? ""}`}
                </span>
                <span>
                  {formatBytes(dl.downloadedBytes)}
                  {dl.totalBytes ? ` / ${formatBytes(dl.totalBytes)}` : ""}
                  {dlPercent !== null ? ` · ${dlPercent}%` : ""}
                </span>
              </div>
              <div className="sx-update-progress__track">
                <div className="sx-update-progress__bar" style={{ width: `${dlPercent ?? 35}%` }} />
              </div>
            </div>
          )}

          <div className="sx-update-card__actions">
            {dl?.state === "ready" && dl.tag === latest.tag && !remoteClient ? (
              <>
                <button
                  type="button"
                  className="primary sx-update-primary-btn"
                  disabled={installing}
                  onClick={() => void launchInstall()}
                >
                  <Download size={14} aria-hidden="true" />
                  <span>{installing ? t("update.installing") : t("update.install")}</span>
                </button>
                {dl.sha256Verified && (
                  <span className="sx-update-verified">
                    <ShieldCheck size={13} aria-hidden="true" />
                    <span>{t("update.verified")}</span>
                  </span>
                )}
              </>
            ) : latest.recommendedAsset && !remoteClient ? (
              <button
                type="button"
                className="primary sx-update-primary-btn"
                disabled={downloading}
                onClick={() => void startDownload()}
              >
                <Download size={14} aria-hidden="true" />
                <span>{downloading ? t("update.downloading") : t("update.download")}</span>
              </button>
            ) : latest.recommendedAsset ? (
              <a
                href={latest.recommendedAsset.downloadUrl}
                target="_blank"
                rel="noreferrer"
                className="primary sx-update-primary-btn sx-update-link"
              >
                <Download size={14} aria-hidden="true" />
                <span>{t("update.download")}</span>
              </a>
            ) : (
              <span className="sx-update-hint">{t("update.noLocalAsset")}</span>
            )}

            {latest.androidAsset && (
              <a
                href={latest.androidAsset.downloadUrl}
                target="_blank"
                rel="noreferrer"
                className="quiet-btn sx-update-link"
              >
                <Smartphone size={13} aria-hidden="true" />
                <span>{t("update.androidApk")}</span>
              </a>
            )}
          </div>
        </div>
      )}

      <SettingsRow label={t("update.channel")} htmlFor="pref-update-channel">
        <SxSelect
          id="pref-update-channel"
          ariaLabel={t("update.channel")}
          value={updatePrefs.channel}
          options={[
            { value: "stable", label: t("update.channel.stable") },
            { value: "preview", label: t("update.channel.preview") },
          ]}
          onChange={(val) => changeChannel(val as "stable" | "preview")}
        />
      </SettingsRow>
      <SettingsRow label={t("update.autoCheck")}>
        <Toggle
          label={t("update.autoCheck")}
          checked={updatePrefs.autoCheck}
          onChange={toggleAutoCheck}
        />
      </SettingsRow>
    </SettingsSection>
  );
}
