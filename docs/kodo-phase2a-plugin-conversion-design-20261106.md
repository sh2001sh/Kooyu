# Phase 2a 准备：能力与工具插件转换设计

日期：2026-11-06。分支 `claude/phase2a-capability-conversion-2a7aac`，基线 `493f02e`。

本文是 Phase 2a 的准备工作：把路线图第 4 节 Phase 2a 的条目对到现有代码的真实接缝上，列出每个插件需要的钩子和初始化输入，并给出任务分析插件的实现（已落地为纯函数模块，见第 4 节）。插件外壳要等 Phase 1 的 `CapabilityPlugin` / `ToolPlugin` 接口稳定后再写。

## 0. 与路线图描述不一致的事实

| 路线图写法 | 实际代码 | 影响 |
|---|---|---|
| `src/runtime/artifact.ts` | 不存在。`artifact.read` / `artifact.write` 在 `src/tools/index.ts` 的 `Tools.execute` 分支里，存储在 `Store.readArtifact` / 写 artifact 方法 | artifact 插件拆的是 `Tools` 中的两个分支加 Store 方法，不是一个文件 |
| `src/runtime/messaging.ts` | 在 `src/messaging/index.ts`（`Mailbox`，12 个协作工具）+ `agent-lifecycle.ts` + `spawn-spec.ts` | messaging 插件是最大的一块，和 coordinator 的耦合最深 |
| `history/` 目录 | `src/runtime/history.ts`（262 行），被 `context-assembly.ts`、`summary-read.ts`、`tools/index.ts` 引用 | history 同时是能力（上下文恢复）和工具（`history.read/search`） |
| `tools/index.ts` 是可拆的工具集 | `Tools` 是 1170 行的单类，文件、进程、artifact、history、recovery、update_progress、workspace.git 共用一个 `execute`，共享 read-state、write-locks、effect-scan、审批、沙箱 | 工具插件拆分必须先把共享执行边界（审批、锁、效果对账）留在核心或隔离层，否则每个插件都要重复实现 |
| `custom-registry.ts` 需新写 | `src/tools/registry.ts` 的 `ToolRegistry` 已经是宿主自定义工具注册表（append-only、指纹、schema 校验、`recover` 验证器），`application.registerTool` 已对外暴露 | custom-registry 只是对 `ToolRegistry` 的 `ToolPlugin` 包装，不要重写 |
| todo 需转为插件 | `todoTools(store)` 已返回 `ToolRegistration[]`，`application/index.ts:138` 通过 `registerTool` 注册 | todo 插件几乎是现成的，改动最小，适合作为第一个转换样板 |

## 1. 现有可挂接点

已经存在的宿主钩子（`src/runtime/hooks.ts`）：`tool.before`（可否决）、`tool.after`、`tool.failed`、`run.stop`、`subagent.stop`（可否决）、`compaction.before`、`compaction.after`、`session.start`、`session.end`。钩子只能返回 `note` / `deny`，不能替换操作，有 10s 超时，结果写入事件。

Phase 1 路线图中的 `CapabilityPlugin.hooks` 与之对应关系：

| 路线图钩子 | 现有位置 | 说明 |
|---|---|---|
| `beforeModelCall` | `model-step.ts` 构建上下文前（第 73–97 行：压缩判断、`stateFrame`、`buildContext`） | 现在没有对外钩子。压缩、状态帧、后台通知都在这里内联 |
| `afterToolResult` | `tool-step.ts:204` 的 `tool.after` / `tool.failed` | 已有，但只给 note，不给结构化结果 |
| `beforeCompletion` | `coordinator.ts:527` 的 `run.stop` / `subagent.stop` + `completion.ts` | 已有 |
| `onTaskGraphBuilt` | 无 | 新增，由任务分析插件自己触发 |

上下文注入的现有通道是 `src/runtime/attachments.ts` 的 `attachment(kind, body)`，每种 kind 有字符上限和排序。任务分析的系统消息应新增一个 kind（建议 `task-analysis`，`kodo-runtime` 标签，`persist: false`，上限 4000 字符，order 85，位于 nudge 与 completion-check 之间），每次请求重新生成，不进入持久上下文，从而不破坏缓存前缀以外的部分，也不会在压缩时累积。

**对 Phase 1 接口的需求**（已写入共享笔记）：
1. `beforeModelCall` 需要能返回零个或多个 attachment（或 `{ kind, body }`），而不只是 `void`。否则任务分析和后台通知都无法用插件表达。
2. 插件 `initialize` 需要拿到 `Store`（或其只读视图）。history、recovery、todo、artifact 全部依赖 Store 的事件和 blob。
3. `ToolPlugin.execute` 的上下文需要沿用现有 `ToolExecutionContext`（`run`、`session`、`signal`、`markEffectStarted`）和 `ToolRegistration` 的元数据（`permission`、`effect`、`readOnly`、`concurrencySafe`、`writeScope`、`recover`）。这些是审批、并发批次和崩溃恢复的依据，丢了就会改变既有行为。
4. 插件需要声明依赖（例如 compaction 依赖 history 的归档读取，recovery 依赖文件工具的 native probe），注册表按依赖排序并在缺依赖时报错。

## 2. 能力插件

| 插件 | 现有来源 | 初始化需要 | 钩子 | 对外工具 | 禁用时的行为 |
|---|---|---|---|---|---|
| history | `runtime/history.ts`、`summary-read.ts` | Store | 无（被 context-assembly 和 compaction 调用） | `history.read`、`history.search` | 不暴露两个工具；上下文恢复退化为只用当前上下文。compaction 的 summary 模式依赖它，需同时禁用或降为 mask |
| compaction | `compaction.ts`、`compaction-trigger.ts`、`summary-*.ts`、`tool-result-prune.ts` | Store、Provider、CompactionPolicy、HostHooks | `beforeModelCall`（判断触发并执行 `summarizeContext`），继续触发 `compaction.before/after` | 无 | 等价于现在的 `compaction: false`（`application/index.ts:115` 已支持） |
| recovery | `recovery.ts`、`recovery-resolution.ts`、`tools/native-recovery.ts` | Store、文件工具的 `PatchRecoveryProbe`、各工具的 `recover` 验证器 | 运行开始前（`coordinator.ts:53` 检查未确定效果），tool-step 中 unknown 结果（`tool-step.ts:359,381`） | `recovery.inspect` | 未确定效果保持阻塞，需用户手动确认。不能静默放行 |
| artifact | `Tools.execute` 的 `artifact.read/write` 分支、Store artifact 方法 | Store | 无 | `artifact.read`、`artifact.write` | 进程大输出无法落盘为 artifact；后台通知（`background-notice.ts`）和 inspection 中引用 artifact 的路径需判空 |
| messaging | `messaging/index.ts`（Mailbox）、`agent-lifecycle.ts`、`spawn-spec.ts` | Store、cancel 回调、modelBindings、全局指令 | 运行结束（`mailbox.onTerminal`）、每步刷新（`mailbox.refresh`），上下文注入 `mailbox` attachment | 12 个协作工具 | 单代理模式。coordinator 中 9 处 `mailbox.*` 调用需改为可选 |
| progress（建议新增） | `progress-advisor.ts`、`progress-guard.ts`、`context-progress.ts`、`update_progress` 工具 | Store | `afterToolResult`（重复调用检测），`beforeModelCall`（进度快照） | `update_progress` | 不做重复检测和断路，与现有 ablation 行为一致 |
| background-notice（建议并入 background 工具插件） | `background-notice.ts` | Store | `beforeModelCall`（`task-notification` attachment） | 无 | 跟随 background 插件 |
| task-analysis（新） | `src/capabilities/task-analysis/`（本次实现） | Store（读 todo 快照和 shell 调用） | `beforeModelCall` 注入 `task-analysis` attachment；`onTaskGraphBuilt` 通知 | 无 | 不注入分析，行为与现在完全一致 |

这样能力插件是 6–8 个（history、compaction、recovery、artifact、messaging、task-analysis，可选 progress），符合完成标准。

转换顺序建议：task-analysis（新增，无迁移风险）→ history → artifact → compaction → recovery → messaging。messaging 放最后，因为它和 coordinator 的生命周期耦合最深。

## 3. 工具插件

| 插件 | 工具 | 现有来源 | 共享依赖 |
|---|---|---|---|
| file | `file.read/list/search/apply_patch/patch/mkdir/rename/delete`、`image.read` | `Tools.execute` 第 619–700 行附近、`read-state.ts`、`similar-paths.ts`、`image.ts`、`write-locks.ts` | 路径作用域、受保护路径、read-state 新鲜度检查、写锁、native recovery 准备记录 |
| shell | `shell.exec`、`process.exec`、`process.run` | `shell.ts`、`Tools.execute` 第 534–618 行、`runProcess` | 沙箱、审批、effect-scan 对账、写锁、凭据环境 |
| background | `process.read` + 后台通知 | `background.ts`、`background-notice.ts` | 与 shell 共用 `BackgroundTasks` 实例。路线图把 `background.read` 放进 shell 插件，这里建议 shell 和 background 同属一个插件实例或 background 依赖 shell |
| todo | `todo.read`、`todo.write` | `todo.ts`（已是 `ToolRegistration[]`） | 只依赖 Store |
| custom-registry | 宿主注册的任意工具、MCP、skills | `registry.ts`、`extensions/` | 指纹与 append-only 语义必须保留：持久化的工具名不能换含义 |
| （保留在核心或另议）| `workspace.git`、`tool.describe`、`webfetch`、`lsp`、`memory` | 各自文件 | `tool.describe` 是懒加载机制的一部分，应留在核心 |

**拆分前提**：`Tools.execute` 中的审批（`review`，第 429 行）、写锁、`markEffectStarted`、效果对账和 `effectMode` 判定是所有写工具共用的执行边界。拆分时这部分要先移到 Phase 1 的 tool-dispatch 或隔离层（Layer 2），各工具插件只提供 `ToolRegistration` 形状的定义和执行体。如果 Phase 1 的 dispatch 不包含这层，工具插件转换会改变行为，需要先和 Phase 1 对齐。

Phase 2b 同时在做工具合并（24 → 10），会改工具名和 schema。2a 只搬迁不改名，2b 在搬迁后的插件里改名，避免两边同时改 `tools/index.ts` 产生冲突。

## 4. 任务分析插件

### 4.1 输入从哪来

设计文档里的 `extractTasks(response.text)` 依赖从模型自由文本中抽取任务，误判率高且不可测。本实现改为两个结构化来源：

1. **todo 快照**（`readTodoSnapshot`）：模型已经用 `todo.write` 维护的清单，是"计划了什么"的事实来源。
2. **工具调用记录**：已执行过的 shell / process 命令和耗时，用来判断某类工作是否长运行。

每个 todo 项转成一个 `TaskNode`。特征由确定性规则从 `title` / `content` / `note` 推断：

- `estimatedDuration`：测试、构建、基准、全量检查等关键词为 `long`；调研、探索、审查、文档为 `medium`；其余 `quick`。如果 todo 的 `note` 中有显式提示（如 `~5m`、`long`），以提示为准。
- `nature`：验证、审查、测试、文档、调研且不依赖未完成项时为 `independent`；设计、决定、架构、选型为 `blocking`；其余 `sequential`。
- `requiresDecision`：含设计 / 决定 / 选型 / 架构 / trade-off 等词。
- `clearAcceptance`：含"通过 / pass / 验收 / 全部绿 / exit 0"之类的验收描述，或者是测试 / 构建类任务。
- `dependsOn`：note 中显式写 `after:<id>` 或 `depends:<id>`；没有显式依赖时，`sequential` 节点依赖清单中前一个未完成的非 independent 节点（清单顺序即默认依赖顺序），`independent` 节点只依赖显式声明的项。

所有推断都可被 todo `note` 中的显式标签覆盖，这样模型或宿主可以在推断出错时纠正，而不需要改 todo schema（Phase 2b 若给 todo 加结构化字段，直接替换推断函数即可）。

### 4.2 图与关键路径

- 只对未完成节点建图；已完成节点作为已满足的依赖。
- 关键路径：按时长权重（quick 15s、medium 2m、long 10m）求 DAG 最长路径。
- 依赖环：检测后从环上去掉最后加入的边并在分析中报告，不抛错。
- 并行组：互相不可达且都已就绪（依赖全部完成）的未完成节点归为一组。`canParallelWith` 由可达性计算，不依赖模型填写。

### 4.3 shouldDelegate 的四条规则

规则与设计文档一致，顺序调整一处：规则 4（需要决策或 blocking）先判，作为否决。原文档的顺序下，一个 `long` 且 `requiresDecision` 的任务会命中规则 1 被建议后台，与"架构决策必须主代理拥有"矛盾。

1. 规则 4：`requiresDecision` 或 `nature === 'blocking'` → 不委派。
2. 规则 1：`long`，且存在其他可与之并行的未完成节点 → `background`。
3. 规则 2：`independent` + `clearAcceptance` → `new_session`。
4. 规则 3：`medium` + `independent` + 不在关键路径上 → `new_session`。
5. 其余 → 不委派。

已完成和 `in_progress` 之外的被阻塞节点也参与判断，但建议里会带上 `when`（"在 X 完成后"），对应设计文档的 `timing` 字段。

### 4.4 系统消息格式

```
<kodo-runtime kind="task-analysis">
Task analysis (todo revision 4; advisory, not an instruction):
Critical path: impl → integration-tests (~12m)
Ready in parallel: docs, security-review
Delegation opportunities:
- integration-tests "Run 100 integration tests": background (long-running; docs can proceed meanwhile). When: after impl.
- security-review "Security review": new_session (independent verification with clear acceptance).
Keep in this run: api-design (requires a decision).
</kodo-runtime>
```

只在至少有一条委派建议时注入；没有建议时不输出，避免每轮重复占用上下文。正文上限 4000 字符，超出时截断建议列表并注明省略数量。

### 4.5 文件

```
src/capabilities/task-analysis/
  types.ts      TaskNode / TaskGraph / DelegationDecision / WorkSessionAnalysis
  infer.ts      todo 项 → TaskNode（特征推断 + 显式标签）
  graph.ts      buildTaskGraph：可达性、环处理、关键路径、并行组
  delegate.ts   shouldDelegate（4 条规则）
  analyze.ts    analyzeWorkSession：组合以上，产出 WorkSessionAnalysis
  format.ts     formatTaskAnalysis：系统消息正文
  index.ts      导出
```

全部是纯函数，不依赖 Store，也不依赖 Phase 1 接口。接口稳定后，`task-analysis-plugin.ts` 只需在 `beforeModelCall` 中读 todo 快照、调用 `analyzeWorkSession`、用 `attachment('task-analysis', ...)` 注入。

## 5. 测试计划

1. **单元测试**（本次已写 task-analysis 部分）：每个插件的纯逻辑独立测试。
2. **全量启用**：用工厂创建全部插件，跑现有 `npm test`，结果应与基线一致。基线需在 Phase 1 合并后重新记录（当前 worktree 无 `node_modules`，见第 6 节）。
3. **部分禁用**：
   - 禁用 messaging：单代理任务完成，协作工具不出现在 tool specs 中。
   - 禁用 compaction：等价于 `compaction: false` 的现有测试（`tests/compaction*.test.ts`）。
   - 禁用 history 但启用 compaction summary：注册表应报依赖缺失。
   - 禁用 task-analysis：请求内容与基线逐字节一致（`tests/default-request-invariants.test.ts` 可复用）。
4. **任务分析端到端**：脚本化 provider 先 `todo.write` 一个含实现、测试、文档的清单，下一次模型请求中应出现 `task-analysis` attachment，且包含对测试的 background 建议。

## 6. 当前状态与阻塞

- Phase 1（[phase1-core](#local_5ec68e3b-0a23-463a-b4c8-b47dc02e6dfc)）目前只有未提交的 `src/core/{types,run,session}.ts`，尚无插件接口。能力和工具插件的外壳等接口确定后再写。
- 本 worktree 没有 `node_modules`。运行测试前需要 `npm ci`。
