import { randomUUID } from "node:crypto";
import { KodoError } from "@kodo/protocol";
import { allowedOrigin, withWeixinTransport } from "./weixin-transport.js";
import { fetchQRCode, pollQRStatus, getUpdates, sendMessage } from "./vendor/clawbot.js";

const origin = "https://ilinkai.weixin.qq.com";
export class WeixinBot {
  private starting = 0;
  private readonly logins = new Map<
    string,
    { qr: string; origin: string; expires: number; controllerId: string }
  >();
  constructor(private readonly fetcher: typeof fetch) {}

  async start(controllerId: string) {
    for (const [id, item] of this.logins) if (item.expires <= Date.now()) this.logins.delete(id);
    if (this.logins.size + this.starting >= 8)
      throw new KodoError("CONFLICT", "请先完成已有的扫码请求。");
    this.starting++;
    try {
      const qr = await withWeixinTransport(this.fetcher, () => fetchQRCode(origin, "3"));
      if (typeof qr.qrcode !== "string" || typeof qr.qrcode_img_content !== "string")
        throw new KodoError("UNAVAILABLE", "微信未返回二维码。");
      const id = randomUUID();
      this.logins.set(id, { qr: qr.qrcode, origin, expires: Date.now() + 300000, controllerId });
      return { id, qrContent: qr.qrcode_img_content };
    } finally {
      this.starting--;
    }
  }
  async status(id: string, code?: string) {
    const login = this.logins.get(id);
    if (!login || login.expires <= Date.now()) {
      this.consume(id);
      return { status: "expired" };
    }
    const result = await withWeixinTransport(this.fetcher, () =>
      pollQRStatus(login.origin, login.qr, code),
    );
    if (this.logins.get(id) !== login || login.expires <= Date.now()) {
      this.consume(id);
      return { status: "expired" };
    }
    if (result.status === "scaned_but_redirect" && result.redirect_host)
      login.origin = allowedOrigin("https://" + result.redirect_host);
    if (["expired", "verify_code_blocked", "binded_redirect"].includes(result.status))
      this.consume(id);
    if (result.status !== "confirmed") return { status: String(result.status) };
    if (!result.bot_token || !result.ilink_user_id || !result.ilink_bot_id)
      throw new KodoError("UNAVAILABLE", "微信未返回完整的账号授权。");
    return {
      status: "confirmed",
      controllerId: login.controllerId,
      credential: String(result.bot_token),
      owner: String(result.ilink_user_id),
      apiOrigin: allowedOrigin(result.baseurl || login.origin),
    };
  }
  consume(id: string) {
    this.logins.delete(id);
  }
  updates(base: string, token: string, cursor: string, signal: AbortSignal) {
    return withWeixinTransport(this.fetcher, async () => {
      const result = await getUpdates({
        baseUrl: allowedOrigin(base),
        token,
        get_updates_buf: cursor,
        abortSignal: signal,
      });
      if (result.ret || result.errcode) throw new Error("ClawBot poll rejected");
      return result;
    });
  }
  async send(
    base: string,
    token: string,
    to: string,
    context: string,
    text: string,
    requestId: string,
  ) {
    const result = await withWeixinTransport(this.fetcher, async () => {
      const receipt = await sendMessage({
        baseUrl: allowedOrigin(base),
        token,
        body: {
          msg: {
            from_user_id: "",
            to_user_id: to,
            client_id: requestId,
            message_type: 2,
            message_state: 2,
            context_token: context,
            item_list: [{ type: 1, text_item: { text } }],
          },
        },
      });
      if (receipt.errcode) throw new Error("ClawBot send rejected");
      return receipt;
    });
    return { messageId: result.message_id ?? requestId };
  }
}
