import { KodoError } from "@kodo/protocol";
/** Bound the body while streaming, including absent or dishonest Content-Length. */
export async function boundedText(response: Response, limit = 2 * 1024 * 1024): Promise<string> {
  if (Number(response.headers.get("content-length") ?? 0) > limit) {
    await response.body?.cancel();
    throw new KodoError("UNAVAILABLE", "服务响应超过大小限制。");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new KodoError("UNAVAILABLE", "服务返回空响应。");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new KodoError("UNAVAILABLE", "服务响应超过大小限制。");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function boundedJson(
  response: Response,
  limit?: number,
  reviver?: (key: string, value: unknown, context?: { source?: string }) => unknown,
): Promise<any> {
  const text = await boundedText(response, limit);
  try {
    return JSON.parse(text, reviver);
  } catch {
    throw new KodoError("UNAVAILABLE", "服务未返回有效 JSON。");
  }
}
