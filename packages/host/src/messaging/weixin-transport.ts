import { AsyncLocalStorage } from "node:async_hooks";
import { KodoError } from "@kodo/protocol";
import { boundedText } from "../applications/http.js";

const transport = new AsyncLocalStorage<typeof fetch>();
export async function withWeixinTransport<T>(
  fetcher: typeof fetch,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await transport.run(fetcher, run);
  } catch {
    throw new KodoError("UNAVAILABLE", "微信服务未确认请求，请检查账号状态后重试。");
  }
}

export function allowedOrigin(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !(url.hostname === "ilinkai.weixin.qq.com" || url.hostname.endsWith(".weixin.qq.com"))
  )
    throw new KodoError("INVALID_INPUT", "微信返回的服务地址无效。");
  return url.origin;
}

export async function weixinFetch(url: string, init: RequestInit) {
  allowedOrigin(url);
  const fetcher = transport.getStore();
  if (!fetcher) throw new Error("Missing ClawBot transport");
  const response = await fetcher(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.any([AbortSignal.timeout(40000), ...(init.signal ? [init.signal] : [])]),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("ClawBot request failed");
  }
  return new Response(await boundedText(response));
}
