# Kodo 功能测试记录：2026-11-11 首批

运行 ID：`20261111-1838-functional`。按 [测试大纲](test-plan.md) 执行，开始时间为 2026-11-11 18:39（Asia/Shanghai）。本页记录本轮实际结果；没有执行的能力继续保留未执行/阻塞，**不代表 114 项场景或十种原生 harness 全部验收完成**。

结论：工程检查修正后通过；领域/协议测试 60/60、浏览器回归 7/7、补充 API 检查 18/18 通过。Kodo 和已安装的四种原生 harness 的真实对话/恢复通过，Kodo→Codex 托管闭环通过。补查发现 **P1：搜索结果不能定位旧消息**，尚未修复。Electron、真实手机和六种未安装 CLI 的验收仍有阻塞。

后续复测见 [启动与消息操作修复](test-results-2026-11-11-fixes.md)：BUG-20261111-003 已修复，Electron 已实际启动并验证真实任务在 UI 退出后完成。下文保持首次运行时的结果。

## 1. 环境与证据

| 项目 | 本轮值 |
| --- | --- |
| 代码 | HEAD `eb765ca6f41c0b4d6f4eb616b75a8f22cbe342cf` + 当前未提交工作区；不是单纯 HEAD 版本 |
| 平台 | Windows 11，版本 `10.0.26200`；Node `v24.13.0`，npm `11.6.2` |
| 原生版本 | pi SDK `1.5.2`；Codex `0.161.0`；Claude CLI `2.1.300` / Agent SDK `0.3.322`；DeepSeek Harness `0.2.1-rc.2` |
| 桌面 | Electron `39.1.0`；浏览器测试使用 Playwright Chromium |
| 数据隔离 | Playwright `4319`；真实 UI `4323`；API/手工浏览器 `4327`；启动器 `4329`，各自使用隔离目录 |
| 原始证据 | `.local/qa/20261111-1838-functional/`；各验证脚本另存 `.local/verification/` |
| 截图 | `output/playwright/`；本页给出具体文件链接 |

本机原来在 `4310` 运行的 Host PID `8176` 未操作；结束补充检查后，该监听仍在，本轮测试端口均已释放。测试创建的 detached worktree 已移除；临时系统 keyring 条目全部删除。合成历史/数据库保留作缺陷证据，没有写成真实 harness 的回复。

工作区初始状态与源码哈希见 [环境记录](../.local/qa/20261111-1838-functional/environment.json)、[初始源码指纹](../.local/qa/20261111-1838-functional/source-hashes.json)。原始材料为本地忽略文件；跨机器复测须自行生成。本页保留可读结论，不依赖原始日志才能理解结果。

## 2. 工程检查与自动化

| 检查 | 本轮结果 | 备注/证据 |
| --- | --- | --- |
| `npm run lint` | 初次失败 → 修正后通过 | 未使用的 KodoMark 导入及一条多余 eslint-disable；[初次](../.local/qa/20261111-1838-functional/lint.log) / [复测](../.local/qa/20261111-1838-functional/lint-retest.log) |
| `npm run format:check` | 初次失败 → 修正后通过 | 10 个文件格式不符；仅对这些文件应用 Prettier；[初次](../.local/qa/20261111-1838-functional/format.log) / [复测](../.local/qa/20261111-1838-functional/format-retest.log) |
| `npm run typecheck` | 通过 | 包含 Host 测试源码；[日志](../.local/qa/20261111-1838-functional/typecheck.log) |
| `npm run build` | 通过 | protocol/host/web/desktop 均构建；Web JS 508.11 kB，Vite 有大于 500 kB 的体积提示；[日志](../.local/qa/20261111-1838-functional/build.log) |
| `npm test` | **60/60 通过** | 无失败、跳过或取消；领域/协议/SDK/进程测试；[日志](../.local/qa/20261111-1838-functional/domain-adapters.log) |
| `npm run test:ui` | **7/7 通过** | 隔离 Host，含当前新增的项目内新建、模型选择、分组切换；[日志](../.local/qa/20261111-1838-functional/browser.log) |
| 额外 API 功能检查 | **18/18 通过** | 使用明确标注的合成数据；[报告](../.local/qa/20261111-1838-functional/api-probe-retest.json) |
| 系统 keyring | 6 个断言通过 | 实际系统凭据库、临时合成值；会话固定旧 key 保留，无引用轮换/清除 key 删除；清理通过；[报告](../.local/qa/20261111-1838-functional/keyring/report.json) |
| DeepSeek 长回合协议 | 通过 | 隔离 peer 实际等待 **31,058ms** 后返回，未被 30 秒握手期限截断；cancel 返回不支持；[报告](../.local/qa/20261111-1838-functional/long-prompt.json) |
| 独立 Host 启动器 | 通过 | 启动器进程退出后 Host 可用；第二次 ensureHost 复用同 PID；[报告](../.local/qa/20261111-1838-functional/launcher.json) |

本轮沿用已有依赖，没有重新清空 node_modules 执行 `npm ci`；新机安装可复现性仍未复测。DeepSeek 31 秒检查是合成原生协议 peer；真实 DSH 对话另测，两者不混算。

补充 API 初次有一项测试前置条件错误：所谓“非 Git 目录”放在仓库内部，Git 正确发现了父仓库。将此目录改到真正独立的临时目录后，18 项重新执行通过。这不是产品缺陷，也没有改写原始失败记录。

## 3. 按用例 ID 的实际覆盖

“通过”在下表仅指写明的检查范围；例如 API 历史分页通过，不代表已完成持续长时收流或真实手机验收。同一大纲用例还有其他操作/方法时，列在最后一栏，不给整条用例提前盖章。

| 大纲用例 | 本轮已执行部分与结果 | 尚缺的部分 |
| --- | --- | --- |
| ENV-01，OPS-05 | 类型、构建、测试通过；lint/格式修正复测通过 | 清洁依赖安装、远端 CI 未执行 |
| ENV-02/03/04/05 | 隔离 Host 健康、同目录双进程锁、重启保留 Host/会话 ID、启动器退出后存活和复用通过 | Electron 入口及真正 Vite 关闭流程不由此替代 |
| ID-01/02/04/05 | Kodo/pi 身份、工具装配、历史/迁移/默认配置隔离及无模型草稿通过 | 更多真实工具/路由组合未穷举 |
| ID-03，CTL-01/02/06/07/08/09 | 领域测试覆盖无 cwd 管理、范围、观察零模型、wake/暂停；Kodo→Codex 真实六工具闭环通过 | 其他 harness 目标闭环未执行；所有工具参数组合未穷举 |
| CTL-03/04/05/10/11 | 唯一控制者、多个观察者、转交、用户接管、未来授权、回滚通过；授权/转交 UI 通过 | 真正手机并发接管及真实 steer 未执行 |
| CTL-12/13，COST-04/05 | 自动次数占用、已有单控制/关系限制由领域断言覆盖 | 截止时间、所有预算维度、连续失败及批量停止完整验收未执行 |
| PRJ-01/02/06 | 多目录/非 Git/API/worktree 成功；领域归属变更暂停和原 ID/cwd 保留通过 | 运行中整理、目录丢失、项目归档/删除完整流程未执行 |
| SES-01/03/04 | 十种草稿独立入口、项目/模型绑定、改名置顶、归档恢复通过 | 保存视图、全部筛选组合、阅读位置与长时排序未穷举 |
| SES-02 | Kodo、pi、Codex、Claude、DSH 真实请求和恢复后回复通过 | 六种缺 CLI；其他四种的完整 UI 聊天路径未逐个操作 |
| REL-01～10 | 请求去重、顺序、未知对账、不重发、stop 竞态、wake、事务、全局异常、ingest、旧连接隔离的领域/进程断言通过 | 相应实际网络/设备条件逐项端到端测试未全完成 |
| REL-11/12/13/14/15 | snapshot/SSE 初始化恢复、领域事件去重/合并、1,000 条分页的 API 与浏览器观察通过 | 长时持续流、内存曲线和所有 SSE 断点条件未测 |
| INB-02/03 | 双端交互一次回应、不同 UUID 同答案幂等由领域断言通过 | 真实原生交互 + 实际手机并发点击未测 |
| SRCH-01/04 | 中文长词/双字/单字、英文、混合查询及索引迁移通过 | 大库性能、完整来源可用性提示未测 |
| **SRCH-02** | **失败：能搜到旧消息，点击不定位** | BUG-20261111-003，见第 5 节 |
| CFG-01/02/03/05/06 | 默认优先级、修订固定、过期编辑冲突、轮换与失败删除重试断言通过 | 各 harness 配置生效矩阵未全覆盖 |
| CFG-04 | 实际 keyring 合成凭据轮换/清理，数据库仅存引用通过 | 所有日志/API/浏览器持久层的完整凭据审计未执行 |
| COST-01/02/03 | 来源汇总、累计快照防重/防倒退、未知价格由领域断言覆盖；真实 usage 事件可取得 | 所有统计过滤、真实价格账单逐项对比未执行；quota 条件见矩阵 |
| OUT-01/02/03 | HEAD diff/共享作者未知、中文文件预览、大于 512 KiB 拒绝、真实 detached worktree 创建/清理通过 | 缺失文件、更多文件类型和 UI 边界未全覆盖 |
| OUT-04 | 新目标草稿、保留来源、handoff 事件且无模型调用通过 | 未发送真实交接材料，不能据此宣布跨 harness 交接全链路通过 |
| DESK-01～05 | 启动器环境处理有实现；Electron `--version` 本轮失败 | 环境阻塞；窗口/托盘/退出后任务存活仍未验收 |
| MOB-01/02/03 | 配对单次/到期/撤销/重启由领域测试覆盖 | 实际手机与 HTTPS 全链路未测 |
| MOB-04/06，UI-02/06 | 390px 输入/停止入口、导航通过；真实 Codex 双视口和 300 行有界渲染/无横向溢出通过 | 实际设备、软键盘、长时性能仍未测 |
| OPS-01/02 | 分页/GC 断言验证保护活动 watch、未知状态、命令/wake/去重数据 | 持续小时维护、90 天收件箱边界、长期空间曲线未单独验收 |
| ADP-01/02/03/05 | ZCode/OpenCode/ACP peer 与 SDK disconnected/空闲取消拒绝通过 | 缺 CLI 适配器真实 schema、登录/交互未测 |
| ADP-04 | 31 秒 peer 实时等待及无取消能力检查通过；DSH 真实短回合/resume 另通过 | 未特意产生超过 30 秒的真实模型回合 |

表外条目（包括 INB-01/04/05/06、SRCH-03/05、CFG-07、COST-06 的全部场景、OUT-05/06/07、MOB-05/07/08、UI-01/03/04/05、OPS-03/04/06/07）未进行完整验收。部分相关断言或源码观察不升级为完整用例通过。

## 4. Kodo + 十种原生 harness 本轮矩阵

| 对象 | 本轮真实对话/原 ID 恢复 | 原生历史 list/read | 运行中停止结果 | 其他结果/剩余条件 |
| --- | --- | --- | --- | --- |
| Kodo（额外主 agent） | 通过；恢复后身份为 Kodo | 两者通过 | cancelled + settled | 六工具→Codex、一次目标输入、持久 wake、暂停闭环通过；其余目标未测 |
| pi | 通过 | 两者通过 | cancelled + settled | 独立直接对话；steer/真实交互未测 |
| Codex | 通过 | 两者通过 | interrupted；后台静止未知 | 真实 UI 两种视口通过；quota 返回需 ChatGPT 登录；steer/真实审批未测 |
| Claude Code | 通过；本机原生 CLI 2.1.300 | 两者通过 | 请求确认；随后 completed/success，**取消未确认**；后台未知 | 未复测随附 CLI 的已知恢复问题；真实交互/订阅兼容未测 |
| DeepSeek Harness | 通过 | 适配器未提供两个入口，未计成功 | 原生版本无单轮 cancel | usage/quota 未提供；真实长回合未专门触发 |
| ZCode | 阻塞：未安装 | 只有 peer 结果，未实机 | 未实机 | partial；当前不开放自动继续 |
| OpenCode | 阻塞：未安装 | 只有 peer 结果，未实机 | 未实机 | partial；当前不开放自动继续 |
| Gemini CLI | 阻塞：未安装 | ACP 无独立 historyRead；list/load 待实际协商 | 未实机 | partial；当前不开放自动继续 |
| Cursor | 阻塞：未安装 | 同上 | 未实机 | partial；当前不开放自动继续 |
| Kimi Code | 阻塞：未安装 | 同上 | 未实机 | partial；当前不开放自动继续 |
| Grok Build | 阻塞：未安装 | 同上 | 未实机 | partial；当前不开放自动继续 |

各 harness 的 H-03/07 真实报告、H-09 中断请求报告见 [本轮汇总](../.local/qa/20261111-1838-functional/run-summary.json)。H-01/02/04/05/06/08/10/11/12/13/14 未按全部原生能力逐项完成；不以整条验证脚本的 exit 0 覆盖它们。

H-09 的脚本通过条件是“停止请求得到确认且随后回合结束”。Claude 虽然脚本 exit 0，其取消终态仍未确认；Codex 虽有 interrupted，仍无后台静止证据。Kodo 托管脚本最后对已空闲 Codex 的 stop 命令被拒绝，托管暂停已持久化；这符合“空闲取消不假成功”，不表示执行了原生 cancel。

健康快照本轮可区分已安装/未安装及 implemented/partial，但 version 仍为 null、authentication 为 unknown。本页 CLI 版本来自单独执行 `--version`，不能据此宣称产品健康页已经具有完整版本/登录探测能力。

## 5. 缺陷与阻塞

### BUG-20261111-001：lint 未通过（已修正、复测通过）

关联 ENV-01 / OPS-05。`apps/web/src/main.tsx` 多余的 KodoMark 导入触发 unused-vars；`DraftWorkspace.tsx` 有未产生作用的 eslint-disable。移除这两处，lint 复测退出 0。未修改业务逻辑。

### BUG-20261111-002：10 个文件未格式化（已修正、复测通过）

关联 OPS-05。Prettier 首次失败，对报告中的 10 个文件格式化后，全量 format:check 通过。涉及已有前端改动、Host 两个文件及脚本；保留原有功能改动，没有恢复旧实现或操作暂存区。

### BUG-20261111-003：搜索命中不能定位原消息（P1，未修复）

关联 SRCH-02。前置为隔离合成会话 1,000 条消息，仅第 10 条含 `QA_EARLY_TARGET_0010`。

1. 打开该会话，最新页显示 701–1000；点“更早记录”显示 401–700。
2. 搜索 `QA_EARLY_TARGET_0010`，列表出现包含第 10 条内容的命中片段。
3. 点击这个搜索结果。

预期：加载命中消息所在页并滚动/高亮该消息。实际：列表命中正确，但正文仍为 401–700，目标消息没有渲染。浏览器观测为 `hitSnippetVisible=true`、`targetMessageRendered=false`、`rows=300`。前端只保留 sessionId/snippet，选择结果走会话切换，没有使用命中的 eventId 做定位。

证据：[观测结果](../.local/qa/20261111-1838-functional/search-location-observation.txt)、[页面快照](../.local/qa/20261111-1838-functional/search-snapshot.txt)、[截图](../output/playwright/qa-search-location-failure.png)。这是产品功能缺口；已有搜索/分页测试通过不覆盖此行为。

### 阻塞项

- Electron 探针失败：本轮未继承 RUN_AS_NODE，软件渲染为 1，`--version` 仍退出 `2147483651 / 0x80000003`；记录为本机环境阻塞，非 Electron 通用缺陷。没有进入关窗/托盘/退出 UI 验证。
- 六种外部 CLI 尚未安装；用户已确认。本轮未再次请求路径，也未自行安装/登录。
- 没有执行真实手机、HTTPS 隧道/证书或锁屏/休眠验证；手机视口不能替代。
- Codex quota 需要 ChatGPT 登录，当前认证条件不足。其他缺少原生 usage/quota/steer 等能力的条目仍分别保持未知、不支持或待验证。

## 6. 后续测试入口

优先修复并复测 SRCH-02，连带回归 SRCH-01/04、REL-11/12、会话切换和手机布局，确认定位不重新引入历史全量加载。随后补做 PRJ/SES/INB/COST/OUT 的未执行交互与边界，特别是真实交接发送、截止时间/预算及原生审批。

需要环境解除后再执行的批次：六种 CLI 的每种 H 契约；DESK 全部；实际设备 MOB 全部。上述条件未满足前，本轮结论保持“部分功能已验证，有明确失败与阻塞”，不能标为首轮整体完成。
