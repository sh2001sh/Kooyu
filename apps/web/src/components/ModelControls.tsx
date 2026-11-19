import { useEffect, useMemo, useRef, useState } from "react";
import type {
  HarnessBinding,
  HarnessModelOption,
  HarnessModelSupport,
  Session,
} from "@kodo/protocol";
import { api, HostError } from "../lib/host-client";
import { modelChoiceLabels, shortModelLabel, modelOptionValue } from "../lib/harnesses";
import { ComposerModelControls } from "./ComposerModelControls";

type Options = {
  session: Session;
  models: HarnessModelOption[];
  nativeCatalog: boolean;
  effectiveModel?: string | null;
  defaultModel?: { provider?: string; model: string } | null;
};
type Action = (work: () => Promise<unknown>) => Promise<void>;

export function ModelControls({
  session,
  binding,
  modelSupport = "binding-or-model",
  nativeDefaults,
  disabled,
  act,
}: {
  session: Session;
  binding?: HarnessBinding;
  modelSupport?: HarnessModelSupport;
  nativeDefaults?: { model: string | null; reasoning: string | null } | null;
  disabled: boolean;
  act: Action;
}) {
  const [modelOpen, setModelOpen] = useState(false);
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const [options, setOptions] = useState<Options>();
  const [query, setQuery] = useState("");
  const [reasoning, setReasoning] = useState(session.reasoning ?? "");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleModelOpenChange = (next: boolean) => {
    setModelOpen(next);
    if (next) setReasoningOpen(false);
  };

  const handleReasoningOpenChange = (next: boolean) => {
    setReasoningOpen(next);
    if (next) setModelOpen(false);
  };

  const value = (m: HarnessModelOption) => modelOptionValue(session.harnessId, m, Boolean(binding));
  const choices = useMemo(() => {
    const unique = new Map<string, HarnessModelOption>();
    for (const model of options?.models ?? []) {
      const key = value(model);
      if (!unique.has(key)) unique.set(key, model);
    }
    return [...unique.values()];
  }, [options, binding]);
  const defaultModelId = options?.defaultModel
    ? `${options.defaultModel.provider ? `${options.defaultModel.provider}/` : ""}${options.defaultModel.model}`
    : "";
  const activeId =
    session.model ??
    options?.effectiveModel ??
    binding?.model ??
    (defaultModelId || nativeDefaults?.model || "");
  const matches = choices.filter((m) => value(m) === activeId || m.resolvedModel === activeId);
  const selected =
    matches.find((m) => m.reasoning !== undefined) ??
    matches[0] ??
    (!session.model
      ? (choices.find((m) => m.isCurrent) ?? choices.find((m) => m.isDefault))
      : undefined);
  const levels = selected?.reasoning ?? [];
  const trimmedQuery = query.trim();
  const visible = choices
    .filter(
      (m) =>
        !trimmedQuery ||
        `${value(m)} ${m.name ?? ""}`
          .toLocaleLowerCase()
          .includes(trimmedQuery.toLocaleLowerCase()),
    )
    .slice(0, 80);

  useEffect(() => {
    setReasoning(session.reasoning ?? "");
  }, [session.id, session.reasoning]);

  const loadedSessionRef = useRef<string | null>(null);
  useEffect(() => {
    const isSessionChange = loadedSessionRef.current !== session.id;
    if (!isSessionChange && !modelOpen) return;
    loadedSessionRef.current = session.id;
    let current = true;
    setLoading(true);
    setError("");
    const refresh =
      modelOpen && session.phase === "native" && session.connectionState === "connected";
    const discover = modelOpen && !refresh;
    void api<Options>(
      `/sessions/${session.id}/settings${refresh ? "?refresh=1" : discover ? "?discover=1" : ""}`,
    )
      .then((result) => {
        if (current) setOptions(result);
      })
      .catch((e) => {
        if (current) setError(e instanceof Error ? e.message : "读取模型失败");
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [session.id, modelOpen]);

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      const q =
        session.phase === "native" && session.connectionState === "connected"
          ? "refresh=1"
          : "discover=1";
      setOptions(await api<Options>(`/sessions/${session.id}/settings?${q}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取原生模型失败");
    } finally {
      setLoading(false);
    }
  };

  const commit = (model: string | null, effort: string | null, close: boolean) => {
    if (saving || loading || disabled || !options) return;
    setSaving(true);
    setError("");
    void act(async () => {
      const body = {
        requestId: crypto.randomUUID(),
        expectedRevision: Math.max(
          options.session.settingsRevision ?? 0,
          session.settingsRevision ?? 0,
        ),
        model,
        reasoning: effort,
      };
      try {
        let updated: Session;
        try {
          updated = await api<Session>(`/sessions/${session.id}/settings`, "POST", body);
        } catch (e) {
          if (e instanceof HostError) throw e;
          updated = await api<Session>(
            `/sessions/${session.id}/settings?requestId=${body.requestId}`,
          );
          if (
            updated.settingsRevision !== body.expectedRevision + 1 ||
            updated.model !== model ||
            updated.reasoning !== effort
          )
            throw new Error("模型设置结果未确认，请重新读取后选择。");
        }
        setOptions((prev) => (prev ? { ...prev, session: updated } : prev));
        if (close) setModelOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "模型设置失败");
      } finally {
        setSaving(false);
      }
    });
  };

  const itemDisabled = saving || loading || !options;
  const topItems = !trimmedQuery
    ? [
        {
          key: "__native__",
          title: binding
            ? binding.selectionMode === "provider"
              ? "Provider 默认模型"
              : "绑定默认模型"
            : "原生配置与登录",
          subtitle: binding
            ? `当前：${shortModelLabel(binding.model)}${binding.reasoning ? ` · ${binding.reasoning}` : ""}`
            : nativeDefaults?.model
              ? `当前：${shortModelLabel(nativeDefaults.model)}${nativeDefaults.reasoning ? ` · ${nativeDefaults.reasoning}` : ""}`
              : undefined,
          selected: !session.model,
          disabled: itemDisabled,
          onSelect: () => commit(null, null, true),
        },
      ]
    : [];

  const labels = modelChoiceLabels(visible, value);
  const modelItems = visible.map((m) => {
    const id = value(m);
    const active = activeId === id;
    const { title, subtitle } = labels.get(m)!;
    return {
      key: `${m.provider ?? ""}:${m.id}`,
      dataValue: id,
      title,
      subtitle,
      selected: active,
      disabled: itemDisabled,
      onSelect: () => commit(id, null, true),
    };
  });

  const hasExactMatch = choices.some(
    (m) => value(m).toLocaleLowerCase() === trimmedQuery.toLocaleLowerCase(),
  );
  const customItem =
    trimmedQuery && !hasExactMatch
      ? {
          key: `__custom__:${trimmedQuery}`,
          title: `使用模型 “${trimmedQuery}”`,
          selected: false,
          accent: true,
          disabled: itemDisabled,
          onSelect: () => commit(trimmedQuery, null, true),
        }
      : null;

  return (
    <ComposerModelControls
      harnessId={session.harnessId}
      modelSupport={modelSupport}
      disabled={disabled}
      modelOpen={modelOpen}
      onModelOpenChange={handleModelOpenChange}
      reasoningOpen={reasoningOpen}
      onReasoningOpenChange={handleReasoningOpenChange}
      modelLabel={activeId ? shortModelLabel(activeId) : "原生配置"}
      modelTitle={activeId || "原生配置"}
      searchAriaLabel="搜索模型"
      searchQuery={query}
      onSearchQueryChange={setQuery}
      showSearch
      loading={loading}
      refreshDisabled={disabled || loading || saving}
      onRefresh={() => void refresh()}
      emptyText="暂无可用模型"
      onRetry={() => void refresh()}
      topItems={topItems}
      modelItems={modelItems}
      customItem={customItem}
      parametersModel={selected}
      error={error}
      popoverAriaLabel="会话模型设置"
      reasoningLevels={levels}
      reasoningValue={reasoning}
      reasoningDefault={nativeDefaults?.reasoning ?? undefined}
      reasoningDisabled={saving || loading || !options || !selected}
      reasoningSliderLabel="会话思考强度"
      onReasoningChange={setReasoning}
      onReasoningCommit={(value) => {
        if (value === (session.reasoning ?? "")) return;
        commit(
          session.model ?? options?.effectiveModel ?? (defaultModelId || null),
          value || null,
          false,
        );
      }}
    />
  );
}
