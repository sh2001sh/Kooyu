import { randomUUID } from "node:crypto";
import { z } from "zod";
import { KodoError } from "@kodo/protocol";
import type { SessionService } from "../session-service.js";
import type { ProviderVault } from "../providers/service.js";
import { boundedJson } from "./http.js";

interface Login {
  id: string;
  connectionId: string;
  generation: number;
  deviceId: string;
  clientId: string;
  deviceCodeRef: string;
  userCode: string;
  expiresAt: number;
  interval: number;
  nextPollAt: number;
  status: "pending" | "connected" | "cancelled" | "expired" | "denied";
}
type LoginView = Pick<Login, "id" | "connectionId" | "userCode" | "interval" | "status"> & {
  verificationUri: string;
  expiresAt: string;
};
export class GitHubOAuth {
  private starting = new Map<
    string,
    { deviceId: string; privateRepositories: boolean; task: Promise<LoginView> }
  >();
  private polling = new Map<string, Promise<LoginView>>();
  constructor(
    private readonly service: SessionService,
    private readonly vault: ProviderVault,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  configuration() {
    const clientId =
      process.env.KOOYU_GITHUB_CLIENT_ID?.trim() ||
      this.service.store.record<{ clientId: string }>("github-oauth", "client")?.clientId ||
      "";
    return {
      clientId,
      configured: Boolean(clientId),
      managed: Boolean(process.env.KOOYU_GITHUB_CLIENT_ID?.trim()),
    };
  }
  configure(value: unknown) {
    const { clientId } = z
      .object({
        clientId: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9._-]{5,200}$/),
      })
      .strict()
      .parse(value);
    if (this.configuration().managed)
      throw new KodoError("CONFLICT", "GitHub 应用由部署配置管理。");
    this.service.store.put("github-oauth", "client", { clientId });
    return this.configuration();
  }
  private async post(path: string, fields: Record<string, string>) {
    const response = await this.fetcher("https://github.com" + path, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields),
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok)
      throw new KodoError(
        "UNAVAILABLE",
        `GitHub 授权服务返回 HTTP ${response.status}，请稍后重试。`,
      );
    return boundedJson(response, 65536);
  }
  async start(value: unknown, deviceId: string) {
    const input = z
      .object({ requestId: z.string().uuid(), privateRepositories: z.boolean().default(false) })
      .strict()
      .parse(value);
    const existing = this.starting.get(input.requestId);
    if (existing) {
      if (
        existing.deviceId !== deviceId ||
        existing.privateRepositories !== input.privateRepositories
      )
        throw new KodoError("CONFLICT", "登录请求 ID 已用于其他请求。");
      return existing.task;
    }
    const task = this.begin(input, deviceId);
    this.starting.set(input.requestId, {
      deviceId,
      privateRepositories: input.privateRepositories,
      task,
    });
    try {
      return await task;
    } finally {
      this.starting.delete(input.requestId);
    }
  }
  private async begin(value: unknown, deviceId: string) {
    this.service.lifecycle.assertOpen();
    const input = z
      .object({ requestId: z.string().uuid(), privateRepositories: z.boolean().default(false) })
      .strict()
      .parse(value);
    const previous = this.service.store.record<Login>("github-login", input.requestId);
    if (previous) {
      if (previous.deviceId !== deviceId) throw new KodoError("UNAUTHORIZED", "登录不属于此设备。");
      return this.public(previous);
    }
    const { clientId } = this.configuration();
    if (!clientId)
      throw new KodoError(
        "INVALID_INPUT",
        "请先配置 Kooyu 的 GitHub OAuth 应用 Client ID，并启用 Device flow。",
      );
    const release = this.service.lifecycle.enter();
    try {
      const result = await this.post("/login/device/code", {
        client_id: clientId,
        scope: input.privateRepositories ? "repo" : "public_repo",
      });
      if (result.error)
        throw new KodoError(
          "UNAVAILABLE",
          result.error === "incorrect_client_credentials"
            ? "GitHub Client ID 无效，请检查 OAuth 应用配置。"
            : result.error === "device_flow_disabled"
              ? "请在 GitHub OAuth App 设置中勾选 Enable Device Flow 并保存，再重新登录。"
              : "GitHub 设备授权不可用，请检查应用设置后重试。",
        );
      const code = z
        .object({
          device_code: z.string().min(1).max(2000),
          user_code: z.string().min(1).max(100),
          verification_uri: z.literal("https://github.com/login/device"),
          expires_in: z.number().int().positive().max(3600),
          interval: z.number().int().min(1).max(300),
        })
        .parse(result);
      this.service.lifecycle.assertOpen();
      const connection = await this.service.applications.connect({
        requestId: input.requestId,
        applicationId: "github",
        version: "1.0.0",
        name: "GitHub · 待授权",
        auth: "oauth",
      });
      if (!connection) throw new KodoError("UNAVAILABLE", "无法创建 GitHub 连接。");
      const ref = "github-device:" + input.requestId;
      try {
        await this.vault.set(ref, code.device_code);
      } catch (error) {
        this.service.applications.revoke(connection.id, connection.revision);
        throw error;
      }
      const login: Login = {
        id: input.requestId,
        connectionId: connection.id,
        generation: connection.generation,
        deviceId,
        clientId,
        deviceCodeRef: ref,
        userCode: code.user_code,
        expiresAt: Date.now() + code.expires_in * 1000,
        interval: code.interval,
        nextPollAt: Date.now() + code.interval * 1000,
        status: "pending",
      };
      this.service.store.put("github-login", login.id, login);
      return this.public(login);
    } finally {
      release();
    }
  }
  private public(login: Login): LoginView {
    return {
      id: login.id,
      connectionId: login.connectionId,
      userCode: login.userCode,
      verificationUri: "https://github.com/login/device",
      expiresAt: new Date(login.expiresAt).toISOString(),
      interval: login.interval,
      status: login.status,
    };
  }
  private get(id: string, deviceId: string) {
    const login = this.service.store.record<Login>("github-login", id);
    if (!login || login.deviceId !== deviceId)
      throw new KodoError("NOT_FOUND", "此设备的 GitHub 登录不存在。");
    return login;
  }
  private valid(login: Login) {
    const current = this.get(login.id, login.deviceId);
    const c = this.service.applications.connections.get(login.connectionId);
    if (current.status !== "pending" || !c.enabled || c.generation !== login.generation)
      throw new KodoError("CONFLICT", "GitHub 登录已取消或连接已修改，请重新登录。");
    return c;
  }
  async cancel(id: string, deviceId: string) {
    const login = this.get(id, deviceId);
    if (login.status === "pending") {
      this.service.store.put("github-login", id, { ...login, status: "cancelled" });
      const c = this.service.applications.connections.get(login.connectionId);
      if (c.enabled && c.generation === login.generation)
        this.service.applications.revoke(c.id, c.revision);
      await this.vault.delete(login.deviceCodeRef).catch(() => {});
    }
    return this.public(this.get(id, deviceId));
  }
  async poll(id: string, deviceId: string) {
    this.get(id, deviceId);
    const current = this.polling.get(id);
    if (current) return current;
    const task = this.check(id, deviceId);
    this.polling.set(id, task);
    try {
      return await task;
    } finally {
      this.polling.delete(id);
    }
  }
  private async check(id: string, deviceId: string) {
    const login = this.get(id, deviceId);
    if (login.status !== "pending") return this.public(login);
    if (Date.now() >= login.expiresAt) return this.finish(login, "expired");
    this.valid(login);
    if (Date.now() < login.nextPollAt) return this.public(login);
    this.service.lifecycle.assertOpen();
    const release = this.service.lifecycle.enter();
    try {
      const code = await this.vault.get(login.deviceCodeRef);
      if (!code) throw new KodoError("UNAVAILABLE", "GitHub 登录材料已失效，请重新登录。");
      const next = { ...login, nextPollAt: Date.now() + login.interval * 1000 };
      this.service.store.put("github-login", id, next);
      const result = await this.post("/login/oauth/access_token", {
        client_id: login.clientId,
        device_code: code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      });
      this.valid(login);
      if (Date.now() >= login.expiresAt) return this.finish(login, "expired");
      if (result.error === "authorization_pending") return this.public(next);
      if (result.error === "slow_down") {
        next.interval += 5;
        next.nextPollAt = Date.now() + next.interval * 1000;
        this.service.store.put("github-login", id, next);
        return this.public(next);
      }
      if (result.error === "expired_token") return this.finish(login, "expired");
      if (result.error === "access_denied") return this.finish(login, "denied");
      if (result.error) throw new KodoError("UNAVAILABLE", "GitHub 未完成授权，请取消后重新登录。");
      const token = z
        .object({
          access_token: z.string().min(1).max(20000),
          token_type: z
            .string()
            .transform((x) => x.toLowerCase())
            .pipe(z.literal("bearer")),
        })
        .parse(result);
      const accountResponse = await this.fetcher("https://api.github.com/user", {
        headers: {
          Authorization: "Bearer " + token.access_token,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      });
      if (!accountResponse.ok)
        throw new KodoError("UNAVAILABLE", "无法确认 GitHub 账号，请重新登录。");
      const account = z
        .object({ login: z.string().min(1).max(100) })
        .parse(await boundedJson(accountResponse, 65536));
      this.valid(login);
      this.service.lifecycle.assertOpen();
      const ref = "github-access:" + randomUUID();
      await this.vault.set(ref, token.access_token);
      try {
        this.service.store.transaction(() => {
          const c = this.valid(login);
          this.service.applications.connections.put({
            ...c,
            name: "GitHub · " + account.login,
            credentialRef: ref,
            revision: c.revision + 1,
          });
          this.service.store.put("github-login", id, { ...next, status: "connected" });
        });
      } catch (error) {
        await this.vault.delete(ref).catch(() => {});
        throw error;
      }
      await this.vault.delete(login.deviceCodeRef).catch(() => {});
      return this.public(this.get(id, deviceId));
    } finally {
      release();
    }
  }
  private async finish(login: Login, status: "expired" | "denied") {
    this.valid(login);
    this.service.store.put("github-login", login.id, { ...login, status });
    const c = this.service.applications.connections.get(login.connectionId);
    this.service.applications.revoke(c.id, c.revision);
    await this.vault.delete(login.deviceCodeRef).catch(() => {});
    return this.public({ ...login, status });
  }
}
