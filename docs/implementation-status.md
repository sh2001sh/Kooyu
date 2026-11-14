# 实现与验收状态

2026-11-13 Grok Read / 子代理增补：已通过官方源码与原生 stderr 定位 Windows TEMP 私有目录创建失败，修复专用临时目录与旧 leader 环境复用；Grok 1.0.80、用户目录 1.0.77 均通过真实原生“子代理 → Read → 输出”链路（模型端为本地合成服务器）。新增各 Harness 子代理事件隔离、展开查看与复制，Host **294/294**、浏览器专项 **11/11** 通过。详见 [Grok 与子代理验收](test-results-2026-11-13-subagents-grok.md)。下文“Grok Read 仍失败”为此前历史记录，现由本批次替代；Gemini/pi 等子代理能力边界和未实测项见新报告。

2026-11-13 生命周期增补：共享 ACP 发送准备互斥与取消隔离；OpenCode 待处理交互恢复、快照/实时去重和外部答复失效；Kimi 交互去重、原生回答校验及确认退出；Host 单项收件箱撤销。当前工作区 Host 256 项、交互 UI 9 项、原生只读 11 项、类型检查、lint、构建通过。详见 [生命周期与交互恢复记录](test-results-2026-11-13-harness-lifecycle.md)，原生能力边界继续保留。

2026-11-13 后续增补：Cursor / Grok 原生分页列表、Gemini 空历史、ACP 跨轮审批与失效收件箱、Codex / Claude / OpenCode 问题表单已接入。Host 230 项、UI 专项 25 项、原生只读 11 项通过。Grok Read 仍稳定报原生工作区未绑定，默认及无 leader 路径均复现，未标记全功能完成。详见 [后续验收记录](test-results-2026-11-13-harness-followup.md)。

2026-11-13 Harness 补齐批次：新增独立历史与分页、ACP 文件/终端服务和取消保护、会话级能力覆盖、累计用量去重；DSH 通过 session/wait 确认后代任务结束，历史检查保留绑定存储隔离。当前矩阵、验证结果和未完成边界见 [Harness 补齐验收](test-results-2026-11-13-harness-completion.md)。下文旧批次中“ACP 无客户端文件/终端”“Cursor 无历史”“ZCode 历史仅 200 行”等描述已被本批次替代，其他原生验收限制仍保留。

2026-11-12 ACP 复测：Gemini、Cursor、Kimi、Grok 四个本机启动入口已配置；四者原生双轮及重启续聊通过。Gemini、Cursor、Kimi 的原生文件读取通过；Grok `read_file` 仍失败。`partial` 与自动继续关闭保持，原因和逐项报告见 [四个 ACP Harness 验收](test-results-2026-11-12-acp-harnesses.md)。以下按各批次保留历史记录。

2026-11-12 当前配置收敛：产品配置仅保留 Provider → 模型库 → Harness 绑定。旧配置 API、界面和镜像存储已移除；SQLite v5 迁移旧 ID、清理旧记录并保留历史。无法安全恢复运行配置的旧会话在 UI 禁用发送，Host 同样拒绝恢复。**本轮** typecheck、build、lint、format 均通过；`npm test` 137/137、完整 `npm run test:ui` 22/22（桌面及手机浏览器视口）及新增旧接口定向 UI 测试 1/1 通过。真实模型连接、Electron 实窗和真实手机未在本轮重跑；下文有关这些能力的成功记录属于此前批次。[本轮记录](test-results-2026-11-12-binding-only.md) 单列证据和限制。

2026-11-12 三层配置实现：新增独立多入口 Provider、带字段来源的模型库与手工覆盖/恢复自动、固定修订的 Harness 绑定及双端配置页；models.dev 在线更新、ETag/LKG/离线 SDK 目录、认证模型发现、稳定配置请求 ID、CAS 和 keyring 已接通。Kodo / pi / Codex / Claude Code / DeepSeek Harness / ZCode / OpenCode / Gemini CLI / Kimi Code / Grok Build 均通过新绑定的双轮真实对话；Gemini 使用 Google→Chat 本地网关，不依赖 Google 直连凭据。普通 Cursor Agent 自定义 Provider 未获证实，界面禁用。Claude 和 Gemini 网关通过原生 Read 工具与第二轮历史；Codex Chat 转换因原生自定义工具不兼容已禁用。领域/适配器 **137/137**、浏览器 **18/18** 通过；Electron 实窗完成五种新绑定与默认值操作。详细 [结果与十种矩阵](test-results-2026-11-12-providers.md) / [机器记录](provider-configuration-verification.json)。

范围限制：Gemini 的 Google 直连路径缺可用凭据，未验证；Chat 网关只验证文本、函数工具、流和上游 usage，图片、签名思考、搜索及精确 countTokens 不支持。普通 Cursor Agent 尚无已确认的自定义 Provider 配置入口，不承诺一键绑定。绑定会话目前固定模型，改模型需新建绑定会话，思考可在声明内调整下一轮。toggle/budget 仅保存资料，没有通用调节与 wire 映射；通用多方向网关、Provider/模型/绑定删除、每个 Provider 列表的后台定时重取、真实手机/TLS 未实现或未验收。公开目录是聚合资料，未知字段不补默认，不宣称全部是官方规格。此前只读调研和参数批次保留为历史记录，以本段与最新报告为准。

更新：2026-11-12。本页记录实现事实，设计文档中的目标不等于完成声明。**10 种 harness 首轮尚未全部完成**；ZCode/OpenCode 已安装 desktop，现已发现并复用其 bundled runtime。Gemini/Kimi/Grok 的固定版本已配置为本机 ACP 启动入口；隔离测试的 Provider 和凭据仍与日常账户有别。没有使用模型 API、终端展示或 synthetic peer 替代真实原生接入。

本轮逐项可靠性修复、保留策略与环境诊断见 [可靠性修复记录](reliability-hardening.md)。按测试大纲重新执行的 [首批测试记录](test-results-2026-11-11.md) 单列了当前通过、失败与阻塞；后续 [启动与消息操作复测](test-results-2026-11-11-fixes.md) 已修复搜索定位与本机 Electron 启动，并单列真实排队/撤回/删除/steer 证据。

模型与待发消息后续实现及真实验证见 [最新复测](test-results-2026-11-11-models.md)：85 项领域/协议测试、11 项浏览器测试、五入口 85 个真实模型切换检查和 Codex 双视口 16 个检查通过。待发消息可修改、撤回或立即发送；模型和思考档位可在会话中修改，下一普通回合生效，当前回复/steer 不改变。此为此前运行结果，最新 desktop 结果见下。

[桌面安装与原生入口复测](test-results-2026-11-11-desktop-harnesses.md)：全部十种 + Kodo 有 desktop 发现路径；Codex/DeepSeek 强制桌面入口真实回复通过，ZCode 原生余额不足，OpenCode 模型服务 503，二者握手与发送 ACK 已通过。领域/协议 92 项、浏览器 14 项通过；macOS/Linux 发现路径与其他 desktop 包仍待实机验证。

2026-11-12 追加：ZCode/OpenCode 的桌面 GUI 均关闭时，捆绑原生入口已通过会话创建、目录与 Host 重建后的恢复；ZCode 空草稿丢失的恢复缺陷已修复。默认路由仍未取得成功回复，本次 ZCode 返回资源不足 `1113`，OpenCode 免费模型返回要求更新桌面版的 `426`。细节与报告见上述桌面复测文档的最新小节。

## 工程与实现

保留并扩展 protocol/host 初稿，新增 Electron、React/PWA、完整 npm 锁文件与 CI。vendor/pi 未修改，`.local/research` 仅作固定提交参考。Host 使用 Node SQLite WAL/事务、原生身份唯一映射、稳定命令 ID、持久事件与消费游标、单自动控制者、generation、watch/wake、收件箱、FTS、usage/绑定修订和设备记录。

命令区分 accepted/dispatched/confirmed/unknown/rejected/cancelled。发送与回执间崩溃进入 unknown，不自动重发；界面可读取原生历史并人工记录对账依据。重启恢复尚未发送的命令；结果未知或运行状态未知时阻止后续递送。停止/用户接管先提交暂停和 generation，再请求原生取消。停止请求也持久保存 ID/回执；相同请求重放不重复取消后来的回合，断网先查命令状态。观察/通知不调用模型；继续模式基于持久事件。模型重新注册不能重置已消费事件或用户限制。

配置支持会话显式选择（含原生配置覆盖）→ 项目按 harness 默认 → 本机 harness 默认 → 原生配置与登录。默认值只影响以后创建的会话；修改绑定生成新修订，已有会话/草稿继续固定原修订。桌面与手机共用配置编辑 API，过期修订会拒绝覆盖。凭据轮换产生新的 Provider 修订，已固定会话使用的修订凭据在清理时保留。

配置入口已统一为 Provider → 模型库 → Harness 绑定。绑定修订本身是会话的固定引用，不再生成额外配置镜像。旧配置 API 和编辑入口已删除；SQLite v5 将能确定关系的旧 ID 映射到绑定 ID 并清理旧记录。无法安全恢复运行配置的旧会话保留历史，但必须新建会话继续发送。草稿菜单只选择已有绑定或原生模型，不再快速写入 Provider ID 与密钥。

此前入口收敛的 [专项记录](test-results-2026-11-12-config-unification.md) 是旧实现的历史验收，含当时的浏览器 **19/19** 结果；其中保留旧 API/旧配置入口的描述现已过时。此前 Provider 批次的 **18/18** 计数仍指该批次当时的测试集合。当前移除工作以本页最新回归结果为准。

会话中心已实现项目→会话、全局/项目 Kodo 主对话、harness 筛选/分组、标题/归档/置顶、历史搜索、收件箱、运行时间线、原生交互、用户接管、健康/能力、绑定、用量/预算、项目归属整理、工作区 diff/文件预览/worktree、原生 ID 绑定、跨 harness 交接来源链接、手机配对及响应式界面。原生历史读取后进入独立搜索索引，不作为新完成/usage 事件重放。项目整理不修改 cwd 或原生身份。

Kodo 内核使用 `@earendil-works/pi-coding-agent` 1.5.2、SessionManager、原生 agent loop、基础工具和六个产品工具；没有另造模型循环、固定实现/审查流程或多层 agent。未绑定工作位置的全局主对话只有产品管理工具，不注入当前 UI 项目的目录。用户可选“仅授权创建”或“创建并自动继续”；后者只为该主对话以后新建的会话建立控制关系，并继承用户目标/限制。已有或已暂停会话不会因此重新启用。新草稿、请求映射和控制关系同事务提交；回滚事件不会向客户端发布。撤销未来授权保留已有关系。界面提供原子转交自动控制，旧输入失效但不重启原生回合。

Kodo 与 pi 使用独立身份（kodo/pi）、实例、默认绑定、会话目录和用量来源。Kodo 在 SDK 装配时设置固定的产品身份，只有 Kodo 主对话装配六工具；pi 保留直接对话与基础工具。数据库 v3 将旧 pi 主对话迁移为 Kodo，保留原生 ID、回执、控制权、generation、游标和当时的配置引用；自定义标题保留，旧版自动生成的 pi 主对话标题改为 Kodo。旧 SessionManager 日志原地恢复，历史列表避免误归到独立 pi。

## 内置 Kodo + 10 种原生 harness 矩阵

“协议已实现”只说明有实际 transport/translation 路径；真实验收仅覆盖下列能力，不能外推。

| Harness | 原生路径 | 实现 | 实机验证 | 未验证/缺少条件 |
| --- | --- | --- | --- | --- |
| Kodo（内置主 agent） | pi SDK 1.5.2 + SessionManager | 已实现，独立 kodo 身份 | 对话、历史/原 ID resume、全部六工具真实调用；新建 Codex→一次发送→持久事件唤醒→读取→暂停闭环 | 默认 openai 路由超时；通过已有 codegoai/deepseek-v4-flash。运行中 abort 已收到 cancelled/settled；其他目标 harness 的管理闭环待验收 |
| pi（独立 harness） | SDK 1.5.2 + SessionManager | 已实现，独立 pi 身份与基础工具 | 分离后重新验证原生对话、历史读取/列表、Host 重建后原 ID resume/第二轮 | 不装配产品管理工具；运行中 abort 已收到 cancelled/settled；原生 steer、排队/待发撤回和本地删除已实测通过。默认 openai 路由超时，实测使用 codegoai/deepseek-v4-flash |
| Codex | CLI 0.161.0 app-server | 已实现 | initialize/start/send/文本/usage/回合结束、历史读取/列表、Host 重建后 resume、同会话桌面/手机视口 | 运行中 interrupt 已收到 interrupted；后台状态未知；steer 已实测通过，审批待验证；rate limits 返回需 ChatGPT 登录，当前 API 认证不可用 |
| Claude Code | Agent SDK 0.3.322 + 原生 CLI 2.1.300 | 已实现发送/流/交互路径 | 原生回复、usage、回合结束、原生历史读取/列表、Host 重建后原 ID resume/回复 | 默认优先已安装的原生 CLI；随附 2.1.322 恢复实测失败，不承诺所有安装版本兼容。interrupt 请求和随后回合结束已验证，原生 result 仍为 success，取消结果/后台状态未确认；审批/订阅兼容待验收 |
| DeepSeek Harness | CLI 0.2.1-rc.2 SDK JSON-RPC | 已实现；新增隔离 Provider 映射 | 初始化、session/prompt、原生回复、turn-ended/settled、Host 重建后原 ID resume/回复；新 Anthropic 绑定双轮真实回复 | 该版本没有单轮 cancel；独立原生历史列表/读取尚未接入；usage/quota 未提供 |
| ZCode | desktop 3.17.2 bundled runtime 0.17.1；v4/command + wire v3 | 部分实现，自动继续关闭；新增隔离 Provider 映射与本地凭据中继 | 新 Anthropic 绑定经 desktop runtime 双轮真实回复、同一原生 ID；此前默认账户的发送 ACK/失败终态仍有记录 | 原生 GLM-5.3 账户返回 429/1113 余额不足，不影响另一 Provider 的通过记录；恢复/取消/交互仍待测。历史限 200 行，无原生列表 |
| OpenCode | desktop 1.18.30 原生 Server + HTTP/SSE | 部分实现，自动继续关闭；新增隔离 Provider 绑定 | 真实 health/session/provider/SSE；新 Anthropic Provider 绑定经 desktop runtime 双轮真实回复、上下文与身份保留通过 | 早期原生默认路由 503 保留为历史；新绑定工具/审批/恢复/取消待测；其他版本未验收 |
| Gemini CLI | ACP v1 实时对话 + 本地 Google→Chat 网关；独立 JSONL 历史/列表 | 部分实现，自动继续关闭；隔离 Provider 映射 | 0.67.0 原生 Read、双轮回复及重启续聊；旧会话经 Host 离线读取 5 条消息，未启动 ACP 握手 | Google 直连缺凭据未验；网关图片、签名思考、搜索、精确 countTokens 不支持；外部活动接管/steer 未验证 |
| Cursor | ACP v1 实时对话；独立本地会话元数据列表 | 部分实现，自动继续关闭；自定义 Provider 绑定禁用 | Agent CLI 2026.11.11-b912975 已登录，原生 Read、双轮及重启续聊；Host 离线列表找到旧会话 | 普通 Agent 自定义 Provider 无已确认入口；usage 未见，取消/交互未专项验收；独立完整历史读取与外部接管不支持 |
| Kimi Code | ACP v1 实时对话；独立 CLI 列表 + 有界 wire 历史 | 部分实现，自动继续关闭；隔离 Provider 映射 | 2.5.2 原生 Read、双轮及重启续聊；旧会话经 Host 离线读取 6 条消息，未启动 ACP 握手 | 取消/交互未专项验收；外部活动接管/steer 未验证 |
| Grok Build | ACP v1 实时对话；独立 CLI Markdown 历史导出 | 部分实现，自动继续关闭；隔离 Provider 映射 | 1.0.80 双轮及重启续聊；旧会话经 Host 离线导出成功，未启动 ACP 握手 | 原生 `read_file` 报工作区会话未绑定，工具仍失败；自定义 Provider 会话的原生 usage 返回零，不能当作真实用量；外部活动接管/steer 未验证 |

所有外部活动会话接管都未验证，界面不承诺跨应用写入权。绑定历史 ID 要求用户确认外部运行已经结束；未知 ID 不创建替代会话。ACP 通用层不提供文件/终端客户端服务，也不承诺 steer；Gemini、Kimi 和 Grok 的独立历史读取是各适配器的原生扩展，不代表 ACP 本身有 read 接口。Cursor 仅有本地会话元数据列表，完整原生历史仍不支持。原生交互支持一次回应语义，但某些复杂问答仍使用结构化 JSON 表单。

## 执行过的验证

此前 Provider 批次：`npm test` **137/137**、`npm run test:ui` **18/18**，typecheck、build、lint、format 均通过；九种有自定义绑定的原生 Harness 均完成新绑定双轮真实回复，其中 Gemini 走本地 Chat 网关并完成原生文件工具。Electron 五种新绑定与默认值实窗操作通过。最新独立历史批次 Host **182/182**、typecheck、build、lint 通过，UI **34/38**；四项 UI 失败和详细边界见[专项记录](test-results-2026-11-12-acp-harnesses.md)。下列较小计数来自此前专项批次，用于保留历史验证范围。

- `npm ci/install`：已安装并生成完整锁文件。Node 24.13.0 / npm 11.6.2。
- `npm run lint`、`npm run format:check`、`npm run typecheck`（含 Host 测试源码）、`npm run build`：已通过。构建脚本使用项目内临时目录，修复本机系统 TEMP 写入失败；本轮 Web JS 构建 约 518 kB（有大于 500 kB 的体积提示），已去掉无用的浏览器 Zod schema。
- `npm test`：**85/85 通过**。覆盖请求去重/顺序、用户接管、停止握手竞态/重复停止不影响新回合、快速结束重放、一次 watch、控制权与原子转交、未知不重发/对账、恢复、usage 防倒退、双端交互、项目/cwd 分离、未来创建授权/撤销/请求映射原子性、事务回滚不发布、设备配对持久化/撤销，Kodo/pi 身份迁移与工具/历史隔离、配置优先级/原生覆盖/修订隔离/并发编辑冲突，以及隔离适配器协议、DeepSeek 长回合等待、全局异常退出/锁释放、ingest 隔离、SDK 断线/空闲取消拒绝、停止 Kodo 同时暂停其对外控制、10,000 文本增量合并去重、中文子串搜索和 v3→v4 索引迁移、事件分页/GC、跨 UUID 同答案幂等、凭据轮换/孤儿回收和 token 到期测试。
- Playwright：**11/11 通过**。覆盖独立 Kodo 主对话与 10 种原生直接会话草稿、项目工作位置、详情与能力页、项目未来授权/原子控制权转交，绑定 编辑与项目默认继承/旧会话修订保留，以及 390px 手机导航、输入框、停止入口、无水平溢出。授权和转交用例确认没有启动模型调用；包含初始 Host 临时失败后重建 snapshot/SSE 的恢复测试，以及项目内新建、模型绑定和按项目/Harness 分组切换。另用 Playwright CLI 验证 1,000 条合成历史：最新 701–1000、较早 401–700、返回最新均保持 300 个渲染事件，手机 390px 无溢出、无 console 错误。
- `verify-native.mjs`：独立 pi、Codex、Claude Code、DeepSeek Harness 真实请求通过。协议测试结果没有计入此项。
- `verify-native-lifecycle.mjs`：Kodo、独立 pi、Codex、DeepSeek Harness 的持久身份/resume/第二轮通过；只有 Kodo 调用 `harness_list`；Kodo 恢复后回复确认自身产品名为 Kodo。Claude 随附 CLI 恢复失败；改用已安装的原生 CLI 2.1.300 后历史与原 ID resume/第二轮通过。Codex quota 明确返回需要 ChatGPT 登录。
- `npm run verify:supervision`：**真实闭环通过**。Kodo 调用全部六工具，创建一个 Codex 原生会话、仅发送一次任务；收到真实回复后，持久 wake 触发 Kodo 第二轮，读取结果并停止/暂停目标，回复确认。Kodo 与 Codex 各保留独立原生 ID 和用量。不是 fixture 或模型 API 替代。
- 系统 keyring：临时合成凭据的实际系统凭据库轮换删除、旧会话 key 保留、清除当前无引用 key 均通过，验证后已删除临时凭据；没有修改用户原有凭据。
- `verify-cancel.mjs`：Kodo/pi 收到 cancelled/settled，Codex 收到 interrupted；Claude 只确认 interrupt 请求及随后原生 success 回合结束，不能声称取消终态或后台已静止。
- `verify-live-ui.mjs`：真实 Codex 回复在桌面 1440×960、手机 390×844 上显示，同一原生 ID；无水平溢出。为浏览器视口，**不等同于真实手机/TLS 验收**。
- Electron `39.1.0`：本机 E 盘镜像启动前退出、同文件在 C 盘正常。启动器新增校验用户缓存回退，已实际打开并连接 Host；关窗/重开/退出 UI 后真实 Codex 任务完成且原生身份保持。完整诊断和 Playwright 关闭等待限制见 [复测记录](test-results-2026-11-11-fixes.md)。打包及全部停止菜单场景仍未验收。
- Impeccable 独立 UI review 要求修正原生 item 分类、输入焦点、手机触控尺寸和缺失验证入口；修正与复核结果另见 `.impeccable/review`。本页不代表整产品已完成。

本地详细 JSON 报告在 `.local/verification`，截图在 `output/playwright`；均不提交运行数据或凭据。稳定、无凭据的验收摘要为 [verification.json](verification.json)，通过同一 Host API 提供给桌面与手机健康页。CI 文件已添加，远端 CI 尚未运行。

## 剩余限制

- BUG-20261111-003 已修复复测：旧消息有界定位/高亮与桌面、手机视口通过；完整工具输出搜索等设计场景仍须单独验收。

1. Gemini CLI 已可通过本地网关使用已授权 Chat Provider；Google 直连仍需其协议凭据且未验。普通 Cursor Agent 的自定义 Provider 接口尚无可靠证据，因此不开放一键配置。四个 ACP 已验证原生重启续聊，Grok 的原生文件工具仍失败；ZCode 的原生默认账户资源不足，另一 Provider 的新绑定已通过。逐项验收其他协议、cancel/steer/审批/usage/quota；安装发现不是认证或能力成功。
2. Claude 已优先选择验证通过的原生 CLI，随附 CLI 的持久恢复仍有限制；Electron 启动与基本窗口/Host 生命周期已实测，停止菜单/异常退出完整场景、打包与分发仍待验收。
3. 手机配对、撤销、PWA shell 和 API 已实现；真实手机、安全隧道/TLS、休眠重连未验收。本地独立 Host 已实现，多执行 Host 只有 hostId 协议边界，未实现远端执行调度。
4. 本地预算约束新自动调用，费用未知时暂停；用量延迟/并发调用不能保证供应商账单硬上限。没有原生成本/配额的数据保持未知，不当作零；自定义 pi endpoint 不用默认单价伪报费用。
5. 完整原生历史分页浏览与外部活动监控、运行前 baseline/按轮精确改动归因、附件多媒体、复杂原生问答控件尚未完整实现。文件预览限 512KiB，Git diff 对比 HEAD，只能归因到工作区。
6. 项目未来授权的限制按新目标继承；项目/全局总预算仍由单独预算约束。已发往原生进程的命令只能请求取消，不能声称撤回。全部能力矩阵仍须在实际安装/登录条件下验收。

此前新增待发撤回与本地会话删除，真实 API 117 个断言、真实 Codex 双视口 UI 11 个检查通过。删除不移除原生文件、原生身份或对账回执；已发消息撤回、原生删除/回滚和内容擦除未实现。操作语义及各 harness 矩阵见 [消息操作复测](test-results-2026-11-11-fixes.md)。


模型设置有 settingsRevision/CAS 与稳定请求回执，发送时冻结设置并校验停止 fence；待发编辑/提升有独立 pendingRevision，保留原始发送请求用于去重。真实 Codex 验证修改后旧正文从未发出、立即发送以 native steer 接受，普通队列使用新模型。五入口双模型路径与十种能力边界详见最新复测。session 累计 usage 的模型归属保持未知，turn usage 优先使用原生字段或已递送快照，不能拿最新期望模型/绑定 默认覆盖旧轮。
