# Kooyu 五平台应用实现

日期：2026-11-13。范围为 macOS、Windows、Linux、iOS / iPadOS、Android；鸿蒙暂缓。桌面采用用户确认的 Electron 安装应用，iOS 使用 SwiftUI，Android 使用 Kotlin / Jetpack Compose。移动端使用原生视图。

## 已实现的工程

| 平台         | 工程与构建产物                              | 当前验证边界                                                                   |
| ------------ | ------------------------------------------- | ------------------------------------------------------------------------------ |
| Windows      | apps/desktop；NSIS 安装包                   | 安装包构建及包内应用/Host 生命周期烟测通过；安装升级、卸载与签名另行验收       |
| macOS        | 同一 Electron 工程；DMG / ZIP               | 已配置目标系统 CI；本机 Windows 不提供 macOS 构建或公证证据                    |
| Linux        | 同一 Electron 工程；AppImage / deb          | 已配置目标系统 CI；发行版、secret service、X11/Wayland 仍需原生环境验证        |
| iOS / iPadOS | apps/ios；SwiftUI、Swift 6、iOS 17+         | 原生源码、XcodeGen 和 XCTest 已接入；需要 macOS / Xcode 构建与模拟器、真机验收 |
| Android      | apps/android；Compose / Material 3、API 26+ | 本机已通过单测、lint 与 Debug APK 构建；真机交互和网络场景待验证               |

CI 配置存在不代表远端运行通过。当前开发产物未完成签名、公证、商店发布和五平台真机验收。细项见 [本轮验证记录](test-results-2026-11-13-native-apps.md)。

## 执行与连接

桌面或独立部署的 Session Host 拥有 SQLite、Provider 凭据、项目目录和实际 harness 进程。Electron UI、现有浏览器 / PWA、SwiftUI 与 Compose 都连接这一事实来源。手机不运行 Node、桌面 CLI 或本地编码工具链。关闭 UI 或手机应用不会停止 Host 中的任务；Host 离线、电脑休眠或关机时不能执行。

- packages/platform 统一三系统数据目录和 Host 启动环境，保留已有 Kodo 数据标识；macOS GUI PATH 包含常见原生入口目录。
- 桌面发现文件区分 discoveryVersion 与产品 protocolVersion。启动器使用当前协议版本；发现不兼容或不健康的 Host 时明确失败，不额外启动另一个 Host。
- 发布包随附 Node 24.13.0、Host 生产依赖和 Web 工作台；普通用户无需安装 Node/npm。外部 harness 的安装、登录与许可证要求仍分别存在。
- 桌面使用系统菜单和可选托盘；Windows/Linux 无托盘时关闭窗口退出 UI，独立 Host 继续运行。macOS 保留 Dock 恢复与隐藏窗口行为。

## 原生移动端功能

两个原生工程都包含 HTTPS 配对、会话列表 / 搜索、按项目创建 Kooyu 会话、最近 300 条事件的消息投影、发送、停止并暂停、待处理事项、协议明确声明的审批、断开本机连接。iPad 与 Android 宽屏保留平台原生导航适配。

- GET /api/native/snapshot 返回原有快照和可执行审批动作；动作由 Host 按 ACP / Codex / Claude / OpenCode / DeepSeek / Kooyu 的实际协议投影。未知或复杂问答提示桌面处理。
- POST /api/pair/native 通过短时单次配对码交付 bearer；浏览器 Origin 被拒绝。原有浏览器配对继续使用 HttpOnly cookie，不向页面交付 bearer；没有放开 CORS。
- 原生客户端要求系统信任的 HTTPS，禁止跨地址重定向，发送 X-Kooyu-Protocol 并核对 hostId。Provider 密钥不下发手机。
- iOS 在 WhenUnlockedThisDeviceOnly Keychain 保存连接与待核对操作；Android 使用 Keystore AES-GCM 加密，禁止备份及设备迁移。
- 前台每 2 秒刷新快照及当前会话；后台停止刷新，恢复前台重建快照。没有依赖后台常驻连接，也没有推送承诺。
- 发送、停止、审批在网络请求前持久化 requestId 与操作；发送 / 停止应答丢失后查询 Host 回执，禁止自动重发。操作结果未知时暂停新的写入。
- 创建会话也先持久化待核对标记。现有创建接口没有回执查询；应答丢失时先刷新会话列表人工核对，再清除标记，不自动重建。审批结果未知同样可在待处理列表核对后明确清除标记。
- 401 撤销 / 过期时清除显示中的敏感投影；本机断开清除本地凭据，完整撤销仍在可信桌面执行。

当前移动功能没有附件、文件浏览、完整历史分页、工具详情、复杂问答控件、推送、多 Host 管理或本地执行。现有 Web/PWA 继续提供独立入口，不替代原生工程的验收。

## 构建

桌面必须在目标 OS / 架构安装生产原生依赖后构建：

```sh
npm ci
npm run package:desktop -- --publish never
```

staging 使用 Node 24.13.0；产物在 release/desktop。electron-builder.yml 定义 NSIS、DMG/ZIP、AppImage/deb。macOS Apple Silicon / Intel、Linux 发行版支持范围以实际构建和验收记录为准，不将单架构产物称为 universal。

Android 使用 JDK 17 与 SDK 36：

```sh
cd apps/android
./gradlew testDebugUnitTest lintDebug assembleDebug
```

Windows 使用 gradlew.bat。Debug APK 位于 apps/android/app/build/outputs/apk/debug/。正式签名文件与密码不进入仓库。

iOS 在 macOS 使用 XcodeGen / Xcode：

```sh
cd apps/ios
xcodegen generate
xcodebuild -project Kooyu.xcodeproj -scheme Kooyu \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

真机需自己的开发团队及 provisioning profile。详见 [iOS](../apps/ios/README.md)、[Android](../apps/android/README.md) 和 .github/workflows/native-apps.yml。

## 发布前验收

| 场景                       | 通过条件                                                              |
| -------------------------- | --------------------------------------------------------------------- |
| 干净系统安装、冷启动与重开 | 不依赖仓库或系统 Node；运行的是包内 Node/Host；数据目录兼容           |
| 关窗、退出和更新           | Host 和原生任务持续运行；重开复用原 Host；升级不意外终止任务          |
| 配对、过期、撤销           | 真机 TLS；单次邀请码；撤销后无法读取或操作；无 token 泄漏             |
| 网络切换、回收与恢复       | 不重复发送；未知结果清晰；按 Host 核对快照与回执                      |
| 桌面 / 手机并发审批        | 重复审批只生效一次；过期动作明确冲突                                  |
| 停止并暂停                 | 请求接收、原生取消结果、暂停托管分别表达；离线不宣称已停止            |
| 原生系统体验               | 键盘、安全区、返回、深浅模式、Dynamic Type / 字体缩放、读屏与平板布局 |
| 目标系统与签名             | macOS 签名/公证、Windows 签名与升级、Linux 密钥服务/桌面环境分别验证  |

通知、自动更新、多 Host 与更完整移动工作台作为后续功能独立实现和验证。
