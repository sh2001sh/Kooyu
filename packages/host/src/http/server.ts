import { handleClientRoutes } from "./client-routes.js";
import { sessionMetadataSchema } from "../clients/operations.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  KodoError,
  HARNESS_IDS,
  PROTOCOL_VERSION,
  projectGrantSchema,
  type HarnessId,
} from "@kodo/protocol";
import { ZodError, z } from "zod";
import { Pairing, DEVICE_TOKEN_TTL_MS } from "../devices/pairing.js";
import type { RelayConnector } from "../devices/relay.js";
import { nativeSnapshot } from "../devices/native-client.js";
import type { SessionService } from "../session-service.js";
import type { Wire } from "../harnesses/adapter.js";
import { artifacts, preview, createWorktree, workspaceContext } from "../workspaces/artifacts.js";
import { listDirectories } from "../workspaces/directories.js";
import {
  listWorkspaceFiles,
  previewWorkspaceFile,
  workspaceFileContent,
  workspaceChanges,
  workspaceFileDiff,
} from "../workspaces/files.js";
import { refreshDesktopInstallations } from "../harnesses/desktop-installations.js";
import { appSettings, saveAppSettings } from "../configuration/preferences.js";
import { onboardingState, saveOnboarding } from "../configuration/onboarding.js";
import { readConfigFile, writeConfigFile } from "../configuration/config-files.js";
import { HarnessSkills } from "../configuration/skills.js";
import { handleWorkRoutes } from "./work-routes.js";
import { getVoiceStatus, MAX_VOICE_BYTES, transcribeVoice } from "../voice.js";

import { handleSelfHostedRoutes } from "./self-hosted-routes.js";

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(value));
}
async function readBody(request: IncomingMessage): Promise<Wire> {
  if (!request.headers["content-type"]?.startsWith("application/json"))
    throw new KodoError("INVALID_INPUT", "请求需要 JSON 内容。");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new KodoError("INVALID_INPUT", "请求内容过大。");
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString());
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new KodoError("INVALID_INPUT", "无法读取 JSON 对象。");
  }
}
async function readBinaryBody(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > maxBytes) throw new KodoError("INVALID_INPUT", "请求内容过大。");
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}
const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};
export interface HostHttpOptions {
  port: number;
  webRoot: string;
  publicOrigin?: string;
  /** Set only by the internal connector listener, never from request headers. */
  forceRemote?: boolean;
  pairing?: Pairing;
  relay?: RelayConnector;
}
export function createHostHandler(service: SessionService, options: HostHttpOptions) {
  const pairing = options.pairing ?? new Pairing(service.store),
    localOrigins = new Set([
      `http://127.0.0.1:${options.port}`,
      `http://localhost:${options.port}`,
      `https://127.0.0.1:${options.port}`,
      `https://localhost:${options.port}`,
      "http://127.0.0.1:5173",
    ]);
  if (options.publicOrigin && !options.publicOrigin.startsWith("https://"))
    throw new Error("KODO_PUBLIC_ORIGIN must use HTTPS.");
  return async (request: IncomingMessage, response: ServerResponse) => {
    try {
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Referrer-Policy", "no-referrer");
      response.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
      );
      const url = new URL(request.url ?? "/", `http://127.0.0.1:${options.port}`),
        host = request.headers.host ?? "",
        origin = request.headers.origin;
      const workerMatch = /^[/]worker[/]([^/]+)[/](poll|result|file)$/.exec(url.pathname);
      if (workerMatch) {
        await service.executors.handle(request, response, workerMatch[1]!, workerMatch[2]!);
        return;
      }
      const hookMatch = /^[/]hooks[/]([^/]+)$/.exec(url.pathname);
      if (hookMatch) {
        await service.webhooks.handle(request, response, hookMatch[1]!);
        return;
      }
      const localHost =
        host === `127.0.0.1:${options.port}` || host === `localhost:${options.port}`;
      const localPeer = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
        request.socket.remoteAddress ?? "",
      );
      const forwarded = Boolean(request.headers["x-forwarded-for"] || request.headers.forwarded);
      const local = !options.forceRemote && localHost && localPeer && !forwarded;
      const allowed = localOrigins.has(origin ?? "") || origin === options.publicOrigin;
      if (origin && !allowed) throw new KodoError("UNAUTHORIZED", "界面来源未授权。");
      if (request.method === "GET" && url.pathname === "/api/health") {
        json(response, 200, {
          status: "ok",
          protocolVersion: PROTOCOL_VERSION,
          hostId: service.store.hostId,
        });
        return;
      }
      const nativePair = url.pathname === "/api/pair/native";
      const clientVersion = request.headers["x-kooyu-protocol"];
      if (
        url.pathname.startsWith("/api/") &&
        clientVersion !== undefined &&
        clientVersion !== String(PROTOCOL_VERSION)
      )
        throw new KodoError("CONFLICT", "客户端与 Host 协议版本不兼容，请升级后重试。");
      if (request.method === "POST" && (url.pathname === "/api/pair" || nativePair)) {
        // URLSession/OkHttp do not send Origin. Never expose a bearer token
        // to browser JavaScript, including an otherwise allowed UI.
        if (nativePair && origin)
          throw new KodoError("UNAUTHORIZED", "原生设备配对不接受浏览器来源。");
        if (
          nativePair &&
          !local &&
          !("encrypted" in request.socket && request.socket.encrypted) &&
          (!options.publicOrigin || host !== new URL(options.publicOrigin).host)
        )
          throw new KodoError("UNAUTHORIZED", "原生设备需要通过配置的 HTTPS 地址配对。");
        const body = await readBody(request);
        const result = pairing.pair(
          z.string().max(64).parse(body.code),
          z.string().max(100).parse(body.name),
        );
        // OAuth providers return by top-level GET; Lax preserves the paired device
        // on that navigation. Cross-origin writes still fail the Origin/JSON gates.
        if (!nativePair)
          response.setHeader(
            "Set-Cookie",
            `kodo_device=${result.token}; HttpOnly; SameSite=Lax; Path=/api; Max-Age=${DEVICE_TOKEN_TTL_MS / 1000}; Secure`,
          );
        json(response, 201, {
          device: result.device,
          ...(nativePair
            ? {
                token: result.token,
                hostId: service.store.hostId,
                protocolVersion: PROTOCOL_VERSION,
              }
            : {}),
        });
        return;
      }
      const cookie = /\bkodo_device=([A-Za-z0-9_-]+)/.exec(request.headers.cookie ?? "")?.[1],
        bearer = request.headers.authorization?.replace(/^Bearer /, "");
      const authorized = local || pairing.authenticate(bearer ?? cookie ?? "");
      if (url.pathname.startsWith("/api/") && !authorized)
        throw new KodoError("UNAUTHORIZED", "请在桌面生成配对码后连接此设备。");
      if (
        url.pathname.startsWith("/api/") &&
        (await handleClientRoutes(service, request, response, url, {
          local,
          deviceId: local ? "desktop" : pairing.deviceId(bearer ?? cookie ?? "")!,
          stillAuthorized: () => local || pairing.authenticate(bearer ?? cookie ?? ""),
          json,
          readBody,
        }))
      )
        return;
      if (
        await handleSelfHostedRoutes(service, request, response, url, {
          local,
          stillAuthorized: () => local || pairing.authenticate(bearer ?? cookie ?? ""),
          json,
          readBody,
          deviceId: local ? "desktop" : pairing.deviceId(bearer ?? cookie ?? "")!,
        })
      )
        return;
      if (url.pathname === "/api/remote") {
        if (!local) throw new KodoError("UNAUTHORIZED", "请在电脑端管理远程连接。");
        if (request.method === "DELETE") {
          options.relay?.disable();
          pairing.invalidate();
        } else if (request.method !== "GET") throw new KodoError("INVALID_INPUT", "不支持此操作。");
        json(response, 200, {
          ...(options.relay?.status() ?? {
            enabled: false,
            state: "disabled",
            configured: Boolean(options.publicOrigin),
          }),
          devices: service.store.records("device-public"),
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/snapshot") {
        json(response, 200, service.snapshot());
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/native/snapshot") {
        json(response, 200, nativeSnapshot(service.snapshot()));
        return;
      }
      if (url.pathname === "/api/app-settings" && request.method === "GET") {
        json(response, 200, appSettings(service.store));
        return;
      }
      if (url.pathname === "/api/onboarding") {
        if (!local) throw new KodoError("UNAUTHORIZED", "请在运行 Host 的电脑端完成首次设置。");
        if (request.method === "GET") json(response, 200, onboardingState(service.store));
        else if (request.method === "PATCH")
          json(response, 200, saveOnboarding(service.store, await readBody(request)));
        else throw new KodoError("INVALID_INPUT", "不支持的引导操作。");
        return;
      }
      if (url.pathname === "/api/app-settings" && request.method === "PATCH") {
        json(response, 200, saveAppSettings(service.store, await readBody(request)));
        return;
      }
      if (url.pathname === "/api/harnesses/management" && request.method === "GET") {
        json(response, 200, service.engines.list());
        return;
      }
      const engineAction =
        /^\/api\/harnesses\/([^/]+)\/(install|upgrade|installation|restore-installation)$/.exec(
          url.pathname,
        );
      if (engineAction && request.method === "POST") {
        if (!local) throw new KodoError("UNAUTHORIZED", "请在本机桌面执行引擎安装和入口修改。");
        const harnessId = z.enum(HARNESS_IDS).parse(engineAction[1]),
          action = engineAction[2];
        if (action === "installation") {
          const input = z
            .object({
              command: z.string().trim().min(1).max(4096),
              args: z.array(z.string().max(4096)).max(64),
            })
            .strict()
            .parse(await readBody(request));
          json(response, 200, service.engines.configure(harnessId, input));
        } else if (action === "restore-installation")
          json(response, 200, service.engines.restore(harnessId));
        else json(response, 202, service.engines.start(harnessId, action as "install" | "upgrade"));
        return;
      }
      const skillRoute = /^\/api\/harnesses\/([^/]+)\/skills(?:\/(file|directories))?$/.exec(
        url.pathname,
      );
      if (skillRoute) {
        const harnessId = z.enum(HARNESS_IDS).parse(skillRoute[1]);
        const workspaceId = url.searchParams.get("workspaceId");
        const workspace = workspaceId
          ? service.store.workspaces().find((item) => item.id === workspaceId)
          : undefined;
        if (workspaceId && !workspace) throw new KodoError("NOT_FOUND", "项目目录不存在。");
        const manager = new HarnessSkills(service.store, service.dataDir, harnessId, {
          workspace: workspace?.rootPath,
        });
        if (request.method === "GET") {
          json(
            response,
            200,
            skillRoute[2] === "file"
              ? manager.read(z.string().min(1).max(4096).parse(url.searchParams.get("path")))
              : manager.list(),
          );
          return;
        }
        if (!local) throw new KodoError("UNAUTHORIZED", "请在运行 Host 的本机管理 Skills。");
        if (skillRoute[2] === "directories" && ["POST", "DELETE"].includes(request.method ?? "")) {
          const input = z
            .object({ path: z.string().trim().min(1).max(4096) })
            .strict()
            .parse(await readBody(request));
          json(
            response,
            200,
            request.method === "POST" ? manager.attach(input.path) : manager.detach(input.path),
          );
          return;
        }
        if (!skillRoute[2] && request.method === "POST") {
          const path = z.string().min(1).max(4096),
            version = z.string().min(1).max(128);
          const input = z
            .discriminatedUnion("operation", [
              z
                .object({
                  operation: z.literal("create"),
                  directory: path,
                  name: z.string().min(1).max(64),
                  content: z.string().max(256 * 1024),
                })
                .strict(),
              z
                .object({
                  operation: z.literal("import"),
                  directory: path,
                  source: path,
                  name: z.string().max(64).optional(),
                })
                .strict(),
              z
                .object({
                  operation: z.literal("save"),
                  path,
                  version,
                  content: z.string().max(256 * 1024),
                })
                .strict(),
              z
                .object({ operation: z.literal("toggle"), path, version, enabled: z.boolean() })
                .strict(),
              z.object({ operation: z.literal("archive"), path, version }).strict(),
            ])
            .parse(await readBody(request));
          const result =
            input.operation === "create"
              ? manager.create(input.directory, input.name, input.content)
              : input.operation === "import"
                ? manager.import(input.directory, input.source, input.name)
                : input.operation === "save"
                  ? manager.save(input.path, input.content, input.version)
                  : input.operation === "toggle"
                    ? manager.toggle(input.path, input.enabled, input.version)
                    : manager.archive(input.path, input.version);
          json(response, 200, result);
          return;
        }
        throw new KodoError("INVALID_INPUT", "不支持的 Skills 操作。");
      }
      const configFile = /^\/api\/harnesses\/([^/]+)\/config-file$/.exec(url.pathname);
      if (configFile) {
        const harnessId = z.enum(HARNESS_IDS).parse(configFile[1]);
        if (request.method === "GET") {
          json(
            response,
            200,
            readConfigFile(
              harnessId,
              z.string().min(1).parse(url.searchParams.get("path")),
              service.dataDir,
            ),
          );
          return;
        }
        if (request.method === "PUT") {
          if (!local) throw new KodoError("UNAUTHORIZED", "请在本机桌面编辑引擎配置文件。");
          const input = z
            .object({ path: z.string().min(1), content: z.string(), version: z.string() })
            .strict()
            .parse(await readBody(request));
          json(response, 200, writeConfigFile(harnessId, input, service.dataDir));
          return;
        }
      }
      if (url.pathname === "/api/harness-provider-bindings" && request.method === "POST") {
        const input = z
          .object({
            harnessId: z.enum(HARNESS_IDS),
            providerId: z.string().uuid(),
            endpointId: z.string().uuid(),
            expectedDefaultsRevision: z.number().int().nonnegative(),
            requestId: z.string().uuid().optional(),
          })
          .strict()
          .parse(await readBody(request));
        json(response, 201, service.providers.saveProviderBinding(input));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/directories") {
        json(response, 200, await listDirectories(url.searchParams.get("path") ?? undefined));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/harnesses/installations") {
        if (url.searchParams.get("refresh") === "1") refreshDesktopInstallations();
        json(response, 200, { harnesses: service.snapshot().harnesses });
        return;
      }
      const harnessModels = /^\/api\/harnesses\/([^/]+)\/models$/.exec(url.pathname);
      if (request.method === "GET" && harnessModels) {
        json(
          response,
          200,
          await service.harnessModels(
            harnessModels[1]! as HarnessId,
            url.searchParams.get("discover") === "1",
          ),
        );
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/verification") {
        json(
          response,
          200,
          JSON.parse(
            await readFile(
              fileURLToPath(new URL("../../../../docs/verification.json", import.meta.url)),
              "utf8",
            ),
          ),
        );
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/events") {
        let cursor = Number(
          request.headers["last-event-id"] ??
            url.searchParams.get("after") ??
            service.store.latestSequence(),
        );
        if (!Number.isSafeInteger(cursor) || cursor < 0)
          throw new KodoError("INVALID_INPUT", "事件游标无效。");
        response.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        response.write(": connected\n\n");
        let flushing = false;
        const flush = () => {
          if (flushing || response.destroyed) return;
          if (!local && !pairing.authenticate(bearer ?? cookie ?? "")) {
            response.write("event: auth-expired\ndata: {}\n\n");
            response.end();
            return;
          }
          flushing = true;
          try {
            let events;
            do {
              events = service.events(undefined, cursor);
              for (const e of events) {
                if (response.writableLength > 1024 * 1024) {
                  response.end();
                  return;
                }
                response.write(`id: ${e.sequence}\ndata: ${JSON.stringify(e)}\n\n`);
                cursor = e.sequence;
              }
            } while (events.length === 500);
          } finally {
            flushing = false;
          }
        };
        flush();
        service.notifications.on("event", flush);
        let heartbeatAt = Date.now();
        const timer = setInterval(() => {
          try {
            flush();
            if (!response.writableEnded && Date.now() - heartbeatAt >= 15000) {
              response.write(": heartbeat\n\n");
              heartbeatAt = Date.now();
            }
          } catch {
            response.end();
          }
        }, 1000);
        request.on("close", () => {
          clearInterval(timer);
          service.notifications.off("event", flush);
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/search") {
        json(response, 200, service.search((url.searchParams.get("q") ?? "").slice(0, 1000)));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/usage") {
        json(response, 200, service.usageSummary());
        return;
      }
      const withdraw = /^\/api\/sessions\/([^/]+)\/commands\/([^/]+)$/.exec(url.pathname);
      if (request.method === "PATCH" && withdraw) {
        json(
          response,
          200,
          service.changePendingMessage(withdraw[1]!, withdraw[2]!, await readBody(request)),
        );
        return;
      }
      if (request.method === "GET" && withdraw && url.searchParams.has("requestId")) {
        json(
          response,
          200,
          service.pendingMessageReceipt(
            withdraw[1]!,
            withdraw[2]!,
            z.string().uuid().parse(url.searchParams.get("requestId")),
          ),
        );
        return;
      }
      if (request.method === "DELETE" && withdraw) {
        json(response, 200, service.withdrawCommand(withdraw[1]!, withdraw[2]!));
        return;
      }
      const command = /^\/api\/commands\/([^/]+)$/.exec(url.pathname);
      if (request.method === "GET" && command) {
        const c = service.store.command(command[1]!);
        if (!c) throw new KodoError("NOT_FOUND", "Host 未接收此请求。");
        json(response, 200, c);
        return;
      }
      const projectPath = /^\/api\/projects\/([^/]+)$/.exec(url.pathname);
      if (request.method === "PATCH" && projectPath) {
        json(response, 200, service.updateProject(projectPath[1]!, await readBody(request)));
        return;
      }
      if (request.method === "DELETE" && projectPath) {
        const mode = url.searchParams.get("sessions") === "delete" ? "delete" : "keep";
        json(response, 200, await service.deleteProject(projectPath[1]!, mode));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/projects") {
        json(response, 201, service.createProject(await readBody(request)));
        return;
      }
      const projectDefaults = /^\/api\/projects\/([^/]+)\/binding-defaults$/.exec(url.pathname);
      if (request.method === "PATCH" && projectDefaults) {
        json(
          response,
          200,
          service.updateProjectDefaults(projectDefaults[1]!, await readBody(request)),
        );
        return;
      }
      if (request.method === "PATCH" && url.pathname === "/api/binding-defaults") {
        json(response, 200, service.updateBindingDefaults(await readBody(request)));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/workspaces") {
        const b = await readBody(request);
        json(
          response,
          201,
          service.addWorkspace(
            z.string().uuid().nullable().parse(b.projectId),
            z.string().min(1).parse(b.rootPath),
          ),
        );
        return;
      }
      const fileRoute =
        /^\/api\/workspaces\/([^/]+)\/(files|changes)(?:\/(preview|content|diff))?$/.exec(
          url.pathname,
        );
      if (fileRoute && request.method === "GET") {
        const w = service.store.workspaces().find((item) => item.id === fileRoute[1]);
        if (!w) throw new KodoError("NOT_FOUND", "工作位置不存在。");
        if (w.hostId !== service.store.hostId)
          throw new KodoError("UNSUPPORTED", "该工作区位于远程节点，Host 不解释节点文件路径。");
        const path = url.searchParams.get("path") ?? "";
        if (fileRoute[2] === "changes") {
          if (fileRoute[3] && fileRoute[3] !== "diff")
            throw new KodoError("NOT_FOUND", "接口不存在。");
          json(
            response,
            200,
            fileRoute[3] ? await workspaceFileDiff(w, path) : await workspaceChanges(w),
          );
        } else if (fileRoute[3] === "content") {
          const file = await workspaceFileContent(w, path);
          response.writeHead(200, {
            "Content-Type": file.mime,
            "Content-Length": String(file.bytes.length),
            "Cache-Control": "no-store",
            "Content-Security-Policy":
              file.mime === "application/pdf"
                ? "frame-ancestors 'self'; base-uri 'none'"
                : "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'",
            "Content-Disposition":
              (url.searchParams.get("download") === "1" || file.mime === "application/octet-stream"
                ? "attachment"
                : "inline") +
              "; filename*=UTF-8''" +
              encodeURIComponent(file.name),
          });
          response.end(file.bytes);
        } else if (fileRoute[3] === "preview")
          json(response, 200, await previewWorkspaceFile(w, path));
        else if (!fileRoute[3]) json(response, 200, await listWorkspaceFiles(w, path));
        else throw new KodoError("NOT_FOUND", "接口不存在。");
        return;
      }
      const workspace = /^\/api\/workspaces\/([^/]+)\/(artifacts|context|preview|worktrees)$/.exec(
        url.pathname,
      );
      if (workspace) {
        const w = service.store.workspaces().find((w) => w.id === workspace[1]);
        if (!w) throw new KodoError("NOT_FOUND", "工作位置不存在。");
        if (w.hostId !== service.store.hostId)
          throw new KodoError("UNSUPPORTED", "该工作区位于远程节点，Host 不解释节点文件路径。");
        if (request.method === "GET" && workspace[2] === "artifacts") {
          json(response, 200, await artifacts(w));
          return;
        }
        if (request.method === "GET" && workspace[2] === "context") {
          json(response, 200, await workspaceContext(w));
          return;
        }
        if (request.method === "GET" && workspace[2] === "preview") {
          json(response, 200, await preview(w, url.searchParams.get("path") ?? ""));
          return;
        }
        if (request.method === "POST" && workspace[2] === "worktrees") {
          const b = await readBody(request);
          const path = await createWorktree(w, z.string().min(1).parse(b.rootPath));
          json(response, 201, service.addWorkspace(w.projectId, path));
          return;
        }
      }
      if (request.method === "POST" && url.pathname === "/api/sessions") {
        json(response, 201, service.createDraft(await readBody(request)));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/sessions/native-sync") {
        json(response, 200, await service.syncNativeSessions());
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/native-imports") {
        const harnessParam = url.searchParams.get("harnessId") ?? undefined;
        const harnessId =
          harnessParam && HARNESS_IDS.includes(harnessParam as HarnessId)
            ? (harnessParam as HarnessId)
            : undefined;
        json(
          response,
          200,
          await service.discoverNativeImports({
            projectId: url.searchParams.get("projectId") ?? undefined,
            workspaceId: url.searchParams.get("workspaceId") ?? undefined,
            harnessId,
            directory: url.searchParams.get("directory") ?? undefined,
          }),
        );
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/native-imports") {
        json(response, 201, await service.importNativeSessions(await readBody(request)));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/voice/status") {
        json(response, 200, getVoiceStatus(service.store, service.providers));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/app-update") {
        json(response, 200, service.updater.status());
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/app-update/check") {
        const body = request.headers["content-type"]?.startsWith("application/json")
          ? await readBody(request)
          : {};
        const input = z
          .object({
            channel: z.enum(["stable", "preview"]).optional(),
            repository: z.string().trim().min(3).max(120).optional(),
          })
          .strict()
          .parse(body);
        json(response, 200, await service.updater.check(input));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/app-update/download") {
        const body = request.headers["content-type"]?.startsWith("application/json")
          ? await readBody(request)
          : {};
        const input = z
          .object({
            assetName: z.string().trim().min(1).max(240).optional(),
          })
          .strict()
          .parse(body);
        json(response, 202, await service.updater.startDownload(input));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/app-update/install") {
        if (!local) throw new KodoError("UNAUTHORIZED", "请在运行 Host 的本机执行更新安装。");
        json(response, 200, await service.updater.install());
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/voice/transcribe") {
        const contentType = request.headers["content-type"] ?? "";
        let audio: Buffer;
        let mimeType = contentType || "audio/webm";
        let language = url.searchParams.get("language") ?? undefined;
        let providerId = url.searchParams.get("providerId") ?? undefined;
        let model = url.searchParams.get("model") ?? undefined;
        let prompt = url.searchParams.get("prompt") ?? undefined;
        if (contentType.startsWith("application/json")) {
          const rawJson = (
            await readBinaryBody(request, Math.ceil(MAX_VOICE_BYTES * 1.4))
          ).toString();
          let parsed: Wire;
          try {
            parsed = JSON.parse(rawJson);
          } catch {
            throw new KodoError("INVALID_INPUT", "无法读取语音转写 JSON 请求。");
          }
          const b64 = typeof parsed?.audioBase64 === "string" ? parsed.audioBase64 : "";
          if (!b64) throw new KodoError("INVALID_INPUT", "缺少音频数据 audioBase64。");
          audio = Buffer.from(b64, "base64");
          if (typeof parsed.mimeType === "string" && parsed.mimeType) mimeType = parsed.mimeType;
          if (typeof parsed.language === "string" && parsed.language) language = parsed.language;
          if (typeof parsed.providerId === "string" && parsed.providerId)
            providerId = parsed.providerId;
          if (typeof parsed.model === "string" && parsed.model) model = parsed.model;
          if (typeof parsed.prompt === "string" && parsed.prompt) prompt = parsed.prompt;
        } else {
          audio = await readBinaryBody(request, MAX_VOICE_BYTES);
        }
        json(
          response,
          200,
          await transcribeVoice(service.store, service.providers, {
            audio,
            mimeType,
            language,
            providerId,
            model,
            prompt,
          }),
        );
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/provider-configuration") {
        json(response, 200, await service.providers.configuration());
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/model-catalog/search") {
        json(
          response,
          200,
          await service.providers.search(
            url.searchParams.get("q") ?? "",
            url.searchParams.get("provider") ?? undefined,
          ),
        );
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/model-catalog/refresh") {
        json(response, 200, await service.providers.refreshCatalog());
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/providers") {
        json(response, 201, await service.providers.saveProvider(await readBody(request)));
        return;
      }
      const providerModels =
        /^\/api\/providers\/([^/]+)\/endpoints\/([^/]+)\/models\/refresh$/.exec(url.pathname);
      if (request.method === "POST" && providerModels) {
        json(
          response,
          200,
          await service.providers.discover(providerModels[1]!, providerModels[2]!),
        );
        return;
      }
      const providerPath = /^\/api\/providers\/([^/]+)$/.exec(url.pathname);
      if (request.method === "DELETE" && providerPath) {
        json(response, 200, service.providers.deleteProvider(providerPath[1]!));
        return;
      }
      const modelPath = /^\/api\/provider-models\/([^/]+)$/.exec(url.pathname);
      if (request.method === "DELETE" && modelPath) {
        json(response, 200, service.providers.deleteModel(modelPath[1]!));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/provider-models") {
        json(response, 201, await service.providers.saveModel(await readBody(request)));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/harness-bindings/preview") {
        json(response, 200, service.providers.preview(await readBody(request)));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/harness-bindings") {
        json(response, 201, service.providers.saveBinding(await readBody(request)));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/watches") {
        json(response, 201, service.watch(await readBody(request)));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/watches/transfer") {
        json(response, 201, service.transferControl(await readBody(request)));
        return;
      }
      const watch = /^\/api\/watches\/([^/]+)$/.exec(url.pathname);
      if (request.method === "PATCH" && watch) {
        const b = await readBody(request);
        json(
          response,
          200,
          service.changeWatch(watch[1]!, z.enum(["paused", "revoked"]).parse(b.state)),
        );
        return;
      }
      const activityRoute = /^\/api\/sessions\/([^/]+)\/(activity|agents\/([^/]+))$/.exec(
        url.pathname,
      );
      if (activityRoute && request.method === "GET") {
        const id = decodeURIComponent(activityRoute[1]!);
        const beforeValue = url.searchParams.get("before");
        const before =
          beforeValue === null ? undefined : z.coerce.number().int().positive().parse(beforeValue);
        json(
          response,
          200,
          activityRoute[2] === "activity"
            ? service.activity(id)
            : service.agentPage(id, decodeURIComponent(activityRoute[3]!), before),
        );
        return;
      }
      const session =
        /^\/api\/sessions\/([^/]+)(?:\/(open|send|stop|native|history|quota|handoff|branch|message-branches|grant|reconcile|attach|settings|permissions))?$/.exec(
          url.pathname,
        );
      if (session) {
        const id = session[1]!,
          action = session[2];
        if (request.method === "DELETE" && !action) {
          json(response, 200, await service.deleteSession(id));
          return;
        }
        if (request.method === "GET") {
          if (action === "permissions") {
            json(response, 200, await service.sessionPermissionOptions(id));
            return;
          }
          if (action === "settings") {
            const requestId = url.searchParams.get("requestId");
            json(
              response,
              200,
              requestId
                ? service.modelSettingsReceipt(id, z.string().uuid().parse(requestId))
                : await service.sessionModelOptions(
                    id,
                    url.searchParams.get("refresh") === "1",
                    url.searchParams.get("discover") === "1",
                  ),
            );
            return;
          }
          if (!action) {
            if (
              url.searchParams.has("tail") ||
              url.searchParams.has("before") ||
              url.searchParams.has("event")
            ) {
              const before = url.searchParams.has("before")
                ? z.coerce.number().int().positive().parse(url.searchParams.get("before"))
                : undefined;
              json(
                response,
                200,
                service.readPage(id, before, url.searchParams.get("event") ?? undefined),
              );
            } else {
              json(
                response,
                200,
                service.read(
                  id,
                  z.coerce
                    .number()
                    .int()
                    .min(0)
                    .parse(url.searchParams.get("after") ?? 0),
                ),
              );
            }
            return;
          }
          if (action === "native" || action === "history" || action === "quota") {
            json(
              response,
              200,
              await (action === "native"
                ? service.nativeRead(id)
                : action === "history"
                  ? service.nativeList(id)
                  : service.quota(id)),
            );
            return;
          }
        }
        if (request.method === "PATCH" && !action) {
          const input = sessionMetadataSchema.parse(await readBody(request));
          json(
            response,
            200,
            input.permissionMode === undefined
              ? service.updateSession(id, input)
              : await service.updatePermissionMode(id, input),
          );
          return;
        }
        if (request.method === "POST") {
          const b = await readBody(request);
          if (action === "message-branches") {
            json(response, 200, await service.messageBranch(id, b));
            return;
          }
          if (action === "branch") {
            json(response, 201, service.branch(id, b));
            return;
          }
          if (action === "settings") {
            json(response, 200, await service.setModelSettings(id, b));
            return;
          }
          if (action === "open") {
            json(response, 200, await service.openNative(id));
            return;
          }
          if (action === "send") {
            json(response, 202, service.acceptSend(id, b));
            return;
          }
          if (action === "stop") {
            json(
              response,
              200,
              await service.stop(
                id,
                z.boolean().default(true).parse(b.pause),
                z.string().uuid().optional().parse(b.requestId),
              ),
            );
            return;
          }
          if (action === "handoff") {
            json(response, 201, await service.handoff(id, b));
            return;
          }
          if (action === "grant") {
            const { projectId, ...input } = projectGrantSchema.parse(b);
            service.grantProject(id, projectId, input);
            json(response, 200, { status: "granted" });
            return;
          }
          if (action === "reconcile") {
            json(
              response,
              200,
              service.reconcile(
                id,
                z
                  .object({
                    commandId: z.string().uuid(),
                    resolution: z.enum(["confirmed", "rejected"]),
                    note: z.string().min(1).max(10000),
                    nativeSessionId: z.string().min(1).max(1000).optional(),
                    idleConfirmed: z.boolean(),
                  })
                  .strict()
                  .parse(b),
              ),
            );
            return;
          }
          if (action === "attach") {
            const input = z
              .object({
                nativeSessionId: z.string().min(1).max(1000),
                externalStopped: z.boolean(),
              })
              .strict()
              .parse(b);
            json(
              response,
              200,
              service.attachNative(id, input.nativeSessionId, input.externalStopped),
            );
            return;
          }
        }
      }
      const interaction = /^\/api\/interactions\/([^/]+)$/.exec(url.pathname);
      if (request.method === "POST" && interaction) {
        const b = await readBody(request);
        json(
          response,
          200,
          service.answerInteraction(
            decodeURIComponent(interaction[1]!),
            b.answer,
            z.string().uuid().parse(b.requestId),
          ),
        );
        return;
      }
      const inbox = /^\/api\/inbox\/([^/]+)\/read$/.exec(url.pathname);
      if (request.method === "POST" && inbox) {
        await readBody(request);
        const id = decodeURIComponent(inbox[1]!),
          item = service.store.record<Wire>("inbox", id);
        if (item) service.store.put("inbox", id, { ...item, read: true });
        json(response, 200, { status: "read" });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/pairing") {
        if (!local) throw new KodoError("UNAUTHORIZED", "配对码只能在本地桌面生成。");
        await readBody(request);
        const publicBase = options.publicOrigin
          ? options.publicOrigin.replace(/\/$/, "") + "/"
          : await options.relay?.enable();
        if (!publicBase)
          throw new KodoError("UNAVAILABLE", "此 Host 未启用自动远程连接，请更新并重启电脑端。");
        const invitation = pairing.create();
        json(response, 201, {
          ...invitation,
          url: publicBase + "#pair=" + invitation.code,
        });
        return;
      }
      const device = /^\/api\/devices\/([^/]+)$/.exec(url.pathname);
      if (request.method === "DELETE" && device) {
        if (!local) throw new KodoError("UNAUTHORIZED", "设备撤销需在桌面操作。");
        pairing.revoke(device[1]!);
        await service.delivery.revokeDevice(device[1]!);
        json(response, 200, { status: "revoked" });
        return;
      }
      if (
        url.pathname.startsWith("/api/") &&
        (await handleWorkRoutes(service, request, response, url, {
          local,
          deviceId: local ? "desktop" : pairing.deviceId(bearer ?? cookie ?? "")!,
          stillAuthorized: () => local || pairing.authenticate(bearer ?? cookie ?? ""),
          json,
          readBody,
        }))
      )
        return;
      if (request.method === "POST" && url.pathname === "/api/budgets") {
        const b = z
          .object({
            id: z.string().uuid().optional(),
            projectId: z.string().uuid().optional(),
            bindingId: z.string().uuid().optional(),
            usd: z.number().positive(),
          })
          .parse(await readBody(request));
        service.saveBudget(b.id ?? randomUUID(), b);
        json(response, 201, { status: "saved" });
        return;
      }
      if (url.pathname.startsWith("/api/") || request.method !== "GET")
        throw new KodoError("NOT_FOUND", "接口不存在。");
      const root = resolve(options.webRoot);
      let path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
      const rel = relative(root, path);
      if (rel.startsWith("..") || isAbsolute(rel)) throw new KodoError("NOT_FOUND", "文件不存在。");
      if (!extname(path)) path = resolve(root, "index.html");
      let content: Buffer;
      try {
        content = await readFile(path);
      } catch {
        throw new KodoError("NOT_FOUND", "界面尚未构建，请运行 npm run build。");
      }
      response.writeHead(200, {
        "Content-Type": mime[extname(path)] ?? "application/octet-stream",
      });
      response.end(content);
    } catch (error) {
      if (response.headersSent) {
        response.end();
        return;
      }
      const known = error instanceof KodoError,
        invalid = error instanceof ZodError,
        code = known ? error.code : invalid ? "INVALID_INPUT" : "INTERNAL_ERROR";
      const status =
        code === "NOT_FOUND"
          ? 404
          : code === "UNAUTHORIZED"
            ? 401
            : code === "CONFLICT"
              ? 409
              : code === "UNSUPPORTED" || code === "NOT_IMPLEMENTED"
                ? 501
                : code === "UNAVAILABLE"
                  ? 503
                  : known || invalid
                    ? 400
                    : 500;
      json(response, status, {
        error: {
          code,
          message: known
            ? error.message
            : invalid
              ? "请求字段无效，请检查输入。"
              : "Host 无法完成操作；运行结果可能需要对账。",
        },
      });
    }
  };
}
export function createHostServer(service: SessionService, options: HostHttpOptions) {
  return createServer(createHostHandler(service, options));
}
