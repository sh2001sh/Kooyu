import { exec } from "node:child_process";
import type { AutomationCheckScript } from "@kodo/protocol";
import { stripAmbientSecrets } from "../execution/clean-env.js";

const CHECK_OUTPUT_MAX_CHARS = 4000;
const CHECK_ERROR_MAX_CHARS = 600;

export interface CheckScriptResult {
  outcome: "quiet" | "hit" | "failed";
  output: string;
  exitCode: number | null;
  reason?: string;
}

/**
 * Runs a lightweight local preflight check script before waking an LLM agent.
 * Uses stripped ambient secrets, strict timeout, and bounded output so idle
 * scheduled checks cost 0 LLM tokens and cannot leak host API keys.
 */
export function runCheckScript(
  spec: Pick<AutomationCheckScript, "command" | "cwd" | "timeoutSec" | "mode">,
  fallbackCwd: string,
): Promise<CheckScriptResult> {
  const timeoutMs = Math.max(5, Math.min(120, spec.timeoutSec ?? 60)) * 1000;
  const mode = spec.mode ?? "non-empty-stdout-is-hit";
  const cwd = spec.cwd?.trim() || fallbackCwd;

  return new Promise((resolve) => {
    exec(
      spec.command,
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 256 * 1024,
        windowsHide: true,
        env: stripAmbientSecrets(process.env),
      },
      (error, stdout, stderr) => {
        const out = String(stdout ?? "")
          .trim()
          .slice(0, CHECK_OUTPUT_MAX_CHARS);
        const err = String(stderr ?? "")
          .trim()
          .slice(0, CHECK_ERROR_MAX_CHARS);
        const exitCode =
          error && typeof (error as { code?: unknown }).code === "number"
            ? Number((error as { code: number }).code)
            : error
              ? 1
              : 0;

        if (error && (error as { killed?: boolean }).killed) {
          resolve({
            outcome: "failed",
            output: out,
            exitCode: null,
            reason: `预检脚本超时（>${Math.round(timeoutMs / 1000)}s）${err ? `：${err}` : ""}`,
          });
          return;
        }

        if (mode === "exit-zero-is-hit") {
          if (!error) {
            resolve({ outcome: "hit", output: out || "(exit 0)", exitCode: 0 });
          } else if (exitCode === 1) {
            resolve({ outcome: "quiet", output: out, exitCode: 1 });
          } else {
            resolve({
              outcome: "failed",
              output: out,
              exitCode,
              reason: err || error.message || `预检脚本异常退出 (${exitCode})`,
            });
          }
          return;
        }

        // Default mode: non-empty-stdout-is-hit
        if (error) {
          resolve({
            outcome: "failed",
            output: out,
            exitCode,
            reason: err || error.message || `预检脚本退出码 ${exitCode}`,
          });
          return;
        }
        if (out.length > 0) {
          resolve({ outcome: "hit", output: out, exitCode: 0 });
        } else {
          resolve({ outcome: "quiet", output: "", exitCode: 0 });
        }
      },
    );
  });
}
