import { useEffect, useState } from "react";
import { Github, ExternalLink, Copy } from "lucide-react";
import { api } from "../lib/host-client";
import "../styles/github-login.css";

interface Login {
  id: string;
  connectionId: string;
  userCode: string;
  verificationUri: string;
  expiresAt: string;
  interval: number;
  status: string;
}
export function GitHubLogin({ onConnected }: { onConnected: () => Promise<void> }) {
  const [configuration, setConfiguration] = useState<{
    clientId: string;
    configured: boolean;
    managed: boolean;
  }>();
  const [clientId, setClientId] = useState("");
  const [login, setLogin] = useState<Login>();
  const [privateRepositories, setPrivateRepositories] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [copied, setCopied] = useState(false);
  useEffect(() => {
    let active = true;
    void api<{ clientId: string; configured: boolean; managed: boolean }>(
      "/oauth/github/configuration",
    )
      .then((c) => {
        if (active) {
          setConfiguration(c);
          setClientId(c.clientId);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (login?.status !== "pending") return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api<Login>(`/oauth/github/${login.id}/poll`, "POST", {});
        if (!active) return;
        setLogin(next);
        setError("");
        if (next.status === "connected") {
          await onConnected();
          return;
        }
        if (next.status !== "pending") return;
      } catch (e) {
        if (active)
          setError(e instanceof Error ? e.message : "GitHub 登录状态读取失败，请重新检查。");
      }
      if (active) timer = setTimeout(poll, Math.max(5, login.interval) * 1000);
    };
    timer = setTimeout(poll, Math.max(5, login.interval) * 1000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [login?.id, login?.status, login?.interval, onConnected]);
  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "GitHub 登录失败，请重试。");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="work-form github-login">
      <div className="work-section-head">
        <div>
          <strong>
            <Github size={16} /> GitHub
          </strong>
          <p className="work-hint">
            通过 GitHub 授权连接账号，无需复制访问令牌。连接后再选择主对话可操作的仓库和权限。
          </p>
        </div>
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {configuration && !configuration.configured && (
        <div>
          <p className="work-hint">
            首次使用需填写 Kooyu 的 GitHub OAuth App Client ID，并在 GitHub 应用设置中启用 Device
            flow。
          </p>
          <label className="work-field">
            <span>GitHub OAuth App Client ID</span>
            <input
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="Ov23…"
              maxLength={200}
            />
          </label>
          <button
            type="button"
            disabled={busy || !clientId.trim()}
            onClick={() =>
              void run(async () => {
                setConfiguration(
                  await api("/oauth/github/configuration", "POST", { clientId: clientId.trim() }),
                );
              })
            }
          >
            保存 GitHub 应用
          </button>
        </div>
      )}
      {login?.status === "pending" ? (
        <div role="status">
          <p>在 GitHub 页面输入以下验证码，授权完成后这里会自动更新。</p>
          <div className="work-actions">
            <strong className="github-login__code">{login.userCode}</strong>
            <button
              type="button"
              onClick={() =>
                void run(async () => {
                  await navigator.clipboard.writeText(login.userCode);
                  setCopied(true);
                })
              }
            >
              <Copy size={14} />
              {copied ? "已复制" : "复制验证码"}
            </button>
          </div>
          <p className="work-hint">
            请确认 GitHub 页面显示的是你配置的 Kooyu 应用。验证码有效至{" "}
            {new Date(login.expiresAt).toLocaleTimeString()}。
          </p>
          <div className="work-actions">
            <a
              className="quiet-btn"
              href="https://github.com/login/device"
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={14} />
              打开 GitHub 授权页
            </a>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const next = await api<Login>(`/oauth/github/${login.id}/poll`, "POST", {});
                  setLogin(next);
                  if (next.status === "connected") await onConnected();
                })
              }
            >
              检查授权结果
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setLogin(await api<Login>(`/oauth/github/${login.id}/cancel`, "POST", {}));
                })
              }
            >
              取消登录
            </button>
          </div>
        </div>
      ) : (
        <>
          {login?.status === "connected" && (
            <p role="status">GitHub 已连接。请在下方为主对话授予具体仓库和操作权限。</p>
          )}
          {login?.status === "expired" && <p role="status">验证码已过期，请重新登录。</p>}
          {login?.status === "denied" && <p role="status">你已拒绝 GitHub 授权，可以重新登录。</p>}
          <label className="work-check">
            <input
              type="checkbox"
              checked={privateRepositories}
              onChange={(e) => setPrivateRepositories(e.target.checked)}
            />
            需要访问私有仓库（向 GitHub 请求 repo 权限）
          </label>
          <p className="work-hint">默认只请求公开仓库权限。Kooyu 内仍需单独授予仓库和操作范围。</p>
          <button
            type="button"
            className="primary"
            disabled={busy || !configuration?.configured}
            onClick={() =>
              void run(async () => {
                const next = await api<Login>("/oauth/github/start", "POST", {
                  requestId: crypto.randomUUID(),
                  privateRepositories,
                });
                setLogin(next);
                setCopied(false);
                window.open("https://github.com/login/device", "_blank", "noopener,noreferrer");
              })
            }
          >
            <Github size={15} />
            {busy ? "正在连接 GitHub…" : "使用 GitHub 登录"}
          </button>
        </>
      )}
      {configuration?.configured && !configuration.managed && (
        <details className="work-details">
          <summary>GitHub 应用设置</summary>
          <label className="work-field">
            <span>Client ID</span>
            <input value={clientId} maxLength={200} onChange={(e) => setClientId(e.target.value)} />
          </label>
          <button
            type="button"
            disabled={busy || login?.status === "pending" || !clientId.trim()}
            onClick={() =>
              void run(async () =>
                setConfiguration(
                  await api("/oauth/github/configuration", "POST", { clientId: clientId.trim() }),
                ),
              )
            }
          >
            保存应用设置
          </button>
        </details>
      )}
    </div>
  );
}
