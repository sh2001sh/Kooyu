# 五平台应用实现与验证

日期：2026-11-13。范围：macOS / Windows / Linux 桌面安装应用、iOS / iPadOS SwiftUI、Android Kotlin / Compose。鸿蒙暂缓。

## 已实现

- 三桌面平台共用 Electron 工程，发布配置包含 Windows NSIS、macOS DMG/ZIP、Linux AppImage/deb。包内提供独立 Node 24.13.0、Host、生产依赖和 Web 资源。
- 统一三系统数据目录和启动环境；发现文件区分格式版本与产品协议版本。复用兼容 Host；不兼容或不健康时明确失败。macOS 保留系统菜单，Windows/Linux 无托盘时退出 UI，Host 独立存活。
- iOS / iPadOS 为 SwiftUI、Swift 6、iOS 17+；会话采用自适应 NavigationSplitView。Android 为 Compose / Material 3、API 26+；手机导航栏、宽屏侧轨和大屏会话分栏。两个工程均使用原生视图。
- 手机支持 HTTPS 配对、会话搜索、按项目创建 Kooyu 会话、最近 300 事件消息投影、发送、审批、停止并暂停、前后台恢复与本机断开。包含受支持的 HTTPS 中继路径前缀处理。
- 原生配对接口独立于浏览器 cookie，拒绝浏览器 Origin；token 服务端 hash 保存。手机使用 Keychain / Keystore；Android 禁止云备份和设备迁移。没有开放任意 CORS 或跳过 TLS。
- 请求前持久化待核对操作，未知结果不自动重发。发送/停止可查 Host 回执；创建与审批丢失应答时先核对会话/待处理列表，再明确清除本机标记。

## 本机验证

环境：Windows x64；Node 24.13.0，Electron 39.1.0；Android 构建使用 JDK 17、Gradle 8.13、SDK 36。所有 Host 验证使用隔离数据目录；打包烟测没有发送模型请求。

| 检查                            | 结果与范围                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| TypeScript / Web / Desktop 构建 | npm run build 通过                                                                                      |
| 工作区类型检查                  | npm run typecheck 通过                                                                                  |
| Host 自动化测试                 | 321 项通过；含单次原生配对、撤销、浏览器不暴露 token、协议版本与各审批协议投影                          |
| 平台基础测试                    | 2 项通过；数据目录、GUI PATH、兼容复用、不兼容/不健康时禁止额外启动                                     |
| Android                         | testDebugUnitTest、lintDebug、assembleDebug 通过；4 项单测，lint 无 error，保留依赖版本和图标等 warning |
| Windows 安装产物                | NSIS 安装包生成成功；没有 Authenticode 正式签名                                                         |
| Windows 打包应用                | 在仓库之外运行包内程序与 Node；窗口隐藏/恢复、UI 退出后 Host 存活、重开复用同一 Host 与会话通过         |
| 原生静态检查                    | iOS 工程 YAML/plist、移动 XML/JSON 资源解析通过；Swift 插值与并发隔离人工检查；静态 UI 检测无发现       |
| 代码质量                        | 全仓库 npm run lint、修改文件 Prettier 和 git diff --check 通过                                         |

全仓库 format:check 仍报告其他已有文件格式问题；本轮未重写这些无关文件。

### 打包修复与环境说明

初次烟测发现 electron-builder 在资源目录默认跳过根 node_modules。现已为 Host 生产依赖增加独立 extraResources 映射，并把 npm 工作区链接物化为实际包目录；新 staging 会清理自身旧产物，避免混入废弃文件。实际烟测运行包内 Node 和 Host，验证了此修复。

本机 Electron 在 E 盘存在既有的应用代码执行前早退现象。验证将同一打包目录复制到本机 C 盘用户应用缓存后执行；没有关闭 Electron 沙箱或修改系统安全设置。最终证据保存在 .local/verification/packaged-1794557248764/report.json；截图保存在对应目录的 desktop.png。

## 产物与复验

- Windows：release/desktop/Kooyu Setup 0.1.0.exe；开发验证产物，安装、升级、卸载和正式签名仍需独立验收。
- Android：apps/android/app/build/outputs/apk/debug/app-debug.apk；Android Debug 签名，正式分发需自己的签名配置。
- 桌面构建：npm run package:desktop -- --publish never，在目标 OS / 架构执行。
- 打包应用烟测：npm run verify:packaged -- /absolute/path/to/executable，使用隔离 Host 数据，不调用模型。
- Android 构建：在 apps/android 执行 gradlew.bat testDebugUnitTest lintDebug assembleDebug；其他系统用 ./gradlew。
- iOS：在 macOS 用 XcodeGen 生成 apps/ios/Kooyu.xcodeproj，再使用 Kooyu scheme 构建 / 测试。

## 未验证与后续边界

macOS / Linux 安装产物和 iOS 编译 / XCTest 需要目标系统。已配置 .github/workflows/native-apps.yml 的三桌面构建、Android 检查和 macOS iOS 模拟器构建 / 测试；本轮没有远端 CI 运行结果。

本机没有 Xcode 或连接的 Android 设备，因此没有原生手机/平板截图、读屏、深浅主题与字体缩放、TLS 真机配对、网络切换、系统回收或设备性能证据。静态检查和 APK 构建不替代这些验证。

移动端完整历史分页、附件/文件、复杂原生问答、工具详情、推送、多 Host、本地执行尚未实现；未知交互引导到桌面。商店上架、macOS 签名/公证、Windows 安装升级、Linux 原生依赖/密钥服务、自动更新均未声明已通过。
