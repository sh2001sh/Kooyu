# 四个 ACP Harness 实机验收

日期：2026-11-12。对象：Gemini CLI、Cursor Agent、Kimi Code、Grok Build。`ACP` 是它们与 Host 通信的协议类型，不表示失败或尚未安装；`partial` 是能力验收状态。

## 本轮修复

- ACP 重启连接优先调用 Agent 声明的 `session/resume`，仅在未声明时回退 `session/load`；两种路径都有合成协议回归测试。
- Cursor 使用当前 CLI 的 `agent acp` 入口，同时兼容旧版 `cursor-agent acp`。四个安装覆盖均能被 Host 选为 `configured`。
- 原生验证脚本增加重启后的第二轮对话和同一原生 ID 检查；Read 验证按 `toolCallId` 关联 ACP 的开始与完成事件，兼容 `title` / `kind` 字段。

## 真实运行结果

| Harness | 本机运行时 | 原生聊天 / 重启续聊 | 原生文件读取 | Usage 事件 | 报告 |
| --- | --- | --- | --- | --- | --- |
| Gemini CLI | 0.67.0，Google→Chat 本地网关 | 通过，原生 ID 保持 | Read 完成，内容回传 | 有 | `.local/verification/provider-gemini-gateway-tools-1794491689696/report.json` |
| Cursor Agent | 2026.11.11-b912975，已登录 | 通过，原生 ID 保持 | Read 完成，内容回传 | 未见 | `.local/verification/configured-cursor-1794491011713/report.json` |
| Kimi Code | 2.5.2，隔离 Anthropic Provider 绑定 | 通过，原生 ID 保持 | Read 完成，内容回传 | 有 | `.local/verification/provider-kimi-code-tools-1794490642206/report.json` |
| Grok Build | 1.0.80，隔离 Anthropic Provider 绑定 | 通过，原生 ID 保持 | **失败**：`read_file` 报 `workspace session not found ... call bind_local_session() first`；显式要求绑定仍返回 `Internal error` | 未见 | 聊天：`.local/verification/provider-grok-build-1794489421472/report.json`；工具：`.local/verification/provider-grok-build-tools-1794490770187/report.json` |

Gemini 的结果证明上述网关路径，不代表 Google 直连已验收。Grok 的工具失败来自本机 CLI 返回的原生工具错误；该 ACP 会话公布的命令和工具中也没有 `bind_local_session`，不能从 Host 直接补发这个未公开操作。不能把聊天通过等同于文件操作可用。Cursor 普通 Agent 没有已验证的第三方 Provider 入口，因此仍只走其原生登录/模型路径。

## 为什么仍是 `partial`

通用 ACP 适配器不提供独立的历史读取和外部活动会话接管；运行中 steer 明确拒绝，usage / list / resume 由各 CLI 握手声明决定。下述独立历史读取是按厂商实现的额外路径。自动继续目前要求 Harness 标记 `implemented`，所以四者都保持关闭。已通过的重启续聊只证明这四个安装版本和本次会话路径，不能证明所有上述能力完整。Grok 原生文件工具还存在可复现故障。

## 回归

`npm run typecheck`、`npm run lint`、`npm test`（158/158）、`npm run build`、`npm run test:ui`（34/34）通过。UI 套件原先把共享测试 Host 的全部会话计为本例的十个草稿；断言现按本例标题筛选。`npm run format:check` 在 41 个既有工作文件上失败；本轮修改的脚本和 ACP 文件经单独 Prettier 检查。

复现命令：`node scripts/verify-provider-configuration.mjs kimi-code --tools --reopen --verification-tools`，以及 `node scripts/verify-desktop-harness.mjs cursor --source configured --command <node.exe> --arg <index.js> --arg acp --chat --lifecycle --tools`。真实验证会调用现有账号 / Provider 并产生模型请求。

## 追加：独立原生历史与列表

2026-11-12 的后续实现保留实时 ACP 连接，但为已有原生 ID 的历史读取绕过 ACP 握手：Gemini 从精确匹配 ID 的本地 JSONL 提取用户/助手/工具记录，排除 CLI 注入的 `<session_context>` 和思考内容；Kimi 通过 `session list --json` 定位有界 `wire.jsonl`；Grok 调用 `export <session-id>`。三个读取路径都限制文件/输出大小，Kimi/Gemini 忽略正在追加的半行。Gemini 和 Kimi 增加独立会话列表；Cursor 只列本地 `meta.json` 会话元数据，不解码私有 SQLite blob，因此仍无独立完整历史读取。

在既有真实会话上通过 Host API 离线复测：Gemini 5 条、Kimi 6 条、Grok Markdown 导出 246 字符、Cursor 列表 1 条；四次操作均未新增原生打开命令。Grok `usage <session-id>` 在该自定义 Provider 会话返回全部 token/modelCalls 为零，不作为可靠用量或额度。`grok sessions list` 要求有效的 Grok 登录，本机令牌已过期；保留原有 ACP 列表能力边界。

最终 `npm test` **182/182**、`npm run typecheck`、`npm run build`、`npm run lint` 与新增文件的 Prettier 检查通过。`npm run test:ui` **34/38**：Provider 移动端流程遇到 Host 连接重置；项目目录选择和桌面/移动会话检查器共三项断言与当前 UI 状态不符。本次没有把这些 UI 失败计作通过，需另行修复/复测。四种 CLI 都有 headless 单轮入口；Cursor 已通过一次只读 `stream-json` 真机请求，拿到 session ID、增量回复、成功终态与 usage。尚未证明权限请求、工具事件、取消和恢复能完整替换 ACP，因此实时连接继续使用已验收的 ACP，状态仍为 `partial`。
