# Kooyu iOS / iPadOS

SwiftUI 原生客户端，iOS 17+、Swift 6、Xcode 16+。使用系统导航、Dynamic Type、SF Symbols 与 Kooyu 色彩，不嵌入 WebView。

在 macOS 上生成并打开工程：

```sh
brew install xcodegen
cd apps/ios
xcodegen generate
open Kooyu.xcodeproj
```

选择 Kooyu scheme 和模拟器运行。真机在 Xcode Signing & Capabilities 设置自己的开发团队；仓库不包含证书或 provisioning profile。模拟器构建：

```sh
xcodebuild -project Kooyu.xcodeproj -scheme Kooyu \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

打开应用，填写友好的电脑名称，点击「扫描桌面二维码」，允许相机权限，对准桌面「设置 → 手机连接」生成的二维码；识别后点击「连接此电脑」。正常扫码确认和设备菜单不显示连接 URL；手动输入默认收起。支持保存、重命名、切换和移除多台电脑。必须使用系统信任的 HTTPS 证书，不提供忽略 TLS 的开关。整本设备凭据与各电脑未确认的操作保存在 WhenUnlockedThisDeviceOnly Keychain，原位兼容旧版单电脑数据，不进入 UserDefaults 或 URL。

扫码使用 VisionKit DataScanner，仅识别二维码，图像不上传；支持状态由系统检测，不支持实时扫描的设备或模拟器可手动输入。首次使用才请求相机权限，拒绝后可跳转系统设置；离开扫码页或进入后台停止相机，返回前台重新检查权限。无效二维码不发起网络请求，可重扫；识别后停止扫描，确认卡使用友好名称。邀请仅存内存，不写入 UserDefaults。

0.2.0 源码已接入会话、项目、待处理、用量、设置五个工作台入口；iPad 使用会话分栏。新建对话包含项目/目录、引擎、类型、模型来源/绑定、模型、思考强度、权限与首条消息。支持会话管理、全文历史搜索及定位、历史分页、文本附件、待发消息编辑/立即发送/撤回、模型设置、工具运行记录、文件及 Git diff。

原生用量页面提供日期/项目/引擎/口径筛选、Token/缓存、实际/估算/未知费用、当地日期图表、预算及明细，与桌面共享累计快照去重规则。模型来源/端点、模型发现/编辑、绑定与兼容检查、项目/电脑默认绑定、个人指令及引擎默认配置使用相同 Host API；另有托管、控制权转交和项目授权。已知 Claude/Codex/OpenCode/Kimi 问答协议使用原生表单，未知协议提示在电脑处理。

前台每 2 秒拉取快照/当前会话，用量每 10 秒读取，后台停止刷新。切换电脑后丢弃旧快照、会话、用量与未完成的异步结果。每台电脑独立保存未知操作标记；请求失败不自动重发，先核对回执/会话。

引擎安装/升级/登录、首次设置、系统入口修改与完整授权撤销在电脑本机执行。图片/PDF 文件预览及完整块级 Markdown 样式仍未覆盖；消息支持行内 Markdown 与文本选择。完整功能及验证边界见 ../../docs/mobile-feature-parity.md。

## APNs 后台事项提醒

源码已接入 UIApplicationDelegate / UNUserNotificationCenterDelegate、逐 Host 主动开关、OS token 更新、修订检查、离线撤销重试与点击定位。设置中主动开启后请求系统权限。token 只在 App 内存和 Host Vault，不写入 UserDefaults。默认隐藏正文；前台只有实际查看同一会话时确认并抑制。点击只读取已保存 Host 的当前事实，不批准事项或执行 payload 中的 URL。

Xcode 中选择自己的开发团队，为 Bundle ID 启用 Push Notifications。Kooyu.entitlements 引用 APNS_ENVIRONMENT；Debug 为 development/sandbox，Release 为 production。Host 本机工作中心配置对应 Team ID、Key ID、.p8、Bundle ID 与环境。更换 Host 配置或关闭通道后需在手机明确重新启用。移除本机连接不等于 Host 撤销；先关闭提醒，或在 Host 撤销设备。

Windows 仅验证 Swift 语法。Apple 签名、Xcode 严格并发编译、XCTest、OS token、真机锁屏/点击/切网仍需 macOS 和设备验收。单测源码覆盖 payload 忽略外部动作、Host 身份和路径编码，不证明 Apple 已投递。

本机 Windows 无 Xcode，不能把源码检查或 Host 协议测试当作 iOS 编译/真机证据。已配置 macOS CI 构建与 XCTest，实际结果以运行记录为准。
