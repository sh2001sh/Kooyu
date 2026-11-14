# Harness 功能补齐与验收

最新增补见 [历史树、DSH/ZCode 独立检查、Kimi 表单与真实模型验收](test-results-2026-11-13-harness-supplement.md)。下文是历史批次记录；DSH 独立历史/列表、ZCode 有界原生索引等旧缺口以增补报告为准，仍不代表所有 Harness 全功能完成。

后续增补见 [Cursor / Gemini / Grok 与交互链路](test-results-2026-11-13-harness-followup.md)：原生分页列表、跨轮审批失效、问题表单，以及 Grok 原生 Read 故障的确定性复现。下文测试数与“未重新发送收费模型提示词”仅指前一批次。

日期：2026-11-13。本批次覆盖内置 Kodo 与全部 10 种外部 harness 的公共链路和已确认的协议缺口。补齐实现不等于上游支持所有能力，也不等于所有原生账户路径均已验收。历史批次的真实模型验证仍见原报告；本批次未重新发送收费模型提示词。

## 已落地

| Harness | 本批次实现 / 修复 | 边界 |
| --- | --- | --- |
| Kodo | 不启动模型、不加载凭据的 SDK 历史读取与列表；原生身份校验；兼容旧 pi 映射 | 使用 SDK 当前分支、压缩和 context edit 的有效上下文；不重写历史文件 |
| pi | 同上；列表按 Kodo/pi 所有权隔离 | 无官方账户额度数据，保持未知 |
| Codex | 独立 app-server 历史读取、游标列表、重复游标保护；隔离绑定 CODEX_HOME | 不启动/恢复 thread；原生额度仍取决于登录类型 |
| Claude Code | 独立 SDK 历史/列表；按绑定 CLAUDE_CONFIG_DIR 隔离读取 | SDK 历史在子进程读取隔离目录，不修改 Host 的全局环境；沿用 SDK 消息链语义 |
| DeepSeek Harness | 使用 session/wait 确认主代理和受管理后代空闲；过期等待回执失效；enqueue messageId 不再冒充 turn ID；aborted 不再误报完成 | 无已验证的独立历史/列表和 steer；取消仍是退出原生运行时后恢复相同会话，不是原生单轮 cancel |
| ZCode | 按 beforeRowId 向前分页历史、检查水位/修订/纪元与游标；独立读取不建立实时订阅 | 每次最多 100 页 / 20,000 行 / 8 MiB，超限明确报错；原生列表接口尚未确认；rowsRange 可能按上游语义冷恢复投影 |
| OpenCode | 独立 GET 历史/列表，不创建会话；修复跨 chunk CRLF；SSE 意外 EOF 标记失联；清理回合思考标识 | 无已验证的运行中 steer；idle 不当作后台任务全部结束 |
| Gemini CLI | 共享 ACP 文件/终端客户端、权限选择校验、取消、恢复回放隔离、终态映射 | 保留独立原生历史扩展；不把 ACP used/context tokens 当作账单 token |
| Cursor | 新增 loadSession 历史回放读取；上述 ACP 公共服务 | 仅在原生握手声明 loadSession 时使用；无模型 prompt；普通 Agent 自定义 Provider 仍无已确认入口 |
| Kimi Code | Server 会话能力覆盖；steer 不覆盖活动轮模型/思考/权限；核验 steer 确认；空闲取消拒绝；累计 usage 去重 | Server 与旧 ACP 会话保持身份边界；ACP 不声明 steer；真实 token 计量仍需原生数据 |
| Grok Build | 共享 ACP 服务及生命周期修复；保留独立原生导出/列表 | 历史批次的原生 read_file workspace 未绑定问题没有证据表明已解决；握手成功不等于工具成功 |

## 公共行为

- Session 保存原生运行时协商的能力，Host 发送/待发提升与 Composer 使用相同的 steer 判断；未协商时沿用静态能力。
- 草稿历史、无额度接口的查询及明确不支持的历史读取，不再为了检查而创建或重连代理。
- 历史检查使用绑定固定修订对应的存储目录，覆盖 Codex、Claude、DSH、ZCode、OpenCode、Gemini、Kimi 和 Grok；无需解析模型凭据或重建配置。
- 累计用量缺少 sourceId 时按原生会话去重；历史回放不产生新费用、回合结束或自动续跑事件。
- ACP 客户端实现 fs/read_text_file、fs/write_text_file 及 terminal/create/output/wait_for_exit/kill/release。文件限制 1 MiB；终端最多 16 个，输出有界且保留 UTF-8 字符边界。
- ACP 写文件/执行命令逐次请求批准；验证 session、实际路径和工作目录范围；停止使待决审批失效。写文件采用临时文件替换并保留权限；关闭与停止清理终端。此目录检查不是进程沙箱：获批命令以 Host 用户权限执行。
- ACP cancelled 映射取消，end_turn 映射完成，token 上限、拒绝及其他终止原因不再误报成功。加载历史不重放实时消息、用量或结束事件。
- JSON-RPC 关闭等待真实进程退出；未确认退出时拒绝悄悄启动替代进程。

## 验证证据

运行记录位于 .local/harness-final-tests.log、harness-final-typecheck.log、harness-final-lint.log、harness-final-build.log。新增回归覆盖 ACP 双向 RPC 文件/终端服务、取消与审批竞争、SDK/Codex/Claude/ZCode/OpenCode 独立检查、分页完整性、绑定目录、DSH 后代空闲及 OpenCode CRLF/EOF。

- Host 全量测试：**217/217 通过**（本批次开始前为 196/196）；没有跳过或待实现测试。
- TypeScript、ESLint、生产构建通过。构建仍有现有 Web bundle 大小提示，不影响成功退出。
- Harness 定向 Playwright：**16/16 通过**，覆盖 1440px/390px 安装检测、当前引擎设置界面、模型/思考、各 harness 权限和设置回执。安装用例固定 zh-CN locale，以匹配断言语言。
- 完整旧 Playwright 套件：**25/41 通过，16 项失败**，记录于 .local/harness-ui-tests.log。主要涉及旧设置/导航/Provider 页面和其他旧流程；本批次修正并重跑了其中两项安装界面用例，未把剩余旧用例计为通过，也未重新宣称全量 UI 已绿。
- 无模型调用的原生验收脚本：npm run verify:harness-inspection（先 npm run build）。结果保存为 .local/harness-inspection.json；只记录能力、条数和错误，不保存会话正文。
- 只读原生检查 **7/7 通过**：本机 Gemini 0.67.0、Cursor Agent、Kimi 2.5.2、Grok Build 的 ACP initialize；Cursor 既有隔离测试会话 load 历史返回 5 条消息；Codex 独立列表返回 355 条；OpenCode 独立列表返回 11 条。条数是本次运行快照，不是测试写死的预期值。
- 本机 Kimi 2.5.2 的 Server 源码确认 prompts::steer 成功响应包含 steered: true。此源码核对不代替真实运行中 steer 全链路验收。

## 尚未证明或上游不提供

1. 所有外部活动会话的跨进程监控/写入接管，未获原生协议授权，不宣称支持。
2. DSH 独立历史/列表、ZCode 原生列表、通用 ACP steer，以及各家缺失的可靠费用/额度接口，不用模拟实现或默认零填充。
3. 各安装版本上的真实取消、复杂问答和审批仍需逐个账户验收；合成 peer 只证明协议与 Host 行为。复杂问答仍可使用原生结构化 JSON。
4. Grok 原生 Read 错误、Gemini Google 直连凭据路径，以及旧版/不同安装版本兼容性，沿用上一批次的限制。
5. 附件多媒体、原生删除/回滚、所有历史规模的无限分页、跨执行 Host 调度与真实手机/TLS，不属于本批次已验收范围。

## 协议依据

- ACP：安装的 @agentclientprotocol/sdk v1 types.gen.d.ts；对应 fs、terminal、permission、usage 和 session/load 协议。
- DSH：固定源码 .local/research/deepseek-harness/packages/sdk/protocol/src/types.ts 和 packages/sdk/server/src/server.ts；prompt 是 durable enqueue，wait 等待受管理后代。
- ZCode：固定源码 .local/research/zcode/packages/shared/src/zcode-protocol-v4/transport.ts；rowsRange 使用排他的 beforeRowId 游标和 atSeq/atRevision/atLogEpoch。
- Kodo/pi：安装的 pi-coding-agent SessionManager / buildSessionContext；读取避免调用可能迁移并重写原生文件的 SessionManager.open。
- Kimi：本机 @moonshot-ai/kimi-code 2.5.2 Server 路由实现；Cursor/Gemini/Grok 使用真实 initialize 的能力声明。
