import { randomUUID } from "node:crypto";
import { z } from "zod";
import { boundedJson } from "../applications/http.js";
import {
  KodoError,
  type NotificationChannel as PublicChannel,
  type NotificationDelivery,
  type NotificationItem,
} from "@kodo/protocol";
import type { Store } from "../storage/store.js";
import { DomainTable } from "../storage/self-hosted.js";
import type { NotificationService } from "./service.js";
import type { ProviderVault } from "../providers/service.js";
import type { LifecycleGate } from "../lifecycle/gate.js";
import { ApnsProvider, type ApnsTransport } from "./apns.js";
export interface NotificationChannel extends PublicChannel {
  credentialRef: string | null;
}
const schema = z
  .object({
    kind: z.enum(["bark", "client", "apns"]),
    enabled: z.boolean(),
    preview: z.boolean().default(false),
    endpoint: z.string().url().optional(),
    expectedProviderRevision: z.number().int().positive().optional(),
    topic: z.string().max(255).optional(),
    environment: z.enum(["sandbox", "production"]).optional(),
    deviceToken: z
      .string()
      .regex(/^(?:[A-Fa-f0-9]{2}){16,256}$/)
      .optional(),
    expectedRevision: z.number().int().min(0),
  })
  .strict();
export class NotificationDispatcher {
  readonly channels: DomainTable<NotificationChannel>;
  readonly deliveries: DomainTable<NotificationDelivery>;
  readonly apns: ApnsProvider;
  private sending = false;
  private active: Promise<void> | null = null;
  constructor(
    private readonly store: Store,
    private readonly feed: NotificationService,
    private readonly vault: ProviderVault,
    private readonly gate: LifecycleGate,
    private readonly fetcher: typeof fetch = fetch,
    apnsTransport?: ApnsTransport,
  ) {
    this.apns = new ApnsProvider(store, vault, apnsTransport);
    this.channels = new DomainTable(store, "notification_channels");
    this.deliveries = new DomainTable(store, "notification_deliveries");
    for (const d of this.deliveries.all())
      if (d.status === "sending") this.deliveries.put({ ...d, status: "pending" });
  }
  private validDevice(id: string) {
    if (id === "desktop") return true;
    const d = this.store.record<{ expiresAt: string }>("device-public", id);
    return Boolean(d && Date.parse(d.expiresAt) > Date.now());
  }
  list() {
    return this.channels.all().map(({ credentialRef: _r, ...c }) => c);
  }
  async configureApns(value: unknown) {
    return this.apns.configure(value, () => {
      for (const c of this.channels.all()) {
        if (c.kind !== "apns") continue;
        this.channels.put({
          ...c,
          enabled: false,
          revision: c.revision + 1,
          unavailableReason: "APNs 服务配置已变更，请在设备上重新注册",
        });
      }
      for (const d of this.deliveries.all())
        if (d.channel === "apns" && ["pending", "sending"].includes(d.status))
          this.deliveries.put({ ...d, status: "cancelled" });
    });
  }
  async configure(deviceId: string, value: unknown) {
    const p = schema.parse(value);
    if ((p.endpoint && p.kind !== "bark") || (p.deviceToken && p.kind !== "apns"))
      throw new KodoError("INVALID_INPUT", "通知凭据与通道类型不一致。");
    if (!this.validDevice(deviceId)) throw new KodoError("UNAUTHORIZED", "设备已撤销或过期。");
    const id = deviceId + ":" + p.kind,
      old = this.channels.find(id);
    if ((old?.revision ?? 0) !== p.expectedRevision)
      throw new KodoError("CONFLICT", "通知配置已修改。");
    const provider = this.apns.status();
    if (
      p.kind === "apns" &&
      p.enabled &&
      (p.expectedProviderRevision !== provider.revision ||
        !("topic" in provider) ||
        provider.topic !== p.topic ||
        provider.environment !== p.environment)
    )
      throw new KodoError("CONFLICT", "APNs 服务修订、应用或签名环境不一致，请重新读取配置。");
    if (p.kind === "apns" && (deviceId === "desktop" || (p.enabled && !provider.enabled)))
      throw new KodoError("INVALID_INPUT", "APNs 需要配对设备和已启用的 Host 推送服务。");
    let ref = old?.credentialRef ?? null;
    if (p.kind === "apns" && p.enabled && !p.deviceToken && !ref)
      throw new KodoError("INVALID_INPUT", "需要 APNs 设备令牌。");
    if (
      p.kind === "apns" &&
      p.enabled &&
      !p.deviceToken &&
      old?.providerRevision !== provider.revision
    )
      throw new KodoError("CONFLICT", "APNs 服务配置已变化，请使用设备令牌重新注册。");
    if (p.kind === "apns" && p.deviceToken) {
      if (
        p.enabled &&
        old?.enabled &&
        old.preview === p.preview &&
        old.providerRevision === provider.revision &&
        old.credentialRef &&
        (await this.vault.get(old.credentialRef)) === p.deviceToken.toLowerCase()
      ) {
        if (
          this.channels.find(id)?.revision !== old.revision ||
          this.apns.status().revision !== provider.revision ||
          !this.validDevice(deviceId)
        )
          throw new KodoError("CONFLICT", "通知配置已修改。");
        return this.list().find((c) => c.id === id);
      }
      ref = "notification:device:" + randomUUID();
      await this.vault.set(ref, p.deviceToken.toLowerCase());
    }
    if (p.kind === "bark" && p.endpoint) {
      const u = new URL(p.endpoint);
      if (
        u.origin !== "https://api.day.app" ||
        u.username ||
        u.password ||
        u.search ||
        u.hash ||
        !/^\/[A-Za-z0-9_-]{8,200}$/.test(u.pathname)
      )
        throw new KodoError("INVALID_INPUT", "仅支持 https://api.day.app/设备密钥 的 Bark 通道。");
      ref = "notification:" + randomUUID();
      await this.vault.set(ref, u.href);
    }
    if (p.kind === "bark" && p.enabled && !ref)
      throw new KodoError("INVALID_INPUT", "需要 Bark 设备地址。");
    if (
      (this.channels.find(id)?.revision ?? 0) !== p.expectedRevision ||
      !this.validDevice(deviceId) ||
      (p.kind === "apns" && this.apns.status().revision !== provider.revision)
    ) {
      if (ref && ref !== old?.credentialRef) await this.vault.delete(ref).catch(() => {});
      throw new KodoError("CONFLICT", "通知配置已修改。");
    }
    const next: NotificationChannel = {
      id,
      deviceId,
      kind: p.kind,
      enabled: p.enabled,
      preview: p.preview,
      credentialRef: ref,
      revision: (old?.revision ?? 0) + 1,
      providerRevision: p.kind === "apns" ? provider.revision : null,
      unavailableReason: null,
    };
    this.store.transaction(() => {
      this.channels.put(next);
      for (const d of this.deliveries.all())
        if (
          d.deviceId === deviceId &&
          d.channel === p.kind &&
          ["pending", "sending"].includes(d.status)
        )
          this.deliveries.put({ ...d, status: "cancelled" });
    });
    if (old?.credentialRef && old.credentialRef !== ref)
      await this.vault.delete(old.credentialRef).catch(() => {});
    return this.list().find((x) => x.id === id);
  }
  async removeChannel(id: string) {
    const channel = this.channels.find(id);
    if (!channel) return;
    if (!channel.enabled && !channel.credentialRef) return;
    this.store.transaction(() => {
      for (const d of this.deliveries.all())
        if (
          d.deviceId === channel.deviceId &&
          d.channel === channel.kind &&
          ["pending", "sending"].includes(d.status)
        )
          this.deliveries.put({ ...d, status: "cancelled" });
      this.channels.put({
        ...channel,
        enabled: false,
        credentialRef: null,
        revision: channel.revision + 1,
        unavailableReason: "推送令牌已撤销",
      });
    });
    if (channel.credentialRef) await this.vault.delete(channel.credentialRef).catch(() => {});
  }
  async revokeDevice(deviceId: string) {
    for (const channel of this.channels.all().filter((c) => c.deviceId === deviceId))
      await this.removeChannel(channel.id);
  }
  enqueue(item: NotificationItem) {
    for (const c of this.channels.all()) {
      if (!c.enabled || !this.validDevice(c.deviceId)) continue;
      const id = item.id + ":" + c.deviceId + ":" + c.kind;
      if (this.deliveries.find(id)) continue;
      this.deliveries.put({
        id,
        notificationId: item.id,
        deviceId: c.deviceId,
        channel: c.kind,
        channelRevision: c.revision,
        status: "pending",
        attempts: 0,
        dueAt: new Date(Date.parse(item.createdAt) + 5000).toISOString(),
        expiresAt: new Date(Date.parse(item.createdAt) + 86400000).toISOString(),
        lastError: null,
      });
    }
  }
  acknowledge(deviceId: string, notificationId: string, sessionId: string | null) {
    const item = this.feed.get(notificationId);
    if (item.sessionId !== sessionId) throw new KodoError("CONFLICT", "前台会话与通知不一致。");
    this.store.put("notification-ack", notificationId + ":" + deviceId, {
      at: Date.now(),
      sessionId,
    });
    for (const d of this.deliveries.all())
      if (d.notificationId === notificationId && d.deviceId === deviceId && d.status === "pending")
        this.deliveries.put({ ...d, status: "suppressed" });
  }
  clientPending(deviceId: string) {
    return this.deliveries
      .all()
      .filter(
        (d) =>
          d.deviceId === deviceId &&
          d.channel === "client" &&
          d.status === "pending" &&
          Date.parse(d.dueAt) <= Date.now() &&
          Date.parse(d.expiresAt) > Date.now() &&
          this.channels.find(deviceId + ":client")?.enabled === true &&
          this.validDevice(deviceId),
      );
  }
  clientAccepted(deviceId: string, id: string) {
    const d = this.deliveries.get(id);
    if (d.deviceId !== deviceId || d.channel !== "client" || !this.validDevice(deviceId))
      throw new KodoError("UNAUTHORIZED", "投递不属于该设备。");
    if (d.status === "pending")
      this.deliveries.put({ ...d, status: "accepted", attempts: d.attempts + 1 });
    return this.deliveries.get(id);
  }
  async scan(now = Date.now()) {
    if (this.active) return this.active;
    if (this.gate.status().frozen) return;
    const leave = this.gate.enter();
    this.active = this.scanInside(now).finally(() => {
      this.active = null;
      leave();
    });
    return this.active;
  }
  async drain() {
    await this.active;
  }
  private async scanInside(now: number) {
    if (this.sending) return;
    this.sending = true;
    try {
      // Recover enqueue wake loss using a persistent cursor (facts still own the truth).
      let cursor =
        this.store.record<{ value: number }>("notification-dispatch", "cursor")?.value ?? 0;
      const page = this.feed.list(cursor, 500);
      this.store.transaction(() => {
        for (const item of page.items) this.enqueue(item);
        cursor = page.cursor;
        this.store.put("notification-dispatch", "cursor", { value: cursor });
      });
      for (const d of this.deliveries
        .all()
        .filter((x) => x.status === "pending" && Date.parse(x.dueAt) <= now)) {
        const c = this.channels.find(d.deviceId + ":" + d.channel);
        if (!c?.enabled || c.revision !== d.channelRevision || !this.validDevice(d.deviceId)) {
          this.deliveries.put({ ...d, status: "cancelled" });
          continue;
        }
        if (Date.parse(d.expiresAt) <= now || d.attempts >= 6) {
          this.deliveries.put({ ...d, status: "failed", lastError: "投递已过期或达到重试上限" });
          continue;
        }
        const ack = this.store.record<{ at: number; sessionId: string | null }>(
          "notification-ack",
          d.notificationId + ":" + d.deviceId,
        );
        const item = this.feed.get(d.notificationId);
        if (ack && now - ack.at < 15000 && ack.sessionId === item.sessionId) {
          this.deliveries.put({ ...d, status: "suppressed" });
          continue;
        }
        if (c.kind === "client") continue;
        if (this.gate.status().frozen) break;
        const sending = { ...d, status: "sending" as const, attempts: d.attempts + 1 };
        this.deliveries.put(sending);
        try {
          const generation = this.gate.status().generation;
          const endpoint = await this.vault.get(c.credentialRef!);
          if (!endpoint) throw new Error("通知凭据不可用");
          const allowed = () => {
            const current = this.channels.find(c.id),
              gate = this.gate.status();
            return (
              !gate.frozen &&
              gate.generation === generation &&
              current?.enabled === true &&
              current.revision === c.revision &&
              this.validDevice(c.deviceId)
            );
          };
          if (!allowed()) {
            const latest = this.deliveries.get(d.id);
            if (latest.status === "sending") this.deliveries.put({ ...d, status: "pending" });
            continue;
          }
          if (c.kind === "apns") {
            const result = await this.apns.send(
              endpoint,
              c.providerRevision ?? 0,
              item,
              sending,
              c.preview,
              allowed,
            );
            if (this.deliveries.get(d.id).status !== "sending") continue;
            if (result.kind === "retry") throw new Error("APNs temporarily unavailable");
            if (result.kind === "cancelled") {
              this.deliveries.put({ ...sending, status: allowed() ? "cancelled" : "pending" });
            } else if (result.kind === "accepted") {
              this.deliveries.put({ ...sending, status: "accepted", lastError: null });
            } else {
              this.store.transaction(() => {
                this.deliveries.put({ ...sending, status: "failed", lastError: result.error });
                const current = this.channels.find(c.id);
                if (result.kind !== "invalid-device" || current?.revision !== c.revision) return;
                this.channels.put({
                  ...current,
                  enabled: false,
                  revision: current.revision + 1,
                  unavailableReason: result.error,
                });
                for (const other of this.deliveries.all())
                  if (
                    other.id !== d.id &&
                    other.deviceId === c.deviceId &&
                    other.channel === "apns" &&
                    other.status === "pending"
                  )
                    this.deliveries.put({ ...other, status: "cancelled" });
              });
            }
            continue;
          }
          const response = await this.fetcher(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            redirect: "error",
            signal: AbortSignal.timeout(15000),
            body: JSON.stringify({
              title: item.title,
              body: c.preview ? (item.preview ?? "Kooyu 有新事项") : "请打开 Kooyu 查看",
              group: "Kooyu",
              deduplication_key: item.id,
              ...(process.env.KODO_PUBLIC_ORIGIN?.startsWith("https://")
                ? {
                    url:
                      process.env.KODO_PUBLIC_ORIGIN.replace(/\/$/, "") +
                      "/?hostId=" +
                      encodeURIComponent(item.link.hostId) +
                      "&notificationId=" +
                      encodeURIComponent(item.id),
                  }
                : {}),
            }),
          });
          if (!response.ok) throw new Error("推送服务返回 HTTP " + response.status);
          const body = (await boundedJson(response, 65536)) as { code?: number };
          if (body.code !== 200) throw new Error("推送服务未接受通知");
          const latest = this.deliveries.get(d.id);
          if (latest.status === "sending")
            this.deliveries.put({ ...sending, status: "accepted", lastError: null });
        } catch {
          const latest = this.deliveries.get(d.id);
          if (latest.status === "sending")
            this.deliveries.put({
              ...sending,
              status: "pending",
              dueAt: new Date(
                now +
                  Math.min(3600000, 10000 * 2 ** sending.attempts) * (0.8 + Math.random() * 0.4),
              ).toISOString(),
              lastError: "投递失败，将有限重试（内容未写入日志）",
            });
        }
      }
    } finally {
      this.sending = false;
    }
  }
}
