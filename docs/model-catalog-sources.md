# 三层配置审计与在线模型参数来源

核对日期：2026-11-12（Asia/Shanghai）。本页主体保留**实现前的只读审计快照**；该次审计没有修改代码或发模型请求。后续已实现三层配置、手工覆盖和运行时目录刷新，另有真实模型调用，见 [新实现与验证](test-results-2026-11-12-providers.md)。历史抓取证据见 [机器记录](model-catalog-sources.json)，其中新增 followup 字段指向本轮结果。

## 实现前代码审计快照

| 层 | 当前代码事实 | 最新目标仍缺少的部分 |
| --- | --- | --- |
| Provider | `ModelProfile` 同时包含单个 provider、model、baseUrl、protocol 和 credentialRef；`profileSchema` 仍是这一形状 | 独立 Provider / 多协议 endpoint、独立模型列表地址、Provider 修订、认证修订范围的模型发现 |
| 模型库 | `HarnessModelOption` 有窗口、输入/输出上限、思考档位与逐字段来源；pi SDK/原生运行报告自动读取 | 独立可持久化目录、在线同步、来源分层、手工覆盖/恢复自动值、类型化思考映射、目录修订 |
| Harness 绑定 | 会话固定 Profile 修订，部分 harness 有原生隔离映射和下一轮选模能力 | 独立绑定 Provider + endpoint + 模型库修订；十种原生配置生成；经过验证的本地转换网关 |

代码入口：`packages/protocol/src/index.ts` 的 `ModelProfile/profileSchema`，`packages/host/src/profiles/config.ts`，`packages/host/src/harnesses/models.ts`，`packages/host/src/harnesses/model-metadata.ts`，以及 `apps/web/src/components/Profiles.tsx`。当前 Profile 编辑器读取 pi 模型目录作只读预览，不能算成独立模型库编辑器。

对当前构建的 `profileSchema` 另外作了无副作用校验：新增 `endpoints`、`modelsUrl` 或 `contextWindow` 字段的三个对象均以 `unrecognized_keys` 拒绝。这直接确认现有 Profile API 还不能保存多入口、模型列表地址或窗口覆盖；没有创建真实 Provider 或写入配置。

目前 `getPiBuiltinCatalog()` 在进程中缓存安装 SDK 的目录；它不是 Kodo 自己对公开模型库的定时刷新器。原生目录刷新可以得到原生工具的新数据，但不能据此声称 Kodo 已有独立远程模型库更新机制。通用协议网关仍未实现。

用户最新要求为：**添加 Provider 的模型后自动填参，允许手工再次修改；手工覆盖独立保存且不能被自动刷新覆盖。** 这取代上一批“参数始终只读、不提供手工覆盖”的设计目标；上一批只读界面是该审计时的代码事实；后续覆盖编辑器另见最新验收。

## 已实测可获取的公共目录

以下数量只代表本次抓取快照。公共请求未使用 API key；来源缓存留在 `.local/research-evidence/2026-11-12/model-catalogs`，不作为运行依赖。

| 来源 | 可获取内容 | 本次验证 | 适用边界 |
| --- | --- | --- | --- |
| [models.dev Provider 目录](https://models.dev/api.json) | `limit.context/input/output`、`canonical_model_id`、`reasoning_options`、modalities、价格等 | HTTP 200；235 个 Provider、8,991 个 Provider-model 条目；约 6 MB | 社区维护的公开聚合目录，不是全部厂商联合签发的官方规格；按 Provider/路由匹配 |
| [models.dev 模型本体目录](https://models.dev/models.json) | 与供应商路由无关的规范模型、窗口/输出、能力等 | HTTP 200；613 个规范模型；约 514 KB | 本次所有 613 条均没有 `reasoning_options`，不能只接这个接口就宣称思考映射已齐全 |
| [models.dev 合并目录](https://models.dev/catalog.json) | 同一个快照中的 `providers` 与 `models` | HTTP 200；约 6.5 MB | 适合作为首次接入的主目录，一次刷新保留规范模型和服务路由两层资料 |
| [OpenCode 模型目录](https://models.opencode.ai/api.json) | 与 models.dev 相同格式的 Provider 目录 | HTTP 200；本次内容 hash 与 models.dev `api.json` 完全一致 | 可作为同源镜像；不能当成第二份独立证据增加可信度 |
| [OpenRouter 模型 API](https://openrouter.ai/api/v1/models) | `context_length`、`top_provider.max_completion_tokens`、`supported_parameters`、部分 `reasoning.supported_efforts/default_effort/mandatory` | HTTP 200；466 条，`links.next=null`；无需账号凭据即可抓取此次公开列表 | 对 OpenRouter 自己的路由最有参考价值；不能把它的价格、额度或上限复制到其他转售 endpoint |

models.dev 提供 MIT 许可证。本次另行固定仓库提交 `73e0b67d6484e870ab330ab3559a1b1bcea74a52` 读取 README 和 LICENSE，确认其社区贡献、TOML 维护、自动生成公共 JSON 的方式。源码提交与在线 JSON 分别保存 hash，**没有假设在线服务恰好由该 commit 生成**。

本次 Provider 目录中，8,991 条记录有 8,833 条提供正整数上下文、8,733 条提供正整数输出上限、5,788 条提供非空 `reasoning_options`。字段覆盖并不完整；没有思考选项的记录不能自动补成 low/medium/high。

### 思考参数已经有公开结构化来源

models.dev 的 Provider 条目本次实测包括：

| 精确 Provider / Model ID | `reasoning_options` |
| --- | --- |
| `openai / gpt-5` | effort：minimal、low、medium、high |
| `anthropic / claude-sonnet-5-5` | effort：low、medium、high、xhigh、max |
| `google / gemini-2.5-pro` | budget_tokens：128–32768 |
| `deepseek / deepseek-v4-flash` | toggle，加 effort：low、high、max |

这说明模型库需要表达 **开关、枚举档位、token budget 和 wire 映射**，不能继续只用 `reasoning: string[]` 表示全部能力。模型目录的合法值还要与绑定 harness 的实际协议、版本与协商能力核对；用户覆盖模型资料不能凭空增加原生不支持的设置命令。

## 官方模型 API 也能自动补参，但各家信息不同

| 官方来源 | 本次核对的文档/schema | 结论 |
| --- | --- | --- |
| [Anthropic Models API](https://platform.claude.com/docs/en/api/models/list) | 当前官方文档的 `ModelInfo` 包含 `max_input_tokens`、`max_tokens`、`capabilities`；示例能力对象含 effort 支持项 | 可作为 Anthropic endpoint 的窗口/输出/能力来源，优先于聚合目录。实际账号调用和自定义 endpoint 是否返回这些字段**本次未验证**；文档占位示例中的 0 不作为实际限制 |
| [Google Models API](https://ai.google.dev/api/models) / [官方发现 schema](https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta) | `Model.inputTokenLimit/outputTokenLimit/thinking/supportedGenerationMethods` | 能取得输入与输出限制、思考布尔能力；布尔值本身仍不足以推出具体 effort 或 budget。实际模型列表通常需要账号 key；本次只读取公开文档/schema |
| [OpenAI Models API](https://developers.openai.com/api/reference/resources/models/methods/list) | `id/object/created/owned_by/shutdown_date` 等列表字段；没有窗口或 effort 字段 | 普通 `/models` 不足以自动补齐窗口和思考档位；需要明确来源的目录与原生能力协商，缺失时才看官网 |

Claude Agent SDK 的 `supportedModels()` 与 Anthropic 远程 Models API 不是同一个接口。上一批确认“SDK ModelInfo 不含窗口”仍成立；本次确认远程 Models API 文档已有更丰富字段，不能把这两个结论混为一谈。

## 自动更新实施规则与实现边界

下面保留此前确认的完整目标。当前已接入 models.dev 主目录的在线刷新、SDK 离线目录、逐字段来源、覆盖与不可变绑定；下列“原生元数据冲突双值展示”、第二独立 feed、全部 Harness 原生配置映射仍未完成，不能把整张目标清单视为通过：

1. Provider 保存多个 endpoint，每个 endpoint 明确协议、base URL、models URL、凭据引用和修订。先读取当前 endpoint 的模型列表以确定 wire ID；模型库自动补元数据，不替换 wire ID。
2. 优先导入 `catalog.json`，用规范模型建立搜索索引，再以 Provider 条目的 `canonical_model_id` 建立显式关系。自定义转售模型名与公共目录的关系不能靠删除前后缀猜测；歧义时允许用户选择规范型号或手工覆盖。
3. 自动获取值与用户覆盖分别持久化。每个字段保存来源 URL/类型、数据修订、抓取时间、hash；用户覆盖另存编辑时间与修订。“恢复自动”只删除覆盖层，不清除目录原值。
4. 默认补全顺序：用户覆盖 > 当前 endpoint/原生有效元数据 > 同 Provider 路由目录 > 规范模型资料 > 安装 SDK 快照。对来源冲突保留两值和来源，不自动取较大的窗口。原生协议明确不支持的设置仍不能通过覆盖绕过。
5. Host 按需/定期刷新目录，支持手动刷新；采用 ETag 条件请求、有限超时、大小限制与 schema 校验。此次 models.dev 已实测 `If-None-Match` 返回 **304、响应体 0 字节**。OpenRouter 响应有 `max-age=120`，缓存遵守来源规则并避免频繁请求。
6. 校验成功后原子生成新目录修订；坏数据或断网保留最后有效版本。线上修订不覆盖手工值，不静默改写运行中绑定；新绑定使用新目录，已有绑定可显式升级。
7. Harness 绑定固定 Provider/endpoint/模型目录/覆盖层的具体修订以及默认思考值。生成隔离原生配置；接口不同只选择已经实现并验证的转换方向，无可用网关时明确阻止应用。

**目录数据修订与应用版本分开**，因此公共库新增型号或修改窗口不需要 Kodo 再发版。只有新协议、schema、原生配置格式或思考映射方式需要代码支持时才可能发版。目录未覆盖、转售方改名或字段冲突时，手工覆盖用于补缺，并保留真实来源。

本次还发现同一规范关系下，DeepSeek Provider 条目报告 1,048,576 / 393,216，而对应规范模型条目为 1,000,000 / 384,000。无论差异来自单位、路由还是资料维护，都应保留来源并核实适用范围，不能简单视作等价数据。这也是三层结构和字段级覆盖必须保留的原因。

## 只读审计当时完成与未完成

已完成：当前三层实现差距审计；公共 JSON 与官方 schema 的实际读取；ETag 304 验证；字段覆盖统计；MIT 许可证与固定源码证据；最新手工覆盖需求同步。

未完成：产品中的 Provider/模型库/绑定三层改造、自动目录更新器、手工覆盖编辑器、覆盖值到十种 harness 的实际装配，以及本地协议网关。本次没有修改产品运行代码，因此没有重跑产品测试或把前一批 99 项测试作为本次新功能验证。

上述为实现前状态。后续实现已读取 `catalog.json` 的 8,991 条模型，内容修订 `23948869cc9f3a82c578241eb9d3c9d073bb930248f33209d8a2da2c0f4ed331`。24 小时缓存/维护检查、ETag、最后有效缓存、自动填参/手动覆盖/恢复自动、显式别名关联与绑定隔离均已实现；OpenRouter 可用作单个 Provider 的模型列表，不存在第二个独立后台 feed。最新实际范围、122 项领域/适配器及 17 项浏览器结果见 [验收报告](test-results-2026-11-12-providers.md)。
