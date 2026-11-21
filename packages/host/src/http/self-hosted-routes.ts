import { clientCapabilities, requireOperation } from "../clients/access.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { KodoError, type HarnessId } from "@kodo/protocol";
import type { SessionService } from "../session-service.js";
import { recommendHarness } from "../delegation/routing.js";
import type { RouteContext } from "./work-routes.js";
export async function handleSelfHostedRoutes(
  service: SessionService,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  ctx: RouteContext & { deviceId: string },
): Promise<boolean> {
  const path = url.pathname,
    method = request.method ?? "GET",
    { json, readBody } = ctx;
  const local = () => {
    if (!ctx.local) throw new KodoError("UNAUTHORIZED", "此管理操作仅允许 Host 本机管理员执行。");
  };
  const body = () => readBody(request);
  if (path === "/api/im/weixin/qr" && method === "POST") {
    local();
    const input = z
      .object({ controllerId: z.string().uuid() })
      .strict()
      .parse(await body());
    if (service.store.session(input.controllerId).kind !== "supervisor")
      throw new KodoError("INVALID_INPUT", "请选择主对话。");
    json(response, 201, await service.im.weixin.start(input.controllerId));
    return true;
  }
  if (path === "/api/im/weixin/status" && method === "POST") {
    local();
    const input = z
      .object({ id: z.string().uuid(), code: z.string().max(32).optional() })
      .strict()
      .parse(await body());
    json(response, 200, await service.im.finishWeixin(input.id, input.code));
    return true;
  }
  if (path === "/api/intake/events" && method === "GET") {
    json(response, 200, service.intake.list(Number(url.searchParams.get("limit") ?? 50)));
    return true;
  }
  const intakeApprove = /^\/api\/intake\/([a-f0-9-]+)\/approve$/.exec(path);
  if (intakeApprove && method === "POST") {
    const p = request.headers["content-type"]?.startsWith("application/json") ? await body() : {};
    const text = z.string().max(16000).optional().parse(p.text);
    json(response, 200, service.intake.approve(intakeApprove[1]!, text));
    return true;
  }
  if (path === "/api/im/bindings" && (method === "GET" || method === "POST")) {
    local();
    json(response, 200, method === "GET" ? service.im.bindings() : service.im.bind(await body()));
    return true;
  }
  const binding = /^\/api\/im\/bindings\/([a-f0-9-]+)$/.exec(path);
  if (binding && method === "DELETE") {
    local();
    service.im.unbind(binding[1]!);
    json(response, 200, { removed: true });
    return true;
  }
  const revision = (p: Record<string, unknown>) =>
    z.number().int().positive().parse(p.expectedRevision);
  if (path === "/api/work/status" && method === "GET") {
    const h = service.health();
    json(response, 200, {
      ...h,
      processIdentity: ctx.local ? h.processIdentity : undefined,
      pid: ctx.local ? h.pid : undefined,
      localAdministrator: ctx.local,
    });
    return true;
  }
  if (path === "/api/capabilities" && method === "GET") {
    json(response, 200, clientCapabilities(service, ctx));
    return true;
  }
  if (path === "/internal/quiesce" || path === "/internal/resume" || path === "/internal/health") {
    local();
    if (path.endsWith("quiesce") && method === "POST") service.lifecycle.quiesce();
    else if (path.endsWith("resume") && method === "POST") {
      const p = await body();
      service.lifecycle.resume(
        z.string().parse(p.processIdentity),
        z.number().int().parse(p.generation),
      );
      service.resumeWork();
    } else if (method !== "GET") throw new KodoError("INVALID_INPUT", "不支持此运维操作。");
    json(response, 200, service.health());
    return true;
  }
  if (path === "/api/grants") {
    if (method === "GET") {
      json(response, 200, service.permissions.grants.all());
      return true;
    }
    if (method === "POST") {
      local();
      json(response, 201, service.permissions.create(await body()));
      return true;
    }
  }
  let m = /^\/api\/grants\/([^/]+)\/revoke$/.exec(path);
  if (m && method === "POST") {
    local();
    const p = await body();
    json(response, 200, service.permissions.revoke(m[1]!, revision(p)));
    return true;
  }
  if (path === "/api/automations/authorize" && method === "POST") {
    local();
    const p = await body();
    json(
      response,
      201,
      service.automations.authorize(
        z.string().uuid().parse(p.controllerSessionId),
        z.string().uuid().parse(p.requestId),
      ),
    );
    return true;
  }
  if (path === "/api/automations") {
    if (method === "GET") {
      json(response, 200, service.automations.definitions.all());
      return true;
    }
    if (method === "POST") {
      json(response, 201, service.automations.save(await body()));
      return true;
    }
  }
  if (path === "/api/automations/preview" && method === "POST") {
    json(response, 200, service.automations.preview(await body()));
    return true;
  }
  m = /^\/api\/automations\/([^/]+)(?:\/(pause|run|stop|activations))?$/.exec(path);
  if (m) {
    const id = m[1]!,
      action = m[2];
    if (method === "GET") {
      json(
        response,
        200,
        action === "activations"
          ? service.automations.activations.all().filter((x) => x.automationId === id)
          : service.automations.definitions.get(id),
      );
      return true;
    }
    if (method === "PATCH" && !action) {
      json(response, 200, service.automations.save(await body(), id));
      return true;
    }
    if (method === "POST") {
      const p = await body();
      if (action === "pause" || action === "stop") {
        const a = service.automations.pause(id, revision(p));
        json(
          response,
          200,
          action === "stop"
            ? {
                automation: a,
                stop: await service.stop(
                  a.controllerSessionId,
                  true,
                  z.string().uuid().parse(p.requestId),
                ),
              }
            : a,
        );
        return true;
      }
      if (action === "run") {
        requireOperation(service, ctx, "automations.run");
        json(
          response,
          201,
          await service.automations.run(id, z.string().uuid().parse(p.requestId)),
        );
        return true;
      }
    }
  }
  if (path === "/api/webhooks") {
    local();
    if (method === "GET") {
      json(response, 200, {
        connections: service.webhooks.list(),
        events: service.webhooks.events.all().map(({ payload: _p, ...e }) => e),
      });
      return true;
    }
    if (method === "POST") {
      json(response, 201, await service.webhooks.save(await body()));
      return true;
    }
  }
  m = /^\/api\/webhooks\/([^/]+)$/.exec(path);
  if (m && method === "PATCH") {
    local();
    json(response, 200, await service.webhooks.save(await body(), m[1]));
    return true;
  }
  if (path === "/api/memory/settings") {
    requireOperation(service, ctx, method === "GET" ? "memory.read" : "memory.write");
    if (method === "GET") json(response, 200, service.memory.settings());
    else if (method === "PATCH") json(response, 200, service.memory.saveSettings(await body()));
    else throw new KodoError("INVALID_INPUT", "不支持的全局记忆配置操作。");
    return true;
  }
  if (path === "/api/memory/docs" && method === "GET") {
    requireOperation(service, ctx, "memory.read");
    json(response, 200, service.memory.docs?.list() ?? []);
    return true;
  }
  m =
    /^\/api\/memory\/docs\/(SOUL\.md|USER\.md|MEMORY\.md|RULES\.md|HEARTBEAT\.md|AGENTS\.md|ROUTING\.md)(?:\/(reset))?$/.exec(
      path,
    );
  if (m) {
    const docName = m[1]!;
    const subAction = m[2];
    if (!service.memory.docs) throw new KodoError("UNAVAILABLE", "本地人格与记忆文档目录不可用。");
    if (method === "GET" && !subAction) {
      requireOperation(service, ctx, "memory.read");
      json(response, 200, service.memory.docs.get(docName));
      return true;
    }
    if ((method === "PUT" || method === "PATCH") && !subAction) {
      requireOperation(service, ctx, "memory.write");
      json(response, 200, service.memory.docs.save(docName, await body()));
      return true;
    }
    if (method === "POST" && subAction === "reset") {
      requireOperation(service, ctx, "memory.write");
      const p = await body();
      json(
        response,
        200,
        service.memory.docs.reset(
          docName,
          z.string().uuid().parse(p.requestId),
          service.memory.list(null, false),
        ),
      );
      return true;
    }
  }
  if (path === "/api/heartbeat" && method === "GET") {
    requireOperation(service, ctx, "memory.read");
    json(response, 200, service.heartbeat.status());
    return true;
  }
  if (path === "/api/heartbeat/run" && method === "POST") {
    requireOperation(service, ctx, "memory.write");
    json(response, 200, await service.heartbeat.scan());
    return true;
  }
  if (path === "/api/memory/proposals" && method === "GET") {
    requireOperation(service, ctx, "memory.read");
    const status = url.searchParams.get("status") as "pending" | "approved" | "dismissed" | null;
    json(response, 200, service.consolidation.list(status ?? undefined));
    return true;
  }
  if (path === "/api/memory/proposals/generate" && method === "POST") {
    requireOperation(service, ctx, "memory.write");
    json(response, 200, service.consolidation.generateProposals());
    return true;
  }
  m = /^\/api\/memory\/proposals\/([^/]+)\/(approve|dismiss)$/.exec(path);
  if (m && method === "POST") {
    requireOperation(service, ctx, "memory.write");
    if (m[2] === "approve") {
      const p = await body();
      const reqId = typeof p.requestId === "string" ? p.requestId : undefined;
      json(response, 200, service.consolidation.approve(m[1]!, reqId));
    } else {
      json(response, 200, service.consolidation.dismiss(m[1]!));
    }
    return true;
  }
  if (path === "/api/skills/curated") {
    if (method === "GET") {
      requireOperation(service, ctx, "memory.read");
      json(response, 200, service.curatedSkills.list());
      return true;
    }
    if (method === "POST") {
      requireOperation(service, ctx, "memory.write");
      json(response, 201, service.curatedSkills.sediment(await body()));
      return true;
    }
  }
  m = /^\/api\/skills\/curated\/([a-z0-9][a-z0-9-]{1,47})(?:\/(rollback))?$/.exec(path);
  if (m) {
    const skillName = m[1]!;
    if (method === "GET" && !m[2]) {
      requireOperation(service, ctx, "memory.read");
      json(response, 200, service.curatedSkills.read(skillName));
      return true;
    }
    if (method === "POST" && m[2] === "rollback") {
      requireOperation(service, ctx, "memory.write");
      const p = await body();
      const targetVersion = typeof p.targetVersion === "number" ? p.targetVersion : undefined;
      json(response, 200, service.curatedSkills.rollback(skillName, targetVersion));
      return true;
    }
    if (method === "DELETE" && !m[2]) {
      requireOperation(service, ctx, "memory.write");
      json(response, 200, service.curatedSkills.archive(skillName));
      return true;
    }
  }
  if (path === "/api/knowledge/mounts") {
    if (method === "GET") {
      requireOperation(service, ctx, "memory.read");
      json(response, 200, service.knowledge.listMounts());
      return true;
    }
    if (method === "POST") {
      local();
      json(response, 201, service.knowledge.addMount(await body()));
      return true;
    }
  }
  m = /^\/api\/knowledge\/mounts\/([^/]+)$/.exec(path);
  if (m && method === "DELETE") {
    local();
    json(response, 200, service.knowledge.removeMount(m[1]!));
    return true;
  }
  if (path === "/api/knowledge/search" && method === "GET") {
    requireOperation(service, ctx, "memory.read");
    const q = url.searchParams.get("q") ?? "";
    const mountId = url.searchParams.get("mountId") ?? undefined;
    const limit = Number(url.searchParams.get("limit") ?? 15);
    json(response, 200, service.knowledge.search(q, { mountId, limit }));
    return true;
  }
  if (path === "/api/pages" && method === "GET") {
    requireOperation(service, ctx, "memory.read");
    json(response, 200, service.pages.list(url.searchParams.get("sessionId")));
    return true;
  }
  m = /^\/api\/pages\/([^/]+)$/.exec(path);
  if (m && method === "GET") {
    const { html } = service.pages.readHtml(m[1]!);
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; frame-ancestors 'self';",
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    });
    response.end(html);
    return true;
  }
  if (path === "/api/checkpoints") {
    if (method === "GET") {
      requireOperation(service, ctx, "memory.read");
      json(
        response,
        200,
        service.checkpoints.list({
          workspaceId: url.searchParams.get("workspaceId") ?? undefined,
          sessionId: url.searchParams.get("sessionId") ?? undefined,
        }),
      );
      return true;
    }
    if (method === "POST") {
      local();
      const p = z
        .object({
          workspaceRoot: z.string().min(1),
          workspaceId: z.string().nullable().optional(),
          sessionId: z.string().nullable().optional(),
          label: z.string().min(1).max(160),
        })
        .strict()
        .parse(await body());
      json(response, 201, await service.checkpoints.capture(p));
      return true;
    }
  }
  m = /^\/api\/checkpoints\/([^/]+)\/restore$/.exec(path);
  if (m && method === "POST") {
    local();
    json(response, 200, await service.checkpoints.restore(m[1]!));
    return true;
  }
  if (path === "/api/arena" && method === "GET") {
    requireOperation(service, ctx, "memory.read");
    json(response, 200, service.arena.list(url.searchParams.get("sessionId") ?? undefined));
    return true;
  }
  m = /^\/api\/arena\/([^/]+)\/(compare|accept)$/.exec(path);
  if (m && method === "POST") {
    requireOperation(service, ctx, "memory.write");
    const p = await body();
    if (m[2] === "compare") {
      json(
        response,
        200,
        await service.arena.compare(
          m[1]!,
          typeof p.checkCommand === "string" ? p.checkCommand : undefined,
        ),
      );
    } else {
      json(
        response,
        200,
        service.arena.acceptWinner(m[1]!, z.string().min(1).parse(p.winnerTicketId)),
      );
    }
    return true;
  }
  if (path === "/api/routing/recommend" && method === "GET") {
    requireOperation(service, ctx, "memory.read");
    const taskText = url.searchParams.get("task") ?? undefined;
    const tags = url.searchParams.get("tags")?.split(",").filter(Boolean);
    const exclude = url.searchParams.get("exclude")?.split(",").filter(Boolean) as
      HarnessId[] | undefined;
    json(response, 200, recommendHarness(service, { taskText, tags, exclude }));
    return true;
  }
  if (path === "/api/memory") {
    if (method === "GET") {
      json(response, 200, service.memory.list(url.searchParams.get("projectId"), true));
      return true;
    }
    if (method === "POST") {
      json(response, 201, service.memory.save(await body(), "user"));
      return true;
    }
  }
  m = /^\/api\/memory\/([^/]+)(\/history)?$/.exec(path);
  if (m) {
    if (method === "GET" && m[2]) {
      json(response, 200, service.memory.history(m[1]!));
      return true;
    }
    if (method === "PATCH") {
      json(response, 200, service.memory.save(await body(), "user", undefined, m[1]));
      return true;
    }
  }
  if (path === "/api/applications") {
    if (method === "GET") {
      json(response, 200, service.applications.list());
      return true;
    }
    if (method === "POST") {
      local();
      json(response, 201, service.applications.submit(await body()));
      return true;
    }
  }
  if (path === "/api/applications/export" && method === "GET") {
    json(response, 200, service.applications.export(z.string().parse(url.searchParams.get("id"))));
    return true;
  }
  if (path === "/api/applications/permissions-diff" && method === "GET") {
    json(
      response,
      200,
      service.applications.permissionsDiff(
        z.string().parse(url.searchParams.get("applicationId")),
        z.string().parse(url.searchParams.get("from")),
        z.string().parse(url.searchParams.get("to")),
      ),
    );
    return true;
  }
  if (path === "/api/applications/connections" && method === "POST") {
    local();
    json(response, 201, await service.applications.connect(await body()));
    return true;
  }
  m = /^\/api\/applications\/connections\/([^/]+)(?:\/(revoke|tools))?$/.exec(path);
  if (m) {
    if (method === "PATCH") {
      local();
      json(response, 200, await service.applications.connect(await body(), m[1]));
      return true;
    }
    if (method === "POST" && m[2] === "revoke") {
      local();
      const p = await body();
      json(response, 200, service.applications.revoke(m[1]!, revision(p)));
      return true;
    }
    if (method === "GET" && m[2] === "tools") {
      local();
      json(response, 200, await service.applications.tools(m[1]!));
      return true;
    }
  }
  if (path === "/api/oauth/github/configuration") {
    local();
    if (method === "GET") json(response, 200, service.oauth.github.configuration());
    else if (method === "POST") json(response, 200, service.oauth.github.configure(await body()));
    else throw new KodoError("INVALID_INPUT", "不支持的 GitHub 配置操作。");
    return true;
  }
  if (path === "/api/oauth/github/start" && method === "POST") {
    local();
    json(response, 201, await service.oauth.github.start(await body(), ctx.deviceId));
    return true;
  }
  const githubLogin = /^\/api\/oauth\/github\/([a-f0-9-]+)\/(poll|cancel)$/.exec(path);
  if (githubLogin && method === "POST") {
    local();
    const id = z.string().uuid().parse(githubLogin[1]);
    json(
      response,
      200,
      githubLogin[2] === "poll"
        ? await service.oauth.github.poll(id, ctx.deviceId)
        : await service.oauth.github.cancel(id, ctx.deviceId),
    );
    return true;
  }
  if (path === "/api/oauth/configure" && method === "POST") {
    local();
    json(response, 200, await service.oauth.configure(await body()));
    return true;
  }
  if (path === "/api/oauth/start" && method === "POST") {
    const p = await body();
    json(
      response,
      200,
      await service.oauth.start(z.string().uuid().parse(p.connectionId), ctx.deviceId),
    );
    return true;
  }
  if (path === "/api/oauth/callback" && method === "GET") {
    json(
      response,
      200,
      await service.oauth.callback(
        z.string().min(20).max(200).parse(url.searchParams.get("state")),
        z.string().min(1).max(4000).parse(url.searchParams.get("code")),
        ctx.deviceId,
      ),
    );
    return true;
  }
  if (path === "/api/oauth/refresh" && method === "POST") {
    local();
    const p = await body();
    await service.oauth.refresh(z.string().uuid().parse(p.connectionId));
    json(response, 200, { refreshed: true });
    return true;
  }
  if (path === "/api/outbound-messages") {
    if (method === "GET") {
      json(response, 200, service.outbox.messages.all());
      return true;
    }
    if (method === "POST") {
      const p = await body();
      const controller = z.string().uuid().parse(p.controllerSessionId);
      delete p.controllerSessionId;
      json(response, 201, service.outbox.enqueue(p, controller));
      return true;
    }
  }
  m = /^\/api\/outbound-messages\/([^/]+)\/(withdraw|reconcile)$/.exec(path);
  if (m && method === "POST") {
    if (m[2] === "withdraw") json(response, 200, service.outbox.withdraw(m[1]!));
    else {
      local();
      const p = await body();
      json(
        response,
        200,
        service.outbox.reconcile(
          m[1]!,
          z.enum(["sent", "withdrawn"]).parse(p.resolution),
          z.string().min(1).max(10000).parse(p.evidence),
        ),
      );
    }
    return true;
  }
  if (path === "/api/action-receipts" && method === "GET") {
    json(response, 200, service.actions.list());
    return true;
  }
  m = /^\/api\/action-receipts\/([^/]+)\/reconcile$/.exec(path);
  if (m && method === "POST") {
    local();
    const p = await body();
    service.actions.reconcile(
      m[1]!,
      z.enum(["confirmed", "failed"]).parse(p.resolution),
      z.string().min(1).max(10000).parse(p.evidence),
    );
    json(response, 200, { reconciled: true });
    return true;
  }
  if (path === "/api/notification-providers/apns") {
    if (method === "GET") {
      json(response, 200, service.delivery.apns.status());
      return true;
    }
    if (method === "PUT") {
      local();
      json(response, 200, await service.delivery.configureApns(await body()));
      return true;
    }
  }
  m = /^\/api\/notification-channels\/([^/]+)$/.exec(path);
  if (m && method === "DELETE") {
    const id = decodeURIComponent(m[1]!);
    const channel = service.delivery.channels.find(id);
    if (!ctx.local && !["apns", "bark", "client"].some((kind) => id === ctx.deviceId + ":" + kind))
      throw new KodoError("UNAUTHORIZED", "只能撤销本设备的推送令牌。");
    if (channel) await service.delivery.removeChannel(id);
    json(response, 200, { status: "revoked" });
    return true;
  }
  if (path === "/api/notification-channels") {
    if (method === "GET") {
      json(
        response,
        200,
        service.delivery.list().filter((c) => ctx.local || c.deviceId === ctx.deviceId),
      );
      return true;
    }
    if (method === "PUT") {
      const p = await body(),
        deviceId = ctx.local && p.deviceId ? z.string().parse(p.deviceId) : ctx.deviceId;
      delete p.deviceId;
      json(response, 200, await service.delivery.configure(deviceId, p, ctx.local));
      return true;
    }
  }
  if (path === "/api/notification-deliveries" && method === "GET") {
    json(response, 200, service.delivery.clientPending(ctx.deviceId));
    return true;
  }
  m = /^\/api\/notifications\/([^/]+)\/ack$/.exec(path);
  if (m && method === "POST") {
    const p = await body();
    service.delivery.acknowledge(
      ctx.deviceId,
      decodeURIComponent(m[1]!),
      z.string().nullable().parse(p.sessionId),
    );
    json(response, 200, { acknowledged: true });
    return true;
  }
  if (path === "/api/notification-deliveries/accept" && method === "POST") {
    const p = await body();
    json(response, 200, service.delivery.clientAccepted(ctx.deviceId, z.string().parse(p.id)));
    return true;
  }
  if (path === "/api/browsers") {
    if (method === "GET") {
      json(response, 200, { ...service.browser.status(), environments: service.browser.list() });
      return true;
    }
    if (method === "POST") {
      local();
      json(response, 201, service.browser.create(await body()));
      return true;
    }
  }
  m = /^\/api\/browsers\/([^/]+)\/(frame|stream|input|record|select-tab|schedule-recording)$/.exec(
    path,
  );
  if (m) {
    local();
    if (m[2] === "schedule-recording" && method === "POST") {
      json(response, 201, service.browser.scheduleRecording(m[1]!, await body()));
      return true;
    }
    const generation = z.coerce.number().int().min(1).parse(url.searchParams.get("generation"));
    if (m[2] === "select-tab" && method === "POST") {
      json(
        response,
        200,
        await service.browser.selectTab(
          m[1]!,
          generation,
          z
            .string()
            .uuid()
            .parse((await body()).pageId),
        ),
      );
      return true;
    }
    if (m[2] === "record" && method === "POST") {
      const input = z
        .object({ start: z.boolean() })
        .strict()
        .parse(await body());
      json(response, 200, service.browser.record(m[1]!, generation, input.start));
      return true;
    }
    if (method === "GET" && m[2] === "stream") {
      let lastSeq = -1;
      const sendFrame = () => {
        if (response.destroyed || response.writableEnded) return;
        try {
          const data = service.browser.frame(m![1]!, generation, lastSeq);
          if (data.sequence !== lastSeq || data.frame) {
            lastSeq = data.sequence;
            response.write(`data: ${JSON.stringify(data)}\n\n`);
          }
        } catch {
          unsub();
          clearInterval(ping);
          if (!response.destroyed && !response.writableEnded) response.end();
        }
      };
      const unsub = service.browser.subscribeFrame(m[1]!, generation, sendFrame);
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
      });
      sendFrame();
      const ping = setInterval(() => {
        if (!response.destroyed && !response.writableEnded) response.write(": ping\n\n");
      }, 15000);
      ping.unref();
      request.once("close", () => {
        unsub();
        clearInterval(ping);
      });
      return true;
    }
    if (method === "GET" && m[2] === "frame") {
      json(
        response,
        200,
        service.browser.frame(m[1]!, generation, Number(url.searchParams.get("after") ?? -1)),
      );
      return true;
    }
    if (method === "POST" && m[2] === "input") {
      json(response, 200, await service.browser.userInput(m[1]!, generation, await body()));
      return true;
    }
  }
  m = /^\/api\/browsers\/([^/]+)\/(control|return|tabs)$/.exec(path);
  if (m) {
    local();
    if (method === "GET" && m[2] === "tabs") {
      json(response, 200, await service.browser.tabs(m[1]!));
      return true;
    }
    if (method === "POST") {
      const p = await body();
      const g = z.number().int().min(0).parse(p.expectedGeneration);
      json(
        response,
        200,
        m[2] === "control"
          ? await service.browser.humanControl(m[1]!, g)
          : await service.browser.returnControl(m[1]!, g),
      );
      return true;
    }
  }
  if (path === "/api/executors") {
    if (method === "GET") {
      json(response, 200, service.executors.list());
      return true;
    }
    if (method === "POST") {
      local();
      const p = await body();
      json(response, 201, service.executors.enroll(z.string().parse(p.name)));
      return true;
    }
  }
  m = /^\/api\/executors\/([^/]+)\/(workspace|revoke)$/.exec(path);
  if (m && method === "POST") {
    local();
    const p = await body();
    json(
      response,
      200,
      m[2] === "workspace"
        ? service.executors.workspace(
            m[1]!,
            z
              .string()
              .uuid()
              .nullable()
              .parse(p.projectId ?? null),
            z.string().parse(p.rootPath),
          )
        : service.executors.revoke(m[1]!),
    );
    return true;
  }
  return false;
}
