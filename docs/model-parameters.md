# 模型窗口与思考能力自动读取

更新：2026-11-12（Asia/Shanghai）。本页记录已经实现和本轮验证的部分；独立 Provider、多端点发现与协议网关的完整目标仍见 [配置设计](provider-configuration.md)。

2026-11-12 后续实现：**独立模型库的自动填写、在线目录更新、手工覆盖与恢复自动已接通**。进入“配置 → Provider 与模型 → 模型库”编辑；每个字段保存 endpoint/在线目录/SDK/用户覆盖来源。Harness 绑定固定参数修订，远程更新不改旧会话。五个入口真实双轮、Claude 网关及 Read 工具结果见 [最新验收](test-results-2026-11-12-providers.md)。以下原生目录读取与上一批 99 项验收保留为历史证据，不代表最新三层全部范围。

## 使用方式与实现

新建对话的模型/思考菜单、对话中的“模型与思考强度”、旧 Profile 编辑表单提供参数预览；手工修改在独立模型库中进行。上下文窗口、最大输入、最大输出分别显示 token 数与来源；选择器只提供明确声明的档位。不根据模型名片段生成能力，不将未知填成 128K/8192。

Profile 的参数预览来自 pi 目录并按完整 Provider / Model ID 匹配，**不是所绑定任意 harness 的有效能力证明**。对话中的参数来自该原生实例；例如 OpenCode 的 variants 与 Claude 的 effort 各自使用原生值，不共用一套档位。

`HarnessModelOption` 增加 `contextWindow`、`maxInputTokens`、`maxOutputTokens`、`resolvedModel` 和逐字段 `parameterSources`。字段缺失表示未报告；空档位数组表示原生没有可选档位，不能等同于“已证实模型完全不思考”。来源包括：

| 来源 | 使用范围 | 不能声称 |
| --- | --- | --- |
| 原生 SDK 目录 | pi / Kodo 使用实际安装的 pi 1.5.2 模型对象，展示版本与来源链接 | 目录可能包含上游聚合资料，不代表所有条目都已经逐一核对原厂网页；也不证明转发服务实际遵守同样上限 |
| 原生运行时 | Codex `model/list`、Claude `supportedModels` / `modelUsage`、OpenCode `/provider`、ZCode 快照、ACP 协商 | 原生本机配置可能覆盖目录；有效配置与模型厂商的理论上限不是同一事实 |
| 本机原生配置 | 兼容既有 pi `models.json`，只显示显式声明字段，标为“非原厂规格” | 不把用户配置或 SDK 对缺省字段的回退当作官方规格 |

官方资料另行只读核对：当前 [OpenAI GPT-5 模型文档](https://developers.openai.com/api/docs/models/gpt-5) 声明 400,000 上下文、128,000 最大输出、minimal/low/medium/high，与本机 SDK 对该精确型号的记录一致。这个核对**只覆盖该型号**，不推广到其他名称、别名、账号或 endpoint。`model/list` 的能力边界按 [Codex 官方 app-server 文档](https://developers.openai.com/codex/app-server/) 与实际响应处理。来源 hash 与运行结果摘要见 [机器可读记录](model-parameter-verification.json)。

## 运行行为

- pi / Kodo 自定义 endpoint 不再注册固定 128000 / 8192、text-only 或 reasoning=false。新绑定可使用明确的模型库参数装配任意 Provider；运行必需的窗口/输出/input/reasoning 缺失则拒绝。旧 Profile 仍要求精确 SDK 匹配与协议一致。产品侧将所有自定义绑定价格保持未知。
- pi 既有原生自定义模型没有显式窗口/输出上限时拒绝启动；只有 reasoning=true、没有档位映射时不提供通用 effort 兜底。未确认参数不会要求用户手填。
- Codex、Claude 与 ACP 缺失思考声明时保持未知。ACP 的 thought_level 只属于当前协商模型；不移植到同一列表内其他模型。
- Claude 的 `resolvedModel` 只使用 SDK 明确报告的规范 ID。运行后的窗口/输出报告按精确 ID 对应回别名，不模糊匹配，也不把上一模型的窗口复制给下一模型。
- OpenCode 分别保留 `limit.context/input/output`，原生 variants 缺失与显式空集合保持不同。ZCode 只使用当前模型快照的思考档位；新模型未报告档位时必须重新读取。
- DSH 当前接入协议未提供可选档位目录，因此停止接受手写 effort。保留原生自身的运行设置，待实际协议补足能力声明后再开放选择。
- 新建和已有对话均移除了 DSH/ZCode 的自由文本档位入口；Host 设置 API 与原生发送边界同时拒绝未声明档位。已有旧档位不再被拼回可选列表；未确认的旧选择需要清空或重新选择。
- 最近使用记录不能遮掉 pi 内置目录的参数；不同原生路由的记录不借同名模型补值。显式刷新会重新发现并更新目录，不永久返回首次发现结果。

模型与档位设置仍使用稳定请求 ID、CAS 修订和下一回合快照；当前执行与 steer 保留当前回合的模型。原生配置会话支持已有中途选模；固定绑定会话目前只允许同一模型的声明内思考调整，换模型需新建绑定会话。留空档位表示交由原生管理，新绑定未显式选择时继承绑定默认。

## 本轮验证

| 检查 | 结果与范围 |
| --- | --- |
| `npm run typecheck` | 全工作区通过；新增原生缺参/缺映射测试后 Host 类型检查再次通过 |
| `npm test` | 99 项通过；新增用例覆盖来源、未知/空集合、窗口分离、模型映射、缓存刷新、非法档位与真实 SDK 装配对象。最后补强缺参拒绝断言后，相关 11 项再次通过 |
| `npm run build` | protocol / Host / web / Electron 构建通过；Vite 主 chunk 仍有大于 500 kB 的体积提示 |
| `npm run lint`、`npm run format:check` | 通过 |
| `npm run test:ui` | 首批全部 15 项通过。来源链接与列表去重后，对模型设置/配置/工作台作一次确认，10 项通过 |
| 浏览器视觉检查 | 1440×960 桌面、390×844 手机视口截图已查看；参数、来源与档位可读，无横向溢出。这里是浏览器视口验证，不冒充真实手机或 Electron 窗口验证 |
| pi / Codex / Claude 原生对话 | 三个 harness 各双轮真实回复、模型切换、思考强度切换、上下文延续、稳定原生身份与持久修订均通过，共 51 个脚本检查 |
| OpenCode / ZCode desktop 原生目录 | 复用已安装桌面应用的原生运行时；握手与目录读取通过，没有新发模型请求 |

测试出现 Node SQLite 实验性提示、既有测试环境的数据库关闭后暂停诊断，以及故障注入用例的预期隔离日志；测试计数不因此宣称运行日志全无告警。没有改动 `vendor/pi`，没有把研究缓存引入运行依赖。

### 十种 harness 的参数/验证矩阵

| Harness | 窗口/输出自动来源 | 思考能力来源 | 本轮真实验证与限制 |
| --- | --- | --- | --- |
| pi | SDK；已有自定义原生配置单列来源 | SDK 模型映射；自定义原生配置需要明确映射 | deepseek-v4-flash → deepseek-v4-pro 双轮通过；既有 codegoai 配置不冒称原厂认证参数 |
| Codex | `model/list` 未报告，保持未确认 | `model/list.supportedReasoningEfforts` | gpt-6.1-sol / low → gpt-6-astra / high 双轮通过；目录返回 8 个模型，未提供窗口 |
| Claude Code | 实际 `modelUsage` 运行报告 | SDK `supportedEffortLevels` | sonnet / low → opus / high 双轮通过；仅这两个精确模型报告了 1,000,000 窗口和 128,000 输出，不外推给其他别名 |
| DeepSeek Harness | 当前协议未报告 | 当前未开放未声明的 effort | 合约测试通过；本轮没有新作真实对话或厂商规格确认 |
| ZCode | 当前快照未报告，保持未确认 | 当前模型原生快照 | 3.17.2 desktop 握手通过；bigmodel-api/GLM-5.3 报告 low/high/max；没有新作真实对话 |
| OpenCode | `/provider.limit` | `/provider.variants` | 1.18.30 desktop 目录读取通过，13 个模型中 12 个有窗口；缺失条目不补值。没有新作真实对话 |
| Gemini CLI | ACP 未提供时未知 | ACP 当前模型的 thought_level | 合约测试通过；未作本轮真实连接验证 |
| Cursor | ACP 未提供时未知 | ACP 当前模型的 thought_level | 合约测试通过；未作本轮真实连接验证 |
| Kimi Code | ACP 未提供时未知 | ACP 当前模型的 thought_level | 合约测试通过；未作本轮真实连接验证 |
| Grok Build | ACP 未提供时未知 | ACP 当前模型的 thought_level | 合约测试通过；未作本轮真实连接验证 |

Kodo 主 agent 是独立产品身份，共用 pi 内核的参数装配与相关 SDK 测试；本轮未另外发起 Kodo 真实双轮。上表没有把 Kodo 当作独立 pi，也没有将 synthetic peer 当成真实 harness。

## 后续逐项复测

这些检查细化 [PROV-03/06/07](test-plan.md#cases-prov)，不代表 Provider/网关的 14 项完整验收已经完成：

1. 已知精确模型：三处界面自动显示窗口/上限/原生档位、逐字段来源与 SDK 版本，无数值输入框。
2. 只有 ID 的目录、未知别名、非法数字：参数未确认，不显示 128K 或通用档位，不把模型“列出”写成真实调用通过。
3. 不同 Provider、原生配置与相同型号：不跨路由填数；本机配置来源与原厂资料明确区分。
4. pi 自定义路由：检查实际传入 SDK 的上下文、输出、modalities、thinkingLevelMap 与 compat；未知或协议不匹配在创建前拒绝。
5. pi 原生自定义配置省略窗口/输出、只有 reasoning=true 而没有映射：不采用 SDK 的缺省参数启动或生成通用 effort。
6. DSH / ZCode：桌面和手机不能手写档位；直接调用设置 API 或原生发送接口提交未声明值也必须拒绝。
7. Claude：读取运行前后的参数；只给原生明确对应的规范 ID 回填报告，不给相似名称或其他模型复制窗口。
8. 真实双轮切模/改档位后：检查原生 ID、请求修订、排队快照、会话历史和停止 fence；厂商窗口未知继续显示未知。

## 启动与剩余工作

运行 `npm run build` 后按 [README](../README.md) 启动 Host/桌面；已有 Host 需要在任务安全结束后重启以加载新后端。此次保留了原本监听 4310 的 Host，没有为更新代码中断用户任务。验证数据使用独立 `.local/verification` 目录，浏览器测试使用独立 4319 端口。

最新限制：十种中的六种新增 Provider 隔离配置尚未完成；通用多方向网关、budget/toggle 调节与原生映射、真实手机验收仍缺少。公开目录是聚合资料，尚无覆盖所有型号的统一官方权威源；未知保持未确认。已实现与各入口的真实验证以 [三层验收](test-results-2026-11-12-providers.md) 为准。
