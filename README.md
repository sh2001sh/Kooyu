# Kooyu

Electron + React/TypeScript 工作台，独立 Node Session Host + SQLite。桌面和手机使用同一会话协议；产品主 agent 为 **Kooyu**，内核基于 pi SDK、SessionManager 和原生 agent loop；**pi** 是另一个独立、可直接聊天的 harness。Kooyu 不计入首轮 10 种原生 harness。

当前是可构建的开发版本，**首轮尚未完成验收**。pi、Codex、Claude Code、DeepSeek Harness 已通过真实原生对话、原 ID 恢复及会话中途模型切换；Kooyu 的六工具→Codex→事件唤醒→读取→停止闭环已通过。十种入口支持桌面安装发现；新 Provider 绑定下 Kooyu、pi、Codex、Claude Code、DeepSeek Harness、ZCode、OpenCode、Gemini CLI、Kimi Code、Grok Build 已通过两轮真实对话。Gemini 使用本地 Google→Chat 网关；Cursor 普通 Agent 无已确认的自定义 Provider 接口。Kimi/Grok/Gemini 的验证版本运行在隔离环境，不代表日常环境已安装。Electron 已实际启动，窗口隐藏/重开及退出 UI 后 Host 继续运行通过。详见 [实现与验收状态](docs/implementation-status.md)。

2026-11-13 品牌正式更名为 **Kooyu**。标识与接入说明见 [品牌素材](brand/README.md)。为兼容已有数据，内部 harness ID、包名、环境变量与数据目录继续沿用原有 `kodo` / `KODO_*` / `Kodo` 键。

## 启动

需要 Node **24.13.0 或更高**、npm 11，以及各 harness 自己的原生入口与登录。支持复用桌面安装附带入口，不强制另装 CLI；仅有 GUI 而没有对应原生接口的版本会显示具体缺口。依赖与 pi 发布包由 package-lock.json 固定，`.local/research` 不是运行依赖。

```sh
npm ci
npm run build
npm run start:host
```

浏览器打开 [本地工作台](http://127.0.0.1:4310)。另一个终端执行 `npm run start:desktop` 打开 Electron；它会复用或启动独立 Host。关闭窗口隐藏至托盘；退出界面保留 Host。窗口与独立 Host 生命周期已在本机实测。

`npm run dev:web` 构建并确保独立 Host 已启动，再启动 Vite；`npm run dev` 构建后启动桌面。退出前端开发服务器不会终止已分离的 Host。修改 Host 源码后需显式重启 Host；停止 Host 前先在界面暂停托管并处理原生运行。

默认数据目录 Windows 为 `%LOCALAPPDATA%/Kodo/host`，macOS 为 `~/Library/Application Support/Kodo/host`，Linux 为 `$XDG_DATA_HOME/Kodo/host`（默认 `~/.local/share`）。可用 `KODO_DATA_DIR`、`KODO_HOST_PORT`、`KODO_HOST_URL`、`KODO_NODE_PATH` 覆盖。`host.json` 保存发现信息，`host.lock` 排除同数据目录的并发 Host。

Windows 桌面启动器会清除继承的 `ELECTRON_RUN_AS_NODE`，默认使用软件渲染；`KODO_SOFTWARE_RENDERING=0` 可显式启用 GPU。数据库 v5 包含中文搜索和旧配置清理迁移；文本合并、300 事件历史分页、异常隔离、凭据清理和数据保留规则见 [可靠性修复](docs/reliability-hardening.md)。

## 原生安装与配置

在 Host 数据目录创建 `installations.json` 可覆盖入口，例如：

```json
{
  "codex": { "command": "codex", "args": ["app-server"] },
  "opencode": { "command": "opencode", "args": ["serve"] }
}
```

标准桌面安装自动发现，可在“Harness 与配置”点击“重新扫描安装”。自定义桌面位置配置 `{"zcode":{"desktopPath":"D:/Program Files/ZCode","preferDesktop":true}}`；显式 command/args 优先。PATH 原生入口存在时默认优先，否则复用 desktop 附带入口，再使用适用 SDK。实际布局与结果见 [desktop 接入复测](docs/test-results-2026-11-11-desktop-harnesses.md)。

自定义路径优先配置原生可执行文件，或 `node` 加 JS 入口。Windows npm JS shim 按 argv 直接解析启动，不经过命令 shell；非标准 shim 需显式入口。10 种默认命令、能力与验证边界见 [接入说明](docs/harness-catalog.md) 和 [状态矩阵](docs/implementation-status.md)。

新建会话默认使用 Kooyu 主对话；切换“Harness 直接对话”可单独选择 pi 等 10 种 harness。Kooyu 与 pi 的会话、实例、默认绑定、工具和用量来源独立。

在“Harness 与配置”添加 Provider、模型和 Harness 绑定。产品凭据存系统凭据库；会话固定引用绑定 ID 与修订。新会话按显式选择 → 项目对应 Harness 默认 → 本机 Harness 默认 → 原生配置与登录继承。默认值修改只影响以后创建的会话；编辑绑定不会改变已有会话。用户全局原生配置不被改写。pi 默认只读继承 `~/.pi/agent`（或 `PI_CODING_AGENT_DIR`）的登录、模型和默认路由，Kooyu 内的 OAuth 刷新副本存系统凭据库；更改原生配置后重启 Host。原生 pi/DeepSeek 的已有模型可在会话中按 `provider/model` 明确选择。

三层配置已接入“Harness 与配置 → Provider 与模型”：**Provider → 获取模型 → 模型库确认/覆盖参数 → Harness 绑定 → 新对话的模型配置菜单**。一个 Provider 可以保存多个协议入口及各自的模型列表地址/凭据；模型按入口隔离，自动参数逐字段标明来源，允许覆盖和恢复自动。绑定保存不可变修订，已有会话继续使用创建时的修订。旧版扁平配置入口和 API 已移除；开发数据库升级到 v5 时清理旧记录，无法恢复配置的旧会话只保留历史，需新建会话继续发送。

models.dev 在线目录支持 24 小时缓存、条件请求、后台检查、手动更新和失败回退，新增模型参数无需应用发版；当前入口明确返回的参数优先。公共聚合目录不等于所有厂商官方规格，找不到精确匹配的字段保持未确认，别名可显式选择目录条目。进入“Provider 与模型 → Harness 绑定 → 按 Harness 一键配置”，选择兼容模型，预览后保存；可同时设为该 Harness 的新会话默认值。十种原生 Harness 中九种支持隔离绑定；Gemini 可经本地 Google→Chat 网关使用已有 Chat Provider，双轮真实回复和原生 Read 工具已验证，无需 Google 直连凭据；Cursor 因普通 Agent 自定义入口未证实而禁用。Claude Messages → Chat 网关也通过原生 Read 工具与第二轮历史；Codex 的 Chat 转换因自定义工具不兼容已阻止保存，使用 Responses 直连。详见 [配置实现与限制](docs/provider-configuration.md) 和 [本轮验证矩阵](docs/test-results-2026-11-12-providers.md)。

绑定会话固定模型/参数/来源，思考强度可在声明范围内调整下一轮；切换绑定模型或 Provider 当前需新建会话。使用原生配置的会话仍保留原有中途切模型能力。模型库保存 toggle/budget 资料，但本轮没有通用 budget 控件或自动协议映射。所有自定义绑定的价格保持未知，不将原生目录估算当成实际账单。

## 会话模型与待发消息

新建会话可选模型和原生思考强度；已有会话点击输入框下方“模型与思考强度”，读取原生选项后应用。运行中修改在下一回合生效，普通排队消息在递送时使用最新设置；当前回复及直接引导沿用当前模型。原生目录不保证账号授权，未知档位不伪装成通用 low/medium/high。十种实现及真实验证范围见 [模型与待发消息矩阵](docs/test-results-2026-11-11-models.md)。

待发消息可修改、撤回或立即发送。保存修改保留排队位置；编辑中也能直接发送修改后的正文。空闲时优先递送；运行中按原生 steer/guide 插话，不支持的入口明确禁用。已递送或结果未知的消息不能当作待发撤回，需先核对原生状态。

## 手机

推送 GitHub main 分支后，Actions 自动构建并发布各端安装包到 GitHub Release；正式版本使用 v版本 标签。详见 [GitHub 自动发布](docs/github-releases.md)。

本轮实现 **macOS、Windows、Linux、iOS、Android**，鸿蒙暂缓。三桌面系统延续 Electron 安装应用，随包提供独立 Node 和 Host；iOS 使用 SwiftUI，Android 使用 Kotlin / Jetpack Compose，均使用原生界面。手机通过 HTTPS 配对桌面 Host，支持会话、收发、审批、停止并暂停和断线核对。工程、构建命令与各平台验证边界见 [多端应用实现](docs/multiplatform-plan.md)、[iOS 工程](apps/ios/README.md) 和 [Android 工程](apps/android/README.md)。

桌面执行 `npm run package:desktop -- --publish never`，产物位于 `release/desktop/`；需在目标 OS / 架构构建。Android 执行 `cd apps/android && ./gradlew testDebugUnitTest lintDebug assembleDebug`。iOS 在 macOS 使用 XcodeGen 生成工程后由 Xcode 构建。现有 Web/PWA 手机入口继续保留。

Host 默认仅监听 loopback。在桌面 **设置 → 手机连接 → 生成配对码**，自动连接自建的 `relay.kooyu.app`，手机系统相机扫描二维码后通过浏览器/PWA 配对，无需用户配置域名、端口、VPN 或隧道。电脑须保持联网和 Host 运行。iOS/Android 原生客户端已实现应用内「扫描桌面二维码」，自动识别完整 Relay 地址与配对码，确认后连接；仍可手动输入。邀请两分钟内单次有效；设备 token 以 hash 保存，30 天到期，可在桌面撤销。Relay 使用 HTTPS/WSS，不是端到端加密；离线不自动重发写操作。公网浏览器、原生 bearer 协议与 Android 构建已验证，真实手机及 iOS 构建仍待验收。详见 [手机连接与自建 Relay](docs/mobile-relay.md)。自定义 HTTPS 隧道与直接 TLS 模式仍保留。

## 验证

当前配置收敛：[本轮移除记录](docs/test-results-2026-11-12-binding-only.md) 的领域/适配器 137 项、浏览器 22 项通过；未重跑真实模型连接、Electron 实窗或真实手机。此前三层配置的 [领域/适配器 137 项、浏览器 18 项及 Gemini 网关真实结果](docs/test-results-2026-11-12-providers.md) 保留为历史证据。真实手机/TLS、Gemini Google 直连和 Cursor 自定义入口未验收。复现本机已有授权路由：`node scripts/verify-provider-configuration.mjs <harnessId>`；Claude 或 Gemini 转换可加 `--gateway --tools`。脚本使用隔离目录，会产生真实用量。

逐项功能验收按 [测试大纲](docs/test-plan.md) 执行，包含稳定用例 ID、10 种原生 harness + Kooyu 的独立验收、环境条件、回归范围和结果记录模板。大纲中的用例不代表已通过。

最新 [desktop 接入复测](docs/test-results-2026-11-11-desktop-harnesses.md) 的领域/协议 92 项、浏览器 14 项通过；成功回复与账户/服务阻塞分开记录。此前见 [模型与待发消息复测](docs/test-results-2026-11-11-models.md)：领域/协议 85 项、浏览器 11 项通过；五个本机入口的真实模型切换 85 个检查通过，真实 Codex 双视口编辑/立即发送与模型切换 16 个检查通过。此前 [消息操作复测](docs/test-results-2026-11-11-fixes.md) 的真实消息 API 117 个断言及 Electron 退出后任务继续证据保留。其余原生能力、真实手机等项目仍待验收。

```sh
npm run lint
npm run format:check
npm run typecheck
npm run build
npm test
npx playwright install chromium
npm run test:ui
npm run verify:models -- codex
npm run verify:models-ui
npm run verify:desktop-harness -- zcode
npm run inspect:harness-installations
```

`npm run verify:native -- codex` 执行一条真实模型请求；`npm run verify:native-lifecycle -- codex` 验证历史、Host 重建和原生 resume；`npm run verify:supervision` 验证 Kooyu 六工具真实委派到 Codex 和事件续接。后者默认选择此机器已验证的 codegoai/deepseek-v4-flash 原生 pi 路由，可用 `KODO_VERIFY_PI_PROVIDER` / `KODO_VERIFY_PI_MODEL` 指定已有路由。这些脚本会产生真实模型用量，报告写入 `.local/verification`，未通过时返回非零退出码。`npm run verify:cancel -- pi` 实测运行中停止请求与原生终态（也支持 kodo、codex、claude-code）。`verify:messaging -- <harnessId>` 验证真实排队/撤回/查询/本地删除和按能力 steer；`verify:messaging-ui` 验证真实 Codex 双视口界面操作；`verify:electron -- --with-native-conversation` 额外验证真实任务在 UI 退出后完成。另有 `verify:live-ui`、无模型版本的 `verify:electron`。隔离协议测试使用明确标注的 synthetic peer，不能视作真实 harness 验证。CI 已添加但未声称远端运行通过。

从 [总体设计与目录索引](docs/design.md) 开始阅读。会话模型见 [session-model](docs/session-model.md)，功能范围见 [product-features](docs/product-features.md)，固定参考提交见 [research](docs/research.md) / [research-sources.json](docs/research-sources.json)。Craft tokens/Spinner 的提取、许可及品牌边界见 [EXTRACTION](third-party/craft-agents/EXTRACTION.md)；运行依赖与 Claude SDK 的独立条款见 [许可记录](third-party/runtime-dependencies.md)。上游 pi 子模块保持原样，运行使用 npm 1.5.2，与参考 main 提交的差异见 [upstream](docs/upstream.md)。

Windows 启动器先清理 `ELECTRON_RUN_AS_NODE`。若仓库位置触发已知的预启动退出码，会把同版本 Electron 校验复制至 `%LOCALAPPDATA%/Kooyu/electron` 后启动；可用 `KODO_ELECTRON_CACHE` 指定缓存位置。无需更改全局配置。当前运行中的旧 Host 不随构建热更新，使用新增 API 前须在任务结束后重启该 Host。
