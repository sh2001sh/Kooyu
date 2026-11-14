# 代码骨架设计与现有文件交接

更新日期：2026-11-11。本文记录模块蓝图与当前落地；保留并完善既有协议/Host 初稿。构建结果和真实验证以 implementation-status.md 为准。

先读 [总体设计](design.md)；会话归属以 [会话模型](session-model.md) 为准；功能范围以 [功能设计](product-features.md) 和 [10 种 harness 清单](harness-catalog.md) 为准。交接使用 [实现 prompt](implementation-prompt.md)。

## 1. 当前仓库状态

以 [实现与验收状态](implementation-status.md) 为准；下面模块均位于保留初稿上继续完善，没有恢复旧架构。

| 模块 | 当前实际状态 |
| --- | --- |
| 根工程 | npm workspace/完整锁文件、构建/类型检查（含 Host 测试）/ESLint/Prettier/测试/CI；本机检查通过，远端 CI 未运行 |
| protocol | 共享会话、命令、事件、管理、usage/绑定 与校验；浏览器常量独立入口 |
| host/storage | v1→v5 SQLite 迁移（Kodo 身份、trigram 搜索与旧配置清理）、WAL、事务、native identity、commands/events/watch/wake/FTS/records |
| session-service | 原生连接/递送、去重/对账、用户接管、generation、恢复、预算与范围限制；模型设置修订/回执、待发修改/立即发送、停止 fence |
| http/devices/configuration/workspaces | 公共 API/SSE 增量游标/历史分页、配对/到期/撤销、系统凭据库/引用清理、绑定修订、Git/worktree/预览 |
| harnesses | 10 种 transport 实现；ZCode 按固定提交补全 wire v3 分片与 v4 投影；实机验证见矩阵 |
| Kodo / pi | 两个独立身份共用 SDK + SessionManager + 原生 loop；Kodo 装配六工具，pi 保留基础工具 |
| host/test | 当前领域/设备/配置/隔离协议测试 137/137 通过；synthetic peer 不作真实集成证据 |
| apps/web | React/PWA 工作台、桌面/手机两视口和真实 Codex 输出验证通过 |
| apps/desktop | Electron、独立 Host 启动/发现、托盘；构建及本机窗口/隐藏/重开/退出 UI 后 Host 保持运行通过；打包仍待验收 |
| vendor/pi | 固定上游保持原样；运行选发布版 1.5.2，见 upstream.md |

以下仍是目标目录和职责设计；文件数量和后续边界不等同于实际验收。用户清理旧实现和原有暂存更改均保留。

## 2. 目标目录与模块职责

下方列出当前实际结构。控制关系、watch/wake、递送和 usage 目前共同实现于 SessionService，继续共享 SQLite 事务，不为每个领域新增独立服务。Web 功能目前以轻量工作台和表现组件组织，后续可按规模拆分。

~~~text
apps/
  desktop/
    src/main.ts                       窗口、托盘、退出和停止全部
    src/host-client.ts                发现/连接/启动独立 Node Host
    assets/tray.png                   带来源记录的产品图标
  web/
    src/main.tsx                      项目/会话、聊天、托管、健康、预算、设备
    src/components/                   消息、原生恢复、成果、绑定 编辑与默认值
    src/lib/host-client.ts            桌面/手机共用命令、结果未知时查询回执
    src/styles/                       Craft 提取 tokens 与本产品样式
    public/                           PWA shell，仅缓存界面资源
    test/                             桌面/手机视口浏览器验收

packages/
  protocol/src/
    index.ts                          命令/事件、校验、配置与类型
    client.ts                         不含 Node/Zod 的客户端常量
  host/src/
    main.ts                           独立 Host 入口与进程锁
    session-service.ts               会话、递送、控制权、watch/wake、usage
    domain/session-rules.ts           项目范围与确定性约束
    http/server.ts                    同一查询/命令/事件 API
    storage/                          SQLite 迁移、事务、命令/事件/投影
    harnesses/                        10 种原生路径、ACP、JSON-RPC、ZCode 帧
    pi/                               SDK、SessionManager、六工具、凭据桥接
    configuration/                  Provider、模型库、绑定修订、实例环境与凭据引用
    workspaces/                       diff/文件预览/worktree
    devices/                          手机配对、持久化和撤销
  host/test/                          领域/设备/配置/隔离协议测试

vendor/pi/                            固定上游，未修改
scripts/                              构建、原生/生命周期/监督/UI 验收
third-party/                          提取清单、许可、NOTICE、品牌与依赖记录
docs/                                 设计、来源、事实状态与验收摘要
~~~

不新增调度框架、工作流引擎或记忆 agent 包。pi 与各 harness 保持各自原生模型循环。构建通过不代表真实接入通过，验收状态以 [实现状态](implementation-status.md) 为准。

## 3. 依赖与状态边界

~~~mermaid
flowchart LR
    D[Electron 外壳] --> W[共享 Web UI]
    W --> C[Host Client]
    C --> H[Session Host API]
    H --> S[Session Service]
    P[Kodo 主对话工具] --> S
    S --> Q[SQLite 命令与事件事务]
    Q --> R[递送与对账]
    R --> A[原生 Harness Adapters]
    A --> Q
    Q --> E[客户端事件投影]
    E --> C
    Q --> K[Watch 与 Wake]
    K --> P
~~~

protocol 仅定义数据、校验与版本语义。UI 不直接读 SQLite、启动 CLI 或持有供应商凭据。Electron 只承担操作系统集成，窗口关闭与执行进程结束分别控制。手机使用相同 Host API；未来多 host 按 hostId 路由，不用本地目录字符串猜远程路径。

原生会话历史由 harness 管理；Host 保存索引、管理关系、命令/事件和 UI 投影。前端 store 只缓存服务端状态，不能成为运行事实的权威来源。

## 4. 核心模型与不变量

| 概念 | 关键关系 |
| --- | --- |
| Project / Workspace | 一个项目可有多个 host/目录/worktree；harness 不拥有项目 |
| Harness / Instance / Binding | 引擎身份、安装与运行实例、模型配置分别存储 |
| Session | 唯一产品 ID；项目可空；保留原生 ID、host、存储身份与工作位置 |
| Supervisor session | Kodo 会话类型；全局无项目，项目范围只操作本项目 |
| Supervision / Watch | 管理关系与事件订阅；不移动目标会话的归属 |
| Command / Event / Wake | 发送意图、执行事实、模型唤醒分别持久化 |
| Usage / Budget | 原始计量、估算与限制分开；未知不写零 |

运行、连接和托管状态不能合并成单一 busy 标记。全局主对话不需要工作目录即可管理，但文件/命令工具必须有明确执行位置。多个观察者可并存，一个执行会话同时最多有一个自动续聊控制者。

Store.sessions() 已还原持久会话与真实 nativeSessionId，并有唯一身份映射及迁移。草稿不伪造原生身份。会话归属与历史计费归属可追溯，不能因整理项目而改写已发生事件。

## 5. Adapter 与共享命令契约

现有 HarnessAdapter 只是起点。实际 adapter 需要处理能力探测、创建、列出/读取、恢复、发送/steer、取消、原生交互、事件、用量和释放连接；每项支持情况由固定版本的事实决定。

返回值区分“Host 已收件”“原生已接受”“本轮结束”“相关执行已静止”。HTTP 成功、stdio 写入成功或文本结束均不能代替运行完成。缺少能力时返回不支持/未知；实现未完成使用 pending/NOT_IMPLEMENTED，二者不能混用。

公共 ACP adapter 负责共享协议，四个具体 ACP 文件描述启动方式和已验证差异。Codex、DSH、ZCode 不必绕到 ACP。独立 pi harness 与 Kodo 主 agent 共用 SDK 装配，但身份、工具、默认配置和数据命名空间独立，不是运行两套 agent loop。

客户端和 Kodo 工具调用同一个服务。六个工具名称保持为 harness_list、harness_open、harness_read、harness_send、harness_watch、harness_stop；schemas、执行与持久事件绑定已实现。

下表列出接口族；具体实现与已测范围以状态文档和源码为准：

| 接口族 | 语义 |
| --- | --- |
| 查询 snapshot/projects/sessions/harnesses | 分页/游标读取事实与能力，支持项目/harness/状态筛选 |
| command 提交与按 ID 查询 | 带稳定 request/command ID；超时后可查询，不盲目重发 |
| event 订阅与补齐 | 使用持久 sequence/cursor；客户端重复消费可去重 |
| 原生交互回应 | 绑定 session/run/request ID；两端重复处理返回已处理 |
| 绑定/usage/device 管理 | 仅返回可展示的配置元数据、计量和设备状态 |

HTTP 入口已覆盖会话原生连接/递送、回执、历史、事件、管理、配置与设备等路径。模型目录使用 `GET /api/harnesses/:id/models?discover=1`；已有会话使用 `GET/POST /api/sessions/:id/settings`，按 requestId 可查询确切回执；待发编辑/立即发送使用 `PATCH /api/sessions/:id/commands/:commandId`，撤回保留 DELETE。原生验证与未安装的六种边界见 [最新复测](test-results-2026-11-11-models.md)。

## 6. 持久化、监控和停止

1. SQLite 先记录命令，持久回执表示 Host 已接收，不表示原生已开始。
2. 发送前取得目标写入权，核对范围、generation、绑定修订和限制。
3. 保存原生回执/事件，更新投影；同事务提交 watch 消费位置与 wake。
4. 调用 Kodo 前再次核对关系；仅观察/通知模式不唤醒模型。
5. 用户接管或停止时先暂停关系、递增 generation、撤销未发待办，再处理原生取消。
6. 崩溃恢复遇到已发出但未确认时进入 unknown，查询原生历史/状态后再决定，不承诺进程边界 exactly-once。

现有纯规则测试不能替代事务、恢复和并发机制。不要在 send() 后直接 fire-and-forget 调用另一段 prompt 来冒充持续托管。

## 7. UI 与桌面生命周期

以 [Craft baseline 设计](desktop-baseline.md) 为界面起点，已核对许可并提取部分 tokens/表现组件，Electron 桌面外壳已建立。本机窗口、隐藏/重开及退出 UI 后 Host 保持运行有实测记录；打包与完整退出菜单仍待验收。

默认三栏：范围导航、会话列表、对话。项目 → 会话为默认层级；harness 可筛选或分组。顶层主对话是全局 Kodo 主对话，项目主对话在项目内，管理目标为真实会话引用。10 种 harness 均提供直接聊天入口；移动端折叠为范围/列表/对话导航。

Host 可独立启动、发现和连接；窗口关闭只断开 UI。Windows 任务继续运行已有实测记录，托盘完整退出、打包与异常重启恢复仍须单独验证。

原生消息、工具结果和交互按能力渲染。尚未连接、缺少登录、协议不兼容、历史不可读和运行未知分别展示。手机配对、设备认证与撤销已实现；真实手机、TLS/隧道和休眠重连尚未验收，默认 loopback HTTP 入口不承担远程发布。

## 8. 环境与验证交接

根配置暂选 Node >=24.13.0、npm workspaces，SQLite 初稿使用 node:sqlite；这是宿主选择，pi 上游最低版本另见 upstream 文档。若调整运行时或 SQLite 驱动，需同步锁文件、打包与文档，并验证桌面发行环境。

根锁文件、依赖和桌面/Web workspace 已建立；运行前仍须核查本机 Node、CLI、登录和 Host 状态，再执行类型检查、构建与测试，记录真实结果。

验证覆盖项目归属、单控制者、用户接管、暂停后迟到事件、先完成后注册 watch、未知发送结果、重启恢复、原生交互、累计计量去重、配置隔离及桌面/手机 UI。每个 harness 单独记录协议与真实连接测试；缺少凭据或 CLI 时说明未验证项，不能用注册表或模拟回复替代。

实现按依赖顺序推进，首轮范围仍是 10 种 harness 一起交付。多执行 host 是后续扩展；首轮完整完成本地 Host 与手机客户端的设计范围。
