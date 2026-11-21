import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { boundedJson } from "./http.js";
import { KodoError } from "@kodo/protocol";
import type { SessionService } from "../session-service.js";
import type { ProviderVault } from "../providers/service.js";
import { GitHubOAuth } from "./github-oauth.js";
interface OAuthConfig {
  connectionId: string;
  clientId: string;
  clientSecretRef: string | null;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  redirectUri: string;
  scopes: string[];
  refreshRef?: string;
}
interface OAuthState {
  id: string;
  connectionId: string;
  deviceId: string;
  generation: number;
  expiresAt: number;
  consumed: boolean;
  verifierRef: string;
  config: OAuthConfig;
}
const hash = (x: string) => createHash("sha256").update(x).digest("base64url");
export class OAuthService {
  readonly github: GitHubOAuth;
  private refreshing = new Map<string, Promise<void>>();
  constructor(
    private readonly service: SessionService,
    private readonly vault: ProviderVault,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.github = new GitHubOAuth(service, vault, fetcher);
  }
  async configure(value: unknown) {
    const p = z
      .object({
        connectionId: z.string().uuid(),
        clientId: z.string().min(1).max(1000),
        clientSecret: z.string().max(20000).optional(),
        authorizationEndpoint: z.string().url(),
        tokenEndpoint: z.string().url(),
        redirectUri: z.string().url(),
        scopes: z.array(z.string().max(200)).max(50),
        expectedRevision: z.number().int().positive(),
      })
      .strict()
      .parse(value);
    const original = this.service.applications.connections.get(p.connectionId);
    if (original.revision !== p.expectedRevision) throw new KodoError("CONFLICT", "连接已修改。");
    for (const endpoint of [p.authorizationEndpoint, p.tokenEndpoint]) {
      const u = new URL(endpoint);
      if (u.protocol !== "https:" || u.username || u.password || u.hash || u.search)
        throw new KodoError("INVALID_INPUT", "OAuth 服务端点需要不含凭据与查询参数的 HTTPS 地址。");
    }
    const callback = new URL(p.redirectUri);
    if (
      !/^(?:\/h\/[a-f0-9]{64})?\/api\/oauth\/callback$/.test(callback.pathname) ||
      callback.username ||
      callback.password ||
      callback.search ||
      callback.hash ||
      !(
        callback.protocol === "https:" ||
        (callback.protocol === "http:" && ["localhost", "127.0.0.1"].includes(callback.hostname))
      )
    )
      throw new KodoError("INVALID_INPUT", "OAuth 回调必须是本 Host 的 /api/oauth/callback。");
    let ref: string | null = null;
    if (p.clientSecret) {
      ref = "oauth-client:" + randomUUID();
      await this.vault.set(ref, p.clientSecret);
    }
    const { clientSecret: _s, ...rest } = p;
    this.service.store.transaction(() => {
      const c = this.service.applications.connections.get(p.connectionId);
      if (c.revision !== original.revision) throw new KodoError("CONFLICT", "连接已修改。");
      this.service.applications.connections.put({
        ...c,
        generation: c.generation + 1,
        revision: c.revision + 1,
      });
      this.service.store.put("oauth-config", p.connectionId, { ...rest, clientSecretRef: ref });
    });
    return { connectionId: p.connectionId, configured: true };
  }
  async start(connectionId: string, deviceId: string) {
    this.service.lifecycle.assertOpen();
    const c = this.service.applications.connections.get(connectionId),
      config = this.service.store.record<OAuthConfig>("oauth-config", connectionId);
    if (!c.enabled) throw new KodoError("UNAUTHORIZED", "连接已停用，需本机管理员重新启用。");
    if (!config) throw new KodoError("INVALID_INPUT", "请先配置 OAuth 客户端。");
    const state = randomBytes(32).toString("base64url"),
      verifier = randomBytes(48).toString("base64url"),
      id = hash(state),
      ref = "oauth-verifier:" + id;
    await this.vault.set(ref, verifier);
    if (this.service.applications.connections.get(connectionId).generation !== c.generation)
      throw new KodoError("CONFLICT", "连接已修改。");
    const record: OAuthState = {
      id,
      connectionId,
      deviceId,
      generation: c.generation,
      expiresAt: Date.now() + 600000,
      consumed: false,
      verifierRef: ref,
      config,
    };
    this.service.store.put("oauth-state", id, record);
    const u = new URL(config.authorizationEndpoint);
    for (const [k, v] of Object.entries({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      scope: config.scopes.join(" "),
      state,
      code_challenge: hash(verifier),
      code_challenge_method: "S256",
    }))
      u.searchParams.set(k, v);
    return { url: u.href, expiresAt: new Date(record.expiresAt).toISOString() };
  }
  async callback(state: string, code: string, deviceId: string) {
    const id = hash(state),
      record = this.service.store.record<OAuthState>("oauth-state", id);
    if (
      !record ||
      record.consumed ||
      record.expiresAt <= Date.now() ||
      record.deviceId !== deviceId
    )
      throw new KodoError("UNAUTHORIZED", "OAuth state 无效、过期或不属于此设备。");
    this.service.store.transaction(() => {
      const current = this.service.store.record<OAuthState>("oauth-state", id)!;
      if (current.consumed) throw new KodoError("CONFLICT", "OAuth 回调已消费。");
      this.service.store.put("oauth-state", id, { ...current, consumed: true });
    });
    this.assertGeneration(record.connectionId, record.generation);
    const verifier = await this.vault.get(record.verifierRef);
    if (!verifier) throw new KodoError("UNAVAILABLE", "PKCE 验证材料不可用。");
    const fields = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: record.config.clientId,
      redirect_uri: record.config.redirectUri,
      code_verifier: verifier,
    });
    try {
      await this.exchange(record.config, record.generation, fields);
    } finally {
      await this.vault.delete(record.verifierRef).catch(() => {});
    }
    return { connected: true, connectionId: record.connectionId };
  }
  private assertGeneration(id: string, generation: number) {
    const c = this.service.applications.connections.get(id);
    if (!c.enabled || c.generation !== generation)
      throw new KodoError("UNAUTHORIZED", "连接已撤销或修改，OAuth 结果已丢弃。");
    return c;
  }
  private async exchange(config: OAuthConfig, generation: number, fields: URLSearchParams) {
    const release = this.service.lifecycle.enter();
    try {
      if (config.clientSecretRef) {
        const secret = await this.vault.get(config.clientSecretRef);
        if (!secret) throw new KodoError("UNAVAILABLE", "OAuth 客户端凭据不可用。");
        fields.set("client_secret", secret);
      }
      this.assertGeneration(config.connectionId, generation);
      this.service.lifecycle.assertOpen();
      const r = await this.fetcher(config.tokenEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: fields,
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) throw new KodoError("UNAVAILABLE", "OAuth 服务拒绝授权或刷新。");
      const body = (await boundedJson(r, 65536)) as {
        access_token?: string;
        refresh_token?: string;
        token_type?: string;
      };
      if (
        !body.access_token ||
        body.access_token.length > 20000 ||
        (body.token_type && body.token_type.toLowerCase() !== "bearer")
      )
        throw new KodoError("UNSUPPORTED", "OAuth token 响应不支持。");
      this.assertGeneration(config.connectionId, generation);
      const accessRef = "oauth-access:" + randomUUID(),
        refreshRef = body.refresh_token ? "oauth-refresh:" + randomUUID() : config.refreshRef;
      await this.vault.set(accessRef, body.access_token);
      if (refreshRef && body.refresh_token) await this.vault.set(refreshRef, body.refresh_token);
      this.service.store.transaction(() => {
        const current = this.assertGeneration(config.connectionId, generation);
        this.service.applications.connections.put({
          ...current,
          enabled: true,
          credentialRef: accessRef,
          revision: current.revision + 1,
        });
        this.service.store.put("oauth-config", config.connectionId, { ...config, refreshRef });
      });
    } finally {
      release();
    }
  }
  async refresh(connectionId: string) {
    const pending = this.refreshing.get(connectionId);
    if (pending) return pending;
    const c = this.service.applications.connections.get(connectionId);
    if (!c.enabled) throw new KodoError("UNAUTHORIZED", "连接已停用。");
    const config = this.service.store.record<OAuthConfig>("oauth-config", connectionId);
    if (!config?.refreshRef) throw new KodoError("UNSUPPORTED", "该连接没有刷新凭据。");
    const job = Promise.resolve().then(async () => {
      const token = await this.vault.get(config.refreshRef!);
      if (!token) throw new KodoError("UNAVAILABLE", "刷新凭据不可用。");
      await this.exchange(
        config,
        c.generation,
        new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: token,
          client_id: config.clientId,
        }),
      );
    });
    this.refreshing.set(connectionId, job);
    try {
      await job;
    } finally {
      this.refreshing.delete(connectionId);
    }
  }
}
