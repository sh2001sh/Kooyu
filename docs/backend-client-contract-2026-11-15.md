# 跨端后端补齐：接口契约与恢复语义

日期：2026-11-15。范围：Host、共享协议、后端测试和说明文档。本轮没有修改桌面、Android 或 iOS 的前端界面。前端现存问题见 [问题清单](frontend-issues-2026-11-15.md)。

## 1. 兼容性和信任边界

- 基础协议仍为 `PROTOCOL_VERSION = 2`；能力接口新增 `contractVersion = 1`，新增配置接口使用 `schemaVersion = 1`。
- 保留旧 `/api/native/snapshot`、Goal 详情、会话权限、输入指令及其回执契约。新客户端按 capabilities 探测新增接口。
- 所有新增接口位于原有认证、来源校验、协议版本校验之后。配对设备仍是单 Host 的可信客户端，并未新增租户隔离或只读账号体系。
- 新的管理回执是明确白名单的服务调用，不会转发任意 URL，也不能调用安装引擎、凭据、配对或内部运维接口。
- 本机管理员判定沿用既有本机来源、Host 及 TCP peer 规则，不能用请求 JSON 声明本机身份。
- 新增 `records` 数据种类即可持久保存设备委派与管理回执，不需要新增数据库迁移。回执保留请求摘要及业务结果，不另存请求原文、Bearer 或密钥。

## 2. 接口一览

| 方法与路径 | 作用 | 权限 |
| --- | --- | --- |
| GET /api/capabilities | 协议支持、当前设备授权、Host 可用性及原因、传输限制 | 已认证 |
| GET /api/devices/:id/access | 查询设备检查权限及授权修订号 | 本机管理员 |
| PUT /api/devices/:id/access | 显式授予或撤回 goals.check | 本机管理员 |
| GET /api/goals/:id/detail | 聚合目标、验证、历史、会话、工作区、成果、待处理和操作状态 | 已认证 |
| GET /api/notifications/:id/context | 获取通知原始业务目标及当前上下文 | 已认证 |
| POST /api/client/operations | 执行支持幂等回执的管理写操作 | 已认证；内部白名单 |
| GET /api/client/operations/:requestId | 查询当前设备的管理操作结果 | 已认证；设备隔离 |
| GET /api/native/sync?cursor=... | 原生快照或增量 | 已认证 |
| GET /api/sessions/:id/configuration | 解析当前模型、权限、绑定与新会话默认配置 | 已认证 |
| GET /api/harnesses/:id/configuration | 查询 Host 权限目录或原生协商要求 | 已认证 |
| GET /api/files/:id/access | 文件类型、预览可用性、下载地址和传输能力 | 已认证 |
| GET、HEAD /api/files/:id/content | 流式读取、单段 Range、条件请求 | 已认证 |

## 3. 能力与设备委派

旧 `capabilities` 的数值标志只表示支持该接口族，全部保留。新增 `operations` 为每类操作返回：

```json
{
  "supported": true,
  "allowed": false,
  "available": false,
  "requirement": "explicit-delegation",
  "reason": "需由 Host 本机管理员显式授予此设备执行检查的权限。"
}
```

`supported` 是实现支持，`allowed` 是调用者身份是否允许，`available` 还考虑 Host 冻结和浏览器安装情况。对象自身状态、参数、目录是否存在等仍由业务接口最终校验；能力响应不是长效授权票据。未知操作默认 unsupported。

委派示例，由本机向 `PUT /api/devices/:id/access` 提交：

```json
{ "expectedRevision": 0, "operations": ["goals.check"] }
```

成功后 revision 加一；撤回时使用最新 expectedRevision 和空数组。版本过期返回 409；设备不存在或已到期不能授予。设备撤销同时移除委派记录，旧 Bearer 不能继续查询或执行。

目前只允许委派 `goals.check`。它允许在目标关联的本机工作区执行用户提供的检查命令，**可能具有任意 Shell 副作用，不是只读检查沙箱**。只应授予已信任的设备。本轮没有开放引擎安装、系统配置、凭据或设备管理。

目标检查 HTTP 路由实际使用同一权限判断；没有授权的手机返回 401，Host 冻结后返回 503。委派不放宽 Goal 的状态、工作区归属、执行生命周期和已有检查幂等约束。

## 4. 目标与通知上下文

Goal 聚合保留原有 goal/verifications/history，并增加：

- controller、sessions、workspaces，以及 missingSessionIds/missingWorkspaceIds。
- artifacts：按目标保存的 artifactIds 读取全部关联成果，不受通用列表 500 条上限影响。按关联顺序倒序返回，最新关联在前。
- 每份成果包含 artifact、file、available、reason；记录不存在列入 missingArtifactIds，内容缺失或大小不符会明确不可用。
- 未解决 inbox，包含 Host 原生 answer 结构的 actions，前端不必猜测批准协议。
- update/accept/request-changes/cancel/check 的身份权限与当前状态可操作性；检查还要求本机工作区。实际写操作仍带原契约要求的请求 ID、版本和业务参数。

删除会话、隐藏项目不会被当成可导航的活动目标。原有 Goal 列表接口保持兼容，新 native/sync 的 goals 与可见会话保持一致。

通知上下文优先按原始 inboxItemId、其次 goalId、最后 sessionId 定位。返回 target 的 kind/id、hostId、session/inbox/goal，以及 actionable/resolved/unavailable 状态。业务目标缺失时保留原 target，避免静默切到另一个任务。

**读取上下文不会标记已读、确认推送、回答审批或验收目标。** 已读、设备投递确认、业务处理继续使用各自专用接口。

## 5. 管理写操作回执

客户端先生成稳定 UUID，然后提交：

```json
{
  "requestId": "11111111-1111-4111-8111-111111111111",
  "method": "POST",
  "path": "/api/projects",
  "body": { "name": "示例项目" }
}
```

白名单如下，沿用原服务的参数验证及权限逻辑：

| 业务操作 | method / path |
| --- | --- |
| 新建、修改项目 | POST /api/projects；PATCH /api/projects/:uuid |
| 移除项目 | DELETE /api/projects/:uuid，可带 ?sessions=keep 或 ?sessions=delete |
| 添加工作区 | POST /api/workspaces |
| 新建草稿会话 | POST /api/sessions |
| 修改会话元信息、单独修改权限 | PATCH /api/sessions/:uuid |
| 更新通用配置 | PATCH /api/app-settings |
| Host 默认绑定 | PATCH /api/binding-defaults |
| 项目默认绑定 | PATCH /api/projects/:uuid/binding-defaults |

不可将发送、停止、模型设置、队列、Goal 或外部动作套入此接口；它们保留已有专用请求记录，不制造两套权威回执。

回执状态含义：

| 状态 | 含义与恢复方式 |
| --- | --- |
| pending | 已持久登记，当前 Host 尚在执行；继续查询 |
| confirmed | 已确认业务结果，result 是原业务返回值；重复相同请求复用结果 |
| failed | 同步数据库操作已回滚且验证/业务失败已知；核对 error 后决定新的业务请求 |
| unknown | 可能有副作用但无法证明结果，或上个 Host 的 pending 未完成；核对业务对象，绝不自动重放 |

- 幂等键是设备 ID + requestId，同一设备相同 ID 不同参数返回 409；JSON 对象键顺序不影响摘要，数组顺序仍有意义。
- 同进程重复请求共享进行中的操作。同步数据库变更与 confirmed 回执在同一事务提交，项目创建也支持嵌套事务。
- 涉及原生权限变更、项目移除等异步副作用时，执行前先持久化 pending。异常保守记为 unknown，不能假定取消或回滚成功。
- 数据库重新打开后仍可查询。旧进程遗留 pending 首次查询变为 unknown；重交相同请求也不会再执行。
- 所有回执 `retryable = false`。丢失响应时先 GET 查回执；不要生成新 ID 盲重试。没有查到回执时可在同 Host、同设备使用原 ID 和原参数提交，由 Host 去重。
- POST 业务终态包括 failed/unknown 都以 HTTP 200 携回执返回；客户端必须检查 status。请求结构错误、白名单拒绝、认证失败及 ID 冲突等在接受前按 HTTP 错误返回，不保证有回执。
- 不提供“清除未知状态即表示成功”的接口，也未实现自动业务对账。

## 6. 配置解析

统一权限目录位于 Host，校验与新查询复用同一份目录。ACP 运行模式仅使用已连接原生会话声明的选项，不从手机硬编码猜测。保留旧 `/permissions` 响应，避免破坏旧客户端。

新 session configuration 关键字段：

- binding：当前会话固定的 ID/revision，source=session-snapshot。不会把后来修改的 Host 或项目默认绑定说成已生效。
- model：selected 是会话保存值；observed 是已有原生模型查询得到的值；effective/source 区分会话、绑定、原生运行时、原生默认和 unresolved。绑定修订缺失时明确不可用，不静默换默认模型。
- permissions：selected 是保存值；observed 只来自已连接运行时；current 是原生报告或静态目录支持的保存配置，不代表原生已经执行过任务。source 与 canChange/reason 区分未连接、运行中、无可切换模式和执行器尚未提供选项。
- newSessionDefaults：Host、项目和 Harness 当前的新会话默认值，明确与现有会话快照分离。历史会话没有记录创建时每个字段的输入来源，因此 source=session 指保存结果，不推断当时是手工输入还是预设。
- settingsRevision 仍用于原有模型设置乐观锁；configurationRevision 是整个解析响应的内容摘要，用于发现变化，不能替代现有写接口的 expectedRevision。

查询不会自动连接休眠会话或启动原生模型发现。已有运行时的模型查询、执行器只读检查、已有模型目录刷新行为沿用现有服务；不能把该查询当成模型推理或原生账号登录验证。远程执行器权限选项尚未声明时返回不可切换及原因。

## 7. 原生增量同步

首次 GET 不带 cursor 返回 `resetRequired=true` 和完整 snapshot，增加 goals 及原生 inbox actions。客户端保存 Host ID、快照和响应 cursor。

后续带 cursor：

- 已知基线返回 baseCursor、collections 和 values。collections 每项包含 upsert/remove/order；先替换/新增与移除，再按 order 重建完整顺序。
- 通常以 id 为集合主键；projectGrants 使用 controllerSessionId:projectId。values 直接替换顶层标量/对象，包括 eventCursor、bindingDefaults。
- 无变化时响应保留 cursor，collections/values 为空。
- 客户端只在本地当前 cursor 等于 baseCursor 且 Host ID 匹配时应用增量；不匹配则重新无游标读取，避免并发响应乱序。
- 未知、被淘汰或 Host 重启后的 cursor 返回完整重置快照；客户端必须替换本地旧集合，不能合并残留数据。
- 服务端缓存最多 32 个快照且总序列化大小不超过 16 MiB。单份过大时不缓存，允许后续继续全量重置。cursor 含每次服务实例的随机 epoch，并非 durable event ID。

这是有界网络增量缓存，不替代 `/api/events` 的持久 SSE 事件日志，也不代替会话历史/消息分页。新权限未放入同步快照，客户端应重新读取 capabilities/对象上下文，不把旧状态当授权依据。

## 8. 文件传输

- file access 返回相对 contentUrl/downloadUrl、预览类型支持与原因、大小、SHA-256、ETag、Range 能力、上传限制；链接不带凭据，下载仍需认证。
- HEAD 返回内容长度、类型、ETag 等元数据，无响应体。
- GET 支持单段 bytes=start-end、bytes=start-、bytes=-suffix，返回 206/Content-Range；越界、格式错误及多段请求返回 416 和 bytes */size；不实现 multipart ranges。
- If-Range 仅匹配当前强 ETag 时续传，其他情况回全量 200；If-None-Match 命中返回 304。客户端应保留文件对应的 ETag，避免拼接不同内容。
- 数据用文件流读取，支持中断清理。图片、PDF 和受限文本可 inline；HTML 强制纯文本，其他未允许类型下载。保留 CSP、nosniff 和 no-store。
- 默认上传上限 32 MiB，可由既有环境变量调整；块上限 4 MiB。原上传偏移续传和完成时 SHA-256 校验继续使用既有实现。
- 打开时核对对象存在性、普通文件与大小。ETag 基于入库时的不可变内容哈希，不在每次 GET 重新计算全文件哈希；不承诺检测数据目录被外部同长度篡改，运维仍需保护内容目录。

## 9. 实现位置与交付边界

共享类型：packages/protocol/src/clients.ts。后端：packages/host/src/clients/、configuration/permissions.ts、files/http-content.ts、http/client-routes.ts；旧 HTTP 路由接入同一认证与授权约束。回归用例：packages/host/test/client-contract.test.ts。

自动化验证记录见 [测试报告](test-results-2026-11-15-backend-client-contract.md)。本轮新增的是前端可接入的服务能力，**不代表移动端已补齐导航、成果验收、附件交互或工作中心**。iOS 实机、后台推送、BlueStacks 新一轮截图与真实厂商模型调用不在本轮后端验证范围内。
