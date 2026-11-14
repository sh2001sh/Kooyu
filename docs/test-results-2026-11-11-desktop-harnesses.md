# Desktop 安装发现与原生入口复测

## 2026-11-12 全部 Harness 的安装模式核查

`npm run inspect:harness-installations` 逐个独立解析 11 个 harness 的 CLI-only 与 desktop-only 入口。这里的“可用入口”只表示找到可调用文件或本项目内置 SDK；不代表协议握手、原生账号授权、审批交互或成功模型回复。`npm run verify:desktop-harness -- <id> --source cli` 强制检查独立 CLI 来源；默认强制桌面捆绑入口。两种真实检查都在新数据目录建原生会话，不用另一来源的成功结果代替本来源。

| Harness | 本机仅 CLI（含本项目 SDK） | 本机仅桌面版（含本项目 SDK） | 本次实机结果 |
| --- | --- | --- | --- |
| Kodo、pi | 内置 pi SDK | 内置 pi SDK，独立于外部桌面包 | Host SDK 回归通过；此前真实聊天通过 |
| Codex | 独立 CLI | 桌面捆绑 app-server | 两来源均通过建会话、目录、历史、Host 重建后恢复 |
| Claude Code | 内置 Agent SDK，可优先使用已安装 CLI | 内置 Agent SDK；不是 Claude 消费者桌面协议 | Host 权限模式回归通过；此前隐藏独立 CLI 的 SDK 真实回复通过，但仅有消费者桌面登录的全新机器仍未验证 |
| DeepSeek Harness | 独立 CLI | 桌面捆绑原生入口 | 两来源均通过建会话和目录；此协议独立历史读取不支持 |
| ZCode | 本机无独立 CLI | 桌面捆绑 app-server | GUI 未运行时通过建会话、目录、历史、恢复；真实回复仍受账号资源不足阻断 |
| OpenCode | 本机无独立 CLI | 桌面捆绑 Server | GUI 未运行时通过建会话、目录、历史列表、恢复；旧桌面版默认模型回复仍受升级要求阻断 |
| Gemini CLI、Cursor、Kimi Code、Grok Build | 本机无可验收 CLI | 本机无可验收桌面包 | 仅有合成安装/ACP 合约测试；不能宣称实机可用 |

本次 Host 测试 145/145、全仓类型检查、Core 构建通过；Web 构建在改用工作区临时目录后通过。Codex/DeepSeek 的 CLI 实测是在同时装有桌面包的机器上强制选择 CLI，并非物理卸载桌面包。Codex/DeepSeek 的桌面实测强制选择桌面入口；本次未确认其 GUI 进程全部关闭。macOS/Linux 和未安装的四种产品仍需相应版本的实机验证。报告在 `.local/verification/{cli,desktop-bundled}-<id>-<timestamp>/report.json`。

## 2026-11-12 桌面关闭后的生命周期复测

在本机 ZCode 3.17.2 和 OpenCode 1.18.30 的 GUI 均未运行时，强制选择 `desktop-bundled` 原生入口。两者都通过建会话、模型目录、历史读取、Host 重建后原生 ID 保持及再次读取历史；OpenCode 还通过原生历史列表。验证命令为 `npm run verify:desktop-harness -- zcode --lifecycle` 和 `npm run verify:desktop-harness -- opencode --lifecycle`。

ZCode 原生空草稿在关闭其 CLI 子进程后不会立即留在持久库，原先恢复时报 `project.session-lineage-invalid`。Host 现在仅对自己创建且没有发送、停止或交互命令的空草稿调用原生 reconcile；确认记录缺失且未删除时，以原 ID 重建。已有发送记录的持久会话也单独通过了冷恢复与历史读取。手动绑定的外部会话和状态未知的会话不走重建路径。

本次真实发送仍受外部条件限制：ZCode 原生账户返回 `1113`（余额或资源包不足）；OpenCode 桌面版的免费模型返回 `426`，明确要求更新桌面版本。因此本次不宣称两个默认路由已取得成功回复。Host 测试 139/139、全仓类型检查、改动文件 ESLint/Prettier 均通过。报告位于 `.local/verification/desktop-zcode-1794453877016/report.json` 和 `.local/verification/desktop-opencode-1794453514503/report.json`。

日期：2026-11-11。范围：仅安装 desktop、PATH 没有 CLI 时的安装发现和原生连接。以下是本轮实际结果，先前模型/消息操作结果见 [模型复测](test-results-2026-11-11-models.md)。本轮不把“发现安装”“入口可启动”“认证”“模型真实回复”合并为一个可用状态。

## 实现

- 为全部十种 harness 及额外 Kodo 增加安装名称/常见目录发现。Windows 读取卸载注册表与 Appx；macOS/Linux 有目录及 `.desktop` 发现路径，未在这两个系统实测。
- 先复用 PATH 原生入口，否则查找 desktop 附带入口；可显式指定 desktopPath、preferDesktop，command/args 优先级最高。原生 SDK 仍可独立使用，不要求 pi/Claude 另装 CLI。
- ZCode 使用安装包内 `resources/glm/zcode.cjs app-server --stdio`，仅给其子进程设置官方 builtin provider config 路径。
- OpenCode 1.18.30 直接在安装包的 Electron Node runtime 导入其原生 Server 模块。安装 archive 保持原位，不抽取业务源码、不复制登录、不重写模型循环。服务仅绑定 loopback，使用临时随机口令与原生用户名 opencode；HTTP/SSE 均带认证。此桥适配已验证的打包布局，其他 desktop 版本需重新核实。
- DeepSeek 使用 desktop 官方 CLI 入口与自己的 Electron Node runtime；Codex 查找桌面分发的原生 binary。
- 其他 desktop 若附带相应原生 binary，按已知目录发现；只找到 GUI 时显示已发现但无法连接。Cursor 编辑器启动命令不被冒充为 cursor-agent；同名消费聊天应用也不代表编码 harness 已接通。
- 健康页新增“重新扫描安装”，展示桌面名称/版本/路径、入口来源、可启动状态与连接条件。API 为 `GET /api/harnesses/installations?refresh=1`，仍在现有认证边界内。

## 实机矩阵

| Harness | 本机 desktop / 原生入口 | 本轮真实结果 | 剩余条件或未验证范围 |
| --- | --- | --- | --- |
| pi | 独立 SDK 1.5.2 | 本轮未重测模型；此前真实聊天通过 | 不依赖独立 CLI；没有已验证的 pi desktop 分发包 |
| Codex | Appx 26.1103.4239.0 + 桌面分发 codex.exe | 强制 desktop-bundled 启动，新建、目录、发送、真实回复、成功终态、ID 保持，9/9 检查通过 | 本轮未重测 desktop 路径的恢复/审批/取消；此前 CLI 证据单独保留 |
| Claude Code | Claude desktop 4.23118.0 已发现；使用内置 Agent SDK | desktop 安装识别；此前 SDK + 原生 CLI 真实聊天通过 | 未发现可直接复用的 desktop Code 协议入口；仅有 Claude 消费者登录不能保证 Agent SDK 可用，SDK 仍需原生 Code 认证 |
| DeepSeek Harness | desktop 0.2.2-rc.1 官方 CLI | 强制 desktop-bundled 启动，真实回复和成功终态、ID 保持，9/9 检查通过 | 此前 PATH CLI 为 0.2.1-rc.2，不能混为同一版本；desktop 路径恢复等未重测 |
| ZCode | desktop 3.17.2 / bundled runtime 0.17.1 | 创建原生会话、订阅、当前模型目录、发送 ACK、失败终态均实测 | 原生 bigmodel-api/GLM-5.3 返回 429 / 1113“余额不足或无可用资源包”；未得到助手回复。需可用余额/资源包或用户已有有效原生路由；恢复/取消/交互仍待测 |
| OpenCode | desktop 1.18.30 原生 Server | health、session、新建、provider 目录、SSE、发送 ACK、失败终态均实测 | 默认路由及原生配置中的 codego1/gemini-4-argon 均返回服务 503；未得到助手回复。需原生服务恢复或已有可用模型；恢复/取消/审批仍待测 |
| Gemini CLI | 本机未发现 desktop 或 CLI | 发现规则、ACP 合约测试 | 实际安装包、原生 ACP 入口与登录待验证；同名 GUI 不能直接冒充 Gemini CLI |
| Cursor | 本机未发现安装 | 发现规则、ACP 合约；desktop-only 无入口的 UI 测试 | 需附带 cursor-agent/ACP 的实际版本和登录；编辑器 CLI 不等于 agent |
| Kimi Code | 本机未发现安装 | 发现规则、ACP 合约 | 实际 desktop 包、原生入口与登录待验证 |
| Grok Build | 本机未发现安装 | 发现规则、ACP 合约 | 实际 desktop 包、agent stdio 入口与登录待验证 |
| Kodo（额外主 agent） | 独立 kodo 身份 + pi SDK | 本轮回归身份/UI，既有真实闭环证据保留 | 不是 pi harness 的重命名入口；原生配置授权仍分别验证 |

OpenCode `/provider` 初次返回 8,996 个全量目录项，不能当作账号可用模型。现仅展示原生 connected providers 的目录，本机当前为 13 项；connected 也不保证模型授权/服务可用。一次手动验证选择了旧 JSONC 中 codego/gpt-5.6-sol，原生当前配置仅识别 codego1，该请求被 ModelNotFound 拒绝；之后明确选择目录中的 codego1/gemini-4-argon 再测仍 503。没有修改用户配置，也没有静默换模型。

## 验证与缺陷修复

- `npm run typecheck`、`npm run build`、`npm run lint` 通过。构建保留 Web bundle 大于 500 kB 的提示。格式检查曾发现三个既有文件，已仅格式化修正并重新检查。
- 领域/适配器测试 **92/92** 通过，新增 7 项包括十种 desktop 发现、无 PATH 选择、覆盖优先级、GUI 与 agent 区分、ASAR 元数据更新、原生桥选择、消息角色和失败终态。合成安装包/peer 均不计作实机成功。既有测试 fixture 在关闭数据库后仍输出两条自动化暂停告警；退出码为零，本轮未将这些告警作为生产 Host 的通过证据。
- 浏览器 **14/14**：包含新增 desktop-only 无入口、desktop-bundled 来源/路径、重新扫描、真实安装 API 形状，覆盖 1440px 与 390px；不是实体手机验收。
- 本轮 UI 源码 detector 0 项；检查两视口截图，路径可换行、无横向溢出。沿用现有设计，未重做全站。
- 修复 OpenCode 的用户 part 回显被误认为助手消息：基于 native messageID/role 映射，等待先于角色到达的 part，不把用户 echo 渲染为助手回复；native error 后 idle 映射失败，不再无条件 completed。成功验收要求助手正文、成功原生终态、无错误同时满足。
- 初次 UI 测试的文本定位和路由 teardown 失败已修为精确字段断言及静态合成 snapshot；最终回归结果见上，未将中间失败隐藏为产品或环境问题。

本地证据（忽略文件，不提交运行数据）：

| 证据 | 位置 |
| --- | --- |
| Codex 最终真实 desktop 聊天 | `.local/desktop-codex-final.log`，其中含对应 report.json 路径 |
| DeepSeek 最终真实 desktop 聊天 | `.local/desktop-dsh-final.log`，其中含对应 report.json 路径 |
| ZCode 失败及原生错误 | `.local/verification/desktop-zcode-1794410393754/state.sqlite`：turn-ended.error / control.lastError；原 report 的 error 数组未覆盖终态错误，不能用其空数组判成功 |
| OpenCode 最终原生失败 | `.local/verification/desktop-opencode-1794410926358/report.json`；nativeTurnSucceeded/nativeReply/noNativeError 均 false |
| 工程与自动化 | `.local/desktop-final-{typecheck,build,lint,tests,format}.log`、`.local/desktop-ui-verified.log`（14 项）、`.local/desktop-ui-details.log`（3 项最终截图复核） |
| UI | `output/playwright/desktop-installations-{1440,390}.png`、`.local/desktop-ui-detector.json` |

## 使用与后续验收

构建后启动或在任务结束后重启独立 Host，再打开“Harness 与配置 → 重新扫描安装”。已有 Host 不随构建热更新，本轮保留原有 Host/桌面任务，不自动结束它们。

自定义安装可在 Host 数据目录的 installations.json 配置，例如：

```json
{
  "zcode": { "desktopPath": "D:/Program Files/ZCode", "preferDesktop": true },
  "opencode": { "desktopPath": "C:/Users/你的用户名/AppData/Local/Programs/@opencode-aidesktop", "preferDesktop": true }
}
```

标准安装无需此配置。可运行 `npm run verify:desktop-harness -- zcode` 验证原生握手；加 `--chat` 才发一条真实请求，`--model provider/model` 明确选择已有原生模型。脚本使用新数据目录/原生会话，要求 source=desktop-bundled，不会用 PATH CLI 成功代替 desktop 成功。发送产生真实用量；终态失败返回非零退出码。

本轮已实现全部入口的桌面发现及上述四种实际桌面运行入口，**没有完成“所有 desktop 版本均可聊天”的普遍保证**。其余版本缺协议桥的功能缺口、账户资源不足和模型服务故障分别记录；不会通过模型 API 或 GUI 自动点击掩盖缺口。跨平台、实体手机、全部 desktop 版本的登录/恢复/取消等继续按 [测试大纲](test-plan.md) 逐项验收。
