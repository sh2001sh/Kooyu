# Harness 缺口补充实现与真实验收

后续增补见 [引擎状态与离线子代理历史](test-results-2026-11-13-harness-history-closure.md)：移除界面实现标签，补齐 Claude 离线子代理历史、OpenCode 思考快照及其界面展示。下文测试数量为历史批次记录。

日期：2026-11-13。本文接续 [子代理验收矩阵](test-results-2026-11-13-subagents-grok.md) 与 [功能补齐与剩余边界](test-results-2026-11-13-harness-completion.md)。本批次实际修改适配器、界面及验收脚本，并调用已安装的原生运行时做只读检查和隔离子代理任务。**仍不能标记“所有 Harness 全功能完成”。** 账户失败、原生协议边界、尚未验收与已经实现分别记录如下。

## 本批次补充实现

| 范围 | 实现 | 完整性边界 |
| --- | --- | --- |
| Codex | 独立列表遍历普通及归档线程，包含 subagent 来源；通过原生父级关系及持久化 spawnAgent 记录递归读取后代；重连恢复子代理工具、思考及回答 | 逐项核验身份；缺失子线程返回 error / complete:false；限制 100 页、1,000 节点和 8 MiB；这是读取时的快照 |
| OpenCode | 通过原生 `/session/{id}/children` 递归枚举；独立读取和恢复补抓子会话消息；先订阅 SSE，再恢复快照并处理缓冲事件 | 核验 parentID/sessionID，拒绝环和外来消息；恢复使用实时事件相同的去重键；不重放历史用量或回合结束；有界读取 |
| DeepSeek Harness | 新增无需创建/恢复运行时的独立磁盘列表及历史；识别真实 `.jsonl.zstd` 文件；选择最新规范世代，兼容 v0–v4 | 返回原始日志证据，不运行迁移或合成有效上下文；不支持更新的格式时明确拒绝；不实现原生单轮取消 |
| DSH 压缩历史 | 按上游追加格式逐帧解压 Zstandard，校验每帧及累计上限 | 真实非空历史发现 Node 单次解压仅返回头帧；已修复并用真实 55 条记录验收。损坏或未完整压缩帧拒绝读取；列表只读有界头部，大日志不阻断列表 |
| ZCode | 接入原生 `sessions-index/${cwd}` 快照订阅，复用物理分片/校验解码，验证工作区、订阅与纪元 | 返回 coverage:native-index-window、complete:false；原生窗口不代表全部归档，不能由缺席推断会话删除；检查后关闭连接 |
| Kimi | 将原生 question/request 转为表单；支持单选、多选、自定义、多选并补充、跳过和取消 | 按原生 option ID 回传；保留 method:click；不兼容的结构继续使用已有 JSON 回答入口；浏览器表单通过不代表真实模型交互已通过 |
| 验收工具 | 新增真实子代理验收脚本与只读历史检查脚本；Grok 工具脚本增加后台子代理模式 | 隔离工作区仅放随机 marker；原生子代理读取后分别核验子代理和主代理回答；按流拼接文本，排除用户回显及思考，避免分片导致假阴性 |

关键文件：`packages/host/src/harnesses/{codex-history,opencode-history,dsh-history,zcode-sessions}.ts`、对应适配器、`apps/web/src/components/NativeQuestions.tsx`。

## 自动验证

- Host 全量：**310/310 通过**，没有跳过、取消或 todo。新增历史树、世代/压缩帧、身份隔离、子代理恢复及无副作用检查。
- TypeScript、ESLint、生产构建通过；最后一次 DSH 压缩修复后再次完成 Host 构建、类型检查及回归。
- 本批次相关 UI 复跑：**14/14 通过**，覆盖 Codex/Claude/OpenCode/Kimi 问答、审批、取消及桌面/手机子代理展开。已目视检查 Kimi 桌面与 390px 手机截图，无横向溢出。
- 本轮执行过完整 UI 套件：**51/65 通过，14 项失败**。后续定向复跑不代替全量通过。失败涉及旧设置/Provider/用量导航断言、草稿默认项目文案断言、共享数据下全表数量断言及设置工作流超时；这些仍是未关闭项，未通过改产品或降低断言把它们标绿。
- 完整 UI 数量对应当时套件快照；工作区还有其他界面改动，不能推断后续新增/修改测试的状态。

日志均在 `.local/`：`harness-supplement-host.log`、`harness-supplement-typecheck.log`、`harness-supplement-lint.log`、`harness-supplement-build.log`、`harness-supplement-core.log`、`harness-supplement-ui.log`、`harness-supplement-ui-focused.log`。

## 已安装运行时的只读验收

报告：`.local/verification/history-trees-1794551152809/report.json`。以下数量为本机运行快照，不是固定预期值。

| 检查 | 结果 | 不能据此证明 |
| --- | --- | --- |
| DSH 独立列表 | 成功，210 条 | 不等于原生所有世代的有效上下文恢复 |
| DSH 本轮真实子代理任务的主会话历史 | 成功，v4，55 条原始记录；修复后无模型调用再次读取 | 不等于跨格式迁移或子代理完整历史树 |
| ZCode 原生索引 | 成功，7 条，complete:false | 不是完整归档枚举；未从索引挑到符合隔离目录条件的独立历史读取对象 |
| Codex 独立列表及既有隔离会话读取 | 成功，592 条；所读主线程 1 个 turn | 所读快照无后代，真实离线多层子线程补抓尚未验收；自动回归覆盖该行为 |
| OpenCode 独立列表及既有隔离会话读取 | 成功，12 条；所读主会话 2 条 message | 所读快照无后代，真实恢复子树尚未验收；自动回归覆盖该行为 |

DSH 非空历史单独报告：`.local/verification/subagent-deepseek-harness-1794550418012/history-report.json`。首轮只读检查读到 0 条并未作为非空验收通过；该实测促成了多压缩帧修复。

## 真实模型子代理验收

任务统一为：主代理调用一个原生子代理，子代理使用原生文件工具读取隔离目录 `marker.txt`，返回随机内容，主代理等待结果并回答。子代理输出和主代理输出分别取证。本批次未给账户充值、变更全局 Provider 或伪造不可用能力。

| Harness | 本轮结果 | 证据目录（`.local/verification/` 下） |
| --- | --- | --- |
| Cursor | **通过**：原生子代理身份、Read 工具、子代理输出、主代理输出及主轮完成 | `subagent-cursor-1794550393644` |
| DeepSeek Harness | **通过**：原生子代理身份、子代理/主代理输出、主轮完成与 settled | `subagent-deepseek-harness-1794550418012` |
| Grok 远程模型 | 失败：Authentication required | `subagent-grok-build-1794550391327` |
| Codex | 120 秒超时，未观察到子代理或可靠主轮终态；不能据此确定根因 | `subagent-codex-1794550391349` |
| Claude Code | 120 秒超时；原生状态反复 api_retry / server_error；取消有回执，但未确认原生取消终态 | `subagent-claude-code-1794550512959` |
| Kimi | 原生主轮失败：Model not set；本次原生默认配置路径未提供可用模型 | `subagent-kimi-code-1794550415061` |
| OpenCode | 重试后正常启动，模型服务返回 503 / model_not_found | `subagent-opencode-1794550622611` |
| ZCode | 重试后正常启动，模型服务返回 429 / 1113：余额不足或无可用资源包 | `subagent-zcode-1794550734676` |
| Gemini | 缺少或未配置 Gemini API key，未完成真实子代理任务 | `subagent-gemini-1794550432707` |
| pi / Kodo | 本批次未做新的原生子代理模型验收；pi 仍取决于已安装扩展，Kodo 管理会话不等于原生子代理 | 沿用历史记录，不新增通过结论 |

每个证据目录包含 `report.json` 和本轮隔离的 SQLite 事件。OpenCode/ZCode 首次验证脚本遗漏桌面入口环境的启动失败，不作为最终模型能力结论；脚本已修复为保留原生完整 launch 配置，上表引用重试结果。流式 marker 可能分成多个事件；已按子代理身份重组并从既存事件重新取证，没有因此重复收费调用。

Grok 后台子代理另有 **真实原生运行时 + 本地确定性模型服务** 的成功证据：`.local/verification/grok-native-tools-1794550180597/report.json`。本机版本 `1.0.80 (b200360b6562)`，backgroundVerification:true；原生后台子代理完成 Read、输出回传及主轮完成。这不替代上表远程账户验证。

## 仍需完成的边界

1. 先恢复各账户的鉴权、模型配置、余额或可用上游，再重跑失败项。Codex 超时仍需单独定位，不能全部归因为账户。
2. Codex/OpenCode 需要真实有后代的既有会话做断开、恢复、全量补抓和实时增量去重验收；Kimi/OpenCode 运行中 steer、Claude 各版本恢复及取消终态仍未确认。
3. Gemini 独立子代理生命周期、Google 直连和多媒体网关，Cursor 自定义 Provider 原生入口，ZCode 全部归档枚举，以及 pi 扩展子代理，仍受原生能力/配置边界约束。
4. 外部活动会话接管、通用多媒体附件、原生删除/回滚、跨安装版本兼容性，本批次未补成可全面宣称支持的能力。
5. 全量 UI 14 项失败尚未关闭；不能因本批次 14 项定向通过而宣称完整 UI 已绿。

## 重跑入口

先运行 `npm run build`，然后：

```powershell
npm test
npm run typecheck
npm run lint
npm run verify:native-history-trees
# 以下会调用已配置的真实模型；请显式传入目标 Harness，不默认扫全部账户。
npm run verify:native-subagents -- cursor deepseek-harness
node scripts/verify-grok-native-tools.mjs --background
cd apps/web
npx playwright test native-interactions.spec.ts subagents.spec.ts
```

`verify:native-subagents -- --recheck <证据目录...>` 只重算既存本轮证据，不发送模型请求。Grok 脚本使用本地确定性模型服务。新日志与旧报告分开保留，避免将不同批次、不同验证层级拼成“全面完成”。
