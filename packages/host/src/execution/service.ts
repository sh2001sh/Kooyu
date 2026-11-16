import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { KodoError, type Session, type RuntimeEvent } from "@kodo/protocol";
import type { SessionService } from "../session-service.js";
import type { NativeRuntime } from "../harnesses/adapter.js";
import { digest } from "./actions.js";
interface Executor {
  id: string;
  hostId: string;
  name: string;
  kind: "remote-worker";
  revision: number;
  enabled: boolean;
  tokenDigest: string;
  lastSeenAt: string | null;
  capabilities: string[];
  platform: string | null;
}
interface Task {
  id: string;
  executorId: string;
  sessionId: string;
  operation: string;
  arguments: Record<string, unknown>;
  fingerprint: string;
  status: "accepted" | "dispatched" | "confirmed" | "unknown";
  result?: any;
  error?: string;
  createdAt: string;
}
const hash = (x: string) => createHash("sha256").update(x).digest("hex");
export class ExecutorService {
  private stopped = false;
  dispose() {
    this.stopped = true;
  }
  constructor(private readonly service: SessionService) {}
  async inspect(session: Session, operation: "read" | "models" | "list" | "quota") {
    this.validateSession(session);
    return this.result(this.submit(session.executorId!, session.id, operation, {}));
  }
  list() {
    return [
      {
        id: "local",
        hostId: this.service.store.hostId,
        name: "此 Host",
        kind: "local",
        capabilities: ["files", "harness"],
        status: "online",
      },
      ...this.service.store.records<Executor>("executor").map(({ tokenDigest: _t, ...e }) => ({
        ...e,
        status:
          e.enabled && e.lastSeenAt && Date.now() - Date.parse(e.lastSeenAt) < 15000
            ? "online"
            : "offline",
      })),
    ];
  }
  requireAvailable(id: string) {
    const e = this.get(id);
    if (!e.enabled || !e.lastSeenAt || Date.now() - Date.parse(e.lastSeenAt) > 15000)
      throw new KodoError("UNAVAILABLE", "执行节点离线，目标已阻塞；未切换执行位置。");
    return e;
  }
  enroll(name: string) {
    const token = randomBytes(32).toString("base64url"),
      e: Executor = {
        id: randomUUID(),
        hostId: randomUUID(),
        name: z.string().min(1).max(100).parse(name),
        kind: "remote-worker",
        revision: 1,
        enabled: true,
        tokenDigest: hash(token),
        lastSeenAt: null,
        capabilities: [],
        platform: null,
      };
    this.service.store.put("executor", e.id, e);
    return { ...e, tokenDigest: undefined, token };
  }
  private get(id: string) {
    const e = this.service.store.record<Executor>("executor", id);
    if (!e) throw new KodoError("NOT_FOUND", "执行节点不存在。");
    return e;
  }
  revoke(id: string) {
    const e = this.get(id);
    this.service.store.put("executor", id, { ...e, enabled: false, revision: e.revision + 1 });
    return { id, enabled: false };
  }
  workspace(executorId: string, projectId: string | null, rootPath: string) {
    const e = this.get(executorId);
    if (!e.enabled) throw new KodoError("UNAUTHORIZED", "节点已撤销。");
    if (projectId && !this.service.store.projects().some((p) => p.id === projectId))
      throw new KodoError("NOT_FOUND", "项目不存在。");
    if (!rootPath || rootPath.length > 4000) throw new KodoError("INVALID_INPUT", "节点路径无效。");
    const w = { id: randomUUID(), projectId, hostId: e.hostId, rootPath };
    this.service.store.db
      .prepare("INSERT INTO workspaces VALUES (?,?,?,?)")
      .run(w.id, w.projectId, w.hostId, w.rootPath);
    return w;
  }
  validateSession(s: Pick<Session, "executorId" | "workspaceId" | "bindingId" | "harnessId">) {
    if (!s.executorId || s.executorId === "local") return;
    const e = this.get(s.executorId),
      w = this.service.store.workspaces().find((w) => w.id === s.workspaceId);
    if (!w || w.hostId !== e.hostId)
      throw new KodoError("INVALID_INPUT", "远程会话必须选择同一节点的目录。");
    if (s.bindingId)
      throw new KodoError(
        "UNSUPPORTED",
        "远程会话使用节点本地的原生凭据，不能转发 Host 模型绑定。",
      );
    if (s.harnessId === "kodo")
      throw new KodoError("UNSUPPORTED", "Kooyu 控制会话保留在 Host；将原生执行会话绑定到节点。");
  }
  private submit(
    executorId: string,
    sessionId: string,
    operation: string,
    args: Record<string, unknown>,
    stableId: string = randomUUID(),
  ): Task {
    const id = hash(executorId + ":" + stableId),
      fingerprint = digest({ operation, args }),
      prior = this.service.store.record<Task>("worker-task", id);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new KodoError("CONFLICT", "节点动作 ID 冲突。");
      return prior;
    }
    if (!["cancel", "answer", "read", "models", "list", "quota", "close"].includes(operation))
      this.service.lifecycle.assertOpen();
    const e = this.get(executorId);
    if (!e.enabled || !e.lastSeenAt || Date.now() - Date.parse(e.lastSeenAt) > 15000)
      throw new KodoError("UNAVAILABLE", "执行节点离线；未切换执行位置。");
    const task: Task = {
      id,
      executorId,
      sessionId,
      operation,
      arguments: args,
      fingerprint,
      status: "accepted",
      createdAt: new Date().toISOString(),
    };
    this.service.store.put("worker-task", id, task);
    return task;
  }
  private async result(task: Task, timeout = 120000) {
    const until = Date.now() + timeout;
    for (;;) {
      if (this.stopped) throw new KodoError("UNAVAILABLE", "Host 已关闭，节点动作保留待核对。");
      const fresh = this.service.store.record<Task>("worker-task", task.id)!;
      if (fresh.status === "confirmed") return fresh.result;
      if (fresh.status === "unknown") throw new Error("节点执行结果未知，请核对节点历史。");
      if (Date.now() >= until) throw new Error("等待节点回执超时，任务保留并等待对账。");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  async connect(session: Session): Promise<NativeRuntime> {
    this.validateSession(session);
    const e = this.get(session.executorId!),
      w = this.service.store.workspaces().find((w) => w.id === session.workspaceId)!;
    if (!e.capabilities.includes("harness:" + session.harnessId))
      throw new KodoError("UNSUPPORTED", "节点未声明该 Harness。");
    const opened = await this.result(
      this.submit(
        e.id,
        session.id,
        "open",
        {
          hostSessionId: session.id,
          harnessId: session.harnessId,
          rootPath: w.rootPath,
          title: session.title,
          model: session.model,
          reasoning: session.reasoning,
          permissionMode: session.permissionMode,
        },
        "open:" + session.id,
      ),
    );
    return {
      nativeSessionId: String(opened.nativeSessionId),
      send: async (_text, commandId) => {
        const c = this.service.store.command(commandId)!;
        return this.result(
          this.submit(
            e.id,
            session.id,
            "send",
            {
              commandId,
              text: c.body.text,
              mode: c.body.mode,
              settings: c.body.settings,
              attachments: c.body.attachments ?? [],
            },
            commandId,
          ),
          24 * 3600000,
        );
      },
      cancel: async () => {
        await this.result(this.submit(e.id, session.id, "cancel", {}));
      },
      read: async () => this.result(this.submit(e.id, session.id, "read", {})),
      models: async () => this.result(this.submit(e.id, session.id, "models", {})),
      supportsImages: () => false,
      close: async () => {},
    };
  }
  async handle(request: IncomingMessage, response: ServerResponse, id: string, action: string) {
    const e = this.get(id),
      token = request.headers.authorization?.replace(/^Bearer /, "") ?? "",
      actual = hash(token);
    if (!e.enabled || !timingSafeEqual(Buffer.from(actual), Buffer.from(e.tokenDigest)))
      throw new KodoError("UNAUTHORIZED", "节点凭据无效。");
    const json = (status: number, v: unknown) => {
      response.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify(v));
    };
    if (action === "file" && request.method === "GET") {
      const u = new URL(request.url!, "http://node"),
        fileId = z.string().uuid().parse(u.searchParams.get("id"));
      const permitted = this.service.store
        .records<Task>("worker-task")
        .some(
          (t) =>
            t.executorId === id &&
            t.operation === "send" &&
            (t.arguments.attachments as { fileId: string }[])?.some((f) => f.fileId === fileId),
        );
      if (!permitted) throw new KodoError("UNAUTHORIZED", "文件未授权给该节点。");
      const opened = this.service.files.open(fileId);
      response.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": opened.size,
      });
      opened.stream().pipe(response);
      return;
    }
    if (request.method !== "POST") throw new KodoError("INVALID_INPUT", "节点请求需要 POST。");
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      size += (chunk as Buffer).length;
      if (size > 2 * 1024 * 1024) throw new KodoError("INVALID_INPUT", "节点请求过大。");
      chunks.push(chunk as Buffer);
    }
    let p: any;
    try {
      p = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!p || Array.isArray(p) || typeof p !== "object") throw new Error();
    } catch {
      throw new KodoError("INVALID_INPUT", "节点请求需要 JSON 对象。");
    }
    if (action === "poll") {
      const capabilities = z.array(z.string().max(100)).max(100).parse(p.capabilities),
        platform = z.string().max(100).parse(p.platform);
      this.service.store.put("executor", id, {
        ...e,
        lastSeenAt: new Date().toISOString(),
        capabilities,
        platform,
      });
      for (const incoming of z
        .array(
          z.object({
            sessionId: z.string().uuid(),
            event: z.object({
              id: z.string().max(300),
              type: z.string(),
              payload: z.unknown(),
              nativeRunId: z.string().nullable().optional(),
            }),
          }),
        )
        .max(100)
        .parse(p.events ?? [])) {
        const session = this.service.store.session(incoming.sessionId);
        if (session.executorId !== id) throw new KodoError("UNAUTHORIZED", "会话不属于该节点。");
        const event = incoming.event,
          allowed = [
            "message",
            "text-delta",
            "tool",
            "state",
            "turn-ended",
            "settled",
            "usage",
            "error",
            "interaction",
            "disconnected",
          ];
        if (!allowed.includes(event.type)) continue;
        const payload = (event.payload ?? {}) as Record<string, any>;
        if (event.type === "message" && payload.role === "user") continue;
        if (event.type === "interaction") {
          const requestId = "worker:" + event.id;
          if (!this.service.store.hasEvent(session.id, "remote-interaction:" + event.id)) {
            this.service.store.rememberEvent(session.id, "remote-interaction:" + event.id);
            this.service
              .remoteInteraction(session.id, requestId, payload)
              .then((answer) => {
                this.submit(
                  id,
                  session.id,
                  "answer",
                  { requestId: payload.requestId, answer },
                  "answer:" + requestId,
                );
              })
              .catch(() => {});
          }
        } else
          this.service.ingest(
            session.id,
            event.type as RuntimeEvent["type"],
            { ...payload, remoteExecutorId: id },
            "worker:" + event.id,
            event.nativeRunId ?? null,
          );
      }
      const tasks = this.service.store
        .records<Task>("worker-task")
        .filter((t) => t.executorId === id && ["accepted", "dispatched"].includes(t.status))
        .filter(
          (t) =>
            !this.service.lifecycle.status().frozen ||
            ["answer", "cancel", "read", "models", "list", "quota"].includes(t.operation),
        )
        .slice(0, 20);
      for (const t of tasks) {
        if (t.operation === "send") {
          const c = this.service.store.command(String(t.arguments.commandId));
          if (
            !c ||
            c.status === "cancelled" ||
            c.generation !== this.service.store.session(c.sessionId).ownerEpoch
          ) {
            this.service.store.put("worker-task", t.id, {
              ...t,
              status: "unknown",
              error: "派发代次已失效",
            });
            continue;
          }
        }
        this.service.store.put("worker-task", t.id, { ...t, status: "dispatched" });
      }
      json(200, {
        tasks: tasks.filter(
          (t) => this.service.store.record<Task>("worker-task", t.id)?.status === "dispatched",
        ),
        serverTime: new Date().toISOString(),
      });
      return;
    }
    if (action === "result") {
      const task = this.service.store.record<Task>("worker-task", z.string().parse(p.id));
      if (!task || task.executorId !== id) throw new KodoError("NOT_FOUND", "节点动作不存在。");
      const status = z.enum(["confirmed", "unknown"]).parse(p.status);
      if (["confirmed", "unknown"].includes(task.status)) {
        if (digest(task.result ?? null) !== digest(p.result ?? null) || task.status !== status)
          throw new KodoError("CONFLICT", "节点动作结果冲突。");
        json(200, { accepted: true });
        return;
      }
      this.service.store.put("worker-task", task.id, { ...task, status, result: p.result ?? null });
      json(200, { accepted: true });
      return;
    }
    throw new KodoError("NOT_FOUND", "节点接口不存在。");
  }
}
