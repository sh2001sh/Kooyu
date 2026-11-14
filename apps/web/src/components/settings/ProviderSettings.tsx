import { useCallback, useEffect, useState } from "react";
import { KeyRound, Plus, RefreshCw, Trash2 } from "lucide-react";
import type {
  CatalogModel,
  EndpointProtocol,
  ModelParameters,
  Provider,
  ProviderConfiguration,
} from "@kodo/protocol";
import { bindingReasoningLevels } from "@kodo/protocol/client";
import { api } from "../../lib/host-client";
import { formatDate } from "../../lib/harnesses";
import { catalogModelSource, groupCatalogModels } from "../../lib/catalog-models";
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

/** Model sources: an account/service (provider) with its endpoints, key and models. */
export function ProviderSettings({
  act,
  onLoaded,
}: {
  act: Action;
  onLoaded?: (data: ProviderConfiguration) => void;
}) {
  const [data, setData] = useState<ProviderConfiguration>(),
    [editing, setEditing] = useState<Provider | null | false>(false),
    [modelProvider, setModelProvider] = useState(""),
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
  const run = async (work: () => Promise<unknown>, done?: string) => {
    setError("");
    setNotice("");
    await act(async () => {
      try {
        await work();
        await load();
        if (done) setNotice(done);
      } catch (e) {
        setError(e instanceof Error ? e.message : "操作失败，请重试。");
      }
    });
  };

  const activeProvider = data?.providers.some((provider) => provider.id === modelProvider)
    ? modelProvider
    : "";
  return (
    <SettingsPage
      title="模型来源"
      description="添加你的 API 服务（官方或中转），保存后自动获取模型列表，并补全上下文窗口、思考档位和参考价格。在「引擎」里选择哪个引擎使用它。"
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
          models={data.models.filter((m) => m.providerId === p.id)}
          usedBy={data.bindings.filter((b) => b.providerId === p.id).length}
          onEdit={() => setEditing(p)}
          run={run}
        />
      ))}
      {data && data.models.length > 0 && (
        <SettingsSection
          title="模型"
          description="同一模型只展示一次。选择来源查看或修改该服务的参数和价格。"
          actions={
            <SxSelect
              ariaLabel="模型来源筛选"
              value={activeProvider}
              onChange={setModelProvider}
              options={[
                { value: "", label: "全部来源" },
                ...data.providers.map((provider) => ({
                  value: provider.id,
                  label: provider.name,
                })),
              ]}
            />
          }
        >
          <ModelTable
            models={data.models.filter(
              (model) => !activeProvider || model.providerId === activeProvider,
            )}
            providers={data.providers}
            run={run}
          />
        </SettingsSection>
      )}
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
  models,
  usedBy,
  onEdit,
  run,
}: {
  provider: Provider;
  models: CatalogModel[];
  usedBy: number;
  onEdit: () => void;
  run: (work: () => Promise<unknown>, done?: string) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [newModel, setNewModel] = useState("");
  const failed = p.discovery?.some((d) => d.status === "error");
  const endpoint = p.endpoints[0];
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
            <span className="sx-tag">{usedBy ? `${usedBy} 个引擎在用` : "尚未被引擎使用"}</span>
          </div>
        </div>
      }
      actions={
        <>
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
            }, "已添加");
          }}
        >
          <SettingsRow
            label="模型 ID"
            description="与服务商文档中的模型名称一致。"
            htmlFor={`add-${p.id}`}
          >
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
    </SettingsSection>
  );
}

function num(v?: number) {
  return v === undefined ? "—" : v.toLocaleString();
}
function ModelTable({
  models,
  providers,
  run,
}: {
  models: CatalogModel[];
  providers: Provider[];
  run: (work: () => Promise<unknown>, done?: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [selectedSources, setSelectedSources] = useState<Record<string, string>>({});
  return (
    <div className="table-scroll sx-model-table-card">
      <table className="sx-table sx-model-table" aria-label="模型列表">
        <colgroup>
          <col style={{ width: "30%" }} />
          <col style={{ width: "16%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "20%" }} />
          <col style={{ width: "6%" }} />
        </colgroup>
        <thead>
          <tr>
            <th>模型</th>
            <th>来源</th>
            <th className="num">上下文</th>
            <th className="num">最大输出</th>
            <th>思考档位</th>
            <th>模型价格</th>
            <th />
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
                onDone={() => setEditing(null)}
                run={run}
              />
            ) : (
              <tr key={m.id}>
                <td className="model-identity">
                  <span className="sx-model-name">{m.model}</span>
                  {Object.keys(m.overrides).length > 0 && <span className="sx-edited">已修改</span>}
                </td>
                <td className="model-source" data-label="来源">
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
                        label: catalogModelSource(source, providers),
                      }))}
                    />
                  ) : (
                    <span className="sx-source-pill">{catalogModelSource(m, providers)}</span>
                  )}
                </td>
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
                <td className="model-pricing-cell">
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
              <td colSpan={7}>此来源暂无模型</td>
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
  onDone,
  run,
}: {
  model: CatalogModel;
  source: string;
  onDone: () => void;
  run: (work: () => Promise<unknown>, done?: string) => Promise<void>;
}) {
  const o = m.overrides;
  const [context, setContext] = useState(o.contextWindow?.toString() ?? "");
  const [output, setOutput] = useState(o.maxOutputTokens?.toString() ?? "");
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
      <td colSpan={7}>
        <form
          className="sx-model-editor"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const next: ModelParameters = { ...o };
              next.contextWindow = context.trim() ? Number(context) : undefined;
              next.maxOutputTokens = output.trim() ? Number(output) : undefined;
              next.pricing = readPricingDraft(prices);
              for (const key of Object.keys(next) as (keyof ModelParameters)[])
                if (next[key] === undefined) delete next[key];
              await save(next);
            });
          }}
        >
          <h4>{m.model}</h4>
          <p className="provider-help">当前来源：{source}</p>
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
      <SettingsRow
        label="名称"
        description="只用于显示，例如「DeepSeek 官方」「公司中转」。"
        htmlFor="pv-name"
      >
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
          <SettingsRow
            label="接口格式"
            description={PROTOCOLS.find((p) => p.value === d.protocol)?.hint}
          >
            <SxSelect
              ariaLabel="接口格式"
              value={d.protocol}
              onChange={(value) => change(i, { protocol: value as EndpointProtocol })}
              options={PROTOCOLS.map((p) => ({
                value: p.value,
                label: p.label,
                hint: p.hint,
              }))}
            />
          </SettingsRow>
          <SettingsRow label="接口地址" description="通常以 /v1 结尾。">
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
