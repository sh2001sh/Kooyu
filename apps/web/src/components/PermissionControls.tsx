import { useEffect, useState } from "react";
import { Check, ChevronDown, Shield } from "lucide-react";
import type { HarnessId, PermissionMode } from "@kodo/protocol";
import { api } from "../lib/host-client";
import { IosPopover } from "./IosPopover";

const codexModes: { value: PermissionMode | null; label: string; detail: string }[] = [
  { value: null, label: "原生默认", detail: "审批与沙箱均遵循 Codex 原生配置" },
  { value: "read-only", label: "只读", detail: "禁止写入；需要变更时请求审批" },
  { value: "workspace-write", label: "工作区写入", detail: "可写当前工作区；越界操作请求审批" },
  { value: "full-access", label: "完全访问", detail: "不启用 Codex 沙箱，也不请求操作审批" },
];
const claudeModes: { value: PermissionMode | null; label: string; detail: string }[] = [
  { value: null, label: "原生默认", detail: "按 Claude Code 原生规则逐项处理权限" },
  {
    value: "accept-edits",
    label: "自动接受编辑",
    detail: "自动批准文件编辑；其他操作仍按原生规则处理",
  },
  {
    value: "bypass-permissions",
    label: "跳过审批",
    detail: "关闭 Claude Code 的工具审批；不提供文件系统沙箱",
  },
];
const zcodeModes: { value: PermissionMode | null; label: string; detail: string }[] = [
  { value: "plan", label: "Plan", detail: "ZCode 原生计划模式" },
  { value: "build", label: "Build", detail: "ZCode 原生构建模式" },
  { value: "edit", label: "Edit", detail: "ZCode 原生编辑模式" },
  { value: "guarded", label: "Guarded", detail: "ZCode 原生受控模式" },
  { value: "yolo", label: "YOLO", detail: "ZCode 原生自动授权模式" },
];
const openCodeModes: { value: PermissionMode | null; label: string; detail: string }[] = [
  { value: null, label: "原生代理规则", detail: "沿用 OpenCode 代理的工具审批规则" },
  {
    value: "opencode-ask",
    label: "逐项询问",
    detail: "所有工具调用逐项请求审批；不提供文件系统沙箱",
  },
  { value: "opencode-deny", label: "禁用工具", detail: "拒绝所有工具调用；不提供文件系统沙箱" },
  { value: "opencode-allow", label: "自动允许", detail: "允许所有工具调用；不提供文件系统沙箱" },
];
const kodoToolModes: { value: PermissionMode | null; label: string; detail: string }[] = [
  { value: null, label: "默认工具", detail: "使用当前会话已装配的工具" },
  {
    value: "kodo-tools-read",
    label: "仅阅读工具",
    detail: "仅保留可用的 read 工具；不提供系统沙箱",
  },
  { value: "kodo-tools-none", label: "禁用工具", detail: "不向模型提供工具；不提供系统沙箱" },
];
const kimiModes: { value: PermissionMode | null; label: string; detail: string }[] = [
  { value: "kimi:manual", label: "逐项审批", detail: "Kimi 原生手动审批模式" },
  { value: "kimi:auto", label: "自动判断", detail: "Kimi 原生自动审批模式" },
  { value: "kimi:yolo", label: "跳过审批", detail: "Kimi 原生直接执行模式" },
];
const deepseekModes: { value: PermissionMode | null; label: string; detail: string }[] = [
  { value: null, label: "原生默认", detail: "保留 DeepSeek Harness 原生审批请求" },
  { value: "dsh:ask", label: "逐项审批", detail: "需要审批的操作由你确认" },
  { value: "dsh:allow", label: "自动允许", detail: "自动允许原生工具审批；不提供文件系统沙箱" },
  {
    value: "dsh:deny",
    label: "拒绝需审批的操作",
    detail: "自动拒绝原生工具审批；仍可执行原生无需审批的操作",
  },
];
type NativeModes = {
  current: PermissionMode | null;
  options: { value: PermissionMode; label: string; detail?: string }[];
};

function nativeLabel(harnessId: HarnessId) {
  if (harnessId === "claude-code") return "原生默认";
  if (harnessId === "kodo" || harnessId === "pi") return "Host 进程权限";
  return "原生权限";
}

/** Permission modes a harness accepts for a new chat; empty when it has none. */
export function permissionModesFor(harnessId: HarnessId) {
  if (harnessId === "deepseek-harness") return deepseekModes;
  return harnessId === "codex"
    ? codexModes
    : harnessId === "kimi-code"
      ? kimiModes
      : harnessId === "claude-code"
        ? claudeModes
        : harnessId === "zcode"
          ? zcodeModes
          : harnessId === "opencode"
            ? openCodeModes
            : harnessId === "pi" || harnessId === "kodo"
              ? kodoToolModes
              : [];
}

export function PermissionControls({
  harnessId,
  value,
  sessionId,
  nativeSessionId,
  connected = false,
  onChange,
  disabled = false,
  nativePermission,
  ariaLabel = "会话权限",
}: {
  harnessId: HarnessId;
  /** The harness's own configured permission mode, shown when Kodo does not override it. */
  nativePermission?: string | null;
  value: PermissionMode | null;
  sessionId?: string;
  nativeSessionId?: string | null;
  connected?: boolean;
  onChange?: (value: PermissionMode | null) => Promise<void> | void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [nativeModes, setNativeModes] = useState<NativeModes | null>(null);
  const dynamicModes = ["gemini", "cursor", "kimi-code", "grok-build"].includes(harnessId);
  const acp =
    dynamicModes &&
    (harnessId !== "kimi-code" ||
      value?.startsWith("acp:") === true ||
      Boolean(nativeSessionId && !nativeSessionId.startsWith("session_")));
  useEffect(() => {
    if (!open || !dynamicModes || !sessionId || !connected) return;
    let current = true;
    void api<NativeModes | null>(`/sessions/${sessionId}/permissions`)
      .then((result) => {
        if (current) setNativeModes(result);
      })
      .catch((e) => {
        if (current) setError(e instanceof Error ? e.message : "读取原生模式失败");
      });
    return () => {
      current = false;
    };
  }, [open, dynamicModes, sessionId, connected]);
  const modes =
    harnessId === "deepseek-harness"
      ? deepseekModes
      : harnessId === "codex"
        ? codexModes
        : harnessId === "kimi-code"
          ? (nativeModes?.options ?? (acp ? [] : kimiModes))
          : harnessId === "claude-code"
            ? claudeModes
            : harnessId === "zcode"
              ? zcodeModes
              : harnessId === "opencode"
                ? openCodeModes
                : harnessId === "pi" || harnessId === "kodo"
                  ? kodoToolModes
                  : dynamicModes
                    ? (nativeModes?.options ?? []).map((option) => ({
                        ...option,
                        detail: option.detail ?? "ACP 原生运行模式",
                      }))
                    : [];
  const configurable = modes.length > 0 && Boolean(onChange);
  const activeValue = dynamicModes ? (nativeModes?.current ?? value) : value;
  const chosen = modes.find((mode) => mode.value === activeValue);
  const label = configurable
    ? chosen && chosen.value !== null
      ? chosen.label
      : nativePermission
        ? nativePermission
        : (chosen?.label ?? (harnessId === "zcode" ? "原生当前模式" : "原生默认"))
    : dynamicModes
      ? "原生运行模式"
      : nativeLabel(harnessId);

  const choose = async (next: PermissionMode | null) => {
    if (!onChange || saving || next === activeValue) {
      setOpen(false);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onChange(next);
      if (dynamicModes && nativeModes) setNativeModes({ ...nativeModes, current: next });
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "权限设置失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <IosPopover
      open={open}
      onOpenChange={setOpen}
      side="top"
      align="start"
      role="dialog"
      trigger={(props) => (
        <button
          {...props}
          type="button"
          disabled={disabled}
          className="composer-pill-btn composer-pill-btn--ghost permission-trigger"
          aria-label={ariaLabel}
          title={`权限 · ${label}`}
        >
          <Shield size={13} aria-hidden="true" />
          <span>{label}</span>
          <ChevronDown size={12} className="composer-pill-chevron" aria-hidden="true" />
        </button>
      )}
    >
      <div className="ios-menu__section-label">
        {dynamicModes
          ? "原生运行模式"
          : harnessId === "opencode"
            ? "工具审批规则"
            : harnessId === "pi" || harnessId === "kodo"
              ? "工具使用规则"
              : "会话权限"}
      </div>
      {configurable ? (
        modes.map((mode) => (
          <button
            key={mode.value ?? "native"}
            type="button"
            className={`ios-menu__item ${activeValue === mode.value ? "is-selected" : ""}`}
            disabled={saving}
            onClick={() => void choose(mode.value)}
          >
            <span className="ios-menu__title">{mode.label}</span>
            {activeValue === mode.value && <Check size={14} className="ios-menu__check" />}
          </button>
        ))
      ) : (
        <div className="permission-native-state">
          <strong>{label}</strong>
          <span>
            {dynamicModes
              ? acp
                ? connected
                  ? "ACP · 原生模式"
                  : "ACP · 待连接"
                : connected
                  ? "Kimi Server · 原生模式"
                  : "Kimi Server · 待连接"
              : "原生默认"}
          </span>
        </div>
      )}
      {error && (
        <p className="ms-error" role="alert">
          {error}
        </p>
      )}
    </IosPopover>
  );
}
