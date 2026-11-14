# Harness 生命周期与交互恢复增补

日期：2026-11-13。接续 [上一批增补](test-results-2026-11-13-harness-followup.md)，保留工作区已有及并行改动。本轮主要完善共享 ACP、OpenCode V1、Kimi Server 与 Host 收件箱，不将未确认的厂商能力标为完成。

## 实现

| 范围 | 已实现 | 语义边界 |
| --- | --- | --- |
| Cursor / Gemini / Grok / Kimi ACP | 在模型、思考档位和权限模式准备前占用发送槽；重复发送被拒绝；准备时取消或关闭后不会补发 prompt | 配置 RPC 可能已改变原生配置，但未递送用户输入；准备完成前保留发送槽，避免配置响应串到下一轮 |
| ACP 递送状态 | 尚未发送 prompt 的准备失败明确拒绝；已经发送后断开继续保留递送结果未知 | 不把连接中断误判为安全未发送，不自动重发 |
| OpenCode V1 | 先订阅 SSE，再读取 /permission 与 /question；恢复当前 session 的待处理交互；实时事件与快照去重；处理 replied / rejected 原生事件 | 只恢复明确属于当前 session 的请求；不创建额外会话或发送 prompt；列表损坏或请求失败会显式报错 |
| Kimi Server | pending 交互去重；ended 事件撤销本地待答；关闭或断流后迟到回调不再发送原生审批 | 不依赖回合结束撤销其他代理仍活动的交互；不推断未知 kind |
| Kimi 原生回答 | 支持批准 / 拒绝 / 取消、session scope、feedback、selected_label；保留 single / multi / other / multi_with_other / skipped 五种问答编码和 method / note | 以原生交互 kind 为准，客户端不能覆盖成另一类请求；无效结构在 HTTP 提交前拒绝；本轮未添加 Kimi 专用表单，仍使用 JSON |
| Host 收件箱 | 原生已处理或撤销的交互可单独失效，阻止另一设备再批准；最后一个原生已解决交互可退出 waiting-input | 不影响同会话其他待答请求；连接关闭导致的撤销不被当作原生继续运行 |
| 原生进程 | Kimi 关闭等待确认退出，超时明确失败；Kimi / OpenCode 共享关闭 Promise；关闭中断待处理 HTTP；原生启动 spawn 错误显式返回 | 不终止其他原生应用，不把超时等同退出成功 |

主要实现：packages/host/src/harnesses/acp.ts、native-interactions.ts、kimi-interactions.ts、opencode.ts、kimi-code.ts 与 packages/host/src/session-service.ts。NativeQuestions.tsx 仅移除并行界面改动中的未使用解构参数，保留其 props 和行为。

## 协议依据与测试

- OpenCode：本机原生 /doc 导出的 .local/opencode-openapi.json，PermissionRequest、QuestionRequest、EventPermissionReplied、EventQuestionReplied、EventQuestionRejected 以及 V1 GET /permission、GET /question。
- Kimi：已安装 @moonshot-ai/kimi-code/dist/main.mjs 中 Server 2.5 的 interactionEventBaseSchema、interactionRespondRequestSchema、questionAnswerSchema。状态是 pending / ended，回答通过公开 Server 路由提交。
- 合成协议回归使用可控配置响应和原生风格事件，验证重复发送、准备时取消 / 关闭、已发送后断开、交互快照与事件重复、外部回答、关闭后迟到回调。它们验证 Host 转换和生命周期，不冒充真实模型工具执行。
- Host 全套：npm test，当前工作区 **256 / 256** 通过；.local/harness-lifecycle-tests.log。该总数包含工作区其他已有/并行测试，不全部归因于本轮。
- Typecheck：npm run typecheck --workspaces --if-present，通过；.local/harness-lifecycle-typecheck.log。
- ESLint：npm run lint，通过；.local/harness-lifecycle-lint.log。
- 完整构建：npm run build，通过；.local/harness-lifecycle-build.log。使用 .local/build-temp/harness-lifecycle 隔离 Windows 临时文件；仍存在已有的大于 500 kB 分包警告。
- 原生只读：npm run verify:harness-inspection，**11 / 11** 通过；.local/harness-lifecycle-inspection.log。覆盖四种 ACP initialize、Cursor / Grok / Kimi 原生列表、Cursor 已有隔离会话非空匹配及历史、Codex / OpenCode 独立列表；这些结果不等同真实模型工具验收。
- 交互 UI：native-interactions.spec.ts，**9 / 9** 通过；.local/harness-lifecycle-ui.log。覆盖 Codex / Claude / OpenCode 桌面和手机问答提交、OpenCode 审批和取消、ACP 取消与 JSON 错误保留。未重跑整个旧 UI 套件。
- 本轮触及代码的 Prettier 检查与 git diff --check 通过。

## 保留限制

Grok 原生 Read 的 workspace session not found / bind_local_session 故障仍以 [前轮复现](test-results-2026-11-13-harness-followup.md) 为准，本轮没有重跑相同失败探针或用 Host 读文件替代原生工具。Cursor 自定义 Provider、通用 ACP steer、未确认的外部会话接管、DSH/ZCode 等此前记录的原生边界均未被本轮修改成支持。此次未发送收费模型验收请求，未宣称完整旧 UI 套件通过。
