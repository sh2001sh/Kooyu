import { requireOperation } from "../clients/access.js";
import { serveFileContent } from "../files/http-content.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { KodoError } from "@kodo/protocol";
import type { SessionService } from "../session-service.js";
import type { Wire } from "../harnesses/adapter.js";
import { MAX_CHUNK } from "../files/store.js";
import { runDoctor } from "../lifecycle/doctor.js";

export interface RouteContext {
  local: boolean;
  deviceId: string;
  /** Re-checks the device credential for long-lived streams. */
  stillAuthorized: () => boolean;
  json: (response: ServerResponse, status: number, value: unknown) => void;
  readBody: (request: IncomingMessage) => Promise<Wire>;
}

const flag = (value: string | null) => value === "1" || value === "true";

async function readRaw(request: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new KodoError("INVALID_INPUT", "分块过大。");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/**
 * Goals, notification feed and web sources. Returns false when the path is not
 * handled here. Checks require the local desktop or explicit per-device delegation;
 * storing search credentials stays local. Paired phones can review goals and notifications.
 */
export async function handleWorkRoutes(
  service: SessionService,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  ctx: RouteContext,
): Promise<boolean> {
  const { json, readBody } = ctx;
  const method = request.method ?? "GET";
  const path = url.pathname;

  // ----- goals -----
  if (path === "/api/goals") {
    if (method === "GET") {
      json(
        response,
        200,
        service.goals.list({
          controllerSessionId: url.searchParams.get("controllerSessionId") ?? undefined,
          sessionId: url.searchParams.get("sessionId") ?? undefined,
          includeClosed: flag(url.searchParams.get("includeClosed")),
        }),
      );
      return true;
    }
    if (method === "POST") {
      json(response, 201, await service.goals.create(await readBody(request), "user"));
      return true;
    }
  }
  const goal = /^\/api\/goals\/([^/]+)(?:\/(checks|verification|complete|review))?$/.exec(path);
  if (goal) {
    const id = z.string().uuid().parse(decodeURIComponent(goal[1]!));
    const action = goal[2];
    if (!action && method === "GET") {
      json(response, 200, service.goals.detail(id));
      return true;
    }
    if (!action && method === "PATCH") {
      json(response, 200, await service.goals.update(id, await readBody(request), "user"));
      return true;
    }
    if (method === "POST" && action === "checks") {
      requireOperation(service, ctx, "goals.check");
      json(response, 201, await service.goals.runCheck(id, await readBody(request), "user"));
      return true;
    }
    if (method === "POST" && action === "verification") {
      json(
        response,
        201,
        await service.goals.recordVerification(id, await readBody(request), "user"),
      );
      return true;
    }
    if (method === "POST" && action === "complete") {
      json(response, 200, await service.goals.complete(id, await readBody(request), "user"));
      return true;
    }
    if (method === "POST" && action === "review") {
      json(response, 200, await service.goals.review(id, await readBody(request)));
      return true;
    }
  }

  // ----- notifications -----
  if (method === "GET" && path === "/api/notifications") {
    const after = Number(url.searchParams.get("after") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 100);
    json(response, 200, service.feed.list(after, limit));
    return true;
  }
  if (method === "GET" && path === "/api/notifications/events") {
    let cursor = Number(
      request.headers["last-event-id"] ?? url.searchParams.get("after") ?? service.feed.latest(),
    );
    if (!Number.isSafeInteger(cursor) || cursor < 0)
      throw new KodoError("INVALID_INPUT", "通知游标无效。");
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.write(": connected\n\n");
    const flush = () => {
      if (response.destroyed || response.writableEnded) return;
      if (!ctx.stillAuthorized()) {
        response.write("event: auth-expired\ndata: {}\n\n");
        response.end();
        return;
      }
      for (;;) {
        const page = service.feed.list(cursor, 200);
        if (page.resetRequired) {
          response.write(`event: reset\ndata: ${JSON.stringify(page)}\n\n`);
          cursor = page.cursor;
          return;
        }
        for (const item of page.items)
          response.write(
            `id: ${item.sequence}\nevent: notification\ndata: ${JSON.stringify(item)}\n\n`,
          );
        cursor = page.cursor;
        if (page.items.length < 200) return;
      }
    };
    flush();
    service.notifications.on("notification", flush);
    const timer = setInterval(() => {
      try {
        flush();
        if (!response.writableEnded) response.write(": heartbeat\n\n");
      } catch {
        response.end();
      }
    }, 15000);
    request.on("close", () => {
      clearInterval(timer);
      service.notifications.off("notification", flush);
    });
    return true;
  }
  const fact = /^\/api\/notifications\/([^/]+)$/.exec(path);
  if (method === "GET" && fact) {
    json(response, 200, service.feed.get(decodeURIComponent(fact[1]!)));
    return true;
  }
  const read = /^\/api\/notifications\/([^/]+)\/read$/.exec(path);
  if (method === "POST" && read) {
    json(response, 200, service.feed.markRead(decodeURIComponent(read[1]!)));
    return true;
  }

  // ----- managed files and artifacts -----
  if (method === "POST" && path === "/api/files/uploads") {
    json(response, 201, service.files.createUpload(await readBody(request)));
    return true;
  }
  const upload = /^\/api\/files\/uploads\/([^/]+)(?:\/(chunks|complete))?$/.exec(path);
  if (upload) {
    const id = z.string().uuid().parse(upload[1]);
    if (method === "GET" && !upload[2]) {
      json(response, 200, service.files.upload(id));
      return true;
    }
    if (method === "PUT" && upload[2] === "chunks") {
      const offset = Number(url.searchParams.get("offset"));
      json(response, 200, service.files.appendChunk(id, offset, await readRaw(request, MAX_CHUNK)));
      return true;
    }
    if (method === "POST" && upload[2] === "complete") {
      json(response, 200, await service.files.completeUpload(id));
      return true;
    }
    if (method === "DELETE" && !upload[2]) {
      json(response, 200, service.files.cancelUpload(id));
      return true;
    }
  }
  if (method === "GET" && path === "/api/files") {
    json(
      response,
      200,
      service.files.list({
        sessionId: url.searchParams.get("sessionId") ?? undefined,
        goalId: url.searchParams.get("goalId") ?? undefined,
      }),
    );
    return true;
  }
  const file = /^\/api\/files\/([^/]+)(\/content)?$/.exec(path);
  if ((method === "GET" || (method === "HEAD" && file?.[2])) && file && file[1] !== "uploads") {
    const id = z.string().uuid().parse(file[1]);
    if (!file[2]) {
      json(response, 200, service.files.file(id));
      return true;
    }
    serveFileContent(service.files, id, request, response, flag(url.searchParams.get("download")));
    return true;
  }
  if (path === "/api/artifacts") {
    if (method === "GET") {
      json(
        response,
        200,
        service.files.artifacts({
          goalId: url.searchParams.get("goalId") ?? undefined,
          sessionId: url.searchParams.get("sessionId") ?? undefined,
        }),
      );
      return true;
    }
    if (method === "POST") {
      json(response, 201, await service.files.publish(await readBody(request), "user"));
      return true;
    }
  }
  const artifact = /^\/api\/artifacts\/([^/]+)$/.exec(path);
  if (method === "GET" && artifact) {
    json(response, 200, service.files.artifact(z.string().uuid().parse(artifact[1])));
    return true;
  }

  // ----- host self-check -----
  if (method === "GET" && path === "/api/host/doctor") {
    json(response, 200, await runDoctor(service));
    return true;
  }

  // ----- web -----
  if (method === "GET" && path === "/api/web/sources") {
    json(
      response,
      200,
      service.web.sources({
        sessionId: url.searchParams.get("sessionId") ?? undefined,
        goalId: url.searchParams.get("goalId") ?? undefined,
      }),
    );
    return true;
  }
  if (path === "/api/web/search-config") {
    if (method === "GET") {
      json(response, 200, service.web.status());
      return true;
    }
    if (method === "PUT") {
      if (!ctx.local) throw new KodoError("UNAUTHORIZED", "检索服务凭据需在本机桌面配置。");
      json(response, 200, await service.web.configure(await readBody(request)));
      return true;
    }
  }
  return false;
}
