import { randomUUID } from "node:crypto";
import { AsyncEntry } from "@napi-rs/keyring";
import {
  KodoError,
  providerSchema,
  catalogModelSchema,
  bindingSchema,
  type Provider,
  type ProviderEndpoint,
  type CatalogModel,
  type HarnessBinding,
  type ModelParameters,
  type ParameterOrigins,
  type BindingRuntime,
  type ProviderConfiguration,
  type BindingDefaults,
  type HarnessId,
  type HarnessModelOption,
  type ModelPricing,
} from "@kodo/protocol";
import type { Store } from "../storage/store.js";
import {
  bundledCatalog,
  parsePublicCatalog,
  readJSON,
  parameters,
  contentRevision,
  CATALOG_TTL,
  CATALOG_URL,
  PRICING_VERSION,
  effortValues,
  type PublicCatalog,
  type PublicModel,
} from "./catalog.js";
import { bindingReasoningLevels, HARNESS_PROVIDER_PROTOCOLS } from "@kodo/protocol/client";
import { Gateway } from "./gateway.js";
import { CredentialRelay } from "./credential-relay.js";
import { bindingConfigIssues } from "./native-config.js";
import { appSettings } from "../configuration/preferences.js";
import { officialModelReasoning } from "./model-reasoning.js";

export interface ProviderVault {
  get(ref: string): Promise<string | null>;
  set(ref: string, value: string): Promise<void>;
  delete(ref: string): Promise<void>;
}
const systemVault: ProviderVault = {
  get: (ref) => new AsyncEntry("Kodo", ref).getPassword(),
  set: (ref, value) => new AsyncEntry("Kodo", ref).setPassword(value),
  delete: async (ref) => {
    await new AsyncEntry("Kodo", ref).deletePassword();
  },
};
export class ProviderService {
  private readonly vault: ProviderVault;
  private readonly fetcher: typeof fetch;
  private readonly autoDiscover: boolean;
  private refresh?: Promise<ReturnType<ProviderService["state"]>>;
  private seeding?: Promise<PublicCatalog>;
  private resolvedCatalogRevision?: string;
  private closed = false;
  private readonly pending = new Set<Promise<unknown>>();
  private readonly abort = new AbortController();
  private readonly saving = new Map<string, { fingerprint: string; task: Promise<unknown> }>();
  readonly gateway: Gateway;
  readonly credentialRelay: CredentialRelay;
  constructor(
    readonly store: Store,
    options: { vault?: ProviderVault; fetcher?: typeof fetch; autoDiscover?: boolean } = {},
  ) {
    this.vault = options.vault ?? systemVault;
    this.fetcher = options.fetcher ?? fetch;
    this.autoDiscover = options.autoDiscover ?? true;
    this.gateway = new Gateway(this.fetcher);
    this.credentialRelay = new CredentialRelay(this.fetcher);
  }
  private run<T>(work: () => Promise<T>): Promise<T> {
    this.assertOpen();
    const task = work();
    this.pending.add(task);
    void task.finally(() => this.pending.delete(task)).catch(() => {});
    return task;
  }
  private replay<T>(kind: string, input: { requestId?: string }): T | undefined {
    if (!input.requestId) return undefined;
    const receipt = this.store.record<{
      kind: string;
      fingerprint: string;
      entityId: string;
      revision: number;
    }>("configuration-request", input.requestId);
    if (!receipt) return undefined;
    if (receipt.kind !== kind || receipt.fingerprint !== contentRevision(input))
      throw new KodoError("CONFLICT", "同一配置请求 ID 不能用于不同内容。");
    const saved = this.store.record<T>(
      `${kind}-revision`,
      `${receipt.entityId}:${receipt.revision}`,
    );
    if (!saved) throw new KodoError("CONFLICT", "配置回执修订缺失，请重新读取配置核对。");
    return saved;
  }
  private remember(
    kind: string,
    input: { requestId?: string },
    result: { id: string; revision: number },
  ) {
    if (input.requestId)
      this.store.put("configuration-request", input.requestId, {
        kind,
        fingerprint: contentRevision(input),
        entityId: result.id,
        revision: result.revision,
      });
  }
  private save<T>(kind: string, input: { requestId?: string }, work: () => Promise<T>): Promise<T> {
    return this.run(async () => {
      const prior = this.replay<T>(kind, input);
      if (prior) return prior;
      if (!input.requestId) return work();
      const signature = contentRevision(input),
        pending = this.saving.get(input.requestId);
      if (pending) {
        if (pending.fingerprint !== signature)
          throw new KodoError("CONFLICT", "同一配置请求 ID 正在保存不同内容。");
        return pending.task as Promise<T>;
      }
      const task = work();
      this.saving.set(input.requestId, { fingerprint: signature, task });
      try {
        return await task;
      } finally {
        this.saving.delete(input.requestId);
      }
    });
  }
  saveProvider(value: unknown) {
    const input = providerSchema.parse(value);
    return this.save("provider", input, async () => {
      const provider = await this.writeProvider(input);
      if (!this.autoDiscover) return provider;
      await Promise.all(
        provider.endpoints.map(async (endpoint) => {
          let result: NonNullable<Provider["discovery"]>[number];
          try {
            const models = await this.discoverModels(provider.id, endpoint.id);
            result = {
              endpointId: endpoint.id,
              status: "ready",
              count: models.length,
              updatedAt: new Date().toISOString(),
            };
          } catch {
            result = {
              endpointId: endpoint.id,
              status: "error",
              count: 0,
              message: "Provider 已保存，模型获取失败。请检查入口和凭据后点击重新获取。",
              updatedAt: new Date().toISOString(),
            };
          }
          if (this.store.record<Provider>("provider", provider.id)?.revision === provider.revision)
            this.store.put("provider-discovery-status", `${provider.id}:${endpoint.id}`, result);
        }),
      );
      return provider;
    });
  }
  /**
   * Remove a provider and its models. Bindings that use it are removed from the
   * defaults; existing conversations keep their frozen revision and still run.
   */
  deleteProvider(id: string) {
    this.provider(id);
    this.store.transaction(() => {
      const bindings = this.store
        .records<HarnessBinding>("harness-binding")
        .filter((b) => b.providerId === id);
      const removed = new Set(bindings.map((b) => b.id));
      for (const b of bindings) this.store.remove("harness-binding", b.id);
      const defaults = this.store.record<BindingDefaults>("binding-defaults", "global");
      if (defaults) {
        const ids = { ...defaults.harnessBindingIds };
        for (const [harness, bindingId] of Object.entries(ids))
          if (bindingId && removed.has(bindingId)) delete ids[harness as HarnessId];
        this.store.put("binding-defaults", "global", {
          harnessBindingIds: ids,
          revision: defaults.revision + 1,
        });
      }
      for (const m of this.store
        .records<CatalogModel>("provider-model")
        .filter((m) => m.providerId === id))
        this.store.remove("provider-model", m.id);
      this.store.remove("provider", id);
    });
    return { deleted: true };
  }
  /** Remove one model from a provider's list. */
  deleteModel(id: string) {
    if (!this.store.record<CatalogModel>("provider-model", id))
      throw new KodoError("NOT_FOUND", "模型不存在。");
    this.store.remove("provider-model", id);
    return { deleted: true };
  }
  saveModel(value: unknown) {
    const input = catalogModelSchema.parse(value);
    return this.save("provider-model", input, () => this.writeModel(input));
  }
  discover(providerId: string, endpointId: string) {
    return this.run(async () => {
      const models = await this.discoverModels(providerId, endpointId);
      this.store.put("provider-discovery-status", `${providerId}:${endpointId}`, {
        endpointId,
        status: "ready",
        count: models.length,
        updatedAt: new Date().toISOString(),
      });
      return models;
    });
  }
  private assertOpen() {
    if (this.closed) throw new KodoError("UNAVAILABLE", "配置服务已经关闭。");
  }
  private provider(id: string): Provider {
    const p = this.store.record<Provider>("provider", id);
    if (!p) throw new KodoError("NOT_FOUND", "Provider 不存在。");
    return p;
  }
  private endpoint(p: Provider, id: string): ProviderEndpoint {
    const e = p.endpoints.find((e) => e.id === id);
    if (!e) throw new KodoError("NOT_FOUND", "协议入口不存在。");
    return e;
  }
  private async catalog(): Promise<PublicCatalog> {
    const saved = this.store.record<PublicCatalog>("model-catalog", "current");
    if (saved) return saved;
    if (!this.seeding)
      this.seeding = bundledCatalog().then((value) => {
        this.assertOpen();
        if (!this.store.record("model-catalog", "current"))
          this.store.put("model-catalog", "current", value);
        return this.store.record<PublicCatalog>("model-catalog", "current")!;
      });
    return this.seeding;
  }
  state() {
    const c = this.store.record<PublicCatalog>("model-catalog", "current"),
      error = this.store.record<{ message: string }>("model-catalog", "error");
    return {
      revision: c?.revision ?? null,
      fetchedAt: c?.fetchedAt ?? null,
      checkedAt: c?.checkedAt ?? null,
      source: c?.source ?? CATALOG_URL,
      modelCount: c?.entries.length ?? 0,
      stale:
        !c ||
        c.kind === "bundled-catalog" ||
        Date.now() - Date.parse(c.checkedAt) > CATALOG_TTL ||
        // Catalogs stored before prices were parsed must be fetched again.
        (c.kind === "remote-catalog" && (!c.pricingParsed || c.pricingVersion !== PRICING_VERSION)),
      ...(error ? { error: error.message } : {}),
    };
  }
  /** Background refresh, at most hourly after a failed or skipped attempt. */
  refreshIfStale(): void {
    if (!appSettings(this.store).autoRefreshModels) return;
    const lastAttempt = this.store.record<{ at: number }>("model-catalog", "attempt");
    if (this.state().stale && (!lastAttempt || Date.now() - lastAttempt.at > 3600000))
      void this.refreshCatalog(false).catch(() => {});
  }
  async configuration(): Promise<ProviderConfiguration> {
    const catalog = await this.catalog();
    const lastAttempt = this.store.record<{ at: number }>("model-catalog", "attempt");
    if (
      this.store.records("provider").length &&
      appSettings(this.store).autoRefreshModels &&
      this.state().stale &&
      (!lastAttempt || Date.now() - lastAttempt.at > 3600000)
    )
      void this.refreshCatalog(false).catch(() => {});
    // Existing models can have limits but still lack newer metadata such as prices.
    // Rehydrate through the normal merge once per catalog revision, keeping overrides.
    if (this.resolvedCatalogRevision !== catalog.revision) {
      this.store.transaction(() => {
        const changedProviders = new Map<string, number>();
        for (const m of this.store.records<CatalogModel>("provider-model")) {
          const provider = this.store.record<Provider>(
            "provider-revision",
            `${m.providerId}:${m.providerRevision}`,
          );
          if (provider && this.resolveModel(m, provider, true).revision !== m.revision)
            changedProviders.set(provider.id, provider.revision);
        }
        for (const [id, revision] of changedProviders) this.refreshProviderBindings(id, revision);
      });
      this.resolvedCatalogRevision = catalog.revision;
    }
    return {
      providers: this.store.records<Provider>("provider").map((provider) => ({
        ...provider,
        discovery: provider.endpoints.flatMap((endpoint) => {
          const status = this.store.record<NonNullable<Provider["discovery"]>[number]>(
            "provider-discovery-status",
            `${provider.id}:${endpoint.id}`,
          );
          return status ? [status] : [];
        }),
      })),
      models: this.store.records<CatalogModel>("provider-model"),
      bindings: this.store.records<HarnessBinding>("harness-binding"),
      catalog: this.state(),
    };
  }
  async search(query: string, provider?: string) {
    const c = await this.catalog(),
      q = query.toLocaleLowerCase();
    return c.entries
      .filter(
        (m) =>
          (!provider || m.provider === provider) &&
          (!q || `${m.key} ${m.name}`.toLocaleLowerCase().includes(q)),
      )
      .slice(0, 80);
  }
  async refreshCatalog(force = true) {
    this.assertOpen();
    if (this.refresh) return this.refresh;
    this.refresh = this.fetchCatalog(force).finally(() => {
      this.refresh = undefined;
    });
    return this.refresh;
  }
  private async fetchCatalog(force: boolean) {
    const prior = await this.catalog();
    if (
      !force &&
      prior.kind === "remote-catalog" &&
      Date.now() - Date.parse(prior.checkedAt) < CATALOG_TTL &&
      prior.pricingParsed &&
      prior.pricingVersion === PRICING_VERSION
    )
      return this.state();
    const withoutPricing =
      prior.kind === "remote-catalog" &&
      (!prior.pricingParsed || prior.pricingVersion !== PRICING_VERSION);
    this.store.put("model-catalog", "attempt", { at: Date.now() });
    try {
      const response = await this.fetcher(CATALOG_URL, {
        headers: prior.etag && !withoutPricing ? { "If-None-Match": prior.etag } : {},
        redirect: "error",
        signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(25000)]),
      });
      const now = new Date().toISOString();
      if (response.status === 304) {
        this.assertOpen();
        this.store.put("model-catalog", "current", { ...prior, checkedAt: now });
      } else {
        const data = await readJSON(response),
          entries = parsePublicCatalog(data),
          revision = contentRevision(entries);
        this.assertOpen();
        this.store.transaction(() => {
          this.store.put("model-catalog", "current", {
            revision,
            etag: response.headers.get("etag") ?? undefined,
            fetchedAt: now,
            checkedAt: now,
            source: CATALOG_URL,
            kind: "remote-catalog",
            pricingParsed: true,
            pricingVersion: PRICING_VERSION,
            entries,
          } satisfies PublicCatalog);
          for (const m of this.store.records<CatalogModel>("provider-model")) {
            const provider = this.store.record<Provider>(
              "provider-revision",
              `${m.providerId}:${m.providerRevision}`,
            );
            if (provider) this.resolveModel(m, provider, true);
          }
          for (const provider of this.store.records<Provider>("provider"))
            this.refreshProviderBindings(provider.id, provider.revision);
        });
      }
      this.store.remove("model-catalog", "error");
      return this.state();
    } catch (error) {
      if (this.closed) throw error;
      // Do not expose remote bodies, URLs with query credentials, or authorization errors.
      this.store.put("model-catalog", "error", {
        message:
          error instanceof Error && !/fetch failed/i.test(error.message)
            ? error.message.slice(0, 160)
            : "在线目录读取失败，继续使用最后有效目录。",
      });
      throw new KodoError("UNAVAILABLE", "在线目录刷新失败，已保留最后有效数据和手工覆盖。");
    }
  }
  private async writeProvider(value: unknown): Promise<Provider> {
    const input = providerSchema.parse(value),
      id = input.id ?? randomUUID(),
      previous = this.store.record<Provider>("provider", id);
    if (input.id && !previous) throw new KodoError("NOT_FOUND", "Provider 不存在。");
    if (previous && input.expectedRevision !== previous.revision)
      throw new KodoError("CONFLICT", "Provider 已被修改，请刷新。");
    const revision = (previous?.revision ?? 0) + 1,
      owned: string[] = [];
    try {
      const endpoints: ProviderEndpoint[] = [];
      for (const e of input.endpoints) {
        const eid = e.id ?? randomUUID(),
          old = previous?.endpoints.find((o) => o.id === eid);
        if (e.id && !old) throw new KodoError("INVALID_INPUT", "入口 ID 不属于这个 Provider。");
        if (endpoints.some((o) => o.id === eid))
          throw new KodoError("INVALID_INPUT", "协议入口 ID 重复。");
        if (e.apiKey && e.clearCredential)
          throw new KodoError("INVALID_INPUT", "不能同时替换和移除凭据。");
        const ref = e.apiKey
          ? `provider:${id}:${revision}:${eid}:${randomUUID()}`
          : e.clearCredential
            ? null
            : (old?.credentialRef ?? null);
        if (e.apiKey) {
          owned.push(ref!);
          this.store.put("credential-owned", ref!, {
            ref,
            state: "pending",
            createdAt: new Date().toISOString(),
          });
          await this.vault.set(ref!, e.apiKey);
        }
        endpoints.push({
          id: eid,
          name: e.name,
          protocol: e.protocol,
          baseUrl: e.baseUrl,
          modelsUrl: e.modelsUrl,
          credentialRef: ref,
        });
      }
      this.assertOpen();
      const provider: Provider = {
        id,
        revision,
        name: input.name,
        catalogProvider: input.catalogProvider,
        endpoints,
        updatedAt: new Date().toISOString(),
      };
      this.store.transaction(() => {
        if (this.store.record<Provider>("provider", id)?.revision !== previous?.revision)
          throw new KodoError("CONFLICT", "Provider 已被另一客户端修改。");
        this.store.put("provider", id, provider);
        this.store.put("provider-revision", `${id}:${revision}`, provider);
        for (const ref of owned) this.store.put("credential-owned", ref, { ref, state: "stored" });
        this.remember("provider", input, provider);
      });
      return provider;
    } catch (error) {
      for (const ref of owned) {
        try {
          await this.vault.delete(ref);
          this.store.remove("credential-owned", ref);
        } catch {}
      }
      throw error;
    }
  }
  private resolveModel(model: CatalogModel, provider: Provider, bump = false): CatalogModel {
    const catalog = this.store.record<PublicCatalog>("model-catalog", "current");
    const key =
      model.catalogKey ??
      (provider.catalogProvider ? `${provider.catalogProvider}/${model.model}` : undefined);
    const exact = catalog?.entries.find((m) => m.key === key);
    // Gateways and resellers rarely appear in the catalog; fall back to the same model ID
    // published by its vendor so window/output/reasoning are not left unconfirmed.
    const entry = exact ?? (model.catalogKey ? undefined : this.catalogMatch(model.model, catalog));
    const automatic: ModelParameters = {
        ...entry?.parameters,
        ...(entry?.pricing ? { pricing: entry.pricing } : {}),
      },
      automaticSources: ParameterOrigins = {};
    if (entry && catalog)
      for (const field of Object.keys(automatic) as (keyof ModelParameters)[])
        automaticSources[field] = {
          kind: catalog.kind,
          label: `${catalog.kind === "bundled-catalog" ? "Kooyu 内核内置目录" : "models.dev 聚合目录"}${exact ? "" : ` · 同名匹配 ${entry.key}`}`,
          reference: catalog.source,
          revision: catalog.revision,
          fetchedAt: catalog.fetchedAt,
        };
    const protocol = provider.endpoints.find(
      (endpoint) => endpoint.id === model.endpointId,
    )?.protocol;
    const official =
      !exact && !model.catalogKey && protocol
        ? officialModelReasoning(model.model, protocol)
        : undefined;
    if (official) {
      Object.assign(automatic, official);
      // A same-name reseller's SDK mapping must not override the official effort values.
      delete automatic.thinkingLevelMap;
      delete automaticSources.thinkingLevelMap;
      for (const field of Object.keys(official) as (keyof ModelParameters)[])
        automaticSources[field] = {
          kind: "bundled-catalog",
          label: "DeepSeek 官方思考参数定义",
          reference: "https://api-docs.deepseek.com/guides/thinking_mode",
          revision: "deepseek-v4.1-flash-thinking-2026-11-12",
          fetchedAt: "2026-11-12T00:00:00.000Z",
        };
    }
    const discovery = this.store.record<{
      parameters: ModelParameters;
      fetchedAt: string;
      revision: string;
    }>(
      "provider-model-discovery",
      `${provider.id}:${provider.revision}:${model.endpointId}:${model.model}`,
    );
    if (discovery)
      for (const field of Object.keys(discovery.parameters) as (keyof ModelParameters)[]) {
        Object.assign(automatic, { [field]: discovery.parameters[field] });
        automaticSources[field] = {
          kind: "endpoint",
          label: "当前入口模型接口",
          revision: discovery.revision,
          fetchedAt: discovery.fetchedAt,
        };
      }
    const effective = {
        ...automatic,
        ...model.overrides,
        ...(model.overrides.pricing
          ? { pricing: { ...automatic.pricing, ...model.overrides.pricing } }
          : {}),
      },
      sources = { ...automaticSources };
    for (const field of Object.keys(model.overrides) as (keyof ModelParameters)[])
      sources[field] = {
        kind: "user",
        label: "用户覆盖",
        revision: String(model.revision),
        fetchedAt: model.updatedAt,
      };
    const changed =
      JSON.stringify({ automatic, automaticSources }) !==
      JSON.stringify({ automatic: model.automatic, automaticSources: model.automaticSources });
    const revision = model.revision + (bump && changed ? 1 : 0);
    for (const field of Object.keys(model.overrides) as (keyof ModelParameters)[])
      sources[field] = {
        kind: "user",
        label: "用户覆盖",
        revision: String(revision),
        fetchedAt: model.updatedAt,
      };
    const next = { ...model, automatic, automaticSources, effective, sources, revision };
    this.store.put("provider-model", model.id, next);
    this.store.put("provider-model-revision", `${model.id}:${next.revision}`, next);
    return next;
  }
  private async writeModel(value: unknown): Promise<CatalogModel> {
    const input = catalogModelSchema.parse(value);
    await this.catalog();
    this.assertOpen();
    const p = this.provider(input.providerId);
    this.endpoint(p, input.endpointId);
    const id = input.id ?? randomUUID(),
      previous = this.store.record<CatalogModel>("provider-model", id);
    if (input.id && !previous) throw new KodoError("NOT_FOUND", "模型不存在。");
    if (
      previous &&
      (previous.revision !== input.expectedRevision ||
        previous.providerId !== p.id ||
        previous.endpointId !== input.endpointId ||
        previous.model !== input.model)
    )
      throw new KodoError("CONFLICT", "模型身份或修订已改变，请刷新。");
    if (
      !previous &&
      this.store
        .records<CatalogModel>("provider-model")
        .some(
          (m) =>
            m.providerId === p.id && m.endpointId === input.endpointId && m.model === input.model,
        )
    )
      throw new KodoError("CONFLICT", "这个入口已经有同名模型，请编辑已有条目。");
    if (
      input.catalogKey &&
      !this.store
        .record<PublicCatalog>("model-catalog", "current")
        ?.entries.some((m) => m.key === input.catalogKey)
    )
      throw new KodoError("INVALID_INPUT", "未找到选定目录条目，请刷新目录。");
    return this.store.transaction(() => {
      const result = this.resolveModel(
        {
          id,
          providerId: p.id,
          providerRevision: p.revision,
          endpointId: input.endpointId,
          model: input.model,
          name: input.name ?? input.model,
          revision: (previous?.revision ?? 0) + 1,
          catalogKey:
            input.catalogKey === null ? undefined : (input.catalogKey ?? previous?.catalogKey),
          automatic: {},
          automaticSources: {},
          overrides: input.overrides ?? previous?.overrides ?? {},
          effective: {},
          sources: {},
          listedAt: previous?.listedAt,
          updatedAt: new Date().toISOString(),
        },
        p,
      );
      this.remember("provider-model", input, result);
      this.refreshProviderBindings(p.id, p.revision);
      return result;
    });
  }
  private async discoverModels(providerId: string, endpointId: string) {
    const p = this.provider(providerId),
      e = this.endpoint(p, endpointId),
      key = e.credentialRef ? await this.vault.get(e.credentialRef) : null;
    if (e.credentialRef && !key) throw new KodoError("UNAVAILABLE", "系统凭据库中缺少该入口凭据。");
    const base = e.baseUrl.replace(/\/$/, ""),
      suffix =
        e.protocol === "anthropic-messages" && !/\/v1$/.test(base) ? "/v1/models" : "/models";
    let url: string | null = e.modelsUrl ?? `${base}${suffix}`;
    const origin = new URL(url).origin;
    if (origin !== new URL(base).origin && key)
      throw new KodoError(
        "INVALID_INPUT",
        "带凭据的模型列表必须与该协议入口同源，请使用独立入口。",
      );
    const headers: Record<string, string> = { Accept: "application/json" };
    if (key) {
      if (e.protocol === "anthropic-messages") {
        headers["x-api-key"] = key;
        headers["anthropic-version"] = "2023-06-01";
      } else if (e.protocol === "google-generative-ai") headers["x-goog-api-key"] = key;
      else headers.Authorization = `Bearer ${key}`;
    }
    const found: { model: string; name: string; parameters: ModelParameters }[] = [],
      seen = new Set<string>(),
      modelIds = new Set<string>();
    try {
      for (let page = 0; url && page < 20; page++) {
        if (seen.has(url) || new URL(url).origin !== origin) throw new Error("模型分页地址异常。");
        seen.add(url);
        const data = await readJSON(
          await this.fetcher(url, {
            headers,
            redirect: "error",
            signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(20000)]),
          }),
          8 * 1024 * 1024,
        );
        const list = data.data ?? data.models;
        if (!Array.isArray(list)) throw new Error("模型列表缺少 data/models。");
        for (const m of list) {
          const id = m.id ?? m.name;
          if (typeof id !== "string" || !id || id.length > 200) continue;
          const modelId = e.protocol === "google-generative-ai" ? id.replace(/^models\//, "") : id;
          if (modelIds.has(modelId)) continue;
          modelIds.add(modelId);
          found.push({
            model: modelId,
            name: m.displayName ?? m.display_name ?? m.name ?? id,
            parameters: parameters({
              ...m,
              ...(e.protocol === "anthropic-messages" && m.max_input_tokens
                ? { contextWindow: m.max_input_tokens }
                : {}),
            }),
          });
        }
        if (found.length > 20000) throw new Error("模型列表过大。");
        const next: URL = new URL(url);
        if (data.nextPageToken) {
          next.searchParams.set("pageToken", data.nextPageToken);
          url = next.href;
        } else if (data.has_more && (data.last_id ?? list.at(-1)?.id)) {
          next.searchParams.set(
            e.protocol === "anthropic-messages" ? "after_id" : "after",
            data.last_id ?? list.at(-1).id,
          );
          url = next.href;
        } else url = data.links?.next ? new URL(data.links.next, url).href : null;
      }
      if (url) throw new Error("模型分页超过限制。");
      await this.catalog();
      this.assertOpen();
      if (this.provider(p.id).revision !== p.revision)
        throw new KodoError("CONFLICT", "发现过程中 Provider 已更改，结果未应用。");
      const now = new Date().toISOString();
      return this.store.transaction(() => {
        const existing = this.store.records<CatalogModel>("provider-model");
        const models = found.map((m) => {
          this.store.put("provider-model-discovery", `${p.id}:${p.revision}:${e.id}:${m.model}`, {
            parameters: m.parameters,
            fetchedAt: now,
            revision: contentRevision(m.parameters),
          });
          const old = existing.find(
            (v) => v.providerId === p.id && v.endpointId === e.id && v.model === m.model,
          );
          return this.resolveModel(
            {
              ...(old ?? {
                id: randomUUID(),
                revision: 0,
                overrides: {},
                automatic: {},
                automaticSources: {},
                sources: {},
                effective: {},
              }),
              revision: (old?.revision ?? 0) + 1,
              providerId: p.id,
              providerRevision: p.revision,
              endpointId: e.id,
              model: m.model,
              name: m.name,
              listedAt: now,
              updatedAt: now,
            },
            p,
          );
        });
        // The listing is the source of truth for this endpoint: drop previously
        // discovered models it no longer returns (e.g. after changing the key). Models
        // added by hand, edited by the user, or pinned by a binding are kept.
        const listed = new Set(found.map((m) => m.model));
        const pinned = new Set(
          this.store
            .records<HarnessBinding>("harness-binding")
            .filter(
              (b) =>
                b.providerId === p.id && b.endpointId === e.id && b.selectionMode !== "provider",
            )
            .map((b) => b.modelId),
        );
        for (const old of existing)
          if (
            old.providerId === p.id &&
            old.endpointId === e.id &&
            !listed.has(old.model) &&
            old.listedAt &&
            !Object.keys(old.overrides ?? {}).length &&
            !pinned.has(old.id)
          )
            this.store.remove("provider-model", old.id);
        this.refreshProviderBindings(p.id, p.revision);
        return models;
      });
    } catch (error) {
      if (error instanceof KodoError) throw error;
      throw new KodoError(
        "UNAVAILABLE",
        "模型发现失败，已保留原列表；请检查入口、认证和返回格式。",
      );
    }
  }
  preview(value: unknown) {
    const input = bindingSchema.parse(value),
      m = this.store.record<CatalogModel>("provider-model", input.modelId);
    if (!m) throw new KodoError("NOT_FOUND", "模型不存在。");
    const p = this.provider(m.providerId),
      e = this.endpoint(p, m.endpointId),
      issues: string[] = [];
    if (m.providerRevision !== p.revision)
      issues.push("Provider 已更新，请重新获取或保存模型，确认使用的新入口修订。");
    const direct = HARNESS_PROVIDER_PROTOCOLS[input.harnessId].includes(e.protocol);
    issues.push(...bindingConfigIssues(input.harnessId, m.effective, input.reasoning));
    // Codex 0.161 sends custom grammar tools, which cannot be represented by
    // this JSON Schema bridge. Only the Claude native round trip is verified.
    const gateway =
      ["claude-code", "gemini"].includes(input.harnessId) && e.protocol === "openai-completions";
    const route = input.route === "auto" ? (direct ? "direct" : "gateway") : input.route;
    if (route === "direct" && !direct)
      issues.push("此 harness 与所选协议的隔离配置尚未实现，请使用已支持的入口或原生配置。");
    if (route === "gateway" && !gateway)
      issues.push(
        input.harnessId === "codex"
          ? "Codex 原生自定义工具无法完整转换；请提供 Responses 入口，当前网关绑定不可保存。"
          : "该协议转换方向尚未实现或验证。",
      );
    const values = bindingReasoningLevels(m.effective, input.harnessId);
    if (input.reasoning && !values?.includes(input.reasoning))
      issues.push("模型未声明所选默认思考档位。");
    if (
      ["pi", "kodo"].includes(input.harnessId) &&
      (!m.effective.contextWindow ||
        !m.effective.maxOutputTokens ||
        !m.effective.input ||
        m.effective.reasoning === undefined)
    )
      issues.push("Kooyu 内核需要明确的窗口、输出、输入能力与思考能力；请补齐来源或覆盖缺失字段。");
    return {
      input,
      model: m,
      provider: p,
      endpoint: e,
      route,
      issues,
      supported: !issues.length,
      credentialTransport:
        input.harnessId === "zcode" || (input.harnessId === "gemini" && route === "gateway")
          ? "local-relay"
          : "native-environment",
      parameterNotes:
        input.harnessId === "gemini"
          ? [
              "Gemini 上下文窗口由原生模型注册表决定，当前版本没有通用窗口覆盖字段；模型库值用于展示。",
            ]
          : input.harnessId === "zcode" && (m.effective.maxOutputTokens ?? 0) > 128000
            ? ["ZCode 原生输出选项上限为 128000；模型库仍保留模型本身的输出能力。"]
            : [],
      gatewayCapabilities:
        route === "gateway"
          ? {
              text: true,
              tools: true,
              stream: true,
              cancel: true,
              effort: true,
              images: false,
              hostedTools: false,
              compaction: false,
              validation: gateway
                ? input.harnessId === "gemini"
                  ? "Gemini Google API to Chat bridge; native reply must be verified per model/version"
                  : "claude-code native two-turn and Read tool verified; tool contract tested"
                : "unavailable",
            }
          : undefined,
    };
  }
  saveBinding(value: unknown): HarnessBinding {
    this.assertOpen();
    const request = bindingSchema.parse(value);
    const prior = this.replay<HarnessBinding>("harness-binding", request);
    if (prior) return prior;
    const plan = this.preview(request);
    if (!plan.supported) throw new KodoError("UNSUPPORTED", plan.issues.join(" "));
    const { input, model: m, provider: p, endpoint: e } = plan,
      id = input.id ?? randomUUID(),
      old = this.store.record<HarnessBinding>("harness-binding", id);
    if (input.id && !old) throw new KodoError("NOT_FOUND", "绑定不存在。");
    if (old && old.revision !== input.expectedRevision)
      throw new KodoError("CONFLICT", "绑定已修改，请刷新。");
    const b: HarnessBinding = {
      id,
      revision: (old?.revision ?? 0) + 1,
      name: input.name,
      harnessId: input.harnessId,
      providerId: p.id,
      providerRevision: p.revision,
      endpointId: e.id,
      modelId: m.id,
      modelRevision: m.revision,
      model: m.model,
      selectionMode: input.selectionMode ?? "fixed",
      ...(input.selectionMode === "provider"
        ? {
            availableModels: this.store
              .records<CatalogModel>("provider-model")
              .filter(
                (model) =>
                  model.providerId === p.id &&
                  model.endpointId === e.id &&
                  model.providerRevision === p.revision,
              ),
          }
        : {}),
      reasoning: input.reasoning,
      route: plan.route,
      protocol: e.protocol,
      parameters: m.effective,
      sources: m.sources,
      updatedAt: new Date().toISOString(),
    };
    this.store.transaction(() => {
      if (input.applyAsDefault) {
        const defaults = this.store.record<BindingDefaults>("binding-defaults", "global") ?? {
          harnessBindingIds: {},
          revision: 0,
        };
        if (defaults.revision !== input.expectedDefaultsRevision)
          throw new KodoError(
            "CONFLICT",
            "新会话默认配置已修改，请刷新后重新应用。绑定与默认配置均未保存。",
          );
        this.store.put("binding-defaults", "global", {
          ...defaults,
          revision: defaults.revision + 1,
          harnessBindingIds: { ...defaults.harnessBindingIds, [b.harnessId]: b.id },
        });
      }
      this.store.put("harness-binding", id, b);
      this.store.put("harness-binding-revision", `${id}:${b.revision}`, b);
      this.remember("harness-binding", input, b);
    });
    return b;
  }
  /** Resolve a chat model against this saved provider revision, preserving old profiles. */
  bindingModel(binding: HarnessBinding, selected?: string | null): HarnessBinding {
    if (binding.selectionMode !== "provider") return binding;
    const id = selected?.startsWith(`kodo-${binding.providerId}/`)
      ? selected.slice(`kodo-${binding.providerId}/`.length)
      : selected;
    const model = binding.availableModels?.find((model) => model.model === (id || binding.model));
    if (!model)
      throw new KodoError(
        "INVALID_INPUT",
        "所选模型不属于当前 Provider 配置，请刷新模型列表或切换 Provider。",
      );
    const issues = bindingConfigIssues(binding.harnessId, model.effective, null);
    if (
      ["pi", "kodo"].includes(binding.harnessId) &&
      (!model.effective.contextWindow ||
        !model.effective.maxOutputTokens ||
        !model.effective.input ||
        model.effective.reasoning === undefined)
    )
      issues.push("请先在模型库补齐此模型的窗口、输出和能力参数，再保存引擎 Provider 配置。");
    if (issues.length) throw new KodoError("UNSUPPORTED", issues.join(" "));
    return {
      ...binding,
      modelId: model.id,
      modelRevision: model.revision,
      model: model.model,
      parameters: model.effective,
      sources: model.sources,
    };
  }
  providerModelOptions(binding: HarnessBinding): HarnessModelOption[] {
    return (binding.availableModels ?? []).map((model) => ({
      id: model.model,
      name: model.name,
      provider: `kodo-${binding.providerId}`,
      source: "discovered" as const,
      contextWindow: model.effective.contextWindow,
      maxInputTokens: model.effective.maxInputTokens,
      maxOutputTokens: model.effective.maxOutputTokens,
      pricing: model.effective.pricing,
      reasoning: bindingReasoningLevels(model.effective, binding.harnessId),
    }));
  }
  private refreshProviderBindings(providerId: string, providerRevision: number) {
    const models = this.store
      .records<CatalogModel>("provider-model")
      .filter(
        (model) => model.providerId === providerId && model.providerRevision === providerRevision,
      );
    for (const binding of this.store.records<HarnessBinding>("harness-binding")) {
      if (
        binding.selectionMode !== "provider" ||
        binding.providerId !== providerId ||
        binding.providerRevision !== providerRevision
      )
        continue;
      const availableModels = models.filter((model) => model.endpointId === binding.endpointId);
      if (JSON.stringify(availableModels) === JSON.stringify(binding.availableModels)) continue;
      const seed = availableModels.find((model) => model.model === binding.model);
      const next = {
        ...binding,
        revision: binding.revision + 1,
        availableModels,
        ...(seed
          ? { parameters: seed.effective, sources: seed.sources, modelRevision: seed.revision }
          : {}),
        updatedAt: new Date().toISOString(),
      };
      // Existing sessions keep their original revision. Future drafts receive the new metadata.
      this.store.put("harness-binding", binding.id, next);
      this.store.put("harness-binding-revision", `${binding.id}:${next.revision}`, next);
    }
  }
  saveProviderBinding(input: {
    harnessId: HarnessId;
    providerId: string;
    endpointId: string;
    expectedDefaultsRevision: number;
    requestId?: string;
  }): HarnessBinding {
    const provider = this.provider(input.providerId);
    this.endpoint(provider, input.endpointId);
    const candidates = this.store
      .records<CatalogModel>("provider-model")
      .filter(
        (model) =>
          model.providerId === provider.id &&
          model.endpointId === input.endpointId &&
          model.providerRevision === provider.revision,
      );
    const base = {
      name: `${provider.name} · ${input.harnessId}`,
      harnessId: input.harnessId,
      selectionMode: "provider" as const,
      applyAsDefault: true,
      expectedDefaultsRevision: input.expectedDefaultsRevision,
      requestId: input.requestId,
    };
    const first = candidates.find(
      (model) => this.preview({ ...base, modelId: model.id }).supported,
    );
    if (!first)
      throw new KodoError(
        "UNSUPPORTED",
        candidates.length
          ? "此 Provider 暂无可用模型。请检查协议兼容性，并在模型库补齐窗口和能力参数。"
          : "此 Provider 尚未获取模型，请先在 Provider 页重新获取模型。",
      );
    return this.saveBinding({ ...base, modelId: first.id });
  }
  private catalogIndex?: { revision: string; byModel: Map<string, PublicModel[]> };
  private catalogLookup(catalog: PublicCatalog | undefined) {
    if (!catalog) return undefined;
    if (this.catalogIndex?.revision !== catalog.revision) {
      const byModel = new Map<string, PublicModel[]>();
      for (const entry of catalog.entries) {
        const key = normalizeModelId(entry.model);
        const list = byModel.get(key);
        if (list) list.push(entry);
        else byModel.set(key, [entry]);
      }
      this.catalogIndex = { revision: catalog.revision, byModel };
    }
    return this.catalogIndex.byModel;
  }
  /** Best catalog entry for a bare model ID, preferring its own vendor's listing. */
  private catalogMatch(
    model: string,
    catalog = this.store.record<PublicCatalog>("model-catalog", "current"),
    preferred: string[] = [],
  ): PublicModel | undefined {
    const candidates = this.catalogLookup(catalog)?.get(normalizeModelId(model));
    if (!candidates?.length) return undefined;
    const vendors = [...preferred, ...vendorHints(model)];
    const score = (e: PublicModel) => {
      const vendor = vendors.indexOf(e.provider);
      return (
        (vendor >= 0 ? 1000 - vendor * 10 : 0) +
        (e.parameters.contextWindow ? 4 : 0) +
        (hasPricing(e.pricing) ? 2 : 0) +
        (e.parameters.reasoningOptions ? 1 : 0)
      );
    };
    return [...candidates].sort((a, b) => score(b) - score(a))[0];
  }
  /**
   * Fill unreported limits and prices from the public catalog. Native values always win;
   * reasoning levels are only added when the harness accepts catalog effort values.
   */
  enrichModelOptions(harnessId: HarnessId, models: HarnessModelOption[]): HarnessModelOption[] {
    const catalog = this.store.record<PublicCatalog>("model-catalog", "current");
    if (!catalog) return models;
    const preferred = HARNESS_CATALOG_VENDORS[harnessId] ?? [];
    return models.map((option) => {
      if (
        option.contextWindow &&
        option.maxOutputTokens &&
        option.pricing &&
        option.reasoning !== undefined
      )
        return option;
      const names = [option.resolvedModel, option.id, option.name].filter(
        (v): v is string => typeof v === "string" && v.length > 0,
      );
      let entry: PublicModel | undefined;
      for (const name of names) {
        const bare = name.includes("/") ? name.slice(name.lastIndexOf("/") + 1) : name;
        entry = this.catalogMatch(bare, catalog, preferred);
        if (entry) break;
      }
      if (!entry) return option;
      const source = {
        kind: catalog.kind,
        label: `${catalog.kind === "bundled-catalog" ? "Kooyu 内核内置目录" : "models.dev"} · ${entry.key}`,
        reference: catalog.kind === "remote-catalog" ? `https://models.dev/` : catalog.source,
        version: catalog.revision.slice(0, 12),
      } as const;
      const next: HarnessModelOption = {
        ...option,
        parameterSources: { ...option.parameterSources },
      };
      for (const field of ["contextWindow", "maxInputTokens", "maxOutputTokens"] as const)
        if (next[field] === undefined && entry.parameters[field] !== undefined) {
          next[field] = entry.parameters[field];
          next.parameterSources![field] = source;
        }
      // Explicit zero rates are valid; missing prices remain unknown.
      if (!next.pricing && hasPricing(entry.pricing)) {
        next.pricing = entry.pricing;
        next.parameterSources!.pricing = source;
      }
      if (next.reasoning === undefined && CATALOG_EFFORT_HARNESSES.has(harnessId)) {
        const efforts = effortValues(entry.parameters);
        if (efforts) {
          next.reasoning = bindingReasoningLevels(entry.parameters, harnessId) ?? efforts;
          next.parameterSources!.reasoning = source;
        }
      }
      return next;
    });
  }
  /** Estimate USD using the request's context bracket, or null for unpriced usage. */
  estimateCost(
    harnessId: HarnessId,
    model: string,
    tokens: {
      input: number | null;
      output: number | null;
      cacheRead: number | null;
      cacheWrite: number | null;
      requests?: number;
    },
    override?: ModelPricing,
  ): number | null {
    const price =
      override ?? this.enrichModelOptions(harnessId, [{ id: model, source: "recent" }])[0]?.pricing;
    if (!price) return null;
    let rates = price;
    if (price.tiers?.length) {
      if (tokens.input === null || tokens.requests !== 1) return null;
      const totalInput = tokens.input + (tokens.cacheRead ?? 0) + (tokens.cacheWrite ?? 0);
      const tier = price.tiers.find(
        (item) => item.upToInputTokens === undefined || totalInput <= item.upToInputTokens,
      );
      if (!tier) return null;
      rates = { ...price, ...tier };
    }
    const hasTokenRate = [
      rates.input,
      rates.output,
      rates.cacheRead,
      rates.cacheWrite,
      rates.reasoning,
    ].some((value) => value !== undefined);
    const mode =
      price.billingMode ??
      (hasTokenRate ? (rates.perRequest === undefined ? "tokens" : "hybrid") : "request");
    let cost = 0;
    if (mode !== "tokens") {
      if (rates.perRequest === undefined) return null;
      // Native turn totals can contain multiple API requests. Never assume one.
      if (rates.perRequest !== 0 && tokens.requests === undefined) return null;
      cost = rates.perRequest * (tokens.requests ?? 0);
    }
    if (mode === "request") return cost;
    if (tokens.input === null || tokens.output === null) return null;
    // Reasoning token breakdown is not reported by every engine; don't silently
    // apply the output rate when a distinct reasoning price was configured.
    if (rates.reasoning !== undefined && rates.reasoning !== rates.output && tokens.output > 0)
      return null;
    const tokenPrices: [number, number | undefined][] = [
      [tokens.input, rates.input],
      [tokens.output, rates.output],
      [tokens.cacheRead ?? 0, rates.cacheRead ?? rates.input],
      [tokens.cacheWrite ?? 0, rates.cacheWrite ?? rates.input],
    ];
    for (const [count, rate] of tokenPrices) {
      if (count > 0 && rate === undefined) return null;
      cost += (count * (rate ?? 0)) / 1_000_000;
    }
    return hasTokenRate ? cost : null;
  }
  async runtime(
    binding?: HarnessBinding,
  ): Promise<{ configuration?: BindingRuntime; apiKey?: string }> {
    if (!binding) return {};
    const provider = this.store.record<Provider>(
      "provider-revision",
      `${binding.providerId}:${binding.providerRevision}`,
    );
    const endpoint = provider?.endpoints.find((item) => item.id === binding.endpointId);
    if (!endpoint) throw new KodoError("CONFLICT", "绑定引用的 Provider 修订或入口不存在。");
    const configuration: BindingRuntime = {
      id: binding.id,
      revision: binding.revision,
      name: binding.name,
      provider: `kodo-${binding.providerId}`,
      model: binding.model,
      baseUrl: endpoint.baseUrl,
      protocol: binding.protocol,
      credentialRef: endpoint.credentialRef,
      modelParameters: binding.parameters,
      binding,
    };
    if (
      binding.route === "gateway" &&
      (!["claude-code", "gemini"].includes(binding.harnessId) ||
        configuration.protocol !== "openai-completions")
    )
      throw new KodoError(
        "UNSUPPORTED",
        "该原生 Harness 的网关转换未通过验证，请使用原生协议入口。",
      );
    const key = configuration.credentialRef
      ? await this.vault.get(configuration.credentialRef)
      : null;
    if (configuration.credentialRef && !key)
      throw new KodoError("UNAVAILABLE", "绑定的凭据不可用。");
    if (binding.route === "direct") {
      if (binding.harnessId === "zcode") {
        const relay = await this.credentialRelay.route(configuration, key);
        return { configuration: { ...configuration, baseUrl: relay.baseUrl }, apiKey: relay.token };
      }
      return { configuration: configuration, apiKey: key ?? undefined };
    }
    const runtime = await this.gateway.route(configuration, key);
    return {
      configuration: {
        ...configuration,
        baseUrl: runtime.baseUrl.replace(/\/v1$/, ""),
        protocol: binding.harnessId === "gemini" ? "google-generative-ai" : "anthropic-messages",
      },
      apiKey: runtime.token,
    };
  }
  async close() {
    this.closed = true;
    this.abort.abort();
    await Promise.allSettled([
      ...this.pending,
      ...(this.refresh ? [this.refresh] : []),
      ...(this.seeding ? [this.seeding] : []),
    ]);
    await this.gateway.close();
    await this.credentialRelay.close();
  }
}

/** Catalog vendor IDs to prefer when a harness reports bare model names. */
const HARNESS_CATALOG_VENDORS: Partial<Record<HarnessId, string[]>> = {
  codex: ["openai"],
  "claude-code": ["anthropic"],
  "deepseek-harness": ["deepseek"],
  zcode: ["zai", "zhipuai", "zai-coding-plan", "zhipuai-coding-plan"],
  gemini: ["google"],
  "kimi-code": ["moonshotai", "moonshotai-cn", "kimi-code-plan-cn"],
  "grok-build": ["xai"],
  cursor: ["cursor"],
};
/** Harnesses whose effort parameter accepts the catalog's vendor effort names verbatim. */
const CATALOG_EFFORT_HARNESSES = new Set<HarnessId>(["opencode", "kimi-code", "grok-build"]);
function hasPricing(p: ModelPricing | undefined): p is ModelPricing {
  return Boolean(
    p &&
    ([p.input, p.output, p.cacheRead, p.cacheWrite, p.reasoning, p.perRequest].some(
      (value) => value !== undefined,
    ) ||
      p.tiers?.length),
  );
}
function vendorHints(model: string): string[] {
  const m = model.toLowerCase();
  if (m.startsWith("deepseek")) return ["deepseek"];
  if (m.startsWith("glm") || m.startsWith("chatglm")) return ["zai", "zhipuai"];
  if (m.startsWith("kimi") || m.startsWith("moonshot")) return ["moonshotai", "moonshotai-cn"];
  if (m.startsWith("claude")) return ["anthropic"];
  if (/^(gpt|o\d|codex)/.test(m)) return ["openai"];
  if (m.startsWith("gemini")) return ["google"];
  if (m.startsWith("grok")) return ["xai"];
  if (m.startsWith("qwen")) return ["alibaba"];
  return [];
}
/** Case and context-suffix insensitive model identity, e.g. `claude-opus-5-5[1m]`. */
export function normalizeModelId(model: string): string {
  return model
    .toLowerCase()
    .replace(/\[[^\]]*\]$/, "")
    .trim();
}
