# Windows 默认启动端口冲突修复：0.1.2

用户截图中的 `Unexpected token ... is not valid JSON` 已在本机定位并修复。
0.1.2 已通过安装器升级至 `D:\Kooyu`，普通启动实际显示首次设置界面，
未再出现启动失败弹窗。应用保留打开，用户可继续配置。

## 根因

本机 `127.0.0.1:4310` 的监听进程为 QQ（PID 8176），不是 Kooyu Host。
请求 `/api/health` 返回 HTTP 200 和 184 字节二进制内容，旧启动器直接调用
`response.json()`，因此出现截图中的乱码 JSON 错误。
此前随机端口的安装后 smoke 通过，仅覆盖了隔离端口，没有覆盖默认启动路径。

## 修改

- 自动启动首先读取本数据目录的活跃 `host.json`，验证进程、Host 身份和协议。
- 新 Host 在默认端口被占用时选择可用的 loopback 端口，将端口传给后台进程；
  重开应用复用记录中的实际端口。
- 不自动接入默认端口上的任意服务；显式 URL/端口配置仍按配置执行，收到非 JSON
  或非 Host 内容时给出可读错误。
- 有活跃数据目录持有者时保持其锁和任务，不启动第二个写入者。
- 打包验证新增 `--default-port`，同时保留数据隔离和完整生命周期断言。

## 验证

| 项目 | 结果 |
| --- | --- |
| TypeScript desktop build | 通过 |
| 启动回归测试 | 6 项通过：非 JSON、端口冲突、Host 复用/身份验证、无效端口、活跃锁保护、兼容性检查 |
| 修改代码 ESLint / Prettier | 通过 |
| 0.1.2 Windows x64 NSIS 构建 | 通过 |
| 实际 D 盘安装器升级 | 退出码 0；约 8 分 29 秒 |
| 29,871 个包内文件逐个 SHA-256 | 全部一致；安装目录另含卸载程序 |
| 默认端口 smoke（不设置 KODO_HOST_PORT） | 通过；自动选择 57930，QQ 保持运行并占用 4310 |
| 首次设置、Host 连接、测试会话、窗口重开 | 通过 |
| UI 退出后台保活、再次启动复用 Host/会话 | 通过 |
| 无任何 KODO 启动覆盖变量的普通已安装 EXE 启动 | 通过；自动选择 58789；实际窗口显示首次设置 |

普通启动使用用户默认数据目录 `%LOCALAPPDATA%\Kodo\host`，Host PID 14340，
应用 PID 63684。没有停止 QQ 或既有开发 Host，没有发送模型请求。
隔离测试进程已清理；普通启动应用及其 Host 保留给用户使用。

## 安装包和证据

- 安装包：`D:\Kooyu-Installers\Kooyu-Setup-0.1.2.exe`。
- SHA-256：`37a2d36e37e6e6639b9a096920abb4eb066439dbeb5069dc19aa45afe01fe986`。
- 未签名的本地开发测试包。
- 构建：`.local/windows-startup-fix-build.log`。
- 安装：`.local/installer-diagnostics/startup-fix-install.json`。
- 文件校验：`.local/installer-diagnostics/installed-files.json`（本次为 0.1.2）。
- 回归：`.local/windows-startup-regression.log`。
- 默认启动 smoke：`.local/verification/packaged-1794572828526/report.json`。
- 普通启动：`.local/installer-diagnostics/ordinary-startup.json`。
