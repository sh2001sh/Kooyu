import { KodoError, type GoalDetail, type WorkbenchOverview } from "@kodo/protocol";
import type { SessionService } from "../session-service.js";
import { operationAccess, type ClientIdentity } from "./access.js";

/** Read-only, project-scoped projection. Reading it never starts or resumes execution. */
export function workbenchOverview(
  s: SessionService,
  projectId: string | null,
  identity: ClientIdentity,
): WorkbenchOverview {
  const snapshot = s.snapshot();
  const project = projectId ? snapshot.projects.find((p) => p.id === projectId) : null;
  if (projectId && !project) throw new KodoError("NOT_FOUND", "项目已移除，请返回项目列表。");
  const allSessions = new Map(snapshot.sessions.map((session) => [session.id, session]));
  const sessions = snapshot.sessions.filter(
    (session) => !projectId || session.projectId === projectId,
  );
  const ids = new Set(sessions.map((session) => session.id));
  const goals = s.goals
    .list({ includeClosed: true })
    .filter(
      (goal) =>
        allSessions.has(goal.controllerSessionId) && (!projectId || goal.projectId === projectId),
    );
  const goalIds = new Set(goals.map((goal) => goal.id));
  const artifacts: GoalDetail["artifacts"] = s.files
    .artifacts(projectId ? { context: { sessionIds: [...ids], goalIds: [...goalIds] } } : {})
    .filter((artifact) => {
      // Deleted source conversations must not reappear via their old file records.
      if (artifact.sessionId && !allSessions.has(artifact.sessionId)) return false;
      if (artifact.goalId && !goalIds.has(artifact.goalId)) return false;
      return (
        (!artifact.sessionId || ids.has(artifact.sessionId)) &&
        (!projectId || !!artifact.sessionId || (!!artifact.goalId && goalIds.has(artifact.goalId)))
      );
    })
    .map((artifact) => {
      try {
        return {
          artifact,
          file: s.files.open(artifact.fileId).file,
          available: true,
          reason: null,
        };
      } catch (error) {
        if (!(error instanceof KodoError) || !["NOT_FOUND", "UNAVAILABLE"].includes(error.code))
          throw error;
        return { artifact, file: null, available: false, reason: error.message };
      }
    });
  const plans = s.automations.definitions.all().filter((plan) => ids.has(plan.controllerSessionId));
  const planIds = new Set(plans.map((plan) => plan.id));
  const activations = s.automations.activations
    .all()
    .filter((run) => planIds.has(run.automationId))
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
    .slice(0, 200);
  const memories = [
    ...new Map(
      (projectId ? [projectId] : [null, ...snapshot.projects.map((p) => p.id)])
        .flatMap((id) => s.memory.list(id, true))
        .map((memory) => [memory.id, memory]),
    ).values(),
  ];
  return {
    hostId: snapshot.hostId,
    projectId,
    project: project ?? null,
    projects: snapshot.projects,
    sessions,
    goals,
    artifacts,
    plans,
    activations,
    memories,
    workspaces: snapshot.workspaces.filter(
      (workspace) => !projectId || workspace.projectId === projectId,
    ),
    inbox: snapshot.inbox.filter((item) => !item.resolved && ids.has(item.sessionId)),
    harnesses: snapshot.harnesses,
    actions: Object.fromEntries(
      ["automations.write", "automations.run", "memory.write"].map((key) => [
        key,
        operationAccess(s, identity, key),
      ]),
    ),
    coverage: { artifactsLimit: 500, activationLimit: 200 },
  };
}
