import { createHash } from "node:crypto";
import { z, ZodError } from "zod";
import {
  clientMutationSchema,
  KodoError,
  permissionModeSchema,
  type ClientMutation,
  type ClientMutationReceipt,
} from "@kodo/protocol";
import type { SessionService } from "../session-service.js";
import { saveAppSettings } from "../configuration/preferences.js";
import { requireOperation, type ClientIdentity } from "./access.js";

interface Stored {
  fingerprint: string;
  process: string;
  receipt: ClientMutationReceipt;
}
const canonical = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
          .join(",")}}`
      : JSON.stringify(v);
export const sessionMetadataSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    archived: z.boolean().optional(),
    pinned: z.boolean().optional(),
    unread: z.boolean().optional(),
    projectId: z.string().uuid().nullable().optional(),
    workspaceId: z.string().uuid().nullable().optional(),
    permissionMode: permissionModeSchema.nullable().optional(),
  })
  .strict();

/** A closed dispatcher, never an HTTP proxy. Native input commands keep their own receipts. */
export class ClientOperations {
  private readonly running = new Map<string, Promise<ClientMutationReceipt>>();
  constructor(private readonly service: SessionService) {}
  private key(identity: ClientIdentity, requestId: string) {
    return `${identity.deviceId}:${requestId}`;
  }
  private record(identity: ClientIdentity, requestId: string) {
    return this.service.store.record<Stored>("client-operation", this.key(identity, requestId));
  }
  get(identity: ClientIdentity, requestId: string): ClientMutationReceipt {
    z.string().uuid().parse(requestId);
    const entry = this.record(identity, requestId);
    if (!entry) throw new KodoError("NOT_FOUND", "此设备没有该操作回执。");
    if (
      entry.receipt.status === "pending" &&
      entry.process !== this.service.lifecycle.status().processIdentity
    ) {
      entry.receipt = {
        ...entry.receipt,
        status: "unknown",
        updatedAt: new Date().toISOString(),
        error: { code: "CONFLICT", message: "Host 已重启，请核对业务对象；此请求不会自动重放。" },
      };
      this.service.store.put("client-operation", this.key(identity, requestId), entry);
    }
    return entry.receipt;
  }
  async execute(identity: ClientIdentity, value: unknown): Promise<ClientMutationReceipt> {
    const input = clientMutationSchema.parse(value);
    requireOperation(this.service, identity, "configuration.write");
    const fingerprint = createHash("sha256").update(canonical(input)).digest("hex");
    const key = this.key(identity, input.requestId);
    const previous = this.record(identity, input.requestId);
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new KodoError("CONFLICT", "请求 ID 已用于不同操作。");
      return this.running.get(key) ?? this.get(identity, input.requestId);
    }
    const task = this.dispatch(input, identity); // Validate the whitelist before creating a receipt.
    const now = new Date().toISOString();
    const entry: Stored = {
      fingerprint,
      process: this.service.lifecycle.status().processIdentity,
      receipt: {
        requestId: input.requestId,
        deviceId: identity.deviceId,
        method: input.method,
        path: input.path,
        status: "pending",
        retryable: false,
        createdAt: now,
        updatedAt: now,
      },
    };
    this.service.store.put("client-operation", key, entry);
    const save = (patch: Partial<ClientMutationReceipt>) => {
      entry.receipt = { ...entry.receipt, ...patch, updatedAt: new Date().toISOString() };
      if (entry.receipt.result === undefined) delete entry.receipt.result;
      this.service.store.put("client-operation", key, entry);
      return entry.receipt;
    };
    const run = async () => {
      try {
        if (task.atomic)
          return this.service.store.transaction(() =>
            save({ status: "confirmed", result: task.run() }),
          );
        return save({ status: "confirmed", result: await task.run() });
      } catch (error) {
        // Post-commit listeners may fail after a successful transaction. The durable
        // receipt remains authoritative; never misreport committed changes as rolled back.
        if (task.atomic) {
          const committed = this.record(identity, input.requestId)?.receipt;
          if (committed?.status === "confirmed") return committed;
        }
        const known = error instanceof KodoError || error instanceof ZodError;
        // External side effects cannot be proven rolled back, even when an adapter throws a known error.
        return save({
          status: task.atomic && known ? "failed" : "unknown",
          result: undefined,
          error: {
            code:
              error instanceof KodoError
                ? error.code
                : error instanceof ZodError
                  ? "INVALID_INPUT"
                  : "INTERNAL_ERROR",
            message:
              error instanceof KodoError
                ? error.message
                : error instanceof ZodError
                  ? "操作参数无效。"
                  : "操作结果未确认，请核对业务对象。",
          },
        });
      }
    };
    const promise = run();
    this.running.set(key, promise);
    try {
      return await promise;
    } finally {
      this.running.delete(key);
    }
  }
  private dispatch(
    input: ClientMutation,
    identity: ClientIdentity,
  ): { atomic: boolean; run: () => unknown } {
    const { method, path } = input,
      body = input.body ?? {},
      s = this.service;
    const review = /^\/api\/goals\/([0-9a-f-]+)\/review$/.exec(path);
    if (review && method === "POST") {
      requireOperation(s, identity, "goals.review");
      const id = z.string().uuid().parse(review[1]);
      return {
        atomic: false,
        run: () => s.goals.review(id, { ...body, requestId: input.requestId }),
      };
    }
    if (method === "POST" && path === "/api/automations") {
      requireOperation(s, identity, "automations.write");
      return {
        atomic: true,
        run: () => s.automations.save({ ...body, requestId: input.requestId }),
      };
    }
    const automation = /^\/api\/automations\/([0-9a-f-]+)(?:\/(pause|run))?$/.exec(path);
    if (automation) {
      const id = z.string().uuid().parse(automation[1]);
      requireOperation(
        s,
        identity,
        automation[2] === "run" ? "automations.run" : "automations.write",
      );
      if (method === "PATCH" && !automation[2])
        return {
          atomic: true,
          run: () => s.automations.save({ ...body, requestId: input.requestId }, id),
        };
      if (method === "POST" && automation[2] === "pause") {
        const revision = z.number().int().positive().parse(body.expectedRevision);
        return { atomic: true, run: () => s.automations.pause(id, revision) };
      }
      if (method === "POST" && automation[2] === "run")
        return { atomic: false, run: () => s.automations.run(id, input.requestId) };
    }
    if (method === "PATCH" && path === "/api/memory/settings") {
      requireOperation(s, identity, "memory.write");
      return {
        atomic: true,
        run: () => s.memory.saveSettings({ ...body, requestId: input.requestId }),
      };
    }
    const memory = /^\/api\/memory(?:\/([0-9a-f-]+))?$/.exec(path);
    if (memory && ((method === "POST" && !memory[1]) || (method === "PATCH" && memory[1]))) {
      requireOperation(s, identity, "memory.write");
      const id = memory[1] ? z.string().uuid().parse(memory[1]) : undefined;
      return {
        atomic: true,
        run: () => s.memory.save({ ...body, requestId: input.requestId }, "user", undefined, id),
      };
    }
    const project = /^\/api\/projects\/([0-9a-f-]+)(?:\?sessions=(keep|delete))?$/.exec(path);
    if (project) {
      const id = z.string().uuid().parse(project[1]);
      if (method === "PATCH" && !project[2])
        return { atomic: true, run: () => s.updateProject(id, body) };
      if (method === "DELETE")
        return {
          atomic: false,
          run: () => s.deleteProject(id, project[2] === "delete" ? "delete" : "keep"),
        };
    }
    if (method === "POST" && path === "/api/projects")
      return { atomic: true, run: () => s.createProject(body) };
    if (method === "POST" && path === "/api/sessions")
      return { atomic: true, run: () => s.createDraft(body) };
    if (method === "POST" && path === "/api/workspaces") {
      const p = z
        .object({ projectId: z.string().uuid().nullable(), rootPath: z.string().min(1).max(4096) })
        .strict()
        .parse(body);
      return { atomic: true, run: () => s.addWorkspace(p.projectId, p.rootPath) };
    }
    const session = /^\/api\/sessions\/([0-9a-f-]+)$/.exec(path);
    if (method === "PATCH" && session) {
      const id = z.string().uuid().parse(session[1]),
        p = sessionMetadataSchema.parse(body);
      return p.permissionMode === undefined
        ? { atomic: true, run: () => s.updateSession(id, p) }
        : { atomic: false, run: () => s.updatePermissionMode(id, p) };
    }
    if (method === "PATCH" && path === "/api/app-settings")
      return { atomic: true, run: () => saveAppSettings(s.store, body) };
    if (method === "PATCH" && path === "/api/binding-defaults")
      return { atomic: true, run: () => s.updateBindingDefaults(body) };
    const defaults = /^\/api\/projects\/([0-9a-f-]+)\/binding-defaults$/.exec(path);
    if (method === "PATCH" && defaults) {
      const id = z.string().uuid().parse(defaults[1]);
      return { atomic: true, run: () => s.updateProjectDefaults(id, body) };
    }
    throw new KodoError("UNSUPPORTED", "此路径不支持管理操作回执，请使用对应的专用接口。");
  }
}
