import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  KeyRound,
  Link2,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type {
  AppSettings,
  CatalogModel,
  EndpointProtocol,
  HarnessBinding,
  HarnessId,
  ModelParameters,
  Provider,
  ProviderConfiguration,
  Snapshot,
} from "@kodo/protocol";
import { HARNESS_PROVIDER_PROTOCOLS, bindingReasoningLevels } from "@kodo/protocol/client";
import { api } from "../../lib/host-client";
import { HARNESS_NAMES, formatDate, shortModelLabel } from "../../lib/harnesses";
import { catalogModelSource, groupCatalogModels } from "../../lib/catalog-models";
import {
  CLAUDE_MODEL_MAP_SLOTS,
  harnessSupportsModelMap,
  pruneHarnessDefaultsForModels,
  suggestClaudeModelMap,
  type ClaudeModelSlot,
} from "../../lib/model-mapping";
import { useAppPreferences } from "../../lib/preferences";
import { HarnessBadge, HarnessGlyph } from "../KooyuBrand";
import { SettingsPage, SettingsRow, SettingsSection, StatusDot, SxSelect } from "./SettingsKit";
import {
  ModelPricingEditor,
  ModelPricingSummary,
  readPricingDraft,
  usePricingDraft,
} from "../ModelPricing";

type Action = (work: () => Promise<unknown>) => Promise<void>;

const PROTOCOLS: { value: EndpointProtocol; label: string; hint: string }[] = [
  { value: "openai-completions", label: "OpenAI Chat Completions", hint: "大多数中转与兼容服务" },
  { value: "openai-responses", label: "OpenAI Responses", hint: "OpenAI 官方与 Codex" },
  { value: "anthropic-messages", label: "Anthropic Messages", hint: "Claude 与兼容服务" },
  { value: "google-generative-ai", label: "Google Gemini", hint: "Gemini API" },
];
const protocolLabel = (p: EndpointProtocol) => PROTOCOLS.find((x) => x.value === p)?.label ?? p;

const PROTOCOL_SHORT: Record<EndpointProtocol, string> = {
  "openai-completions": "Chat Completions",
  "openai-responses": "Responses",
  "anthropic-messages": "Anthropic",
  "google-generative-ai": "Gemini",
};
const protocolShort = (protocol: EndpointProtocol) => PROTOCOL_SHORT[protocol] ?? protocol;

function endpointDisplayLabel(
  e: Provider["endpoints"][number],
  allEndpoints: Provider["endpoints"],
  harnessId?: HarnessId,
): string {
  const proto = protocolShort(e.protocol);
  const clean = e.name.trim();
  const sameProtoCount = allEndpoints.filter((x) => x.protocol === e.protocol).length;
  const gatewaySuffix =
    harnessId &&
    ["claude-code", "gemini"].includes(harnessId) &&
    e.protocol === "openai-completions"
      ? "（网关）"
      : "";
  const showName =
    clean &&
    clean !== "默认" &&
    clean.toLowerCase() !== proto.toLowerCase() &&
    clean.toLowerCase() !== protocolLabel(e.protocol).toLowerCase();
  if (showName || (sameProtoCount > 1 && clean)) {
    return `${proto} · ${clean}${gatewaySuffix}`;
  }
  return `${proto}${gatewaySuffix}`;
}

const isHarnessEndpointCompatible = (harnessId: HarnessId, protocol: EndpointProtocol) =>
  HARNESS_PROVIDER_PROTOCOLS[harnessId].includes(protocol) ||
  (["claude-code", "gemini"].includes(harnessId) && protocol === "openai-completions");

/** Model sources: an account/service (provider) with its endpoints, key and models. */
export function ProviderSettings({
  snapshot,
  act,
  onLoaded,
}: {
  snapshot?: Snapshot;
  act: Action;
  onLoaded?: (data: ProviderConfiguration) => void;
}) {
  const [data, setData] = useState<ProviderConfiguration>(),
    [editing, setEditing] = useState<Provider | null | false>(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    const next = await api<ProviderConfiguration>("/provider-configuration");
    setData(next);
    onLoaded?.(next);
  }, [onLoaded]);
  useEffect(() => {
    void load().catch((e: Error) => setError(e.message));
  }, [load]);
  const run = async (work: () => Promise<unknown>, done?: string | (() => string | undefined)) => {
    setError("");
    setNotice("");
    await act(async () => {
      try {
        await work();
        await load();
        const message = typeof done === "function" ? done() : done;
        if (message) setNotice(message);
      } catch (e) {
        setError(e instanceof Error ? e.message : "操作失败，请重试。");
      }
    });
  };

  return (
    <SettingsPage
      title="模型来源"
      actions={
        <>
          <button
            type="button"
            className="quiet-btn"
            onClick={() =>
              void run(() => api("/model-catalog/refresh", "POST", {}), "模型资料已更新")
            }
          >
            <RefreshCw size={14} /> 更新模型资料
          </button>
          <button type="button" className="primary" onClick={() => setEditing(null)}>
            <Plus size={14} /> 添加来源
          </button>
        </>
      }
    >
      {error && <p className="sx-note is-error">{error}</p>}
      {notice && <p className="sx-note">{notice}</p>}
      {editing !== false && (
        <SettingsSection title={editing ? `编辑 ${editing.name}` : "添加来源"}>
          <ProviderForm
            provider={editing ?? undefined}
            onCancel={() => setEditing(false)}
            onSave={(body) =>
              run(async () => {
                await api("/providers", "POST", { ...body, requestId: crypto.randomUUID() });
                setEditing(false);
              }, "已保存，正在获取模型列表")
            }
          />
        </SettingsSection>
      )}
      {data && data.providers.length === 0 && editing === false && (
        <SettingsSection title="还没有模型来源">
          <div className="sx-empty">
            不添加也可以使用：每个引擎默认用自己的登录与配置。需要统一用某个 API 服务时再添加。
          </div>
        </SettingsSection>
      )}
      {data?.providers.map((p) => (
        <ProviderCard
          key={p.id}
          provider={p}
          providers={data.providers}
          bindings={data.bindings}
          snapshot={snapshot}
          models={data.models.filter((m) => m.providerId === p.id)}
          onEdit={() => setEditing(p)}
          run={run}
        />
      ))}
      {data && (
        <p className="sx-note">
          模型资料：{data.catalog.source.includes("models.dev") ? "models.dev" : "内置目录"} ·{" "}
          {data.catalog.modelCount.toLocaleString()} 个模型
          {data.catalog.checkedAt ? ` · ${formatDate(data.catalog.checkedAt)} 更新` : ""}
          {data.catalog.error ? ` · ${data.catalog.error}` : ""}
        </p>
      )}
    </SettingsPage>
  );
}

function ProviderCard({
  provider: p,
  providers,
  bindings,
  snapshot,
  models,
  onEdit,
  run,
}: {
  provider: Provider;
  providers: Provider[];
  bindings: HarnessBinding[];
  snapshot?: Snapshot;
  models: CatalogModel[];
  onEdit: () => void;
  run: (work: () => Promise<unknown>, done?: string | (() => string | undefined)) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [applying, setApplying] = useState(false);
  const [busyApply, setBusyApply] = useState(false);
  const { settings, update: updatePreferences } = useAppPreferences();
  const [applyError, setApplyError] = useState("");
  const [selectedEndpointId, setSelectedEndpointId] = useState<string>("all");
  const [endpointChoices, setEndpointChoices] = useState<Partial<Record<HarnessId, string>>>({});
  const [expandedConfigId, setExpandedConfigId] = useState<HarnessId | null>(null);
  const [newModel, setNewModel] = useState("");
  const [modelsOpen, setModelsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const failed = p.discovery?.some((d) => d.status === "error");
  const endpoint = p.endpoints[0];
  const allBindings = snapshot?.bindings ?? bindings;
  const harnessBindingIds = snapshot?.bindingDefaults.harnessBindingIds ?? {};
  const activeBindingFor = (harnessId: HarnessId) => {
    const id = harnessBindingIds[harnessId];
    return id ? allBindings.find((b) => b.id === id) : undefined;
  };
  const compatibleHarnesses = [...(snapshot?.harnesses ?? [])]
    .filter((h) => p.endpoints.some((e) => isHarnessEndpointCompatible(h.id, e.protocol)))
    .sort((a, b) => Number(Boolean(b.health?.launchable)) - Number(Boolean(a.health?.launchable)));
  const activeHarnesses = compatibleHarnesses.filter(
    (h) => activeBindingFor(h.id)?.providerId === p.id,
  );
  const appliedHarnessChips: Array<{ id: HarnessId; name: string }> = snapshot
    ? activeHarnesses.map((h) => ({ id: h.id, name: h.name }))
    : [...new Set(bindings.filter((b) => b.providerId === p.id).map((b) => b.harnessId))].map(
        (id) => ({ id, name: HARNESS_NAMES[id] ?? id }),
      );
  const usedBy = appliedHarnessChips.length;

  const lockedEndpoint =
    selectedEndpointId === "all" ? undefined : p.endpoints.find((e) => e.id === selectedEndpointId);
  const modalCompatibleHarnesses = lockedEndpoint
    ? compatibleHarnesses.filter((h) => isHarnessEndpointCompatible(h.id, lockedEndpoint.protocol))
    : compatibleHarnesses;

  const chosenEndpointFor = (harnessId: HarnessId) => {
    if (lockedEndpoint && isHarnessEndpointCompatible(harnessId, lockedEndpoint.protocol)) {
      return lockedEndpoint;
    }
    const compat = p.endpoints.filter((e) => isHarnessEndpointCompatible(harnessId, e.protocol));
    const current = activeBindingFor(harnessId);
    const preferredId =
      endpointChoices[harnessId] ?? (current?.providerId === p.id ? current.endpointId : undefined);
    const nativeDefault = compat.find((e) =>
      HARNESS_PROVIDER_PROTOCOLS[harnessId].includes(e.protocol),
    );
    return compat.find((e) => e.id === preferredId) ?? nativeDefault ?? compat[0];
  };

  const modelsForEndpoint = (endpointId?: string, binding?: HarnessBinding) => {
    const fromCatalog = endpointId
      ? models.filter((m) => m.endpointId === endpointId).map((m) => m.model)
      : models.map((m) => m.model);
    const fromBinding =
      binding && binding.providerId === p.id && (!endpointId || binding.endpointId === endpointId)
        ? (binding.availableModels ?? []).map((m) => m.model)
        : [];
    return [...new Set([...fromBinding, ...fromCatalog])].sort();
  };

  const pruneStalePreset = async (harnessId: HarnessId, endpointId: string) => {
    const validSet = new Set(modelsForEndpoint(endpointId));
    if (validSet.size === 0) return;
    await updatePreferences((current) => {
      const existing = current.harnessDefaults?.[harnessId];
      const pruned = pruneHarnessDefaultsForModels(existing, validSet);
      if (!pruned || pruned === existing) return current;
      const all: AppSettings["harnessDefaults"] = { ...current.harnessDefaults };
      if (
        !pruned.model &&
        !pruned.reasoning &&
        !pruned.permissionMode &&
        !Object.keys(pruned.modelMap ?? {}).length
      ) {
        delete all[harnessId];
      } else {
        all[harnessId] = pruned;
      }
      return { ...current, harnessDefaults: all };
    });
  };

  const updateHarnessModelMap = (
    harnessId: HarnessId,
    mutate: (
      prev: Partial<Record<ClaudeModelSlot, string>>,
    ) => Partial<Record<ClaudeModelSlot, string>>,
  ) => {
    setApplyError("");
    void updatePreferences((current) => {
      const existing = current.harnessDefaults?.[harnessId] ?? {
        model: null,
        reasoning: null,
        permissionMode: null,
        modelMap: {},
      };
      const nextMap = mutate({ ...(existing.modelMap ?? {}) });
      const all: AppSettings["harnessDefaults"] = { ...current.harnessDefaults };
      all[harnessId] = { ...existing, modelMap: nextMap };
      return { ...current, harnessDefaults: all };
    }).catch((e: Error) => setApplyError(e.message));
  };

  const updateHarnessDefaultModel = (harnessId: HarnessId, model: string | null) => {
    setApplyError("");
    void updatePreferences((current) => {
      const existing = current.harnessDefaults?.[harnessId] ?? {
        model: null,
        reasoning: null,
        permissionMode: null,
        modelMap: {},
      };
      const next = { ...existing, model };
      const all: AppSettings["harnessDefaults"] = { ...current.harnessDefaults };
      if (
        !next.model &&
        !next.reasoning &&
        !next.permissionMode &&
        !Object.keys(next.modelMap ?? {}).length
      ) {
        delete all[harnessId];
      } else {
        all[harnessId] = next;
      }
      return { ...current, harnessDefaults: all };
    }).catch((e: Error) => setApplyError(e.message));
  };

  const applyToHarness = async (
    harnessId: HarnessId,
    harnessName: string,
    targetEndpointId?: string,
  ) => {
    const chosen =
      (targetEndpointId ? p.endpoints.find((e) => e.id === targetEndpointId) : undefined) ??
      chosenEndpointFor(harnessId);
    if (!chosen) return;
    setApplyError("");
    setBusyApply(true);
    try {
      const current = activeBindingFor(harnessId);
      const enforceEndpoint = Boolean(targetEndpointId || lockedEndpoint);
      const alreadySame =
        current?.providerId === p.id && (!enforceEndpoint || current.endpointId === chosen.id);
      let localErr = "";
      await run(
        async () => {
          const fresh = await api<Snapshot>("/snapshot");
          try {
            if (alreadySame) {
              await api("/binding-defaults", "PATCH", {
                expectedRevision: fresh.bindingDefaults.revision,
                harnessBindingIds: {
                  ...fresh.bindingDefaults.harnessBindingIds,
                  [harnessId]: null,
                },
              });
            } else {
              await api("/harness-provider-bindings", "POST", {
                harnessId,
                providerId: p.id,
                endpointId: chosen.id,
                expectedDefaultsRevision: fresh.bindingDefaults.revision,
                requestId: crypto.randomUUID(),
              });
            }
          } catch (e) {
            localErr = e instanceof Error ? e.message : "应用失败，请重试。";
            throw e;
          }
        },
        alreadySame
          ? `已将 ${harnessName} 恢复为原生配置`
          : `已将「${p.name}」应用到 ${harnessName}`,
      );
      if (localErr) {
        setApplyError(localErr);
      } else if (alreadySame) {
        setExpandedConfigId((prev) => (prev === harnessId ? null : prev));
      } else {
        await pruneStalePreset(harnessId, chosen.id).catch(() => {});
        if (harnessSupportsModelMap(harnessId)) setExpandedConfigId(harnessId);
      }
    } finally {
      setBusyApply(false);
    }
  };

  const isAppliedOnTarget = (harnessId: HarnessId) => {
    const active = activeBindingFor(harnessId);
    if (!active || active.providerId !== p.id) return false;
    if (lockedEndpoint) return active.endpointId === lockedEndpoint.id;
    return true;
  };

  const unappliedReadyHarnesses = modalCompatibleHarnesses.filter(
    (h) => h.health?.launchable && !isAppliedOnTarget(h.id),
  );

  const applyToAllReady = async () => {
    if (!unappliedReadyHarnesses.length || busyApply) return;
    setApplyError("");
    setBusyApply(true);
    const failures: string[] = [];
    const appliedEndpoints: Array<{ harnessId: HarnessId; endpointId: string }> = [];
    let appliedCount = 0;
    try {
      await run(
        async () => {
          for (const h of unappliedReadyHarnesses) {
            const ep = chosenEndpointFor(h.id);
            if (!ep) continue;
            try {
              const fresh = await api<Snapshot>("/snapshot");
              await api("/harness-provider-bindings", "POST", {
                harnessId: h.id,
                providerId: p.id,
                endpointId: ep.id,
                expectedDefaultsRevision: fresh.bindingDefaults.revision,
                requestId: crypto.randomUUID(),
              });
              appliedCount += 1;
              appliedEndpoints.push({ harnessId: h.id, endpointId: ep.id });
            } catch (e) {
              failures.push(`${h.name}：${e instanceof Error ? e.message : "应用失败"}`);
            }
          }
        },
        () => (appliedCount > 0 ? `已将「${p.name}」应用到 ${appliedCount} 个引擎` : undefined),
      );
      for (const item of appliedEndpoints) {
        await pruneStalePreset(item.harnessId, item.endpointId).catch(() => {});
      }
      const mapped = appliedEndpoints.find((item) => harnessSupportsModelMap(item.harnessId));
      if (mapped) setExpandedConfigId(mapped.harnessId);
      if (failures.length) setApplyError(failures.join("；"));
    } finally {
      setBusyApply(false);
    }
  };

  useEffect(() => {
    if (!applying) {
      setExpandedConfigId(null);
      setSelectedEndpointId("all");
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setApplying(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [applying]);

  const readyHarnesses = modalCompatibleHarnesses.filter((h) => h.health?.launchable);
  const uninstalledHarnesses = modalCompatibleHarnesses.filter((h) => !h.health?.launchable);

  const renderApplyRow = (h: Snapshot["harnesses"][number]) => {
    const compatEndpoints = p.endpoints.filter((e) =>
      isHarnessEndpointCompatible(h.id, e.protocol),
    );
    const activeBinding = activeBindingFor(h.id);
    const isAppliedToProvider = activeBinding?.providerId === p.id;
    const isApplied = isAppliedOnTarget(h.id);
    const chosenEp = chosenEndpointFor(h.id);
    const currentProviderEp =
      isAppliedToProvider && activeBinding
        ? p.endpoints.find((e) => e.id === activeBinding.endpointId)
        : undefined;
    const isOtherEndpointOfSameProvider =
      Boolean(lockedEndpoint) && isAppliedToProvider && !isApplied && Boolean(currentProviderEp);
    const supportsMap = harnessSupportsModelMap(h.id);
    const epModels = modelsForEndpoint(chosenEp?.id, activeBinding);
    const preset = settings.harnessDefaults?.[h.id];
    const map = preset?.modelMap ?? {};
    const mappedEntries = Object.entries(map).filter(([, v]) => Boolean(v));
    const staleMapCount = mappedEntries.filter(
      ([, v]) => Boolean(v) && !epModels.includes(v!),
    ).length;
    const activeDefaultModel = isApplied
      ? supportsMap
        ? (map.main ?? activeBinding?.model)
        : (preset?.model ?? activeBinding?.model)
      : null;
    const canConfigure = isApplied && (supportsMap || epModels.length > 1);
    const showInlineEndpointSelect = !lockedEndpoint && compatEndpoints.length > 1;
    const isExpanded = isApplied && expandedConfigId === h.id;
    const otherProvider =
      activeBinding && activeBinding.providerId !== p.id
        ? (providers.find((item) => item.id === activeBinding.providerId)?.name ??
          activeBinding.name.split(" · ")[0])
        : null;
    const subtext = isApplied
      ? supportsMap
        ? activeDefaultModel
          ? `主模型：${shortModelLabel(activeDefaultModel)}${mappedEntries.length > 1 ? ` · 已自定义 ${mappedEntries.length} 档` : "（其余同主模型）"}`
          : `已将「${p.name}」设为默认`
        : activeDefaultModel
          ? `默认模型：${shortModelLabel(activeDefaultModel)}`
          : `已将「${p.name}」设为默认`
      : isOtherEndpointOfSameProvider && currentProviderEp && lockedEndpoint
        ? `当前使用 ${endpointDisplayLabel(currentProviderEp, p.endpoints, h.id)}，开启后将切换为 ${protocolShort(lockedEndpoint.protocol)}`
        : otherProvider
          ? `当前使用 ${otherProvider}，开启后将切换`
          : h.health?.launchable
            ? supportsMap
              ? "当前使用原生配置 · 开启后可配置角色模型映射"
              : "当前使用原生配置"
            : "当前未安装，仍可预先配置";

    return (
      <div
        key={h.id}
        className={`sx-apply-row ${isApplied ? "is-active" : ""} ${isExpanded ? "is-expanded" : ""}`}
      >
        <div className="sx-apply-row__head">
          <button
            type="button"
            className="sx-apply-row__btn"
            aria-pressed={isApplied}
            disabled={busyApply}
            onClick={() => void applyToHarness(h.id, h.name, lockedEndpoint?.id)}
          >
            <HarnessBadge harnessId={h.id} size="sm" tone="tinted" />
            <span className="sx-apply-row__text">
              <span className="sx-apply-row__title">
                <strong>{h.name}</strong>
                {isApplied ? (
                  <span className="sx-apply-status is-applied">已应用</span>
                ) : isOtherEndpointOfSameProvider && currentProviderEp ? (
                  <span className="sx-apply-status is-other">
                    当前 {protocolShort(currentProviderEp.protocol)}
                  </span>
                ) : otherProvider ? (
                  <span className="sx-apply-status is-other">{otherProvider}</span>
                ) : supportsMap ? (
                  <span className="sx-apply-status is-map">支持映射</span>
                ) : null}
                {!showInlineEndpointSelect &&
                  chosenEp &&
                  p.endpoints.length > 1 &&
                  !lockedEndpoint && (
                    <span className="sx-apply-status is-proto">
                      {protocolShort(chosenEp.protocol)}
                    </span>
                  )}
                {isApplied && staleMapCount > 0 && (
                  <span className="sx-apply-status is-warn">需核对映射</span>
                )}
              </span>
              <small>{subtext}</small>
            </span>
          </button>

          <div className="sx-apply-row__right">
            {showInlineEndpointSelect && (
              <select
                className="sx-apply-ep-select"
                aria-label={`${h.name} 使用的端点协议`}
                value={chosenEp?.id ?? ""}
                disabled={busyApply}
                onChange={(e) => {
                  const nextEpId = e.target.value;
                  setEndpointChoices((prev) => ({ ...prev, [h.id]: nextEpId }));
                  if (isAppliedToProvider) void applyToHarness(h.id, h.name, nextEpId);
                }}
              >
                {compatEndpoints.map((ep) => (
                  <option key={ep.id} value={ep.id}>
                    {endpointDisplayLabel(ep, p.endpoints, h.id)}
                  </option>
                ))}
              </select>
            )}
            {canConfigure && (
              <button
                type="button"
                className={`sx-apply-cfg-btn ${isExpanded ? "is-open" : ""}`}
                aria-expanded={isExpanded}
                aria-label={supportsMap ? `配置 ${h.name} 模型映射` : `配置 ${h.name} 默认模型`}
                onClick={() => setExpandedConfigId((prev) => (prev === h.id ? null : h.id))}
              >
                <span>
                  {supportsMap
                    ? mappedEntries.length > 0
                      ? `映射 ${mappedEntries.length}/5`
                      : "模型映射"
                    : "选模型"}
                </span>
                <ChevronDown size={12} className="sx-apply-cfg-btn__chevron" />
              </button>
            )}
            <button
              type="button"
              className="sx-apply-switch-hit"
              role="switch"
              aria-checked={isApplied}
              aria-label={
                isApplied ? `取消 ${h.name} 的「${p.name}」配置` : `将「${p.name}」应用到 ${h.name}`
              }
              disabled={busyApply}
              onClick={() => void applyToHarness(h.id, h.name, lockedEndpoint?.id)}
            >
              <span className={`sx-ios-switch ${isApplied ? "is-on" : ""}`} aria-hidden="true">
                <span className="sx-ios-switch__thumb" />
              </span>
            </button>
          </div>
        </div>

        {isExpanded && (
          <div className="sx-apply-drawer" aria-label={`${h.name} 模型配置`}>
            {compatEndpoints.length > 1 && (
              <div className="sx-apply-drawer__row">
                <label className="sx-apply-drawer__label" htmlFor={`apply-ep-${p.id}-${h.id}`}>
                  <span>端点协议</span>
                  <small>切换后立即生效并同步可用模型</small>
                </label>
                <select
                  id={`apply-ep-${p.id}-${h.id}`}
                  className="sx-apply-drawer__select"
                  value={chosenEp?.id ?? ""}
                  disabled={busyApply}
                  onChange={(e) => {
                    const nextEpId = e.target.value;
                    setEndpointChoices((prev) => ({ ...prev, [h.id]: nextEpId }));
                    void applyToHarness(h.id, h.name, nextEpId);
                  }}
                >
                  {compatEndpoints.map((ep) => (
                    <option key={ep.id} value={ep.id}>
                      {endpointDisplayLabel(ep, p.endpoints, h.id)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {supportsMap ? (
              <>
                <div className="sx-apply-drawer__head">
                  <span>角色模型映射</span>
                  <div className="sx-apply-drawer__tools">
                    <button
                      type="button"
                      className="sx-apply-mini-btn"
                      disabled={epModels.length === 0}
                      onClick={() =>
                        updateHarnessModelMap(h.id, () =>
                          suggestClaudeModelMap(epModels, activeBinding?.model),
                        )
                      }
                    >
                      <Sparkles size={11} /> 智能匹配
                    </button>
                    {mappedEntries.length > 0 && (
                      <button
                        type="button"
                        className="sx-apply-mini-btn"
                        onClick={() => updateHarnessModelMap(h.id, () => ({}))}
                      >
                        恢复同主模型
                      </button>
                    )}
                  </div>
                </div>
                <div className="sx-apply-map-list">
                  {CLAUDE_MODEL_MAP_SLOTS.map(({ slot, shortLabel, hint }) => {
                    const val = map[slot] ?? "";
                    const isStale = Boolean(val) && !epModels.includes(val);
                    const selectId = `apply-map-${p.id}-${h.id}-${slot}`;
                    return (
                      <div key={slot} className="sx-apply-drawer__row">
                        <label className="sx-apply-drawer__label" htmlFor={selectId} title={hint}>
                          <span>{shortLabel}</span>
                          <small>{hint}</small>
                        </label>
                        <select
                          id={selectId}
                          className={`sx-apply-drawer__select ${isStale ? "is-stale" : ""}`}
                          value={val}
                          onChange={(e) => {
                            const nextVal = e.target.value;
                            updateHarnessModelMap(h.id, (prev) => {
                              if (nextVal) prev[slot] = nextVal;
                              else delete prev[slot];
                              return prev;
                            });
                          }}
                        >
                          <option value="">
                            {slot === "main"
                              ? `来源默认（${shortModelLabel(activeBinding?.model ?? epModels[0] ?? "")}）`
                              : "同主模型"}
                          </option>
                          {isStale && <option value={val}>⚠ {val}（当前来源无此模型）</option>}
                          {epModels.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="sx-apply-drawer__row">
                <label className="sx-apply-drawer__label" htmlFor={`apply-model-${p.id}-${h.id}`}>
                  <span>新对话默认模型</span>
                  <small>留空则使用当前来源的默认模型</small>
                </label>
                <select
                  id={`apply-model-${p.id}-${h.id}`}
                  className="sx-apply-drawer__select"
                  value={preset?.model ?? ""}
                  onChange={(e) => updateHarnessDefaultModel(h.id, e.target.value || null)}
                >
                  <option value="">
                    来源默认（{shortModelLabel(activeBinding?.model ?? epModels[0] ?? "")}）
                  </option>
                  {preset?.model && !epModels.includes(preset.model) && (
                    <option value={preset.model}>⚠ {preset.model}（当前来源无此模型）</option>
                  )}
                  {epModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const trimmedQuery = query.trim().toLowerCase();
  const visibleModels = trimmedQuery
    ? models.filter(
        (m) =>
          m.model.toLowerCase().includes(trimmedQuery) ||
          (m.name?.toLowerCase().includes(trimmedQuery) ?? false),
      )
    : models;
  return (
    <SettingsSection
      title={
        <div className="sx-provider-title-wrap">
          <span className="sx-provider-name">{p.name}</span>
          <div className="sx-provider-tags">
            {failed ? (
              <StatusDot tone="warn">需检查</StatusDot>
            ) : (
              <StatusDot tone="ok">已连接</StatusDot>
            )}
            <span className="sx-tag">{models.length} 个模型</span>
            {appliedHarnessChips.length > 0 ? (
              <div
                className="sx-applied-harnesses"
                aria-label={`已应用到 ${appliedHarnessChips.map((h) => h.name).join("、")}`}
              >
                {appliedHarnessChips.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    className={`sx-tag sx-tag--btn sx-tag--applied ${applying ? "is-active" : ""}`}
                    title={`已应用到 ${h.name}，点击调整应用范围`}
                    onClick={() => {
                      setApplying(true);
                      setApplyError("");
                    }}
                  >
                    <HarnessGlyph harnessId={h.id} size={11} />
                    <span>{h.name}</span>
                  </button>
                ))}
              </div>
            ) : (
              <button
                type="button"
                className={`sx-tag sx-tag--btn ${applying ? "is-active" : ""}`}
                onClick={() => {
                  setApplying(true);
                  setApplyError("");
                }}
              >
                尚未被引擎使用
              </button>
            )}
          </div>
        </div>
      }
      actions={
        <>
          <button
            type="button"
            className={`quiet-btn ${applying ? "is-active" : ""}`}
            aria-haspopup="dialog"
            onClick={() => {
              setApplying(true);
              setApplyError("");
            }}
          >
            <Link2 size={12} /> 应用到
          </button>
          <button type="button" className="quiet-btn" onClick={() => setAdding((v) => !v)}>
            <Plus size={12} /> 手动添加
          </button>
          <button type="button" className="quiet-btn" onClick={onEdit}>
            编辑
          </button>
          <button
            type="button"
            className="quiet-btn"
            aria-label={`删除 ${p.name}`}
            onClick={() => {
              if (
                window.confirm(
                  `删除模型来源「${p.name}」？${usedBy ? `有 ${usedBy} 个引擎正在使用它，会改回各自的登录配置。` : ""}已有对话不受影响。`,
                )
              )
                void run(() => api(`/providers/${p.id}`, "DELETE"), "已删除");
            }}
          >
            <Trash2 size={13} />
          </button>
        </>
      }
    >
      {failed && <div className="sx-provider-alert">获取模型列表失败，请检查地址和密钥配置。</div>}

      <div className="sx-endpoints-list">
        {p.endpoints.map((e) => (
          <div key={e.id} className="sx-endpoint-row">
            <div className="sx-endpoint-meta">
              <span className="sx-protocol-badge">{protocolLabel(e.protocol)}</span>
              <code className="sx-endpoint-url" title={e.baseUrl}>
                {e.baseUrl}
              </code>
              {e.credentialRef ? (
                <span className="sx-cred-badge is-saved" title="已加密保存在凭据库">
                  <KeyRound size={11} /> 已保存密钥
                </span>
              ) : (
                <span className="sx-cred-badge is-empty" title="未配置密钥">
                  未设密钥
                </span>
              )}
            </div>
            <button
              type="button"
              className="sx-endpoint-refresh"
              onClick={() =>
                void run(
                  () => api(`/providers/${p.id}/endpoints/${e.id}/models/refresh`, "POST", {}),
                  "模型列表已更新",
                )
              }
            >
              <RefreshCw size={12} /> 获取模型{p.endpoints.length > 1 ? ` · ${e.name}` : ""}
            </button>
          </div>
        ))}
      </div>

      {applying &&
        createPortal(
          <div
            className="sx-apply-backdrop"
            role="presentation"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setApplying(false);
            }}
          >
            <div
              className="sx-apply-modal"
              role="dialog"
              aria-modal="true"
              aria-label={`将 ${p.name} 应用到引擎`}
            >
              <div className="sx-apply-modal__handle" aria-hidden="true" />
              <header className="sx-apply-modal__head">
                <div className="sx-apply-modal__copy">
                  <div className="sx-apply-modal__title-row">
                    <h3>应用到引擎</h3>
                    <span className="sx-tag">{p.name}</span>
                  </div>
                  <p>开启即将此来源设为引擎默认，关闭后恢复原生配置。</p>
                </div>
                <button
                  type="button"
                  className="icon-button sx-apply-modal__close"
                  aria-label="关闭"
                  onClick={() => setApplying(false)}
                >
                  <X size={16} />
                </button>
              </header>

              {p.endpoints.length > 1 ? (
                <div className="sx-apply-ep-bar" role="tablist" aria-label="选择目标端点协议">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={selectedEndpointId === "all"}
                    className={`sx-apply-ep-pill ${selectedEndpointId === "all" ? "is-active" : ""}`}
                    onClick={() => setSelectedEndpointId("all")}
                  >
                    全部端点
                  </button>
                  {p.endpoints.map((ep) => {
                    const count = modelsForEndpoint(ep.id).length;
                    const active = selectedEndpointId === ep.id;
                    return (
                      <button
                        key={ep.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        className={`sx-apply-ep-pill ${active ? "is-active" : ""}`}
                        onClick={() => setSelectedEndpointId(ep.id)}
                      >
                        <span>{endpointDisplayLabel(ep, p.endpoints)}</span>
                        <small>{count}</small>
                      </button>
                    );
                  })}
                </div>
              ) : endpoint ? (
                <div className="sx-apply-ep-single">
                  <div className="sx-apply-ep-single__info">
                    <span className="sx-protocol-badge">{protocolShort(endpoint.protocol)}</span>
                    <code title={endpoint.baseUrl}>{endpoint.baseUrl}</code>
                  </div>
                  <button
                    type="button"
                    className="sx-apply-mini-btn"
                    onClick={() => {
                      setApplying(false);
                      onEdit();
                    }}
                  >
                    + 添加其他协议端点
                  </button>
                </div>
              ) : null}

              <div className="sx-apply-modal__body">
                {models.length === 0 ? (
                  <div className="sx-apply-empty">
                    此来源还没有可用模型，请先关闭后点击「获取模型」或「手动添加」。
                  </div>
                ) : lockedEndpoint && modelsForEndpoint(lockedEndpoint.id).length === 0 ? (
                  <div className="sx-apply-empty">
                    「{endpointDisplayLabel(lockedEndpoint, p.endpoints)}
                    」端点暂无可用模型，请先关闭后点击「获取模型 · {lockedEndpoint.name}
                    」或手动添加。
                  </div>
                ) : modalCompatibleHarnesses.length === 0 ? (
                  <div className="sx-apply-empty">当前没有与此端点协议兼容的引擎。</div>
                ) : (
                  <>
                    {readyHarnesses.length > 0 && (
                      <div className="sx-apply-section">
                        <div className="sx-apply-section__label">
                          <span>已安装兼容引擎</span>
                          <span>
                            {readyHarnesses.filter((h) => isAppliedOnTarget(h.id)).length} /{" "}
                            {readyHarnesses.length}
                          </span>
                        </div>
                        <div className="sx-apply-group">{readyHarnesses.map(renderApplyRow)}</div>
                      </div>
                    )}
                    {uninstalledHarnesses.length > 0 && (
                      <div className="sx-apply-section is-muted">
                        <div className="sx-apply-section__label">
                          <span>未安装引擎</span>
                          <span>{uninstalledHarnesses.length}</span>
                        </div>
                        <div className="sx-apply-group">
                          {uninstalledHarnesses.map(renderApplyRow)}
                        </div>
                      </div>
                    )}
                  </>
                )}
                {applyError && (
                  <p className="sx-provider-apply__error" role="alert">
                    {applyError}
                  </p>
                )}
              </div>

              <footer className="sx-apply-modal__foot">
                <div className="sx-apply-modal__foot-left">
                  {models.length > 0 && unappliedReadyHarnesses.length > 0 ? (
                    <button
                      type="button"
                      className="quiet-btn"
                      disabled={busyApply}
                      onClick={() => void applyToAllReady()}
                    >
                      应用到全部已安装 ({unappliedReadyHarnesses.length})
                    </button>
                  ) : (
                    <span className="sx-apply-modal__summary">
                      {usedBy > 0 ? `已应用到 ${usedBy} 个引擎` : "暂未应用到任何引擎"}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className="primary sx-apply-modal__done"
                  onClick={() => setApplying(false)}
                >
                  完成
                </button>
              </footer>
            </div>
          </div>,
          document.body,
        )}

      {adding && endpoint && (
        <form
          className="sx-form sx-provider-add-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api("/provider-models", "POST", {
                providerId: p.id,
                endpointId: endpoint.id,
                model: newModel.trim(),
                requestId: crypto.randomUUID(),
              });
              setNewModel("");
              setAdding(false);
              setModelsOpen(true);
            }, "已添加");
          }}
        >
          <SettingsRow label="模型 ID" htmlFor={`add-${p.id}`}>
            <input
              id={`add-${p.id}`}
              required
              value={newModel}
              onChange={(e) => setNewModel(e.target.value)}
              placeholder="例如 deepseek-v4.1-flash"
            />
            <button className="primary">添加</button>
          </SettingsRow>
        </form>
      )}

      <div className="sx-provider-models">
        <div className="sx-provider-models__bar">
          <button
            type="button"
            className={`sx-provider-models__toggle ${modelsOpen ? "is-open" : ""}`}
            aria-expanded={modelsOpen}
            onClick={() => setModelsOpen((v) => !v)}
          >
            <ChevronDown size={14} className="sx-provider-models__chevron" aria-hidden="true" />
            <span>模型列表</span>
            <span className="sx-provider-models__count">{models.length}</span>
          </button>
          {modelsOpen && models.length > 6 && (
            <label className="sx-provider-models__search">
              <Search size={13} aria-hidden="true" />
              <input
                type="search"
                aria-label={`筛选 ${p.name} 的模型`}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="筛选模型…"
              />
            </label>
          )}
        </div>
        {modelsOpen &&
          (models.length === 0 ? (
            <div className="sx-provider-models__empty">
              此来源暂无模型，点击上方「获取模型」或「手动添加」。
            </div>
          ) : (
            <ModelTable
              provider={p}
              models={visibleModels}
              providers={providers}
              emptyMessage={trimmedQuery ? `未找到匹配「${query.trim()}」的模型` : undefined}
              run={run}
            />
          ))}
      </div>
    </SettingsSection>
  );
}

function num(v?: number) {
  return v === undefined ? "—" : v.toLocaleString();
}
function ModelTable({
  provider,
  models,
  providers,
  emptyMessage,
  run,
}: {
  provider: Provider;
  models: CatalogModel[];
  providers: Provider[];
  emptyMessage?: string;
  run: (work: () => Promise<unknown>, done?: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [selectedSources, setSelectedSources] = useState<Record<string, string>>({});
  const showEndpoint = provider.endpoints.length > 1;
  const colCount = showEndpoint ? 7 : 6;
  const endpointName = (model: CatalogModel) =>
    provider.endpoints.find((item) => item.id === model.endpointId)?.name ?? model.endpointId;
  return (
    <div className="table-scroll sx-model-table-card">
      <table className="sx-table sx-model-table" aria-label="模型列表">
        <thead>
          <tr>
            <th>模型</th>
            {showEndpoint && <th>接口</th>}
            <th className="num">上下文</th>
            <th className="num">最大输出</th>
            <th>思考档位</th>
            <th>模型价格</th>
            <th className="num" aria-label="操作" />
          </tr>
        </thead>
        <tbody>
          {groupCatalogModels(models).map(({ model, sources }) => {
            const m = sources.find((source) => source.id === selectedSources[model]) ?? sources[0]!;
            const levels = bindingReasoningLevels(m.effective) ?? [];
            return editing === m.id ? (
              <ModelEditRow
                key={m.id}
                model={m}
                source={catalogModelSource(m, providers)}
                colSpan={colCount}
                onDone={() => setEditing(null)}
                run={run}
              />
            ) : (
              <tr key={m.id}>
                <td className="model-identity">
                  <div className="sx-model-name-row">
                    <span className="sx-model-name" title={m.model}>
                      {m.model}
                    </span>
                    {Object.keys(m.overrides).length > 0 && (
                      <span className="sx-edited">已修改</span>
                    )}
                  </div>
                  <span className="provider-help">
                    {m.effective.input?.includes("image")
                      ? "文本 · 图片"
                      : m.effective.input?.includes("text")
                        ? "文本"
                        : "输入模态待确认"}
                  </span>
                </td>
                {showEndpoint && (
                  <td className="model-source" data-label="接口">
                    {sources.length > 1 ? (
                      <SxSelect
                        compact
                        ariaLabel={`模型 ${model} 的来源`}
                        value={m.id}
                        onChange={(nextId) => {
                          setSelectedSources((previous) => ({
                            ...previous,
                            [model]: nextId,
                          }));
                          setEditing(null);
                        }}
                        options={sources.map((source) => ({
                          value: source.id,
                          label: endpointName(source),
                        }))}
                      />
                    ) : (
                      <span className="sx-source-pill">{endpointName(m)}</span>
                    )}
                  </td>
                )}
                <td className="num model-limit" data-label="上下文">
                  {num(m.effective.contextWindow)}
                </td>
                <td className="num model-limit" data-label="最大输出">
                  {num(m.effective.maxOutputTokens)}
                </td>
                <td data-label="思考档位" className="model-reasoning-cell">
                  {levels.length > 0 ? (
                    <div className="sx-tier-chips">
                      {levels.map((lvl) => (
                        <span key={lvl} className="sx-tier-chip">
                          {lvl}
                        </span>
                      ))}
                    </div>
                  ) : m.effective.reasoning === false ? (
                    <span className="sx-tier-none">不支持</span>
                  ) : (
                    <span className="sx-tier-none">—</span>
                  )}
                </td>
                <td className="model-pricing-cell" data-label="模型价格">
                  <ModelPricingSummary pricing={m.effective.pricing} />
                </td>
                <td className="num model-actions">
                  <button type="button" onClick={() => setEditing(m.id)}>
                    修改
                  </button>
                </td>
              </tr>
            );
          })}
          {models.length === 0 && (
            <tr>
              <td colSpan={colCount} className="sx-provider-models__empty">
                {emptyMessage ?? "此来源暂无模型"}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ModelEditRow({
  model: m,
  source,
  colSpan,
  onDone,
  run,
}: {
  model: CatalogModel;
  source: string;
  colSpan: number;
  onDone: () => void;
  run: (work: () => Promise<unknown>, done?: string) => Promise<void>;
}) {
  const o = m.overrides;
  const [context, setContext] = useState(o.contextWindow?.toString() ?? "");
  const [output, setOutput] = useState(o.maxOutputTokens?.toString() ?? "");
  const [inputMode, setInputMode] = useState(
    o.input ? (o.input.includes("image") ? "image" : "text") : "auto",
  );
  const [prices, setPrices] = usePricingDraft(o.pricing, m.automatic.pricing);
  const save = (overrides: ModelParameters) =>
    (async () => {
      await api("/provider-models", "POST", {
        id: m.id,
        expectedRevision: m.revision,
        providerId: m.providerId,
        endpointId: m.endpointId,
        model: m.model,
        overrides,
        requestId: crypto.randomUUID(),
      });
      onDone();
    })();
  const auto = m.automatic;
  return (
    <tr className="is-editing">
      <td colSpan={colSpan}>
        <form
          className="sx-model-editor"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const next: ModelParameters = { ...o };
              next.contextWindow = context.trim() ? Number(context) : undefined;
              next.maxOutputTokens = output.trim() ? Number(output) : undefined;
              next.input =
                inputMode === "auto"
                  ? undefined
                  : inputMode === "image"
                    ? ["text", "image"]
                    : ["text"];
              next.pricing = readPricingDraft(prices);
              for (const key of Object.keys(next) as (keyof ModelParameters)[])
                if (next[key] === undefined) delete next[key];
              await save(next);
            });
          }}
        >
          <h4>{m.model}</h4>
          <p className="provider-help">当前来源：{source}</p>
          <label>
            输入模态
            <select
              aria-label="输入模态"
              value={inputMode}
              onChange={(e) => setInputMode(e.target.value)}
            >
              <option value="auto">自动（models.dev / 当前端点）</option>
              <option value="text">仅文本</option>
              <option value="image">文本与图片</option>
            </select>
          </label>
          <p className="provider-help">
            自动识别：
            {auto.input?.includes("image")
              ? "文本与图片"
              : auto.input?.includes("text")
                ? "仅文本"
                : "尚未确认"}
            。手动配置优先，选择自动可恢复目录设置。
          </p>
          <div className="model-pricing-grid">
            <label>
              上下文窗口
              <input
                aria-label="上下文窗口"
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                value={context}
                placeholder={num(auto.contextWindow)}
                onChange={(e) => setContext(e.target.value)}
              />
            </label>
            <label>
              最大输出
              <input
                aria-label="最大输出"
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                value={output}
                placeholder={num(auto.maxOutputTokens)}
                onChange={(e) => setOutput(e.target.value)}
              />
            </label>
          </div>
          <ModelPricingEditor draft={prices} onChange={setPrices} automatic={auto.pricing} />
          <div className="sx-form__actions">
            <button type="submit" className="primary">
              保存
            </button>{" "}
            {Object.keys(o).length > 0 && (
              <button type="button" onClick={() => void run(() => save({}), "已恢复自动")}>
                恢复自动
              </button>
            )}{" "}
            <button type="button" onClick={onDone}>
              取消
            </button>{" "}
            <button
              type="button"
              aria-label={`删除 ${m.model}`}
              onClick={() => {
                if (window.confirm(`从列表移除 ${m.model}？`))
                  void run(() => api(`/provider-models/${m.id}`, "DELETE"), "已移除");
              }}
            >
              <Trash2 size={12} />
            </button>
          </div>
        </form>
      </td>
    </tr>
  );
}

type EndpointDraft = {
  id?: string;
  name: string;
  protocol: EndpointProtocol;
  baseUrl: string;
  apiKey: string;
  hasKey: boolean;
  clearCredential: boolean;
};

function ProviderForm({
  provider,
  onCancel,
  onSave,
}: {
  provider?: Provider;
  onCancel: () => void;
  onSave: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [name, setName] = useState(provider?.name ?? "");
  const [endpoints, setEndpoints] = useState<EndpointDraft[]>(
    provider?.endpoints.map((e) => ({
      id: e.id,
      name: e.name,
      protocol: e.protocol,
      baseUrl: e.baseUrl,
      apiKey: "",
      hasKey: Boolean(e.credentialRef),
      clearCredential: false,
    })) ?? [
      {
        name: "默认",
        protocol: "openai-completions",
        baseUrl: "",
        apiKey: "",
        hasKey: false,
        clearCredential: false,
      },
    ],
  );
  const [busy, setBusy] = useState(false);
  const change = (i: number, patch: Partial<EndpointDraft>) =>
    setEndpoints((old) => old.map((e, n) => (n === i ? { ...e, ...patch } : e)));
  return (
    <form
      className="sx-form"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        void onSave({
          ...(provider ? { id: provider.id, expectedRevision: provider.revision } : {}),
          name: name.trim(),
          ...(provider?.catalogProvider ? { catalogProvider: provider.catalogProvider } : {}),
          endpoints: endpoints.map((d) => ({
            ...(d.id ? { id: d.id } : {}),
            name: d.name.trim() || "默认",
            protocol: d.protocol,
            baseUrl: d.baseUrl.trim(),
            ...(d.apiKey ? { apiKey: d.apiKey } : {}),
            ...(d.clearCredential ? { clearCredential: true } : {}),
          })),
        }).finally(() => setBusy(false));
      }}
    >
      <SettingsRow label="名称" htmlFor="pv-name">
        <input
          id="pv-name"
          required
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </SettingsRow>
      {endpoints.map((d, i) => (
        <div key={d.id ?? i}>
          {endpoints.length > 1 && (
            <SettingsRow label={`接口 ${i + 1}`}>
              <input
                aria-label="接口名称"
                value={d.name}
                onChange={(e) => change(i, { name: e.target.value })}
              />
              <button
                type="button"
                onClick={() => setEndpoints((old) => old.filter((_, n) => n !== i))}
              >
                移除
              </button>
            </SettingsRow>
          )}
          <SettingsRow label="接口格式">
            <SxSelect
              ariaLabel="接口格式"
              value={d.protocol}
              onChange={(value) => change(i, { protocol: value as EndpointProtocol })}
              options={PROTOCOLS.map((p) => ({
                value: p.value,
                label: p.label,
              }))}
            />
          </SettingsRow>
          <SettingsRow label="接口地址">
            <input
              aria-label="接口地址"
              type="url"
              required
              value={d.baseUrl}
              onChange={(e) => change(i, { baseUrl: e.target.value })}
              placeholder="https://api.example.com/v1"
            />
          </SettingsRow>
          <SettingsRow
            label="API Key"
            description={
              d.hasKey
                ? "已保存在系统凭据库；留空保持不变。"
                : "保存在系统凭据库，不写入任何配置文件。"
            }
          >
            <input
              aria-label="API Key"
              type="password"
              autoComplete="new-password"
              value={d.apiKey}
              onChange={(e) => change(i, { apiKey: e.target.value, clearCredential: false })}
              placeholder={d.hasKey ? "••••••••" : "sk-…"}
            />
            {d.hasKey && (
              <button
                type="button"
                className={d.clearCredential ? "is-active" : ""}
                onClick={() => change(i, { clearCredential: !d.clearCredential, apiKey: "" })}
              >
                {d.clearCredential ? "将移除密钥" : "移除密钥"}
              </button>
            )}
          </SettingsRow>
        </div>
      ))}
      <div className="sx-form__actions">
        <button
          type="button"
          style={{ marginRight: "auto" }}
          disabled={endpoints.length >= 12}
          onClick={() =>
            setEndpoints((old) => [
              ...old,
              {
                name: `接口 ${old.length + 1}`,
                protocol: "anthropic-messages",
                baseUrl: old[0]?.baseUrl ?? "",
                apiKey: "",
                hasKey: false,
                clearCredential: false,
              },
            ])
          }
        >
          <Plus size={13} /> 再加一种接口格式
        </button>
        <button type="button" onClick={onCancel}>
          取消
        </button>
        <button className="primary" disabled={busy}>
          {busy ? "正在保存…" : "保存"}
        </button>
      </div>
    </form>
  );
}
