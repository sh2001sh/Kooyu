import { useCallback, useEffect, useState } from "react";
import { Check, Download, ExternalLink, RefreshCw } from "lucide-react";
import type { EngineInstallationOption, HarnessId, Snapshot } from "@kodo/protocol";
import { api } from "../../lib/host-client";
import { HarnessBadge } from "../KodoBrand";

const common: HarnessId[] = ["codex", "claude-code", "opencode", "deepseek-harness", "cursor"];

export function SetupEngines({
  snapshot,
  refresh,
}: {
  snapshot: Snapshot;
  refresh: () => Promise<Snapshot>;
}) {
  const [management, setManagement] = useState<EngineInstallationOption[]>();
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const next = await api<EngineInstallationOption[]>("/harnesses/management");
    setManagement(next);
    await refresh();
  }, [refresh]);
  useEffect(() => {
    void load().catch((e: Error) => setError(e.message));
  }, [load]);
  const installing = management?.some((m) => m.job?.state === "running");
  useEffect(() => {
    if (!installing) return;
    const timer = setInterval(() => void load().catch((e: Error) => setError(e.message)), 1800);
    return () => clearInterval(timer);
  }, [installing, load]);
  const run = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "检测失败，请重试。");
    } finally {
      setBusy(false);
    }
  };
  const engines = snapshot.harnesses.filter(
    (h) => h.id !== "kodo" && (all || common.includes(h.id) || h.health?.launchable),
  );
  return (
    <section className="setup-engines" aria-label="执行引擎">
      <div className="setup-engine-built-in">
        <HarnessBadge harnessId="kodo" />
        <div>
          <strong>Kooyu 主 Agent</strong>
          <span>
            {snapshot.bindingDefaults.harnessBindingIds.kodo
              ? "已内置 · API 配置已保存"
              : "已内置 · API 可稍后配置"}
          </span>
        </div>
        <Check size={18} />
      </div>
      <div className="setup-section-title">
        <h3>原生执行引擎</h3>
        <button
          disabled={busy}
          onClick={() => void run(() => api("/harnesses/installations?refresh=1"))}
        >
          <RefreshCw size={14} />
          {busy ? "检测中…" : "重新检测"}
        </button>
      </div>
      {error && (
        <p role="alert" className="setup-error">
          {error}
        </p>
      )}
      {!management && (
        <p role="status" className="setup-help">
          正在检测安装方式…
        </p>
      )}
      <ul className="setup-engine-list">
        {engines.map((h) => {
          const option = management?.find((m) => m.harnessId === h.id);
          const job = option?.job;
          const running = job?.state === "running";
          const ready = Boolean(h.health?.launchable);
          const status = running
            ? "正在安装"
            : ready
              ? "已检测到 · 账号待确认"
              : h.health?.installed
                ? "已安装 · 需设置启动入口"
                : "尚未安装";
          return (
            <li key={h.id}>
              <div className="setup-engine-row">
                <HarnessBadge harnessId={h.id} />
                <div>
                  <strong>{h.name}</strong>
                  <span className={ready ? "is-ready" : ""}>{status}</span>
                </div>
                {ready ? (
                  <Check size={17} className="setup-ready-mark" aria-label="已检测到程序" />
                ) : (
                  option?.kind === "managed-npm" && (
                    <button
                      disabled={busy || running}
                      onClick={() =>
                        void run(() => api("/harnesses/" + h.id + "/install", "POST", {}))
                      }
                    >
                      <Download size={14} />
                      {running ? "安装中…" : job?.state === "failed" ? "重试安装" : "安装"}
                    </button>
                  )
                )}
                {option?.documentation && (
                  <a
                    href={option.documentation}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={h.name + (ready ? " 登录与配置说明" : " 安装说明")}
                  >
                    {ready ? "登录说明" : "安装说明"}
                    <ExternalLink size={13} />
                  </a>
                )}
              </div>
              {job && (
                <p
                  className={"setup-install-message" + (job.state === "failed" ? " is-error" : "")}
                  role={job.state === "failed" ? "alert" : "status"}
                >
                  {job.message}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <button className="setup-text-button" onClick={() => setAll(!all)}>
        {all ? "收起其他引擎" : "查看全部 10 种引擎"}
      </button>
      <p className="setup-help setup-disclosure">
        安装会下载对应原生程序。引擎使用自己的账号和权限；需要复用 API 时，可在「设置 →
        引擎」单独绑定。
      </p>
    </section>
  );
}
