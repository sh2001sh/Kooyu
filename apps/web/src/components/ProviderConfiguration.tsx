import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, RefreshCw, X } from "lucide-react";
import {
  HARNESS_IDS,
  HARNESS_PROVIDER_PROTOCOLS,
  bindingReasoningLevels,
} from "@kodo/protocol/client";
import type {
  CatalogModel,
  EndpointProtocol,
  HarnessBinding,
  HarnessId,
  ModelParameters,
  ParameterOrigin,
  Provider,
  ProviderConfiguration,
  Snapshot,
} from "@kodo/protocol";
import { api } from "../lib/host-client";
import { HARNESS_NAMES, formatDate } from "../lib/harnesses";
import { catalogModelSource, groupCatalogModels } from "../lib/catalog-models";
import {
  ModelPricingEditor,
  ModelPricingSummary,
  readPricingDraft,
  usePricingDraft,
} from "./ModelPricing";

type Action = (work: () => Promise<unknown>) => Promise<void>;
type Run = (work: () => Promise<void>) => Promise<void>;
const protocols: EndpointProtocol[] = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
];
// Keep the ID when the user retries the same unsaved form after a lost reply.
// Keys and form contents remain in memory, never in browser storage.
function useConfigurationSave<T = unknown>(path: string) {
  const previous = useRef<{ body: string; requestId: string } | undefined>(undefined);
  return (body: object) => {
    const serialized = JSON.stringify(body);
    if (previous.current?.body !== serialized)
      previous.current = { body: serialized, requestId: crypto.randomUUID() };
    return api<T>(path, "POST", { ...body, requestId: previous.current!.requestId });
  };
}
function efforts(m?: CatalogModel, harness?: HarnessId) {
  return m ? (bindingReasoningLevels(m.effective, harness) ?? []) : [];
}
function compatibleModel(data: ProviderConfiguration, model: CatalogModel, harness: HarnessId) {
  const protocol = data.providers
    .find((provider) => provider.id === model.providerId)
    ?.endpoints.find((endpoint) => endpoint.id === model.endpointId)?.protocol;
  return (
    protocol !== undefined &&
    (HARNESS_PROVIDER_PROTOCOLS[harness].includes(protocol) ||
      (protocol === "openai-completions" && ["claude-code", "gemini"].includes(harness)))
  );
}
function Source({ source }: { source?: ParameterOrigin }) {
  if (!source || source.kind === "remote-catalog" || source.kind === "bundled-catalog") return null;
  return (
    <small title={`${source.fetchedAt} · ${source.revision}`}>
      {source.reference ? (
        <a href={source.reference} target="_blank" rel="noreferrer">
          {source.label}
        </a>
      ) : (
        source.label
      )}
    </small>
  );
}

export type ProviderConfigSection = "providers" | "models" | "bindings";

export function ProviderConfigurationPanel({
  snapshot,
  act,
  section,
  onSectionChange,
  data: externalData,
  onDataLoaded,
}: {
  snapshot: Snapshot;
  act: Action;
  section: ProviderConfigSection;
  onSectionChange: (next: ProviderConfigSection) => void;
  data?: ProviderConfiguration;
  onDataLoaded?: (next: ProviderConfiguration) => void;
}) {
  const [localData, setLocalData] = useState<ProviderConfiguration | undefined>(externalData);
  const data = externalData ?? localData;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [providerEditor, setProviderEditor] = useState<Provider | null | false>(false);
  const [modelEditor, setModelEditor] = useState<CatalogModel | null | false>(false);
  const [bindingEditor, setBindingEditor] = useState<HarnessBinding | null | false>(false);
  const [initialHarness, setInitialHarness] = useState<HarnessId>("kodo");
  const [applyDefaultInitially, setApplyDefaultInitially] = useState(false);
  const [filter, setFilter] = useState("");
  const [selectedModelSources, setSelectedModelSources] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    const next = await api<ProviderConfiguration>("/provider-configuration");
    setLocalData(next);
    onDataLoaded?.(next);
    return next;
  }, [onDataLoaded]);
  useEffect(() => {
    if (externalData) setLocalData(externalData);
  }, [externalData]);
  useEffect(() => {
    void load().catch((e: Error) => setError(e.message));
  }, [load]);
  useEffect(() => {
    setError("");
  }, [section]);
  const run: Run = async (work) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    await act(async () => {
      try {
        await work();
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "配置操作失败，请刷新后重试。");
      } finally {
        setBusy(false);
      }
    });
  };
  const providerName = (id: string) => data?.providers.find((p) => p.id === id)?.name ?? id;
  return (
    <section className="provider-settings" aria-label="Provider 与模型配置">
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="provider-help" role="status">
          {notice}
        </p>
      )}
      {data && (
        <div
          id={`provider-panel-${section}`}
          key={section}
          className="provider-panel settings-stage"
        >
          {section === "providers" && (
            <>
              <header className="settings-intro">
                <h2>连接一次，自动同步模型</h2>
                <p>
                  保存 Provider 后自动获取模型列表。窗口、能力和价格优先读取入口，缺失项匹配
                  models.dev；手动覆盖一直保留。
                </p>
              </header>
              <div className="provider-toolbar">
                <button
                  className="quiet-btn"
                  disabled={busy}
                  onClick={() => setProviderEditor(null)}
                >
                  <Plus size={14} />
                  添加 Provider
                </button>
              </div>
              {providerEditor !== false && (
                <ProviderEditor
                  key={providerEditor?.id ?? "new"}
                  provider={providerEditor ?? undefined}
                  busy={busy}
                  run={run}
                  onClose={() => setProviderEditor(false)}
                />
              )}
              <div className="settings-group">
                {!data.providers.length && <div className="provider-empty">暂无 Provider</div>}
                {data.providers.map((p) => (
                  <div className="provider-record" key={p.id}>
                    <div className="provider-record-heading">
                      <div>
                        <strong>{p.name}</strong>
                        <small>修订 {p.revision}</small>
                      </div>
                      <button
                        className="quiet-btn"
                        disabled={busy}
                        onClick={() => setProviderEditor(p)}
                      >
                        编辑 Provider {p.name}
                      </button>
                    </div>
                    {p.endpoints.map((e) => (
                      <div className="provider-endpoint" key={e.id}>
                        <div>
                          <strong>{e.name}</strong>
                          <small>
                            {e.protocol} · {e.credentialRef ? "系统凭据库" : "无独立凭据"}
                          </small>
                          <span className="provider-url">{e.baseUrl}</span>
                          <small role="status">
                            {p.discovery?.find((status) => status.endpointId === e.id)?.status ===
                            "error"
                              ? "Provider 已保存，自动获取失败；请检查凭据后重试。"
                              : `${data.models.filter((model) => model.providerId === p.id && model.endpointId === e.id).length} 个模型已同步`}
                          </small>
                        </div>
                        <button
                          className="quiet-btn"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              const list = await api<CatalogModel[]>(
                                `/providers/${p.id}/endpoints/${e.id}/models/refresh`,
                                "POST",
                                {},
                              );
                              setNotice(`已获取 ${list.length} 个模型`);
                              setFilter(p.id);
                              onSectionChange("models");
                            })
                          }
                        >
                          获取模型
                        </button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}
          {section === "models" && (
            <>
              <header className="settings-intro">
                <h2>模型参数与参考价格</h2>
                <p>
                  模型在添加 Provider 时自动导入。这里集中调整窗口和每百万 Token
                  的美元价格；留空使用自动值，可随时恢复自动参数。
                </p>
              </header>
              <div className="provider-catalog-status">
                <div>
                  <strong>
                    {data.catalog.source.includes("models.dev")
                      ? "models.dev 在线目录"
                      : "Kooyu 内核内置目录"}
                  </strong>
                  <span className="muted">
                    {`${data.catalog.modelCount.toLocaleString()} 条 · ${data.catalog.stale ? "可更新" : "已更新"}`}
                  </span>
                  {data.catalog.checkedAt && <small>{formatDate(data.catalog.checkedAt)}</small>}
                  {data.catalog.error && <small role="status">{data.catalog.error}</small>}
                </div>
                <button
                  type="button"
                  className="quiet-btn"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api("/model-catalog/refresh", "POST", {});
                      setNotice("目录已更新");
                    })
                  }
                >
                  <RefreshCw size={14} />
                  更新模型目录
                </button>
              </div>
              <div className="provider-toolbar">
                <select
                  aria-label="模型库 Provider 筛选"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="">全部 Provider</option>
                  {data.providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button
                  className="quiet-btn"
                  disabled={busy || !data.providers.length}
                  onClick={() => setModelEditor(null)}
                >
                  <Plus size={14} />
                  添加模型
                </button>
              </div>
              {modelEditor === null && (
                <AddModel
                  providers={data.providers}
                  providerId={filter}
                  busy={busy}
                  run={run}
                  onAdded={setModelEditor}
                  onClose={() => setModelEditor(false)}
                />
              )}
              {modelEditor && (
                <ModelEditor
                  key={`${modelEditor.id}:${modelEditor.revision}`}
                  model={modelEditor}
                  busy={busy}
                  run={run}
                  onClose={() => setModelEditor(false)}
                />
              )}
              <div className="settings-group">
                {!data.models.length && <div className="provider-empty">暂无模型</div>}
                {groupCatalogModels(
                  data.models.filter((m) => !filter || m.providerId === filter),
                ).map(({ model, sources }) => {
                  const m =
                    sources.find((source) => source.id === selectedModelSources[model]) ??
                    sources[0]!;
                  return (
                    <div className="provider-record" key={model}>
                      <div className="provider-record-heading">
                        <div>
                          <strong>{m.name}</strong>
                          <small>
                            {sources.length > 1 ? (
                              <select
                                aria-label={`模型 ${model} 的来源`}
                                disabled={
                                  busy || Boolean(modelEditor && modelEditor.model === model)
                                }
                                value={m.id}
                                onChange={(event) =>
                                  setSelectedModelSources((previous) => ({
                                    ...previous,
                                    [model]: event.target.value,
                                  }))
                                }
                              >
                                {sources.map((source) => (
                                  <option key={source.id} value={source.id}>
                                    {catalogModelSource(source, data.providers)}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <>
                                {providerName(m.providerId)} ·{" "}
                                {
                                  data.providers
                                    .find((p) => p.id === m.providerId)
                                    ?.endpoints.find((e) => e.id === m.endpointId)?.name
                                }{" "}
                                · {m.model}
                              </>
                            )}
                          </small>
                        </div>
                        <button
                          className="quiet-btn"
                          disabled={busy}
                          onClick={() => setModelEditor(m)}
                        >
                          编辑参数 {m.model}
                        </button>
                      </div>
                      <dl className="provider-limits">
                        {(
                          [
                            ["contextWindow", "上下文"],
                            ["maxOutputTokens", "输出上限"],
                          ] as const
                        ).map(([field, label]) => (
                          <div key={field}>
                            <dt>{label}</dt>
                            <dd>
                              <span>{m.effective[field]?.toLocaleString() ?? "未确认"}</span>
                              <Source source={m.sources[field]} />
                            </dd>
                          </div>
                        ))}
                      </dl>
                      <ModelPricingSummary pricing={m.effective.pricing} />
                      <Source source={m.sources.pricing} />
                      <small>
                        思考档位：
                        {efforts(m).join(" / ") ||
                          (m.effective.reasoning === false ? "不支持思考" : "未提供可选档位")}
                        {Object.keys(m.overrides).length ? " · 含手工覆盖" : ""}
                      </small>
                    </div>
                  );
                })}
              </div>
            </>
          )}
          {section === "bindings" && (
            <>
              <header className="settings-intro">
                <h2>需要时再固定模型映射</h2>
                <p>
                  常规 Provider
                  选择请到引擎页。原有固定模型绑定保留在这里，适用于需要固定模型身份或协议映射的引擎。
                </p>
              </header>
              <div className="provider-toolbar">
                <button
                  className="quiet-btn"
                  disabled={busy || !data.models.length}
                  onClick={() => {
                    setInitialHarness("kodo");
                    setApplyDefaultInitially(false);
                    setBindingEditor(null);
                  }}
                >
                  <Plus size={14} />
                  添加 Harness 绑定
                </button>
              </div>
              {bindingEditor !== false && (
                <BindingEditor
                  key={bindingEditor?.id ?? `new-${initialHarness}`}
                  data={data}
                  initialHarness={initialHarness}
                  applyDefaultInitially={applyDefaultInitially}
                  defaultsRevision={snapshot.bindingDefaults.revision}
                  binding={bindingEditor ?? undefined}
                  busy={busy}
                  run={run}
                  onClose={() => setBindingEditor(false)}
                />
              )}
              <details className="provider-advanced">
                <summary>按 Harness 一键配置</summary>
                {HARNESS_IDS.map((id) => {
                  const formats = HARNESS_PROVIDER_PROTOCOLS[id];
                  const matching = data.models.some((model) => compatibleModel(data, model, id));
                  const installed = snapshot.harnesses.find((h) => h.id === id)?.health?.launchable;
                  return (
                    <div className="provider-endpoint" key={id}>
                      <div>
                        <strong>{HARNESS_NAMES[id]}</strong>
                        <small>
                          {formats.length
                            ? formats
                                .map(
                                  (p) =>
                                    ({
                                      "openai-completions": "Chat Completions",
                                      "openai-responses": "Responses",
                                      "anthropic-messages": "Messages",
                                      "google-generative-ai": "Google Generative AI",
                                    })[p],
                                )
                                .join(" / ") +
                              (["claude-code", "gemini"].includes(id) ? " / Chat" : "")
                            : "原生登录"}
                        </small>
                        {formats.length > 0 && <small>{installed ? "已就绪" : "待安装"}</small>}
                      </div>
                      <button
                        className="quiet-btn"
                        disabled={busy || !matching}
                        onClick={() => {
                          setInitialHarness(id);
                          setApplyDefaultInitially(true);
                          setBindingEditor(null);
                        }}
                      >
                        配置 {HARNESS_NAMES[id]}
                      </button>
                    </div>
                  );
                })}
              </details>
              <div className="settings-group">
                {!data.bindings.length && <div className="provider-empty">暂无绑定</div>}
                {data.bindings.map((b) => (
                  <div className="provider-record provider-record-heading" key={b.id}>
                    <div>
                      <strong>{b.name}</strong>
                      <small>
                        {HARNESS_NAMES[b.harnessId]} · {providerName(b.providerId)} · {b.model}
                      </small>
                      <small>
                        {b.route === "direct" ? "原生直连" : "本地网关"} · {b.reasoning ?? "原生"} ·
                        r{b.providerRevision} / r{b.modelRevision}
                      </small>
                    </div>
                    <button
                      className="quiet-btn"
                      disabled={busy}
                      onClick={() => setBindingEditor(b)}
                    >
                      编辑绑定 {b.name}
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {!data && error && (
        <button
          className="quiet-btn"
          onClick={() => void load().catch((e: Error) => setError(e.message))}
        >
          重新读取配置
        </button>
      )}
    </section>
  );
}

type EndpointDraft = {
  id?: string;
  name: string;
  protocol: EndpointProtocol;
  baseUrl: string;
  modelsUrl: string;
  apiKey: string;
  clearCredential: boolean;
  hasKey?: boolean;
};
const blankEndpoint = (): EndpointDraft => ({
  name: "默认入口",
  protocol: "openai-completions",
  baseUrl: "",
  modelsUrl: "",
  apiKey: "",
  clearCredential: false,
});
function EditorHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="provider-record-heading">
      <h3>{title}</h3>
      <button className="quiet-btn" type="button" aria-label="关闭配置编辑" onClick={onClose}>
        <X size={16} />
      </button>
    </div>
  );
}
function ProviderEditor({
  provider,
  busy,
  run,
  onClose,
}: {
  provider?: Provider;
  busy: boolean;
  run: Run;
  onClose: () => void;
}) {
  const persist = useConfigurationSave("/providers");
  const [name, setName] = useState(provider?.name ?? ""),
    [catalogProvider, setCatalogProvider] = useState(provider?.catalogProvider ?? "");
  const [endpoints, setEndpoints] = useState<EndpointDraft[]>(
    provider?.endpoints.map(({ credentialRef, ...e }) => ({
      ...e,
      modelsUrl: e.modelsUrl ?? "",
      apiKey: "",
      clearCredential: false,
      hasKey: Boolean(credentialRef),
    })) ?? [blankEndpoint()],
  );
  const change = (i: number, value: Partial<EndpointDraft>) =>
    setEndpoints((old) => old.map((e, index) => (index === i ? { ...e, ...value } : e)));
  return (
    <form
      className="provider-editor ios-form"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          await persist({
            ...(provider ? { id: provider.id, expectedRevision: provider.revision } : {}),
            name,
            ...(catalogProvider.trim() ? { catalogProvider: catalogProvider.trim() } : {}),
            endpoints: endpoints.map(({ hasKey: _hasKey, apiKey, modelsUrl, ...endpoint }) => ({
              ...endpoint,
              ...(apiKey ? { apiKey } : {}),
              ...(modelsUrl ? { modelsUrl } : {}),
            })),
          });
          setEndpoints([]);
          onClose();
        });
      }}
    >
      <EditorHeader title={provider ? "编辑 Provider" : "添加 Provider"} onClose={onClose} />
      <label>
        Provider 名称
        <input required value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      <label>
        公共目录 Provider ID
        <input
          value={catalogProvider}
          onChange={(e) => setCatalogProvider(e.target.value)}
          placeholder="openai / anthropic / deepseek"
        />
      </label>
      {endpoints.map((endpoint, i) => (
        <fieldset className="provider-endpoint-fields" key={endpoint.id ?? i}>
          <legend>协议入口 {i + 1}</legend>
          <label>
            入口名称
            <input
              required
              value={endpoint.name}
              onChange={(e) => change(i, { name: e.target.value })}
            />
          </label>
          <label>
            接口格式
            <select
              aria-label="接口格式"
              value={endpoint.protocol}
              onChange={(e) => change(i, { protocol: e.target.value as EndpointProtocol })}
            >
              {protocols.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          <label>
            接口地址
            <input
              type="url"
              required
              value={endpoint.baseUrl}
              onChange={(e) => change(i, { baseUrl: e.target.value })}
              placeholder="https://api.example.com/v1"
            />
          </label>
          <label>
            模型列表地址（可选）
            <input
              type="url"
              value={endpoint.modelsUrl}
              onChange={(e) => change(i, { modelsUrl: e.target.value })}
              placeholder="留空使用接口地址 /models"
            />
          </label>
          <label>
            入口凭据
            <input
              type="password"
              autoComplete="new-password"
              value={endpoint.apiKey}
              onChange={(e) => change(i, { apiKey: e.target.value, clearCredential: false })}
              placeholder={endpoint.hasKey ? "已存系统凭据库；留空保持" : "匿名入口可留空"}
            />
          </label>
          {endpoint.hasKey && (
            <label className="provider-checkbox">
              <input
                type="checkbox"
                checked={endpoint.clearCredential}
                onChange={(e) => change(i, { clearCredential: e.target.checked, apiKey: "" })}
              />
              移除此入口凭据
            </label>
          )}
          {endpoints.length > 1 && (
            <button
              className="quiet-btn"
              type="button"
              onClick={() => setEndpoints((old) => old.filter((_, n) => n !== i))}
            >
              移除入口
            </button>
          )}
        </fieldset>
      ))}
      <div className="provider-actions">
        <button
          className="quiet-btn"
          type="button"
          disabled={busy || endpoints.length >= 12}
          onClick={() => setEndpoints((old) => [...old, blankEndpoint()])}
        >
          <Plus size={14} />
          添加协议入口
        </button>
        <button className="primary" disabled={busy} type="submit">
          {busy ? "正在保存…" : "保存 Provider"}
        </button>
      </div>
    </form>
  );
}

function AddModel({
  providers,
  providerId,
  busy,
  run,
  onAdded,
  onClose,
}: {
  providers: Provider[];
  providerId: string;
  busy: boolean;
  run: Run;
  onAdded: (m: CatalogModel) => void;
  onClose: () => void;
}) {
  const persist = useConfigurationSave<CatalogModel>("/provider-models");
  const [provider, setProvider] = useState(providerId || providers[0]?.id || "");
  const p = providers.find((v) => v.id === provider);
  const [endpoint, setEndpoint] = useState(p?.endpoints[0]?.id ?? "");
  const [model, setModel] = useState(""),
    [query, setQuery] = useState(""),
    [catalogKey, setCatalogKey] = useState("");
  const [results, setResults] = useState<{ key: string; name: string; model: string }[]>([]),
    [searchError, setSearchError] = useState("");
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      void api<typeof results>(
        `/model-catalog/search?q=${encodeURIComponent(query || model)}${p?.catalogProvider ? `&provider=${encodeURIComponent(p.catalogProvider)}` : ""}`,
      )
        .then((r) => {
          if (active) {
            setResults(r);
            setSearchError("");
          }
        })
        .catch(() => {
          if (active) setSearchError("公共目录暂时不可用，可以先添加模型 ID。");
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, model, p?.catalogProvider]);
  return (
    <form
      className="provider-editor ios-form"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () =>
          onAdded(
            await persist({
              providerId: provider,
              endpointId: endpoint,
              model,
              ...(catalogKey ? { catalogKey } : {}),
            }),
          ),
        );
      }}
    >
      <EditorHeader title="添加模型" onClose={onClose} />
      <label>
        所属 Provider
        <select
          aria-label="所属 Provider"
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value);
            setEndpoint(providers.find((v) => v.id === e.target.value)!.endpoints[0]!.id);
            setCatalogKey("");
          }}
        >
          {providers.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        模型协议入口
        <select
          aria-label="模型协议入口"
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
        >
          {p?.endpoints.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name} · {v.protocol}
            </option>
          ))}
        </select>
      </label>
      <label>
        实际模型 ID
        <input
          required
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="接口接受的完整模型 ID"
        />
      </label>
      <label>
        搜索公共目录
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="模型名或 provider/model"
        />
      </label>
      <label>
        参数目录匹配
        <select
          aria-label="参数目录匹配"
          value={catalogKey}
          onChange={(e) => setCatalogKey(e.target.value)}
        >
          <option value="">精确匹配</option>
          {results.map((r) => (
            <option key={r.key} value={r.key}>
              {r.key} · {r.name}
            </option>
          ))}
        </select>
      </label>
      {searchError && <p role="status">{searchError}</p>}
      <div className="provider-actions">
        <button type="submit" className="primary" disabled={busy || !model.trim()}>
          添加并读取参数
        </button>
      </div>
    </form>
  );
}

function ModelEditor({
  model,
  busy,
  run,
  onClose,
}: {
  model: CatalogModel;
  busy: boolean;
  run: Run;
  onClose: () => void;
}) {
  const persist = useConfigurationSave("/provider-models");
  const [numbers, setNumbers] = useState({
    contextWindow: model.overrides.contextWindow?.toString() ?? "",
    maxInputTokens: model.overrides.maxInputTokens?.toString() ?? "",
    maxOutputTokens: model.overrides.maxOutputTokens?.toString() ?? "",
  });
  const [reasoning, setReasoning] = useState(
    model.overrides.reasoning === undefined ? "auto" : String(model.overrides.reasoning),
  );
  const [options, setOptions] = useState(
    model.overrides.reasoningOptions
      ? JSON.stringify(model.overrides.reasoningOptions, null, 2)
      : "",
  );
  const [mapping, setMapping] = useState(
    model.overrides.thinkingLevelMap
      ? JSON.stringify(model.overrides.thinkingLevelMap, null, 2)
      : "",
  );
  const [input, setInput] = useState(model.overrides.input?.join(",") ?? "auto");
  const [prices, setPrices] = usePricingDraft(model.overrides.pricing, model.automatic.pricing);
  const save = async (overrides: ModelParameters) => {
    await persist({
      id: model.id,
      expectedRevision: model.revision,
      providerId: model.providerId,
      endpointId: model.endpointId,
      model: model.model,
      name: model.name,
      overrides,
    });
    onClose();
  };
  return (
    <form
      className="provider-editor ios-form"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          const overrides: ModelParameters = {};
          for (const [key, value] of Object.entries(numbers))
            if (value.trim()) Object.assign(overrides, { [key]: Number(value) });
          if (reasoning !== "auto") overrides.reasoning = reasoning === "true";
          if (options.trim()) overrides.reasoningOptions = JSON.parse(options);
          if (mapping.trim()) overrides.thinkingLevelMap = JSON.parse(mapping);
          if (input !== "auto") overrides.input = input.split(",") as ModelParameters["input"];
          const pricing = readPricingDraft(prices);
          if (pricing) overrides.pricing = pricing;
          await save(overrides);
        });
      }}
    >
      <EditorHeader title={`模型参数 · ${model.model}`} onClose={onClose} />
      {(
        [
          ["contextWindow", "上下文窗口"],
          ["maxOutputTokens", "输出上限"],
        ] as const
      ).map(([field, label]) => (
        <label key={field}>
          {label}
          <input
            aria-label={label}
            type="number"
            min="1"
            step="1"
            value={numbers[field]}
            onChange={(e) => setNumbers({ ...numbers, [field]: e.target.value })}
            placeholder={model.automatic[field]?.toString() ?? "未确认"}
          />
          <small>自动值：{model.automatic[field]?.toLocaleString() ?? "未确认"}</small>
          <Source source={model.automaticSources[field]} />
        </label>
      ))}
      <label>
        思考能力
        <select
          aria-label="思考能力"
          value={reasoning}
          onChange={(e) => setReasoning(e.target.value)}
        >
          <option value="auto">
            自动：
            {model.automatic.reasoning === undefined
              ? "未确认"
              : model.automatic.reasoning
                ? "支持"
                : "不支持"}
          </option>
          <option value="true">手工指定支持</option>
          <option value="false">手工指定不支持</option>
        </select>
        <Source source={model.automaticSources.reasoning} />
      </label>
      <label>
        输入能力
        <select aria-label="输入能力" value={input} onChange={(e) => setInput(e.target.value)}>
          <option value="auto">自动：{model.automatic.input?.join(" / ") ?? "未确认"}</option>
          <option value="text">文本</option>
          <option value="text,image">文本与图片</option>
        </select>
        <Source source={model.automaticSources.input} />
      </label>
      <details className="provider-advanced">
        <summary>价格覆盖（Token、缓存、按次与阶梯）</summary>
        <ModelPricingEditor
          draft={prices}
          onChange={setPrices}
          automatic={model.automatic.pricing}
          disabled={busy}
        />
        <Source source={model.automaticSources.pricing} />
      </details>
      <details className="provider-advanced">
        <summary>思考档位</summary>
        <p className="provider-help">
          配置模型支持的档位，各引擎共用。留空使用自动值，通常无需单独配置协议映射。
        </p>
        <Source source={model.automaticSources.reasoningOptions} />
        <label>
          支持的思考档位（JSON）
          <textarea
            value={options}
            onChange={(e) => setOptions(e.target.value)}
            placeholder={'[{"type":"effort","values":["low","high"]}]'}
            rows={4}
          />
        </label>
        <details className="provider-advanced">
          <summary>引擎协议映射（高级）</summary>
          <p className="provider-help">
            将 SDK 内部档位映射为模型接口接受的值；null 表示禁用，留空则自动处理。
          </p>
          <Source source={model.automaticSources.thinkingLevelMap} />
          <label>
            档位映射覆盖（JSON）
            <textarea
              value={mapping}
              onChange={(e) => setMapping(e.target.value)}
              placeholder={'{"low":"low","high":"high","max":null}'}
              rows={4}
            />
          </label>
        </details>
      </details>
      <div className="provider-actions">
        <button
          type="button"
          className="quiet-btn"
          disabled={busy || !Object.keys(model.overrides).length}
          onClick={() => void run(() => save({}))}
        >
          恢复全部自动参数
        </button>
        <button className="primary" disabled={busy}>
          保存参数覆盖
        </button>
      </div>
    </form>
  );
}

function BindingEditor({
  data,
  initialHarness = "kodo",
  applyDefaultInitially = false,
  defaultsRevision,
  binding,
  busy,
  run,
  onClose,
}: {
  data: ProviderConfiguration;
  initialHarness?: HarnessId;
  applyDefaultInitially?: boolean;
  defaultsRevision: number;
  binding?: HarnessBinding;
  busy: boolean;
  run: Run;
  onClose: () => void;
}) {
  const persist = useConfigurationSave("/harness-bindings");
  const [applyAsDefault, setApplyAsDefault] = useState(applyDefaultInitially);
  const [name, setName] = useState(
      binding?.name ?? (applyDefaultInitially ? `${HARNESS_NAMES[initialHarness]} Provider` : ""),
    ),
    [harness, setHarness] = useState<HarnessId>(binding?.harnessId ?? initialHarness);
  const firstCompatible = data.models.find((model) => compatibleModel(data, model, harness));
  const [modelId, setModelId] = useState(
      binding?.modelId ?? firstCompatible?.id ?? data.models[0]?.id ?? "",
    ),
    [reasoning, setReasoning] = useState(binding?.reasoning ?? ""),
    [route, setRoute] = useState("auto");
  const [plan, setPlan] = useState<{
    supported: boolean;
    issues: string[];
    route: string;
    credentialTransport?: string;
    parameterNotes?: string[];
    gatewayCapabilities?: { validation: string };
  }>();
  const [previewError, setPreviewError] = useState("");
  const model = data.models.find((m) => m.id === modelId),
    values = efforts(model, harness);
  useEffect(() => {
    let active = true;
    setPlan(undefined);
    setPreviewError("");
    void api<NonNullable<typeof plan>>("/harness-bindings/preview", "POST", {
      name: "配置预览",
      harnessId: harness,
      modelId,
      reasoning: reasoning || null,
      route,
    })
      .then((p) => {
        if (active) setPlan(p);
      })
      .catch((e: Error) => {
        if (active) setPreviewError(e.message);
      });
    return () => {
      active = false;
    };
  }, [harness, modelId, reasoning, route]);
  return (
    <form
      className="provider-editor ios-form"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          await persist({
            ...(binding ? { id: binding.id, expectedRevision: binding.revision } : {}),
            name,
            harnessId: harness,
            modelId,
            reasoning: reasoning || null,
            route,
            ...(applyAsDefault
              ? { applyAsDefault: true, expectedDefaultsRevision: defaultsRevision }
              : {}),
          });
          onClose();
        });
      }}
    >
      <EditorHeader title={binding ? "编辑 Harness 绑定" : "添加 Harness 绑定"} onClose={onClose} />
      <label>
        绑定名称
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="用于新对话模型菜单"
        />
      </label>
      <label>
        目标 Harness
        <select
          aria-label="目标 Harness"
          value={harness}
          onChange={(e) => {
            setHarness(e.target.value as HarnessId);
            setReasoning("");
          }}
        >
          {HARNESS_IDS.map((h) => (
            <option key={h} value={h}>
              {HARNESS_NAMES[h]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Provider 与模型
        <select
          aria-label="Provider 与模型"
          value={modelId}
          onChange={(e) => {
            setModelId(e.target.value);
            setReasoning("");
          }}
        >
          {data.models.map((m) => (
            <option key={m.id} value={m.id}>
              {data.providers.find((p) => p.id === m.providerId)?.name} /{" "}
              {
                data.providers
                  .find((p) => p.id === m.providerId)
                  ?.endpoints.find((v) => v.id === m.endpointId)?.name
              }{" "}
              / {m.model}
            </option>
          ))}
        </select>
      </label>
      <label>
        默认思考强度
        <select
          aria-label="默认思考强度"
          value={reasoning}
          onChange={(e) => setReasoning(e.target.value)}
        >
          <option value="">由原生设置决定</option>
          {values.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label>
        协议路径
        <select aria-label="协议路径" value={route} onChange={(e) => setRoute(e.target.value)}>
          <option value="auto">自动匹配已支持的路径</option>
          <option value="direct">原生协议直连</option>
          <option value="gateway">本地转换网关</option>
        </select>
      </label>
      <div className="provider-preview" role="status">
        <span>
          {previewError ||
            (!plan
              ? "检查兼容性…"
              : plan.supported
                ? `可保存 · ${plan.route === "direct" ? "原生协议直连" : "本地转换网关"}`
                : plan.issues.join(" "))}
        </span>
      </div>
      <div className="provider-actions">
        <label className="provider-default-toggle">
          <input
            type="checkbox"
            checked={applyAsDefault}
            onChange={(e) => setApplyAsDefault(e.target.checked)}
          />
          设为该 Harness 的新会话默认配置
        </label>
        <button className="primary" disabled={busy || !plan?.supported || !name.trim()}>
          保存 Harness 绑定
        </button>
      </div>
    </form>
  );
}
