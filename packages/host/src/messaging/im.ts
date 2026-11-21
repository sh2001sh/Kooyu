import { z } from "zod";
import { KodoError } from "@kodo/protocol";
import { boundedJson } from "../applications/http.js";
import { digest } from "../execution/actions.js";
import type { ProviderVault } from "../providers/service.js";
import type { SessionService } from "../session-service.js";
import { openIMStream, type IMStream, type IncomingText, type StreamKind } from "./im-streams.js";
import { WeixinBot } from "./weixin.js";
import type { IntakeDisposition } from "../automations/intake.js";

const intakeModeSchema = z.enum(["observe", "propose", "auto"]);
export type IntakeMode = z.infer<typeof intakeModeSchema>;

const bindingSchema = z
  .object({
    connectionId: z.string().uuid(),
    controllerId: z.string().uuid(),
    ownerExternalUserId: z.string().min(1).max(256),
    chatId: z.string().min(1).max(256),
    appId: z.string().trim().min(1).max(256).optional(),
    intakeMode: intakeModeSchema.optional(),
    groupChat: z.boolean().optional(),
    triggerPrefix: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

type Binding = z.infer<typeof bindingSchema> & {
  generation: number;
  offset: number;
  weixinOrigin?: string;
  cursor?: string;
};

export class IMChannelService {
  private readonly polling = new Map<string, AbortController>();
  private readonly retryAfter = new Map<string, number>();
  private closed = false;
  private readonly streams = new Map<string, IMStream>();
  private readonly streamReaders = new Map<string, AbortController>();
  readonly weixin: WeixinBot;

  constructor(
    private readonly service: SessionService,
    private readonly vault: ProviderVault,
    private readonly fetcher: typeof fetch = fetch,
    private readonly openStream: typeof openIMStream = openIMStream,
  ) {
    this.weixin = new WeixinBot(fetcher);
    this.migrateLegacyBindings();
  }

  /** Migrate any legacy records("im-binding") rows into SCHEMA_V10's im_channels table seamlessly. */
  private migrateLegacyBindings() {
    try {
      const legacy = this.service.store.records<Binding>("im-binding");
      for (const b of legacy) {
        const exists = this.service.store.db
          .prepare("SELECT id FROM im_channels WHERE id=?")
          .get(b.connectionId);
        if (!exists) {
          const kind =
            this.service.applications.connections.find(b.connectionId)?.applicationId ?? "im";
          this.saveBinding(b, kind);
        }
      }
    } catch {}
  }

  private saveBinding(binding: Binding, kind: string) {
    this.service.store.db
      .prepare(
        `INSERT INTO im_channels(id, kind, status, data) VALUES (?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, status=excluded.status, data=excluded.data`,
      )
      .run(binding.connectionId, kind, "active", JSON.stringify(binding));
    // Mirror into records("im-binding") for backwards compatibility with any existing readers/tests.
    this.service.store.put("im-binding", binding.connectionId, binding);
  }

  private readBinding(id: string): Binding | undefined {
    const row = this.service.store.db.prepare("SELECT data FROM im_channels WHERE id=?").get(id) as
      { data: string } | undefined;
    if (row) return JSON.parse(row.data) as Binding;
    return this.service.store.record<Binding>("im-binding", id);
  }

  async finishWeixin(id: string, code?: string) {
    const result = await this.weixin.status(id, code);
    if (!result.credential || !result.controllerId || !result.owner || !result.apiOrigin)
      return { status: result.status };
    const c = await this.service.applications.connect({
      requestId: id,
      applicationId: "weixin",
      version: "1.0.0",
      name: "微信 ClawBot",
      token: result.credential,
    });
    if (!c) throw new KodoError("CONFLICT", "微信连接未保存。");
    this.saveBinding(
      {
        connectionId: c.id,
        controllerId: result.controllerId,
        ownerExternalUserId: result.owner,
        chatId: result.owner,
        generation: c.generation,
        offset: 0,
        weixinOrigin: result.apiOrigin,
        intakeMode: "propose",
      },
      "weixin",
    );
    this.weixin.consume(id);
    return { status: "confirmed", connectionId: c.id };
  }

  bindings(): Binding[] {
    const rows = this.service.store.db.prepare("SELECT data FROM im_channels").all() as Array<{
      data: string;
    }>;
    if (rows.length) return rows.map((r) => JSON.parse(r.data) as Binding);
    return this.service.store.records<Binding>("im-binding");
  }

  bind(value: unknown) {
    const input = bindingSchema.parse(value);
    const connection = this.service.applications.connections.get(input.connectionId);
    if (
      !connection.enabled ||
      !["telegram", "feishu", "wecom", "weixin"].includes(connection.applicationId) ||
      !connection.credentialRef
    )
      throw new KodoError("INVALID_INPUT", "请选择已启用的机器人连接。");
    if (connection.applicationId === "telegram") {
      if (!/^\d{1,18}$/.test(input.ownerExternalUserId) || !/^-?\d{1,18}$/.test(input.chatId))
        throw new KodoError("INVALID_INPUT", "Telegram 用户和会话 ID 需要使用数字。");
    } else if (connection.applicationId !== "weixin" && !input.appId)
      throw new KodoError("INVALID_INPUT", "请填写机器人的应用 ID。");
    if (this.service.store.session(input.controllerId).kind !== "supervisor")
      throw new KodoError("INVALID_INPUT", "请选择接收消息的主对话。");
    const current = this.readBinding(connection.id);
    const next: Binding = {
      ...input,
      intakeMode: input.intakeMode ?? current?.intakeMode ?? "propose",
      generation: connection.generation,
      offset: current?.generation === connection.generation ? current.offset : 0,
      ...(current?.weixinOrigin ? { weixinOrigin: current.weixinOrigin } : {}),
      ...(current?.cursor ? { cursor: current.cursor } : {}),
    };
    this.unbind(connection.id);
    this.saveBinding(next, connection.applicationId);
    return next;
  }

  unbind(id: string) {
    this.service.store.db.prepare("DELETE FROM im_channels WHERE id=?").run(id);
    this.service.store.remove("im-binding", id);
    this.service.store.remove("im-reply-context", id);
    this.polling.get(id)?.abort();
    this.streamReaders.get(id)?.abort();
    this.streamReaders.delete(id);
    this.streams.get(id)?.close();
    this.streams.delete(id);
    this.retryAfter.delete(id);
  }

  private classifyMessage(
    kind: string,
    binding: Binding,
    sender: string,
    chat: string,
    text: string,
  ): { disposition: IntakeDisposition; summary: string } {
    if (chat !== binding.chatId) return { disposition: "dropped", summary: "" };
    const isOwner = sender === binding.ownerExternalUserId;
    if (binding.groupChat) {
      const prefix = binding.triggerPrefix ?? "@Kooyu";
      const triggered = isOwner && text.trim().toLowerCase().includes(prefix.toLowerCase());
      if (!triggered) {
        return { disposition: "context-only", summary: `${sender}: ${text}` };
      }
      const recent = this.service.intake.recentContext(kind, binding.connectionId, 8);
      const contextBlock = recent.length
        ? `\n\n[近期群聊上下文]\n${recent.map((r) => r.summary).join("\n")}`
        : "";
      const mode = binding.intakeMode ?? "propose";
      const disposition: IntakeDisposition =
        mode === "observe" ? "observed" : mode === "auto" ? "dispatched" : "proposed";
      return { disposition, summary: text + contextBlock };
    }
    if (!isOwner) return { disposition: "dropped", summary: "" };
    const mode = binding.intakeMode ?? "propose";
    const disposition: IntakeDisposition =
      mode === "observe" ? "observed" : mode === "auto" ? "dispatched" : "proposed";
    return { disposition, summary: text };
  }

  async scan() {
    if (this.closed || this.service.lifecycle.status().frozen) return;
    await Promise.all(
      this.bindings().map(async (binding) => {
        const id = binding.connectionId;
        if (this.polling.has(id) || (this.retryAfter.get(id) ?? 0) > Date.now()) return;
        const c = this.service.applications.connections.find(id);
        if (!c?.enabled || c.generation !== binding.generation || !c.credentialRef) {
          this.unbind(id);
          return;
        }
        if (this.streams.has(id)) return;
        const controller = new AbortController();
        this.polling.set(id, controller);
        try {
          const token = await this.vault.get(c.credentialRef);
          if (controller.signal.aborted || this.closed) return;
          if (token && binding.weixinOrigin && c.applicationId === "weixin") {
            const batch = await this.weixin.updates(
              binding.weixinOrigin,
              token,
              binding.cursor ?? "",
              controller.signal,
            );
            const latest = this.service.applications.connections.find(id);
            if (
              controller.signal.aborted ||
              this.closed ||
              !latest?.enabled ||
              latest.generation !== binding.generation ||
              this.service.lifecycle.status().frozen
            )
              return;
            this.service.store.transaction(() => {
              for (const m of batch.msgs ?? []) {
                const text = m.item_list?.find((i: { type: number }) => i.type === 1)?.text_item
                  ?.text;
                if (
                  m.message_type !== 1 ||
                  typeof text !== "string" ||
                  !m.message_id ||
                  !m.from_user_id
                )
                  continue;
                const chat = m.group_id || m.from_user_id;
                this.receive("weixin", binding, {
                  id: String(m.message_id),
                  sender: m.from_user_id,
                  chat,
                  text,
                });
                if (
                  m.from_user_id === binding.ownerExternalUserId &&
                  chat === binding.chatId &&
                  typeof m.context_token === "string"
                )
                  this.service.store.put("im-reply-context", id, {
                    context: m.context_token,
                    generation: c.generation,
                  });
              }
              this.saveBinding(
                { ...binding, cursor: batch.get_updates_buf ?? binding.cursor },
                "weixin",
              );
            });
            return;
          }
          if (
            token &&
            binding.appId &&
            (c.applicationId === "wecom" || c.applicationId === "feishu")
          ) {
            const kind = c.applicationId;
            const stream = await this.openStream(kind, binding.appId, token, (message) => {
              const latest = this.service.applications.connections.find(id);
              if (
                !this.closed &&
                !controller.signal.aborted &&
                latest?.enabled &&
                latest.generation === binding.generation &&
                this.readBinding(id)?.appId === binding.appId &&
                !this.service.lifecycle.status().frozen
              )
                this.receive(kind, binding, message);
            });
            if (this.closed || controller.signal.aborted) stream.close();
            else {
              this.streams.set(id, stream);
              this.streamReaders.set(id, controller);
            }
            return;
          }
          if (!token || !/^\d+:[\w-]+$/.test(token)) throw new Error("无效的机器人令牌");
          const response = await this.fetcher(
            "https://api.telegram.org/bot" + token + "/getUpdates",
            {
              method: "POST",
              redirect: "error",
              headers: { "content-type": "application/json" },
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25000)]),
              body: JSON.stringify({
                offset: binding.offset,
                limit: 50,
                timeout: 15,
                allowed_updates: ["message"],
              }),
            },
          );
          const batch = await boundedJson(response);
          if (!response.ok || batch.ok !== true || !Array.isArray(batch.result))
            throw new Error("无法获取 Telegram 消息");
          const latest = this.service.applications.connections.get(id);
          if (
            controller.signal.aborted ||
            this.closed ||
            !latest.enabled ||
            latest.generation !== binding.generation ||
            this.service.lifecycle.status().frozen
          )
            return;
          for (const update of batch.result) {
            if (!Number.isSafeInteger(update.update_id) || update.update_id < binding.offset)
              continue;
            const message = update.message;
            const validText = message && !message.from?.is_bot && typeof message.text === "string";
            const classified = validText
              ? this.classifyMessage(
                  "telegram",
                  binding,
                  String(message.from?.id ?? ""),
                  String(message.chat?.id ?? ""),
                  message.text,
                )
              : { disposition: "dropped" as const, summary: "" };
            const next = { ...binding, offset: update.update_id + 1 };
            this.service.store.transaction(() => {
              this.service.intake.accept(
                {
                  sourceKind: "telegram",
                  sourceId: id,
                  externalId: String(update.update_id),
                  fingerprint: digest(update),
                  controllerId: binding.controllerId,
                  disposition: classified.disposition,
                  summary: classified.summary,
                  sender: validText ? String(message.from?.id ?? "") : undefined,
                  chat: validText ? String(message.chat?.id ?? "") : undefined,
                },
                () => {},
              );
              this.saveBinding(next, "telegram");
            });
            binding.offset = next.offset;
          }
        } catch {
          if (!controller.signal.aborted) this.retryAfter.set(id, Date.now() + 15000);
        } finally {
          this.polling.delete(id);
        }
      }),
    );
  }

  private receive(kind: StreamKind | "weixin", binding: Binding, m: IncomingText) {
    const classified = this.classifyMessage(kind, binding, m.sender, m.chat, m.text);
    this.service.intake.accept(
      {
        sourceKind: kind,
        sourceId: binding.connectionId,
        externalId: m.id,
        fingerprint: digest(m),
        controllerId: binding.controllerId,
        disposition: classified.disposition,
        summary: classified.summary,
        sender: m.sender,
        chat: m.chat,
      },
      () => {},
    );
  }

  send(id: string, chat: string, text: string, requestId: string, token: string) {
    const binding = this.readBinding(id);
    if (binding?.weixinOrigin) {
      const ctx = this.service.store.record<{ context: string; generation: number }>(
        "im-reply-context",
        id,
      );
      if (!ctx || ctx.generation !== binding.generation)
        throw new KodoError("CONFLICT", "请先从绑定微信会话发送一条消息。");
      return this.weixin.send(binding.weixinOrigin, token, chat, ctx.context, text, requestId);
    }
    const stream = this.streams.get(id);
    if (!stream) throw new KodoError("UNAVAILABLE", "机器人长连接尚未就绪。");
    return stream.send(chat, text, requestId);
  }

  close() {
    this.closed = true;
    for (const controller of this.polling.values()) controller.abort();
    for (const controller of this.streamReaders.values()) controller.abort();
    this.streamReaders.clear();
    for (const stream of this.streams.values()) stream.close();
    this.streams.clear();
  }
}
