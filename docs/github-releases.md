# GitHub 自动发布

推送到 main 后，Native application releases 自动运行检查并发布一个独立的 GitHub 预发布版本（preview-版本-流水线编号）。也可以从 Actions 手动运行。推送与 package.json 版本相同的 v版本 标签会生成正式 Release。

流程使用 GitHub 托管的 Windows、Linux、Intel Mac 和 Apple Silicon Mac 构建桌面安装包，同时构建 Android APK 和 iOS 模拟器应用。所有检查和平台构建成功后才公开 Release，附带 SHA256SUMS.txt。失败日志和测试报告保存在对应 Actions run。

版本同时维护在根 package.json、apps/android/app/build.gradle.kts、apps/ios/project.yml；Android 升级还需递增 versionCode，iOS 递增 CURRENT_PROJECT_VERSION。

仓库 Actions secret ANDROID_DEBUG_KEYSTORE_BASE64 保存现有 Android 开发签名的 Base64 内容。私钥不进入 Git；流程临时恢复密钥并在完成后删除。保留此 secret，才能覆盖安装已使用同一签名的 APK。当前发布的是开发调试包，不是应用商店生产签名包。

iOS 当前上传 ios-simulator.zip，仅供 Apple Silicon Mac 的模拟器运行，不是真机 IPA。真机发布需要另外配置 Apple Developer 团队、分发证书和 provisioning profile。桌面包尚未配置代码签名及 macOS 公证。
