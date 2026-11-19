# gemini-4-argon 列表存在但调用返回 404

检查时间：2026-11-18 03:26–03:28 UTC（中国时区 11:26–11:28）。

## 生效配置

- 截图对应的新 Claude Code 会话为 `f28fa443-7006-4c5b-9dc3-3b2cc4313b50`，绑定 `4cfbbba5-f7ee-44f0-8a74-468549fd9266:1`，引用 carbon Provider 修订 11。
- 之前失败会话的绑定引用同一个 Provider 的修订 8。两个冻结修订实际使用相同地址和相同凭据；本次未修改凭据、绑定、模型或权限。
- 有效地址 `https://codegoai.com`，协议 `anthropic-messages`，模型 `gemini-4-argon`，路由 `direct`。不存在绕过该绑定调用官方默认模型的证据。

## 独立最小请求结果

使用该绑定现有凭据直接诊断 Provider；仅发送 `Reply OK.`，输出上限 8 token，没有工具、项目内容或生产会话消息。凭据仅保留在进程内，没有写入报告或诊断输出。

| 接口 | 模型 | 结果 |
| --- | --- | --- |
| GET `/v1/models` | — | 200，15 个模型，包括 `gemini-4-argon` 和 `gemini-4-carbon` |
| POST `/v1/messages` | `gemini-4-argon` | 404，`not_found_error` / `Resource not found` |
| POST `/v1/messages` | `gemini-4-carbon` | 404，`not_found_error` / `Resource not found` |
| POST `/v1/chat/completions` | `gemini-4-argon` | 404，`upstream_error` / `Resource not found` |
| POST `/v1/messages`，流式 | `gemini-4-argon` | 404，相同错误；响应声明 `text/event-stream` |

请求 ID：

- Argon Anthropic 非流式：`2026111803263137611657036468c0ecqjnV6st`
- Carbon Anthropic：`2026111803265655151984936468c0eV495WqNV`
- Argon OpenAI：`2026111803265924123662836468c0ejOTuc37e`
- Argon Anthropic 流式：`202611180327562648663136468c0e725EXGJp`

## 结论与边界

用户说 Provider 有该模型属实。模型列表与生成接口可用性是两项不同检查；本次列表成功，但生成请求被 Provider 或其上游返回 404。错误可以在不经过 Kooyu 和 Claude Code 的最小请求中复现，因此并非只有桌面模型选择或 Harness 才出现。

Claude Code 展示“模型不存在或无访问权限”的消息不能证明该模型没有列出；本次直接获得的原始错误为 `Resource not found`，OpenAI 兼容入口进一步标记为 `upstream_error`。两种模型和两种协议都失败，现有证据更指向该入口的生成请求路由或上游资源问题。具体是网关路径、模型映射、上游资源/权限还是服务异常，必须由 Provider 结合请求 ID 的内部日志确认；没有据此断言账号无权限或模型不存在。

未自动切换 Provider、模型或协议，未重发用户原始任务。诊断数据 `.local/argon-provider-diagnostic.json`，脚本 `.local/diagnose-argon-provider.mjs`。
