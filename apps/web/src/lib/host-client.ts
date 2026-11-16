import type { Command } from "@kodo/protocol";
export const hostPath = /^\/h\/[a-f0-9]{64}(?=\/|$)/.exec(location.pathname)?.[0] ?? "";
export const remoteClient = hostPath !== "";
export const apiPath = (path: string) => hostPath + "/api" + path;
export class HostError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(apiPath(path), {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const value = await response.json();
  if (!response.ok)
    throw new HostError(
      value.error?.message ?? `HTTP ${response.status}`,
      value.error?.code ?? "UNKNOWN",
    );
  return value as T;
}
// A lost acknowledgement is reconciled using its stable ID; never auto-resubmit.
export async function send(
  sessionId: string,
  text: string,
  mode = "queue",
  requestId = crypto.randomUUID(),
  attachmentIds: string[] = [],
): Promise<Command> {
  if (!navigator.onLine) throw new Error("设备离线，消息未发送；恢复连接后请重新操作。");
  try {
    return await api(`/sessions/${sessionId}/send`, "POST", {
      requestId,
      text,
      mode,
      ...(attachmentIds.length ? { attachmentIds } : {}),
    });
  } catch (error) {
    if (error instanceof HostError) throw error;
    try {
      return await api(`/commands/${requestId}`);
    } catch {
      throw new Error(`发送结果未知，请先在时间线核对。请求 ID：${requestId}`);
    }
  }
}
export async function stopSession(
  sessionId: string,
  pause = true,
): Promise<{ status: string; cancel: string }> {
  if (!navigator.onLine) throw new Error("设备离线，停止尚未送达 Host。");
  const requestId = crypto.randomUUID();
  try {
    return await api(`/sessions/${sessionId}/stop`, "POST", { requestId, pause });
  } catch (error) {
    if (error instanceof HostError) throw error;
    let command: Command | undefined;
    try {
      command = await api(`/commands/${requestId}`);
    } catch {}
    if (command?.body.receipt) return command.body.receipt as { status: string; cancel: string };
    throw new Error(`停止结果尚未确认，请先核对时间线。未重发取消请求。请求 ID：${requestId}`);
  }
}

const answering = new Map<string, Promise<unknown>>();
export async function changePendingMessage(
  sessionId: string,
  command: Command,
  action: "edit" | "send-now",
  text?: string,
): Promise<Command> {
  const body = {
    requestId: crypto.randomUUID(),
    expectedRevision: Number(command.body.pendingRevision ?? 0),
    action,
    ...(text !== undefined ? { text } : {}),
  };
  const path = `/sessions/${sessionId}/commands/${command.id}`;
  try {
    return await api<Command>(path, "PATCH", body);
  } catch (e) {
    if (e instanceof HostError) throw e;
    try {
      return await api<Command>(`${path}?requestId=${body.requestId}`);
    } catch {
      throw new Error(`待发消息操作结果未确认，请重新读取。未重发。请求 ID：${body.requestId}`);
    }
  }
}
export function answerInteraction(id: string, answer: unknown): Promise<unknown> {
  const pending = answering.get(id);
  if (pending) return pending;
  const key = `kodo.answer.${id}`,
    body = JSON.stringify(answer);
  const task = (async () => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
    const signature = [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const prior = JSON.parse(sessionStorage.getItem(key) ?? "null");
    const requestId = prior?.signature === signature ? prior.requestId : crypto.randomUUID();
    sessionStorage.setItem(key, JSON.stringify({ signature, requestId }));
    return api(`/interactions/${encodeURIComponent(id)}`, "POST", { requestId, answer });
  })().finally(() => answering.delete(id));
  answering.set(id, task);
  return task;
}
