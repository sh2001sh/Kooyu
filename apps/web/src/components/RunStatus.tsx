import { useEffect, useState } from "react";
import type { Session } from "@kodo/protocol";

export function RunStatus({ retry, fallback }: { retry?: Session["retry"]; fallback: string }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!retry) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [retry]);
  if (!retry) return <span>{fallback}</span>;
  const remaining = Math.max(
    0,
    Math.ceil(((retry.delayMs ?? 0) - (now - Date.parse(retry.since))) / 1000),
  );
  const count =
    retry.attempt === undefined
      ? ""
      : ` ${retry.attempt}${retry.maxAttempts === undefined ? "" : `/${retry.maxAttempts}`}`;
  return (
    <span role="status">
      重试中{count} · {remaining ? `${remaining} 秒后重试` : "正在请求…"}
    </span>
  );
}
