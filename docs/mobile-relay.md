# 手机连接与自建 Relay

## 使用方式

1. 启动或重启包含本次代码的桌面应用（开发环境可执行 `npm run dev`）。
2. 打开「设置 → 手机连接」，点击「生成配对码」。首次操作自动启用远程连接并生成设备身份。
3. 用手机系统相机扫描二维码，在浏览器打开并配对；可添加到主屏幕作为 PWA 使用。用户无需配置服务器、端口映射、VPN 或 HTTPS 隧道。
4. 在桌面查看已连接设备；撤销设备会中止其后续 API 访问，活动事件流会通知客户端重新配对。「关闭远程连接」断开 Relay 并停止自动重连；重新启用不自动撤销原有有效设备。

二维码的 URL fragment 携带短时邀请，网页读取后从地址栏清除。邀请为 128 位随机值，两分钟有效且只能消费一次。设备凭据有效期为 30 天，到期后重新配对。电脑休眠、Host 停止或断网时不能远程操作。

iOS / Android 原生客户端现在支持应用内相机扫码：打开 App →「扫描桌面二维码」→ 允许相机 → 扫描桌面二维码 → 确认地址并「连接此电脑」。自动解析 HTTPS 地址、完整 `/h/<host-id>/` 路径和邀请码，无需复制填写。手动输入和系统相机打开浏览器/PWA 两种方式继续保留。系统相机扫码仍打开网页，不声称已配置 Universal Links / App Links 自动唤起原生 App。

两端只在设备上识别 QR，不保存或上传相机图片；首次点击才申请相机权限，拒绝可到系统设置恢复，无法使用相机时提供手动输入。离开扫码页/进入后台停止相机。无效或非 Kooyu 二维码不会自动打开网址或发起配对。iOS 使用 VisionKit 并检测设备支持情况，Android 使用应用内 ZXing，不要求 Google Play 服务。

## 架构与数据边界

`手机 HTTPS → Caddy → Relay → 出站 WSS → 桌面私有远程 HTTP listener → Host`

- Relay：`services/relay`，部署在 `codego-new-db`，运行目录 `/opt/kooyu-relay`。Caddy 继续使用 `/opt/kodo-edge`，仅公开 80/443；Relay 的 4321 端口仅绑定服务器 loopback。
- Host 默认不连接 Relay，启用后持久化开关，启动时自动恢复；使用 Ed25519 随机挑战签名注册稳定的 Host 路由，不接受任意自报身份。
- Host 私钥在系统凭据库中，service 为 `Kooyu`；本地 `relay-identity.json` 只保存公钥与启用状态。复制数据目录而不迁移系统凭据不构成可用身份备份。
- 私有远程 listener 强制设备认证，不复用有本机管理权限的桌面 listener。配对码生成、设备管理及 Relay 开关是本机管理操作。
- Relay 不持久化会话或消息，不自动重放写操作；内容经内存转发。网页为服务器部署的受信静态构建，不能由任意已接入 Host 提供可执行 HTML/JS。
- 浏览器凭据采用按 Host 命名与路径限定的 Secure / HttpOnly / SameSite=Strict Cookie；原生端采用 bearer token。Host 只存 token hash。Service Worker 不缓存 API、会话数据和配对响应。
- **当前不是端到端加密**。HTTPS/WSS 保护传输链路，Relay 服务器可访问转发明文与认证凭据，需信任并保护服务器管理员和发布链路。

## 断线与资源限制

Host 连接有握手超时、退避重连和 ping/pong；事件流定时心跳并检查凭据。浏览器重新联网/返回前台时更新快照和当前会话。断线期间不自动补发写操作，结果未知时先核对状态。

Relay 对配对、普通 HTTP、连接数、在途请求、请求体和发送缓冲设上限。部署对容器设置内存/CPU/PID 限制、只读文件系统及轮转日志。这是单机部署，不提供多节点高可用或持久队列；以后官网可用独立域名和独立 Caddy site 共用服务器。

## 验证记录（2026-11-13）

- Host 领域/协议套件：314/314 通过；Relay 安全套件：2/2 通过。
- `npm run build`、`npm run typecheck` 和本次涉及文件的 ESLint 通过。
- 公网 HTTPS 浏览器隔离验收：桌面生成码、390×844 手机视口配对、快照、远程项目创建、刷新、在线/离线恢复、桌面撤销后返回配对、敏感 API 不缓存、无横向溢出和页面异常。
- 公网原生协议验收：bearer 配对、协议版本 2、SSE 心跳、撤销后 401、本机权限隔离；实际系统凭据库存取及重启后稳定 Host 身份通过。
- 线上发布 `20261113-2`：在已配对的隔离 Host 连接期间更新 Relay 容器，Host 自动重连，同一 Host 身份和原设备 token 继续有效；升级后公网健康检查通过。
- Android `testDebugUnitTest lintDebug assembleDebug` 通过；debug APK 位于 `apps/android/app/build/outputs/apk/debug/app-debug.apk`。
- iOS 路由前缀与路径校验测试已补充；本机是 Windows，没有执行 Xcode 构建。
- 全量 Web 回归：51 通过、14 失败。9 项为导航选择器与当前界面不匹配（Harness 与配置、Provider、手机访问、用量与预算），2 项为模型表预期 2 行实际 4 行，1 项为项目选择器文案不匹配，2 项为设置流程超时且清理阶段再次报错。详见 `.local/verification/relay-ui-regression.log`。这些流程尚未全部验收，不将本次连接链路通过表述为全部 UI 回归通过。
- 浏览器验收使用临时数据库和无模型适配器的 Host，没有真实模型调用；未替代真实手机蜂窝网络、系统相机、后台恢复、原生 App 或长期稳定性验收。

复现：先构建，运行 `node scripts/relay-test-fixture.mjs https://relay.kooyu.app`，再运行 `node scripts/verify-relay-network.mjs`。fixture 15 分钟自动清理，连接信息位于 `.local/verification/relay-fixture.json`。浏览器流程为 `scripts/relay-browser-check.js`，使用 Playwright CLI 在 fixture 桌面的「手机连接」页执行。不要将生成的邀请、Cookie、token 或用户内容上传到日志。

部署、升级和回滚见 [部署说明](../deploy/kodo-relay/README.md)。
