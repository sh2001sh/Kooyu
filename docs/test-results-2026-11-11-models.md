# 模型切换与待发消息操作验收

日期：2026-11-11。Windows / Node 24.13.0 / npm 11.6.2。沿用固定参考提交与已安装 SDK/CLI，未修改 vendor/pi，也未将研究缓存作为运行依赖。本文接续 [启动与消息操作复测](test-results-2026-11-11-fixes.md)，只对下面列出的能力作结论；十种原生 harness 尚未全部真实验收。

## 已实现的操作

新建会话可以选择模型和原生思考档位；已有会话点击输入框下方的“模型与思考强度”即可修改。连接原生后可读取目录，读取目录不发送聊天消息。模型目录仅表示原生提供了该选项，不保证当前账号、路由已获授权。提供方和凭据仍由固定的 profile 修订控制，模型选择不会改写用户全局配置。

运行中的设置修改持久保存，下一回合才应用；当前回复和直接引导沿用当前回合设置。普通排队消息在真正递送时取最新模型/档位。设置采用请求 ID、精确回执查询和修订比较，桌面/手机并发过期写入会冲突，断网不盲目重发。发送前需要异步原生配置时，再检查停止 fence，防止停止后迟到的配置继续发送正文。

待发消息提供“修改待发消息”“立即发送”“撤回待发消息”。修改保留原 command ID 与队列位置；可保存修改，也可直接提交修改后的正文并立即发送。空闲时立即发送优先于普通待发；运行中使用原生 steer/guide，不支持插话的 harness 明确禁用并保留编辑/撤回。等待原生输入、运行状态未知或此前递送未知时禁止强行立即发送。若当前回合在实际递送之前结束，尚未提交原生的立即发送可以改为新回合；原生接受结果未知时仍先对账。

编辑/立即发送是用户接管，会暂停目标的自动续聊；其他用户待发消息保留。操作有独立请求 ID、修订和持久回执，重放原始发送请求也不会因正文被编辑而重复发送。已经交给原生的消息不提供虚假撤回。删除仍限本地会话，保留原生文件与对账身份。

## 原生模型与思考档位矩阵

下表中“真实通过”均使用现有有效登录及原生 harness 入口，同一个原生会话真实发送两轮；不是模型 API 替代或协议 peer。Kodo 为内置主 agent，不计入十种。

| 入口 | 模型/思考设置实现 | 本机真实验证 | 边界与待验证 |
| --- | --- | --- | --- |
| Kodo | SDK `setModel` / `setThinkingLevel` + SessionManager | flash / low → pro / high，通过 | 已有 codegoai 路由；其他供应商按实际登录验证 |
| pi | 独立 SDK 会话，同上 | flash / low → pro / high，通过 | 不装配 Kodo 产品管理工具 |
| Codex | app-server `model/list`，每轮 `turn/start` 的 model/effort | gpt-6.1-sol / low → gpt-6-astra / high，通过 | gpt-6-luna 在当前账号路由返回 404；目录不等于授权 |
| Claude Code | SDK `supportedModels`；query 的 model/effort，resume 原 ID | sonnet / low → opus / high，通过；新增发送前校验后已复测 | 安装的 CLI 2.1.300；不支持本接入的运行中 steer；目录控制握手设 20 秒期限 |
| DeepSeek Harness | initialize route/reasoningEffort；空闲边界重连并 `session/resume` 原 ID | deepseek-v4-flash / off → deepseek-v4-pro / high，通过 | SDK 无完整模型/档位目录，原生握手校验输入；没有单轮 cancel |
| ZCode | `sendText.modelSelection` 的 provider/model/options.reasoningLevel | 未验证；隔离 wire 合约通过 | CLI 未安装；当前只发现 snapshot 当前模型及 thoughtLevels，完整 provider registry 未接入；可填原生 ID；Profile 转换未接入 |
| OpenCode | V1 `/provider` 目录/variants；`prompt_async` 的 model/variant | 未验证；隔离 HTTP/SSE 合约通过 | CLI 未安装；仅固定 V1 路径，不泛化 V2；使用原生登录，Profile 转换未接入 |
| Gemini CLI | ACP 配置协商，优先 `session/set_config_option`，legacy `session/set_model` | 未验证；隔离 wire 合约通过 | CLI 未安装；实际模型/思考能力待握手，运行中插话未支持 |
| Cursor | 同上 | 未验证；隔离 wire 合约通过 | CLI 未安装；同上，另需核对 Windows 入口 |
| Kimi Code | 同上 | 未验证；隔离 wire 合约通过 | CLI 未安装；实际配置能力待握手 |
| Grok Build | 同上 | 未验证；隔离 wire 合约通过 | CLI 未安装；实际 agent stdio/配置能力待握手 |

ACP 的 thought_level 仅属于当前模型，不外推到目录中的其他模型。切到另一个模型后重新读取其原生选项；配置必须原生确认再发 prompt，失败不发送聊天正文。ZCode/OpenCode 的模型覆盖与原生登录可用路径已实现，不因此宣称支持任意产品 profile。

## 待发操作矩阵

| 操作 | 自动化与真实验证 | 限制 |
| --- | --- | --- |
| 修改待发正文 | 领域测试验证连接竞态、原位置、修订冲突、回执去重；真实 Codex 桌面编辑并保存通过 | 仅 accepted 的用户发送命令；已递送/未知拒绝修改 |
| 修改并立即发送 | 领域测试覆盖原子正文替换与去重 | 本轮真实 UI 分别保存修改后立即发送；原子组合路径为领域验证 |
| 运行中立即发送 | 真实 Codex 手机视口点击后以 native steer 确认，越过普通队列；原始正文不在原生历史 | Kodo/pi 既有原生 steer 已通过，本轮新增待发转换未逐一真机重跑；ZCode guide 仅合约验证；Claude、DeepSeek、四种 ACP 不承诺支持 |
| 空闲优先发送 | 领域测试覆盖连接等待期间提升第二条、先发提升项 | 实际是否仍空闲由 Host 再检查，不伪造并发回合 |
| 撤回 | 本轮编辑后撤回领域测试通过；上轮五入口真实待发撤回有独立报告 | 不等于已发原生消息撤销；状态竞争时拒绝并要求重新读取 |

## 执行结果与证据

- `npm run typecheck`、`npm run build`、`npm run lint`、`npm run format:check`：通过。Web 主 JS 约 518 kB，构建仍有超过 500 kB 的体积提示。
- `npm test`：85/85 通过，包含模型设置幂等/CAS、当前轮与排队/steer 设置边界、ACP 当前模型档位、用量按实际递送快照归属、停止 fence，以及待发修改/立即发送/竞态；自定义 pi endpoint 跨模型保留路由、单会话与未知费用也有隔离回归。
- `npm run test:ui`：11/11 通过，含桌面/390px 手机模型表单、修订保存、断网回执及旧功能回归。
- 五个本机入口各 17 个真实模型切换检查，共 85 个通过。每个均检查两轮真实回复、上下文、原生 ID、不重复设置及持久化。
- `npm run verify:models-ui`：16/16 真实 Codex 检查通过。包括编辑框使用行宽、正文持久修改、原生 steer、原请求去重、运行中切换、排队新设置、原上下文、未发旧正文、无前端异常及手机无横向溢出。
- `npm run verify:electron`：通过窗口启动、连接、隐藏、重开及 UI 退出后 Host 保持运行。已有哈希校验缓存回退、环境变量清理和软件渲染正常；Playwright 关闭等待超时与原生进程实际退出分别记录。此次为启动回归，上轮真实任务继续运行的证据仍见原报告。
- 已查看最终桌面/手机截图，并修正全局 notice 样式覆盖待发编辑布局的问题。UI detector 扫描完整 app.css 返回 82 条告警/建议，涉及既有 iOS spring、字号、圆角和色值；保留既定视觉与任务外样式，不将机械扫描说成全产品零问题。输出在 `.local/model-settings-ui-detector.json`，真实流程验收另行记录。

本地证据（开发数据与原生 ID 不作为运行依赖）：

| 验证 | `.local/verification` 下报告 |
| --- | --- |
| Kodo | `models-kodo-1794406452689/report.json` |
| pi | `models-pi-1794406347998/report.json` |
| Codex | `models-codex-1794406442575/report.json` |
| Claude 最新复测 | `models-claude-code-1794407819656/report.json` |
| DeepSeek | `models-deepseek-harness-1794406357906/report.json` |
| 最终真实 UI | `model-ui-1794407979754/report.json` |

截图在 `output/playwright/real-model-settings-desktop.png`、`real-model-settings-mobile.png`、`pending-message-edit-desktop.png`、`pending-message-actions-mobile.png`。命令日志在 `.local/model-settings-*.log`。

保留失败历史：Codex 的 luna 模型被当前账号路由拒绝，未改为静默降级。真实 UI 脚本前两次分别遇到编辑后失效的正文 locator、插话后“上一条消息”的提示歧义；已分别改为 command ID 定位和首条消息标记，并以最终真实回复复测通过，不把脚本问题记为应用成功。

## 复现与启动

```powershell
npm run build
npm test
npm run test:ui
npm run verify:models -- codex
npm run verify:models -- claude-code
npm run verify:models-ui
npm run verify:electron
```

`verify:models` 也支持 kodo、pi、deepseek-harness，依赖本机已有路由/登录并产生真实模型用量；不要用协议 peer 替代安装条件。UI 脚本自建隔离 Host 4324，普通浏览器回归用 4319，不替换用户的 4310 Host。

界面与 Host 启动仍为 `npm run start:host`、`npm run start:desktop`；使用新增 API 前需要让旧 Host 在任务结束并暂停托管后重启。当前用户的 4310 / PID 8176 没有被强行终止。真实手机 HTTPS、其余六种 CLI、外部活动会话接管、多执行 Host、完整桌面停止菜单及打包仍未验收。累计 session usage 跨模型时模型归属保留未知，不按最新选择或 profile 默认虚报分模型费用。
