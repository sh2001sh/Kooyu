# 免注册远程连接

当前阶段采用密钥身份与扫码配对，暂不实现官网账号注册、邮箱登录或第三方账号登录。用于连接 GitHub 仓库的产品授权功能与此决定无关。

## 身份与配对

Host 首次开启远程连接时生成 Ed25519 身份，私钥保存在既有 Vault。每次连接使用 Relay 新生成的随机挑战证明私钥持有，验证成功后服务端自动创建或恢复匿名身份。重启和保留数据目录的升级不改变身份。

Relay 返回短期、不透明的身份令牌，数据库仅保存其摘要。`GET /v1/identity` 通过 Bearer 令牌返回自身连接与配额元数据；该令牌不能替代 Host 挑战签名，也不授予本地 API 或管理员权限。重新连接/刷新会轮换令牌，旧令牌失效。Host 的本地 `/api/remote` 只返回展示信息，不返回该令牌。

手机继续通过已有单次配对码获取独立客户端授权，私钥和 Host 管理身份不通过二维码交给手机。V1/V2 均支持免注册；原生端保留现有公钥校验与加密通道。

第一阶段一个匿名身份对应一把 Host 公钥。手机通过现有 Host 配对连接，不实现 Happy 的跨设备共享账号根密钥，也暂不提供一个匿名云账号聚合多台 Host 的功能。官网设备中心与跨 Host 管理属于后续范围。

## 服务端限制

生产入口默认启用匿名准入，无须 OAuth Client ID/Secret。自建服务可明确设置 `RELAY_ADMISSION_MODE=open` 使用原有模式；官方服务不使用此配置。

| 配置 | 初始默认值 |
| --- | --- |
| `RELAY_ADMISSION_DB` | `/var/lib/kooyu-relay/admission.sqlite` |
| `RELAY_IDENTITY_MONTHLY_BYTES` | 每身份 1 GiB |
| `RELAY_GLOBAL_MONTHLY_BYTES` | 整个服务 100 GiB |
| `RELAY_NEW_IDENTITIES_PER_IP_DAY` | 同来源每日 20 个新身份，已有身份重连不占用 |
| `RELAY_MAX_IDENTITIES` | 最多 10,000 个持久身份 |
| 单 Host 并发转发请求 | 8 |
| 离线待投递消息 | 8 封；原有签名、大小、有效期与全局上限继续有效 |

这些是可调整的初始运营限制，不是对外永久额度承诺。月份按 UTC 自然月计算。用量、来源限额和撤销状态持久化；来源地址仅以服务端随机盐的 HMAC 存储，不在身份表保存原始 IP。

计量覆盖已认证 WebSocket 的入站帧、业务出站帧和验证通过的新信箱投递，不等同于 TCP/TLS 网卡流量；握手、部分出站控制消息与静态资源不在该身份计量口径内。另有既有 HTTP/握手限流、载荷上限与并发/缓冲区限制。无效签名和重复投递不会消耗另一个身份的信箱流量额度。

额度不足返回明确错误并断开远程连接；Host 显示受限与恢复信息，延迟重试。身份被撤销后停止自动重连。本地任务、文件和既有配对不会因此删除或重放。

新密钥可以批量生成，匿名身份不构成真人证明；来源限额、持久身份总量和全局预算共同控制资源消耗。共享 NAT 用户可能遇到来源限额，错误附带重试时间。公网 HTTP/TLS 成本仍需要网关与服务器层监控，不能把应用配额当作完整 DDoS 防护。

## 管理与发布

在 Relay 容器或可信服务器执行：

```sh
node src/admin.mjs --db /var/lib/kooyu-relay/admission.sqlite list
node src/admin.mjs --db /var/lib/kooyu-relay/admission.sqlite revoke <hostId>
node src/admin.mjs --db /var/lib/kooyu-relay/admission.sqlite resume <hostId>
```

撤销通过下一次业务操作或最长约 20 秒心跳检查生效；恢复后重新连接领取新令牌。保持数据库卷，不用删除身份来重置额度。

源码没有官方 Relay 地址默认值。官方 App/npm 打包通过 `KOOYU_OFFICIAL_RELAY_ORIGIN` 注入公共 `distribution.json`，设置 `KOOYU_OFFICIAL_RELEASE=1` 后缺配置即构建失败。实际配置在发布环境提供，不提交仓库。文件不包含服务器私钥或通用访问密钥；地址仍可从发行包读取。自建源码通过 `KODO_RELAY_ORIGIN` 配置自己的服务。

## bb 与 Happy 的参考边界

核对的 bb 提交为 `351cb84dc6391d3c6d16295e66578fe97232a25e`：

- [bb 多端文档](https://github.com/get-bb/bb/blob/351cb84dc6391d3c6d16295e66578fe97232a25e/docs/multiple-devices.md)：本地/受信网络直连与官方 Connect 分开；官方 Connect 先关联账号，再给手机独立设备凭证。
- [bb 账号认证](https://github.com/get-bb/bb/blob/351cb84dc6391d3c6d16295e66578fe97232a25e/apps/web/src/server/auth.ts)：Better Auth + GitHub，邮箱密码仅本地开发开关；与 Happy 的自动密钥身份不同。
- [bb Connect 网关](https://github.com/get-bb/bb/blob/351cb84dc6391d3c6d16295e66578fe97232a25e/apps/connect/src/worker.ts)：检查服务端/设备凭证摘要、归属、撤销状态，不以安装包隐藏配置作为准入依据。
- [bb 配对常量](https://github.com/get-bb/bb/blob/351cb84dc6391d3c6d16295e66578fe97232a25e/packages/connect-db/src/constants.ts)：一次性配对码有效期 10 分钟、会话 7 天；所查代码每账号名额上限 500，不代表无限资源。
- [bb 授权起始限流](https://github.com/get-bb/bb/blob/351cb84dc6391d3c6d16295e66578fe97232a25e/apps/web/wrangler.jsonc)：声明每 60 秒 10 次的绑定；不能据此推断所有 Relay 路由都有同样限流或月流量上限。

Kooyu 采用 Happy 的免注册交互，参考 bb 的凭证职责分离、单次配对、撤销与明确错误处理。没有复制 bb 的强制 GitHub 账号门槛、跨子域 Cookie 或受信网络下的无认证公开 API。
