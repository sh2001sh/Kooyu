# 三层配置实现与验收

日期：2026-11-12（Asia/Shanghai）。本轮落实独立 Provider、模型库、Harness 绑定；下述结果按实现、合约测试、真实原生连接分别记录。十种原生 Harness 中，九种有新 Provider 隔离绑定；普通 Cursor Agent 因没有已确认的自定义 Provider 接口而禁用。机器记录见 [provider-configuration-verification.json](provider-configuration-verification.json)。没有修改 `vendor/pi`，研究缓存不是运行依赖。

## 使用与启动

```sh
npm ci
npm run build
npm run start:desktop
```

也可用 `npm run start:host` 后访问 `http://127.0.0.1:4310`。已经运行的旧 Host 不会被构建热更新；先等待任务结束、暂停托管，再按需重启以加载新增 API。本轮验证使用独立数据目录及浏览器测试端口，没有停止用户日常 Host。

界面进入 **配置 → Provider 与模型**：

1. Provider：填写名称、协议入口、地址、独立凭据，可添加多个入口和各自模型列表 URL。
2. 点击“获取模型”。自动保存 wire model ID 及入口明确提供的参数；也可手动添加服务未列出的 ID。
3. 模型库：查看上下文/输入/输出与思考参数来源，必要时选择精确公共目录条目或手工覆盖；“恢复全部自动参数”移除覆盖层。
4. Harness 绑定：选择目标、Provider/模型、默认思考强度及直连/网关，兼容性不满足时不能保存。
5. 在“按 Harness 一键配置”选择目标，预览兼容性并保存，可同时设为该 Harness 新会话的默认绑定；新建对话也能手动选择。已有会话保留旧修订。Cursor 显示原生登录提示，不开放此按钮。

## 已实现

Provider、每个入口、模型与绑定分别记录身份和修订。配置保存支持稳定请求 ID、持久回执、同 ID 异内容拒绝、并发去重与 CAS；原始密钥仅入系统 keyring。Provider 改地址/认证后要求重新获取或保存模型确认修订，不把旧账号的发现结果视为新账号已授权。旧 Profile 仅导入表示，旧修订和原生身份保持。

主目录 `https://models.dev/catalog.json` 支持 24 小时 TTL、ETag/304、内容 SHA-256、25 秒超时、16 MiB 上限、结构校验、事务替换、最后有效缓存和离线 SDK 目录。配置页在有 Provider 且目录过期时触发后台刷新，失败后至少隔一小时；Host 维护继续检查。更新模型资料无需发应用版本；新增协议/schema 支持仍可能需要代码更新。

较晚的 Gemini 网关真实验证实取 **8,988** 个 Provider-model 条目，修订 `d77a5ee25f723d11f7f9fcba4822c5610b812541f7785b763169612c31914ca1`；此前批次曾取得 8,993 条。在线目录会变动，它是社区聚合资料，不能声称全部为官方规格。优先级为用户覆盖 > 当前入口明确参数 > 精确匹配的在线/离线目录；规范模型只按明确 canonical 关系补缺。别名必须显式选择来源，不去掉 `[1M]`、模型前后缀或改 wire ID 猜匹配。

四种模型列表格式支持认证、分页、去重、20 页/20,000 条上限、每页 8 MiB/20 秒限制、禁止带凭据跨源获取/重定向、失败保留整份旧列表、关闭时 abort/await。这些格式的官方账号端点没有全部实机调用；合约通过不证明账户有模型权限。OpenRouter 可作 Provider 列表 URL，没有第二条独立后台 feed。

新绑定固定参数与来源，按 Harness 生成独立配置。pi SDK 可按明确参数注册自定义 Provider，缺少运行必需字段时拒绝；Codex 写独立 CODEX_HOME 与 `model_context_window`；Claude 用独立 CLAUDE_CONFIG_DIR；OpenCode 1.18.30 用独立配置、limits/modalities/variants 和环境 key 引用，其 Anthropic 地址补齐 `/v1`。不覆盖用户全局配置。默认绑定跨 Harness 引用会拒绝。

网关只做单请求协议转换，模型循环和工具执行仍在原生 Harness。Claude Messages→Chat 与 Gemini Google API→Chat 均开放：文本/函数工具历史、调用 ID、SSE 增量、usage、取消与错误路径有合约测试；两条路径的原生双轮及 Read 工具往返通过。Gemini 网关提供 models、generate/stream，精确 countTokens 没有上游依据时明确拒绝；图片、签名思考、Google Search 和不可等价的思考预算不支持。loopback 临时端口/token，原始上游 key 不出 Host；失败不自动重发，上游未知错误返回不可重试响应。所有自定义绑定的价格保持 unknown，避免目录估算冒充转发服务账单，也不重复统计网关费用。

## 实际验证

| 项目 | 本轮结果 |
| --- | --- |
| `npm run typecheck` | 全工作区及 Host 测试源码通过 |
| `npm run build` | protocol / Host / web / Electron 通过；Web 主 chunk 约 548 kB，仍有 >500 kB 提示 |
| `npm run lint` / `npm run format:check` | 通过 |
| `npm test` | **137/137 通过**，包含 Gemini 网关模型查询、文本/工具/流/usage/错误/取消合约及运行时绑定 |
| `npm run test:ui` | **18/18 通过**，含新配置桌面/手机各完整一例；目录选择器的旧测试定位已更新并全量复测 |
| 桌面/手机截图 | 1440×960、390×844 已查看；无横向溢出、无 pageerror；模型字段/来源、编辑、覆盖恢复、绑定/草稿选择通过 |
| 原生绑定 | Kodo、pi、Codex、Claude Code、DeepSeek Harness、ZCode、OpenCode、Gemini CLI、Kimi Code、Grok Build 各两轮真实回复，第二轮记忆和同一 native ID 通过；Gemini 经 Chat 网关，不是 Google 直连 |
| Electron 新配置表单 | 实窗保存 DeepSeek、ZCode、Gemini、Kimi、Grok 五种绑定并设为各自默认；Cursor 禁用提示可见。窗口隐藏、重开、退出 UI 后 Host 仍运行；Playwright close 等待超时，原生进程已退出 |
| Claude 网关 | 单独两轮文本通过；另一次 Read 工具读取隔离标记文件并在第二轮保留历史通过 |
| Gemini 网关 | 0.67.0 使用现有 Chat Provider 双轮文本通过；另一次原生 Read 工具读取隔离标记文件、函数结果回传及第二轮记忆通过；均保留同一 native ID，无 Google 直连凭据 |
| Codex 网关 | 真实失败：原生工具含不可转换的自定义类型；预览、保存和运行边界已禁用，拒绝用合约测试替代成功声明 |

新增回归还覆盖：Provider 编辑往返不误传只读字段；失败分页不部分提交；旧 Profile 导入幂等；密钥轮换及匿名绑定不继承原生 key；配置请求并发/重启去重；绑定默认的 Harness 限制；新绑定账单 unknown；关闭时异步发现不在数据库关闭后写入。故障注入用例保留预期隔离诊断，Node SQLite 仍有实验性提示。

### 十种 Harness 与内置 Kodo

本表只记录本轮**新增 Provider 绑定**范围。原生配置下此前的聊天/恢复等证据保留在 [总状态](implementation-status.md)，不因缺新绑定就抹掉，也不把旧验证升级为本轮新功能通过。

| Harness | 新 Provider 绑定实现 | 本轮真实结果 | 其余限制 |
| --- | --- | --- | --- |
| Kodo（内置） | 四协议 SDK 装配 | Anthropic / deepseek-v4-flash，双轮通过 | 其他协议/模型组合待验证；保持独立 kodo 身份 |
| pi | 四协议 SDK 装配 | Anthropic / deepseek-v4-flash，双轮通过 | 其他协议/模型组合待验证，不装配产品六工具 |
| Codex | Responses 直连、独立 config | gpt-6.1-sol，双轮通过 | Chat 转换实测不兼容并禁用；工具/取消新绑定专项待验证 |
| Claude Code | Messages 直连；Messages→Chat 网关 | 原生 claude-sonnet-5-5[1M] 双轮；网关 deepseek-v4-flash 双轮及 Read 通过 | `[1M]` ID 没有精确公共目录项，参数保持未知；其他原生工具/签名思考/取消待验证 |
| DeepSeek Harness | 隔离 DSH_HOME、llm-pi-ai 插件与默认模型 | Anthropic / deepseek-v4-flash 双轮通过，同一原生 ID | 其他协议、工具、取消与计量待验收 |
| ZCode | 独立 provider_config 与有效模型规则；Host 本地凭据中继 | desktop bundled runtime，Anthropic / deepseek-v4-flash 双轮通过，同一原生 ID | 原生默认账户此前余额不足；新绑定通过另一已授权 Provider，恢复/取消/交互待验收 |
| OpenCode | 1.18.30 三协议原生配置映射 | desktop 原生运行时，Anthropic / deepseek-v4-flash 双轮通过 | 早期默认路由 503 保留；其他协议、工具/审批/恢复/取消待验证 |
| Gemini CLI | 独立 GEMINI_CLI_HOME、原生 Google 配置或本地 Google→Chat 网关 | 0.67.0 经现有 Chat Provider 双轮真实回复；原生 Read 工具、结果回传、第二轮记忆及同一 native ID 通过 | Google 直连缺凭据未验证；网关图片、签名思考、搜索、精确 countTokens 不支持；其他原生能力待验收 |
| Cursor | 普通 Agent 自定义 Provider 绑定禁用 | 按钮禁用及原因在界面和保存 API 中验证 | 尚无已确认的普通 Cursor Agent 自定义 endpoint；原生登录/模型选择路径独立存在 |
| Kimi Code | 独立 KIMI_CODE_HOME/config.toml，精确原生模型别名 | 2.5.2，Anthropic / deepseek-v4-flash 双轮通过，同一原生 ID | 其他协议、工具、恢复/取消待验收 |
| Grok Build | 独立 GROK_HOME/config.toml BYOK 模型 | 1.0.80，Anthropic / deepseek-v4-flash 双轮通过，同一原生 ID | 其他协议、工具、恢复/取消待验收 |

### PROV 用例对应

| 用例 | 本轮覆盖与未验收部分 |
| --- | --- |
| PROV-01/04/05 | 实体、入口隔离、CAS、稳定保存回执、迁移、ETag/LKG、覆盖与不可变修订自动化通过；长期保留另列 |
| PROV-02/03 | 四格式认证/字段及分页/失败保留合约通过，未知不补默认；四家官方账号列表实测未全覆盖 |
| PROV-06/07 | 上下文/input/output 分离、SDK 绑定装配、缺参数/非法 effort 拒绝；toggle/budget 仅资料存储，通用执行映射未完成 |
| PROV-08 | 九种原生入口配置映射及双轮真实回复，Gemini 使用 Chat 网关；Cursor 无已确认入口并禁用。其他协议组合未外推 |
| PROV-09 | 绑定固定模型、声明内下一轮 effort；原有设置/队列回归通过，绑定中途换模型未实现 |
| PROV-10/11 | Claude 与 Gemini 网关文本+Read 原生通过，协议工具/SSE/错误/断开取消通过；Gemini 精确 countTokens 等不支持路径明确失败；真实取消/网关崩溃后恢复待专项验收，Codex 转换明确禁用 |
| PROV-12/13 | keyring/CAS/旧引用/跨源/脱敏/价格 unknown 回归通过；自定义 Provider 实际账单定价未实现 |
| PROV-14 | 双浏览器视口配置流程、Electron 五种绑定及默认操作、独立原生双轮分别通过；真实手机/TLS 未验收 |

## 证据与复现

原始报告在 `.local/verification/provider-*/report.json`，稳定脱敏摘要见本页对应 JSON。浏览器截图在 `apps/web/test-results/providers-*/`，属于本地验收数据，不作为产品依赖。以下脚本使用已有授权配置，执行真实模型请求；缺少配置时会失败，不生成模拟回复。

```sh
node scripts/verify-provider-configuration.mjs pi
node scripts/verify-provider-configuration.mjs kodo
node scripts/verify-provider-configuration.mjs codex
node scripts/verify-provider-configuration.mjs claude-code
node scripts/verify-provider-configuration.mjs opencode
node scripts/verify-provider-configuration.mjs deepseek-harness
node scripts/verify-provider-configuration.mjs zcode
node scripts/verify-provider-configuration.mjs kimi-code
node scripts/verify-provider-configuration.mjs grok-build
node scripts/verify-provider-configuration.mjs claude-code --gateway --tools
node scripts/verify-provider-configuration.mjs gemini --gateway --tools
```

## 剩余实现与限制

普通 Cursor Agent 的自定义 Provider 入口尚未证实，因此一键绑定明确禁用。另尚未实现 Provider/模型/绑定删除、配置修订/回执的独立 GC、每个 Provider 模型列表后台定时重取、第二独立公开 feed、通用多方向网关、任意非敏感 headers/请求 URL 模板及完整冲突双来源展示。模型和 Provider 资料编辑不会自动升级已有绑定；须编辑绑定，旧会话仍固定旧修订。

模型库可保存 toggle/budget 和显式映射，但不能将其等同于任意 Harness 已提供对应操作；本轮主要开放声明内 effort。原生绑定恢复、密钥轮换后的原生实例重启、更多版本/协议/工具/计费场景继续逐项验收。实际手机、TLS、打包分发及 macOS/Linux 不由浏览器视口或本机 Electron 验证结果推断。
