import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Download, ExternalLink, RefreshCw } from "lucide-react";
import type {
  AppSettings,
  EndpointProtocol,
  EngineInstallationOption,
  HarnessDescriptor,
  HarnessId,
  HarnessModelOption,
  ProviderConfiguration,
  Snapshot,
} from "@kodo/protocol";
import { HARNESS_PROVIDER_PROTOCOLS, bindingReasoningLevels } from "@kodo/protocol/client";
import { ConfigFiles } from "./ConfigFiles";
import { SkillsBlock } from "./SkillsBlock";
import { api } from "../../lib/host-client";
import { modelChoiceLabels, shortModelLabel } from "../../lib/harnesses";
import { useAppPreferences } from "../../lib/preferences";
import { HarnessBadge } from "../KodoBrand";
import { permissionModesFor } from "../PermissionControls";
import { SettingsPage, SettingsRow, SettingsSection, StatusDot, SxSelect } from "./SettingsKit";

type Action = (work: () => Promise<unknown>) => Promise<void>;
type ModelsPayload = {
  models: HarnessModelOption[];
  modelSupport: string;
  defaultModel: { provider?: string; model: string } | null;
};

function engineStatus(h: HarnessDescriptor, job?: EngineInstallationOption["job"]) {
  if (job?.state === "running") return { tone: "busy" as const, text: "安装中" };
  if (!h.health?.installed) return { tone: "off" as const, text: "未安装" };
  if (h.health.launchable === false) return { tone: "warn" as const, text: "需设置启动入口" };
  return { tone: "ok" as const, text: "可用" };
}

/** Engines: install state, which account/provider each uses, and new-chat defaults. */
export function EngineSettings({
  snapshot,
  act,
  onOpenProviders,
}: {
  snapshot: Snapshot;
  act: Action;
  onOpenProviders: () => void;
}) {
  const [management, setManagement] = useState<EngineInstallationOption[]>([]),
    [providers, setProviders] = useState<ProviderConfiguration>(),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    const [engines, config] = await Promise.all([
      api<EngineInstallationOption[]>("/harnesses/management"),
      api<ProviderConfiguration>("/provider-configuration"),
    ]);
    setManagement(engines);
    setProviders(config);
  }, []);
  useEffect(() => {
    void load().catch((e: Error) => setError(e.message));
  }, [load]);
  const installing = management.some((m) => m.job?.state === "running");
  useEffect(() => {
    if (!installing) return;
    const timer = setInterval(() => void load().catch(() => {}), 1600);
    return () => clearInterval(timer);
  }, [installing, load]);
  const run: Action = async (work) => {
    setError("");
    await act(async () => {
      try {
        await work();
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "操作失败，请重试。");
      }
    });
  };
  const ready = snapshot.harnesses.filter((h) => h.health?.launchable).length;
  const sorted = [...snapshot.harnesses].sort(
    (a, b) => Number(Boolean(b.health?.launchable)) - Number(Boolean(a.health?.launchable)),
  );

  return (
    <SettingsPage
      title="引擎"
      actions={
        <button
          type="button"
          className="quiet-btn"
          onClick={() => void run(() => api("/harnesses/installations?refresh=1"))}
        >
          <RefreshCw size={14} /> 重新检测
        </button>
      }
    >
      {error && <p className="sx-note is-error">{error}</p>}
      <SettingsSection title={`已就绪 ${ready} / ${snapshot.harnesses.length}`}>
        {sorted.map((h) => (
          <EngineCard
            key={h.id}
            harness={h}
            snapshot={snapshot}
            installation={management.find((m) => m.harnessId === h.id)}
            providers={providers}
            run={run}
            onOpenProviders={onOpenProviders}
          />
        ))}
      </SettingsSection>
    </SettingsPage>
  );
}

function EngineCard({
  harness: h,
  snapshot,
  installation,
  providers,
  run,
  onOpenProviders,
}: {
  harness: HarnessDescriptor;
  snapshot: Snapshot;
  installation?: EngineInstallationOption;
  providers?: ProviderConfiguration;
  run: Action;
  onOpenProviders: () => void;
}) {
  const [open, setOpen] = useState(false);
  const status = engineStatus(h, installation?.job);
  const defaultBindingId = snapshot.bindingDefaults.harnessBindingIds[h.id];
  const binding = snapshot.bindings.find((b) => b.id === defaultBindingId);
  const { settings } = useAppPreferences();
  const preset = settings.harnessDefaults?.[h.id];
  const native = h.nativeDefaults;
  const source = binding
    ? `模型来源 · ${binding.name}`
    : h.id === "kodo"
      ? "Kooyu 独立配置"
      : "自身登录与配置";
  const model = preset?.model ?? binding?.model ?? native?.model;
  return (
    <details className="sx-engine" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <HarnessBadge harnessId={h.id} size="sm" tone="tinted" />
        <span className="sx-engine__name">
          <strong>{h.name}</strong>
          <small>
            {source}
            {model ? ` · ${shortModelLabel(model)}` : ""}
            {(preset?.reasoning ?? native?.reasoning)
              ? ` · ${preset?.reasoning ?? native?.reasoning}`
              : ""}
          </small>
        </span>
        <StatusDot tone={status.tone}>{status.text}</StatusDot>
        <ChevronRight size={15} className="sx-engine__chevron" aria-hidden="true" />
      </summary>
      {open && (
        <div className="sx-engine__body">
          <InstallBlock harness={h} installation={installation} run={run} />
          {h.health?.launchable && (
            <>
              <ConnectionBlock
                harness={h}
                snapshot={snapshot}
                providers={providers}
                run={run}
                onOpenProviders={onOpenProviders}
              />
              <DefaultsBlock harness={h} snapshot={snapshot} />
              {h.id === "claude-code" && <ModelMapBlock harness={h} snapshot={snapshot} />}
            </>
          )}
          <ConfigFiles
            harnessId={h.id}
            files={
              h.configFileLocations ?? (h.configFiles ?? []).map((path) => ({ path, exists: true }))
            }
            canEdit={["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)}
          />
          <SkillsBlock
            harnessId={h.id}
            snapshot={snapshot}
            canEdit={["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)}
          />
        </div>
      )}
    </details>
  );
}

function InstallBlock({
  harness: h,
  installation,
  run,
}: {
  harness: HarnessDescriptor;
  installation?: EngineInstallationOption;
  run: Action;
}) {
  const running = installation?.job?.state === "running";
  const installed = Boolean(h.health?.installed);
  const [command, setCommand] = useState(installation?.command ?? "");
  const [args, setArgs] = useState((installation?.args ?? []).join(" "));
  const [editing, setEditing] = useState(false);
  const where =
    h.health?.source === "sdk"
      ? "随 Kooyu 内置"
      : h.health?.source === "desktop-bundled"
        ? "使用桌面版附带的程序"
        : h.health?.source === "configured"
          ? "使用自定义启动入口"
          : h.health?.source === "cli"
            ? "使用本机命令行工具"
            : "未找到";
  return (
    <>
      <p className="sx-subhead">安装</p>
      <div className="sx-card">
        <SettingsRow
          label={
            installed ? `已安装${h.health?.version ? ` · ${h.health.version}` : ""}` : "尚未安装"
          }
          description={
            installation?.job ? (
              installation.job.message
            ) : h.health?.executable ? (
              <>
                {where} · <span className="sx-mono">{h.health.executable}</span>
              </>
            ) : (
              (h.health?.error ?? where)
            )
          }
        >
          {installation?.kind === "managed-npm" && (
            <button
              type="button"
              disabled={running}
              onClick={() =>
                void run(() =>
                  api(`/harnesses/${h.id}/${installed ? "upgrade" : "install"}`, "POST", {}),
                )
              }
            >
              <Download size={13} /> {running ? "安装中…" : installed ? "升级" : "安装"}
            </button>
          )}
          {installation?.documentation && h.id !== "kodo" && (
            <a
              className="quiet-link"
              href={installation.documentation}
              target="_blank"
              rel="noreferrer"
            >
              安装说明 <ExternalLink size={12} />
            </a>
          )}
        </SettingsRow>
        <SettingsRow label="自定义启动入口">
          {installation?.canRestore && (
            <button
              type="button"
              onClick={() =>
                void run(() => api(`/harnesses/${h.id}/restore-installation`, "POST", {}))
              }
            >
              恢复自动检测
            </button>
          )}
          <button type="button" onClick={() => setEditing((v) => !v)}>
            {editing ? "收起" : "设置"}
          </button>
        </SettingsRow>
        {editing && (
          <form
            className="sx-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() =>
                api(`/harnesses/${h.id}/installation`, "POST", {
                  command: command.trim(),
                  args: args.trim() ? args.trim().split(/\s+/) : [],
                }),
              ).then(() => setEditing(false));
            }}
          >
            <SettingsRow label="程序路径" htmlFor={`cmd-${h.id}`}>
              <input
                id={`cmd-${h.id}`}
                required
                value={command}
                onChange={(e) => setCommand(e.target.value)}
              />
            </SettingsRow>
            <SettingsRow label="启动参数" htmlFor={`args-${h.id}`}>
              <input id={`args-${h.id}`} value={args} onChange={(e) => setArgs(e.target.value)} />
            </SettingsRow>
            <div className="sx-form__actions">
              <button type="button" onClick={() => setEditing(false)}>
                取消
              </button>
              <button className="primary">保存入口</button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}

function ConnectionBlock({
  harness: h,
  snapshot,
  providers,
  run,
  onOpenProviders,
}: {
  harness: HarnessDescriptor;
  snapshot: Snapshot;
  providers?: ProviderConfiguration;
  run: Action;
  onOpenProviders: () => void;
}) {
  const currentId = snapshot.bindingDefaults.harnessBindingIds[h.id];
  const current = snapshot.bindings.find((b) => b.id === currentId);
  const compatible = (protocol: EndpointProtocol) =>
    HARNESS_PROVIDER_PROTOCOLS[h.id].includes(protocol) ||
    (["claude-code", "gemini"].includes(h.id) && protocol === "openai-completions");
  const options =
    providers?.providers.flatMap((p) =>
      p.endpoints.filter((e) => compatible(e.protocol)).map((e) => ({ provider: p, endpoint: e })),
    ) ?? [];
  const value = current ? `${current.providerId}:${current.endpointId}` : "";
  const unsupported = HARNESS_PROVIDER_PROTOCOLS[h.id].length === 0;
  const setDefaults = (id: string | null) =>
    api("/binding-defaults", "PATCH", {
      expectedRevision: snapshot.bindingDefaults.revision,
      harnessBindingIds: { ...snapshot.bindingDefaults.harnessBindingIds, [h.id]: id },
    });
  return (
    <>
      <p className="sx-subhead">模型来源</p>
      <div className="sx-card">
        <SettingsRow
          label="使用哪个账号或服务"
          description={
            unsupported
              ? "此引擎只支持自身的登录与模型设置。"
              : options.length === 0
                ? "还没有可用的模型来源。添加后可让此引擎改用它。"
                : current
                  ? `新对话使用「${current.name}」，模型在对话中选择。`
                  : h.id === "kodo"
                    ? "使用 Kooyu 自己的模型配置。"
                    : `使用 ${h.name} 自己的登录与配置文件，不做改动。`
          }
          htmlFor={`src-${h.id}`}
        >
          {!unsupported && options.length > 0 && (
            <SxSelect
              id={`src-${h.id}`}
              value={value}
              onChange={(next) => {
                void run(async () => {
                  if (!next) return void (await setDefaults(null));
                  const [providerId, endpointId] = next.split(":");
                  await api("/harness-provider-bindings", "POST", {
                    harnessId: h.id,
                    providerId,
                    endpointId,
                    expectedDefaultsRevision: snapshot.bindingDefaults.revision,
                    requestId: crypto.randomUUID(),
                  });
                });
              }}
              options={[
                { value: "", label: h.id === "kodo" ? "Kooyu 独立配置" : `${h.name} 自身登录` },
                ...options.map(({ provider, endpoint }) => ({
                  value: `${provider.id}:${endpoint.id}`,
                  label: `${provider.name} · ${PROTOCOL_LABELS[endpoint.protocol] ?? endpoint.protocol}`,
                })),
              ]}
            />
          )}
          {!unsupported && (
            <button type="button" onClick={onOpenProviders}>
              管理来源
            </button>
          )}
        </SettingsRow>
      </div>
    </>
  );
}

function DefaultsBlock({
  harness: h,
  snapshot,
}: {
  harness: HarnessDescriptor;
  snapshot: Snapshot;
}) {
  const binding = snapshot.bindings.find(
    (b) => b.id === snapshot.bindingDefaults.harnessBindingIds[h.id],
  );
  const { settings, save } = useAppPreferences();
  const [models, setModels] = useState<ModelsPayload>();
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void api<ModelsPayload>(`/harnesses/${h.id}/models?discover=1`)
      .then((m) => live && setModels(m))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [h.id]);
  const preset = settings.harnessDefaults?.[h.id] ?? {
    model: null,
    reasoning: null,
    permissionMode: null,
    modelMap: {},
  };
  const update = (patch: Partial<typeof preset>) => {
    const next = { ...preset, ...patch };
    const map: AppSettings["harnessDefaults"] = { ...settings.harnessDefaults };
    if (
      !next.model &&
      !next.reasoning &&
      !next.permissionMode &&
      !Object.keys(next.modelMap ?? {}).length
    )
      delete map[h.id as HarnessId];
    else map[h.id as HarnessId] = next;
    setError("");
    void save({ ...settings, harnessDefaults: map }).catch((e: Error) => setError(e.message));
  };
  const route = (m: HarnessModelOption) =>
    !binding && m.provider && ["kodo", "pi", "opencode", "zcode", "deepseek-harness"].includes(h.id)
      ? `${m.provider}/${m.id}`
      : m.id;
  // With a model source chosen, only that source's models can be the default.
  const list: HarnessModelOption[] = binding
    ? (binding.availableModels ?? []).map((m) => ({
        id: m.model,
        name: m.name,
        source: "discovered" as const,
        contextWindow: m.effective.contextWindow,
        maxOutputTokens: m.effective.maxOutputTokens,
        pricing: m.effective.pricing,
        reasoning: bindingReasoningLevels(m.effective, h.id),
      }))
    : (models?.models ?? []).filter((m) => m.source !== "recent").slice(0, 200);
  const labels = modelChoiceLabels(list, route);
  const native = h.nativeDefaults;
  const selected =
    list.find((m) => route(m) === preset.model) ??
    (native?.model
      ? list.find((m) => route(m) === native.model || m.id === native.model)
      : undefined);
  const levels = selected?.reasoning ?? [];
  const modes = permissionModesFor(h.id);
  const nativeModel = binding
    ? shortModelLabel(binding.model)
    : native?.model
      ? shortModelLabel(native.model)
      : "引擎默认";
  const canPickModel = models?.modelSupport !== "native-only";
  return (
    <>
      <p className="sx-subhead">新对话默认值</p>
      <div className="sx-card">
        {canPickModel && (
          <SettingsRow
            label="模型"
            description={
              selected?.contextWindow
                ? `上下文 ${selected.contextWindow.toLocaleString()} tokens${selected.pricing?.input !== undefined ? ` · 输入 $${selected.pricing.input} / 输出 $${selected.pricing.output ?? "?"} 每百万` : ""}`
                : "留空时跟随引擎自己的设置。"
            }
            htmlFor={`model-${h.id}`}
          >
            <SxSelect
              id={`model-${h.id}`}
              value={preset.model ?? ""}
              onChange={(next) => update({ model: next || null, reasoning: null })}
              options={[
                {
                  value: "",
                  label: `${binding ? "来源默认" : "跟随引擎"}（${nativeModel}）`,
                },
                ...list.map((m) => {
                  const l = labels.get(m)!;
                  return {
                    value: route(m),
                    label: `${l.title}${l.subtitle ? ` · ${l.subtitle}` : ""}`,
                  };
                }),
              ]}
            />
          </SettingsRow>
        )}
        <SettingsRow
          label="思考强度"
          description={levels.length ? undefined : "所选模型没有可选的思考档位。"}
          htmlFor={`reasoning-${h.id}`}
        >
          <SxSelect
            id={`reasoning-${h.id}`}
            value={preset.reasoning ?? ""}
            disabled={!levels.length}
            onChange={(next) => update({ reasoning: next || null })}
            options={[
              {
                value: "",
                label: `跟随引擎${native?.reasoning ? `（${native.reasoning}）` : ""}`,
              },
              ...levels.map((l) => ({ value: l, label: l })),
            ]}
          />
        </SettingsRow>
        {modes.length > 0 && (
          <SettingsRow label="权限" htmlFor={`perm-${h.id}`}>
            <SxSelect
              id={`perm-${h.id}`}
              value={preset.permissionMode ?? ""}
              onChange={(next) => update({ permissionMode: next || null })}
              options={[
                ...(!modes.some((m) => m.value === null)
                  ? [
                      {
                        value: "",
                        label: `跟随引擎${native?.permission ? `（${native.permission}）` : ""}`,
                      },
                    ]
                  : []),
                ...modes.map((m) => ({
                  value: m.value ?? "",
                  label:
                    m.value === null && native?.permission
                      ? `${m.label}（${native.permission}）`
                      : m.label,
                  hint: m.detail,
                })),
              ]}
            />
          </SettingsRow>
        )}
      </div>
      {error && <p className="sx-note is-error">{error}</p>}
    </>
  );
}

const PROTOCOL_LABELS: Partial<Record<EndpointProtocol, string>> = {
  "openai-completions": "Chat Completions",
  "openai-responses": "Responses",
  "anthropic-messages": "Anthropic Messages",
  "google-generative-ai": "Gemini",
};

const CLAUDE_SLOTS = [
  ["main", "主模型", "对话默认使用（ANTHROPIC_MODEL）"],
  ["sonnet", "Sonnet 档", "选择 sonnet 时使用"],
  ["opus", "Opus 档", "选择 opus 或计划模式时使用"],
  ["haiku", "Haiku 档", "后台与轻量任务使用"],
  ["fast", "快速模型", "标题生成等小任务（ANTHROPIC_SMALL_FAST_MODEL）"],
] as const;

/**
 * Claude Code asks for models by role. With a third-party source those names don't
 * exist, so each role is mapped to one of the source's models.
 */
function ModelMapBlock({
  harness: h,
  snapshot,
}: {
  harness: HarnessDescriptor;
  snapshot: Snapshot;
}) {
  const { settings, save } = useAppPreferences();
  const [error, setError] = useState("");
  const binding = snapshot.bindings.find(
    (b) => b.id === snapshot.bindingDefaults.harnessBindingIds[h.id],
  );
  if (!binding) return null;
  const models = (binding.availableModels ?? []).map((m) => m.model).sort();
  const preset = settings.harnessDefaults?.[h.id] ?? {
    model: null,
    reasoning: null,
    permissionMode: null,
    modelMap: {},
  };
  const map = preset.modelMap ?? {};
  const set = (slot: (typeof CLAUDE_SLOTS)[number][0], value: string) => {
    const nextMap = { ...map };
    if (value) nextMap[slot] = value;
    else delete nextMap[slot];
    const all: AppSettings["harnessDefaults"] = { ...settings.harnessDefaults };
    all[h.id as HarnessId] = { ...preset, modelMap: nextMap };
    setError("");
    void save({ ...settings, harnessDefaults: all }).catch((e: Error) => setError(e.message));
  };
  return (
    <>
      <p className="sx-subhead">模型映射</p>
      <div className="sx-card">
        {CLAUDE_SLOTS.map(([slot, label, hint]) => (
          <SettingsRow key={slot} label={label} description={hint} htmlFor={`map-${slot}`}>
            <SxSelect
              id={`map-${slot}`}
              value={map[slot] ?? ""}
              onChange={(next) => set(slot, next)}
              options={[
                {
                  value: "",
                  label:
                    slot === "main" ? `来源默认（${shortModelLabel(binding.model)}）` : "同主模型",
                },
                ...models.map((m) => ({ value: m, label: m })),
              ]}
            />
          </SettingsRow>
        ))}
      </div>
      {error && <p className="sx-note is-error">{error}</p>}
    </>
  );
}
