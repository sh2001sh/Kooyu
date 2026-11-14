import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ShieldCheck, RefreshCw } from "lucide-react";
import type { OnboardingState, Snapshot } from "@kodo/protocol";
import { api } from "../../lib/host-client";
import { KodoMark, HarnessBadge } from "../KodoBrand";
import { MobiusLoader } from "../MobiusLoader";
import { SetupConnection } from "./SetupConnection";
import { SetupEngines } from "./SetupEngines";

const steps = [
  { title: "连接主 Agent", description: "可选 · 添加 API，选择主模型" },
  { title: "准备执行引擎", description: "检测或安装需要的 Harness" },
  { title: "开始使用", description: "确认配置，进入工作台" },
];

export function SetupWizard({
  initial,
  onDone,
}: {
  initial: OnboardingState;
  onDone: (state: OnboardingState) => void;
}) {
  const [state, setState] = useState(initial);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const heading = useRef<HTMLHeadingElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const refresh = useCallback(async () => {
    const next = await api<Snapshot>("/snapshot");
    setSnapshot(next);
    return next;
  }, []);
  useEffect(() => {
    void refresh()
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [refresh]);
  useEffect(() => {
    shell.current?.scrollTo({ top: 0 });
    heading.current?.focus({ preventScroll: true });
  }, [state.step]);
  const change = async (step: number, status: OnboardingState["status"] = "active") => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const next = await api<OnboardingState>("/onboarding", "PATCH", {
        expectedRevision: state.revision,
        step,
        status,
      });
      setState(next);
      if (status !== "active") onDone(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败，请重试。");
    } finally {
      setBusy(false);
    }
  };
  const binding = snapshot?.bindings.find(
    (b) => b.id === snapshot.bindingDefaults.harnessBindingIds.kodo,
  );
  const installed =
    snapshot?.harnesses.filter((h) => h.id !== "kodo" && h.health?.launchable) ?? [];
  return (
    <div className="setup-shell" ref={shell}>
      <header className="setup-topbar">
        <span className="setup-brand">
          <KodoMark size={30} />
          <span>kooyu</span>
        </span>
        <button
          className="quiet-btn"
          disabled={busy}
          onClick={() => void change(state.step, "skipped")}
        >
          跳过引导
        </button>
      </header>
      <div className="setup-layout">
        <aside className="setup-sidebar" aria-label="首次设置进度">
          <div className="setup-intro">
            <h1>
              让想法，
              <br />
              有人接着做。
            </h1>
            <p>按需连接主模型，或直接使用熟悉的执行工具。</p>
          </div>
          <ol className="setup-steps">
            {steps.map((step, i) => (
              <li
                key={step.title}
                className={i === state.step ? "is-current" : i < state.step ? "is-done" : ""}
                aria-current={i === state.step ? "step" : undefined}
              >
                <span className="setup-step-index">
                  {i < state.step ? <Check size={15} aria-hidden="true" /> : i + 1}
                </span>
                <div>
                  <strong>{step.title}</strong>
                  <small>{step.description}</small>
                </div>
              </li>
            ))}
          </ol>
          <div className="setup-sidebar-note">
            <ShieldCheck size={17} />
            <p>密钥交由本机系统凭据库保存。引导不会自动发送模型消息。</p>
          </div>
        </aside>
        <main className="setup-main" aria-label="首次设置">
          <div className="setup-content">
            <div className="setup-mobile-progress" aria-hidden="true">
              第 {state.step + 1} 步，共 3 步 · {steps[state.step]?.title}
            </div>
            <h2 ref={heading} tabIndex={-1}>
              {state.step === 0
                ? "为主 Agent 连接模型（可选）"
                : state.step === 1
                  ? "接上你想用的执行引擎"
                  : "你的工作台，准备好了"}
            </h2>
            <p className="setup-lead">
              {state.step === 0
                ? "想让 Kooyu 理解目标、安排任务时再连接模型。你也可以跳过，直接使用各个 Harness。"
                : state.step === 1
                  ? "已安装的工具会自动识别。选装需要的即可，主 Agent API 不影响原生引擎的独立使用。"
                  : binding
                    ? "主 Agent 已保存配置。执行引擎沿用各自的登录与设置，随时可以在设置中调整。"
                    : "你可以直接使用各个 Harness；主 Agent 的 API 随时可以到设置中补充。"}
            </p>
            {error && (
              <div className="setup-error" role="alert">
                <p>{error}</p>
                <button onClick={() => location.reload()}>重新载入</button>
              </div>
            )}
            {loading ? (
              <div className="setup-inline-loading" role="status">
                <MobiusLoader size={26} label="正在读取配置" />
                <span>正在读取本机配置…</span>
              </div>
            ) : !snapshot ? (
              <button
                onClick={() => {
                  setLoading(true);
                  void refresh()
                    .then(() => setError(""))
                    .catch((e: Error) => setError(e.message))
                    .finally(() => setLoading(false));
                }}
              >
                重试读取配置
              </button>
            ) : (
              <>
                {state.step === 0 && (
                  <>
                    <div className="setup-skip-step">
                      <button disabled={busy} onClick={() => void change(1)}>
                        跳过 API，先准备引擎 <ArrowRight size={15} />
                      </button>
                    </div>
                    <SetupConnection
                      snapshot={snapshot}
                      refresh={refresh}
                      onContinue={() => change(1)}
                    />
                  </>
                )}
                {state.step === 1 && <SetupEngines snapshot={snapshot} refresh={refresh} />}
                {state.step === 2 && (
                  <div className="setup-review">
                    <div className="setup-review-row">
                      <HarnessBadge harnessId="kodo" />
                      <div>
                        <strong>主 Agent · Kooyu</strong>
                        <span>
                          {binding ? binding.name + " · " + binding.model : "主模型尚未配置"}
                        </span>
                      </div>
                      <button onClick={() => void change(0)}>修改</button>
                    </div>
                    <div className="setup-review-row">
                      <ShieldCheck size={22} />
                      <div>
                        <strong>
                          {binding ? "配置已保存，对话尚未测试" : "主 Agent API 暂未配置"}
                        </strong>
                        <span>
                          {binding
                            ? "第一条消息会使用所选 API；费用和工具能力由你的模型服务决定。"
                            : "不影响直接使用原生引擎。需要 Kooyu 帮你安排任务时，再连接主模型。"}
                        </span>
                      </div>
                    </div>
                    <div className="setup-review-row">
                      <RefreshCw size={22} />
                      <div>
                        <strong>
                          {installed.length
                            ? "已检测到 " + installed.length + " 个执行引擎"
                            : "执行引擎可以稍后添加"}
                        </strong>
                        <span>
                          {installed.length
                            ? installed.map((h) => h.name).join("、") +
                              "。程序可启动不代表账号已登录。"
                            : "需要委派时，再到设置 → 引擎添加。"}
                        </span>
                      </div>
                      <button onClick={() => void change(1)}>管理</button>
                    </div>
                  </div>
                )}
                {state.step > 0 && (
                  <footer className="setup-footer">
                    <button disabled={busy} onClick={() => void change(state.step - 1)}>
                      <ArrowLeft size={15} /> 上一步
                    </button>
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => void change(2, state.step === 2 ? "completed" : "active")}
                    >
                      {busy ? "正在保存…" : state.step === 1 ? "继续" : "进入工作台"}
                      <ArrowRight size={15} />
                    </button>
                  </footer>
                )}
              </>
            )}
          </div>
          <p className="setup-footnote">
            配置保存在本机。关窗后可继续，也可在「设置 → 通用」重新打开。
          </p>
        </main>
      </div>
    </div>
  );
}
