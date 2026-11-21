# 手机连接与自建 Relay

## 使用方式

1. 启动桌面应用（开发环境可执行 `npm run dev`）。
2. 打开「设置 → 手机连接」，点击「生成配对码」。首次操作自动启用远程连接并生成设备身份。
3. 使用 Android / iOS 原生应用扫码（或手机系统相机扫码打开 Web / PWA）即可配对，无需公网 IP、端口映射、VPN 或手动配置隧道。
4. 在桌面查看已连接设备；撤销设备会立即中止其后续访问，并通知客户端重新配对。「关闭远程连接」会断开 Relay 并停止自动重连；重新启用不会自动撤销原有有效设备。

二维码的 URL fragment 携带短时邀请，网页读取后从地址栏清除。邀请为 128 位随机值，两分钟有效且只能消费一次。设备凭据有效期为 30 天，到期后重新配对。

iOS / Android 原生客户端支持应用内相机扫码：打开 App →「扫描桌面二维码」→ 允许相机 → 扫描桌面二维码 → 确认地址并「连接此电脑」。自动解析 HTTPS 地址、完整 `/h/<host-id>/` 路径和邀请码，无需复制填写；同时也保留手动输入方式。

两端只在本地设备上识别二维码，不保存或上传相机画面；离开扫码页或切入后台自动停止相机。无效或非 Kooyu 二维码不会自动打开网址或发起配对。iOS 使用 VisionKit，Android 使用应用内 ZXing，不依赖 Google Play 服务。

## 架构与数据边界

`客户端 HTTPS → 反向代理（如 Caddy） → Relay → 出站 WSS → 桌面私有远程 HTTP listener → Host`

- **Relay 部署**：源码位于 `services/relay`，可按 [部署说明](../deploy/kodo-relay/README.md) 私有化部署到自有服务器（例如 `https://relay.example.com`），并通过 `KODO_RELAY_ORIGIN=https://relay.example.com` 和 `KOOYU_RELAY_PROTOCOL=2` 指定桌面 Host 连接。反向代理仅公开 80/443，Relay 的 4321 端口仅绑定服务器 loopback。
- **Host 身份认证**：Host 默认不连接 Relay，启用后持久化开关，启动时自动恢复；使用 Ed25519 随机挑战签名注册稳定的 Host 路由，不接受任意自报身份。
- **私钥保护**：Host 私钥保存在系统凭据库中，本地 `relay-identity.json` 仅保存公钥与启用状态。
- **权限隔离**：私有远程 listener 强制设备认证，不复用拥有本机管理员权限的桌面 listener。配对码生成、设备管理、凭据配置及 Relay 开关仅限本机操作。
- **传输与加密边界**：
  - 原生 Android / iOS / Desktop 客户端采用 v2 配对协议，在配对时固定 Host 签名身份并对请求与响应端到端加密，Relay 无法读取明文内容。
  - 通过 Relay 打开的浏览器/PWA 使用 HTTPS/WSS 传输加密，离线信箱信封使用端到端加密；由于 PWA 静态资源由 Relay 提供，请将自建 Relay 视为受信任基础设施进行保护。
  - 浏览器凭据采用按 Host 命名与路径限定的 Secure / HttpOnly / SameSite Cookie；原生端采用 bearer token，Host 仅保存 token hash。Service Worker 不缓存 API、会话数据与配对响应。
- **离线加密信箱**：Host 休眠或离线期间，已注册验证公钥的设备可向 Relay 投递经 Ed25519 签名与加密的小型指令（每 Host 上限 32 条、单条 ≤ 32 KiB、最长保留 12 小时）；Host 重连后按本机最新有效设备表二次校验再执行。

## 断线与资源限制

Host 连接具备握手超时、退避重连与 ping/pong 保活；事件流定时心跳并检查凭据。断线期间不会静默重放未确认的写操作。

Relay 对配对尝试、普通 HTTP 请求、连接数、在途请求、请求体和发送缓冲均设有上限；容器部署模板默认启用只读文件系统与内存/CPU/PID 限制。

## 本地隔离验证

先执行 `npm run build`，再启动隔离测试 fixture（可省略参数使用本地回环 Relay，或传入自建 Relay 地址）：

```sh
node scripts/relay-test-fixture.mjs
# 或指定自建 Relay：
node scripts/relay-test-fixture.mjs https://relay.example.com
```

fixture 15 分钟后自动清理，不要将生成的邀请码、Cookie、token 或用户内容写入公开日志。

详细自部署、升级和回滚步骤见 [部署说明](../deploy/kodo-relay/README.md)。
