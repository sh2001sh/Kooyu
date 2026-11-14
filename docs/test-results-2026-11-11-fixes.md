# Electron、搜索定位与真实消息操作复测

运行 ID：`20261111-1904-fixes`。日期：2026-11-11，Asia/Shanghai。对应用户要求的启动修复，以及真实发送、查询、删除、撤回、排队和直接发送测试。删除/撤回按用户后续确认的“删除会话＋撤回待发消息”范围执行。延续 [首批记录](test-results-2026-11-11.md)，原失败证据保留。

本轮结果：搜索旧消息定位已修复；Electron 在本机可实际打开并连接 Host，真实 Codex 任务在关窗及退出 UI 后继续完成；Kodo、pi、Codex、Claude Code、DeepSeek Harness 的消息操作分别通过真实验证。**其余六种 CLI 未安装，十种原生 harness 首轮仍未全部完成。**

## 1. 实现变化与操作语义

| 变化 | 实际行为 |
| --- | --- |
| 搜索定位 | 结果保留 eventId；Host 按会话和事件定位，最多返回 300 个邻近事件。点击当前会话的旧命中也会重新定位、滚动并高亮；手机同样有效 |
| 原生历史快照命中 | 打开标明来源的原生快照，不制造正文事件。过期快照提示重新搜索；前端迟到响应不能覆盖新选择 |
| 待发消息 | 输入框显示尚未递送的用户命令，可从桌面/手机撤回；状态进入 cancelled，重试撤回幂等。异步连接期间仍检查命令状态，防止撤回后落到原生进程 |
| 运行中直接发送 | 仅支持原生 steer 的 harness 可用；steer 越过普通待发队列，原生 SDK prompt 等待整轮时也能收到。原生回合已经结束时拒绝，不悄悄改成新一轮 |
| 普通排队 | 保持用户消息 FIFO；前一轮结束并确认递送后才发送下一条，发送结果 unknown 时仍阻塞并要求对账 |
| 空闲发送 | 使用 new。运行中以 new 请求新一轮返回 CONFLICT；不伪称并行直接发送成功 |
| 删除本地会话 | 仅空闲且没有 dispatched/unknown 命令、没有连接创建中的会话可删除。移出列表、正文查询和搜索，撤销有关 watch/wake、取消待发，屏蔽迟到事件；不含正文的删除通知使其他客户端同步移除 |
| 删除的保留范围 | 原生历史/文件、原生身份映射、命令回执和审计保留；这是本地逻辑删除，不是原生删除、隐私擦除或删除单条已发消息 |
| 已交给 harness 的消息 | 撤回返回 CONFLICT；只能按原生实际能力停止或对账，不声称撤销已产生的工具副作用 |

共享 Host API 新增：

| 请求 | 用途 |
| --- | --- |
| `GET /api/sessions/:id?event=<eventId>` | 有界定位消息；原生快照明确返回 nativeHistory |
| `GET /api/sessions/:id?tail=300` | 查询当前会话、命令与最新正文页 |
| `GET /api/commands/:requestId` | 查询稳定请求的递送回执 |
| `DELETE /api/sessions/:id/commands/:commandId` | 撤回该会话尚未递送的用户消息；commandId 本身作为幂等标识 |
| `DELETE /api/sessions/:id` | 幂等删除本地会话，返回 deleted-locally、nativeDeleted=false |

## 2. Electron 启动修复与实测

环境：Windows 11 `10.0.26200`，Node `24.13.0`，npm `11.6.2`，Electron 仍固定 `39.1.0`。没有修改 vendor/pi、降低 renderer sandbox 或改写用户全局设置。

本机 E 盘仓库中的 Electron 在进入应用前退出 `2147483651 / 0x80000003`。清理 RUN_AS_NODE、显式禁用 GPU、最小环境、同版本重新下载、39 系列补丁及当前稳定版对照均未解除这一结果。同版本官方文件与安装文件逐项 SHA-256 一致，排除了这份安装的文件损坏。

关键对照：**同一份 39.1.0 文件复制到 C 盘用户临时目录，保持工作目录仍在 E 盘，`--version` 返回 0 / v39.1.0。** 因此已证实存在与运行时文件位置有关的本机环境问题，底层卷/系统触发因素尚未定位；没有将其称为 Electron 通用缺陷，也没有将所有失败归因于 GPU。

启动器先清理 `ELECTRON_RUN_AS_NODE` 并执行版本探针。Windows 遇到这两类已知启动退出码时，把安装的完整 runtime 复制到 `%LOCALAPPDATA%/Kodo/electron/<内容摘要>`，校验整份文件的内容指纹，再探测并启动。缓存异常时报告失败；不盲目重启应用或任务。可用 `KODO_ELECTRON_CACHE` 显式指定用户可写位置。缓存与仓库共用相同版本；没有升级 Electron 或改变锁文件。Windows 默认软件渲染仍保留，`KODO_SOFTWARE_RENDERING=0` 可显式启用 GPU。

实测项目：

| 检查 | 结果 |
| --- | --- |
| 启动器继承 `ELECTRON_RUN_AS_NODE=1` | 清理后从校验缓存运行，v39.1.0，退出 0 |
| 实际 BrowserWindow / React / Host 连接 | 通过，已截图；不只检查进程存在 |
| 托盘图标、关窗隐藏、重新打开 | 通过；Host PID 保持不变 |
| 从 Electron UI 发送真实 Codex 请求 | 已进入真实流式输出后再关窗 |
| 退出 UI 后 Host 与原生任务 | Host 存活；收到完整回复，含 800；原生 ID 保持不变 |
| 打包安装、真实托盘鼠标菜单操作、DESK-04/05 全部场景 | 本轮未执行，不能由上述结果外推 |

Playwright 在 Windows 的 app.close 等待本轮出现悬挂：Electron 主进程实际已退出，但自动化关闭 Promise 未完成。探针在五秒后核对主 PID 已不存在，再清理测试包装进程，继续独立核对 Host 和原生结果。该自动化限制单列在 JSON 的 playwrightCloseTimedOut，未隐藏为原生退出超时。

截图：`output/playwright/electron-fixed.png`、`electron-native-running.png`。真实任务报告：`.local/verification/electron-1794396162996/report.json`。

## 3. 真实 harness 消息操作矩阵

本轮每种可用 harness 都单独创建原生会话。通过同一 HTTP Host API 发送，核对原生回复、稳定请求去重、运行时排队、撤回、查询、搜索和本地删除。真实登录/原生 profile 沿用已有授权，没有用协议 peer 冒充模型回复。

| 对象 | 实现 / 版本 | 发送、双条排队、待发撤回 | 查询与本地删除 | 原生历史查询 | 当前轮直接引导 |
| --- | --- | --- | --- | --- | --- |
| Kodo（额外主 agent） | implemented；pi SDK 1.5.2 | 通过 | 通过 | 通过 | 原生 steer 通过 |
| pi | implemented；SDK 1.5.2 | 通过 | 通过 | 通过 | 原生 steer 通过 |
| Codex | implemented；CLI 0.161.0 | 通过 | 通过 | 通过 | 原生 turn/steer 通过 |
| Claude Code | implemented；SDK 0.3.322 / CLI 2.1.300 | 通过 | 通过 | 通过 | 本接入不支持，明确拒绝 |
| DeepSeek Harness | implemented；0.2.1-rc.2 | 通过 | 通过 | 本接入不支持，未伪报 | 本接入不支持，明确拒绝 |
| ZCode | partial；未安装 | 阻塞 | 仅共享领域路径已测，不等于真实 harness 通过 | 待验证 | 待验证 |
| OpenCode | partial；未安装 | 阻塞 | 同上 | 待验证 | 待验证 |
| Gemini CLI | partial；未安装 | 阻塞 | 同上 | 无独立 ACP read | 待验证 |
| Cursor | partial；未安装 | 阻塞 | 同上 | 无独立 ACP read | 待验证 |
| Kimi Code | partial；未安装 | 阻塞 | 同上 | 无独立 ACP read | 待验证 |
| Grok Build | partial；未安装 | 阻塞 | 同上 | 无独立 ACP read | 待验证 |

检查数分别为 Kodo 25、pi 25、Codex 25、Claude 22、DeepSeek 20，共 **117 个真实 API 断言**。其中“不支持时拒绝”“已发不能撤回”“运行中不能删除”是边界验证，不代表这些原生能力实现成功。五组均通过；先前四种原生 harness 的恢复、停止能力证据见首批报告，未在本轮全部重复。

每组均验证：待发命令可查询；重复撤回仍 cancelled；两条保留消息按顺序递送且获得真实回复；撤回消息未产生原生递送事件；支持 read 的四组在原生历史核对到队列消息，且不存在撤回内容；删除后查询 NOT_FOUND、搜索/快照不再展示、旧请求回执仍可查询。三个 steer 接入还核对：原生确认发生在原回合内、早于队列消息，收到真实对应回复。

真实报告路径：

- `.local/verification/messaging-kodo-1794395895104/report.json`
- `.local/verification/messaging-pi-1794395812047/report.json`
- `.local/verification/messaging-codex-1794395895057/report.json`
- `.local/verification/messaging-claude-code-1794395895138/report.json`
- `.local/verification/messaging-deepseek-harness-1794396035591/report.json`

## 4. UI、领域与工程检查

真实 Codex UI 从 1440×960 桌面切到 390×844 手机视口，完成待发查询/撤回、双条排队、直接引导、回复显示、搜索定位与本地删除。**11/11 检查通过**，无前端异常、无横向溢出；这仍是手机视口，不是真实手机/TLS 验收。

证据：`.local/verification/live-messaging-ui-1794396280137/report.json`；截图 `output/playwright/real-queue-desktop.png`、`real-queue-mobile.png`、`real-messaging-mobile.png`、`search-location-fixed-mobile.png`。

工程结果：lint、format:check、typecheck、build 通过；领域/适配器/SDK/进程测试 **65/65**，浏览器回归 **9/9**。新增五个领域用例覆盖异步连接撤回、SDK 长回合 steer、删除迟到事件/恢复、删除状态边界和早期事件/原生快照定位；新增两个浏览器回归覆盖同会话/切换会话/手机旧消息定位，以及真实 Host 本地删除后另一客户端自动移除列表并退出旧会话。保留既有停止、generation、unknown 不重发和 GC 测试。

修复过程中的失败也保留：首次 API 探针使用动态端口却将 Host 本地来源配置为 0，已修正；DeepSeek 探针初版错误等待本接入不存在的 text-delta，改为等待原生 turn/start；浏览器脚本的重复文本定位及共享测试数据未清理已修正。新增返回类型的类型检查失败也已修正。以上没有作为产品通过证据使用，最终结论使用各自复测。

仍有非失败提示：Vite 主 chunk 约 510kB；Node SQLite 实验提示；Playwright Windows 启动包装器的 Node DEP0190 提示。没有执行 npm ci 重装或远端 CI。

## 5. 启动、复测与保留限制

```powershell
npm run build
npm run start:desktop

# 不启动 Electron 的独立 Host
npm run start:host

# 已有登录/CLI 的真实请求，会产生实际模型用量
npm run verify:messaging -- pi
npm run verify:messaging -- kodo
npm run verify:messaging -- codex
npm run verify:messaging -- claude-code
npm run verify:messaging -- deepseek-harness
npm run verify:messaging-ui
npm run verify:electron -- --with-native-conversation
```

原本 `4310 / PID 8176` 的用户 Host 保持运行，未停止或改写其数据；测试实例均使用独立数据目录，测试端口结束后释放。旧 Host 不随构建自动热更新，使用新增后端操作前，需在其任务安全结束后重新启动该 Host。默认桌面发现到健康的旧 Host 时仍会复用，不会擅自终止它。

未实现：原生删除、删除单条已发消息、原生 rollback/undo、原生文件清理与本地内容彻底擦除。已发送消息不能按“撤回”消除模型上下文或工具副作用。六种缺 CLI 的实际连接、真实手机/HTTPS/隧道、外部运行接管、全部桌面异常退出/停止菜单场景仍待验收。

本轮源码为 HEAD `eb765ca6f41c0b4d6f4eb616b75a8f22cbe342cf` 加未提交工作区。原始日志、版本对照、运行摘要、最终源码指纹保存在 `.local/qa/20261111-fixes/`，这些是本地忽略材料，不作为运行依赖。

自动审批拦截了清理临时 Electron 对照副本的命令，工具仅返回“blocked by policy”，未给出具体原因；这些忽略目录中的副本和本次临时系统目录已保留，未尝试绕过。验证通过的 Kodo 用户 runtime 缓存继续供正常启动使用。
