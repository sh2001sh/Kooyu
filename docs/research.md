# 多 harness desktop 源码调研

核查日期：2026-11-10。范围：用户指定的 8 个项目，GitHub 检索补充的 4 个项目，以及已固定的 pi 内核。以下判断来自检出源码、项目文档和上游截图；没有安装这些项目的依赖、运行它们的应用或验证真实模型会话。全部提交、许可证和证据路径见 [源码清单](research-sources.json)。

本页的配置用语保留调研时的上游概念；当前产品只使用 Provider → 模型库 → Harness 绑定，见 [实现状态](implementation-status.md)。

## 结论

建议采用 **Craft Agents 的部分 UI 作为 desktop baseline，pi 作为智能内核，独立 Session Host 管理所有 harness**。宿主/适配器边界主要参考 bb；持久递送参考 DeepSeek Superagent；监控细节参考 Codeg 和 CodexHost；配置、模型路由和计量语义参考 Magpie。各参考项目解决不同问题，不拼装多套 agent runtime。

产品必须让 Codex、Claude Code、DeepSeek Harness、ZCode、OpenCode、pi 都能直接对话。pi 托管是附加能力，直接聊天不经过 pi。通过 pi 调用某个供应商的模型，不等于接入该供应商的原生 harness。

## 横向比较

| 项目 / 许可 | 主要价值 | 对本项目的采用方式与限制 |
| --- | --- | --- |
| [dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype) / MIT | 主动运行、持久 effects、消息递送、重启恢复 | 学习可靠性；不引入其 ticket、admission、router、evaluator 全套业务 |
| [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) / MIT | 原生 TS SDK、headless、ACP、session 事件 | 直接接原生 harness；SDK 优先，不能用 DeepSeek API 代替 |
| [ZCode](https://github.com/zai-org/ZCode) / Apache-2.0 | 原生 app-server、会话生命周期、多客户端状态 | 实现独立 ZCode adapter，固定协议版本 |
| [Magpie](https://github.com/yetone/magpie) / MIT | 多模型配置、gateway、用量、历史入口 | 学 profile 隔离与计量来源；不作为会话托管内核 |
| [bb](https://github.com/get-bb/bb) / MIT | host-daemon、harness bridge、统一事件和多端 | 核心架构主参考；不搬入整个插件、任务和工作流平台 |
| [Codeg](https://github.com/spacering-net/codeg) / Apache-2.0 | 多 harness 直接聊天、原生历史、移动访问、后台活动 | 接入和观察器主参考；Tauri/Rust 与 Node/pi 并存成本较高 |
| [CodexHost](https://github.com/BytePioneer-AI/codex-host) / LGPL-3.0-only | 通用会话操作、独立 host、多端、thread watch | 学监控和未知发送结果处理；不依赖 Codex Desktop 内部集成 |
| [Pebrel](https://github.com/Kuddev/pebrel) / GPL-3.0-or-later | GPUI 终端、窗口驻留、布局和 CLI 恢复 | 学生命周期表达和终端体验；不选作结构化聊天/手机 UI 底座 |
| [Craft Agents](https://github.com/craft-ai-agents/craft-agents-oss) / Apache-2.0 | 克制的 Electron/React 聊天界面、设计 tokens、消息组件 | **推荐 UI baseline**，限定组件提取，保留归属并替换品牌 |
| [Harnss](https://github.com/OpenSource03/harnss) / MIT | Claude SDK、Codex app-server、ACP 接入 | 适配器参考；关闭全部窗口会停止引擎，不直接用其生命周期 |
| [Orca](https://github.com/stablyai/orca) / MIT | daemon、PTY 重连、远程执行与移动端 | 学 UI detach 和执行进程分离；不引入全部平台复杂度 |
| [CC Switch](https://github.com/farion1231/cc-switch) / MIT | 多 harness 配置与历史用量统计 | 配置/计量参考；历史管理不等于实时直接聊天 |

## DeepSeek Superagent：持久运行需要什么

关键依据：[effects.ts](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/app/effects.ts)、[delivery.ts](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/8c32a9dc5d72c033816c6a8110b37f40cf94fba4/src/app/delivery.ts)、`src/core/assignments.ts`。

它是围绕仓库任务持续工作的原型，不是通用 desktop。值得移植的是：状态变化和待发 effect 在同一 SQLite 事务记录；提交后递送；按 kind/key 合并待办；用 generation 避免旧处理覆盖新内容；保存稳定消息 ID，并在确认生产者之前持久保存递送结果。恢复时先检查实际工作和会话，而非重做全部任务。

这些机制可以放进一个 Session Host。模型仍只获得基础工具和少量 session 操作，无需继承原型的 ticket 状态机与所有管理工具。通知用户和唤醒模型应分别决定，普通事件写入记录即可。

## DeepSeek Harness 与 ZCode：都具有原生接入点

DSH 依据：[SDK client](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/sdk/client/README.md)、`packages/sdk/protocol/src/types.ts`、`packages/acp/acp/README.md`。

`DeepSeekHarness` 可以管理 stdio JSON-RPC 子进程，提供 run、通知和 resumeSession。`session.event` 与 `session.status` 需分别理解；收到输入回执不等于 agent settled。恢复对已有活动 session 和不兼容状态有约束，也不会复活此前 shell/browser 进程。ACP 有 list/resume 等能力，但本次快照不支持 `session/load`。因此首选原生 SDK，保留更完整的运行语义。

ZCode 依据：[进程管理器](https://github.com/zai-org/ZCode/blob/a9fe401eede6e6e5e01be9048679c206fe6f02d9/packages/services/src/zcode-agent/zcodeAgentProcessManager.ts)、`zcodeProtocolClient.ts`、`packages/rpc/src/persistent-protocol.ts`。

ZCode 存在 `app-server --stdio`、能力查询、session lifecycle 和 v4 conversation 订阅。观察状态不应顺带启动/重启 runtime；一个 session 超时也不应杀掉整个 workspace runtime。其持久连接协议有 ACK 和 replay，但缓存有界，溢出需要重新订阅；这不是跨进程崩溃的持久事件日志。恢复时使用显式 session ID，不能依赖并发环境中的 latest。

## bb：最贴合的宿主边界

依据：[system-overview](https://github.com/get-bb/bb/blob/7c1353d80729983b86ea1555d18b42407f320406/docs/system-overview.md)、[provider bridge](https://github.com/get-bb/bb/blob/7c1353d80729983b86ea1555d18b42407f320406/docs/provider-bridge-protocol.md)、`apps/host-daemon/src/runtime-manager.ts`、`event-sink.ts`。

bb 把 desktop shell、共享 web 客户端、服务端状态和执行宿主分开。这里 provider 指 harness，而不是模型供应商。适配器将原生事件转成小范围的语义 delta，再由公共层组装 timeline，让桌面、网页和 CLI 获得相同语义。能力握手与版本检查比“所有 harness 都实现同一个理想接口”更可靠。

这正适合我们的多 harness 直接聊天。第一版可把状态服务和执行宿主放在同一个 Node 进程，保留边界即可。不过其 `event-sink.ts` 的发送队列是内存数组，不能仅凭存在 retry/flush 就声称崩溃后事件不丢。我们的 accepted 命令、关键事件和 wake 待办需要持久保存。

## Codeg：原生历史补充实时协议

依据：[background_watch.rs](https://github.com/spacering-net/codeg/blob/da2354235b67d04e94d1009781dee58516a4bd04/src-tauri/src/acp/background_watch.rs)、`src-tauri/src/acp/agent_session.rs`、`src/lib/transport/`。

Codeg 是本轮功能范围最接近的候选之一：多 harness 聊天、历史、桌面和远程 web 共存。源码区分 Tauri 与 web transport，说明多端可以共享产品 UI，而不把本地 IPC 泄漏到每个组件中。

它对 Claude 的后台观察尤其有价值：某些后台子任务和自主回合未被 ACP wire 完整表达，于是增加只读 transcript tail；用 prompt ledger 避免把前台已有流重复渲染；用后台任务状态避免空闲清理误杀仍工作的连接。轻量文件检查与模型循环查询是两回事。

这些实现只证明该版本的补偿策略，不能推广为所有 harness 的普遍事实。我们的观察器必须记录来源、版本和置信边界，无法确定时保留 unknown。已查看浅色工作区截图：清晰、覆盖范围广，但 IDE 工具与入口密度高。结合 Rust/Tauri 宿主成本，选作适配参考与 UI 备选，优先级低于 Craft 的界面提取方案。

## CodexHost：监控 API 小，停止语义不能小

依据：[thread-watch 设计](https://github.com/BytePioneer-AI/codex-host/blob/4d6ee40fcc38cc0f7c7758e4d81cc445197a9aee/docs/architecture/thread-watch.md)、[delegation-watch.ts](https://github.com/BytePioneer-AI/codex-host/blob/4d6ee40fcc38cc0f7c7758e4d81cc445197a9aee/packages/host-runtime/src/delegation-watch.ts)、`delegation-watch-store.ts`。

watch 构建在公共 read/send 上，不依赖特定 harness 或委派树；显式注册，观察运行停止后通知，可以持久化，也能聚合同一目标的通知。默认 2 秒宿主查询不消耗模型推理。通知明确声明：停止不等于工作正确或验收通过。

其实现区分发送被明确拒绝与结果未知，这是应采用的语义。另一方面，本快照文档没有 cancel/unsubscribe 操作；停止通知目标不等于撤销 watch。源码还明确说明，递送中崩溃可能在恢复后重复通知。我们的产品需要可撤销 watch、generation 校验和停止后的自动命令失效，不能照搬“恢复即再发”。

它提供独立 host 和 web 客户端，但在 Codex Desktop 内展示其他 harness 的路径具有版本依赖。本项目应拥有自己的 desktop 和公共会话协议。此处仅借鉴已公开源码的结构，不采用其 Desktop 集成作为必要运行前提，也未复制 LGPL 代码。

## Magpie：配置和计费必须保留来源

依据：[profile.go](https://github.com/yetone/magpie/blob/6a450c49827d08965d5fe164d94ce502587d1571/internal/profile/profile.go)、`internal/agentenv/agentenv.go`、`internal/usage/usage.go`。

本轮将用户提到的 Magpie 对应到 `yetone/magpie`。重点是 named profiles、不同 agent 的配置映射、实际请求路由和用量。它还具有会话索引/重新打开入口，但不能由此视为完整的直接聊天与持续托管内核。

采用：profile 修订绑定到实例/运行，保存 requested model 与 served/billed model，区分 provider/account 和会话发起者，缓存字段未知不写成零。2026-11-11 用户已明确提出独立 Provider、模型发现、参数自动填写和协议转换需求；配置目标因此扩展为 Provider / 模型库 / harness 绑定分离。详细源码结论、十种模型目录来源、版本边界和未实现项见 [配置专项调研](provider-configuration.md)，新增固定来源见 [专项证据](provider-configuration-sources.json)。本地转换网关纳入该配置改造，尚未实现或验收，不能据参考项目已有网关而宣称本产品已支持。

## Pebrel：后台驻留不等于持久执行

依据：[residency.rs](https://github.com/Kuddev/pebrel/blob/0ed1a041a21681022b984546c926e15de8688d7e/nebula_app/src/gpui_shell/workspace/residency.rs)、`nebula_app/src/gpui_shell/session_restore.rs`。

Pebrel 的 Rust/GPUI 终端与 SSH 体验有参考价值。keep_session 路径隐藏窗口并保留进程中的 PTY；session restore 保存布局、目录和 agent 身份。前者是驻留，后者是重建界面及使用 CLI 恢复，不代表原进程在应用退出后继续执行。

我们的界面应同样明确“关闭窗口继续运行”“退出并停止”“下次恢复会话”。Pebrel 不是统一结构化聊天组件库，手机界面复用成本也高，因此仅作生命周期与终端体验参考。本轮未复制其 GPL 代码。

## 补充候选：Craft、Harnss、Orca、CC Switch

Craft 的 Electron/React、语义 tokens、TurnCard 和聊天布局最适合视觉 baseline。源码 backend factory 实际选择 anthropic 或 pi；即使 pi 使用 OpenAI 模型，也不能说已经拥有原生 Codex 适配器。`AppShell.tsx` 约 2,900 行，耦合 contexts、Jotai 和业务；需要有边界地提取，不能称为即插即用组件。`SessionViewer` 是只读展示，不能拿来冒充输入闭环。完整决策见 [desktop baseline](desktop-baseline.md)。

Harnss 已有 Claude SDK、Codex app-server、ACP 的三类接入，适合核对 adapter 细节。但 `electron/src/main.ts` 的 window-all-closed 路径停止三种引擎并清理终端，不能作为本产品持久运行的默认语义。项目自述仍在早期并计划重大重写，增加整体 fork 风险。

Orca 的 daemon session attachments 和 PTY checkpointing 展示了客户端 detach、存活进程与显示状态重建的分离。可学习重连，不把终端快照当作原生任务完成事件。其多平台 daemon 范围较大，不整体引入。

CC Switch 的 provider 服务和各 harness session_usage 解析可参考配置与历史统计。对我们而言，历史统计仍须和实时增量对账，避免恢复后重复计费；不能把配置切换工具当作实时会话宿主。

补充核对其固定提交的模型配置路径：`services/model_fetch.rs` 主要获取模型 ID，`src/lib/modelMetadata.ts` 再按 endpoint 和模型逐字段合并预设与 models.dev 资料；价格单独维护。Magpie 同样将实时列表、元数据目录、Provider 和生成的原生配置分开。两者的具体对比与采用边界见 [配置专项调研第 2 节](provider-configuration.md#2-cc-switch-与-magpie-实际怎样做)。

## 尚未验证的内容

没有一个参考项目可证明我们已经拥有目标 harness 的完整直聊、恢复、后台执行与手机体验。用户后续将首轮范围收敛为原有六种加 Gemini CLI、Cursor、Kimi Code、Grok Build，详见 [接入清单](harness-catalog.md)。下一阶段需分别验证固定安装版本、原生事件、停止与恢复、配置隔离、Windows 独立 host，以及 Craft 组件提取成本。外部正在运行的会话接管是独立验收项。

本轮不按 stars 排名，也不把检索热度当作稳定性。GitHub 未认证 API 曾触发限流，随后使用仓库页面与 git 源码；没有声称穷尽全部同类项目。上游截图只用于视觉判断，不是本地运行证据。所有建议的具体工程接口见 [设计方案](design.md)。


## 三层配置与公开模型库后续核对（2026-11-12）

[当前代码审计、公共来源与更新机制](model-catalog-sources.md) 已核对单模型 Profile 与三层目标的差距，实取 models.dev 的 Provider/规范模型/合并目录、OpenRouter 目录及官方模型 API 文档/schema；ETag 304、字段覆盖与 MIT 许可证均记录在 [机器可读证据](model-catalog-sources.json)。这次允许自动填参后的手工覆盖与恢复自动，修正上一批只读目标；在线更新器、覆盖编辑器、三层迁移与网关仍未实现。没有新发模型请求或把此前产品测试当成本次新增功能验收。
