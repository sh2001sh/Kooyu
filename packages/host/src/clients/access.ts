import {
  KodoError,
  PROTOCOL_VERSION,
  deviceAccessSchema,
  delegatedOperations,
  type ClientCapabilities,
  type ClientOperationAccess,
  type DeviceAccess,
} from "@kodo/protocol";
import type { SessionService } from "../session-service.js";
import { MAX_CHUNK } from "../files/store.js";

export interface ClientIdentity {
  local: boolean;
  deviceId: string;
}
export function deviceAccess(service: SessionService, deviceId: string): DeviceAccess {
  return (
    service.store.record<DeviceAccess>("client-access", deviceId) ?? {
      deviceId,
      revision: 0,
      operations: [],
    }
  );
}
export function saveDeviceAccess(
  service: SessionService,
  deviceId: string,
  value: unknown,
): DeviceAccess {
  const p = deviceAccessSchema.parse(value);
  return service.store.transaction(() => {
    const device = service.store.record<{ expiresAt: string }>("device-public", deviceId);
    if (
      !device ||
      !Number.isFinite(Date.parse(device.expiresAt)) ||
      Date.parse(device.expiresAt) <= Date.now()
    )
      throw new KodoError("NOT_FOUND", "设备不存在或授权已失效。");
    const previous = deviceAccess(service, deviceId);
    if (previous.revision !== p.expectedRevision)
      throw new KodoError("CONFLICT", "设备权限已改变，请刷新后重试。");
    const next: DeviceAccess = {
      deviceId,
      revision: previous.revision + 1,
      operations: [...new Set(p.operations)],
    };
    service.store.put("client-access", deviceId, next);
    return next;
  });
}
const LOCAL_ONLY = new Set([
  "mcp.local.manage",
  "im.manage",
  "host.admin",
  "engines.manage",
  "skills.manage",
  "credentials.manage",
  "devices.manage",
  "applications.manage",
  "grants.manage",
  "web.configure",
  "browser.control",
  "executors.manage",
]);
const PAIRED = new Set([
  "preview.read",
  "workspaces.git.local",
  "goals.read",
  "goals.write",
  "goals.review",
  "files.read",
  "files.upload",
  "notifications.read",
  "notifications.ack",
  "configuration.read",
  "configuration.write",
  "automations.read",
  "automations.write",
  "automations.run",
  "memory.read",
  "memory.write",
  "applications.read",
  "browser.read",
  "executors.read",
]);
export function operationAccess(
  service: SessionService,
  identity: ClientIdentity,
  operation: string,
): ClientOperationAccess {
  const delegated = delegatedOperations.find((key) => key === operation);
  const requirement =
    !LOCAL_ONLY.has(operation) && !PAIRED.has(operation) && !delegated
      ? "unsupported"
      : LOCAL_ONLY.has(operation)
        ? "local-administrator"
        : delegated
          ? "explicit-delegation"
          : "paired-device";
  const supported = requirement !== "unsupported";
  const allowed =
    supported &&
    (identity.local ||
      requirement === "paired-device" ||
      (delegated !== undefined &&
        deviceAccess(service, identity.deviceId).operations.includes(delegated)));
  const frozen =
    service.lifecycle.status().frozen &&
    ["goals.check", "automations.run", "browser.control"].includes(operation);
  const missingBrowser = operation === "browser.control" && !service.browser.status().available;
  const reason = !supported
    ? "此 Host 不支持此操作。"
    : !allowed
      ? requirement === "explicit-delegation"
        ? "需由 Host 本机管理员显式授予此设备执行该操作的权限。"
        : "仅允许 Host 本机管理员操作。"
      : frozen
        ? "Host 已冻结新执行。"
        : missingBrowser
          ? "Host 未安装可用的 Chromium。"
          : null;
  return {
    supported,
    allowed,
    available: allowed && !frozen && !missingBrowser,
    requirement,
    reason,
  };
}
export function requireOperation(
  service: SessionService,
  identity: ClientIdentity,
  operation: string,
) {
  const access = operationAccess(service, identity, operation);
  if (!access.allowed) throw new KodoError("UNAUTHORIZED", access.reason!);
  if (!access.available) throw new KodoError("UNAVAILABLE", access.reason!);
}
export function clientCapabilities(
  service: SessionService,
  identity: ClientIdentity,
): ClientCapabilities {
  const operations = Object.fromEntries(
    [
      "goals.read",
      "goals.write",
      "goals.review",
      ...delegatedOperations,
      "workspaces.git.local",
      "preview.read",
      "mcp.local.manage",
      "im.manage",
      "files.read",
      "files.upload",
      "notifications.read",
      "notifications.ack",
      "configuration.read",
      "configuration.write",
      "automations.read",
      "automations.write",
      "automations.run",
      "memory.read",
      "memory.write",
      "applications.read",
      "applications.manage",
      "grants.manage",
      "web.configure",
      "browser.read",
      "browser.control",
      "executors.read",
      "executors.manage",
      "host.admin",
      "engines.manage",
      "skills.manage",
      "credentials.manage",
      "devices.manage",
      "desktop.control",
    ].map((key) => [key, operationAccess(service, identity, key)]),
  );
  return {
    protocolVersion: PROTOCOL_VERSION,
    contractVersion: 1,
    hostId: service.store.hostId,
    localAdministrator: identity.local,
    accessRevision: deviceAccess(service, identity.deviceId).revision,
    capabilities: {
      goals: 1,
      managedFiles: 1,
      notifications: 1,
      apns: 1,
      automations: 1,
      webhooks: 1,
      applications: 1,
      memory: 1,
      actionReceipts: 1,
      quiesce: 1,
      browser: 1,
      clientOperations: 1,
      nativeSync: 1,
      goalDetails: 1,
      notificationContext: 1,
      configurationResolution: 1,
      fileRanges: 1,
    },
    unsupported: ["desktop-control"],
    operations,
    limits: {
      maxUploadBytes: service.files.limit,
      maxChunkBytes: MAX_CHUNK,
      syncHistoryEntries: 32,
    },
  };
}
