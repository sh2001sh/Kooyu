# Kooyu 自部署 AI 工作伙伴设计方案

日期：2026-11-14；实现状态更新：2026-11-15。状态：Host/Web 主体已落地，分阶段验收中。本方案以调研当时的工作区源码为基线，参考 ProkBot Plus 固定提交 43c6d59e9d9c47c7f4850b7909c41b11f606898a，以及 DSH Superagent Prototype 固定提交 8c32a9dc5d72c033816c6a8110b37f40cf94fba4。现有产品要求见 [PRODUCT](../PRODUCT.md) 和 [总体设计](design.md)；本提案不自动替代已确认要求。正文保留设计时态、初始基线和固定来源行号，实际可用范围以最新验收记录为准。

实现进度（2026-11-15）：A 的目标/联网/文件/Vault/生命周期、B 的计划/Webhook/应用授权/业务回复/记忆，以及 C 的本机 Chromium 与 HTTPS Worker 已有实现和自动化验证。已补 Host APNs、iOS 原生 token 注册/撤销/点击定位源码，以及 Android 可选前台服务/SSE 与系统提醒。Host 387 项、Web UI 92 项、Android 48 项测试通过；iOS 仅语法检查，未运行 Xcode/真机推送。D 已提供 Slack、远程 MCP、不可变清单和权限差异；代码应用沙箱、媒体生成/转录、桌面流、原生新增目标/文件工作中心及正式签名发布未完成。锁屏/系统回收、各平台安装升级和真实厂商账户尚待验收。逐项状态见 [本轮实现与验收报告](test-results-2026-11-15-self-hosted.md)，部署操作见 [操作说明](self-hosted-operations.md)；不能据此宣称 A–D 已全部生产完成。较早的 [A 阶段首批记录](test-results-2026-11-14-self-hosted-phase-a.md) 保留历史证据。

阅读建议：产品取舍看第 1–2 节，技术设计看第 3–14 节，开发顺序与验收看第 15–16 节；第 17 节逐项给出参考仓库、文件、函数/章节和固定行号。

## 1. 产品目标与范围

建议定位：**Kooyu 是部署在自己设备或服务器上的常驻 AI 工作伙伴，能够联网、使用应用、处理文件、按计划执行任务，并调度已有 Agent 完成复杂工作。**

保留现有项目 → 会话结构、Kooyu 主对话、10 种原生 Harness 直接对话、pi SDK 与 SessionManager。已有用户可以继续直接使用 Harness；主对话增加通用工具和持续工作能力。增加的对象用于保存目标、触发、授权和成果，不建立强制任务树、角色层级或固定工作流 DAG。

首批面向独立开发者和小型技术团队，同时通过“资料整理、周期汇报、文件交付”验证通用工作能力。首批完整场景：

1. 用户说“研究这个网页及相关资料，明早给我一份带来源的报告”，选择执行位置、时间和结果通知。
2. Kooyu 保存目标、资料、验收要求与计划；到时直接使用检索、文件工具执行，必要时调用浏览器。
3. 用户离开桌面后，Host 持续执行；需要审批时手机收到提醒，点击进入同一待处理事项。
4. 成果包含可下载报告、引用、执行记录与未确认事项；用户可以要求修改或接受结果。
5. 编程场景中，主对话复用现有 Harness 工具委派 Codex/Claude 等，并关联真实会话、改动和测试证据。

定时任务可以自动执行用户预先授权的范围。新增授权、发布、删除、停止等操作沿用实际请求和已授予权限；不让用户重复确认已经明确授权的每一步。

### 1.1 相比当前项目，最需要补充什么

| 优先级 | 缺口 | 首个可交付结果 |
| --- | --- | --- |
| P0 | 主对话偏重编程 Harness 调度，通用工作缺少完整入口 | 搜索、网页读取、文件处理和按范围装配的应用工具，先完成一次资料研究交付 |
| P0 | 会话结束与目标完成之间缺少可追溯结果 | 轻量 Goal、成果快照、验证记录；继续沿用现有会话/watch |
| P0 | 离开桌面后的闭环不足 | 常开服务器 Host、无桌面凭据后端、手机通知与同一请求的处理入口 |
| P0 | 新增外部动作需要明确恢复语义 | 事务提交后派发、稳定命令/动作身份、未知结果核对、并发预算 |
| P1 | 定时和外部事件尚未构成可靠入口 | Automation/Activation、事件去重、预授权范围、暂停和重启恢复 |
| P1 | 新会话缺少可编辑的项目长期约定 | 带来源和修订的项目记忆，纠正和删除后下一轮生效 |
| P1 | 登录网页工作与本机资源远程使用 | 受管浏览器先落地；远程节点另行验收，不与首批全量捆绑 |
| P2 | 扩展与分发体验 | 应用包、多媒体、平台签名/推送和安装升级验证 |

定位文案建议使用“自部署 AI 工作伙伴”，在说明中解释 Grok Bot 风格的常驻、跨端与工具能力。Kooyu 的已有差异是能够保留十种原生 Harness 的直接会话、账号与能力，同时由一个主对话协调；首发需要证明“离开电脑后仍能拿到可信成果”，而不只展示接入模型数量。

## 2. 参考结论与采纳边界

### 2.1 ProkBot Plus 实际提供的结构

[架构说明 R01][R01] 与 [启动装配 R02][R02] 显示，它在原版 Grok Bot Host 和执行桌面外增加管理、模型适配、通知、应用与部署机制；客户端连接方式也有补丁。其定时、通知、Webhook 等增补源码可直接研究。部分核心能力依赖固定官方输入、运行时库或恢复模块，不能将仓库里的包装入口当成完整自主实现。见 [核心装配 R27][R27]。

研究方式：读取固定提交的文档及相关文件，核对入口函数、状态转换与失败处理。未构建、运行或验证其真实设备、模型账户、容量或安全隔离。本方案中的“已确认”仅指静态源码可见机制。

| 机制 | 采纳方式 | Kooyu 的取舍 |
| --- | --- | --- |
| Host 与执行环境分离 | 采纳职责边界，先支持单机再增加一个远程节点 | 使用自研协议和现有适配器；不依赖官方 Host、镜像或客户端补丁 |
| 派发前登记定时任务 | 采纳持久领取、同计划单实例、错过合并 | 使用现有 SQLite 事务与命令回执；不复制 JSON 文件台账 |
| Webhook 验签、事件去重、领取、结束 | 采纳事件入口与执行记录分离 | GitHub 等采用厂商原生签名；不要求外部服务使用参考项目的自定义签名格式 |
| 通知待发箱和设备投递 | 采纳持久投递、设备撤销、重试、深链 | 与 Kooyu 收件箱和事件事务关联；补充单调游标与明确的前台接收确认 |
| 应用包、MCP、OAuth、技能 | 采纳面向用户的应用模型 | 首版优先少量经过验证的连接；代码应用稍后放到受限执行环境 |
| 附件与资料库同步 | 采纳 Host 存储与执行文件分离 | 使用内容哈希、显式同步状态和适配器能力，不假设共享文件系统 |
| 模型自动路由和自动审查 | 记录为后续选项 | 先保留现有显式绑定；不新增必经任务分类模型或让审查模型扩大授权 |
| 备份和恢复 | 采纳校验清单、恢复到新位置 | 覆盖 SQLite、文件、原生历史和独立凭据策略；恢复默认冻结自动执行 |

参考项目采用非商业许可证，明确限制商业使用和派生部分的重新授权，见 [LICENSE R30][R30]。方案调研批次仅交付设计与事实索引，下载的研究副本留在被忽略的 .local 目录。后续实现按公开协议和本方案独立编写，不复制其受限代码、补丁、压缩规则、界面资源或官方程序。

### 2.2 DSH 补充的设计价值

用户提供链接中的组织名需要修正：实际参考仓库为 [deepseek-ai/dsh-superagent-prototype][D01]。它是围绕一个 GitHub 仓库的主动编程 Agent 原型，依赖 DeepSeek Harness；README 明确指出它不是正式 DeepSeek 产品，文章描述也不等于本仓库已经实现的功能。本方案不把它当成通用桌面助手或第二套 Kooyu 运行时。

| DSH 机制 | Kooyu 采纳内容 | 保留的边界 |
| --- | --- | --- |
| 减少人工注意力 [D02] | 一次确认；有结果、阻塞或需要决定时再通知；进度保留在活动记录 | 不隐瞒失败；用户主动查看时仍可读完整记录 |
| Mandate 与来源分离 [D03]、[D13] | 将用户/规则授权保存为 grant；来源消息不升级权限；恢复前重新检查 | 不引入其完整 Eval/Decision/Ticket 路由体系，也不照搬它对陌生人续聊的默认策略 |
| SQLite Effects [D04]、[D05] | 提交后派发、同键 generation 条件确认、容量不足与失败分开 | 集成 Kooyu Store、commands、wake；不建立第二套通用消息框架 |
| 稳定投递身份 [D06]、[D07] | 检查待收消息及已持久历史；区分已提交、已进入历史与已完成请求 | 仅适配器确实支持时提供这些保证，不能据此假定所有原生 CLI 可幂等发送 |
| WorkerSlots 与后台生命周期 [D08]、[D09] | await 前预留容量；人工续聊优先；后台作业结束前不报空闲 | 原型的额外名额和 30 分钟是其策略；Kooyu 使用明确的资源上限和能力声明 |
| Outbox [D10] | 外部业务回复另存待发记录，顺序、撤回和失效可核对 | API 没有幂等/查询能力时，响应丢失仍然可能是 unknown |
| 重启对账 [D07] | 读取原生历史、工作区与外部实际状态，再续接原任务 | 恢复提示词不能替代宿主动作回执和授权检查 |

DSH 为 MIT 许可，见 [D11]；后续若实际复用代码，应保留相应版权和许可。本次只提交设计与来源索引，不复制其实现。ProkBot 主要提供自部署助手的能力面与客户端/部署参考，DSH 主要补充主动工作的授权、消息与执行生命周期。

原始 linux.do 主题直接访问返回 HTTP 403，未取得可核验的正文与回复；因此不引用帖内功能或用户反馈，技术结论以固定提交源码为依据。两个项目均只做静态源码研究，未运行其测试或宣称生产验证。

### 2.3 Kooyu 当前能力基线

| 已有基础 | 当前代码 | 需要扩展的部分 |
| --- | --- | --- |
| 原生会话、命令与执行回执 | [session-service.ts](../packages/host/src/session-service.ts)、[adapter.ts](../packages/host/src/harnesses/adapter.ts) | 业务工具调用的回执，结构化输入，执行节点选择 |
| SQLite 事务、事件、watch/wake 和恢复 | [store.ts](../packages/host/src/storage/store.ts)、[schema.ts](../packages/host/src/storage/schema.ts) | 新增对象与事务约束，不再建立另一套通用事件总线 |
| 托管目标和限制 | [协议](../packages/protocol/src/index.ts)、[主 Agent 工具](../packages/host/src/kodo/tools.ts) | 目标修订、跨会话关联、成果、验证记录；已有 goal 不重复迁移成另一份权威文本 |
| Kooyu/pi SDK 内核与基础工具 | [kernel.ts](../packages/host/src/kodo/kernel.ts) | 给 Kooyu 按会话授权装配通用工具，保留独立 pi 的身份与设置 |
| 收件箱与前台 SSE | [HTTP server](../packages/host/src/http/server.ts) | 后台通知投递；现有 notifications EventEmitter 是进程内事件广播，不是持久推送服务 |
| 手机配对与 Relay | [pairing.ts](../packages/host/src/devices/pairing.ts)、[relay.ts](../packages/host/src/devices/relay.ts) | 通知、浏览器/桌面流、设备范围与能力协商 |
| 技能读取和编辑 | [skills.ts](../packages/host/src/configuration/skills.ts) | 应用工具与技能的关联、版本与授权 |
| 文本附件与工作区预览 | [TextAttachments](../apps/web/src/components/TextAttachments.tsx)、[artifacts.ts](../packages/host/src/workspaces/artifacts.ts) | 二进制附件、下载成果、任务基线与明确来源 |

当前数据库构造器支持版本 6，协议常量为 2。实现时必须重新检查实际版本再分配迁移号，不能将旧设计中的 v5 当成现状。原生移动端已有功能及待验收项以 [移动矩阵](mobile-feature-parity.md) 为准；本方案不把未推送、未真机验收的项目算作已完成。

## 3. 总体架构

~~~mermaid
flowchart TB
    UI[Electron / Web / SwiftUI / Compose] --> API[Host 认证 API 与事件流]
    HOOK[外部 Webhook] --> IN[独立事件入口：验签与限流]
    IN --> ACT[Automation：发生记录与派发]
    TIMER[宿主计时器] --> ACT
    API --> SS[现有 SessionService]
    ACT --> SS
    SS --> AG[Kooyu：现有 pi SDK agent loop]
    AG --> HT[现有 Harness 工具]
    HT --> NA[现有原生适配器]
    AG --> TO[工具装配与授权]
    TO --> WEB[检索与网页读取]
    TO --> APPS[应用与 MCP]
    TO --> EX[Executor：本机 / 受管执行环境]
    SS --> DB[(SQLite：命令 / 目标 / 触发 / 记录)]
    ACT --> DB
    API --> FILES[受管文件存储]
    EX --> FILES
    DB --> NOTIFY[通知投递器]
    NOTIFY --> PUSH[系统通知 / APNs / 可选其他通道]
    NOTIFY --> API
~~~

部署形态分两步：

- **A：一个常开 Host**。Host、Kooyu、原生 Harness 与执行环境都在同一设备或服务器。手机通过现有 HTTPS/Relay 接入。用户电脑关机不影响服务器上已经部署的任务，但本机路径、登录和进程不会自动出现在服务器。
- **B：一个 Host + 一个明确配对的执行节点**。Host 保持目标、计时、会话索引与调度；节点运行适配器、浏览器或命令并保存本地动作回执。节点可在用户电脑上主动出站连接。新增节点不等于多个 Host 共享 SQLite，也不等于已支持多 Host 联邦。

保留 Workspace.hostId 表达文件所在机器。另加 executorId 表达执行服务，禁止把服务器路径解释成本机路径。会话创建时固定执行位置；切换客户端当前电脑不会迁移既有运行。

## 4. 目标、成果与验收

### 4.1 一个目标对应一件可验收的工作

新增 Goal 作为主对话上的轻量工作记录，允许关联多个执行会话和托管关系。普通直接聊天无需创建 Goal。一个主对话可以顺序处理不同目标；自动唤醒必须携带准确 goalId，避免把目标 A 的结果用于目标 B。

建议字段：id、projectId、controllerSessionId、revision、title、description、acceptanceCriteria、workspaceIds、sessionIds、status、blockedReason、artifactIds、verificationIds、createdAt、updatedAt。

状态建议为 draft、active、blocked、awaiting-review、completed、cancelled。另存 verificationStatus：unverified、passed、failed、not-applicable。用户可明确接受未验证结果，但记录 acceptedBy 与剩余不确定事项；模型自述“完成”不能自动变成 passed。

已有 Supervision.goal 继续支持旧会话。新关系引用 goalId 和 goalRevision，兼容展示所需摘要；目标正文只由 Goal 持有。旧 watch 首次关联时保留其原目标与来源，不凭相同文本自动合并不同用户任务。

### 4.2 完成必须能追溯

Kooyu 结束目标时登记一份结果：做了什么、产物、验证、已知限制。Verification 记录检查类型、执行位置、命令或方法摘要、实际退出状态、时间、相关文件哈希与结果引用。模型负责选择合适的检查，宿主负责保存事实，不按关键词或固定流程判定完成。

编程任务开始时保存显式 baseline：Git HEAD、已有 staged/unstaged/untracked 清单及必要的内容哈希。最终 diff 标明比较基线和覆盖范围；共享目录中的修改无法可靠归因时继续显示归属未知。高置信归因优先使用独立 worktree。不得自动提交、回滚或覆盖用户已有文件。

用户在目标执行会话中直接输入，沿用现有暂停自动续聊规则；Goal 保留并记录接管事实。取消目标应先暂停其自动派发和 watch，再请求取消相关原生运行；未知停止结果继续保留为未知。

**参考**：可靠工具回执 [R07]、跨机器文件一致性 [R06]。Goal/Verification 的结构是 Kooyu 新设计；本次没有找到可直接证明参考项目提供同等目标验收模型的独立源码。

## 5. 通用工具、搜索与浏览器

### 5.1 主 Agent 的工具装配

在现有 kernel 的基础工具和 Harness 工具之外，为 Kooyu 按会话的工作位置、应用授权与执行环境装配检索、文件、浏览器和应用工具。工具只暴露真实可用能力。未设置工作目录的全局主对话仍可使用明确授权的网络工具、管理目标和受管附件；执行文件或命令前解析明确的 Workspace/Executor，不能采用内部会话目录。

不向原生 Codex/Claude 等强行注入同一工具集。它们沿用各自协议和原生工具；只有适配器明确支持时才传入 MCP/附件配置。外部 Harness 输出不能获得新的用户授权。

建议工具按服务分组：web_search、web_fetch；files 的读取/发布操作；browser 的打开/读取/截图/交互；applications 的列举/调用；goals 的读取/更新/完成；automations 的计划管理。实现时可合并为少量带 action 的工具，避免工具数量膨胀。

### 5.2 搜索与网页读取

建立 WebService，支持已配置的检索 API、模型原生搜索和普通网页提取。独立保存来源 URL、标题、访问时间、片段和原生 requestId；搜索失败与无结果分开。模型声称搜索不算实际搜索执行。

对原生联网 API 按“协议 + 端点 + 模型 + 已确认能力”适配，不能将同一个参数集合发往所有模型。参数降级仅处理确认的“不支持字段”错误并记录实际发送差异，不静默去掉用户指定的关键约束。不跨原生 Harness 自动切模型。

网页抓取限制正文、时间和重定向次数；每次重定向重新检查目标，普通公网抓取不访问 loopback、链路本地、私有管理地址或云元数据服务。确需内网业务连接时通过明确授权的应用或浏览器环境处理。网页正文、搜索结果和文件内容都是来源资料。

**参考**：[WebServices R25][R25] 的多后端入口、原生搜索证据检查、局部成功及可选参数兼容。Kooyu 自行实现协议适配和访问边界，不照搬厂商版本常量。

### 5.3 浏览器先行，完整桌面接管后续接入

首版提供受管 Chromium profile：持久登录、页面结构读取、截图、导航和交互。环境有明确 ID、存储目录、所属用户和状态；用户手动登录时暂停 Agent 的浏览器写入。浏览器自动化后端可替换，首版不同时建设多个后端。

对于缺少连接器的网页工作，模型可使用浏览器执行。发布、提交、删除等动作仍受已有目标授权与具体应用边界约束；授权依据来自用户或已保存策略，不来自网页内容。浏览器登录态不作为模型上下文或导出包内容。

随后增加可选 Linux 桌面执行环境和远程画面：先实现只读观看，再实现“取得控制权 / 交还”。观看票据绑定设备、执行环境和有效期；控制租约另外保存 owner、generation、expiresAt。同一环境同时仅一个写入控制者；用户取得控制权后，节点拒绝旧 generation 的 Agent 输入。

网络分区时不能声称远端已暂停。节点在每次新输入前检查控制 generation 和有期限租约，过期则拒绝；已开始的动作只能尽力取消并核对。节点重启后不恢复旧控制租约。屏幕视频只经过认证代理或隧道，不能公开裸 VNC 端口。

**参考**：[ExecutionNode R04][R04] 的节点配置与探测、[VncTickets R05][R05] 的设备绑定票据、[RemoteBox R06][R06] 的文件完整性检查。完整控制租约是 Kooyu 补充设计；票据校验本身不能证明已有独占控制协议。

## 6. 执行环境与动作回执

Executor 建议字段：id、hostId、name、kind、platform、capabilities、protocolVersion、status、lastSeenAt、credentialRef、revision。kind 为 local、managed-container、remote-worker。能力分别声明 shell、files、browser、desktop-view、desktop-control、harness 及其具体版本，不用单个“可用”掩盖缺失项。

首版 local 复用现有原生适配器；受管执行环境运行独立用户进程，限制可挂载目录，不挂载 Docker socket，不继承 Host 全部环境变量。只有实际运行时限制到位才展示“隔离运行”。普通 stdio 应用进程不宣称沙箱。

远程节点版本中，适配器和原生凭据在节点本地运行与保存，Host 不在服务器上读取本机账号文件。Host 保存代理会话索引，并通过节点协议转发创建、输入、取消、状态、历史与文件请求；需修改 AdapterContext/运行时边界，不能只添加 hostId 字段后就宣布远程 Harness 可用。

对新增的 Host 工具动作建立 ToolActionReceipt，主键由会话、回合、toolCallId 和调用者身份组成，另存规范化参数摘要、执行节点、授权修订、generation 与结果。已有原生 commands 是原生输入唯一回执，不对同一次原生发送另造一套权威记录。

动作状态：accepted → dispatched → confirmed/failed；已派发但结果不明为 unknown。只有未开始或服务商提供稳定幂等键的调用才可自动恢复派发；unknown 的发布、删除、购买、命令执行不盲目重放。进程内调用去重、落盘前后崩溃和远端回执丢失分别测试。

**参考**：[runJournaledTool R07][R07] 的参数指纹、意图先落盘、已完成结果重放及未知结果不重做。Kooyu 使用 SQLite 回执和节点本地执行台账实现，不采用参考项目的 V8 序列化文件格式。

### 6.1 并发、后台工作与恢复

在现有 schedule/drainWakes 调度入口增加执行容量预算，先同步预留，再 await 启动；失败或取消释放预留。预算按 Host/Executor 限制活跃执行，不能只数“已经 running”的会话，否则两个并发启动可能抢到最后一个名额。人工停止、回答和读取结果不经过模型执行队列；需要新模型回合的人工续聊优先于新计划。资源允许时可配置一个预留名额，但总量仍不得超过模型、节点与内存的硬上限。

执行状态分开保存 turnState、backgroundState 和 goalStatus。仅当适配器能观察作业/子运行时才跟踪它们；不支持时显示 unknown，不能将回合结束等同于全部进程退出。持续预览服务等后台资源可以显式交给用户，登记归属和保留期限，避免自动 GC 或下一回合错误接管。取消目标先冻结派发，再按能力停止其拥有的作业，保留停止失败和未确认项。

为工作区准备增加 preparing/ready/failed 记录，保存设置修订和必要检查结果；目录存在不代表准备成功。DSH 的 prepareDirectory 会报告失败，但 launch 仍把已有目录视为已准备，因此 Kooyu 必须补充显式 ready 标记与重新验证，避免残留非空目录跳过准备。

重启先恢复事实并核对原生运行、pending command、后台资源与当前授权。可续接时在同一目标和原生会话中提示检查现有文件、Git 和已发生的外部操作；未知外部写入等待查询或人工处置。暂时性模型错误可有限退避续接模型回合，准备失败/权限失败不自动循环；不把一次模型重试当成重放所有工具动作的许可。

**参考**：[WorkerSlots/DshExecutor D08][D08]、[后台工作 D09][D09]、[Assignments.interrupted D07][D07]、[原型测试 D12][D12]。Kooyu 不照搬 DSH 的子 Agent 管理器，各原生 Harness 的实际可观察/可停止能力仍由适配器声明。

## 7. 定时、Webhook 与事件派发

### 7.1 计划定义与发生记录分开

Automation 保存用户的执行意图；Activation 保存某次触发；Goal 保存此次要完成的工作。先支持一次性时间和 cron，再增加厂商 Webhook。用户说“每天汇报”时创建计划，预览下次运行、时区、执行位置、授权和成本限制，保存后可直接执行已授权任务。

Automation 建议字段：id、revision、name、projectId、controllerSessionId、executorId、promptTemplate、trigger、timeZone、effectiveAt、overlapPolicy、misfirePolicy、grantId、limits、enabled、nextDueAt。

Activation 建议字段：id、automationId、definitionRevision、logicalOccurrenceKey、scheduledFor、receivedAt、payloadRef、payloadDigest、status、goalId、commandId、attempt、lastError。

- 一次性时间存 UTC，重复计划保存 IANA 时区；首次创建时采用用户明确选择的客户端时区并展示，不能直接继承服务器 TZ。
- 默认同一计划 single-flight，错过多个时点合并一次，不逐条补跑。可选 skip；catch-up 暂不开放。
- 夏令时重复本地时刻默认只执行较早的那个，缺失本地时刻跳过；UI 展示未来三次实际运行时间。
- 同一计划的 UTC 发生时点只能有一个 Activation。去重键不含可变 definitionRevision，避免修改提示词后重复执行同一时点；触发记录保存实际采用的修订快照。新触发规则从 effectiveAt 起算，不自动回溯历史。
- 系统计时和到期查询不调用模型；每次真正派发才使用模型。

### 7.2 派发与崩溃恢复

SQLite 同一事务中登记唯一 Activation、创建或关联目标与会话、保存稳定 commandId 及 accepted 命令。事务提交后由现有 SessionService 派发。新建会话及首次发送需要一个公开的原子领域方法，避免“会话已经创建、发生记录尚未保存”的重复创建窗口。

事务前崩溃可重新计算该时点；accepted 可用同一 commandId 继续；dispatched 丢失回执进入 unknown；原生 confirmed 后由事件续接。claim 过期只释放宿主计算权，不能据此重做已经派发的外部动作。Activation 的“已派发/回合结束”与 Goal 的“完成”分别保存。

暂停计划：停止产生新 Activation，未派发的触发失效，现有运行继续且界面明确提示。另提供“停止计划并暂停本次工作”：先增加 dispatchGeneration 并冻结相关未发命令和 watch，再请求原生取消；用户可稍后明确恢复。定时到达不得绕过用户直接输入造成的暂停。

**参考**：[定时器 R08][R08]。该实现先登记 durable claim，重启将未完成 claim 标为 interrupted，默认不重放；Kooyu 保留“结果不明不重做”的原则，同时利用已有事务命令支持已确认尚未派发的恢复。

### 7.3 Webhook 作为单独的外部事件入口

独立路径 /hooks/{connectionId} 只接受已配置来源，不能通过它访问本机管理 API。先实现 GitHub delivery ID + 原始请求体 HMAC 校验，后续增加其他来源适配器和自定义 HMAC。厂商签名字段和时效以官方协议为准。

记录来源、连接 ID、原始 payload 哈希、接收时间和外部 delivery ID。相同来源/连接/ID + 相同正文返回既有接收回执；不同正文返回冲突。通过验签、大小/速率限制与 SQLite 持久提交后返回 202；队列满返回可重试状态，不先确认再丢事件。

事件只绑定预先授权的计划模板及资源范围。Issue 正文等作为有来源的资料传入，不能变成用户指令或授予 shell、发布、停止其他目标的权限。停用连接时取消未派发事件、提高 generation，已运行部分按用户选择暂停或保留。

接入 Relay 时新增专用路由及正文限制，Relay 只转发、Host 完成验签与持久确认；不能把外部 Webhook 转发到受信任桌面 listener。浏览器设备令牌不充当 Webhook 密钥。

**参考**：[Webhooks R09][R09] 与 [桥接 R10][R10] 的验签、事件 ID/正文冲突、队列和运行回执；来源协议和原子派发由 Kooyu 独立设计。

### 7.4 来源身份、授权与后续消息归属

验签仅确认事件确实来自配置的服务。保存 actor、source、resource scope、grantId、grantRevision、目标范围与原始事件身份；只有被允许的操作者直接提出的请求或已保存规则才能开始/扩大工作。CI、机器人、订阅讨论和网页中的引用默认只提供上下文，不能停止别人的任务、改变授权或冒充当前用户。

首版只允许显式请求与已授权的计划，不默认根据事件内容自主接单。后续开放规则触发时使用 off/observe/auto：observe 只保存会做什么，不执行。规则变更、撤销及恢复前重新检查 grant；紧急撤销提高派发 generation，拒绝旧代次的新动作，在途结果继续核对。用户停止不能被后续机器人事件自动恢复；用户可明确恢复原目标或发起新目标。

同一外部会话的后续消息可以关联一个处理它的 Goal；其他目标需要时仅接收带来源的上下文副本。保存 primaryGoalId/处理状态，避免多个 Agent 同时把同一句消息作为新的授权请求。超出范围时交还主对话重新判断，不能静默扩大原目标。Kooyu 的首版采用单一主归属，比 DSH 可由多个 Ticket 拥有的路由更简单。

**参考**：[授权文档 D03][D03]、[Policy D13][D13]、[Intake/订阅分流 D14][D14]。将“接收”“可作为上下文”“授权执行”分开，而不照搬原型的完整业务概念。

### 7.5 提交后工作与原生输入回执

复用 Store.transaction/afterCommit 与已有 commands/wake；只有找不到现有领域记录承载的新投递，才新增小型 dispatch_jobs。每项包含 kind、key、generation、sequence、dueAt、attempts、lastError；只存引用，事实仍归属 Activation、消息或动作回执。运行中同键产生新修订时，旧处理者只可确认自己领取的 generation，不能删除新任务。仅同步“刷新到最新状态”的工作允许合并；两条不同用户消息和两次写操作不能因同一会话而覆盖。

容量不足/暂停记为 deferred，不计执行失败；故障退避与系统健康分别记录。是否能重试由领域动作决定，队列本身只保证工作不被遗忘，不保证外部动作恰好发生一次。持久记录存在但 afterCommit 唤醒丢失时，由启动扫描及周期扫描恢复。

对原生输入分开记录 accepted、dispatched、confirmed 与可选 history-observed。适配器能提供原生消息 ID 和持久 flush 时，先以稳定身份检查待收队列及历史、写入后持久确认；仅内存收到不能当成 durable confirmed。无法提供该能力的 CLI 保持现有保守 unknown 策略。原生事件保留用户、自动续接和工具来源，自动插入的 role=user 文本不因此变成人类授权。

**参考**：[Effects D04][D04]、[Store D05][D05]、[AgentDelivery D06][D06]、[Assignments D07][D07]。已派发工具动作继续遵守第 6 节，不能因 dispatch_jobs 重启而盲目重做。

## 8. 通知、收件箱与移动端

### 8.1 一份事实，多种投递通道

NotificationItem 记录发生的事实；NotificationDelivery 记录投递到哪个设备、通过什么通道、是否被通道接受；InboxItem 继续表示需要用户处理的请求。通知已读、通道已接收和请求已处理是三件事。

新增默认事件：需要审批、需要用户回答、目标受阻、预算暂停、目标待验收、目标完成。普通执行回合完成默认只进入活动记录；用户可以选择额外提醒。只有 Goal 完成事件使用“目标完成”措辞。

在现有事件/收件箱事务内写 NotificationItem 与待派发记录，事务提交后唤醒投递器。事件回放、原生历史导入不再制造通知。每项具有单调递增 notificationSequence；每个 delivery 以 notificationId + deviceId + channel 唯一。

外部通知通常只能保证至少一次尝试。发送成功后、落盘前崩溃可能重复，使用稳定 collapse ID 和客户端去重缓解；不宣称端到端 exactly-once 或“供应商接受就等于用户看到”。

### 8.2 投递策略

- Android 提供可选前台服务 + SSE，参考 [R15]，不依赖 Google 服务；展示持续连接状态并处理网络重连、系统回收和设备撤销。正式分发后可另接系统推送通道。
- iOS 使用 APNs；无对应签名和凭据时可提供用户主动选择的 Bark 通道，参考 [R16]。不把后台 SSE 当作 iOS 稳定推送方案。
- Electron 使用系统通知，Web 可按需增加 Web Push；未配置的通道明确显示不可用。
- 前台抑制以“当前设备正在查看同一会话 + 最近已确认收到该通知”为条件；仅应用打开或 SSE 连接存在不足以永久抑制。attention 类仍保留应用内显著待处理状态。短期确认超时后转后台投递。
- 默认锁屏只展示“Kooyu 需要你处理”，正文预览由用户开启。推送 payload 不含令牌、完整工具输出或外部账号凭据。
- 指数退避带抖动、过期时间和最大尝试次数。设备撤销或令牌轮换后取消旧配置的投递。未解决事项始终保留在 Host 收件箱。
- 以 notificationSequence 续传；游标超过保留窗口时返回 resetRequired 和当前快照，客户端重建未处理事项，不把全历史重新当成新消息。

深链含 hostId、sessionId、inboxItemId/notificationId；打开后先选择已配对 Host 并验证凭据，再读取请求当前状态。深链不携带访问令牌，不直接批准操作。多端批准沿用稳定请求 ID 和原生交互失效机制。

**参考**：[Host 待发箱 R11][R11]、[Notifications R12][R12]、[PushService R13][R13]、[PushTransports R14][R14]、[回复事件判断 R17][R17]。Kooyu 将二段 JSON 存储合并进 SQLite 事务，并加强前台确认、单调游标与数据最小化。

### 8.3 对外回复与手机提醒分别投递

GitHub 评论、飞书消息等是代表用户账号发生的业务动作，另存 outbound_messages，包含稳定 ID、目标/来源事件、连接、目的会话、正文摘要、授权修订、远端消息 ID 与状态。业务记录和待发引用同事务提交，发送前重新检查连接和目标。已撤回的问题不继续发旧问题；连接暂时关闭时等待，目的地明确删除后记为失效。

同一目标到同一外部会话的回复顺序发送；其他会话不被故障阻塞。某条长期失败时显示原因并让用户决定跳过/撤回，不静默发送可能失去上下文的后续回答。服务商支持幂等键时使用稳定 ID；否则先查询可核对的远端身份，无法确认则 unknown，不盲目重发。单纯手机提醒允许客户端去重，不能把相同策略用于重复发布评论。

默认一次接受确认，随后只在结果可用、受阻或需要用户决定时回复原会话。内部进展在活动记录中保留；长任务可由用户开启阶段提醒。结构化问题记录 questionId、版本和解答状态，替换/解决问题后撤回尚未发送的提醒；一次目标状态变化可以产生业务回复和手机提醒，但二者各有投递状态。

**参考**：[Outbox D10][D10] 和 [注意力原则 D02][D02]。Kooyu 加强无幂等 API 的 unknown 处理，并保留现有 Inbox 对原生请求的权威状态。

## 9. 文件、资料与成果

新增受管文件对象 ManagedFile：id、ownerScope、projectId、sessionId、goalId、sha256、size、mediaType、displayName、storageKey、origin、state、createdAt。展示名称与磁盘路径分开，上传文件不能指定任意宿主路径。

上传采用 init → 分块/流式传输 → complete 校验；临时对象未完成时不能进入模型或执行环境。初始单文件上限建议 32 MiB、单次合计 128 MiB，作为可配置产品默认值，发布前经设备和 Relay 负载测试调整。超过限制给出本地文件引用/另行导入选项，不经 JSON base64 无限制堆入内存。

InputMessage 使用 text + attachmentIds 的结构化输入，新增适配器能力：text、image、file-reference。旧 NativeRuntime.send(text,...) 保持兼容，新运行时按能力接收结构化内容。图片只发送给声明支持图片的模型；PDF 按适配器支持的原生文件或受管提取结果传入。提取缺页、扫描件未 OCR、内容截断必须带状态，不能当作完整读取。

Host 与 Executor 不共享磁盘时按哈希同步：not-present → transferring → verified → available；绑定目标执行位置、支持取消和完整性核验。模型只在 available 后获得可读路径。参考 [R24] 的转移和 [R23] 的资料库同步机制，但不采用其绝对目录约定。

首版资料库以项目和目标授权范围组织，提供文件清单、文本提取与全文搜索；先复用 SQLite FTS，不引入向量数据库。会话级附件不能因同一项目而自动对其他会话开放。

生成成果通过 files.publish 复制为不可变快照，保存来源会话/目标、哈希、媒体类型和创建时间。后续文件变更产生新版本，不改变已经交付结果。提供下载、文本/图片/PDF 预览和简短说明；HTML 预览放在禁脚本隔离环境，下载仍需每次检查设备授权。产物快照不可通过任意本机 file URL 读取。

GC 先计算引用再清理无引用对象；待处理审批、活跃目标、计划模板依赖和恢复快照引用的文件不可被会话历史 GC 误删。删除资料后同步清除提取文本和索引，已有外部模型请求和已下载副本的撤回能力另行说明。

**参考**：[Library R22][R22]、[libraryRulesForTurn R23][R23]、[syncTurnAttachments R24][R24]。Kooyu 新增对象引用、不可变成果与结构化消息协议。

## 10. 应用、MCP、技能与授权

### 10.1 应用是可连接的能力单元

首版应用包含名称、图标、说明、工具列表、需要的配置、身份授权、技能与兼容版本。用户流程是“连接 → 授权 → 检查 → 在指定项目/目标使用”。先完成 GitHub 和一种文档/消息系统，验证读写及撤销，再开放任意远程 MCP 和代码应用。

包格式由 Kooyu 独立定义 kooyu-app：schemaVersion、id、version、publisher、runtime、configurationSchema、requestedPermissions、skills、filesManifest。版本不可覆盖；完整内容哈希固定，更新权限扩大时显示差异并重新授权。导出只含包与说明，不含已保存的密钥、用户配置、OAuth token、浏览器登录态或数据库记录。

runtime 依次支持 builtin、remote-mcp、skills-only，后续支持 worker-stdio。技能说明如何使用工具，不授予访问权。声明的 readOnlyHint、network origin 和权限清单只是输入，真正执行权限由 Host/Executor 检查；子进程若未隔离就不能承诺网络/文件硬限制。

### 10.2 授权与生命周期

AuthorizationGrant 绑定 actor、应用版本、工具/操作、资源范围、projectId/goalId、有效期与修订。明确允许一次、允许当前目标或保存为指定资源规则；不将一次批准默认扩大为全部项目永久权限。已有目标范围内可直接复用授权。

OAuth 使用 PKCE、单次有时效 state，绑定发起用户/设备、连接 ID、回调地址与权限修订；回调先消费 state，限制 token endpoint 与重定向。刷新按连接串行，凭据保存在 CredentialVault；撤销或连接删除期间完成的刷新不能重新激活旧授权。

MCP 工具调用前冻结应用版本、授权修订与参数摘要。撤销时提高 generation、停止新调用、关闭相关会话、使待批请求失效；已发出的外部动作保留结果状态并核对。远程 MCP 服务说明属于第三方资料，不能覆盖主 Agent 的身份或权限。

模型可编写应用并调用“验证 / 提交”，但提交仅登记候选包，不自动运行新代码或获得凭据。用户的已保存安装策略可适用于符合范围的包；不存在策略时展示所需权限再启用。

**参考**：[Applications R18][R18]、[应用格式 R19][R19]、[ConnectorOAuth R20][R20]、[MCP 装配 R21][R21]。沿用 Kooyu 凭据引用和技能管理，避免复制另一套 Provider 存储。

## 11. 项目记忆与长期上下文

新增可审阅 MemoryEntry：id、scope、projectId、subject、content、sourceRefs、status、revision、updatedAt。scope 为用户偏好或特定项目；状态为 proposed、confirmed、superseded、deleted。用户明确要求记住的事实可以直接保存为 confirmed；模型从工作中推断的偏好先作为 proposed，不静默升级为用户要求。

主 Agent 开始新回合时加载当前目标相关的已确认摘要，保留来源和版本；需要详细资料时再读取。全局主对话访问项目记忆仍按被选定或授权的项目范围，其他项目内容不因全局身份而全量注入。记忆不保存密码或 API key，凭据继续由 Vault 管理。

文件搜索、原生会话历史、模型上下文压缩和长期记忆各有职责。删除/纠正记忆后使索引及下轮摘要失效；现有已经发送给模型的上下文不能声称远程擦除，后续会话快照使用新修订。

参考项目 README 声明保留原版记忆和上下文能力，其 [恢复存储入口 R27][R27] 依赖外部构建输入。本次没有审阅到完整、可独立验证的记忆抽取和检索实现。因此本节是 Kooyu 自主方案，不能把资料库同步文件当成记忆算法来源。

DSH 的 [src/core/memory.ts D18][D18] 是测试/临时实例用的内存 Repositories，不是长期语义记忆；不能因为文件名含 memory 就当作记忆提取与检索的实现参考。

## 12. 部署、凭据、升级与恢复

### 12.1 一个 Host 只有一个运行所有者

桌面继续使用现有启动器与 Host 锁；服务器使用 systemd 或容器 restart 策略。应用内生命周期管理只协调启动、就绪和排空，不再形成多个互相自动拉起的守护循环。

doctor 检查 Node/原生依赖、数据目录权限、凭据后端、端口/证书、原生 Harness 安装与登录、执行环境、通知通道和备份空间。健康状态区分进程存活、数据库可写、调度可用、执行端可用和模型未验；不把 HTTP 200 当成完整工作成功。

新增 quiesce：同步冻结所有新执行入口，包括用户命令、自动唤醒、计划、Webhook、MCP 和节点动作派发；允许在途结果落盘。返回受保护的 hostId、进程身份、排空 generation、在途数量。仅拿到确认且实际空闲后升级或一致性备份；丢失响应时保持查询，不直接杀进程。超时转为“等待处理”，用户可明确选择停止后再升级。

**参考**：[HostSupervisor R03][R03] 的进程身份检查、忙碌等待、prepare-upgrade 确认；Kooyu 不为普通模型绑定修改重启整个 Host，已有不可变绑定修订继续生效。

### 12.2 服务器凭据必须可落地

现有桌面使用系统 keyring。Linux 无桌面/无 D-Bus 环境不能假定 keyring 可用，新增统一 CredentialVault 接口：桌面系统凭据库后端、服务器加密文件后端。服务器主密钥由受限挂载文件或容器 secret 提供，支持非交互启动、权限检测和轮换；未提供可用密钥则拒绝启用需要秘密的能力，不落明文默认值。

远程节点保存自己的原生登录和密钥；Host 保存节点凭据引用，不导出其账号文件。应用凭据、推送凭据与模型凭据统一按引用隔离。包导出不包含秘密；日志、通知和来源索引不包含秘密。

### 12.3 备份与恢复

备份清单包含产品版本、数据库 schema、协议版本、文件哈希、原生会话存储清单、排除项和凭据恢复策略。首版采用维护窗口：冻结新执行、确认写入者空闲、关闭数据库并保存一致快照；不得只复制正在写的 SQLite 主文件。原生会话仍有外部写入者时单列不可一致备份的目录并要求处理，不假定 UI 空闲意味着所有进程停止。

不承诺所有用户项目目录、模型服务账单、浏览器外部状态或整台系统均已备份。用户可选择导出需要的工作区快照。文件与库备份加密，密钥另存；服务器 Vault 的恢复材料和桌面 keyring 重新授权策略明确列入清单。

恢复到新目录/实例，先检查版本、哈希、路径与引用；默认产生新 Host 身份，撤销旧设备凭据、暂停计划/watch、禁用外部连接，直到用户重新确认。灾难恢复需要保留原身份时，显式迁移身份密钥并确认原实例不再运行，避免两个 Host 执行同一个计划。恢复成功后先做只读完整性检查，再允许执行。

数据库迁移前备份并验证。应用二进制回滚不自动意味着数据库可降级；不兼容时恢复匹配版本备份到新位置，不覆盖运行中的数据。

**参考**：[backup/restore R26][R26] 的校验清单、拒绝覆盖与恢复后不自动启动；Kooyu 增加 SQLite 一致性、凭据和自动运行冻结。

## 13. 数据、API 与代码落点

### 13.1 建议新增存储

继续使用同一个 Host SQLite；文件正文放受管对象目录，数据库保存索引。事务内只进行同步数据库操作，外部网络和文件传输在提交后执行。已有 records 可用于小型偏好；需要唯一性、派发查询与外键的新对象使用专表。

| 表/对象 | 关键约束 |
| --- | --- |
| goals、goal_links、verifications | 修订 CAS；一个链接指向真实会话/watch；状态变化保留历史 |
| automations、activations | unique(automation_id, logical_occurrence_key)；调度与命令持久提交 |
| webhook_connections、webhook_events | unique(connection_id, external_event_id)；同 ID 不同 digest 冲突 |
| notification_items、notification_deliveries | 单调 sequence；unique(notification_id, device_id, channel) |
| outbound_messages、可选 dispatch_jobs | 业务消息 ID 唯一；按目的会话排序；按 generation 条件确认；不可重放未知写入 |
| managed_files、file_refs、artifacts | 不可变哈希；跨目标/会话授权与引用计数 |
| applications、application_versions、app_connections、grants | 应用版本不可变；凭据仅引用；授权 revision/generation |
| memory_entries、memory_revisions | scope + project + provenance；CAS 与删除索引失效 |
| executors、control_leases、tool_action_receipts | 节点和动作稳定身份；独占控制；结果未知不重复写入 |

分阶段迁移；每批迁移保留旧会话与绑定修订，新增字段可空。不要一次创建全部未来模块，也不要复用预算或 watch generation 表示无关的设备控制代次。

### 13.2 API 草案

以下均为拟新增接口；名称与权限在实现时统一，不能视作已有服务。

| 接口组 | 建议接口与权限 |
| --- | --- |
| 目标 | /api/goals、/{id}/verification、/{id}/complete；遵循会话/项目范围，修改带 expectedRevision |
| 自动化 | /api/automations、/{id}/preview、/{id}/pause、/{id}/run；创建/修改需要明确授权，手动运行也生成 Activation |
| 外部事件 | /hooks/{connectionId}；独立来源验签、大小限制；/api/webhooks 管理配置 |
| 通知 | /api/notifications?after=、/events、/{id}/read；/api/devices/{id}/notification-channel 仅管理自身设备或本机管理员 |
| 文件 | /api/files/uploads、/{id}/chunks、/{id}/complete；/api/files/{id}/content、/api/artifacts；每次按文件引用范围鉴权 |
| 应用 | /api/applications、/connections、/oauth/start、/oauth/callback；导入、授权、启用状态分开 |
| 执行环境 | /api/executors、/{id}/test、/{id}/view-ticket、/{id}/control；节点连接使用独立受限 listener |
| 运维 | /internal/quiesce、/resume、/health；仅进程/本机管理通道；恢复和凭据导出不开放给一般手机设备 |

所有需要重试的写操作带稳定 requestId，保存参数摘要和结果；不同正文复用 ID 返回冲突。用户操作可授权后续目标范围内的行动，不把每个服务调用都变成额外审批。

现有协议常量为 2。拟新增 capability/version 协商：先让服务端支持可选能力查询及旧字段，旧客户端继续文本聊天；启用结构化消息等破坏性变化时再升级主版本并提供明确兼容提示。Swift/Kotlin 模型、SSE 解析与未知事件处理必须同步更新；不能单改 TypeScript 类型后宣布五端可用。

### 13.3 建议文件结构

| 模块 | Kooyu 拟新增/修改位置 | 主要参考 |
| --- | --- | --- |
| 目标/验收 | packages/protocol/src/goals.ts；packages/host/src/goals/service.ts；kodo/tools.ts | R07；目标对象为自主设计 |
| 计划与触发 | packages/protocol/src/automations.ts；packages/host/src/automations/{service,scheduler,webhooks}.ts | R08–R10 |
| 可靠通知 | packages/host/src/notifications/{service,delivery,channels}.ts；devices/pairing.ts | R11–R17 |
| 业务回复与可靠派发 | packages/host/src/messaging/outbox.ts；可选 packages/host/src/dispatch/jobs.ts；storage/store.ts、session-service.ts | D04–D07、D10；原生 commands/wake 仍为权威 |
| 授权与执行容量 | packages/host/src/applications/permissions.ts；execution/capacity.ts；session-service.ts | D03、D08、D09、D13、D14 |
| 文件成果 | packages/protocol/src/files.ts；packages/host/src/files/{store,transfer,artifacts}.ts | R06、R22–R24 |
| 通用联网 | packages/host/src/tools/web.ts；kodo/kernel.ts 按授权装配 | R25 |
| 浏览器/执行端 | packages/host/src/execution/{service,local,browser,worker-client}.ts；后续 packages/worker | R04–R07 |
| 应用与 OAuth | packages/host/src/applications/{service,manifest,mcp,oauth,permissions}.ts；configuration/skills.ts | R18–R21 |
| 长期记忆 | packages/host/src/memory/{service,retrieval}.ts；kodo/kernel.ts | 自主设计；R27 仅解释参考边界 |
| Vault/生命周期 | packages/host/src/credentials/{vault,system,file}.ts；lifecycle.ts；main.ts | R03、R26 |
| 迁移与对外入口 | storage/schema.ts、storage/store.ts、http/server.ts；按领域拆出路由 | 复用现有事务/认证 |
| 客户端 | apps/web/src/components；apps/ios/Kooyu；apps/android/app/src/main/java/app/kooyu/android | R15/R16 只参考机制，保留 SwiftUI/Compose |
| 部署 | deploy/kooyu-host；scripts/doctor.mjs、backup.mjs、restore.mjs；系统服务配置 | R03、R26 |

按实际依赖拆分现有 SessionService 的入口，不将所有新模块继续堆在单一文件。领域服务共享 Store 与权限服务，通过现有提交后事件协调；不先建设插件框架或通用分布式队列。

## 14. 用户界面与默认行为

保持项目 → 会话导航。主对话顶部新增“当前目标”，可展开查看范围、完成条件、关联执行会话、成果与验证。状态文案直接区分进行中、等待你、待验收、已完成。首页优先显示真正等待用户处理的事项；健康状态与细粒度中间日志按需展开，参考 [D02]，避免新增对象全部变成一级导航。

“自动化”提供计划、下次运行、最近结果、暂停开关；创建以自然语言进入，保存前展示实际解析的时间/时区、执行位置和授权。暂停计划和停止当前工作是两个明确操作。

“连接应用”显示连接状态、实际工具、授权范围和撤销入口；“执行环境”显示在哪台设备、能做什么、最近在线情况。Provider/模型/Harness 仍在高级设置与会话配置中，普通任务流程只在需要选择时出现。

成果以文件卡片和来源链接呈现；必要时可打开浏览器/桌面画面、取得或交还控制权。手机优先目标摘要、通知、审批、成果与接管，保留现有会话和设置功能。拒绝通知权限不阻止使用，收件箱始终可查看。

### 14.1 首次使用、连接恢复与成本反馈

首次启动按“检查 Host → 配置一个可用模型 → 连接一个工作目录/应用 → 运行一次示例目标 → 测试手机提醒”推进。提供少量内置应用说明和可编辑的研究/周期汇报模板，不要求用户先编写应用包、MCP 配置或复杂提示词。已有实例导入先做只读预检，展示数据、凭据与运行状态的迁移差异，并提供可返回旧实例的备份。

手机断线后自动续传事件并重新读取待处理事项；界面明确区分连接中、离线、Host 不可达和执行端离线。重连不自动重发用户输入；按稳定请求 ID 查询是否已接收。Relay 不等于端到端加密，沿用现有文档的真实边界，不使用“完全私密”概括实际经过中继的明文处理。

每个目标显示已知输入/输出 token、可计算费用、来源和统计覆盖率；原生 Harness 不提供的费用记为未知，不显示伪精确的零。模型/API 自带额度与 Kooyu 预算分开，预算上限复用已有机制。搜索、浏览器或辅助模型调用同样计入目标使用记录，自动路由/审查默认不开启。

上述首次部署、断网恢复与成本反馈为 Kooyu 的补充设计，需分别验收；不代表已在参考项目中复现过相同问题。

## 15. 实施顺序与完成标准

| 阶段 | 交付范围 | 完成标准 |
| --- | --- | --- |
| A：可托付的单 Host 闭环 | Goal/Verification、网页搜索与读取、受管附件和成果、可靠通知、服务器 Vault、提交后派发/容量预算、服务守护与恢复 | 用户离开桌面后任务继续；手机可处理请求并拿到文件；崩溃不重复执行未知动作 |
| B：周期工作 | cron/一次性计划、Activation、GitHub Webhook、GitHub 应用授权/业务回复、来源与 grant、项目记忆 | 计划可审阅暂停；重启/重复事件不重复创建工作；新会话继承有来源的项目约定 |
| C：浏览器工作与远程执行 | 受管浏览器、人工登录/接管、一个远程节点、可选 Linux 桌面观看与控制 | 能完成需要登录的网页任务；断网和控制转交不发生双写；本机凭据留在执行端 |
| D：扩展与分发 | 更多业务应用、代码应用、更多媒体、正式签名与平台发布 | 应用安装/授权/撤销/升级闭环；各平台有独立真实证据 |

浏览器是核心能力：A 阶段可用本机隔离 profile 进行技术验证，正式可托付的登录、控制和远端支持在 C 阶段通过独立验收。若首发场景以网页操作为主，应将 C 的本机浏览器部分移入 A；不因此提前建设多节点调度。

横向发布门槛贯穿各阶段：清理当前完整 UI 回归失败，完成目标平台真机与安装升级验证，维护逐项原生能力矩阵。已有 Harness 的不支持能力继续明确显示；不为扩大宣传而伪造通用取消、steer、费用或后台推送。

暂不纳入首批：自动难度分类选模型、默认模型审查、多人组织 RBAC、多 Host 联邦、应用市场、复杂 DAG、人格 Bot 团队、完整 IDE、实时音视频通话。参考 [模型路由 R28][R28] 和 [自动审查 R29][R29] 作为后续可选研究，不让它们成为每次请求的成本与故障依赖。

## 16. 验收矩阵

以下是拟执行的用例，不代表已通过。协议模拟证明状态机制，真实 Harness、模型、操作系统和设备分别验收；收费调用使用已授权的明确账户。

| ID | 场景 | 必须观察到的结果 |
| --- | --- | --- |
| G01 | 同一目标关联两个 Harness；其中一个回合结束 | 目标仍按验收证据判断，未因回合结束自动完成 |
| G02 | 用户接管/取消，旧 wake 随后到达 | 旧 generation 不再发送；实际停止结果可核对 |
| G03 | 目录原有未提交改动，Agent 再修改文件 | 既有改动保留；成果标注 baseline 和归因范围 |
| G04 | 最后一个名额同时被两个启动请求竞争；人工回答到达 | 不超硬上限；人工交互可处理，续聊按优先策略执行 |
| G05 | 回合结束但后台 job 仍运行；目标停止；准备失败留下非空目录 | 不误报空闲/完成；停止结果真实；残留目录不视为 ready |
| Q01 | 同键派发处理中更新 payload；事务回滚或提交后唤醒丢失 | 旧 generation 不删新任务；回滚不执行；已提交工作可扫描恢复 |
| Q02 | 原生输入已入历史、回执丢失；另一次只进内存便崩溃 | 按适配器真实证据确认/保留 unknown；自动输入不冒充人类授权 |
| A01 | 定时同一时点并发扫描，分别在事务前/后崩溃 | 只有一个 Activation 和稳定命令；未派发可恢复 |
| A02 | 派发后进程崩溃，无可靠执行回执 | unknown 可见；外部写入不自动重做 |
| A03 | 时区变更、夏令时、离线多天、忙碌期间到期 | 按公开的 skip/coalesce/single-flight 策略运行 |
| A04 | 修改计划正文后再次扫描同一时点 | 不因修订变化重复执行；历史记录保留旧修订 |
| H01 | 重复 delivery、同 ID 不同正文、伪造签名和超量请求 | 去重/冲突/拒绝可复现，未授权事件不进入模型 |
| H02 | Issue 正文要求扩大权限或改写目标 | 不获得新授权，不修改其他目标 |
| H03 | observe 模式、撤销授权、机器人续聊已停止目标、一个事件关联多个目标 | 仅观察不执行；旧 grant 拒绝新派发；不自动恢复；只有一个主处理归属 |
| N01 | 通知写入后重启，投递响应丢失 | 待发记录仍在；允许有限重复，客户端按 ID 合并 |
| N02 | 手机前台查看会话 A，后台目标 B 需要审批 | B 仍得到提醒；前台确认超时有回退 |
| N03 | 锁屏、切网络、撤销设备、过期 token | 隐私策略生效；撤销后无法取内容或处理请求 |
| N04 | 两端同时答复同一个原生请求 | 一次有效回应，其余显示已处理或失效 |
| N05 | 对外评论成功但响应丢失；问题已替换；其他会话继续发消息 | 可查询时对账，无法确认时 unknown；旧问题撤回；不同会话互不阻塞 |
| F01 | 图片/PDF/大文件、取消上传、错误哈希 | 未完成文件不可执行；不支持能力明确提示 |
| F02 | Host 与执行端不同文件系统，传输中断 | 哈希校验后才可用；恢复不混入半文件 |
| F03 | 文件路径越界、符号链接、会话间文件访问 | 拒绝越界；项目/会话授权实际生效 |
| P01 | OAuth 回调重复、state 过期、并发刷新中撤销 | 不重复消费或复活旧授权；凭据不泄漏 |
| P02 | 包升级扩大权限；导出已授权应用 | 权限差异可见；包内无用户秘密 |
| P03 | 工具调用结果丢失、重复 toolCallId 参数不同 | 结果重放或冲突；未知外部写入不重放 |
| M01 | 纠正/删除记忆，另一项目开始会话 | 下轮使用新修订；另一项目不泄漏该记忆 |
| E01 | 浏览器人工接管、租约到期、网络分区 | 节点拒绝旧代次新输入；在途动作状态真实 |
| E02 | 执行节点离线，服务器上的计划到期 | 目标明确阻塞；不切到别处重复执行 |
| O01 | quiesce 与用户发送/定时派发并发 | 所有新入口冻结；排空确认前不升级 |
| O02 | 备份后恢复到新实例；原实例仍在线 | 默认暂停自动运行，身份/设备处理符合恢复模式 |
| O03 | 数据库迁移失败、密钥缺失、版本不兼容 | 旧数据不被覆盖；错误清楚且无明文降级 |
| C01 | 协议 v2 旧客户端连接扩展服务端 | 文本路径继续可用或明确拒绝不兼容功能 |
| C02 | Android 后台系统回收与 iOS 真机推送 | 分平台记录投递、点击定位和恢复证据 |
| C03 | 空环境首次部署、凭据不可用、手机重连、费用来源缺失 | 引导能定位失败步骤；稳定请求不重复发送；未知费用明确标记 |

## 17. 源码参考索引

下一节由固定提交源码生成，链接包含文件和已核验行号；每条明确机制与边界。机器可读清单为 [kooyu-self-hosted-agent-sources-2026-11-14.json](kooyu-self-hosted-agent-sources-2026-11-14.json)，记录文件 SHA-256、锚点、Kooyu 落点与本次验证范围。

<!-- SOURCE_REFERENCE_INDEX:BEGIN -->
### 17.1 ProkBot Plus：能力与部署参考

固定提交：`43c6d59e9d9c47c7f4850b7909c41b11f606898a`。下列为机制参考和拟议落点，不表示复制实现。

| 编号 / 机制 | 上游文件与已核验锚点 | 采纳内容与边界 | Kooyu 落点 |
| --- | --- | --- | --- |
| [R01][R01] Host / 执行电脑 / 客户端职责 | `docs/ARCHITECTURE.md`<br>[L7 ## 原理](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/docs/ARCHITECTURE.md#L7-L12) | 拆分控制与执行位置；明确自部署和原生客户端连接路径。<br>边界：描述的是官方程序加补丁的方案；Kooyu 自主实现，不移植官方程序。 | `packages/host/src/main.ts`（现有）<br>`packages/host/src/execution/service.ts`（拟新增） |
| [R02][R02] Host 启动装配 | `host/runtime/host.mjs`<br>[L1 import ](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/runtime/host.mjs#L1-L6) | 按生命周期装配工具、应用、定时与通知服务。<br>边界：不是所有核心功能的独立实现，需结合 R27 看外部输入。 | `packages/host/src/main.ts`（现有） |
| [R03][R03] HostSupervisor / 排空升级 | `host/deploy/host-supervisor.mjs`<br>[L145 async tick()](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/deploy/host-supervisor.mjs#L145-L150)<br>[L193 prepare-upgrade](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/deploy/host-supervisor.mjs#L193-L198) | 验证进程身份、忙碌等待、确认排空后升级。<br>边界：不按单次健康检查失败杀死忙碌进程；Kooyu 采用单运行所有者。 | `packages/host/src/lifecycle.ts`（拟新增）<br>`packages/host/src/main.ts`（现有） |
| [R04][R04] 执行节点配置与探测 | `host/server/execution-node.mjs`<br>[L8 validateExecutionNode](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/server/execution-node.mjs#L8-L13)<br>[L38 class ExecutionNode](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/server/execution-node.mjs#L38-L43) | 节点身份、能力和可用性显式检查。<br>边界：增加 hostId 不代表已经实现跨机器原生 Harness。 | `packages/host/src/execution/service.ts`（拟新增）<br>`packages/host/src/harnesses/adapter.ts`（现有） |
| [R05][R05] 画面访问票据 | `host/server/vnc.mjs`<br>[L40 class VncTickets](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/server/vnc.mjs#L40-L45)<br>[L46 issue(](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/server/vnc.mjs#L46-L51)<br>[L62 validate(](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/server/vnc.mjs#L62-L67) | 设备/环境/到期时间绑定的查看凭据。<br>边界：票据不是独占控制租约，控制 generation 为 Kooyu 新设计。 | `packages/host/src/execution/service.ts`（拟新增） |
| [R06][R06] 远程文件适配 | `host/runtime/remote-box.mjs`<br>[L17 installRemoteBoxAdapter](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/runtime/remote-box.mjs#L17-L22)<br>[L27 downloadFile](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/runtime/remote-box.mjs#L27-L32) | 下载后校验完整性，区分 Host 与执行环境路径。<br>边界：不采用其固定目录或假定所有节点共享磁盘。 | `packages/host/src/files/transfer.ts`（拟新增）<br>`packages/host/src/execution/worker-client.ts`（拟新增） |
| [R07][R07] 工具动作日志 | `host/runtime/reliability/tool-journal.mjs`<br>[L86 runJournaledTool](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/runtime/reliability/tool-journal.mjs#L86-L91)<br>[L100 async function runAdmitted](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/runtime/reliability/tool-journal.mjs#L100-L105) | 参数指纹、意图先落盘、结果重放、unknown 不盲目重做。<br>边界：不复制其 V8 文件台账；原生 commands 仍是唯一发送回执。 | `packages/host/src/execution/service.ts`（拟新增）<br>`packages/host/src/storage/store.ts`（现有） |
| [R08][R08] 自动化领取与恢复 | `host/runtime/host-automations.mjs`<br>[L61 decorateLocalHostAutomations](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/runtime/host-automations.mjs#L61-L66)<br>[L161 async function scanOnce](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/runtime/host-automations.mjs#L161-L166)<br>[L141 function dispatch(](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/runtime/host-automations.mjs#L141-L146) | 持久领取、同计划单实例、错过合并、终止记录。<br>边界：原型 claimed 重启转 interrupted；Kooyu 原子关联 accepted command。 | `packages/host/src/automations/service.ts`（拟新增）<br>`packages/host/src/automations/scheduler.ts`（拟新增）<br>`packages/host/src/session-service.ts`（现有） |
| [R09][R09] Webhook 接收台账 | `host/server/webhooks.mjs`<br>[L10 webhookSignature](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/server/webhooks.mjs#L10-L15)<br>[L59 receive(](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/server/webhooks.mjs#L59-L64)<br>[L92 claim(](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/server/webhooks.mjs#L92-L97)<br>[L113 finish(](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/server/webhooks.mjs#L113-L118) | 验签、外部事件 ID 与正文摘要去重、领取/完成记录。<br>边界：自定义 HMAC 不能直接代替服务商原生签名；验签不授予业务权限。 | `packages/host/src/automations/webhooks.ts`（拟新增） |
| [R10][R10] Webhook 到自动化桥接 | `host/runtime/host-webhooks.mjs`<br>[L7 startLocalWebhooks](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/runtime/host-webhooks.mjs#L7-L12)<br>[L21 ensureAutomation](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/runtime/host-webhooks.mjs#L21-L26) | 将事件入口与具体任务执行分开。<br>边界：Kooyu 另外解决事件、目标、命令的事务一致性。 | `packages/host/src/automations/webhooks.ts`（拟新增）<br>`packages/host/src/automations/service.ts`（拟新增） |
| [R11][R11] 会话事件到通知待发箱 | `host/runtime/host-notifications.mjs`<br>[L14 startLocalNotifications](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/runtime/host-notifications.mjs#L14-L19) | 从真实回复/请求事件产生通知。<br>边界：历史导入/回放不产生新通知；改用现有 SQLite 事务。 | `packages/host/src/notifications/service.ts`（拟新增）<br>`packages/host/src/session-service.ts`（现有） |
| [R12][R12] 通知保存与订阅 | `host/server/notifications.mjs`<br>[L6 class Notifications](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/server/notifications.mjs#L6-L11)<br>[L25 publish(](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/server/notifications.mjs#L25-L30)<br>[L84 subscribe(](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/server/notifications.mjs#L84-L89) | 保存通知并供订阅读取。<br>边界：Kooyu 增加单调游标、重置快照和已读/处理状态区分。 | `packages/host/src/notifications/service.ts`（拟新增）<br>`packages/host/src/http/server.ts`（现有） |
| [R13][R13] 设备推送待发箱 | `host/server/push-service.mjs`<br>[L13 class PushService](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/server/push-service.mjs#L13-L18)<br>[L57 register(](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/server/push-service.mjs#L57-L62)<br>[L166 enqueue(](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/server/push-service.mjs#L166-L171)<br>[L193 async flush(](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/server/push-service.mjs#L193-L198)<br>[L228 async settle(](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/server/push-service.mjs#L228-L233) | 设备指纹、注册/撤销、持久待发、退避与终止。<br>边界：供应商接受不等于用户已见；无法保证端到端恰好一次。 | `packages/host/src/notifications/delivery.ts`（拟新增）<br>`packages/host/src/devices/pairing.ts`（现有） |
| [R14][R14] 推送通道适配 | `host/server/push-transports.mjs`<br>[L22 class PushTransports](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/server/push-transports.mjs#L22-L27)<br>[L27 bark(](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/server/push-transports.mjs#L27-L32)<br>[L70 apns(](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/server/push-transports.mjs#L70-L75) | 统一 APNs 与用户自选通道的投递接口。<br>边界：真实签名、账号和设备投递须单独验收。 | `packages/host/src/notifications/channels.ts`（拟新增） |
| [R15][R15] Android 前台通知连接 | `android/shell/app/src/main/java/dev/grokbot/local/Notifications.kt`<br>[L108 class NotificationService](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/android/shell/app/src/main/java/dev/grokbot/local/Notifications.kt#L108-L113)<br>[L191 fun stream](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/android/shell/app/src/main/java/dev/grokbot/local/Notifications.kt#L191-L196) | 前台服务、SSE 重连、本地通知及状态展示。<br>边界：不绕过系统电池/进程限制；Kooyu 保留 Compose 客户端。 | `apps/android/app/src/main/java/app/kooyu/android`（现有） |
| [R16][R16] iOS 推送注册与点击定位 | `ios/clients/ios/GBPush.m`<br>[L169 @implementation GBPushDelegate](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/ios/clients/ios/GBPush.m#L169-L174)<br>[L211 static void GBRegistered(](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/ios/clients/ios/GBPush.m#L211-L216)<br>[L414 registerForRemoteNotifications](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/ios/clients/ios/GBPush.m#L414-L419) | 设备 token 注册、推送委托、进入目标会话。<br>边界：原型为 ObjC 补丁机制；Kooyu 在 SwiftUI 中独立实现，后台 SSE 不替代 APNs。 | `apps/ios/Kooyu`（现有） |
| [R17][R17] 回复事件筛选 | `host/runtime/reply-notifier.mjs`<br>[L6 createReplyNotifier](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/runtime/reply-notifier.mjs#L6-L11) | 识别可通知的最终回复而非所有输出片段。<br>边界：普通回合结束不等于 Goal 完成；Kooyu 使用领域事件。 | `packages/host/src/notifications/service.ts`（拟新增） |
| [R18][R18] 应用包安装与导出 | `host/server/applications.mjs`<br>[L16 class Applications](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/server/applications.mjs#L16-L21)<br>[L34 check(name === 'submit_application'](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/server/applications.mjs#L34-L39)<br>[L50 export(](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/server/applications.mjs#L50-L55) | 验证、提交、列举、版本和无凭据导出。<br>边界：应用声明与实际运行隔离分开；先验证少量内置应用。 | `packages/host/src/applications/service.ts`（拟新增）<br>`packages/host/src/applications/manifest.ts`（拟新增） |
| [R19][R19] 应用格式与授权流程 | `host/server/application-guide.md`<br>[L12 ## Package](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/server/application-guide.md#L12-L17)<br>[L33 ## OAuth](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/server/application-guide.md#L33-L38)<br>[L41 ## Skills](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/server/application-guide.md#L41-L45) | 工具、配置、OAuth、技能在一个连接单元内组织。<br>边界：参考包格式属于其实现；Kooyu 独立定义 kooyu-app，技能不授予权限。 | `packages/host/src/applications/manifest.ts`（拟新增）<br>`packages/host/src/configuration/skills.ts`（现有） |
| [R20][R20] OAuth 连接生命周期 | `host/server/connectors-oauth.mjs`<br>[L11 class ConnectorOAuth](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/server/connectors-oauth.mjs#L11-L16)<br>[L22 begin(](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/server/connectors-oauth.mjs#L22-L27)<br>[L126 complete(](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/server/connectors-oauth.mjs#L126-L131)<br>[L175 headers(](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/server/connectors-oauth.mjs#L175-L180) | 回调校验、凭据分离、并发刷新去重与连接撤销。<br>边界：按实际服务商协议实现；刷新在途与撤销通过修订检查协调。 | `packages/host/src/applications/oauth.ts`（拟新增）<br>`packages/host/src/applications/permissions.ts`（拟新增） |
| [R21][R21] MCP 授权及装配 | `host/runtime/host-mcp.mjs`<br>[L44 startLocalHostMcp](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/runtime/host-mcp.mjs#L44-L49) | 按实际连接暴露工具；先校验意图及权限再调用。<br>边界：MCP 注解只是提示；普通 stdio 子进程不是沙箱。 | `packages/host/src/applications/mcp.ts`（拟新增）<br>`packages/host/src/kodo/kernel.ts`（现有） |
| [R22][R22] 资料库文件服务 | `host/server/library.mjs`<br>[L135 class Library](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/server/library.mjs#L135-L140)<br>[L123 listAgentLibraryFiles](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/server/library.mjs#L123-L128)<br>[L204 upload(](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/server/library.mjs#L204-L209) | 受管文件索引、上传、列举与执行端同步入口。<br>边界：Kooyu 补充 scope、引用和不可变成果，资料库不等于记忆算法。 | `packages/host/src/files/store.ts`（拟新增）<br>`packages/host/src/files/artifacts.ts`（拟新增） |
| [R23][R23] 资料库到回合文件同步 | `host/runtime/host-library-files.mjs`<br>[L22 libraryRulesForTurn](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/runtime/host-library-files.mjs#L22-L27) | 让 Agent 获得执行位置确实可读的文件路径。<br>边界：按哈希及同步状态核对，不沿用绝对路径约定。 | `packages/host/src/files/transfer.ts`（拟新增）<br>`packages/host/src/kodo/kernel.ts`（现有） |
| [R24][R24] 回合附件传输 | `host/runtime/host-attachments.mjs`<br>[L8 syncTurnAttachments](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/runtime/host-attachments.mjs#L8-L13) | 将附件同步与模型输入准备关联。<br>边界：结构化附件和适配器能力由 Kooyu 自行扩展，不能只转成提示文本。 | `packages/host/src/files/transfer.ts`（拟新增）<br>`packages/host/src/harnesses/adapter.ts`（现有）<br>`apps/web/src/components/TextAttachments.tsx`（现有） |
| [R25][R25] 搜索后端与原生联网响应 | `host/runtime/web-services.mjs`<br>[L67 class WebServices](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/runtime/web-services.mjs#L67-L72)<br>[L20 nativeResponse](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/runtime/web-services.mjs#L20-L25)<br>[L33 nativeAnthropic](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/runtime/web-services.mjs#L33-L38) | 按协议适配搜索，保留来源及实际联网证据，处理部分成功。<br>边界：不复制厂商常量；降级不静默移除用户关键约束。 | `packages/host/src/tools/web.ts`（拟新增）<br>`packages/host/src/kodo/kernel.ts`（现有） |
| [R26][R26] 备份与拒绝覆盖恢复 | `host/release/backup.py`<br>[L31 def backup(](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/release/backup.py#L31-L36)<br>[L71 def restore(](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/release/backup.py#L71-L76) | 哈希清单、恢复校验、新目录恢复与不自动启动。<br>边界：Kooyu 补齐 SQLite、原生历史写入者、Vault 和自动化冻结。 | `scripts/backup.mjs`（拟新增）<br>`scripts/restore.mjs`（拟新增）<br>`packages/host/src/lifecycle.ts`（拟新增） |
| [R27][R27] 恢复核心装配边界 | `host/runtime/recovered-host-core.mjs`<br>[L18 loadRecoveredHostCore](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/runtime/recovered-host-core.mjs#L18-L23) | 识别外部输入、包装与真正实现的边界。<br>边界：不能据此宣称审阅了完整原版记忆/上下文内部算法。 | `packages/host/src/kodo/kernel.ts`（现有） |
| [R28][R28] 模型路由可选研究 | `host/runtime/model-router.mjs`<br>[L49 createModelRouter](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/runtime/model-router.mjs#L49-L54)<br>[L20 classifyTask](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/runtime/model-router.mjs#L20-L25) | 只记录作为后续可选能力，保留现有显式模型绑定。<br>边界：分类含外部调用和成本；不作为所有请求必经路径。 | `packages/host/src/kodo/kernel.ts`（现有） |
| [R29][R29] 自动审查可选研究 | `host/runtime/host-auto-review.mjs`<br>[L98 createLocalClassifier](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/runtime/host-auto-review.mjs#L98-L103)<br>[L143 startLocalAutoReview](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/runtime/host-auto-review.mjs#L143-L148) | 保留结构化审查结果与失败显式处理的思路。<br>边界：默认不开启，审查模型不能扩大授权，也不代替验证事实。 | `packages/host/src/applications/permissions.ts`（拟新增） |
| [R30][R30] ProkBot 许可边界 | `LICENSE`<br>[L18 2. Noncommercial permission](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/LICENSE#L18-L23)<br>[L32 3. Commercial use prohibited](https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/LICENSE#L32-L37) | 记录源码研究及后续复用边界。<br>边界：限制包含企业内部商业操作；本次不复制代码/补丁/资源，不作法律结论。 | `docs/kooyu-self-hosted-agent-design-2026-11-14.md`（现有） |

### 17.2 DSH：授权与执行可靠性参考

固定提交：`8c32a9dc5d72c033816c6a8110b37f40cf94fba4`。源码和测试分开标明；测试仅作断言参考。

| 编号 / 机制 | 上游文件与已核验锚点 | 采纳内容与边界 | Kooyu 落点 |
| --- | --- | --- | --- |
| [D01][D01] 研究原型的真实范围 | `README.md`<br>[L1 # dsh-superagent](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/README.md#L1-L6) | 确认单 GitHub 仓库、DeepSeek Harness 依赖与 GitHub/飞书来源。<br>边界：非正式产品；文章的未来设计不视作源码已实现。 | `docs/kooyu-self-hosted-agent-design-2026-11-14.md`（现有） |
| [D02][D02] 减少人工注意力 | `docs/000-philosophy.md`<br>[L9 ## What follows for the agent](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/docs/000-philosophy.md#L9-L14)<br>[L17 ## What follows for the design](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/docs/000-philosophy.md#L17-L22) | 一次确认、结果/阻塞/问题再沟通；界面优先待处理事项。<br>边界：进度仍可查询，真实失败和限制不能静默隐藏。 | `apps/web/src/components`（现有）<br>`packages/host/src/notifications/service.ts`（拟新增） |
| [D03][D03] 来源、授权与订阅上下文 | `docs/002-authorization.md`<br>[L7 ## Two paths for a Trigger](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/docs/002-authorization.md#L7-L12)<br>[L91 ## Accept mode and rules](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/docs/002-authorization.md#L91-L96)<br>[L131 ### Revalidation before resume](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/docs/002-authorization.md#L131-L136) | 显式请求/规则授权；只观察模式；恢复前重新验证。<br>边界：不照搬陌生人续聊策略和全套 Eval/Decision/Ticket 业务。 | `packages/host/src/applications/permissions.ts`（拟新增）<br>`packages/host/src/automations/webhooks.ts`（拟新增） |
| [D04][D04] SQLite 持久派发 | `src/app/effects.ts`<br>[L46 export class Effects](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/app/effects.ts#L46-L51)<br>[L61 enqueue<K](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/app/effects.ts#L61-L66)<br>[L130 private async attempt](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/app/effects.ts#L130-L135) | 同键合并、generation 条件确认、限流、退避、暂停和健康。<br>边界：队列不等于外部动作恰好一次；不覆盖不同用户消息/写操作。 | `packages/host/src/storage/store.ts`（现有）<br>`packages/host/src/session-service.ts`（现有）<br>`packages/host/src/dispatch/jobs.ts`（拟新增） |
| [D05][D05] 嵌套事务和提交后操作 | `src/app/store.ts`<br>[L140 atomic<T>](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/app/store.ts#L140-L145)<br>[L159 afterCommit(](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/app/store.ts#L159-L164) | 外层提交后执行回调，回滚丢弃对应回调。<br>边界：Kooyu 已有 Store.transaction/afterCommit，不引入第二个 Store。 | `packages/host/src/storage/store.ts`（现有） |
| [D06][D06] 会话输入去重与持久确认 | `src/app/delivery.ts`<br>[L31 export class AgentDelivery](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/app/delivery.ts#L31-L36)<br>[L61 async holds(](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/app/delivery.ts#L61-L66)<br>[L66 async send(](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/app/delivery.ts#L66-L71) | 稳定消息身份、pending/history 核对、flush 后确认、保留生产者身份。<br>边界：只对实际具备持久原生 ID 能力的适配器承诺；不是工具副作用去重。 | `packages/host/src/session-service.ts`（现有）<br>`packages/host/src/harnesses/adapter.ts`（现有） |
| [D07][D07] 运行恢复与输入消费 | `src/core/assignments.ts`<br>[L83 interrupted(](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/core/assignments.ts#L83-L88)<br>[L60 read(](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/core/assignments.ts#L60-L65)<br>[L99 report(](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/core/assignments.ts#L99-L104) | 区分 delivered/read/turnEnded；忙碌重启提示检查真实外部状态。<br>边界：恢复说明不替代动作回执；不能把模型报告自动算作验证通过。 | `packages/host/src/session-service.ts`（现有）<br>`packages/host/src/goals/service.ts`（拟新增） |
| [D08][D08] 容量、准备、停止与恢复 | `src/executor/dsh.ts`<br>[L171 export class WorkerSlots](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/executor/dsh.ts#L171-L176)<br>[L247 private async prepareDirectory(](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/executor/dsh.ts#L247-L252)<br>[L435 if (!await stat(workspace)](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/executor/dsh.ts#L435-L440)<br>[L391 async shutdown()](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/executor/dsh.ts#L391-L396)<br>[L524 resume(): void](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/executor/dsh.ts#L524-L529) | await 前预留名额，人工续聊优先，停止旧运行后再续接。<br>边界：已有目录视为 prepared 的分支需补强；额外名额与时限不照搬。 | `packages/host/src/session-service.ts`（现有）<br>`packages/host/src/execution/capacity.ts`（拟新增）<br>`packages/host/src/harnesses/adapter.ts`（现有） |
| [D09][D09] 后台工作生命周期 | `src/executor/background.ts`<br>[L96 export async function untilQuiet](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/executor/background.ts#L96-L101)<br>[L159 export async function stopBackground](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/executor/background.ts#L159-L164) | 跟踪仍运行 job/子会话，停机时处理所属后台工作。<br>边界：依赖 DSH 的原生能力；Kooyu 按适配器分别提供，未观测不等于退出。 | `packages/host/src/harnesses/adapter.ts`（现有）<br>`packages/host/src/execution/service.ts`（拟新增） |
| [D10][D10] 外部业务消息待发箱 | `src/app/outbox.ts`<br>[L22 export class Outbox](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/app/outbox.ts#L22-L27)<br>[L27 send(message:](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/app/outbox.ts#L27-L32)<br>[L39 private async deliver(](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/app/outbox.ts#L39-L44) | 回执与派发原子提交、目的会话排序、撤回与永久失效记录。<br>边界：响应丢失不一定安全重试；Kooyu 增加服务商幂等/查询和 unknown 策略。 | `packages/host/src/messaging/outbox.ts`（拟新增）<br>`packages/host/src/storage/store.ts`（现有） |
| [D11][D11] DSH MIT 许可 | `LICENSE`<br>[L1 MIT License](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/LICENSE#L1-L6) | 若后续实际复制实现，保留版权与许可。<br>边界：许可不说明该研究原型已经过生产验证；本次没有复制实现。 | `docs/kooyu-self-hosted-agent-design-2026-11-14.md`（现有） |
| [D12][D12] 并发/消费/停止的测试契约 | `tests/runtime-concurrency.spec.ts`<br>[L853 holds one worker slot per ticket](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/tests/runtime-concurrency.spec.ts#L853-L858)<br>[L670 counts a delivered message as read only once](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/tests/runtime-concurrency.spec.ts#L670-L675)<br>[L573 stops every worker](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/tests/runtime-concurrency.spec.ts#L573-L578) | 将争抢名额、后台占用、截断消费与停机转换为 Kooyu 验收用例。<br>边界：只阅读测试断言；未运行上游测试，不宣称实际通过。 | `docs/kooyu-self-hosted-agent-design-2026-11-14.md`（现有） |
| [D13][D13] 授权入口与修订重验代码 | `src/policy.ts`<br>[L167 export function settingsPolicy](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/policy.ts#L167-L172)<br>[L213 revalidate(mandate:](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/policy.ts#L213-L218)<br>[L116 export function policyVersion](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/policy.ts#L116-L121) | 来源身份、机器人规则、授权修订、恢复前权限复核。<br>边界：Kooyu 使用已有目标/连接范围；不复制模型评估规则和默认接单语义。 | `packages/host/src/applications/permissions.ts`（拟新增） |
| [D14][D14] 订阅分流与处理归属 | `src/core/intake.ts`<br>[L16 export class Intake](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/core/intake.ts#L16-L21)<br>[L19 receive(received:](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/core/intake.ts#L19-L24) | 事件去重、context-only 分流、停止后不被机器人恢复。<br>边界：DSH 允许多 Ticket 处理关系；Kooyu 初版单一主归属更简单。 | `packages/host/src/automations/webhooks.ts`（拟新增）<br>`packages/host/src/goals/service.ts`（拟新增） |
| [D15][D15] 派发的事务/修订/停机测试 | `tests/effects.spec.ts`<br>[L29 runs an effect queued inside a transaction](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/tests/effects.spec.ts#L29-L34)<br>[L39 keeps one effect per key](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/tests/effects.spec.ts#L39-L44)<br>[L105 starts nothing once drained](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/tests/effects.spec.ts#L105-L110) | 覆盖回滚不派发、运行中换代、关闭保留待发工作。<br>边界：静态用例参考，未运行上游测试。 | `docs/kooyu-self-hosted-agent-design-2026-11-14.md`（现有） |
| [D16][D16] 输入去重测试 | `tests/delivery.spec.ts`<br>[L36 deduplicating pending and consumed messages](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/tests/delivery.spec.ts#L36-L41)<br>[L89 retries a failed durability barrier](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/tests/delivery.spec.ts#L89-L94) | 覆盖 pending、历史、恢复及来源身份，不改写已有消息。<br>边界：测试 fixture 不证明所有真实 Harness 支持相同语义。 | `docs/kooyu-self-hosted-agent-design-2026-11-14.md`（现有） |
| [D17][D17] 业务回复暂停与连接恢复测试 | `tests/outbox.spec.ts`<br>[L17 holds every message while processing is paused](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/tests/outbox.spec.ts#L17-L22)<br>[L30 Source that is not installed](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/tests/outbox.spec.ts#L30-L35) | 覆盖暂停、来源未安装等可延期状态。<br>边界：不证明服务商端到端恰好一次投递。 | `docs/kooyu-self-hosted-agent-design-2026-11-14.md`（现有） |
| [D18][D18] 内存测试仓库的参考边界 | `src/core/memory.ts`<br>[L10 export class MemoryRepositories](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/core/memory.ts#L10-L15) | 识别 Map 备份及测试回滚语义，避免误认为语义记忆实现。<br>边界：不是长期记忆的抽取、压缩或检索算法来源。 | `packages/host/src/memory/service.ts`（拟新增） |

### 17.3 验收用例与上游断言的对应关系

| Kooyu 验收 | 参考断言 | Kooyu 增加的检查 |
| --- | --- | --- |
| Q01（派发） | [D15] 的事务回滚、同键 payload 更新、drain 后保留 | 唤醒丢失后的周期扫描、领域动作重试边界 |
| Q02（输入） | [D16] 的 pending/history 去重；[D12] 的截断 step 消费 | 按真实适配器分别验收 durable confirmed 与 unknown |
| G04/G05（执行） | [D12] 的容量竞争、后台 job、停止与恢复 | 硬上限、跨节点状态和非空准备残留 |
| N05（业务回复） | [D17] 的暂停与来源安装；[D10] 的顺序与撤回 | 无幂等 API 的响应丢失、跨会话互不阻塞 |

以上只是设计追溯，未运行参考仓库测试，也未将其中用例直接计入 Kooyu 的通过数。

### 17.4 校验与使用说明

- sha256 基于固定提交的原始文件字节；ProkBot 与下载清单交叉核对，DSH 从固定 Git 对象读取。
- 行号针对该提交，不跟随 main 漂移；同一项的多个锚点用于定位入口及关键处理分支。
- Kooyu 的“现有/拟新增”按调研时工作区路径标识；现有文件并不意味着本方案中的新增行为已经实现。
- kooyu_baseline 保存调研时工作区文件指纹；这些文件可能含用户原有未提交改动，不作为本轮交付。
- .local/research 中的参考副本与生成脚本仅用于研究，不作为产品源码或本次提交内容。

### 17.5 固定源码链接

[R01]: https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/docs/ARCHITECTURE.md#L7-L12
[R02]: https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/runtime/host.mjs#L1-L6
[R03]: https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/deploy/host-supervisor.mjs#L145-L150
[R04]: https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/server/execution-node.mjs#L8-L13
[R05]: https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/server/vnc.mjs#L40-L45
[R06]: https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/runtime/remote-box.mjs#L17-L22
[R07]: https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/runtime/reliability/tool-journal.mjs#L86-L91
[R08]: https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/runtime/host-automations.mjs#L61-L66
[R09]: https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/server/webhooks.mjs#L10-L15
[R10]: https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/runtime/host-webhooks.mjs#L7-L12
[R11]: https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/runtime/host-notifications.mjs#L14-L19
[R12]: https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/server/notifications.mjs#L6-L11
[R13]: https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/server/push-service.mjs#L13-L18
[R14]: https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/server/push-transports.mjs#L22-L27
[R15]: https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/android/shell/app/src/main/java/dev/grokbot/local/Notifications.kt#L108-L113
[R16]: https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/ios/clients/ios/GBPush.m#L169-L174
[R17]: https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/runtime/reply-notifier.mjs#L6-L11
[R18]: https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/server/applications.mjs#L16-L21
[R19]: https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/server/application-guide.md#L12-L17
[R20]: https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/server/connectors-oauth.mjs#L11-L16
[R21]: https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/runtime/host-mcp.mjs#L44-L49
[R22]: https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/server/library.mjs#L135-L140
[R23]: https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/runtime/host-library-files.mjs#L22-L27
[R24]: https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/runtime/host-attachments.mjs#L8-L13
[R25]: https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/runtime/web-services.mjs#L67-L72
[R26]: https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/release/backup.py#L31-L36
[R27]: https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/runtime/recovered-host-core.mjs#L18-L23
[R28]: https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/runtime/model-router.mjs#L49-L54
[R29]: https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/host/runtime/host-auto-review.mjs#L98-L103
[R30]: https://github.com/ferretgeek/prokbot-plus/blob/43c6d59e9d9c47c7f4850b7909c41b11f606898a/LICENSE#L18-L23
[D01]: https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/README.md#L1-L6
[D02]: https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/docs/000-philosophy.md#L9-L14
[D03]: https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/docs/002-authorization.md#L7-L12
[D04]: https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/app/effects.ts#L46-L51
[D05]: https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/app/store.ts#L140-L145
[D06]: https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/app/delivery.ts#L31-L36
[D07]: https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/core/assignments.ts#L83-L88
[D08]: https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/executor/dsh.ts#L171-L176
[D09]: https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/executor/background.ts#L96-L101
[D10]: https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/app/outbox.ts#L22-L27
[D11]: https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/LICENSE#L1-L6
[D12]: https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/tests/runtime-concurrency.spec.ts#L853-L858
[D13]: https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/policy.ts#L167-L172
[D14]: https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/core/intake.ts#L16-L21
[D15]: https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/tests/effects.spec.ts#L29-L34
[D16]: https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/tests/delivery.spec.ts#L36-L41
[D17]: https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/tests/outbox.spec.ts#L17-L22
[D18]: https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/core/memory.ts#L10-L15

<!-- SOURCE_REFERENCE_INDEX:END -->
