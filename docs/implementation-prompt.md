# 交给实现 agent 的 prompt

把下面整段复制给在本仓库工作的 agent。它用于继续实现，不会自动创建或向其他 agent 发送消息。

~~~text
请在当前 Kodo / agent-harness 仓库中，根据已确定的设计和现有源码骨架完成实现。

先阅读 docs/design.md（含目录索引与全部参考项目链接），然后依次阅读 docs/code-skeleton.md、docs/session-model.md、docs/harness-catalog.md、docs/product-features.md、docs/desktop-baseline.md 和 docs/upstream.md。核对参考实现时使用 docs/research.md 与 docs/research-sources.json 中的固定提交；.local/research 只是本地参考缓存，不是运行依赖。

仓库保留 vendor/pi 上游子模块，已建立根工程、packages/protocol、packages/host、apps/desktop 与 apps/web。完整锁文件、依赖、构建和测试均已建立；各 adapter 的实现和真实验收范围见 docs/implementation-status.md。继续工作时先审查实际仓库状态及未提交改动，不要恢复已清理的旧架构。

采用 Electron + React + TypeScript + 独立 Node Session Host + SQLite。以 Craft Agents 的选定视觉样式和表现组件为 UI baseline，核对依赖、许可证和品牌边界后提取；Host 结构参考 bb，可靠递送参考 DeepSeek Superagent，其他项目按总体设计的采用范围借鉴。产品逻辑放在 vendor/pi 之外，复用 pi SDK、SessionManager 和原生 agent loop，不另造模型循环、固定工作流或多层管理 agent。

首轮覆盖 pi、Codex、Claude Code、DeepSeek Harness、ZCode、OpenCode、Gemini CLI、Cursor、Kimi Code、Grok Build，共 10 种。全部能在软件中直接聊天，不要求经过 pi；原生协议优先，合适的工具复用公共 ACP adapter。可以按工程依赖顺序实现，但不能只接通 Codex 就把首轮报为完成，不能用模型 API、终端展示或模拟回复冒充原 harness 集成。

按项目 → 会话组织界面，harness 是标签、筛选或可选分组。全局主对话是无项目归属的 Kodo 会话（内核基于 pi SDK），可管理用户选定的跨项目会话；项目主对话只管理所在项目，按需创建。被管理会话保持原项目与原生 ID。主对话可按目标有多个，同一目标同时最多只有一个自动续聊控制者；观察关系可有多个。用户直接输入时暂停目标自动续聊。项目归属、实际工作位置、harness 身份、Provider/模型/绑定和管理关系保持独立。

Kodo 主要承担监控、续接和调度；pi 单独作为直接聊天的 harness，Kodo 内核基于 pi SDK。Kodo 使用基础工具与 harness_list/open/read/send/watch/stop 六个产品工具。仅观察和通知模式不调用模型；自动继续基于持久事件唤醒。所有命令、事件、watch 和 wake 经同一 Host API 与事务边界处理。实现稳定请求 ID、原生身份映射、消费游标、控制权和 generation、停止/撤销及崩溃恢复；发送结果未知先对账，不盲目重发。原生回合结束、后台执行静止和用户目标完成分别表达。

同时完成设计中的会话中心、历史搜索、待处理收件箱、运行时间线、用户接管、harness 健康/能力、项目/worktree 与成果查看、绑定隔离、跨 harness 交接、用量/预算及手机访问。交接创建新的原生会话并保留来源，不伪装成原生 resume。使用量未知保持未知，执行与 Kodo 成本不重复统计。首轮为本地独立 Host + 手机客户端，多执行 host 按文档保留扩展边界。

关闭窗口不能意外停止 Host 或运行中的任务；停止并暂停托管后，迟到事件不能重新启动自动续聊。桌面与手机共享同一会话协议。保留原生登录和交互语义，凭据放系统凭据库，不悄悄覆盖用户全局配置。各 harness 的恢复、外部活动会话接管、steer、usage 和 quota 按实际能力验证并明确展示，不能统一承诺不存在的能力。

请直接推进实现、修复和验证，不只返回计划或占位文件。先补齐工程与工具链，再完成模块和真实协议集成；执行必要的类型检查、构建、领域/适配器测试及桌面与手机 UI 验证。真实模型连接验证使用已有有效配置与授权；缺少登录、CLI 或凭据时，完成可独立完成的工作，明确列出所缺条件和未验证能力，不虚报成功。普通本地可逆开发无需反复确认；遇到缺失信息或必须由用户操作的步骤，再提出具体问题。

交付时给出变更说明、启动方式、真实验证结果、10 种 harness 的实现/验证状态矩阵及剩余限制。同步更新文档，清楚区分已实现、已测试、待验证和未实现。
~~~
