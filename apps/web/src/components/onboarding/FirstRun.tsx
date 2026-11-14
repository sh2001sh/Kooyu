import { useEffect, useState, type ReactNode } from "react";
import type { OnboardingState } from "@kodo/protocol";
import { api, remoteClient } from "../../lib/host-client";
import { SetupWizard } from "./SetupWizard";
import { SplashScreen } from "../SplashScreen";
import "../../styles/onboarding.css";

const local = !remoteClient && ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);

/** Host-owned state: clearing a browser or opening a second window is not a first launch. */
export function FirstRun({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OnboardingState>();
  const [error, setError] = useState("");
  const [reopened, setReopened] = useState(false);
  const [bypass, setBypass] = useState(false);
  useEffect(() => {
    if (!local) return;
    let alive = true;
    void api<OnboardingState>("/onboarding")
      .then((next) => {
        if (alive) setState(next);
      })
      .catch((e: Error) => {
        if (!alive) return;
        const msg = e.message ?? "";
        if (
          msg.includes("接口不存在") ||
          (e as { code?: string }).code === "NOT_FOUND" ||
          msg.includes("404")
        ) {
          setBypass(true);
          return;
        }
        setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    const open = () => {
      setReopened(true);
      setBypass(false);
    };
    window.addEventListener("kooyu:open-setup", open);
    return () => window.removeEventListener("kooyu:open-setup", open);
  }, []);
  if (!local || (bypass && !reopened) || (state && state.status !== "active" && !reopened))
    return children;
  if (!state)
    return (
      <SplashScreen
        mode="onboarding"
        error={error}
        onRetry={() => location.reload()}
        onBypass={() => setBypass(true)}
      />
    );
  return (
    <SetupWizard
      initial={reopened ? { ...state, step: 0 } : state}
      onDone={(next) => {
        setState(next);
        setReopened(false);
      }}
    />
  );
}
