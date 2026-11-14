# 引擎状态与离线子代理历史增补

日期：2026-11-13。接续 [Harness 增补](test-results-2026-11-13-harness-supplement.md)，记录本轮实际实现和证据。

## 本次修复

1. **不展示实现情况**：移除根据 implementation:partial 显示的「部分功能」。引擎列表仅展示可用、未安装、安装中和需设置启动入口等运行状态。底层能力判断继续用于选择有效操作。
2. **Claude Code 离线子代理历史**：使用已安装 SDK 的 listSubagents / getSubagentMessages 补充独立读取和重连补抓。包含主会话消息、子代理消息、父子关系及完整性；根据 SDK 元数据把历史 agent ID 对应到实时工具 ID，恢复回答、思考和工具记录。读取在独立子进程使用绑定的 CLAUDE_CONFIG_DIR，不修改 Host 环境，不发送模型 prompt。
3. **OpenCode 思考历史**：此前 reasoning part 只登记类型而忽略快照 text，导致恢复时丢失思考。本次恢复思考快照，并保留后续增量通道与稳定去重标识。
4. **思考快照展示**：Transcript 原先仅把 text-delta 的 thought 通道当作思考，message 思考快照会被当作普通回答。本次统一放入思考区域，完整快照替换同一 item 的流式前缀，重复快照更新原条目。

Claude 每页 500 条、最多 100 页、最多 1,000 个子代理，返回正文累计上限 8 MiB；子进程沿用 20 秒超时和输出上限。校验消息身份、重复分页、父级、工具身份冲突及关系环。空或不可读子代理保留错误并返回 complete:false，不回放历史费用或父代理回合终态。旧 CLI 缺少父级或工具元数据时，仍不能据此宣称跨版本关系完整恢复。

## 验证

- Host 全量：npm test，327 / 327 通过。新增 2 项 Claude 历史测试、1 项 OpenCode 思考快照回归，并扩展 OpenCode 子树恢复验证。
- 界面专项：desktop-installations、subagents、native-interactions、onboarding，23 / 23 通过。覆盖桌面/手机标签移除、思考快照与前缀去重、子代理隔离、原生交互及可跳过的首次引导。
- npm run build、npm run typecheck、npm run lint 通过；新增及修改的历史、专项测试文件 Prettier 检查通过。
- 已检查桌面与手机截图，保留原有布局和运行状态。
- 已安装 Claude SDK 读取隔离目录的合成原生格式多层日志通过；测试中的 query 调用即失败，证明历史检查不请求模型。这不等于真实模型子代理任务验收。
- 只读探针 node scripts/verify-native-history-trees.mjs claude-code：本机原生列表返回 39 条；未找到符合隔离目录要求的既有会话，真实既有历史读取标记 not-run，不计作通过。

日志：.local/harness-next-{host,ui,build,typecheck,lint,claude-native}.log。原生报告：.local/verification/history-trees-1794574391541/report.json。探针新增按 Harness 选择的入口，不保存会话正文。

## 复核后剩余事项

| 范围 | 仍待完成 |
| --- | --- |
| 真实验收 | Codex/OpenCode 有后代的真实离线恢复；Kimi/OpenCode 运行中 steer；Claude 取消终态及跨版本恢复；各家受鉴权、模型不可用、余额或超时影响的任务，详见前轮报告 |
| 原生协议 | Gemini 独立子代理生命周期、Cursor 自定义 Provider、通用 ACP steer、ZCode 全归档枚举、pi 扩展子代理仍缺少统一可靠入口 |
| 公共实现 | 通用多媒体附件、原生删除/回滚、外部活动会话接管仍需分别设计和接入各家协议；本轮没有将本地隐藏、队列或模拟事件算作原生支持 |
| 完整 UI | 本轮执行 23 项专项；前轮全套中的旧导航等失败未在本轮全部迁移、复跑，不能宣称全量 UI 通过 |

本次未调用收费模型、修改真实账户、下载安装引擎或删除原生会话。移除实现标签不表示所有 Harness 全功能完成，以上边界继续保留在记录中。
