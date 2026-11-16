import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { KodoError } from "@kodo/protocol";
import type { SessionService } from "../session-service.js";
import type { ProviderVault } from "../providers/service.js";
import { DomainTable } from "../storage/self-hosted.js";
import { digest } from "../execution/actions.js";
interface HookConnection {
  id: string;
  automationId: string;
  name: string;
  secretRef: string;
  repositories: string[];
  actors: string[];
  events: string[];
  mode: "off" | "observe" | "auto";
  revision: number;
  generation: number;
}
interface HookEvent {
  id: string;
  connectionId: string;
  externalEventId: string;
  digest: string;
  receivedAt: string;
  payload: unknown;
  actor: string;
  resource: string;
  generation: number;
  status: "pending" | "observed" | "activated" | "cancelled";
  activationId?: string;
  primaryGoalId?: string | null;
}
const schema = z
  .object({
    requestId: z.string().uuid(),
    name: z.string().min(1).max(100),
    automationId: z.string().uuid(),
    secret: z.string().min(24).max(1000).optional(),
    repositories: z
      .array(z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/))
      .min(1)
      .max(100),
    actors: z.array(z.string().min(1).max(100)).min(1).max(100),
    events: z
      .array(
        z.enum([
          "issues",
          "issue_comment",
          "pull_request",
          "pull_request_review",
          "push",
          "workflow_run",
        ]),
      )
      .min(1),
    mode: z.enum(["off", "observe", "auto"]).default("observe"),
    expectedRevision: z.number().int().positive().optional(),
  })
  .strict();
export class WebhookService {
  readonly connections: DomainTable<HookConnection>;
  readonly events: DomainTable<HookEvent>;
  private readonly rates = new Map<string, { start: number; count: number }>();
  private scanning = false;
  constructor(
    private readonly service: SessionService,
    private readonly vault: ProviderVault,
  ) {
    this.connections = new DomainTable(service.store, "webhook_connections");
    this.events = new DomainTable(service.store, "webhook_events");
  }
  list() {
    return this.connections.all().map(({ secretRef: _s, ...rest }) => rest);
  }
  async save(value: unknown, id?: string) {
    const p = schema.parse(value),
      fingerprint = digest({ p, id }),
      store = this.service.store;
    const prior = store.record<{ fingerprint: string; id: string }>("hook-request", p.requestId);
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        throw new KodoError("CONFLICT", "Webhook 请求 ID 冲突。");
      return this.list().find((x) => x.id === prior.id);
    }
    const old = id ? this.connections.get(id) : undefined;
    if (old && old.revision !== p.expectedRevision) throw new KodoError("CONFLICT", "连接已修改。");
    const a = this.service.automations.definitions.get(p.automationId);
    if (a.trigger.kind !== "webhook") throw new KodoError("INVALID_INPUT", "请选择 Webhook 计划。");
    if (!old && !p.secret) throw new KodoError("INVALID_INPUT", "需要 Webhook 密钥。");
    const key = old?.id ?? randomUUID(),
      secretRef = p.secret ? "webhook:" + key + ":" + randomUUID() : old!.secretRef;
    if (p.secret) await this.vault.set(secretRef, p.secret);
    return store.transaction(() => {
      if (old && this.connections.get(old.id).revision !== old.revision)
        throw new KodoError("CONFLICT", "连接已修改。");
      const c: HookConnection = {
        id: key,
        name: p.name,
        automationId: p.automationId,
        secretRef,
        repositories: p.repositories,
        actors: p.actors,
        events: p.events,
        mode: p.mode,
        revision: (old?.revision ?? 0) + 1,
        generation: (old?.generation ?? 0) + 1,
      };
      this.connections.put(c);
      for (const e of this.events.all())
        if (e.connectionId === key && e.status === "pending")
          this.events.put({ ...e, status: "cancelled" });
      store.put("hook-request", p.requestId, { fingerprint, id: key });
      return this.list().find((x) => x.id === key);
    });
  }
  async handle(request: IncomingMessage, response: ServerResponse, connectionId: string) {
    const reply = (status: number, value: unknown) => {
      response.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify(value));
    };
    if (request.method !== "POST") {
      reply(405, { error: "POST required" });
      return;
    }
    const c = this.connections.find(connectionId);
    if (!c || c.mode === "off") {
      reply(404, { error: "Unknown connection" });
      return;
    }
    const rateKey = connectionId + ":" + (request.socket.remoteAddress ?? "unknown"),
      now = Date.now();
    const rate = this.rates.get(rateKey);
    if (rate && now - rate.start < 60000) {
      if (++rate.count > 60) {
        response.setHeader("Retry-After", "60");
        reply(429, { error: "Rate limited" });
        return;
      }
    } else this.rates.set(rateKey, { start: now, count: 1 });
    if (this.rates.size > 10000)
      for (const [key, r] of this.rates) if (now - r.start > 60000) this.rates.delete(key);
    const delivery = request.headers["x-github-delivery"],
      event = request.headers["x-github-event"],
      signature = request.headers["x-hub-signature-256"];
    if (
      typeof delivery !== "string" ||
      delivery.length > 200 ||
      typeof event !== "string" ||
      typeof signature !== "string" ||
      !/^sha256=[a-f0-9]{64}$/.test(signature)
    ) {
      reply(401, { error: "Invalid signature headers" });
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      size += (chunk as Buffer).length;
      if (size > 1024 * 1024) {
        reply(413, { error: "Body too large" });
        return;
      }
      chunks.push(chunk as Buffer);
    }
    const body = Buffer.concat(chunks),
      secret = await this.vault.get(c.secretRef);
    if (!secret) {
      reply(503, { error: "Webhook credential unavailable" });
      return;
    }
    const expected = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      reply(401, { error: "Invalid signature" });
      return;
    }
    if (this.connections.get(c.id).generation !== c.generation) {
      reply(409, { error: "Connection changed" });
      return;
    }
    let payload: Record<string, any>;
    try {
      payload = JSON.parse(body.toString("utf8"));
      if (!payload || Array.isArray(payload) || typeof payload !== "object") throw new Error();
    } catch {
      reply(400, { error: "Invalid JSON object" });
      return;
    }
    const hash = digest(body.toString("base64"));
    const previous = this.events
      .all()
      .find((x) => x.connectionId === c.id && x.externalEventId === delivery);
    if (previous) {
      reply(
        previous.digest === hash ? 202 : 409,
        previous.digest === hash
          ? { id: previous.id, status: previous.status }
          : { error: "Delivery ID reused with a different body" },
      );
      return;
    }
    if (this.events.all().filter((x) => x.status === "pending").length >= 1000) {
      response.setHeader("Retry-After", "30");
      reply(503, { error: "Event queue full" });
      return;
    }
    const resource = String(payload.repository?.full_name ?? ""),
      actor = String(payload.sender?.login ?? "");
    const allowed =
      c.repositories.includes(resource) &&
      c.actors.includes(actor) &&
      c.events.includes(event) &&
      payload.sender?.type !== "Bot";
    const stored: HookEvent = {
      id: randomUUID(),
      connectionId: c.id,
      externalEventId: delivery,
      digest: hash,
      receivedAt: new Date().toISOString(),
      payload: { source: "github", event, actor, resource, body: payload },
      actor,
      resource,
      generation: c.generation,
      status: c.mode === "auto" && allowed ? "pending" : "observed",
    };
    this.service.store.transaction(() => this.events.put(stored));
    reply(202, { id: stored.id, status: stored.status });
  }
  assertGeneration(id: string, generation: number) {
    const c = this.connections.get(id);
    if (c.mode !== "auto" || c.generation !== generation)
      throw new KodoError("UNAUTHORIZED", "Webhook 连接已撤销或修改。");
  }
  async scan() {
    if (this.scanning || this.service.lifecycle.status().frozen) return;
    this.scanning = true;
    try {
      for (const e of this.events.all().filter((x) => x.status === "pending")) {
        const c = this.connections.get(e.connectionId);
        if (c.generation !== e.generation || c.mode !== "auto") {
          this.events.put({ ...e, status: "cancelled" });
          continue;
        }
        try {
          const a = await this.service.automations.activate(
            c.automationId,
            "hook:" + e.id,
            e.receivedAt,
            e.payload,
            new Date(),
            { connectionId: c.id, generation: e.generation },
          );
          if (this.connections.get(c.id).generation !== e.generation) {
            this.events.put({ ...e, status: "cancelled" });
            continue;
          }
          this.events.put({
            ...e,
            status: "activated",
            activationId: a.id,
            primaryGoalId: a.goalId,
          });
        } catch {
          /* Deferred, retained for the next bounded scan. */
        }
      }
    } finally {
      this.scanning = false;
    }
  }
}
