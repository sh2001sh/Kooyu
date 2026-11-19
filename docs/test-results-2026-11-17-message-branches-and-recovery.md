# 当前对话消息分支、重试提示与失败恢复

日期：2026-11-17。本记录更新此前 `test-results-2026-11-17-message-actions-and-cancel.md` 中的编辑语义和 Host 安装状态。

## 结果与范围

用户确认的编辑行为为：保留原消息，在当前对话内生成可切换的消息分支，不新增侧栏对话。编辑保存会直接发送修改内容；消息旁通过上一分支、当前位置/总数、下一分支切换。原消息与原分支后续回复保留，刷新后保留选择。

检查覆盖协议中全部 11 个入口：Kooyu（kodo）、pi、Codex、Claude Code、DeepSeek Harness、zcode、OpenCode、Gemini、Cursor、Kimi Code、Grok Build。共享 SessionService 的明确失败、结束后断线、真正递送未知三类状态分别做了回归，界面重试提示与恢复后的“立即发送”也逐入口验证。

不能据此断言每个供应商的真实服务都曾复现同一故障：公共状态问题影响所有入口，原生错误形态和重试信息取决于各适配器。

## 修复

- 公共状态处理：明确拒绝或已收到本轮结束结果后，不再被后续异常错误改回递送未知，不再因此阻塞下一次发送。真正没有结束依据的断线继续保留未知状态，避免自动重复发送。
- 重开后的补充修复：没有原生连接时，停止请求明确记录为未递送（rejected），不会再生成阻塞队列的 unknown 停止命令。原生执行本身确实未知时仍保留未知状态。人工对账显式确认空闲时，同步记录执行已结束。
- 被未知回执挡住的新消息也提供待发队列控件，运行提示改为“运行状态待核对”，避免一直显示“正在启动”。
- 消息分支：在同一 Session 中保存不可变分支历史；编辑分支使用独立原生上下文，仅带入编辑位置之前的对话和相关附件。切回原分支恢复原生会话；支持嵌套分支、请求幂等和持久化。正在运行、有待发/未知命令或后台活动时阻止编辑和切换，并保留编辑内容。
- 重试状态：读取 Claude api_retry、pi/Kooyu auto_retry、Codex willRetry、OpenCode retry 状态等实际事件。显示“重试中 2/5 · N 秒后重试”，倒计时结束显示“正在请求…”。原生不提供次数或最大次数时，不伪造计数。
- Claude：已收到失败/完成结果后，不再因流尾异常重复产生断线失败；工具结果按 toolCallId 合并。
- ACP（Gemini、Cursor、Grok Build）：明确 prompt 拒绝补充失败结束事件。
- OpenCode：HTTP 明确拒绝归类为 RpcRejected，接入 retry/busy 状态。
- Kimi：HTTP 和业务明确拒绝归类为 RpcRejected；输入已入队后的第二步 steer 失败仍保留递送未知语义。
- 界面：失败信息保留 errors 数组及 Kimi 原生原因；结束后没有工具结果的条目标为“结果未确认”。历史已经落库的重复错误没有清除。

## 验证

| 验证 | 结果 |
| --- | --- |
| 完整项目 `npm run build` | 通过 |
| Host 全量 `node --import tsx --test --test-concurrency=4 packages/host/test/*.test.ts` | 492/492 |
| message-recovery、adapters、harness-completion、conversation-parity、sdk-lifecycle 集合 | 93/93 |
| UI conversation-parity、retry-recovery、model-provenance-and-stop | 21/21 |
| 补充 Host 全量（含全部入口空闲停止与未知执行保护） | 492/492 |
| 补充 message-recovery、reliability | 91/91 |
| 补充 UI retry-recovery、first-message、model-provenance-and-stop | 24/24 |
| Electron 启动、关闭、重开 | 通过 |
| 修改的 TypeScript/TSX ESLint、git diff --check | 通过 |

UI 在 1440px、390px 检查消息分支切换与刷新保留；全部 11 个入口检查重试展示与恢复后的“立即发送”。自动化测试使用本地合成 peers、隔离 Host 与合成响应，没有额外调用付费模型。最后实际窗口核验观察了用户原先排队输入恢复后的真实 Claude 重试，没有逐个供应商执行真实在线重试。

证据：

- `.local/message-recovery-host-tests.log`
- `.local/message-recovery-focused-tests.log`
- `.local/verification/electron-1794891309204/report.json`
- `apps/web/test-results/.last-run.json`
- `.local/message-recovery-followup-host.log`
- `.local/message-recovery-stop-tests.log`
- `.local/message-recovery-followup-ui.log`
- `apps/web/test-results/retry-recovery-claude-code-66cad-recovered-send-now-controls/recovered-send-now.png`

## 本机安装与旧状态恢复

更新目录：`D:/Program Files/Kooyu/resources/host`。2026-11-17 北京时间 13:01:25 首次更新并核对 452 个文件的 SHA-256，包括 Host、两处 protocol dist 和 Web。生产 Host 从 PID 9952 重启为 50280，沿用原数据目录、4310 端口及原 hostId。

更新前逐会话检查没有运行中或待发命令。更新后 5 个原有会话 ID、nativeSessionId、harnessId、bindingId 保持一致，全部 idle，没有 accepted、dispatched 或 unknown 命令。HTTP 已返回新的 Web 入口 `index-kfqj9lCK.js`。

通过已有 reconcile API 处理 6 条有明确证据的旧回执：4 条 Claude send 根据相同 commandId 的用户消息和后续 failed 结束事件确认输入已递送、本轮失败结束；2 条 stop 的持久回执明确为 native connection offline，核对为未递送。没有重发消息、删除历史或将失败声称为成功。

备份目录：`.local/desktop-update-20261117-message-recovery/`，包含原安装文件 `before/`、SQLite 在线一致备份 `before.sqlite`、待安装文件 `ready/`、SHA-256 `manifest.json`、对账依据与结果、安装前后快照及安装日志。

用户已完成重开，实际窗口确认加载了当前对话分支编辑说明和重试计数。

北京时间 13:31:57 补充修复安装完成，Host PID 59812，452 个文件 SHA-256 全部一致，Web 入口为 `index-Ce_OLSXL.js`。此次更新前没有活动原生回合；用户在旧窗口执行的停止操作产生了 5 条未递送的停止回执，其中一条阻塞了用户 13:15 提交的“继续”。逐会话核对最后结束事件、没有后续原生递送、停止回执为 offline 后，将这 5 条停止核对为 rejected。原用户输入保留请求 ID `4da5a40d-95b4-4f0a-a858-140b4fa71db0` 继续执行，只有一个对应用户消息事件，没有创建第二次发送。

最终实际窗口检查：Host 已连接；真实运行显示“重试中 1/10 · 正在请求…”，随后计数推进至 3/10；空闲会话编辑器说明“发送后在当前对话生成消息分支，可切换查看原消息和回复”；取消编辑后输入验证文字，发送按钮启用，随后已清空文字，未提交核验消息。界面恢复到原正在运行的会话。

最后状态：全部会话没有 unknown 或 accepted 命令；一个原用户请求正在执行/重试，其余 4 个会话空闲。该请求的模型服务尚未返回成功结果。补充 Web 的排队提示在下次正常加载页面时使用最新入口，已打开窗口当前已验证核心分支和重试显示。

补充备份与证据位于 `.local/desktop-update-20261117-message-recovery-followup/`，包含一致 SQLite 备份、安装前文件、两轮停止回执核对依据、最终状态检查和实际窗口文字记录。早先通过进程命令重启界面曾被自动审批以 `blocked by policy` 拒绝，用户已自行重开；此限制没有阻止后台更新和最终窗口核验。
