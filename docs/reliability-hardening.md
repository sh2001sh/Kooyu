# 可靠性修复与验证（2026-11-11）

本页对应本轮 P0/P1/P2 清单。Kodo 是基于 pi 内核的产品主 agent；独立 pi 仍是首轮十种 harness 之一。没有修改 vendor/pi，也没有恢复旧架构。

## 异常、断线与停止

- Host 注册全局 `uncaughtException` / `unhandledRejection`：立即停止调度，持久暂停托管、取消未递送命令，然后以退出码 1 退出。清理上限 3 秒；下次启动按持久回执恢复，对 dispatched 结果转 unknown，不重发。
- 原生 emit 的 ingest 失败只隔离所属会话：暂停相关自动控制、标记连接/执行未知、记录收件箱并关闭连接；其他会话仍可工作。连暂停也无法持久化时触发进程级兜底。订阅者异常独立处理，不回滚已提交事件。RPC 翻译异常关闭该原生连接。
- Kodo、pi、Claude SDK 的异常/关闭产生 disconnected；连接代次屏蔽旧连接迟到的事件和交互。断线暂停自动继续，不能被旧完成事件唤醒。
- 离线 stop 的托管暂停仍有效，但原生取消命令为 unknown；空闲 SDK/Codex 的取消拒绝执行。停止 Kodo 主对话同时暂停它对其他目标的自动控制，目标迟到事件不能再次唤醒它。命令 confirmed 最多说明取消请求被接口确认，执行是否结束仍看原生事件。DeepSeek 不支持单轮 cancel，明确返回 unsupported。
- 真实实测：Kodo、pi 在输出中 abort 后收到 cancelled 和 settled；Codex interrupt 后收到 interrupted，后台状态未知；Claude interrupt 请求得到确认并收到原生 success 回合结束，**不能据此断言 cancelled 或后台已静止**。

## 事件、历史与搜索

原生文本按会话/回合、item、channel 合并，最长等待 100ms 或达到 8,192 个 UTF-16 单元；语义事件之前先提交文本。合并事件与其原生 ID 去重凭证在同一事务提交。测试中 10,000 个带 ID 的字符增量合成两个正文事件，额外 thought 事件保持独立。去重凭证只保存 ID，不能据此声称所有元数据已恒定大小。

Snapshot 提供全局 eventCursor，前端建立带 after 的 SSE；EventSource 重连使用 Last-Event-ID。新开页面按 snapshot 取得当前投影，不从零重放历史。会话正文取最新 300 个事件，较早历史通过 before 向前分页，每次替换当前页；实时窗口同样最多 300 个事件。历史页保持阅读位置，返回最新时重新读取尾页。完整文本消息仍保存在 Host/原生会话，分页边界可能落在一个长回合内部。

SQLite v4 将已有 FTS5 索引事务迁移为 trigram，支持中文子串；一至两个字符的查询使用参数化子串扫描，较大历史下短词查询可能慢。原生历史快照只保留当前搜索版本。ACP 没有独立历史读取接口，已移除假的 read，historyRead 明确标为 unsupported；session/load 的恢复回放不冒充历史读取。

交互请求在前端保留“交互 ID + 答案摘要”的稳定 UUID，合并同一交互正在进行的提交；不会把原始回答存进浏览器持久存储。Host 对已处理的同一答案幂等返回，不同答案冲突。DeepSeek prompt 等待完整原生回合，不使用握手的 30 秒超时；连接关闭仍使等待结果进入未知，不自动重发。

## 数据保留与凭据

Host 启动和之后每小时执行维护：

| 数据 | 策略 |
| --- | --- |
| 空闲会话的 text-delta/state 明细 | 保留 30 天、每会话最多最近 20,000 条；活动 watch 尚未消费的区间受保护 |
| 运行/未知状态会话的上述明细 | 暂不清理，先完成原生对账 |
| 已解决收件箱 | 90 天后删除 |
| 消息、工具、生命周期、usage、原生身份 | 保留；没有暗中删除原生会话文件 |
| commands、wakes、停止/交互回执与去重 tombstone | 保留，以免旧请求或事件再次执行；未知递送永不按年龄丢弃 |
| profile 修订与 key | 保留当前 profile 和所有现存会话绑定的修订；其他修订与无引用 key 可清理 |

维护释放 SQLite 内部可复用页，不承诺自动缩小数据库文件；长期保留的审计/去重元数据仍会增长，完整导出/内容擦除与压缩界面尚未实现；后续已新增本地逻辑删除，原生身份、原生文件和对账记录保留。

写入新凭据之前先记录持久 inventory；提交失败时尝试删除，崩溃窗口的 pending 项一小时后回收。删除失败保留 inventory，后续维护重试。已使用本机系统 keyring 的临时合成凭据验证轮换删除、会话固定 key 保留和清除无引用 key，验证后临时凭据全部删除。轮换不会删除历史会话所需 key。此修复上线之前、从未留下任何数据库引用的 keyring 孤儿无法可靠自动定位，不扫描或删除用户其他应用凭据。

配对码单次、两分钟有效；设备 token 固定 30 天有效，cookie 同期，到期需重新配对，可随时撤销。旧 token 也按创建时间加 30 天判定，不自动延长。

## 工程与 Electron

加入 Prettier/ESLint、根 scripts 与 CI 检查，源码拆分格式化，Host 测试也纳入类型检查。TypeScript 固定为 6.0.x，以满足当前 typescript-eslint 的 `<6.1` peer 要求；没有使用 force/legacy-peer-deps 绕过依赖约束。

Electron 按**本机环境缺陷**记录：用户已经定位继承 `ELECTRON_RUN_AS_NODE=1` 以及 GPU 初始化 `0xC0000005`。启动器先清除此变量；Windows 默认 software rendering，可用 `KODO_SOFTWARE_RENDERING=0` 显式启用 GPU；独立 Node Host 不继承该 Electron 变量。保留 sandbox/contextIsolation。

首次运行清理变量后，版本探针仍返回 `0x80000003`。后续证实：同一份官方 runtime 在仓库 E 盘失败，放到 C 盘用户目录成功；底层位置/卷相关环境触发尚未定位。启动器新增整份 runtime 内容校验和用户缓存回退，Electron 仍为 39.1.0，没有降低 sandbox。实际窗口、Host 连接、托盘图标、关窗隐藏/重开、退出 UI 后真实 Codex 任务继续完成和原生 ID 保持均已验证；完整停止菜单和打包场景尚未验收。见 [后续复测](test-results-2026-11-11-fixes.md)。

后续还修复旧消息搜索定位和 SDK 整轮等待堵塞 steer：事件定位始终限制 300 个上下文事件，原生快照按来源显示并拒绝过期引用。新增待发撤回、本地逻辑删除；停止/unknown 保护保持。真实 Kodo/pi/Codex steer 和五个入口的排队/撤回/本地删除证据单列在复测报告。

具体通过数量、真实 harness 能力与未安装条件见 [实现状态](implementation-status.md) / [verification.json](verification.json)。本地原始报告与浏览器截图分别在 `.local/verification`、`output/playwright`，不提交运行数据或凭据。
