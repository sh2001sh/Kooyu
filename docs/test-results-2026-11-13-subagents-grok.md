# Grok 原生 Read 与各 Harness 子代理输出验收

最新增补见 [后续补充实现与真实账户验收](test-results-2026-11-13-harness-supplement.md)：包含 Grok 后台模式、Cursor/DSH 真实子代理通过、其他账户失败证据、离线子会话补抓及最新完整 UI 结果。下文保留为原批次记录。

日期：2026-11-13。范围：修复本机 Windows Grok 工作区绑定失败，接通各适配器已有的原生子代理事件与输出，验证桌面和手机浏览器视口。本文不将协议 fixture 通过等同于所有供应商真实模型验收。

## Grok 根因与修复

已检查官方 `xai-org/grok-build` 源码，本地研究副本 `.local/research/grok-build`，Git HEAD `2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8`，`SOURCE_REV` 为 `559751fdcec02d413e4c57c8832ab275e4f44980`。该源码用于追踪调用链，不声称与两个本机二进制逐字相同。

调用链关键位置：

- `crates/codegen/xai-grok-workspace/src/workspace_ops.rs`：`bind_local_session`。
- `crates/codegen/xai-grok-shell/src/session/acp_session_impl/spawn.rs`：`bind_installed_toolset`；绑定失败仅写 warning，会话创建仍可继续。
- `crates/codegen/xai-grok-shell/src/agent/mvp_agent/agent_ops.rs`：工具安装后的绑定路径。

补充 stderr 诊断后捕获实际错误：`failed to bind local session toolset` → `cannot make a private session folder` → Windows `os error 5`（拒绝访问），路径为系统 TEMP 下的 `grok-sessions-*`。因此后续 `read_file` 的“工作区会话未绑定”是前序工具集初始化失败的结果。此前只观察 ACP 工具错误，且 Host 未收集 stderr，未暴露这一原因；单独修改 cwd 或禁用 leader 均不足以解决。

`packages/host/src/harnesses/grok-build.ts` 在 Windows 连接时建立 `<dataDir>/native-tmp/grok`，将该原生进程的 `TEMP`、`TMP`、`TMPDIR` 指向此目录，并给 `agent stdio` 添加 `--no-leader`，防止复用带旧环境的 leader。只修改连接上下文，保留原生工具、用户 GROK_HOME、安装文件及历史导出参数。修复应用于重新建立的原生连接；已经启动的进程不会自动获得新的环境变量。

同时发现 Grok 实时通知使用 `_x.ai/session_notification`，持久化日志使用 `_x.ai/session/update`。适配器现在兼容两者及相应非下划线别名，识别 spawned/progress/finished、子会话文本、工具和完成输出。

## 真实原生执行证据

验证脚本：`scripts/verify-grok-native-tools.mjs`。它使用实际安装的 Grok 可执行程序、隔离的 GROK_HOME 和随机文件标记；模型端使用 localhost 合成协议服务器，指令通过原生工具执行。此项验证真实运行时、工作区、文件工具、原生子代理及适配器输出链路，不验证供应商远程模型能力或付费 API。

| 原生版本 | 验证 | 结果 | 本地证据 |
| --- | --- | --- | --- |
| 1.0.80 (`b200360b6562`) | 原生 `read_file` | 成功读取随机标记 | `.local/verification/grok-native-tools-1794542797322/report.json` |
| 1.0.80 (`b200360b6562`) | 前台 `spawn_subagent` → 子代理原生 Read → 输出事件 | `ok: true`，主回合 completed | `.local/verification/grok-native-tools-1794543784547/report.json` |
| 用户目录中的 1.0.77 (`50ca579fa996`) | 同一子代理完整链路 | `ok: true`，主回合 completed | `.local/verification/grok-native-tools-1794544168283/report.json` |

原始失败 stderr：`.local/verification/grok-native-tools-1794542663941/native-stderr.log`。验证未更新、降级或覆盖用户原生安装。后台子代理本轮未做真实运行验收；前台 fixture 明确设置 `background:false`。

## 子代理接入矩阵

| Harness | 本轮接入和可见内容 | 验证及边界 |
| --- | --- | --- |
| Grok Build | 原生父子关系、状态、文本/工具、最终输出与错误 | 两个实际二进制的前台子代理 Read 链路通过；远程模型及后台任务未重测 |
| Cursor | 声明 `_meta.subagents:true`；spawn/state 更新；子会话文本和工具；独立文件/终端客户端 | 已安装源码确认需要能力协商；协议 fixture 通过；本轮未做真实 Cursor 子代理任务验收 |
| Claude Code | SDK `forwardSubagentText:true`；`parent_tool_use_id` 文本/工具；task 生命周期和摘要 | 注入 SDK 协议测试通过；真实供应商子代理未在本轮重跑 |
| Codex | thread_spawn 父子关系、协作工具的子线程状态、已知子线程文本/工具和最终消息 | app-server fixture 通过；本轮未新增完整离线子线程历史抓取 |
| Kimi Code | 按 `agent_id` 路由 child frame；独立文本/工具/usage/结束事件 | 重复 frame/sequence/turn ID 隔离回归通过；真实子代理未重跑 |
| DeepSeek Harness | `subagent.started/finished`、后代会话事件和最终回答 | SDK JSON-RPC fixture 通过；子回合结束不提前结束主回合 |
| OpenCode | 原生 parentID 建立关系；每个子会话独立 SSE 翻译器；子会话交互 | SSE fixture 通过；本轮未新增恢复时完整子会话枚举/历史补抓 |
| ZCode | 原生 subagent 行、状态/摘要；通过只读 `v4/conversation/rowsRange` 获取子会话内容 | 分页协议 fixture 通过；读取串行合并且保持行 ID；实际账户子代理未重跑 |
| Gemini CLI | 原生子代理以普通工具结果返回时，可展开查看 ACP 嵌套文本输出 | 当前安装的 ACP 未发现独立子代理生命周期通道；不能承诺独立子会话完整过程 |
| pi | 扩展提供的子代理工具输出按工具卡查看 | 基础 SDK 无内建统一子代理通道；不虚构原生子代理支持 |
| Kodo | 受管理的其他 Harness 会话仍通过已有独立会话入口查看 | 产品管理会话与原生子代理是不同概念，本轮不改变其语义 |

所有子代理事件使用独立 `subagent` 信封；只有可追溯到当前原生根会话的父子关系可注册。拒绝无关会话与重设父关系，事件去重键包含子代理身份。子代理结束、失败、usage 不进入主会话结束或计费路径。ACP 恢复只还原子代理身份和状态，不重放历史文本。

## 界面

在对话时间线展开“子代理 · 名称”卡片，可查看父子 ID、状态、文本、思考和工具输出，并复制子代理输出。复制复用渲染归并逻辑，避免流式增量/最终消息或工具补丁重复。子代理失败明确标为“子代理本轮失败”。仅收到状态时显示尚无原生输出，不以空白冒充完整内容。

桌面 1440×960 与手机浏览器 390×844 已验证展开、两个子代理同名工具隔离、ACP 嵌套工具结果、复制内容、失败归属、空状态和无水平溢出。截图：`.local/verification/subagents-desktop.png`、`subagents-mobile.png`。这不是实体手机或 Electron 实窗验收。

## 回归结果

- Host 全套：`npx tsx --test --test-concurrency=4 packages/host/test/*.test.ts`，**294/294** 通过；含本轮新增 11 项子代理专项及既有 Kimi 等适配器回归。
- 浏览器：`subagents.spec.ts` + `native-interactions.spec.ts`，**11/11** 通过。
- 完整构建、最终 `npm run typecheck` 与 `npm run lint` 均通过（退出码 0）。
- 日志：`.local/subagent-final-host.log`、`subagent-final-ui.log`、`subagent-final-build.log`、`subagent-final-typecheck.log`、`subagent-final-lint.log`。

此前无并发限制且同时构建/运行原生验证的一次 Host 测试出现 process-guard 启动超时；该测试独立复跑通过，完整受限并发回归全部通过。未放宽其超时或修改无关断言。工作区同时存在其他开发改动，本报告计数是本次实际执行时的全套数量，不把所有测试或全部仓库变更归为本轮新增。
