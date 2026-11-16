import type { IncomingMessage, ServerResponse } from "node:http";
import { HARNESS_IDS, type ClientMutationReceipt } from "@kodo/protocol";
import { z } from "zod";
import type { SessionService } from "../session-service.js";
import type { RouteContext } from "./work-routes.js";
import { deviceAccess, saveDeviceAccess, requireOperation } from "../clients/access.js";
import { goalDetail, notificationContext } from "../clients/details.js";
import { sessionConfiguration, harnessConfiguration } from "../clients/configuration.js";
import { ClientOperations } from "../clients/operations.js";
import { NativeSync } from "../clients/sync.js";
import { nativeSnapshot } from "../devices/native-client.js";
import { fileAccess } from "../files/http-content.js";
import { workbenchOverview } from "../clients/workbench.js";

const states = new WeakMap<SessionService, { sync: NativeSync; operations: ClientOperations }>();
export async function handleClientRoutes(
  s: SessionService,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: RouteContext,
): Promise<boolean> {
  let state = states.get(s);
  if (!state) {
    state = { sync: new NativeSync(), operations: new ClientOperations(s) };
    states.set(s, state);
  }
  const path = url.pathname,
    method = req.method ?? "GET",
    { json, readBody } = ctx;
  if (path === "/api/workbench" && method === "GET") {
    const projectId = z.string().uuid().nullable().parse(url.searchParams.get("projectId"));
    json(res, 200, workbenchOverview(s, projectId, ctx));
    return true;
  }
  if (path === "/api/native/sync" && method === "GET") {
    const cursor = z
      .string()
      .max(128)
      .optional()
      .parse(url.searchParams.get("cursor") ?? undefined);
    const snapshot = nativeSnapshot(s.snapshot());
    const live = new Set(snapshot.sessions.map((session) => session.id));
    json(
      res,
      200,
      state.sync.read(
        {
          ...snapshot,
          goals: s.goals
            .list({ includeClosed: true })
            .filter((goal) => live.has(goal.controllerSessionId)),
        },
        cursor,
      ),
    );
    return true;
  }
  if (path === "/api/client/operations" && method === "POST") {
    const receipt = await state.operations.execute(ctx, await readBody(req));
    json(res, receipt.status === "pending" ? 202 : 200, receipt);
    return true;
  }
  const receipt = /^\/api\/client\/operations\/([^/]+)$/.exec(path);
  if (receipt && method === "GET") {
    const result: ClientMutationReceipt = state.operations.get(
      ctx,
      decodeURIComponent(receipt[1]!),
    );
    json(res, 200, result);
    return true;
  }
  const access = /^\/api\/devices\/([^/]+)\/access$/.exec(path);
  if (access && (method === "GET" || method === "PUT")) {
    requireOperation(s, ctx, "devices.manage");
    const id = z.string().uuid().parse(access[1]);
    json(
      res,
      200,
      method === "GET" ? deviceAccess(s, id) : saveDeviceAccess(s, id, await readBody(req)),
    );
    return true;
  }
  const detail = /^\/api\/goals\/([^/]+)\/detail$/.exec(path);
  if (detail && method === "GET") {
    json(res, 200, goalDetail(s, z.string().uuid().parse(detail[1]), ctx));
    return true;
  }
  const notification = /^\/api\/notifications\/([^/]+)\/context$/.exec(path);
  if (notification && method === "GET") {
    json(res, 200, notificationContext(s, decodeURIComponent(notification[1]!), ctx));
    return true;
  }
  const config = /^\/api\/sessions\/([^/]+)\/configuration$/.exec(path);
  if (config && method === "GET") {
    json(res, 200, await sessionConfiguration(s, z.string().uuid().parse(config[1]), ctx));
    return true;
  }
  const harness = /^\/api\/harnesses\/([^/]+)\/configuration$/.exec(path);
  if (harness && method === "GET") {
    json(res, 200, harnessConfiguration(z.enum(HARNESS_IDS).parse(harness[1])));
    return true;
  }
  const file = /^\/api\/files\/([^/]+)\/access$/.exec(path);
  if (file && method === "GET") {
    json(res, 200, fileAccess(s.files, z.string().uuid().parse(file[1])));
    return true;
  }
  return false;
}
