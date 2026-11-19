import { KodoError, type HarnessId, type PermissionMode } from "@kodo/protocol";

const MODES: Partial<Record<HarnessId, [PermissionMode, string][]>> = {
  "deepseek-harness": [
    ["dsh:ask", "逐项审批"],
    ["dsh:allow", "自动允许"],
    ["dsh:deny", "拒绝需审批的操作"],
  ],
  codex: [
    ["read-only", "只读"],
    ["workspace-write", "工作区写入"],
    ["full-access", "完全访问"],
  ],
  "claude-code": [
    ["accept-edits", "允许编辑"],
    ["bypass-permissions", "跳过权限检查"],
  ],
  zcode: [
    ["plan", "计划"],
    ["build", "构建"],
    ["edit", "编辑"],
    ["yolo", "自动批准"],
    ["guarded", "受保护"],
  ],
  opencode: [
    ["opencode-ask", "每次询问"],
    ["opencode-deny", "拒绝"],
    ["opencode-allow", "允许"],
  ],
  kodo: [
    ["kodo-tools-read", "只读工具"],
    ["kodo-tools-none", "禁用工具"],
  ],
  pi: [
    ["kodo-tools-read", "只读工具"],
    ["kodo-tools-none", "禁用工具"],
  ],
  "kimi-code": [
    ["kimi:manual", "手动批准"],
    ["kimi:auto", "自动批准"],
    ["kimi:yolo", "跳过权限检查"],
  ],
};
export const dynamicPermissions = (id: HarnessId) =>
  ["gemini", "cursor", "grok-build"].includes(id);
export function permissionCatalog(id: HarnessId) {
  return (MODES[id] ?? []).map(([value, label]) => ({ value, label }));
}
export function validatePermissionMode(id: HarnessId, mode: PermissionMode | null) {
  if (!mode) return;
  if (permissionCatalog(id).some((o) => o.value === mode)) return;
  if ((dynamicPermissions(id) || id === "kimi-code") && mode.startsWith("acp:")) return;
  throw new KodoError("UNSUPPORTED", "此 Harness 不支持所选的会话权限模式。");
}
