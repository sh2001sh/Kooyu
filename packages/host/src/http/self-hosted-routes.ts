import { clientCapabilities, requireOperation } from "../clients/access.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { KodoError } from "@kodo/protocol";
import type { SessionService } from "../session-service.js";
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
      json(response, 200, await service.delivery.configure(deviceId, p));
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
