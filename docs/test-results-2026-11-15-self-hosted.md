# 自部署工作伙伴实现与验收（2026-11-15）

补充：本日真实 Electron 43 个页面/面板状态、共 93 张截图（含长页面分段）、Web 92 项及 Android 构建结果见 [桌面与 Android 页面验收](test-results-2026-11-15-desktop-android-pages.md)。BlueStacks 安装因管理员确认取消而阻塞，Android 原生页面尚未验收。

依据 [设计方案](kooyu-self-hosted-agent-design-2026-11-14.md)，在现有 Host、Store、pi SDK 和原生 Harness 适配器上扩展；没有建立第二套 Agent loop 或分布式数据库。当前实现覆盖 Host/Web 的持续工作主体，仍有下表列明的未实现和外部验收项。较早批次见 [A 阶段记录](test-results-2026-11-14-self-hosted-phase-a.md)。

## 方案分析与实现取舍

方案的关键是让用户目标、触发、授权、外部动作、成果和实际证据分别持久化。原生回合结束不自动完成目标；来源资料不能扩大用户授权；未知外部写入不因超时或重启而重新执行。这些规则比增加工具数量更直接影响常驻服务是否可托付。

实现复用同一 SQLite 事务与提交后通知，将有唯一性约束的对象落在专表。稳定请求 ID 和参数摘要处理重试；CAS、grant 修订、连接 generation 和浏览器租约分别处理不同的权限变更。事务内不等待网络请求。外部 API 的成功响应或本地动作回执是有限证据，不承诺所有服务商都能提供恰好一次执行。

执行位置分为 Host 和显式登记的 Worker。节点保存自己的原生登录和历史，Host 不把节点路径当作本地路径，也不转发 Host 模型凭据。浏览器先提供本机 Chromium profile 和独占租约；它不是代码沙箱或远程桌面。部署文件与实际平台发布分别记录。

## 实现范围

| 阶段 | 已落地 | 仍存在的边界 |
| --- | --- | --- |
| A | Goal/Verification、Git 基线、成果验收；公网网页读取与检索；受管上传、下载和成果；系统/加密文件 Vault；动作回执、容量、排空；通知 feed、Bark、Web/APNs；iOS APNs 注册/撤销/定位源码；Android 可选前台服务/SSE 与通知；独立 Host 与部署定义 | iOS 未运行 Xcode/签名/真机；Android 前台服务、锁屏/回收/切网未真机验收；原生移动端新增目标/文件/工作中心界面未接入；真实离桌面模型闭环未验收 |
| B | cron/once/Webhook、Activation、时区和错过策略、单计划单实例；GitHub HMAC 去重与白名单；GitHub/Slack、授权 grant、OAuth/PKCE、业务 Outbox；有来源的项目记忆和修订 | GitHub/Slack/OAuth 用隔离服务响应验证，尚无实际厂商账户端到端证据；费用限制覆盖控制主对话已知实际成本，不是完整委派链硬封顶 |
| C | 真实受管 Chromium 的打开/读取/表单/截图；人工接管与交还；节点登记/撤销；HTTPS Worker 原生协议、文件哈希传输和回执恢复；Web 草稿节点与目录选择 | Worker 是同机独立进程验收，原生程序为 fixture；跨机器及真实原生登录未验收；远程浏览器、桌面视频/输入转发未实现；节点生成文件尚无自动回传成果通道 |
| D | Slack、远程 MCP 和 skills-only 清单；应用版本不可变、导出、权限差异、连接升级撤销旧 grant | 任意代码应用沙箱、媒体生成/转录、正式签名/公证、各平台发布与安装升级未实现或未验收 |

## 代码落点

| 能力 | 主要文件 |
| --- | --- |
| 领域协议和迁移 | `packages/protocol/src/{goals,files,notifications,self-hosted,web}.ts`；`packages/host/src/storage/{schema,store,self-hosted}.ts` |
| 目标、联网与文件 | `packages/host/src/goals/`、`tools/web.ts`、`files/`、`http/work-routes.ts`、`kodo/work-tools.ts` |
| 持续工作和权限 | `packages/host/src/automations/`、`applications/`、`messaging/outbox.ts`、`memory/service.ts` |
| 生命周期和执行 | `packages/host/src/lifecycle/gate.ts`、`execution/{actions,capacity,browser,service,worker}.ts`；`session-service.ts` |
| 凭据和通知 | `packages/host/src/credentials/`、`notifications/`、`apps/web/src/lib/work-notifications.ts` |
| 原生移动提醒 | `apps/ios/Kooyu/{PushNotifications,Workbench,KooyuApp}.swift`、`Kooyu.entitlements`；`apps/android/app/src/main/java/app/kooyu/android/{BackgroundReminders,NotificationStream,Workbench,MainActivity}.kt` |
| 工作界面 | `apps/web/src/components/{GoalPanel,Attachments,WorkCenter,DraftWorkspace}.tsx`；`styles/work-center.css` |
| 运维 | `deploy/kooyu-host/`、`.dockerignore`、`scripts/{doctor,host-admin,host-backup,worker}.mjs`；`packages/host/src/main.ts` |

SQLite 当前版本为 9，协议主版本仍为 2。迁移前创建私有快照；失败回滚原数据库。旧客户端继续使用既有文本接口，新增能力通过独立 API 与 capability 查询发现；不将 TypeScript/Web 的完成外推到 Swift/Kotlin 客户端。

## 验证记录

本机环境：Windows、Node.js 24.13.0。所有验收均使用隔离数据目录和临时密钥，没有调用收费模型或发送真实业务消息。

| 命令 | 结果与覆盖 |
| --- | --- |
| `npm test` | **387/387**：Host 全量，含既有原生协议、授权、交互、文件、网页、Goal、自部署与 APNs 专项 |
| `npx tsx --test packages/host/test/apns.test.ts packages/host/test/self-hosted.test.ts` | 自部署 **25/25**、APNs **10/10**：ES256、Vault、真实本地 HTTP/2、失效/退避/CAS/撤销/轮换/冻结及真实鉴权路由 |
| `npm run test:relay` | **2/2**：签名、来源、跨 Host 响应及 Cookie 隔离；Host 全量另含实际 Relay 连接/配对/撤销测试 |
| `npm run test:ui -w @kodo/web -- draft-flow.spec.ts first-message.spec.ts work-center.spec.ts` | **14/14**：桌面/手机工作中心、计划节点持久化、记忆编辑、OAuth 外链、同一事项通知深链、远程目录/绑定隔离、附件草稿与首条消息反馈 |
| `npm run test:ui` | **92/92**，3.3 分钟；新增 1440/390px APNs 配置、私钥清空/不回显及布局检查。此前节点选择器占栏问题保留回归 |
| `npm run verify:self-hosted-admin` | 真实独立 Host 进程：TLS、回环管理 CLI、公网配对地址、冻结/恢复、公网无认证管理拒绝 |
| `npm run verify:self-hosted-worker` | 真实 HTTPS + 独立 Worker 进程：原生协议创建/发送、附件哈希、重复回执不重发、重启无回执返回 unknown、恢复排队输入不补发 |
| `npm run typecheck`、`npm run lint`、`npm run format:check` | 通过 |
| `npm run build` | protocol/platform/Host/Web/Electron 构建通过；最终恢复与范围修复后重新构建 |
| Android `testDebugUnitTest lintDebug assembleDebug` | **48/48**，lint 0 errors / 22 warnings，开发 APK 构建与签名通过；后续 BlueStacks Android 13 原生逐页与后台提醒补验通过，38 张 PNG；仍无实体手机运行证据 |
| Swift tree-sitter / 新增 XCTest 源码 | **22** 个 Swift 文件无语法错误；推送目标 XCTest 未执行，没有 Xcode 编译/严格并发/Apple 签名证据 |
| `docker compose -f deploy/kooyu-host/compose.yaml config --quiet` | 使用临时测试变量校验通过；没有启动部署 |
| `git diff --check` | 通过；已有 `docs/design.md` 行尾转换提示不影响检查 |

Docker CLI 存在，但 Docker Desktop Linux Engine 管道不存在；`docker info` 无法连接引擎。因此没有 Docker 镜像构建、Linux Chromium、systemd 常驻部署或生产容量的实际证据。

Worker 验收原生入口为 `packages/host/test/fixtures/native-peer.mjs`。这证明 transport、文件、回执与重启策略，不证明真实 Codex 模型推理或跨机器兼容。真实 Chromium 验收访问临时本地 HTTP 页面，验证读取、输入和 PNG 成果，未登录真实网站。OAuth 测试覆盖已配对浏览器回调路由与状态机；授权服务器响应是 fixture，未登录真实厂商。

## 本轮收紧的恢复与授权边界

- 动作结果重放前重新验证 grant、连接与浏览器代次。用户接管后相同 toolCallId 不能重放旧结果；参数不同返回冲突。
- 同一 occurrence 的并发不同 payload 在事务中拒绝，不创建第二个 Goal。费用使用实际 `costUsd`；未知/估算费用阻止带成本限制的新发生。
- 远程工作区不采集 Host Git 基线，不执行 Host 检查命令；草稿默认目录、最近目录和预设重置筛除远程路径。
- 浏览器标签标题/URL 按该 grant 的精确站点范围过滤。应用工具发现拒绝到期授权，并在网络等待后重新检查连接与授权。
- 浏览器工具透传 goalId，支持有效的目标范围 grant；缺失或错误目标不会扩大授权。远程草稿的项目切换按节点匹配目录，本机新建项目明确切回 Host。
- OAuth state 单次使用且绑定发起设备；撤销后的连接不能通过 start/refresh 复活。Host 和 Relay 的配对 Cookie 使用 HttpOnly/Secure/SameSite=Lax，允许顶层 GET 回调；跨站写入仍受 Origin 与 JSON 请求限制。
- 冻结后不启动新通知外发；设备/通道变更在读取 Vault 后再次检查；排空等待在途通知与动作。Bark 深链只定位同一事项，不自动批准。
- Worker 在原生动作前保存 intent。重启丢失结果返回 unknown；在 SessionService 的恢复计时器启动前，也将旧的 accepted 本地命令置为 unknown，避免另一路补发。
- 备份验证认证加密、逐文件哈希、归档路径和版本；恢复要求新目录，生成新 Host 身份、撤销设备/grant、禁用外部连接并冻结自动运行。凭据、浏览器登录和外部原生历史不包含在默认备份中。

## 与设计验收矩阵的对应

“覆盖”表示有本地自动化证据；以下未把一个模拟测试直接写成整条产品验收完成。

| 设计 ID | 当前证据与不足 |
| --- | --- |
| G01–G03 | Goal 状态/用户验收、控制代次、已有 Git 改动归因覆盖；多真实 Harness 完整目标仍需联调 |
| G04–G05 | 容量争抢、人工优先和后台状态覆盖；后台退出证据仍取决于各适配器能力，不能统一推断 |
| Q01–Q02、A01–A04 | 提交后派发、回滚、发生唯一性、恢复 unknown、时区/DST、single-flight 与修订覆盖；原生历史消费保证按适配器逐项保留 |
| H01–H03 | GitHub raw-body HMAC、delivery/digest、白名单、机器人仅观察、撤销与单归属覆盖；真实 GitHub 投递未验收 |
| N01–N05 | 持久 feed/游标、通道撤销、前台确认、原生一次答复、业务 unknown/目的地隔离覆盖；真实手机锁屏与切网待验收 |
| F01–F03 | 分块上传/取消/哈希、文件越界/符号链接/会话范围、HTTPS Worker 下载覆盖；节点成果自动回传未实现 |
| P01–P03 | PKCE/state、并发刷新撤销、到期授权、不可变版本/权限差异、动作回执与重放覆盖；厂商 OAuth/MCP 实际接入待验收 |
| M01 | 模型提议/用户确认、修订/删除和项目隔离覆盖；Web 可纠正/删除，下一轮读取最新记忆 |
| E01–E02 | 真实 Chromium 租约代次、Worker token/离线拒绝、远程目录保护覆盖；远端浏览器与网络分区的双机测试未做 |
| O01–O03 | 进程身份与冻结代次、在途排空、离线备份/新身份、迁移回滚、密钥缺失无明文降级覆盖；Linux 服务升级待验收 |
| C01 | v2 文本/配对/原生快照路径回归通过；新增工作中心仅在 Web 实现 |
| C02 及平台发布 | Host APNs 和 iOS 注册/撤销/点击源码已接入；Android 前台服务/SSE 源码、JVM 单测与开发包构建通过。iOS Xcode/签名、两端真机锁屏/回收/切网和正式发布未验收 |

## 使用与交付限制

### 本轮原生提醒补充

- Host APNs 签名密钥和设备 token 独立保存在 Vault，状态响应不含密钥或引用；仅本机可修改签名配置，配对设备仅能注册/撤销自己的通道。协议 capability 表示代码可用，是否配置/启用由状态接口另行判断。
- APNs 使用固定 HTTPS HTTP/2、ES256 缓存、15 秒超时和 4 KiB payload 上限；稳定推送身份、有限重试和失效 token 禁用。配置轮换取消旧待发并禁用旧注册；相同注册不取消在途待发，晚到失败不关闭新注册。冻结与 Vault 等待之间重新核对代次，排空等待在途发送。
- iOS 只在用户主动允许后逐 Host 注册，校验 Bundle ID 和签名环境；token 不写 UserDefaults。委托点击只接受 Host/通知身份，从已保存 Host 读取当前事实。前台同一会话短期确认，失败时继续展示；关闭通知的离线撤销保持待重试。Xcode 未运行，不能把 Swift 语法检查称作原生编译通过。
- Android 使用用户主动启用的 remoteMessaging 前台服务和可停止的常驻通知，SSE 游标/展示身份持久化、断线退避、大小有界、重定向拒绝。Host 通道关闭、设备重配/移除取消旧连接。reset 不重放历史提醒。仅同一前台会话确认，点击只定位，不批准或重发。系统回收恢复受平台限制，未申请开机自启或省电豁免。
- 新增 Host 测试用隔离 HTTP/2 fixture，不访问 Apple；Android JVM 流测试使用 loopback fixture。后续已在 BlueStacks Android 13 真正启动 remoteMessaging 前台 Service，验证退后台仍运行、演示通知送达、点击读取同一事项/会话、已读回执及关闭后的 Host 撤销确认。Web 桌面和手机宽度截图已检查。构建日志位于 .local/self-hosted-final-{host,ui,build,typecheck,lint,format}.log 与 .local/self-hosted-android.log，Android 单测报告在 apps/android/app/build/test-results/testDebugUnitTest/。

### 桌面与 Android 原生补验（同日）

Electron 43 个页面/面板状态、93 张 PNG；BlueStacks 5.22.290.1031 / Android 13 SDK33 / 1080×1920 320dpi 的 38 张原生 PNG。配对、多个冷启动恢复凭据、原生文件预览、后台 Service/通知与撤销流程通过。扫码 Activity 与取消返回通过，但 FLAG_SECURE 阻止 ADB 输出可用截图，单独记录 XML 和限制说明，不绕过保护。Android 9 默认模拟器实例独立复现 Keystore 目的丢失，改用 Android 13，产品无加密降级。详细证据、截图索引与复现参数见 [双端逐页验收报告](test-results-2026-11-15-desktop-android-pages.md)。本次还修复 Host Relay 客户端非法 close code，并通过 2/2 针对性回归。

启动、模型与应用、节点配置、Webhook、排空和备份操作见 [自部署 Host 操作说明](self-hosted-operations.md)。文件 Vault 不可用时密钥相关能力保持禁用。管理 CLI 仅访问回环 HTTP；TLS Host 可另配 `KODO_ADMIN_PORT`，Compose 不公开该管理端口。

自动化的 Kooyu 控制对话仍在 Host，指定节点作为派发可用性条件并写入任务说明，原生执行会话通过 executorId 固定节点；当前没有将控制对话的全部工具强制隔离到该节点。远程计划不是在节点运行另一份 Kooyu 或迁移现有会话。需要严格执行环境隔离的部署应使用专用 Host/工作区，不能把这一设置当成沙箱。

本轮没有新增真实第三方凭据、推送设备、签名证书或发布环境，不能宣称真实业务平台、五端和生产部署均已完成。上述未实现项需要后续代码；未验收项需要相应真实账户、设备或运行环境的独立证据。
