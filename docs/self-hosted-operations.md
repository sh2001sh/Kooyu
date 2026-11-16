# 自部署 Host 操作说明

更新：2026-11-15。当前源码支持计划、Webhook、GitHub/Slack 与远程 MCP、项目记忆、受管 Chromium、显式选择的 Worker、加密离线备份、Host APNs 与原生移动提醒入口。实现事实与验收限制见 [本轮报告](test-results-2026-11-15-self-hosted.md)。远程桌面画面/输入、任意代码应用沙箱和正式平台签名发布尚未实现；原生推送真机验收尚未完成。

## 环境与初次启动

需要 Node.js ≥ 24.13、npm 锁文件对应依赖、Git，以及要执行的原生 Harness。运行 `npm ci`、`npm run build`。直接启动为 `npm run start:host`；浏览器打开 `http://127.0.0.1:4310`。界面关闭不会停止独立 Host。

服务器使用独立系统用户和私有数据目录。文件凭据后端需要独立主密钥；没有密钥时显示不可用，不降级明文存储。下面生成的是密钥文件，命令不打印密钥：

```sh
node -e "require('node:fs').writeFileSync('vault.key',require('node:crypto').randomBytes(32).toString('hex'),{flag:'wx',mode:0o600})"
```

设置 `KOOYU_CREDENTIAL_BACKEND=file`、`KOOYU_VAULT_KEY_FILE` 为该文件的绝对路径。POSIX 主密钥必须只对运行用户可读；Windows 应使用该用户的私有目录和 ACL。文件 Vault 与备份使用不同主密钥。系统密钥环仍是普通桌面部署的默认后端。

| 环境变量 | 用途 |
| --- | --- |
| `KODO_DATA_DIR` | Host 数据与文件目录；不得与另一进程共享 |
| `KODO_HOST_PORT` | 主监听端口，默认 4310 |
| `KODO_BIND` | 默认 127.0.0.1；公开监听要求同时配置 TLS |
| `KODO_PUBLIC_ORIGIN` | 完整 HTTPS origin，无路径；用于配对与 Bark 点击定位 |
| `KODO_TLS_CERT` / `KODO_TLS_KEY` | PEM 证书和私钥路径 |
| `KODO_ADMIN_PORT` | 可选独立 HTTP 管理端口，只监听 127.0.0.1，必须区别于主端口 |
| `KOOYU_MAX_EXECUTIONS` | 原生会话执行容量，1–128，默认 4；不表示操作系统沙箱 |
| `KOOYU_CHROMIUM_PATH` | 可选已有 Chromium 路径；否则使用 Playwright 安装路径 |

TLS Host 可设置 `KODO_ADMIN_PORT=4311`，在服务器本机执行 `node scripts/host-admin.mjs GET /internal/health`。该 CLI 只接受回环 HTTP，JSON 从文件或 stdin 读取。通过 SSH 转发管理端口时，仅绑定客户端回环地址；不要把管理端口公开。正常配对设备可以查看工作、暂停计划、处理原生请求，但不能配置凭据、授予新外部权限或对账未知动作。

## Docker 和 systemd

容器定义位于 `deploy/kooyu-host/`。Dockerfile 构建 Host/Web，安装 Chromium 及 Linux 依赖，以非 root 用户运行；`.dockerignore` 排除本机数据、依赖、原生登录和密钥。镜像没有预装十种外部 Harness，按实际任务另行安装并检查入口。容器中的 Chromium 保持独立 profile，但没有独立桌面或应用级沙箱承诺。

准备 `VAULT_KEY_FILE`、`TLS_DIRECTORY`（含 `fullchain.pem` / `privkey.pem`）、`WORKSPACE_DIRECTORY` 和 `KODO_PUBLIC_ORIGIN`，然后运行：

```sh
docker compose -f deploy/kooyu-host/compose.yaml up --build -d
docker compose -f deploy/kooyu-host/compose.yaml exec host node scripts/host-admin.mjs GET /api/host/doctor
docker compose -f deploy/kooyu-host/compose.yaml exec host node scripts/host-admin.mjs POST /api/pairing
```

密钥与证书必须能被容器内 UID 1000 读取，数据卷也必须可写。Compose 本地 secrets 可能保留源文件 ownership，不能仅依赖 YAML 的 `mode` 修复宿主权限。管理端口 4311 不映射到宿主网卡；管理 CLI 在容器内执行。配对码两分钟有效，配对结果生成独立设备身份。设备撤销立即阻止继续读取和操作。

`kooyu-host.service` 是 systemd 模板，默认安装位置 `/opt/kooyu`、数据 `/var/lib/kooyu`、环境 `/etc/kooyu/host.env`。创建 `kooyu` 用户后，调整 Node 路径、目录与密钥 ownership。服务具有 `UMask=0077`、自动重启、独立临时目录和明确的可写工作区。需要安装/升级 Harness 时，安装目录必须位于允许写入的位置。Docker/systemd 脚本不等于已在目标 Linux 环境完成部署验收。

## 模型、应用和持续工作

本机界面进入“设置 → 工作中心”。先创建 Kooyu 主对话、配置可用 Provider/模型/绑定，再选择主对话管理工作。项目主对话需要真实工作目录。公开 HTTPS 访问的设备不能取得本机管理员权限；远程服务器的初始化配置可通过管理 CLI 提交相同 API。

例如把完整 JSON 请求存为私有文件 `request.json`，通过 stdin 提交，不把访问令牌写进命令行参数：

```sh
docker compose -f deploy/kooyu-host/compose.yaml exec -T host node scripts/host-admin.mjs POST /api/applications/connections - < request.json
```

应用连接请求包含 `requestId`（UUID）、`applicationId`（`github` / `slack`）、`version`（`1.0.0`）、`name` 和 `token`；OAuth 可用 `auth: "oauth"` 替代 token。之后通过 `/api/grants` 明确授予连接、主对话、操作和精确资源。GitHub 使用 `owner/repo`，Slack 使用频道 ID，MCP 使用服务 origin 与 `mcp.<tool>` 操作。不可变应用清单支持 builtin、remote-mcp、skills-only；相同版本不能覆盖，升级撤销旧授权，需要审阅权限差异后重新授予。首版不执行任意上传的代码包。

OAuth 通过 `/api/oauth/configure` 配置客户端和服务端点，`/api/oauth/start` 生成 PKCE 地址。回调为 `/api/oauth/callback`（Relay 为 `/h/Host路由ID/api/oauth/callback`），必须由发起设备完成；本机桌面可使用 `http://127.0.0.1:管理端口/api/oauth/callback`，公开回调使用 HTTPS 和同一已配对浏览器。桌面界面生成授权链接后在系统浏览器打开，完成后返回刷新。state 单次使用、十分钟过期，配置变更或撤销使旧 state 失效。

计划先需要不绑定应用的 `automation.execute` grant，资源为 `session:主对话ID`。工作中心可预览时区、一次性/cron 时间、选择执行节点、设置次数/费用限制、保存、暂停及查看发生记录。重复逻辑时点只创建一个 Activation；同一计划默认单实例，忙碌时等空闲；错过时点按 skip/coalesce；修改定义不改变旧发生记录。费用限制目前按控制主对话已记录的实际 `costUsd` 累计，不是计费服务的硬扣款封顶；估算/未知费用拒绝继续自动运行，不能承诺精确的整条委派链费用。

GitHub 事件先创建 webhook 类型计划，再通过 `/api/webhooks` 配置独立随机 HMAC secret、仓库/事件/用户白名单。公开入口是 `POST /hooks/连接ID`，无需设备 token；按 GitHub 原生 raw-body HMAC 验签。同 delivery 不同正文返回冲突，机器人和未授权事件只观察，默认 observe。事件正文是资料，不能授予新权限。应用业务回复具有独立待发箱；未知结果阻塞同目标/目的地后续回复，其他目的地继续。

项目记忆必须带来源，模型只能提出建议。用户确认后注入下一轮；纠正和删除生成新修订，其他项目不会继承该项目的记忆。全局用户记忆按用户范围共享。不要在记忆中保存密钥。

## 浏览器与 Worker

本机浏览器安装命令为 `npx playwright install chromium`。工作中心创建环境时绑定主对话与允许的 origin；Agent 另需 `browser.read` / `browser.write` grant。首次使用工具获取短租约。人工登录/接管打开本机 Chromium 窗口，旧 generation 立即失效，用户明确交还后 Agent 才能重新获取控制权。无图形桌面的服务器可用页面读取/截图；交互登录需要已有桌面会话，Web 页面中尚无实时画面与输入转发。

远程节点通过 `/api/executors` 登记，返回的 token 只在本次创建响应显示。把 token 单独存为节点用户私有文件，通过 `/api/executors/节点ID/workspace` 登记节点路径引用。Host 不解析该路径，Worker 使用 realpath 和 roots 校验。节点断线不切到其他位置执行。节点使用自己的 Harness 安装和凭据，Host Provider 绑定不会转发。

Worker 配置文件示例（替换 ID 和本机路径，token 不写入 JSON）：

```json
{
  "hostUrl": "https://kooyu.example.com",
  "executorId": "替换为登记返回的 UUID",
  "tokenFile": "/home/worker/.config/kooyu/token",
  "dataDir": "/home/worker/.local/share/kooyu-worker",
  "roots": ["/home/worker/projects"],
  "harnessIds": ["codex", "claude-code"]
}
```

在节点安装同版本源码及依赖、执行 `npm run build:core`，然后 `node scripts/worker.mjs /绝对路径/worker.json`。仅接受有效证书的 HTTPS；使用私有 CA 时用 Node 的 `NODE_EXTRA_CA_CERTS`，不要关闭 TLS 校验。配置的工作区 roots 必须存在，数据目录不得与 Host 或另一 Worker 共用。原生入口可在节点 `dataDir/installations.json` 配置（与本机 Host 相同格式）。停机使用 SIGTERM，Windows 使用服务管理器；强杀后按未知动作恢复语义核对。

附件在执行端重新上传到节点文件库，完成哈希校验后才发送给原生会话。节点持久保存任务 intent 与结果；重复领取重放结果，崩溃后 intent 存在但结果缺失则上报 unknown，不能自动重做。节点 token 撤销后不能继续轮询、拉文件或提交结果。

可运行 `node scripts/verify-self-hosted-worker.mjs` 做本地验收：需要 OpenSSL（可设置 `OPENSSL_BINARY`），自动生成临时 TLS 证书、启动真实 Worker 子进程，用隔离 Codex 协议 fixture 验证原生打开/发送、附件哈希、结果重放和重启后 unknown。它不验证真实模型账户或跨机器网络。

## 通知、维护与恢复

全局记忆在桌面与原生移动端的“设置 → 全局记忆”管理，同 Host 共用。Kooyu 主对话可以自动保存长期偏好；关闭自动保存则生成待确认建议，关闭全局记忆则停止后续全局注入与自动捕获，已有条目保留。记忆不构成执行授权。实现边界、删除语义及多端验收见 [全局记忆验收](test-results-2026-11-16-global-memory.md)。

通知事实与业务回复分离。Web 系统通知需要用户允许且客户端仍在运行；Bark 需主动配置 `https://api.day.app/设备密钥`。默认隐藏正文，前台确认只抑制当前设备的同一会话通知。通道接受请求只记为 accepted，不等于用户已读或事项已处理。配置 `KODO_PUBLIC_ORIGIN` 后 Bark 点击打开同 Host 通知及会话，不自动批准事项。原生移动提醒配置和未验收边界见本文末节。

升级前先 `POST /internal/quiesce`，持续查询 `/internal/health`。同步冻结新发送、计划、Webhook 执行、应用、浏览器和节点新动作；观察与取消仍可用。只有 `readyForMaintenance=true` 后才停止 Host 和外部原生写入者。unknown 命令会阻止宣称排空，应核对原生历史或实际外部服务并记录证据。不要用重启代替对账。恢复运行需要当前 health 返回的 `processIdentity` / `generation`，提交 `/internal/resume`。

离线备份和恢复命令：

```sh
node scripts/host-backup.mjs backup --data-dir /var/lib/kooyu --output /backups/kooyu.enc --key-file /private/backup.key
node scripts/host-backup.mjs restore --input /backups/kooyu.enc --destination /var/lib/kooyu-restored --key-file /private/backup.key
```

备份 key 至少 32 字节且私有。备份要求 Host 已停止并取得独占数据锁；输出必须在数据目录外且不能覆盖已有文件。备份包含 SQLite 一致性快照和受管文件，以 AES-256-GCM 加密，清单逐文件哈希；默认排除原生历史、浏览器 profile、Vault/主密钥、CLI homes 和设备秘密。需要 Kooyu/pi SDK 历史时另加 `--include-native --native-writers-stopped`，只收入映射可验证的内部历史；外部 Harness 历史与用户工作目录不在此备份内。

恢复只能进入不存在的新目录，先校验加密标签、tar 路径/文件类型、版本、哈希和 SQLite 完整性，成功后才原子移动。恢复生成新 Host 身份、撤销设备/应用/grant、取消待发、暂停计划/watch、保留未知结果；默认冻结。旧工作目录不迁移，原生外部会话不能自动续跑。重新配置密钥/凭据、配对设备、检查工作目录及原生历史后，明确恢复运行。原实例可以继续保留，不能把两实例指向同一个数据目录。

数据库 v9 自动迁移前创建私有 `.pre-v版本-时间-UUID.sqlite` 一致性快照；失败回滚原库，不覆盖该快照。版本过新拒绝打开；跨版本恢复需使用匹配产品/Schema 的工具。迁移快照是敏感数据，请独立保管，不要放入镜像或公开下载目录。

## iOS APNs

1. 在自己的 Apple 开发团队为应用启用 Push Notifications，准备 P-256 .p8 签名密钥、十位 Team ID 与 Key ID。仓库不包含 Apple 凭据或签名身份。
2. 在 Host 本机「设置 → 工作中心 → 结果提醒 → iOS APNs 服务」填写 Team ID、Key ID、Bundle ID（默认 app.kooyu.ios）、签名环境与私钥，启用并保存。私钥仅写入 Vault，读取不返回密钥或凭据引用，保存后输入框清空。配对手机只能读取脱敏状态，不能修改服务签名。
3. Debug 开发签名选择 sandbox；Release/分发签名选择 production。apps/ios/project.yml 同时设置签名 entitlement 与客户端环境；Host 必须匹配实际安装包的 Bundle ID 和签名环境。模拟器无签名构建不证明可以接收推送。
4. 在已配对 iOS App「设置 → 已配对电脑」主动开启该 Host 的后台提醒并允许系统通知。客户端校验 Bundle ID/环境与当前修订，将 OS 签发的设备 token 注册到该配对身份。token 只存在 App 内存及 Host Vault，不进入 UserDefaults。逐 Host 独立选择，关闭撤销自己的通道，离线撤销保留待重试标记。
5. 更换或禁用 APNs 配置会取消旧待发、禁用旧设备通道，须在手机明确重新启用。下次前台同步不会悄悄恢复已关闭通道。撤销整个设备会取消提醒并删除其 Vault token。

服务接口 GET/PUT /api/notification-providers/apns：PUT 仅限本机，包含 expectedRevision、enabled、teamId、keyId、topic、environment 与可选 privateKey。首次配置或更换签名身份必须传私钥，原身份留空保留 Vault 密钥。设备通过 PUT /api/notification-channels 注册 kind=apns，同时提供当前 expectedRevision、expectedProviderRevision、topic、environment 与 OS deviceToken；关闭可 DELETE /api/notification-channels/<deviceId>:apns。不要将请求 body 写入 shell 历史、日志或公开配置文件。

Host 固定连接 Apple HTTPS HTTP/2 origin，使用 ES256 JWT、15 秒超时、4 KiB payload 上限、稳定 notification/collapse ID 和有限退避，不跟随重定向。Unregistered、BadDeviceToken、DeviceTokenNotForTopic 禁用设备通道；临时错误有限重试，永久配置错误失败。推送只携带 Host/通知身份，点击重新认证并读取当前事实，不执行 payload 中的 URL 或操作。供应商接受不等于设备已看到，崩溃重试边界不能保证恰好一次展示。

## Android 可选后台连接

在原生 App「设置 → 已配对电脑 → 后台事项提醒」逐台开启，Android 13+ 先允许系统通知。remoteMessaging 前台服务显示常驻连接通知与停止入口，通过系统验证的 HTTPS SSE 续传通知游标，并读取该设备的持久 client 待发箱；不依赖 Google Play 服务。仅连接用户启用的 Host。设备重配或移除会取消旧连接，Host 撤销设备或关闭通道后不自动恢复授权。

游标和展示身份持久化，断线指数退避，流事件及 HTTP body 大小有界。过期游标 reset 更新位置，不把历史快照当作新提醒。实际查看同一会话时短期确认，其他会话继续提醒。稳定本机 notification tag 和展示记录减少重复；点击只打开已配对 Host 当前事项，不批准或重发任务。

持续连接可能耗电，系统回收后只在平台允许时恢复；强行停止、厂商省电或网络变化可能中断。没有开机自启或电池优化豁免，返回 App 可检查状态。关闭立即阻止本机展示并尝试撤销 Host client 通道，离线在下次前台重试。Host 未处理事项始终保留。Android 系统回收/切网和 iOS 锁屏/点击仍待真机验收。
