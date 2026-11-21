import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  BookmarkPlus,
  Check,
  ChevronDown,
  ChevronLeft,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  GitPullRequest,
  Globe,
  Layers,
  Monitor,
  MoreHorizontal,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { NATIVE_HARNESS_IDS, bindingReasoningLevels } from "@kodo/protocol/client";
import type {
  HarnessId,
  HarnessModelOption,
  HarnessModelSupport,
  PermissionMode,
  Session,
  Snapshot,
} from "@kodo/protocol";
import { shouldSend, useAppPreferences } from "../lib/preferences";
import { useT } from "../lib/i18n";
import { api, send } from "../lib/host-client";
import { appendVoiceTranscript, useVoiceInput } from "../lib/voice";
import { VoiceInputButton, VoiceRecordingBar } from "./VoiceInputControls";
import {
  HARNESS_NAMES,
  formatWorkspaceLabel,
  modelChoiceLabels,
  resolveInheritedBinding,
  shortModelLabel,
  modelOptionValue,
} from "../lib/harnesses";
import { HarnessBadge } from "./KooyuBrand";
import { CanvasAura } from "./CanvasAura";
import { MobiusLoader } from "./MobiusLoader";
import { IosPopover } from "./IosPopover";
import {
  ComposerDropOverlay,
  MobileComposerPlusSheet,
  SlashTemplateMenu,
  useFileDropZone,
} from "./ComposerExtras";
import { Modal } from "./Motion";
import { ComposerModelControls } from "./ComposerModelControls";
import { PermissionControls, permissionModesFor } from "./PermissionControls";
import { DirectoryPicker } from "./DirectoryPicker";
import { ProjectModal } from "./Modals";
import { AttachmentButton, AttachmentList, useAttachments } from "./Attachments";

type Action = (work: () => Promise<unknown>) => Promise<void>;

export interface DraftPreset {
  text?: string;
  projectId?: string | null;
  workspaceId?: string | null;
  harnessId?: HarnessId;
  nonce: number;
}

interface HarnessModelsPayload {
  harnessId: HarnessId;
  modelSupport: HarnessModelSupport;
  defaultModel: { provider?: string; model: string } | null;
  models: HarnessModelOption[];
}

interface DraftWorkspaceProps {
  snapshot?: Snapshot;
  preset: DraftPreset;
  connected: boolean;
  busy: boolean;
  act: Action;
  onBackToList: () => void;
  onDraftActivated: () => void;
  onDraftSaved: (session: Session) => void;
  onFirstSendStarted: (session: Session, firstMessage: string, requestId: string) => void;
  onFirstSendFailed: (session: Session, message: string) => Promise<void>;
}

/**
 * Inline Root Compose View (iOS craft + DeepSeek Harness / Codeg style):
 * Frosted popover pickers replace raw <select> chrome; no modal dialog needed.
 */
export function DraftWorkspace({
  snapshot,
  preset,
  connected,
  busy,
  act,
  onBackToList,
  onDraftActivated,
  onDraftSaved,
  onFirstSendStarted,
  onFirstSendFailed,
}: DraftWorkspaceProps) {
  const t = useT();
  const { settings: preferences } = useAppPreferences();
  const [providerChoiceId, setProviderChoiceId] = useState<string | null | undefined>(undefined);
  const workspaces = snapshot?.workspaces ?? [];
  const projects = snapshot?.projects ?? [];
  const harnesses = snapshot?.harnesses ?? [];

  const initialProject = preset.projectId ?? "";
  const initialWorkspace =
    workspaces.find((w) => w.id === preset.workspaceId && w.hostId === snapshot?.hostId)?.id ??
    (initialProject
      ? (workspaces.find((w) => w.projectId === initialProject && w.hostId === snapshot?.hostId)
          ?.id ?? "")
      : "");

  const [harnessId, setHarnessId] = useState<HarnessId>(preset.harnessId ?? "kodo");
  const bindings = useMemo(
    () => (snapshot?.bindings ?? []).filter((item) => item.harnessId === harnessId),
    [snapshot?.bindings, harnessId],
  );
  const [project, setProject] = useState<string>(initialProject);
  const [workspace, setWorkspace] = useState<string>(initialWorkspace);
  const [executorId, setExecutorId] = useState("local");
  const [executors, setExecutors] = useState<
    Array<{ id: string; hostId: string; name: string; status: string; capabilities: string[] }>
  >([]);
  useEffect(() => {
    void api<typeof executors>("/executors")
      .then(setExecutors)
      .catch(() => {});
  }, []);
  const [customPath, setCustomPath] = useState("");
  const [title, setTitle] = useState("");
  const [compose, setCompose] = useState(preset.text ?? "");
  const [modelChoice, setModelChoice] = useState("inherit");
  const [customModel, setCustomModel] = useState("");
  const [modelQuery, setModelQuery] = useState("");
  const [reasoning, setReasoning] = useState<string | undefined>(undefined);
  const [permissionMode, setPermissionMode] = useState<PermissionMode | null | undefined>(
    undefined,
  );
  const [modelsCache, setModelsCache] = useState<Partial<Record<HarnessId, HarnessModelsPayload>>>(
    {},
  );
  const [loadingModelHarness, setLoadingModelHarness] = useState<HarnessId | null>(null);
  const [modelLoadError, setModelLoadError] = useState("");

  // Popover open states (mutually exclusive for clean iOS feel)
  const [projectOpen, setProjectOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [harnessOpen, setHarnessOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [showDirectoryPicker, setShowDirectoryPicker] = useState(false);
  const [plusSheetOpen, setPlusSheetOpen] = useState(false);
  const [mobileMetaOpen, setMobileMetaOpen] = useState(false);
  const [mobileHarnessOpen, setMobileHarnessOpen] = useState(false);
  const [workspaceContext, setWorkspaceContext] = useState<{
    branch: string | null;
    git: boolean;
  }>();
  const attachments = useAttachments("draft", null);
  const dropZone = useFileDropZone(connected && !busy, (files) => void attachments.add(files));
  const firstSendRef = useRef(false);
  const [firstMessage, setFirstMessage] = useState<string | null>(null);

  useEffect(() => {
    if (
      compose.trim() ||
      title.trim() ||
      harnessId !== (preset.harnessId ?? "kodo") ||
      project !== initialProject ||
      workspace !== initialWorkspace ||
      modelChoice !== "inherit" ||
      reasoning !== undefined ||
      permissionMode !== undefined ||
      attachments.attachments.length
    ) {
      onDraftActivated();
    }
  }, [
    compose,
    title,
    harnessId,
    project,
    workspace,
    modelChoice,
    reasoning,
    permissionMode,
    attachments.attachments.length,
    preset.harnessId,
    initialProject,
    initialWorkspace,
    onDraftActivated,
  ]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    setReasoning(modelChoice === "inherit" ? undefined : "");
  }, [harnessId, modelChoice, customModel]);
  const appliedNonceRef = useRef(preset.nonce);

  const openOnlyPopover = (
    target: "project" | "workspace" | "harness" | "model" | "reasoning" | null,
  ) => {
    setProjectOpen(target === "project");
    setWorkspaceOpen(target === "workspace");
    setHarnessOpen(target === "harness");
    setModelOpen(target === "model");
    setReasoningOpen(target === "reasoning");
  };

  // Focus composer on mount; only re-apply preset state when preset.nonce increments while mounted
  // so fast typing into Title/Compose right after mount isn't cleared by a passive effect.
  useEffect(() => {
    if (appliedNonceRef.current !== preset.nonce) {
      appliedNonceRef.current = preset.nonce;
      const nextHarness = preset.harnessId ?? "kodo";
      const nextProject = preset.projectId ?? "";
      const matchedWs = nextProject
        ? workspaces.find((w) => w.projectId === nextProject && w.hostId === snapshot?.hostId)
        : undefined;
      setHarnessId(nextHarness);
      setProject(nextProject);
      setWorkspace(
        workspaces.find((w) => w.id === preset.workspaceId && w.hostId === snapshot?.hostId)?.id ??
          matchedWs?.id ??
          "",
      );
      setExecutorId("local");
      setCustomPath("");
      setTitle("");
      setCompose(preset.text ?? "");
      setModelChoice("inherit");
      setProviderChoiceId(undefined);
      setCustomModel("");
      setModelQuery("");
      setReasoning(undefined);
      setPermissionMode(undefined);
      attachments.clear();
      openOnlyPopover(null);
    }
    textareaRef.current?.focus();
    // Intentionally sync only when a new draft trigger arrives (preset.nonce).
  }, [preset.nonce]);

  useEffect(() => {
    if (executorId !== "local" || !workspace || workspace === "__new_path__") {
      setWorkspaceContext(undefined);
      return;
    }
    let current = true;
    setWorkspaceContext(undefined);
    void api<{ branch: string | null; git: boolean }>(`/workspaces/${workspace}/context`)
      .then((value) => {
        if (current) setWorkspaceContext(value);
      })
      .catch(() => {
        if (current) setWorkspaceContext(undefined);
      });
    return () => {
      current = false;
    };
  }, [workspace, executorId]);

  // Auto-grow composer textarea smoothly without browser resize grip
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(76, Math.min(el.scrollHeight, 220))}px`;
  }, [compose]);

  const kind: "supervisor" | "direct" = harnessId === "kodo" ? "supervisor" : "direct";
  const harnessDesc = harnesses.find((item) => item.id === harnessId);
  const cachedPayload = modelsCache[harnessId];
  const modelSupport: HarnessModelSupport =
    cachedPayload?.modelSupport ?? harnessDesc?.modelSupport ?? "binding-or-model";
  const nativeDiscoveredModels = cachedPayload?.models ?? harnessDesc?.models ?? [];

  useEffect(() => {
    if (executorId !== "local" || modelsCache[harnessId]) {
      setLoadingModelHarness((current) => (current === harnessId ? null : current));
      return;
    }
    let cancelled = false;
    setLoadingModelHarness(harnessId);
    setModelLoadError("");
    void api<HarnessModelsPayload>(`/harnesses/${harnessId}/models?discover=1`)
      .then((res) => {
        if (!cancelled) setModelsCache((prev) => ({ ...prev, [harnessId]: res }));
      })
      .catch((error) => {
        if (!cancelled) setModelLoadError(error instanceof Error ? error.message : "读取模型失败");
      })
      .finally(() => {
        if (!cancelled)
          setLoadingModelHarness((current) => (current === harnessId ? null : current));
      });
    return () => {
      cancelled = true;
      setLoadingModelHarness((current) => (current === harnessId ? null : current));
    };
  }, [harnessId, modelsCache, executorId]);

  const orderedWorkspaces = useMemo(() => {
    const hostId = executors.find((e) => e.id === executorId)?.hostId ?? snapshot?.hostId;
    const available = workspaces.filter((w) => w.hostId === hostId);
    if (!project) return available;
    const matched = available.filter((w) => w.projectId === project);
    const others = available.filter((w) => w.projectId !== project);
    return [...matched, ...others];
  }, [project, workspaces, executorId, executors, snapshot?.hostId]);

  const inherited = useMemo(
    () =>
      snapshot
        ? resolveInheritedBinding(snapshot, harnessId, project || null)
        : { binding: null, source: "原生配置与登录" },
    [snapshot, harnessId, project, modelSupport],
  );

  const selectedProfile = modelChoice.startsWith("binding:")
    ? bindings.find((binding) => binding.id === modelChoice.slice(8))
    : providerChoiceId === null
      ? undefined
      : providerChoiceId
        ? bindings.find((binding) => binding.id === providerChoiceId)
        : inherited.binding;
  const activeProviderBinding =
    modelChoice !== "native" && selectedProfile?.selectionMode === "provider"
      ? selectedProfile
      : undefined;
  const discoveredModels: HarnessModelOption[] = activeProviderBinding
    ? (activeProviderBinding.availableModels ?? []).map((model) => ({
        id: model.model,
        name: model.name,
        provider: `kodo-${activeProviderBinding.providerId}`,
        source: "discovered",
        ...model.effective,
        reasoning: bindingReasoningLevels(model.effective, harnessId),
      }))
    : nativeDiscoveredModels;

  const harnessPreset = preferences.harnessDefaults?.[harnessId];
  const presetModel =
    executorId === "local" && harnessPreset?.model
      ? activeProviderBinding
        ? activeProviderBinding.availableModels?.some((m) => m.model === harnessPreset.model)
          ? harnessPreset.model
          : null
        : !inherited.binding
          ? harnessPreset.model
          : null
      : null;
  const validPresetPermission =
    harnessPreset?.permissionMode &&
    permissionModesFor(harnessId).some((m) => m.value === harnessPreset.permissionMode)
      ? (harnessPreset.permissionMode as PermissionMode)
      : null;
  const effectiveReasoning =
    reasoning !== undefined
      ? reasoning
      : modelChoice === "inherit" && executorId === "local"
        ? (harnessPreset?.reasoning ?? "")
        : "";
  const effectivePermissionMode =
    permissionMode !== undefined ? permissionMode : validPresetPermission;

  const nativeModel =
    harnessDesc?.nativeDefaults?.model ??
    (cachedPayload?.defaultModel
      ? `${cachedPayload.defaultModel.provider ? `${cachedPayload.defaultModel.provider}/` : ""}${cachedPayload.defaultModel.model}`
      : "");
  const inheritShort = presetModel
    ? shortModelLabel(presetModel)
    : inherited.binding
      ? `${inherited.binding.model}`
      : nativeModel
        ? shortModelLabel(nativeModel)
        : "原生默认";

  const filteredModels = useMemo(() => {
    const q = modelQuery.trim().toLocaleLowerCase();
    const list = q
      ? discoveredModels.filter(
          (m) =>
            m.id.toLocaleLowerCase().includes(q) ||
            (m.name?.toLocaleLowerCase().includes(q) ?? false) ||
            (m.provider?.toLocaleLowerCase().includes(q) ?? false),
        )
      : discoveredModels;
    return list.slice(0, 80);
  }, [modelQuery, discoveredModels]);

  const createSessionRecord = async (fallbackTitle?: string): Promise<Session> => {
    let workspaceId = workspace && workspace !== "__new_path__" ? workspace : null;
    if (workspace === "__new_path__" && customPath.trim()) {
      if (executorId !== "local")
        throw new Error("远程会话请选择节点已登记的目录；可在工作中心登记节点路径。");
      workspaceId = (
        await api<{ id: string }>("/workspaces", "POST", {
          projectId: project || null,
          rootPath: customPath.trim(),
        })
      ).id;
    }

    let bindingPayload: { bindingId?: string | null; model?: string | null } = {};
    if (modelSupport === "native-only") {
      bindingPayload = { bindingId: null, model: null };
    } else if (modelChoice === "native") {
      bindingPayload = { bindingId: null, model: null };
    } else if (modelChoice.startsWith("binding:")) {
      bindingPayload = { bindingId: modelChoice.slice("binding:".length), model: null };
    } else if (modelChoice.startsWith("model:")) {
      bindingPayload = { bindingId: null, model: modelChoice.slice("model:".length) };
    } else if (modelChoice === "__custom__" && customModel.trim()) {
      bindingPayload = { bindingId: null, model: customModel.trim() };
    }

    if (activeProviderBinding)
      bindingPayload = { ...bindingPayload, bindingId: activeProviderBinding.id };
    if (
      !activeProviderBinding &&
      modelSupport === "native-models" &&
      !modelChoice.startsWith("binding:")
    )
      bindingPayload.bindingId = null;
    const defaultName =
      fallbackTitle?.trim().split(/\r?\n/)[0]?.slice(0, 48) ||
      `与 ${harnessId === "kodo" ? "Kooyu" : HARNESS_NAMES[harnessId]} 对话`;

    if (workspaceId) localStorage.setItem("kodo.lastWorkspace", workspaceId);
    return api<Session>("/sessions", "POST", {
      title: title.trim() || defaultName,
      harnessId,
      kind,
      projectId: project || null,
      workspaceId,
      ...(executorId !== "local" ? { executorId, bindingId: null, model: null } : bindingPayload),
      ...(reasoning !== undefined ? { reasoning: reasoning || null } : {}),
      ...(permissionMode !== undefined &&
      [
        "codex",
        "claude-code",
        "zcode",
        "opencode",
        "pi",
        "kodo",
        "kimi-code",
        "deepseek-harness",
      ].includes(harnessId)
        ? { permissionMode }
        : {}),
    });
  };

  const handleSaveDraft = () => {
    void act(async () => {
      const created = await createSessionRecord();
      setTitle("");
      onDraftSaved(created);
    });
  };

  const handleSendFirst = (overrideText?: string) => {
    const text = overrideText ?? compose;
    const attachmentIds = attachments.readyIds;
    if (
      (!text.trim() && !attachmentIds.length) ||
      !connected ||
      busy ||
      firstSendRef.current ||
      sendBlockedReason ||
      attachments.uploading
    )
      return;
    if (attachments.failed) {
      attachments.setError("有附件上传失败，请移除后再发送。");
      return;
    }
    firstSendRef.current = true;
    setFirstMessage(text);
    void act(async () => {
      const created = await createSessionRecord(text);
      const requestId = crypto.randomUUID();
      // Enter the conversation before waiting for delivery or a full Host snapshot.
      onFirstSendStarted(created, text, requestId);
      try {
        // A fresh draft is idle: deliver immediately rather than through the queue.
        await send(created.id, text, "new", requestId, attachmentIds);
        attachments.clear();
        setCompose("");
        setTitle("");
      } catch (error) {
        await onFirstSendFailed(created, text);
        throw error;
      }
    }).finally(() => {
      firstSendRef.current = false;
      setFirstMessage(null);
    });
  };

  const composeRef = useRef(compose);
  composeRef.current = compose;
  const voice = useVoiceInput({
    disabled: Boolean(firstMessage) || busy,
    onTranscript: (spoken) => {
      const merged = appendVoiceTranscript(composeRef.current, spoken);
      composeRef.current = merged;
      setCompose(merged);
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    onAutoSend: () => {
      const merged = composeRef.current;
      if (merged.trim()) handleSendFirst(merged);
    },
  });

  const selectedProjectName = projects.find((p) => p.id === project)?.name;
  const selectedWorkspace = workspaces.find((w) => w.id === workspace);
  const sendBlockedReason =
    (!["kodo", "pi"].includes(harnessId) || (harnessId === "kodo" && !!project)) &&
    (!workspace || (workspace === "__new_path__" && !customPath.trim()))
      ? "请先选择工作位置。"
      : executorId === "local" &&
          modelSupport === "binding-required" &&
          modelChoice === "inherit" &&
          !inherited.binding
        ? "请先选择 Harness 绑定。"
        : "";
  // For Kodo the project picker sets the management scope, not the working folder.
  const projectButtonText =
    kind === "supervisor"
      ? selectedProjectName
        ? `项目主对话 · ${selectedProjectName}`
        : "全局主对话 · 跨项目"
      : (selectedProjectName ?? "选择项目");
  const rawWorkspacePath =
    workspace === "__new_path__" && customPath.trim()
      ? customPath.trim()
      : (selectedWorkspace?.rootPath ?? "");
  const workspaceButtonText = rawWorkspacePath
    ? formatWorkspaceLabel(rawWorkspacePath) || rawWorkspacePath
    : kind === "supervisor" && !project
      ? "无绑定目录"
      : "选择工作位置";

  const activeModelSummary =
    modelSupport === "native-only"
      ? nativeModel
        ? shortModelLabel(nativeModel)
        : "原生默认"
      : modelChoice === "__custom__" && customModel.trim()
        ? shortModelLabel(customModel.trim())
        : modelChoice.startsWith("model:")
          ? shortModelLabel(modelChoice.slice("model:".length))
          : modelChoice.startsWith("binding:")
            ? shortModelLabel(
                bindings.find((p) => p.id === modelChoice.slice("binding:".length))?.model ?? "",
              ) || "原生配置"
            : modelChoice === "native"
              ? nativeModel
                ? shortModelLabel(nativeModel)
                : "原生配置"
              : inheritShort || "原生配置";

  const resolvedDraftModel =
    modelChoice === "__custom__"
      ? customModel.trim()
      : modelChoice.startsWith("model:")
        ? modelChoice.slice("model:".length)
        : modelChoice.startsWith("binding:")
          ? (bindings.find((p) => p.id === modelChoice.slice("binding:".length))?.model ?? "")
          : modelChoice === "native"
            ? nativeModel
            : modelChoice === "inherit"
              ? (presetModel ?? inherited.binding?.model ?? nativeModel)
              : "";

  const draftModelParameters = useMemo(() => {
    const models = cachedPayload?.models ?? [];
    let selectedBinding = modelChoice.startsWith("binding:")
      ? bindings.find((p) => p.id === modelChoice.slice("binding:".length))
      : modelChoice === "inherit"
        ? inherited.binding
        : undefined;
    if (activeProviderBinding) {
      const model = activeProviderBinding.availableModels?.find(
        (model) => model.model === (resolvedDraftModel || activeProviderBinding.model),
      );
      if (model)
        selectedBinding = {
          ...activeProviderBinding,
          model: model.model,
          parameters: model.effective,
          sources: model.sources,
        };
    }
    if (selectedBinding) {
      const p = selectedBinding.parameters;
      return {
        id: selectedBinding.model,
        provider: `kodo-${selectedBinding.providerId}`,
        source: "discovered" as const,
        ...p,
        reasoning: bindingReasoningLevels(p, harnessId),
        parameterSources: Object.fromEntries(
          Object.entries(selectedBinding.sources).map(([k, v]) => [
            k === "reasoningOptions" ? "reasoning" : k,
            {
              kind: v.kind,
              label: v.label,
              reference: v.reference,
              version: v.revision.slice(0, 16),
            },
          ]),
        ),
      };
    }
    const matched = resolvedDraftModel
      ? models.find(
          (m) =>
            modelOptionValue(harnessId, m) === resolvedDraftModel || m.id === resolvedDraftModel,
        )
      : undefined;
    // Native default: show the levels of the model the harness itself reports as default.
    if (!matched && (modelChoice === "inherit" || modelChoice === "native"))
      return models.find((m) => m.isCurrent) ?? models.find((m) => m.isDefault);
    return matched;
  }, [
    cachedPayload,
    harnessId,
    resolvedDraftModel,
    modelChoice,
    bindings,
    inherited.binding,
    activeProviderBinding,
  ]);
  const draftReasoningOptions = draftModelParameters?.reasoning ?? [];

  const draftLabels = modelChoiceLabels(filteredModels, (m) => modelOptionValue(harnessId, m));
  const trimmedQuery = modelQuery.trim();
  const hasExactQueryMatch = filteredModels.some(
    (m) => modelOptionValue(harnessId, m).toLocaleLowerCase() === trimmedQuery.toLocaleLowerCase(),
  );

  const selectHarnessChoice = (nextId: HarnessId) => {
    setHarnessId(nextId);
    if (nextId === "kodo") {
      setExecutorId("local");
      if (executorId !== "local") setWorkspace("");
    }
    setPermissionMode(undefined);
    setModelChoice("inherit");
    setProviderChoiceId(undefined);
    setCustomModel("");
    setModelQuery("");
    setHarnessOpen(false);
    setMobileHarnessOpen(false);
  };

  const renderHarnessMenu = () => (
    <>
      <div className="ios-menu__section-label">主控统筹</div>
      <button
        type="button"
        role="option"
        data-value="kodo"
        aria-selected={harnessId === "kodo"}
        className={`ios-menu__item ios-menu__item--featured ${
          harnessId === "kodo" ? "is-selected" : ""
        }`}
        onClick={() => selectHarnessChoice("kodo")}
      >
        <HarnessBadge harnessId="kodo" size="xs" tone="mono" />
        <span className="ios-menu__title">Kooyu · 主对话</span>
        {harnessId === "kodo" && <Check size={14} className="ios-menu__check" />}
      </button>

      <div className="ios-menu__divider" />
      <div className="ios-menu__section-label">原生 Harness</div>

      <div className="ios-menu__scroll">
        {NATIVE_HARNESS_IDS.map((id) => {
          const health = harnesses.find((item) => item.id === id)?.health;
          const installed = health?.installed;
          const selected = harnessId === id;
          return (
            <button
              type="button"
              role="option"
              key={id}
              data-value={id}
              aria-selected={selected}
              className={`ios-menu__item ${selected ? "is-selected" : ""}`}
              onClick={() => selectHarnessChoice(id)}
            >
              <HarnessBadge harnessId={id} size="xs" tone="mono" />
              <span className="ios-menu__title">{HARNESS_NAMES[id]}</span>
              <span className={`ios-menu__status ${installed ? "is-ready" : "is-muted"}`}>
                {health?.launchable === false && installed
                  ? "桌面待连接"
                  : health?.source === "desktop-bundled"
                    ? "桌面入口"
                    : installed
                      ? "入口已发现"
                      : "未发现"}
              </span>
              {selected && <Check size={14} className="ios-menu__check" />}
            </button>
          );
        })}
      </div>
    </>
  );

  const draftPermissionsNode = (
    <PermissionControls
      harnessId={harnessId}
      nativePermission={harnessDesc?.nativeDefaults?.permission}
      value={effectivePermissionMode}
      onChange={setPermissionMode}
      disabled={busy || !connected}
    />
  );

  return (
    <>
      <header className="chat-header chat-header--draft">
        <button
          type="button"
          className="mobile-only icon-button chat-back-btn"
          aria-label="返回会话列表"
          onClick={onBackToList}
        >
          <ChevronLeft size={20} />
        </button>

        {/* Phone (<=760px) centered Engine Switcher + sanitized folder/branch subtitle + overflow menu */}
        <div className="mobile-draft-center mobile-only">
          <button
            type="button"
            className="mobile-draft-engine-pill"
            aria-label="切换对话引擎"
            onClick={() => setMobileHarnessOpen(true)}
          >
            <HarnessBadge harnessId={harnessId} size="xs" shape="circle" tone="mono" />
            <span>{harnessId === "kodo" ? "Kooyu 主对话" : HARNESS_NAMES[harnessId]}</span>
            <ChevronDown size={13} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="mobile-draft-subpill"
            onClick={() => setMobileMetaOpen(true)}
            title={rawWorkspacePath || workspaceButtonText}
          >
            <Folder size={11} aria-hidden="true" />
            <span>
              {workspaceButtonText}
              {workspaceContext?.git && workspaceContext.branch
                ? ` · ${workspaceContext.branch}`
                : ""}
            </span>
          </button>
        </div>

        <button
          type="button"
          className="mobile-only icon-button chat-overflow-btn"
          aria-label="新对话设置"
          onClick={() => setMobileMetaOpen(true)}
        >
          <MoreHorizontal size={18} />
        </button>

        <div className="chat-header__badge desktop-only">
          <HarnessBadge harnessId={harnessId} size="sm" tone="mono" />
        </div>

        <div className="draft-heading desktop-only">
          <div className="draft-context-row">
            <IosPopover
              open={projectOpen}
              onOpenChange={(next) => openOnlyPopover(next ? "project" : null)}
              side="bottom"
              align="start"
              trigger={(triggerProps) => (
                <button
                  type="button"
                  {...triggerProps}
                  aria-label="项目"
                  className="draft-crumb-btn"
                  data-value={project}
                >
                  <Folder size={11} aria-hidden="true" />
                  <span>{projectButtonText}</span>
                  <ChevronDown size={11} className="draft-crumb-chevron" aria-hidden="true" />
                </button>
              )}
            >
              <div className="ios-menu__section-label">会话归属</div>
              <button
                type="button"
                role="option"
                aria-selected={!project}
                className={`ios-menu__item ${!project ? "is-selected" : ""}`}
                onClick={() => {
                  setProject("");
                  setWorkspace("");
                  setProjectOpen(false);
                }}
              >
                <span className="ios-menu__title">
                  {kind === "supervisor" ? "全局主对话 · 跨项目" : "未归属对话"}
                </span>
                {!project && <Check size={14} className="ios-menu__check" />}
              </button>
              {projects.length > 0 && <div className="ios-menu__divider" />}
              {projects.map((p) => (
                <button
                  type="button"
                  role="option"
                  key={p.id}
                  aria-selected={project === p.id}
                  className={`ios-menu__item ${project === p.id ? "is-selected" : ""}`}
                  onClick={() => {
                    setProject(p.id);
                    const hostId =
                      executors.find((e) => e.id === executorId)?.hostId ?? snapshot?.hostId;
                    const matched = workspaces.find(
                      (w) => w.projectId === p.id && w.hostId === hostId,
                    );
                    setWorkspace(matched?.id ?? "");
                    setProjectOpen(false);
                  }}
                >
                  <Folder size={13} className="ios-menu__icon" aria-hidden="true" />
                  <span className="ios-menu__title">{p.name}</span>
                  {project === p.id && <Check size={14} className="ios-menu__check" />}
                </button>
              ))}
              <div className="ios-menu__divider" />
              <button
                type="button"
                className="ios-menu__item"
                onClick={() => {
                  setProjectOpen(false);
                  setShowProjectForm(true);
                }}
              >
                <FolderPlus size={14} className="ios-menu__icon" aria-hidden="true" />
                <span className="ios-menu__title">新建项目</span>
              </button>
            </IosPopover>

            <span className="draft-sep" aria-hidden="true">
              /
            </span>

            <IosPopover
              open={workspaceOpen}
              onOpenChange={(next) => openOnlyPopover(next ? "workspace" : null)}
              side="bottom"
              align="start"
              wide
              trigger={(triggerProps) => (
                <button
                  type="button"
                  {...triggerProps}
                  aria-label="工作位置"
                  title={rawWorkspacePath || workspaceButtonText}
                  className="draft-crumb-btn draft-crumb-btn--path"
                  data-value={workspace}
                >
                  <span>{workspaceButtonText}</span>
                  <ChevronDown size={11} className="draft-crumb-chevron" aria-hidden="true" />
                </button>
              )}
            >
              <div className="ios-menu__section-label">工作目录</div>
              <button
                type="button"
                role="option"
                aria-selected={workspace === ""}
                className={`ios-menu__item ${workspace === "" ? "is-selected" : ""}`}
                onClick={() => {
                  setWorkspace("");
                  setCustomPath("");
                  setWorkspaceOpen(false);
                }}
              >
                <span className="ios-menu__title">
                  {kind === "supervisor" && !project ? "无绑定目录" : "不指定目录"}
                </span>
                {workspace === "" && <Check size={14} className="ios-menu__check" />}
              </button>

              {orderedWorkspaces.map((w) => {
                const seg = formatWorkspaceLabel(w.rootPath) || w.rootPath;
                return (
                  <button
                    type="button"
                    role="option"
                    key={w.id}
                    aria-selected={workspace === w.id}
                    className={`ios-menu__item ${workspace === w.id ? "is-selected" : ""}`}
                    onClick={() => {
                      setWorkspace(w.id);
                      setCustomPath("");
                      setWorkspaceOpen(false);
                    }}
                  >
                    <div className="ios-menu__text-col">
                      <span className="ios-menu__title">{seg}</span>
                      <span className="ios-menu__sub">{w.rootPath}</span>
                    </div>
                    {workspace === w.id && <Check size={14} className="ios-menu__check" />}
                  </button>
                );
              })}

              <div className="ios-menu__divider" />
              <button
                type="button"
                className="ios-menu__item"
                onClick={() => {
                  setWorkspaceOpen(false);
                  if (executorId === "local") setShowDirectoryPicker(true);
                }}
                disabled={executorId !== "local"}
              >
                <FolderOpen size={14} className="ios-menu__icon" aria-hidden="true" />
                <span className="ios-menu__title">
                  {executorId === "local" ? "选择本机文件夹" : "在自动化与通知登记节点目录"}
                </span>
              </button>
            </IosPopover>
            {selectedWorkspace && (
              <span className="draft-context-meta" title={`Host ${selectedWorkspace.hostId}`}>
                <Monitor size={12} aria-hidden="true" />
                {executorId === "local" ? "本机" : "远程节点"}
              </span>
            )}
            {workspaceContext?.git && (
              <span
                className="draft-context-meta"
                title="当前 Git 分支；切换工作位置可选择其他 worktree"
              >
                <GitBranch size={12} aria-hidden="true" />
                {workspaceContext.branch ?? "detached HEAD"}
              </span>
            )}
          </div>

          <input
            aria-label="标题"
            className="draft-title-input"
            title="自定义标题"
            value={title}
            disabled={busy}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="新对话"
            maxLength={200}
          />
        </div>

        <button
          type="button"
          className="draft-save-btn desktop-only"
          disabled={busy || !connected}
          title="保存空草稿"
          onClick={handleSaveDraft}
        >
          <BookmarkPlus size={14} />
          <span>创建会话</span>
        </button>
      </header>

      <div className="chat-body">
        <div className="conversation">
          {firstMessage ? (
            <div className="transcript" aria-label="正在创建对话">
              <div className="transcript-inner">
                <article
                  className="turn user-turn is-sending"
                  data-nav-user=""
                  data-nav-label={firstMessage.slice(0, 80)}
                >
                  <div className="markdown">
                    <p style={{ whiteSpace: "pre-wrap" }}>{firstMessage}</p>
                  </div>
                </article>
                <div className="run-indicator run-indicator--mobius">
                  <MobiusLoader size={24} label="正在创建对话" />
                  <span>正在创建对话…</span>
                </div>
              </div>
            </div>
          ) : null}
          <div
            className={firstMessage ? "draft-canvas draft-canvas--sending" : "draft-canvas"}
            {...(!firstMessage ? dropZone.handlers : {})}
          >
            {!firstMessage && (
              <>
                <ComposerDropOverlay active={dropZone.dragOver} label="松开以上传文件到新对话" />
                <CanvasAura harnessId={harnessId} />
                <div className="draft-hero">
                  <button
                    type="button"
                    className="draft-hero__badge"
                    aria-label="选择执行引擎"
                    title="点击切换对话引擎"
                    onClick={() => {
                      if (window.matchMedia("(max-width: 760px)").matches) {
                        setMobileHarnessOpen(true);
                      } else {
                        openOnlyPopover(harnessOpen ? null : "harness");
                      }
                    }}
                  >
                    <HarnessBadge harnessId={harnessId} size="lg" tone="tinted" />
                  </button>
                  <h2>
                    {selectedProjectName
                      ? `在「${selectedProjectName}」推进什么？`
                      : kind === "supervisor"
                        ? "今天想推进什么？"
                        : `与 ${HARNESS_NAMES[harnessId]} 开启新对话`}
                  </h2>
                  {kind === "supervisor" && !compose && (
                    <div className="playbook-capsules" aria-label={t("playbook.group")}>
                      <button
                        type="button"
                        className="playbook-capsule"
                        onClick={() =>
                          setCompose(
                            "请用独立 Worktree 委派 Codex 实现以下需求，再交给 Claude Code 只读审查，最后运行测试并汇报结果。\n\n需求：",
                          )
                        }
                      >
                        <GitPullRequest size={13} />
                        <span>{t("playbook.implReview")}</span>
                      </button>
                      <button
                        type="button"
                        className="playbook-capsule"
                        onClick={() =>
                          setCompose(
                            "请将以下任务拆分给多个 Worker，在独立工作区并行执行，汇总各项变更与验证结果。\n\n任务：",
                          )
                        }
                      >
                        <Layers size={13} />
                        <span>{t("playbook.parallel")}</span>
                      </button>
                      <button
                        type="button"
                        className="playbook-capsule"
                        onClick={() =>
                          setCompose(
                            "请运行当前项目测试与 lint 检查，定位失败原因并在独立分支修复，确保全量通过后给出改动摘要。\n\n范围：",
                          )
                        }
                      >
                        <ShieldCheck size={13} />
                        <span>{t("playbook.ciGuard")}</span>
                      </button>
                      <button
                        type="button"
                        className="playbook-capsule"
                        onClick={() =>
                          setCompose(
                            "请围绕以下主题进行深度联网调研，对比关键方案并附上可核验的来源链接与结论建议。\n\n主题：",
                          )
                        }
                      >
                        <Globe size={13} />
                        <span>{t("playbook.research")}</span>
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}

            <div className="draft-composer-wrap">
              <div
                className="composer composer--draft"
                onPointerMove={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
                  e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
                }}
              >
                <SlashTemplateMenu
                  compose={compose}
                  onSelect={(text) => {
                    setCompose(text);
                    requestAnimationFrame(() => textareaRef.current?.focus());
                  }}
                />
                <AttachmentList
                  attachments={attachments.attachments}
                  error={attachments.error}
                  disabled={busy}
                  onRemove={attachments.remove}
                />
                <VoiceRecordingBar voice={voice} />
                {sendBlockedReason && (
                  <div className="composer-inline-hint" role="status">
                    <span>{sendBlockedReason}</span>
                    <button
                      type="button"
                      className="composer-inline-hint__btn"
                      onClick={() => {
                        if (window.matchMedia("(max-width: 760px)").matches) {
                          if (sendBlockedReason.includes("工作位置")) {
                            setMobileMetaOpen(true);
                          } else {
                            openOnlyPopover("model");
                          }
                        } else {
                          openOnlyPopover(
                            sendBlockedReason.includes("工作位置") ? "workspace" : "model",
                          );
                        }
                      }}
                    >
                      {sendBlockedReason.includes("工作位置") ? "选择目录" : "选择绑定"}
                    </button>
                  </div>
                )}

                <textarea
                  ref={textareaRef}
                  rows={2}
                  aria-label="消息"
                  disabled={Boolean(firstMessage)}
                  placeholder={
                    connected
                      ? harnessId === "kodo"
                        ? "Kooyu"
                        : HARNESS_NAMES[harnessId]
                      : "Host 未连接"
                  }
                  value={firstMessage ? "" : compose}
                  onChange={(e) => setCompose(e.target.value)}
                  onKeyDown={(e) => {
                    if (shouldSend(e, preferences.sendShortcut)) {
                      e.preventDefault();
                      handleSendFirst();
                    }
                  }}
                />

                {executors.length > 1 && harnessId !== "kodo" && (
                  <label className="draft-executor desktop-only">
                    执行节点
                    <select
                      aria-label="执行节点"
                      value={executorId}
                      disabled={busy}
                      onChange={(e) => {
                        setExecutorId(e.target.value);
                        setWorkspace("");
                        setCustomPath("");
                        setModelChoice("native");
                        setProviderChoiceId(null);
                      }}
                    >
                      {executors.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name} · {e.status === "online" ? "在线" : "离线"}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="composer-toolbar composer-toolbar--draft">
                  <button
                    type="button"
                    className="composer-mobile-plus mobile-only"
                    aria-label="添加附件、权限或模板"
                    disabled={busy || !connected}
                    onClick={() => setPlusSheetOpen(true)}
                  >
                    <Plus size={19} />
                  </button>
                  <div className="composer-pickers desktop-only-flex">
                    <AttachmentButton
                      loading={false}
                      disabled={busy || !connected}
                      onAdd={(files) => void attachments.add(files)}
                    />
                    <IosPopover
                      open={harnessOpen}
                      onOpenChange={(next) => openOnlyPopover(next ? "harness" : null)}
                      side="top"
                      align="start"
                      wide
                      trigger={(triggerProps) => (
                        <button
                          type="button"
                          {...triggerProps}
                          aria-label="Harness"
                          data-value={harnessId}
                          className="composer-pill-btn composer-harness-trigger"
                          title="切换对话引擎（Kooyu 主对话或原生 Harness）"
                        >
                          <HarnessBadge
                            harnessId={harnessId}
                            size="xs"
                            shape="circle"
                            tone="mono"
                          />
                          <span className="composer-harness__name">
                            {harnessId === "kodo" ? "Kooyu · 主对话" : HARNESS_NAMES[harnessId]}
                          </span>
                          <ChevronDown
                            size={13}
                            className="composer-pill-chevron"
                            aria-hidden="true"
                          />
                        </button>
                      )}
                    >
                      {renderHarnessMenu()}
                    </IosPopover>
                    {draftPermissionsNode}
                  </div>

                  <div className="composer-actions-right">
                    <div className="composer-mobile-chips">
                      {executorId === "local" && (
                        <ComposerModelControls
                          harnessId={harnessId}
                          modelSupport={modelSupport}
                          modelOpen={modelOpen}
                          onModelOpenChange={(next) => openOnlyPopover(next ? "model" : null)}
                          reasoningOpen={reasoningOpen}
                          onReasoningOpenChange={(next) =>
                            openOnlyPopover(next ? "reasoning" : null)
                          }
                          modelLabel={activeModelSummary}
                          modelTitle={resolvedDraftModel || activeModelSummary}
                          modelDataValue={modelChoice}
                          searchAriaLabel="模型 ID"
                          searchQuery={modelQuery}
                          onSearchQueryChange={setModelQuery}
                          showSearch={modelSupport !== "binding-required"}
                          loading={loadingModelHarness === harnessId}
                          refreshDisabled={loadingModelHarness === harnessId}
                          onRefresh={() =>
                            setModelsCache((prev) => {
                              const next = { ...prev };
                              delete next[harnessId];
                              return next;
                            })
                          }
                          emptyText={
                            modelLoadError || "原生目录未返回模型候选。请检查 Harness 安装或登录。"
                          }
                          onRetry={() =>
                            setModelsCache((prev) => {
                              const next = { ...prev };
                              delete next[harnessId];
                              return next;
                            })
                          }
                          topItems={
                            !trimmedQuery
                              ? [
                                  {
                                    key: "inherit",
                                    dataValue: "inherit",
                                    title: "继承默认",
                                    subtitle: `${presetModel ? "新对话默认" : inherited.source} · ${inheritShort}`,
                                    selected: modelChoice === "inherit",
                                    onSelect: () => {
                                      setModelChoice("inherit");
                                      setProviderChoiceId(undefined);
                                      setCustomModel("");
                                      setModelOpen(false);
                                    },
                                  },
                                  ...(modelSupport !== "binding-required"
                                    ? [
                                        {
                                          key: "native",
                                          dataValue: "native",
                                          title: "原生配置与登录",
                                          ...(nativeModel
                                            ? { subtitle: `当前：${shortModelLabel(nativeModel)}` }
                                            : {}),
                                          selected: modelChoice === "native",
                                          onSelect: () => {
                                            setModelChoice("native");
                                            setProviderChoiceId(null);
                                            setCustomModel("");
                                            setModelOpen(false);
                                          },
                                        },
                                      ]
                                    : []),
                                ]
                              : []
                          }
                          bindingItems={
                            modelSupport !== "native-models"
                              ? bindings
                                  .filter(
                                    (p) =>
                                      !trimmedQuery ||
                                      p.name
                                        .toLocaleLowerCase()
                                        .includes(trimmedQuery.toLocaleLowerCase()) ||
                                      p.model
                                        .toLocaleLowerCase()
                                        .includes(trimmedQuery.toLocaleLowerCase()) ||
                                      p.providerId
                                        .toLocaleLowerCase()
                                        .includes(trimmedQuery.toLocaleLowerCase()),
                                  )
                                  .map((p) => {
                                    const val = `binding:${p.id}`;
                                    return {
                                      key: p.id,
                                      dataValue: val,
                                      title: p.name,
                                      subtitle: `${p.model} · r${p.revision}`,
                                      selected: modelChoice === val,
                                      onSelect: () => {
                                        setProviderChoiceId(
                                          p.selectionMode === "provider" ? p.id : null,
                                        );
                                        setModelChoice(val);
                                        setCustomModel("");
                                        setModelOpen(false);
                                      },
                                    };
                                  })
                              : []
                          }
                          modelItems={
                            modelSupport !== "binding-required"
                              ? filteredModels.map((m) => {
                                  const val = modelOptionValue(harnessId, m);
                                  const optionVal = `model:${val}`;
                                  const label = draftLabels.get(m)!;
                                  return {
                                    key: `${m.provider ?? ""}:${m.id}`,
                                    dataValue: optionVal,
                                    title: label.title,
                                    subtitle: label.subtitle,
                                    selected: modelChoice === optionVal,
                                    onSelect: () => {
                                      setModelChoice(optionVal);
                                      setCustomModel("");
                                      setModelOpen(false);
                                    },
                                  };
                                })
                              : []
                          }
                          customItem={
                            trimmedQuery &&
                            modelSupport !== "binding-required" &&
                            !hasExactQueryMatch
                              ? {
                                  key: `__custom__:${trimmedQuery}`,
                                  title: `使用模型 “${trimmedQuery}”`,
                                  selected:
                                    modelChoice === "__custom__" && customModel === trimmedQuery,
                                  accent: true,
                                  onSelect: () => {
                                    setCustomModel(trimmedQuery);
                                    setModelChoice("__custom__");
                                    setModelOpen(false);
                                  },
                                }
                              : null
                          }
                          optionRole="option"
                          parametersModel={draftModelParameters}
                          popoverAriaLabel="草稿模型设置"
                          reasoningLevels={draftReasoningOptions}
                          reasoningValue={effectiveReasoning}
                          reasoningDefault={harnessDesc?.nativeDefaults?.reasoning ?? undefined}
                          reasoningSliderLabel="新对话思考强度"
                          onReasoningChange={setReasoning}
                        />
                      )}
                      <span className="mobile-only-inline composer-mobile-perm">
                        <PermissionControls
                          ariaLabel="工具权限"
                          harnessId={harnessId}
                          nativePermission={harnessDesc?.nativeDefaults?.permission}
                          value={effectivePermissionMode}
                          onChange={setPermissionMode}
                          disabled={busy || !connected}
                        />
                      </span>
                    </div>

                    <VoiceInputButton voice={voice} disabled={Boolean(firstMessage) || busy} />
                    <button
                      type="button"
                      className="send-button"
                      aria-label="发送消息"
                      disabled={
                        Boolean(firstMessage) ||
                        (!compose.trim() && !attachments.readyIds.length) ||
                        !connected ||
                        busy ||
                        attachments.uploading ||
                        !!sendBlockedReason
                      }
                      onClick={() => handleSendFirst()}
                    >
                      <ArrowUp size={17} strokeWidth={2.4} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {showProjectForm && (
        <ProjectModal
          act={act}
          onClose={() => setShowProjectForm(false)}
          onCreated={(id, workspaceId) => {
            setExecutorId("local");
            setProject(id);
            setWorkspace(workspaceId ?? "");
            setCustomPath("");
            setShowProjectForm(false);
          }}
        />
      )}
      {showDirectoryPicker && (
        <DirectoryPicker
          initialPath={customPath || selectedWorkspace?.rootPath}
          onClose={() => setShowDirectoryPicker(false)}
          onSelect={(path) => {
            const existing = workspaces.find(
              (w) =>
                w.rootPath === path &&
                w.projectId === (project || null) &&
                w.hostId === snapshot?.hostId,
            );
            setCustomPath(existing ? "" : path);
            setWorkspace(existing?.id ?? "__new_path__");
            setShowDirectoryPicker(false);
          }}
        />
      )}
      {mobileHarnessOpen && (
        <Modal title="选择对话引擎" onClose={() => setMobileHarnessOpen(false)}>
          <div className="ios-inset-group">{renderHarnessMenu()}</div>
        </Modal>
      )}
      {mobileMetaOpen && (
        <Modal title="新对话上下文" onClose={() => setMobileMetaOpen(false)}>
          <div className="ios-inset-group">
            <label className="ios-field-row">
              <span>自定义标题</span>
              <input
                value={title}
                disabled={busy}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="新对话"
                maxLength={200}
              />
            </label>
            <label className="ios-field-row">
              <span>归属项目</span>
              <select
                value={project}
                onChange={(e) => {
                  const nextProj = e.target.value;
                  setProject(nextProj);
                  const hostId =
                    executors.find((e) => e.id === executorId)?.hostId ?? snapshot?.hostId;
                  const matched = workspaces.find(
                    (w) => w.projectId === nextProj && w.hostId === hostId,
                  );
                  setWorkspace(matched?.id ?? "");
                }}
              >
                <option value="">
                  {kind === "supervisor" ? "全局主对话 · 跨项目" : "未归属对话"}
                </option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="ios-field-row">
              <span>工作目录</span>
              <select
                value={workspace}
                onChange={(e) => {
                  setWorkspace(e.target.value);
                  if (e.target.value !== "__new_path__") setCustomPath("");
                }}
              >
                <option value="">
                  {kind === "supervisor" && !project ? "无绑定目录" : "不指定目录"}
                </option>
                {orderedWorkspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {formatWorkspaceLabel(w.rootPath) || w.rootPath}
                  </option>
                ))}
              </select>
            </label>
            {executors.length > 1 && harnessId !== "kodo" && (
              <label className="ios-field-row">
                <span>执行节点</span>
                <select
                  aria-label="执行节点"
                  value={executorId}
                  disabled={busy}
                  onChange={(e) => {
                    setExecutorId(e.target.value);
                    setWorkspace("");
                    setCustomPath("");
                    setModelChoice("native");
                    setProviderChoiceId(null);
                  }}
                >
                  {executors.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name} · {e.status === "online" ? "在线" : "离线"}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="ios-group-block">
            <div className="ios-inset-group">
              {executorId === "local" && (
                <button
                  type="button"
                  className="ios-sheet-action-row"
                  onClick={() => {
                    setMobileMetaOpen(false);
                    setShowDirectoryPicker(true);
                  }}
                >
                  <FolderOpen size={16} />
                  <span>浏览并选择本机文件夹…</span>
                </button>
              )}
              <button
                type="button"
                className="ios-sheet-action-row"
                onClick={() => {
                  setMobileMetaOpen(false);
                  setShowProjectForm(true);
                }}
              >
                <FolderPlus size={16} />
                <span>新建项目…</span>
              </button>
              <button
                type="button"
                className="ios-sheet-action-row"
                disabled={busy || !connected}
                onClick={() => {
                  setMobileMetaOpen(false);
                  handleSaveDraft();
                }}
              >
                <BookmarkPlus size={16} />
                <span>保存为空会话草稿</span>
              </button>
            </div>
          </div>
        </Modal>
      )}
      <MobileComposerPlusSheet
        open={plusSheetOpen}
        onClose={() => setPlusSheetOpen(false)}
        disabled={busy || !connected}
        onAddFiles={(files) => void attachments.add(files)}
        permissionsNode={draftPermissionsNode}
        onSelectTemplate={(text) => {
          setCompose(text);
          requestAnimationFrame(() => textareaRef.current?.focus());
        }}
      />
    </>
  );
}
