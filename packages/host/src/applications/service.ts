import { LocalMcpPool } from "./local-mcp.js";
import { createRequire } from "node:module";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { KodoError } from "@kodo/protocol";
import type { SessionService } from "../session-service.js";
import type { ProviderVault } from "../providers/service.js";
import { DomainTable } from "../storage/self-hosted.js";
import { boundedJson } from "./http.js";
import { digest, type ActionIdentity } from "../execution/actions.js";
const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^[a-z][a-z0-9.-]{1,79}$/),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    name: z.string().min(1).max(100),
    publisher: z.string().min(1).max(100),
    description: z.string().max(4000),
    runtime: z.enum(["builtin", "remote-mcp", "local-mcp", "skills-only"]),
    stdio: z
      .object({
        command: z.string().min(1).max(4096),
        args: z.array(z.string().max(4096)).max(100),
        env: z
          .record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/), z.string().max(4096))
          .optional(),
        credentialEnv: z
          .string()
          .regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/)
          .optional(),
      })
      .strict()
      .optional(),
    endpoint: z.string().url().optional(),
    requestedPermissions: z.array(z.string().min(1).max(100)).max(100),
    skills: z
      .array(z.object({ name: z.string().max(100), content: z.string().max(20000) }).strict())
      .max(20)
      .default([]),
    filesManifest: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)).default({}),
  })
  .strict();
export type ApplicationManifest = z.infer<typeof manifestSchema>;
interface ApplicationVersion {
  id: string;
  manifest: ApplicationManifest;
  sha256: string;
  submittedAt: string;
}
export interface AppConnection {
  id: string;
  applicationId: string;
  version: string;
  name: string;
  enabled: boolean;
  revision: number;
  generation: number;
  credentialRef: string | null;
}
const connectSchema = z
  .object({
    requestId: z.string().uuid(),
    applicationId: z.string(),
    version: z.string(),
    name: z.string().trim().min(1).max(100),
    token: z.string().min(1).max(20000).optional(),
    auth: z.enum(["token", "oauth"]).default("token"),
    enabled: z.boolean().default(true),
    expectedRevision: z.number().int().positive().optional(),
  })
  .strict();
const BUILTINS: ApplicationManifest[] = [
  ...[
    ["wecom", "企业微信"],
    ["feishu", "飞书"],
    ["weixin", "微信 ClawBot"],
  ].map(([id, name]): ApplicationManifest => ({
    schemaVersion: 1,
    id: id!,
    version: "1.0.0",
    name: name!,
    publisher: "Kooyu",
    description: "通过机器人长连接接收消息，并通过发件箱回复已绑定会话。",
    runtime: "builtin",
    requestedPermissions: [id + ".messages.create"],
    skills: [],
    filesManifest: {},
  })),
  {
    schemaVersion: 1,
    id: "telegram",
    version: "1.0.0",
    name: "Telegram",
    publisher: "Kooyu",
    description: "接收已绑定会话的消息，并通过发件箱回复。",
    runtime: "builtin",
    requestedPermissions: ["telegram.messages.create"],
    skills: [],
    filesManifest: {},
  },
  ...[
    {
      id: "memory",
      name: "Memory",
      description: "保存和查询此连接的本地知识图谱。",
      tools: [
        "create_entities",
        "create_relations",
        "add_observations",
        "delete_entities",
        "delete_observations",
        "delete_relations",
        "read_graph",
        "search_nodes",
        "open_nodes",
      ],
    },
    {
      id: "sequential-thinking",
      name: "Sequential Thinking",
      description: "分步整理和修订当前任务的推理过程。",
      tools: ["sequentialthinking"],
    },
  ].map(({ id, name, description, tools }): ApplicationManifest => ({
    schemaVersion: 1,
    id: "mcp-" + id,
    version: "1.0.0",
    name,
    publisher: "Model Context Protocol",
    description,
    runtime: "local-mcp",
    stdio: { command: "kooyu-bundled:" + id, args: [] },
    requestedPermissions: tools.map((tool) => "mcp." + tool),
    skills: [],
    filesManifest: {},
  })),
  {
    schemaVersion: 1,
    id: "github",
    version: "1.0.0",
    name: "GitHub",
    publisher: "Kooyu",
    description: "读取仓库 issue；在明确授权的仓库创建 issue 或评论。",
    runtime: "builtin",
    requestedPermissions: ["github.issues.read", "github.issues.create", "github.comments.create"],
    skills: [],
    filesManifest: {},
  },
  {
    schemaVersion: 1,
    id: "slack",
    version: "1.0.0",
    name: "Slack",
    publisher: "Kooyu",
    description: "读取指定频道和发送消息。",
    runtime: "builtin",
    requestedPermissions: ["slack.history.read", "slack.messages.create"],
    skills: [],
    filesManifest: {},
  },
];
export class ApplicationService {
  readonly localMcp = new LocalMcpPool();
  readonly versions: DomainTable<ApplicationVersion>;
  readonly connections: DomainTable<AppConnection>;
  constructor(
    private readonly service: SessionService,
    private readonly vault: ProviderVault,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.versions = new DomainTable(service.store, "application_versions");
    this.connections = new DomainTable(service.store, "app_connections");
    for (const manifest of BUILTINS)
      if (!this.versions.find(manifest.id + "@" + manifest.version)) this.submit(manifest);
  }
  submit(value: unknown) {
    const manifest = manifestSchema.parse(value);
    if (manifest.runtime === "builtin" && !BUILTINS.some((x) => digest(x) === digest(manifest)))
      throw new KodoError("UNSUPPORTED", "不允许导入未知 builtin 应用。");
    if (Boolean(manifest.stdio) !== (manifest.runtime === "local-mcp"))
      throw new KodoError("INVALID_INPUT", "本地 MCP 需要指定启动命令与参数。");
    if (manifest.endpoint) {
      const u = new URL(manifest.endpoint);
      if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash)
        throw new KodoError("INVALID_INPUT", "MCP 端点需要不含凭据的 HTTPS URL。");
    }
    if (manifest.runtime === "remote-mcp" && !manifest.endpoint)
      throw new KodoError("INVALID_INPUT", "需要 MCP 端点。");
    if (Object.keys(manifest.filesManifest).length)
      throw new KodoError("UNSUPPORTED", "首版应用仅包含清单及内嵌技能，不能声明未上传文件。");
    const id = manifest.id + "@" + manifest.version,
      sha256 = digest(manifest),
      old = this.versions.find(id);
    if (old) {
      if (old.sha256 !== sha256) throw new KodoError("CONFLICT", "应用版本不可覆盖，请增加版本。");
      return old;
    }
    return this.versions.put({ id, manifest, sha256, submittedAt: new Date().toISOString() });
  }
  list() {
    return {
      versions: this.versions.all(),
      connections: this.connections.all().map(({ credentialRef: _c, ...x }) => x),
    };
  }
  /** Resolve an enabled built-in GitHub connection token from the Vault for PR creation fallback. */
  async githubToken(): Promise<string | null> {
    const conn = this.connections
      .all()
      .find((c) => c.enabled && c.applicationId === "github" && c.credentialRef);
    if (!conn?.credentialRef) return null;
    try {
      return (await this.vault.get(conn.credentialRef)) ?? null;
    } catch {
      return null;
    }
  }
  permissionsDiff(applicationId: string, from: string, to: string) {
    const a = this.versions.get(applicationId + "@" + from).manifest,
      b = this.versions.get(applicationId + "@" + to).manifest;
    return {
      added: b.requestedPermissions.filter((x) => !a.requestedPermissions.includes(x)),
      removed: a.requestedPermissions.filter((x) => !b.requestedPermissions.includes(x)),
      endpointChanged: a.endpoint !== b.endpoint,
    };
  }
  export(id: string) {
    return this.versions.get(id).manifest;
  }
  async connect(value: unknown, id?: string) {
    const p = connectSchema.parse(value),
      fingerprint = digest({ p, id });
    const old = id ? this.connections.get(id) : undefined;
    const saved = this.service.store.record<{ fingerprint: string; id: string }>(
      "app-connect-request",
      p.requestId,
    );
    if (saved) {
      if (saved.fingerprint !== fingerprint) throw new KodoError("CONFLICT", "连接请求 ID 冲突。");
      return this.list().connections.find((x) => x.id === saved.id);
    }
    const manifest = this.versions.get(p.applicationId + "@" + p.version).manifest;
    if (old && old.revision !== p.expectedRevision) throw new KodoError("CONFLICT", "连接已修改。");
    const previousManifest =
      old && this.versions.get(old.applicationId + "@" + old.version).manifest;
    const sameCredentialScope =
      previousManifest &&
      old?.applicationId === p.applicationId &&
      previousManifest.runtime === manifest.runtime &&
      previousManifest.endpoint === manifest.endpoint;
    const key = old?.id ?? randomUUID(),
      ref = p.token
        ? "app:" + key + ":" + randomUUID()
        : sameCredentialScope
          ? (old?.credentialRef ?? null)
          : null;
    if (p.token) await this.vault.set(ref!, p.token);
    if (
      manifest.runtime !== "skills-only" &&
      manifest.runtime !== "local-mcp" &&
      p.auth !== "oauth" &&
      p.enabled &&
      !ref
    )
      throw new KodoError("INVALID_INPUT", "需要应用凭据。");
    return this.service.store.transaction(() => {
      const prior = this.service.store.record<{ fingerprint: string; id: string }>(
        "app-connect-request",
        p.requestId,
      );
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          throw new KodoError("CONFLICT", "连接请求 ID 冲突。");
        return this.list().connections.find((x) => x.id === prior.id);
      }
      if (old && this.connections.get(old.id).revision !== old.revision)
        throw new KodoError("CONFLICT", "连接已修改。");
      const next: AppConnection = {
        id: key,
        applicationId: p.applicationId,
        version: p.version,
        name: p.name,
        enabled: p.enabled,
        credentialRef: ref,
        revision: (old?.revision ?? 0) + 1,
        generation: (old?.generation ?? 0) + 1,
      };
      this.connections.put(next);
      if (old)
        this.service.store.afterCommit(
          () => void this.localMcp.close(old.id + ":" + old.generation),
        );
      if (old)
        for (const g of this.service.permissions.grants.all())
          if (g.connectionId === key && !g.revoked)
            this.service.permissions.revoke(g.id, g.revision);
      this.service.store.put("app-connect-request", p.requestId, { fingerprint, id: key });
      return this.list().connections.find((x) => x.id === key);
    });
  }
  revoke(id: string, expectedRevision: number) {
    return this.service.store.transaction(() => {
      const c = this.connections.get(id);
      if (c.revision !== expectedRevision) throw new KodoError("CONFLICT", "连接已修改。");
      this.connections.put({
        ...c,
        enabled: false,
        revision: c.revision + 1,
        generation: c.generation + 1,
      });
      this.service.store.afterCommit(() => void this.localMcp.close(c.id + ":" + c.generation));
      for (const g of this.service.permissions.grants.all())
        if (g.connectionId === id && !g.revoked) this.service.permissions.revoke(g.id, g.revision);
      return { id, enabled: false };
    });
  }
  private async mcp<T>(
    c: AppConnection,
    op: (client: Client) => Promise<T>,
    authorize: () => void = () => {},
  ) {
    const manifest = this.versions.get(c.applicationId + "@" + c.version).manifest;
    if (manifest.runtime === "local-mcp" && manifest.stdio) {
      authorize();
      const release = this.service.lifecycle.enter();
      try {
        let { command, args } = manifest.stdio;
        const env: Record<string, string> = {};
        // Provide minimal OS runtime path/temp variables so npx/uvx/node work without inheriting Host secrets.
        for (const key of [
          "PATH",
          "Path",
          "PATHEXT",
          "HOME",
          "USERPROFILE",
          "APPDATA",
          "LOCALAPPDATA",
          "SYSTEMROOT",
          "SystemRoot",
          "COMSPEC",
          "ComSpec",
          "TEMP",
          "TMP",
          "TMPDIR",
          "LANG",
          "LC_ALL",
        ]) {
          const val = process.env[key];
          if (typeof val === "string") env[key] = val;
        }
        if (manifest.stdio.env) {
          for (const [k, v] of Object.entries(manifest.stdio.env)) env[k] = v;
        }
        if (c.credentialRef) {
          const secret = await this.vault.get(c.credentialRef);
          if (secret) {
            if (manifest.stdio.credentialEnv) {
              env[manifest.stdio.credentialEnv] = secret;
            } else {
              let parsedSecret: Record<string, unknown> | null = null;
              if (secret.trim().startsWith("{")) {
                try {
                  const candidate = JSON.parse(secret);
                  if (candidate && typeof candidate === "object" && !Array.isArray(candidate))
                    parsedSecret = candidate as Record<string, unknown>;
                } catch {}
              }
              if (parsedSecret) {
                for (const [k, v] of Object.entries(parsedSecret)) {
                  if (/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(k) && typeof v === "string") env[k] = v;
                }
              } else {
                env.MCP_API_KEY = secret;
              }
            }
          }
        }
        if (command.startsWith("kooyu-bundled:")) {
          const server = command.slice("kooyu-bundled:".length);
          if (!["memory", "sequential-thinking"].includes(server))
            throw new KodoError("INVALID_INPUT", "未知内置 MCP 服务。");
          command = process.execPath;
          args = [
            createRequire(import.meta.url).resolve(
              "@modelcontextprotocol/server-" + server + "/dist/index.js",
            ),
          ];
          env.ELECTRON_RUN_AS_NODE = "1";
          if (server === "memory")
            env.MEMORY_FILE_PATH = join(this.service.dataDir, "mcp-memory-" + c.id + ".jsonl");
        }
        return await this.localMcp.use(
          c.id + ":" + c.generation,
          command,
          args,
          (client) => {
            authorize();
            return op(client);
          },
          env,
        );
      } finally {
        release();
      }
    }
    const token = c.credentialRef ? await this.vault.get(c.credentialRef) : null;
    const client = new Client({ name: "kooyu", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(manifest.endpoint!), {
      requestInit: {
        headers: token ? { Authorization: "Bearer " + token } : {},
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      },
    });
    const release = this.service.lifecycle.enter();
    try {
      authorize();
      await client.connect(transport);
      authorize();
      this.service.lifecycle.assertOpen();
      return await op(client);
    } finally {
      await client.close().catch(() => {});
      release();
    }
  }
  async tools(id: string, checkGrant: () => void = () => {}) {
    const c = this.connections.get(id);
    if (!c.enabled) throw new KodoError("UNAVAILABLE", "应用连接已停用。");
    const authorize = () => {
      this.service.lifecycle.assertOpen();
      const current = this.connections.get(id);
      if (!current.enabled || current.generation !== c.generation)
        throw new KodoError("UNAUTHORIZED", "应用连接已修改或撤销。");
      checkGrant();
    };
    authorize();
    const manifest = this.versions.get(c.applicationId + "@" + c.version).manifest;
    if (manifest.runtime !== "remote-mcp" && manifest.runtime !== "local-mcp")
      return manifest.requestedPermissions.map((name) => ({ name }));
    return this.mcp(
      c,
      async (client) => {
        const tools = await client.listTools();
        authorize();
        return tools.tools.map((x) => ({
          name: x.name,
          description: x.description,
          inputSchema: x.inputSchema,
          untrusted: true,
        }));
      },
      authorize,
    );
  }
  async call(input: {
    connectionId: string;
    grantId: string;
    controllerSessionId: string;
    goalId?: string | null;
    operation: string;
    resource: string;
    arguments: Record<string, unknown>;
    identity: ActionIdentity;
  }) {
    const c = this.connections.get(input.connectionId),
      version = this.versions.get(c.applicationId + "@" + c.version).manifest;
    if (!version.requestedPermissions.includes(input.operation))
      throw new KodoError("UNAUTHORIZED", "应用未声明该操作。");
    const authorize = () => {
      const fresh = this.connections.get(c.id);
      if (!fresh.enabled || fresh.generation !== c.generation)
        throw new KodoError("UNAUTHORIZED", "应用连接已撤销或修改。");
      this.service.permissions.require(input.grantId, {
        controllerSessionId: input.controllerSessionId,
        operation: input.operation,
        resource: input.resource,
        connectionId: c.id,
        applicationVersion: c.version,
        goalId: input.goalId,
      });
    };
    authorize();
    return this.service.actions.run(
      {
        ...input.identity,
        grantId: input.grantId,
        grantRevision: this.service.permissions.grants.get(input.grantId).revision,
        generation: c.generation,
      },
      input,
      async () => {
        if (version.runtime === "skills-only")
          throw new KodoError("UNSUPPORTED", "该应用只提供技能。");
        if (version.runtime === "local-mcp" || version.runtime === "remote-mcp") {
          if (
            version.runtime === "local-mcp" &&
            this.service.store.session(input.controllerSessionId).harnessId !== "kodo"
          )
            throw new KodoError("UNAUTHORIZED", "本地 MCP 仅供 Kooyu 主控使用。");
          const resource =
            version.runtime === "local-mcp" ? c.id : new URL(version.endpoint!).origin;
          if (input.resource !== resource || !input.operation.startsWith("mcp."))
            throw new KodoError("UNAUTHORIZED", "MCP 资源范围无效。");
          return this.mcp(
            c,
            (client) =>
              client.callTool({ name: input.operation.slice(4), arguments: input.arguments }),
            authorize,
          );
        }
        const token = await this.vault.get(c.credentialRef!);
        if (!token) throw new KodoError("UNAVAILABLE", "应用凭据不可用。");
        authorize();
        this.service.lifecycle.assertOpen();
        let url: string,
          method = "GET",
          body: unknown;
        if (["telegram", "wecom", "feishu", "weixin"].includes(c.applicationId)) {
          const binding = this.service.im.bindings().find((b) => b.connectionId === c.id);
          if (
            binding?.generation !== c.generation ||
            binding.controllerId !== input.controllerSessionId ||
            binding.chatId !== input.resource ||
            input.operation !== c.applicationId + ".messages.create"
          )
            throw new KodoError("UNAUTHORIZED", "回复超出已绑定的会话。");
          const text = z.string().min(1).max(4096).parse(input.arguments.text);
          if (c.applicationId !== "telegram")
            return this.service.im.send(
              c.id,
              binding.chatId,
              text,
              input.identity.toolCallId,
              token,
            );
          if (!/^\d+:[\w-]+$/.test(token))
            throw new KodoError("INVALID_INPUT", "无效的机器人令牌。");
          const response = await this.fetcher(
            "https://api.telegram.org/bot" + token + "/sendMessage",
            {
              method: "POST",
              redirect: "error",
              signal: AbortSignal.timeout(30000),
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ chat_id: binding.chatId, text }),
            },
          );
          const receipt = await boundedJson(response);
          if (
            !response.ok ||
            receipt.ok !== true ||
            !Number.isSafeInteger(receipt.result?.message_id)
          )
            throw new KodoError("UNAVAILABLE", "Telegram 未确认发送结果。");
          return { messageId: receipt.result.message_id };
        }
        if (c.applicationId === "github") {
          if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input.resource))
            throw new KodoError("INVALID_INPUT", "GitHub 资源应为 owner/repo。");
          const root = "https://api.github.com/repos/" + input.resource,
            number = input.arguments.number;
          if (input.operation === "github.issues.read")
            url =
              root +
              "/issues" +
              (number === undefined
                ? "?per_page=30"
                : "/" + z.number().int().positive().parse(number));
          else if (input.operation === "github.issues.create") {
            url = root + "/issues";
            method = "POST";
            body = z
              .object({
                title: z.string().min(1).max(256),
                body: z.string().max(60000).default(""),
              })
              .strict()
              .parse(input.arguments);
          } else if (input.operation === "github.comments.create") {
            url = root + "/issues/" + z.number().int().positive().parse(number) + "/comments";
            method = "POST";
            body = { body: z.string().min(1).max(60000).parse(input.arguments.body) };
          } else throw new KodoError("UNSUPPORTED", "未知 GitHub 操作。");
        } else if (c.applicationId === "slack") {
          if (!/^[CGD][A-Z0-9]{5,30}$/.test(input.resource))
            throw new KodoError("INVALID_INPUT", "Slack 资源应为频道 ID。");
          if (input.operation === "slack.history.read")
            url = "https://slack.com/api/conversations.history?limit=30&channel=" + input.resource;
          else if (input.operation === "slack.messages.create") {
            url = "https://slack.com/api/chat.postMessage";
            method = "POST";
            body = {
              channel: input.resource,
              text: z.string().min(1).max(40000).parse(input.arguments.text),
              client_msg_id: input.identity.toolCallId,
            };
          } else throw new KodoError("UNSUPPORTED", "未知 Slack 操作。");
        } else throw new KodoError("UNSUPPORTED", "未知应用运行时。");
        const r = await this.fetcher(url, {
          method,
          headers: {
            Authorization: "Bearer " + token,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "Kooyu",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          redirect: "error",
          signal: AbortSignal.timeout(30000),
        });
        if (!r.ok) throw new Error("应用服务返回 HTTP " + r.status);
        const result = await boundedJson(r);
        if (c.applicationId === "slack" && result.ok !== true) throw new Error("Slack 未确认操作");
        return { untrustedResult: result, source: input.resource, operation: input.operation };
      },
      authorize,
    );
  }
}
