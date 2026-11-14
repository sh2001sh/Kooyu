# 首轮 harness 接入清单

更新日期：2026-11-13。覆盖 10 种原生 harness，另有基于 pi SDK 的内置 Kodo 主 agent。所有入口已有实现和本机安装发现；真实对话记录、不同账户限制及尚未验收能力分别保留。最新批次补齐独立历史、分页、ACP 客户端服务、协商能力与生命周期，见 [补齐验收](test-results-2026-11-13-harness-completion.md)。六种接入仍为 partial，自动继续关闭；不能把安装成功、合成测试或一次握手当作完整原生验收。下表为早期选型证据，当前能力以最新报告为准。

保留此前已确定的六种，加上本次四种，共 **10 种**。首轮不继续扩展长尾产品；通用 ACP 接入作为内部实现复用，不额外建设插件市场。

| Harness | 首选集成 | 当前证据 |
| --- | --- | --- |
| pi | 原生 SDK，独立 pi 直接会话与基础工具 | 已固定上游源码并核对 SDK |
| Codex | 官方 app-server | 已核对官方接口与参考实现 |
| Claude Code | Agent SDK，验证 CLI 会话兼容性 | 已核对文档与参考实现 |
| DeepSeek Harness | 原生 TS SDK / stdio JSON-RPC | 已核对上游源码 |
| ZCode | 原生 app-server | 已核对上游源码 |
| OpenCode | 官方 server / SDK，固定大版本 | 已核对文档与参考实现；V1/V2 不能混用 |
| Gemini CLI | 原生 ACP | 当前 ACP 注册表存在 `gemini` 条目；尚未集成验证 |
| Cursor | Cursor Agent CLI / ACP | 当前注册表存在 `cursor` 条目及 Windows/macOS/Linux 分发；尚未运行验证 |
| Kimi Code | 当前 Kimi Code / ACP | 当前注册表存在 `kimi-code`；旧 `kimi` 条目标记为 legacy |
| Grok Build | Grok CLI agent stdio / ACP | 当前注册表存在 `grok-build`；尚未集成验证 |

## 共同交付标准

10 种均提供直接聊天入口，不经过 Kodo 推理；共用桌面/手机的会话列表、输入、输出和运行状态。Kodo 通过相同 host 接口对具有相应能力的会话执行监控与续接。

会话默认按项目聚合，harness 是筛选/分组维度。主对话分全局与项目两种范围，管理关系不改变目标归属；具体规则见 [会话模型](session-model.md)。收件箱、接管、交接与计量等共用能力见 [功能设计](product-features.md)。

每种分别验收：安装发现、登录/配置、创建会话、流式消息与工具展示、原生交互、取消、历史读取、恢复、运行状态、配置隔离和用量。协议不提供某项能力时，明确标为不支持或未知；不能通过猜测伪造完成信号或额度。外部活动会话的监控和写入权转移单独验收。

“首轮一起接入”指同一次完整交付覆盖上述清单。实现可以有依赖顺序，但仅完成 Codex 或少数入口不构成首轮完成。API 绑定 仍按 harness 能力绑定，不能承诺所有产品都接受任意供应商 endpoint。

## 新增四种的核查来源

2026-11-10 读取 [ACP 注册表](https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json)，保存了本次四个条目的 [分发信息快照](harness-registry-snapshot.json)。注册表中的存在性和分发信息不等于实际兼容性验证；实现时仍需固定可用版本并测试。

Codeg 固定提交中的 [agent 定义](https://github.com/spacering-net/codeg/blob/da2354235b67d04e94d1009781dee58516a4bd04/src-tauri/src/models/agent.rs)与 [接入注册表](https://github.com/spacering-net/codeg/blob/da2354235b67d04e94d1009781dee58516a4bd04/src-tauri/src/acp/registry.rs)也包含这四种工具，可用于对照实现。它们的 adapter 不是本产品已完成的代码。

整体架构见 [设计方案](design.md)。

2026-11-11 消息操作复测：Kodo、pi、Codex、Claude Code、DeepSeek Harness 均通过真实双条排队、待发撤回、查询与本地删除；Kodo/pi/Codex 原生 steer 通过。Claude/DeepSeek 的当前轮直接引导不支持，DeepSeek 独立历史读取仍不支持。此为此前 CLI 验收范围；现已接入 ZCode/OpenCode desktop 原生入口，二者仍为 partial，账户/服务阻塞详见最新复测。详见 [复测矩阵](test-results-2026-11-11-fixes.md)。


## 会话模型与思考强度

新建和已有会话的模型设置均有真实适配路径。Kodo/pi 使用原生 SDK 模型与 thinking level；Codex 使用 model/list 和 turn/start；Claude 使用 supportedModels 与 query model/effort；DeepSeek 在回合边界以新 route 恢复原 native ID；ZCode 使用 modelSelection；OpenCode 使用 V1 provider/variants；四种 ACP 使用协商后的 config option，必要时回退 legacy set_model。运行中保存的设置留到下一普通回合，steer 沿用当前回合。

ZCode/OpenCode 的 native-models 表示可以覆盖原生模型，不表示已接入产品 绑定 转换。ZCode 当前目录只有 snapshot 的当前模型，完整 provider registry 尚未接入。DeepSeek 不提供完整目录，输入原生模型/档位后由初始化校验。ACP 的 thought_level 只描述当前模型，不能套给全部目录。模型目录也不代表账号已获授权。

本机 Kodo、pi、Codex、Claude、DeepSeek 的双模型真实会话已通过；ZCode/OpenCode 当前已通过 desktop 模型目录与发送 ACK，但真实回复阻塞；其余四种仍只有隔离合约验证。全部十种的字段、真实验证和待验证边界见 [模型与待发消息矩阵](test-results-2026-11-11-models.md)。

## Desktop 安装支持

全部十种支持安装记录与常见目录发现。Windows 包含卸载注册表/Appx；支持 desktopPath 指定非标准安装。Codex、ZCode、DeepSeek、OpenCode 有实际 desktop runtime 接入；只发现 GUI 时不会冒充 CLI/ACP。Claude/pi 可使用内置 SDK，但桌面消费者登录不等于编码 SDK 已获授权。真实矩阵、版本、启动配置和缺口见 [desktop 复测](test-results-2026-11-11-desktop-harnesses.md)。
