import { createHash } from "node:crypto";
import { KodoError, type HarnessId, type SessionConfiguration } from "@kodo/protocol";
import type { SessionService } from "../session-service.js";
import { appSettings } from "../configuration/preferences.js";
import { dynamicPermissions, permissionCatalog } from "../configuration/permissions.js";
import { operationAccess, type ClientIdentity } from "./access.js";

export function harnessConfiguration(harnessId: HarnessId) {
  return {
    harnessId,
    permissions: {
      source: dynamicPermissions(harnessId) ? "runtime" : "host-catalog",
      options: permissionCatalog(harnessId),
      requiresConnection: dynamicPermissions(harnessId),
    },
  };
}
/** Resolve existing state only. Never connects a dormant session or launches model discovery. */
export async function sessionConfiguration(
  s: SessionService,
  id: string,
  identity: ClientIdentity,
): Promise<SessionConfiguration> {
  const session = s.store.session(id);
  if (s.store.record("deleted-session", id)) throw new KodoError("NOT_FOUND", "会话已删除。");
  const runtime =
    session.connectionState === "connected" ? await s.sessionPermissionOptions(id) : null;
  const legacyKimi =
    session.harnessId === "kimi-code" &&
    !!session.nativeSessionId &&
    !session.nativeSessionId.startsWith("session_");
  const dynamic = dynamicPermissions(session.harnessId) || legacyKimi;
  const remoteExecutor = !!session.executorId && session.executorId !== "local";
  const options = remoteExecutor
    ? []
    : (runtime?.options ?? (dynamic ? [] : permissionCatalog(session.harnessId)));
  const access = operationAccess(s, identity, "configuration.write");
  const reason =
    access.reason ??
    (remoteExecutor
      ? "远程执行器尚未提供权限选项查询。"
      : session.runState !== "idle"
        ? "会话正在运行，结束后再切换权限模式。"
        : dynamic && !runtime
          ? "会话未连接，尚未取得原生声明的权限模式。"
          : !options.length
            ? "此 Harness 尚未提供可切换的权限模式。"
            : null);
  const bindingAvailable =
    !session.bindingId ||
    (!session.bindingUnavailable &&
      !!s.store.record(
        "harness-binding-revision",
        `${session.bindingId}:${session.bindingRevision}`,
      ));
  const model = bindingAvailable
    ? await s.sessionModelOptions(id, false, false)
    : { effectiveModel: null, defaultModel: null, modelSupport: "binding-required", models: [] };
  const project = s.store.projects().find((p) => p.id === session.projectId);
  const payload = {
    schemaVersion: 1 as const,
    sessionId: id,
    harnessId: session.harnessId,
    settingsRevision: session.settingsRevision ?? 0,
    binding: {
      id: session.bindingId,
      revision: session.bindingRevision,
      source: "session-snapshot" as const,
      available: bindingAvailable,
    },
    model: {
      selected: session.model ?? null,
      observed: session.bindingId ? null : model.effectiveModel,
      effective: bindingAvailable
        ? (model.effectiveModel ?? session.model ?? model.defaultModel?.model ?? null)
        : null,
      source: !bindingAvailable
        ? ("unresolved" as const)
        : model.effectiveModel
          ? session.bindingId
            ? session.model
              ? ("session" as const)
              : ("binding" as const)
            : ("runtime" as const)
          : session.model
            ? ("session" as const)
            : model.defaultModel
              ? ("native-default" as const)
              : ("unresolved" as const),
      support: model.modelSupport,
      options: model.models,
    },
    permissions: {
      selected: session.permissionMode ?? null,
      observed: runtime ? runtime.current : null,
      current:
        remoteExecutor || (dynamic && !runtime)
          ? null
          : runtime
            ? runtime.current
            : (session.permissionMode ?? null),
      source: remoteExecutor
        ? ("unresolved" as const)
        : runtime
          ? ("runtime" as const)
          : dynamic
            ? ("unresolved" as const)
            : ("host-catalog" as const),
      options,
      canChange: access.available && !reason,
      reason,
    },
    // These are current defaults for NEW sessions; never reinterpret a pinned existing binding.
    newSessionDefaults: {
      host: s.bindingDefaults(),
      project: project?.bindingDefaults ?? null,
      harness: appSettings(s.store).harnessDefaults?.[session.harnessId] ?? null,
    },
  };
  return {
    ...payload,
    configurationRevision: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
  };
}
