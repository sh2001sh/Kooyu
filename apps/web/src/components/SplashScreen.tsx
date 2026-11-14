import { useEffect, useState } from "react";
import { MobiusLoader } from "./MobiusLoader";
import { KooyuWordmark } from "./KooyuWordmark";
import { RefreshCw } from "lucide-react";

export interface SplashScreenProps {
  mode?: "launch" | "onboarding";
  error?: string;
  onRetry?: () => void;
  onBypass?: () => void;
  /** Custom status message if provided */
  statusText?: string;
}

const LAUNCH_STEPS = [
  "正在连接本地 Host…",
  "正在校验执行引擎与环境…",
  "正在恢复工作区与对话…",
  "界面准备就绪…",
];

export function SplashScreen({
  mode: _mode = "launch",
  error,
  onRetry,
  onBypass,
  statusText,
}: SplashScreenProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [showDelayedActions, setShowDelayedActions] = useState(false);

  useEffect(() => {
    if (error) return;
    const interval = setInterval(() => {
      setStepIndex((prev) => (prev < LAUNCH_STEPS.length - 1 ? prev + 1 : prev));
    }, 1300);
    return () => clearInterval(interval);
  }, [error]);

  useEffect(() => {
    // If waiting takes longer than 4.5s, gracefully show retry option
    const timer = setTimeout(() => {
      setShowDelayedActions(true);
    }, 4500);
    return () => clearTimeout(timer);
  }, []);

  const currentMessage = error ? "无法连接到本地 Host 服务" : statusText || LAUNCH_STEPS[stepIndex];

  return (
    <div className="splash-screen" role="dialog" aria-modal="true" aria-label="正在启动 Kooyu">
      <div className="splash-ambient-aura" aria-hidden="true" />

      <div className="splash-card">
        {/* Dynamic Hero Möbius Strip Animation */}
        <div className="splash-hero-mobius">
          <MobiusLoader size={96} variant="hero" label="启动加载中" />
        </div>

        {/* Brand Identity & Title */}
        <div className="splash-brand-group">
          <div className="splash-brand-title">
            <KooyuWordmark className="splash-wordmark" />
          </div>
          <p className="splash-tagline">让想法，有人接着做。</p>
        </div>

        {/* Dynamic Loading Shimmer Bar & Status */}
        {!error ? (
          <div className="splash-progress-group">
            <div
              className="splash-progress-track"
              role="progressbar"
              aria-valuetext={currentMessage}
            >
              <div className="splash-progress-fill" />
            </div>
            <p className="splash-status-text" aria-live="polite">
              {currentMessage}
            </p>
          </div>
        ) : (
          <div className="splash-error-group" role="alert">
            <p className="splash-error-text">{error}</p>
          </div>
        )}

        {/* Retry & Bypass Actions */}
        {(error || showDelayedActions) && (
          <div className="splash-actions">
            {onRetry && (
              <button type="button" className="splash-btn splash-btn--primary" onClick={onRetry}>
                <RefreshCw size={14} aria-hidden="true" />
                <span>重新连接</span>
              </button>
            )}
            {onBypass && (
              <button type="button" className="splash-btn splash-btn--quiet" onClick={onBypass}>
                先进入工作台
              </button>
            )}
          </div>
        )}
      </div>

      <footer className="splash-footer">
        <span>Kooyu · 独立原生 Coding Agent 协同平台</span>
      </footer>
    </div>
  );
}
