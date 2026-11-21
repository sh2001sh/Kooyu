import assert from "node:assert/strict";
import test from "node:test";
import { WeixinBot } from "../src/messaging/weixin.js";

test("concurrent QR starts reserve capacity until the network request completes", async () => {
  let resume!: () => void;
  const gate = new Promise<void>((resolve) => {
    resume = resolve;
  });
  let requests = 0;
  const bot = new WeixinBot(async () => {
    requests++;
    await gate;
    return Response.json({ qrcode: "qr", qrcode_img_content: "image" });
  });
  const admitted = Array.from({ length: 8 }, () => bot.start("controller"));
  try {
    await assert.rejects(bot.start("controller"), /扫码/);
    assert.equal(requests, 8);
  } finally {
    resume();
  }
  const sessions = await Promise.all(admitted);
  bot.consume(sessions[0]!.id);
  await bot.start("controller");
  assert.equal(requests, 9);
});

test("retiring a QR while status is in flight discards the confirmation", async () => {
  let reply!: (response: Response) => void;
  const gate = new Promise<Response>((resolve) => {
    reply = resolve;
  });
  const bot = new WeixinBot(async (url) =>
    String(url).includes("get_bot_qrcode")
      ? Response.json({ qrcode: "qr", qrcode_img_content: "image" })
      : gate,
  );
  const { id } = await bot.start("controller");
  const polling = bot.status(id);
  bot.consume(id);
  reply(
    Response.json({
      status: "confirmed",
      bot_token: "fixture",
      ilink_bot_id: "bot",
      ilink_user_id: "owner",
    }),
  );
  assert.deepEqual(await polling, { status: "expired" });
});

test("iLink retains adjacent 64-bit message IDs in updates and send receipts", async () => {
  const bot = new WeixinBot(async (url, init) => {
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture");
    if (String(url).endsWith("/getupdates"))
      return new Response(
        '{"msgs":[{"message_id":9223372036854775806},{"message_id":9223372036854775807}]}',
      );
    assert.equal(JSON.parse(String(init?.body)).msg.context_token, "context");
    return new Response('{"message_id":9223372036854775807}');
  });
  const origin = "https://ilinkai.weixin.qq.com";
  const updates = await bot.updates(origin, "fixture", "", new AbortController().signal);
  assert.deepEqual(
    updates.msgs.map((m: { message_id: string }) => m.message_id),
    ["9223372036854775806", "9223372036854775807"],
  );
  assert.deepEqual(await bot.send(origin, "fixture", "chat", "context", "hello", "request"), {
    messageId: "9223372036854775807",
  });
});

test("iLink verification codes use the redirected service and blocked codes retire the QR", async () => {
  const replies = [
    { qrcode: "qr", qrcode_img_content: "image" },
    { status: "scaned_but_redirect", redirect_host: "login.weixin.qq.com" },
    { status: "need_verifycode" },
    { status: "verify_code_blocked" },
  ];
  const urls: URL[] = [];
  const bot = new WeixinBot(async (url) => {
    urls.push(new URL(String(url)));
    return Response.json(replies.shift());
  });
  const { id } = await bot.start("controller");
  await bot.status(id);
  assert.equal((await bot.status(id)).status, "need_verifycode");
  assert.equal((await bot.status(id, "012345")).status, "verify_code_blocked");
  assert.equal((await bot.status(id)).status, "expired");
  assert.equal(urls.length, 4);
  assert.equal(urls[3]?.hostname, "login.weixin.qq.com");
  assert.equal(urls[3]?.searchParams.get("verify_code"), "012345");
});
