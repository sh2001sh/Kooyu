import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Check, KeyRound, RefreshCw } from "lucide-react";
import type {
  AppSettings,
  CatalogModel,
  EndpointProtocol,
  Provider,
  ProviderConfiguration,
  Snapshot,
} from "@kodo/protocol";
import { api } from "../../lib/host-client";
import { useAppPreferences } from "../../lib/preferences";
import { SetupModel } from "./SetupModel";

const protocols: { value: EndpointProtocol; label: string }[] = [
  { value: "openai-completions", label: "OpenAI Chat Completions（兼容接口）" },
  { value: "openai-responses", label: "OpenAI Responses" },
  { value: "anthropic-messages", label: "Anthropic Messages" },
  { value: "google-generative-ai", label: "Google Generative AI" },
];

export function SetupConnection({
  snapshot,
  refresh,
  onContinue,
}: {
  snapshot: Snapshot;
  refresh: () => Promise<Snapshot>;
  onContinue: () => Promise<void>;
}) {
  const [config, setConfig] = useState<ProviderConfiguration>();
  const [source, setSource] = useState("");
  const [modelId, setModelId] = useState("");
  const [name, setName] = useState("我的模型服务");
  const [protocol, setProtocol] = useState<EndpointProtocol>("openai-completions");
  const [baseUrl, setBaseUrl] = useState("");
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [manual, setManual] = useState("");
  const [addModel, setAddModel] = useState(false);
  const attempt = useRef<{ signature: string; id: string } | undefined>(undefined);
  const { save: savePreferences } = useAppPreferences();
  const current = snapshot.bindings.find(
    (b) => b.id === snapshot.bindingDefaults.harnessBindingIds.kodo,
  );
  const load = useCallback(async () => {
    const next = await api<ProviderConfiguration>("/provider-configuration");
    setConfig(next);
    return next;
  }, []);
  useEffect(() => {
    void load().catch((e: Error) => setError(e.message));
  }, [load]);
  useEffect(() => {
    if (config && !source) {
      const first = config.providers[0];
      setSource(
        current
          ? current.providerId + ":" + current.endpointId
          : first
            ? first.id + ":" + first.endpoints[0]!.id
            : "new",
      );
      if (current) setModelId(current.modelId);
    }
  }, [config, source, current]);
  const [providerId, endpointId] = source.split(":");
  const provider = config?.providers.find((p) => p.id === providerId);
  const endpoint = provider?.endpoints.find((e) => e.id === endpointId);
  const models =
    config?.models.filter((m) => m.providerId === providerId && m.endpointId === endpointId) ?? [];
  const model = models.find((m) => m.id === modelId) ?? models[0];
  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败，请检查后重试。");
    } finally {
      setBusy(false);
    }
  };
  const saveSource = () =>
    run(async () => {
      const body =
        editing && provider && endpoint
          ? {
              id: provider.id,
              expectedRevision: provider.revision,
              name: name.trim(),
              endpoints: provider.endpoints.map((e) => ({
                id: e.id,
                name: e.name,
                protocol: e.id === endpointId ? protocol : e.protocol,
                baseUrl: e.id === endpointId ? baseUrl.trim() : e.baseUrl,
                ...(e.modelsUrl ? { modelsUrl: e.modelsUrl } : {}),
                ...(e.id === endpointId && key.trim() ? { apiKey: key.trim() } : {}),
              })),
            }
          : {
              name: name.trim(),
              endpoints: [
                {
                  name: "主接口",
                  protocol,
                  baseUrl: baseUrl.trim(),
                  ...(key.trim() ? { apiKey: key.trim() } : {}),
                },
              ],
            };
      const signature = JSON.stringify(body);
      if (attempt.current?.signature !== signature)
        attempt.current = { signature, id: crypto.randomUUID() };
      const saved = await api<Provider>("/providers", "POST", {
        ...body,
        requestId: attempt.current.id,
      });
      setKey("");
      setShowKey(false);
      attempt.current = undefined;
      setSource(saved.id + ":" + (editing ? endpointId : saved.endpoints[0]!.id));
      setEditing(false);
      setModelId("");
      await load();
      setNotice("API 配置已保存。请选择下面的主模型。");
    });
  const applyModel = async (selected: CatalogModel) => {
    const latest = await api<Snapshot>("/snapshot");
    await api("/harness-bindings", "POST", {
      name: (provider?.name ?? "主 Agent") + " · Kooyu",
      harnessId: "kodo",
      modelId: selected.id,
      selectionMode: "provider",
      reasoning: null,
      route: "direct",
      applyAsDefault: true,
      expectedDefaultsRevision: latest.bindingDefaults.revision,
      requestId: crypto.randomUUID(),
    });
    const settings = await api<AppSettings>("/app-settings");
    await savePreferences({
      ...settings,
      harnessDefaults: {
        ...settings.harnessDefaults,
        kodo: {
          ...settings.harnessDefaults.kodo,
          model: selected.model,
          reasoning: null,
          permissionMode: settings.harnessDefaults.kodo?.permissionMode ?? null,
          modelMap: settings.harnessDefaults.kodo?.modelMap ?? {},
        },
      },
    });
    await refresh();
    await onContinue();
  };
  return (
    <div className="setup-connection" aria-busy={busy}>
      {error && (
        <p className="setup-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="setup-notice" role="status">
          <Check size={15} />
          {notice}
        </p>
      )}
      {!config ? (
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await load();
            })
          }
        >
          {busy ? "正在读取…" : "重新读取模型来源"}
        </button>
      ) : (
        <>
          <fieldset disabled={busy} className="setup-fields">
            {config.providers.length > 0 && (
              <label>
                模型来源
                <select
                  aria-label="模型来源"
                  value={source}
                  onChange={(e) => {
                    setSource(e.target.value);
                    setEditing(false);
                    setModelId("");
                    setError("");
                    setKey("");
                    setShowKey(false);
                    attempt.current = undefined;
                  }}
                >
                  <option value="new">添加新的 API 服务</option>
                  {config.providers.flatMap((p) =>
                    p.endpoints.map((e) => (
                      <option key={e.id} value={p.id + ":" + e.id}>
                        {p.name} · {e.name}
                      </option>
                    )),
                  )}
                </select>
              </label>
            )}
          </fieldset>
          {source === "new" || editing ? (
            <form
              className="setup-form"
              onSubmit={(e) => {
                e.preventDefault();
                void saveSource();
              }}
            >
              <fieldset disabled={busy} className="setup-fields">
                <label>
                  来源名称
                  <input
                    required
                    maxLength={100}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="例如：公司模型服务"
                    autoComplete="off"
                  />
                </label>
                <label>
                  接口格式
                  <select
                    aria-label="接口格式"
                    value={protocol}
                    onChange={(e) => setProtocol(e.target.value as EndpointProtocol)}
                  >
                    {protocols.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Base URL
                  <input
                    required
                    type="url"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://api.example.com/v1"
                    spellCheck={false}
                    autoComplete="url"
                    aria-describedby="setup-url-help"
                  />
                </label>
                <p id="setup-url-help" className="setup-help">
                  填写服务商提供的接口根地址（非聊天网页）。协议需与服务一致。
                </p>
                <label>
                  API Key
                  <span className="setup-key-input">
                    <input
                      aria-label="API Key"
                      type={showKey ? "text" : "password"}
                      value={key}
                      onChange={(e) => setKey(e.target.value)}
                      autoComplete="new-password"
                      spellCheck={false}
                      placeholder={
                        editing && endpoint?.credentialRef
                          ? "已保存；留空保持不变"
                          : "粘贴密钥；本地无认证服务可留空"
                      }
                    />
                    <button
                      type="button"
                      aria-pressed={showKey}
                      onClick={() => setShowKey(!showKey)}
                    >
                      {showKey ? "隐藏" : "显示"}
                    </button>
                  </span>
                </label>
                <p className="setup-help setup-key-note">
                  <KeyRound size={13} />
                  密钥保存在系统凭据库，不写入浏览器存储。
                </p>
                <div className="setup-actions">
                  {editing && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(false);
                        setKey("");
                      }}
                    >
                      取消修改
                    </button>
                  )}
                  <button className="primary" disabled={busy}>
                    {busy ? "正在保存并获取模型…" : "保存并获取模型"}
                    <ArrowRight size={15} />
                  </button>
                </div>
              </fieldset>
            </form>
          ) : (
            endpoint && (
              <>
                <div className="setup-source-summary">
                  <div>
                    <strong>{provider?.name}</strong>
                    <span>{endpoint.baseUrl}</span>
                  </div>
                  <button
                    disabled={busy}
                    onClick={() => {
                      setName(provider!.name);
                      setProtocol(endpoint.protocol);
                      setBaseUrl(endpoint.baseUrl);
                      setEditing(true);
                    }}
                  >
                    修改 API
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api(
                          "/providers/" +
                            providerId +
                            "/endpoints/" +
                            endpointId +
                            "/models/refresh",
                          "POST",
                          {},
                        );
                        await load();
                        setNotice("模型列表已读取；真实对话将在你发送消息后验证。");
                      })
                    }
                  >
                    <RefreshCw size={14} />
                    重新获取
                  </button>
                </div>
                {provider?.discovery?.some(
                  (d) => d.endpointId === endpointId && d.status === "error",
                ) && (
                  <p className="setup-error" role="alert">
                    API
                    已保存，但未能获取模型列表。请检查地址、接口格式和密钥后重试，也可手动填写模型
                    ID。
                  </p>
                )}
                {models.length > 0 && (
                  <label className="setup-model-label">
                    主 Agent 模型
                    <select
                      aria-label="主 Agent 模型"
                      disabled={busy}
                      value={model?.id ?? ""}
                      onChange={(e) => setModelId(e.target.value)}
                    >
                      {models.map((m) => (
                        <option value={m.id} key={m.id}>
                          {m.name === m.model ? m.model : m.name + " · " + m.model}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button
                  className="setup-text-button"
                  disabled={busy}
                  onClick={() => setAddModel(!addModel)}
                >
                  {addModel ? "收起手动添加" : "列表没有想用的模型？手动添加"}
                </button>
                {addModel && (
                  <form
                    className="setup-inline-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run(async () => {
                        const created = await api<CatalogModel>("/provider-models", "POST", {
                          providerId,
                          endpointId,
                          model: manual.trim(),
                          requestId: crypto.randomUUID(),
                        });
                        await load();
                        setModelId(created.id);
                        setManual("");
                        setAddModel(false);
                      });
                    }}
                  >
                    <label>
                      模型 ID
                      <input
                        required
                        maxLength={200}
                        value={manual}
                        onChange={(e) => setManual(e.target.value)}
                        placeholder="服务商提供的准确模型 ID"
                      />
                    </label>
                    <button disabled={busy}>添加模型</button>
                  </form>
                )}
                {model && (
                  <SetupModel
                    key={model.id + ":" + model.revision}
                    model={model}
                    busy={busy}
                    run={run}
                    onSave={async (m) => {
                      await applyModel(m);
                    }}
                    onUpdated={async () => {
                      await load();
                    }}
                  />
                )}
              </>
            )
          )}
          <p className="setup-help setup-disclosure">
            这里只读取模型列表并保存配置，不自动测试推理；接口权限和工具能力需在首次对话中确认。
          </p>
        </>
      )}
    </div>
  );
}
