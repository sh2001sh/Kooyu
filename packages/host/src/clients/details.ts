import {
  KodoError,
  type Artifact,
  type GoalDetail,
  type NotificationContext,
  type Session,
} from "@kodo/protocol";
import type { SessionService } from "../session-service.js";
import { nativeActions } from "../devices/native-client.js";
import { operationAccess, type ClientIdentity } from "./access.js";

function liveSession(service: SessionService, id: string): Session | null {
  if (service.store.record("deleted-session", id)) return null;
  try {
    const session = service.store.session(id);
    return session.projectId && service.store.record("removed-project", session.projectId)
      ? null
      : session;
  } catch (error) {
    if (error instanceof KodoError && error.code === "NOT_FOUND") return null;
    throw error;
  }
}
export function goalDetail(
  service: SessionService,
  id: string,
  identity: ClientIdentity,
): GoalDetail {
  const detail = service.goals.detail(id);
  const controller = liveSession(service, detail.goal.controllerSessionId);
  if (!controller) throw new KodoError("NOT_FOUND", "目标所属会话已删除。");
  const snapshot = service.snapshot();
  const sessions = detail.goal.sessionIds
    .map((id) => liveSession(service, id))
    .filter((s): s is Session => s !== null);
  const workspaces = snapshot.workspaces.filter((w) => detail.goal.workspaceIds.includes(w.id));
  const missingArtifactIds: string[] = [];
  // The goal links are authoritative: the general artifact list is capped at 500.
  const linkedArtifacts = [...detail.goal.artifactIds].reverse().flatMap((artifactId) => {
    try {
      const artifact = service.files.artifact(artifactId);
      if (artifact.goalId !== id) {
        missingArtifactIds.push(artifactId);
        return [];
      }
      return [artifact];
    } catch (error) {
      if (!(error instanceof KodoError) || error.code !== "NOT_FOUND") throw error;
      missingArtifactIds.push(artifactId);
      return [];
    }
  });
  const artifacts = linkedArtifacts.map((artifact: Artifact) => {
    try {
      const { file } = service.files.open(artifact.fileId);
      return { artifact, file, available: true, reason: null };
    } catch (error) {
      if (!(error instanceof KodoError) || !["NOT_FOUND", "UNAVAILABLE"].includes(error.code))
        throw error;
      return { artifact, file: null, available: false, reason: error.message };
    }
  });
  const ended = ["completed", "cancelled"].includes(detail.goal.status);
  const actions = Object.fromEntries(
    ["update", "accept", "request-changes", "cancel", "check"].map((action) => {
      const base = operationAccess(
        service,
        identity,
        action === "check" ? "goals.check" : action === "update" ? "goals.write" : "goals.review",
      );
      const invalid =
        ended ||
        (action === "request-changes" && detail.goal.status !== "awaiting-review") ||
        (action === "check" && !workspaces.some((w) => w.hostId === service.store.hostId));
      return [
        action,
        {
          ...base,
          available: base.available && !invalid,
          reason: base.reason ?? (invalid ? "目标当前状态不允许此操作。" : null),
        },
      ];
    }),
  );
  return {
    ...detail,
    controller,
    sessions,
    workspaces,
    artifacts,
    actions,
    missingArtifactIds,
    inbox: snapshot.inbox
      .filter(
        (i) => !i.resolved && [controller.id, ...detail.goal.sessionIds].includes(i.sessionId),
      )
      .map((i) => ({ ...i, actions: nativeActions(i) })),
    missingSessionIds: detail.goal.sessionIds.filter((id) => !sessions.some((s) => s.id === id)),
    missingWorkspaceIds: detail.goal.workspaceIds.filter(
      (id) => !workspaces.some((w) => w.id === id),
    ),
  };
}
/** Pure read: opening context neither marks read nor answers/accepts anything. */
export function notificationContext(
  service: SessionService,
  id: string,
  identity: ClientIdentity,
): NotificationContext {
  const notification = service.feed.get(id);
  const session = notification.sessionId ? liveSession(service, notification.sessionId) : null;
  const inbox =
    notification.inboxItemId && session
      ? (service
          .snapshot()
          .inbox.find((i) => i.id === notification.inboxItemId && i.sessionId === session.id) ??
        null)
      : null;
  let goal: GoalDetail | null = null;
  if (notification.goalId) {
    try {
      goal = goalDetail(service, notification.goalId, identity);
    } catch (error) {
      if (!(error instanceof KodoError) || error.code !== "NOT_FOUND") throw error;
    }
  }
  // Keep the original destination kind, even if deleted. Never silently navigate to a different task.
  const target = notification.inboxItemId
    ? { kind: "inbox" as const, id: notification.inboxItemId }
    : notification.goalId
      ? { kind: "goal" as const, id: notification.goalId }
      : notification.sessionId
        ? { kind: "session" as const, id: notification.sessionId }
        : null;
  const exists = target?.kind === "inbox" ? !!inbox : target?.kind === "goal" ? !!goal : !!session;
  const resolved =
    target?.kind === "inbox"
      ? inbox?.resolved
      : target?.kind === "goal" && goal
        ? ["completed", "cancelled"].includes(goal.goal.status)
        : false;
  return {
    notification,
    hostId: service.store.hostId,
    target,
    state: !exists ? "unavailable" : resolved ? "resolved" : "actionable",
    session,
    inbox: inbox ? { ...inbox, actions: nativeActions(inbox) } : null,
    goal,
  };
}
