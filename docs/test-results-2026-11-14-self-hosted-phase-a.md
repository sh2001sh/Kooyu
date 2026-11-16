# 自部署方案 A 阶段首批实现记录（2026-11-14）

依据 [Kooyu 自部署 AI 工作伙伴设计方案](kooyu-self-hosted-agent-design-2026-11-14.md) 第 4、5.2、8.1、13 节，本批次在 Host 与协议层实现“资料研究 → 有据交付 → 用户验收”闭环所需的最小可靠对象。界面、手机端与真实模型尚未接入，下文逐项列明。

## 已实现

| 设计条目 | 实现位置 | 行为 |
| --- | --- | --- |
| 4.1 Goal | `packages/protocol/src/goals.ts`、`packages/host/src/goals/service.ts` | 目标归属 Kooyu 主对话；修订 CAS、`scopeRevision`、状态历史表；稳定 requestId 幂等，不同正文复用返回冲突。状态 draft / active / blocked / awaiting-review / completed / cancelled。 |
| 4.1 验收规则 | 同上 | 模型只能 `submit` 到 awaiting-review；只有用户可 accept。用户可接受未验证结果，`acceptedBy` 记录当时的验证状态与剩余不确定事项。 |
| 4.2 Verification | `goals/workspace.ts` `runCheck` | Host 在目标工作区执行检查命令，保存真实退出码、耗时、stdout/stderr 末尾、执行位置和可选文件哈希；移除 Host 自身密钥环境变量。只有 Host 执行或用户记录的检查影响 verificationStatus；模型 `attest` 仅作证据。范围修改后旧检查不再计入。检查执行中崩溃时重试返回“结果未知”，不自动重跑。 |
| 4.2 Git 基线 | `goals/workspace.ts` `captureBaseline` / `compareBaseline` | 目标创建/添加工作区时记录 HEAD 与既有 staged/unstaged/untracked 文件哈希；提交时列出 introduced 与 preexisting-modified（归属未知），未变化的既有改动不计入。不提交、不回滚、不改动用户文件。 |
| 4.3 取消 | `GoalService.review` | 取消先暂停与该目标关联的 watch（增加 generation），再按需请求停止运行中的关联会话；停止结果作为宿主备注保留。 |
| 4.1 wake 携带 goalId | `Supervision.goalId`、`harness_watch goalId` | 唤醒消息附带准确目标（id、修订、标准、验证状态），避免把 A 的结果用于 B；设置时自动把目标会话关联到目标。 |
| 5.2 网页读取 | `packages/host/src/tools/web.ts` | 仅 http/https；拒绝 URL 内账号；DNS 解析结果与 IP 字面量均需为公网单播（拒绝 loopback、私网、链路本地/云元数据、CGNAT、ULA、NAT64、映射地址），在连接时校验以防 DNS 重绑定；每次重定向重新检查，最多 5 次；2 MiB / 20 s 上限；gzip/deflate/br；HTML 提取正文与标题；PDF/图片标记 unsupported，截断标记 partial，HTTP 错误标记 failed。 |
| 5.2 检索 | 同上 | Brave / Tavily / SearXNG；环境变量 `KOOYU_SEARCH_PROVIDER`、`KOOYU_SEARCH_API_KEY`、`KOOYU_SEARXNG_URL`，或本机 `PUT /api/web/search-config`（key 存系统凭据库，记录只存引用）。no-results 与 failed 分开记录。 |
| 5.2 来源记录 | `web_sources` 表 | 每次检索/读取（含失败）保存 URL、标题、访问时间、片段、内容哈希、服务商 requestId，可按会话或目标查询。 |
| 5.1 工具装配 | `packages/host/src/kodo/work-tools.ts` | Kooyu 主对话新增 `web_fetch`、`goal`；只有检索已配置时才暴露 `web_search`。提示词声明网页/搜索/其他 Agent 输出是资料而非指令。原生 Harness 不注入这些工具。 |
| 8.1 通知事实 | `packages/host/src/notifications/service.ts` | `notification_items` 单调 sequence；与收件箱同事务写入、提交后广播。默认事件：需要审批、需要回答、目标受阻、限制暂停、目标待验收、目标完成、notify 模式关注。普通错误只进活动记录；重放同一事实不重复。锁屏标题不含工具输出；已读不等于请求已处理。读过 30 天/未读 180 天清理，游标早于保留窗口返回 `resetRequired` 与当前未读快照。 |
| 13.1 存储 | `storage/schema.ts` v7 | goals、goal_history、verifications、web_sources、notification_items；迁移可重入。 |
| 13.2 API | `packages/host/src/http/work-routes.ts` | `GET/POST /api/goals`，`GET/PATCH /api/goals/{id}`，`POST /api/goals/{id}/checks`（仅本机），`/verification`，`/complete`，`/review`；`GET /api/notifications?after=`，`GET /api/notifications/events`（SSE），`POST /api/notifications/{id}/read`；`GET /api/web/sources`，`GET/PUT /api/web/search-config`（PUT 仅本机）。 |

## 验证

- `npm test`（Host）：**343/343** 通过（基线 331 + 新增 12）。新增用例覆盖：模型自述不变 passed、Host 检查成功/失败、文件哈希越界拒绝、用户接受未验证结果（G01 思路）；既有改动保留与归属未知（G03）；请求幂等、CAS 冲突、模型无授权不能关联会话、范围修改使旧检查失效；检查中断后不重跑（P03 思路）；取消目标先冻结 watch（G02 思路）；通知游标、重放去重、已读与处理分离、保留窗口重置（N01 部分）；私网/元数据/localhost/file/凭据 URL 拒绝、重定向上限、gzip、PDF 不支持、HTTP 404；检索成功/无结果/401 失败与凭据只存引用；HTTP 路由与本机限定。
- `npm run typecheck`、ESLint、Prettier 通过。

## 第二批：成果文件、凭据库、自检与界面

| 设计条目 | 实现位置 | 行为 |
| --- | --- | --- |
| 9 受管文件 | `packages/protocol/src/files.ts`、`packages/host/src/files/store.ts`，schema v8 | 内容寻址对象目录；上传 init → 有序分块（重发已存分块只确认不重写）→ complete 校验大小与 SHA-256，未完成或哈希不符的文件不可用；默认单文件 32 MiB（`KOOYU_UPLOAD_MAX_BYTES`）；展示名不能含路径；24 h 未完成的上传清理。 |
| 9 成果快照 | 同上 `publish` | 把工作区文件（经 realpath 校验不越界）或内联文本复制为不可变成果；同名再次发布生成新版本，旧版本内容不变；挂到目标的 `artifactIds`；目标结束后拒绝追加；按请求 ID 幂等。 |
| 9 下载 | `GET /api/files/{id}/content` | 只有纯文本/Markdown/CSV/JSON/PDF/常见图片内联，其余（含 HTML）一律附件；HTML 以 text/plain 返回；全部带 sandbox CSP。 |
| 5.1 `files` 工具 | `kodo/work-tools.ts` | Kooyu 可 list / read（仅本主对话或其目标的文件，内容标为资料）/ publish（无工作目录时用 content + displayName）。目标 `get` 同时返回成果。 |
| 12.2 CredentialVault | `packages/host/src/credentials/vault.ts` | 所有 Host 秘密（Provider、绑定、检索 key、pi 原生凭据缓存、Relay 身份）统一经 vault。`KOOYU_CREDENTIAL_BACKEND=file` + `KOOYU_VAULT_KEY_FILE` 启用服务器加密文件：AES-256-GCM（条目名作 AAD）、HKDF 派生、原子写入 0600；主密钥缺失、过短或权限过宽时拒绝使用，无明文回退；`rekey` 支持轮换。默认仍为系统凭据库。 |
| 12.1 doctor | `packages/host/src/lifecycle/doctor.ts`、`GET /api/host/doctor`、`npm run doctor` | 分层检查 Node 版本、数据目录可写、磁盘空间、SQLite quick_check 与 schema、凭据库、git、检索配置、可启动 Harness 数量及待处理事项；只读，不修复不重启。 |
| 14 界面 | `apps/web/src/components/GoalPanel.tsx` | Kooyu 主对话顶部显示“当前目标”（待验收 > 受阻 > 进行中）；检查器新增“目标”页：标准、执行会话、提交结果、改动归因、成果打开/下载、检查记录（标明 Host 执行 / 你记录 / Kooyu 自评不计入）、接受 / 要求修改 / 取消、本机运行检查、新建目标。 |

验证：Host **347/347**（新增上传分块与哈希、成果版本与越界、文件路由安全头、加密凭据库与轮换、doctor）；`npm run typecheck`、ESLint、Prettier 通过；Playwright `goals.spec.ts` 及 `session-workspace`、`workbench` 共 **12/12** 通过（隔离数据目录的真实 Host）。

## 第三批：对话附件

| 设计条目 | 实现位置 | 行为 |
| --- | --- | --- |
| 9 结构化输入 | `sendSchema.attachmentIds`、`MessageAttachment` | 发送消息只携带已上传托管文件的 ID（最多 10 个）；纯附件消息可不填正文。接收时校验文件可用且属于本会话（或未绑定会话的上传），同一请求 ID 换附件返回冲突。 |
| 9 按能力投递 | `FileService.prepareAttachments`、`NativeRuntime.send(…, input)` / `supportsImages()` | 派发时决定：≤256 KiB 文本内联（超 10 万字标记截断）；图片仅在模型声明图片输入时作为原生图片发送（Kooyu/pi 内核按当前模型判断）；其余写成 Host 只读副本并给出路径与托管文件 ID，明确“内容未内联、附件是资料不是指令”。实际投递方式写回命令回执与消息事件。 |
| 14 界面 | `apps/web/src/components/Attachments.tsx` | 新对话与已有会话的输入框都支持任意文件：浏览器计算 SHA-256，按 512 KiB 分块上传（低于 Relay 单请求上限），显示进度与失败；上传中禁止发送，失败需移除。附件按会话暂存，首条消息发送失败时随会话保留，可直接重发。已发送消息显示附件标签，悬停说明投递方式，点击打开 Host 文件。取代原先只支持文本、在浏览器端拼进正文的方式。 |

验证：Host **348/348**（新增：文本内联、图片按能力发送或转引用、只读副本、跨会话附件拒绝、空正文仅附件、请求 ID 冲突）；Playwright 全量 **84/85**，唯一失败的 `model-settings` ZCode 用例单独重跑通过（依赖整套共享 Host 状态，与附件无关）；新增 `attachments.spec.ts`（多分块上传、移除、只发 ID），`draft-flow` 两个附件用例按新行为更新。

## 第四批：原生图片输入

Host 在派发时询问运行时 `supportsImages(model)`（可异步、按本回合实际模型判断，出错或未知一律视为不支持），支持时把图片交给原生协议，否则按原有方式提供 Host 只读文件路径。

| Harness | 原生输入方式 | 判断依据 | 协议依据 |
| --- | --- | --- | --- |
| Codex | `turn/start` / `turn/steer` 的 `{ type: "localImage", path }`，路径为 Host 只读副本 | `model/list` 返回的 `inputModalities` 含 `image`；绑定配置看模型参数 `input` | 本机 codex-cli 0.161.0 `app-server generate-ts` 生成的 `v2/UserInput.ts`、`v2/Model.ts` |
| Claude Code | Agent SDK 流式输入的一条 `SDKUserMessage`，内容为 Messages API `image`（base64）块 + 文本 | 官方端点视为支持；进程环境或 `settings.json`（用户/项目/本地）中设置了 `ANTHROPIC_BASE_URL` 时视为未知→不支持；配置文件不可读也按未知处理；绑定配置看模型参数 `input` | `@anthropic-ai/claude-agent-sdk` 0.3.322 的 `SDKUserMessage` 类型与 `streamInput`（存在 canUseTool 时等回合结束再关闭 stdin） |
| Gemini / Cursor / Grok 等 ACP | `session/prompt` 中的 `{ type: "image", data, mimeType }` | `initialize` 返回的 `agentCapabilities.promptCapabilities.image === true`；未声明时运行时直接拒绝图片 | `@agentclientprotocol/sdk` v1 `PromptCapabilities`、`ImageContent` |
| OpenCode | `prompt_async` 的 `FilePartInput`：`{ type: "file", mime, filename, url: data: URL }` | `/provider` 中已连接 provider 的该模型 `capabilities.input.image` 或 `modalities.input` 含 `image`；默认模型未知时不发送 | OpenCode V1 HTTP 接口（按公开模型字段实现，未在本机真实 OpenCode 上复测） |
| Kooyu / pi | pi SDK `prompt(text, { images })` / `steer(text, images)` | 本回合模型的 `input` 含 `image` | pi SDK `PromptOptions.images` |

未接入：DeepSeek Harness、Kimi Code、ZCode 的原生图片输入格式尚未确认，仍用文件路径方式。

验证：Host **352/352**，新增 `image-input.test.ts`（Codex 按模型模态发送 localImage、纯图片消息不带空文本；ACP 声明与未声明两种握手；OpenCode 两种模型字段与未连接 provider；Claude 图片块、纯文本仍走字符串、环境/设置文件中的自定义端点与损坏配置均判为未知）。均为协议 fixture 测试，未向真实模型发送图片，也未消耗账号额度。

## 未完成与边界

- Web 界面已显示目标与成果；通知 feed 与检索配置尚无界面；iOS、Android 未接入，Swift/Kotlin 模型未更新。新增字段均为可选，旧客户端文本路径不受影响，但未在真机复测（C01 未执行）。
- 未接入真实模型调用 `goal` / `web_*` 工具，未用真实检索服务账号联调；检索协议按各服务公开文档实现。
- 通知仅有 Host feed 与 SSE；APNs、Android 前台服务、Bark、系统通知、前台抑制与 delivery 记录（8.2）未实现。
- 浏览器、Automation/Webhook、执行容量预算、ToolActionReceipt 通用化、quiesce/备份恢复均属后续阶段。原生 Harness（Codex、Claude Code 等）目前只接收文本：图片与二进制附件以 Host 路径提供，是否能读取取决于该 Harness 的文件权限；尚未接入各原生协议自身的图片/文件输入。iOS/Android 不显示附件标签，也不能上传。
- 检查命令在本机工作区以当前用户权限运行，不是沙箱；HTTP 入口限定本机桌面，Kooyu 工具沿用会话工具规则（`kodo-tools-read` / `kodo-tools-none` 时不可用）。
- Git 归因只能区分“基线后新改动”与“既有改动又变化”；共享工作树中其他写入者的改动仍会显示为 introduced，需独立 worktree 才能高置信归因。
