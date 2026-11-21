export type StreamKind = "feishu" | "wecom";
export interface IncomingText {
  id: string;
  sender: string;
  chat: string;
  text: string;
}
export interface IMStream {
  close(): void;
  send(chat: string, text: string, requestId: string): Promise<unknown>;
}

export async function openIMStream(
  kind: StreamKind,
  appId: string,
  secret: string,
  receive: (message: IncomingText) => void,
): Promise<IMStream> {
  if (kind === "wecom") {
    const { WSClient } = await import("@wecom/aibot-node-sdk");
    const client = new WSClient({ botId: appId, secret });
    client.on("message.text", ({ body }) => {
      if (body?.msgid && body.from?.userid && body.text?.content)
        receive({
          id: body.msgid,
          sender: body.from.userid,
          chat: body.chatid ?? body.from.userid,
          text: body.text.content,
        });
    });
    client.on("error", () => {});
    client.connect();
    return {
      close: () => client.disconnect(),
      async send(chat, text) {
        const receipt = await client.sendMessage(chat, {
          msgtype: "markdown",
          markdown: { content: text },
        });
        if (receipt.errcode) throw new Error("企业微信未确认发送。");
        return { requestId: receipt.headers.req_id };
      },
    };
  }
  const lark = await import("@larksuiteoapi/node-sdk");
  const settings = { appId, appSecret: secret, loggerLevel: lark.LoggerLevel.error };
  const client = new lark.Client(settings);
  const ws = new lark.WSClient(settings);
  const dispatcher = new lark.EventDispatcher({}).register({
    "im.message.receive_v1": async ({ message, sender }) => {
      if (
        message.message_type !== "text" ||
        sender.sender_type !== "user" ||
        !sender.sender_id?.open_id
      )
        return;
      const text = JSON.parse(message.content).text;
      if (typeof text === "string")
        receive({
          id: message.message_id,
          sender: sender.sender_id.open_id,
          chat: message.chat_id,
          text,
        });
    },
  });
  await ws.start({ eventDispatcher: dispatcher });
  return {
    close: () => ws.close({ force: true }),
    async send(chat, text, requestId) {
      const receipt = await client.im.message.create({
        params: { receive_id_type: "chat_id" },
        data: {
          receive_id: chat,
          msg_type: "text",
          content: JSON.stringify({ text }),
          uuid: requestId,
        },
      });
      if (receipt.code || !receipt.data?.message_id) throw new Error("飞书未确认发送。");
      return { messageId: receipt.data.message_id };
    },
  };
}
