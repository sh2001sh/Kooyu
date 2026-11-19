import type { Session } from "@kodo/protocol";
import type { Wire } from "./adapter.js";

/** Only native retry facts supply counters; protocols without counters keep them absent. */
export function nativeRetry(p: Wire): Session["retry"] | null | undefined {
  if (p.retry === null || p.type === "auto_retry_end") return null;
  const retry = p.retry && typeof p.retry === "object" ? p.retry : p;
  const kind = retry.subtype ?? retry.type ?? retry.sessionUpdate;
  if (
    !p.willRetry &&
    !p.retry &&
    !["api_retry", "auto_retry_start", "retry", "retrying"].includes(kind)
  )
    return;
  const number = (...values: unknown[]) =>
    values.find((v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0);
  return {
    attempt: number(retry.attempt, retry.retryAttempt),
    maxAttempts: number(retry.maxAttempts, retry.max_retries, retry.maxRetries),
    delayMs: number(retry.delayMs, retry.retry_delay_ms),
    since: new Date().toISOString(),
  };
}
