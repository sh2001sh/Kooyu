import {
  KodoError,
  type CreateSession,
  type Session,
  type Supervision,
  type Workspace,
} from "@kodo/protocol";

export function validateDraft(
  input: CreateSession,
  workspace: Workspace | undefined,
  hostId: string,
): void {
  if ((input.kind === "supervisor") !== (input.harnessId === "kodo")) {
    throw new KodoError("INVALID_INPUT", "主对话使用 Kooyu；pi 等原生 harness 请创建直接对话。");
  }
  if (
    input.model &&
    ["opencode", "zcode", "deepseek-harness"].includes(input.harnessId) &&
    !input.model.includes("/")
  ) {
    throw new KodoError("INVALID_INPUT", "此 harness 的模型需要 provider/model 格式。");
  }
  if (input.workspaceId && !workspace) throw new KodoError("NOT_FOUND", "工作位置不存在。");
  if (workspace && workspace.hostId !== hostId) {
    throw new KodoError("INVALID_INPUT", "工作位置属于另一主机。");
  }
}

/** Pure invariant check; this does not activate monitoring or claim an execution lease. */
export function validateSupervision(
  controller: Session,
  target: Session,
  mode: Supervision["mode"],
  existing: Supervision[],
): void {
  if (
    controller.kind !== "supervisor" ||
    controller.harnessId !== "kodo" ||
    target.kind !== "direct"
  ) {
    throw new KodoError("INVALID_INPUT", "主对话只能管理普通执行会话。");
  }
  if (controller.scope === "project" && controller.projectId !== target.projectId) {
    throw new KodoError("INVALID_INPUT", "项目主对话不能管理其他项目的会话。");
  }
  if (
    mode === "continue" &&
    existing.some(
      (link) =>
        link.targetSessionId === target.id &&
        link.mode === "continue" &&
        link.state === "active" &&
        link.controllerSessionId !== controller.id,
    )
  ) {
    throw new KodoError("CONFLICT", "该会话已有自动续聊控制者，需要先交接。");
  }
}
