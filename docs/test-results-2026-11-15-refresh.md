# 优化后重新构建与双端截图

本轮针对 2026-11-15 当前工作区重新构建并截图，未复用上一轮图片。产物目录为 `output/playwright/desktop-android-refresh-20261115-143756/`，入口为其中的 `index.html`。使用全新隔离 Host 和演示数据，不执行模型推理。

## 结果

| 项目 | 本轮结果 |
| --- | --- |
| Host / Web / Electron 构建 | `npm run build` 通过 |
| Electron 原生窗口截图 | 43 个页面/面板状态，93 张 PNG，含 50 张内部滚动补图 |
| Android 构建 | `testDebugUnitTest lintDebug assembleDebug` 通过 |
| Android 单测 | 48 项通过，无失败 |
| Android lint | 0 errors、22 warnings |
| BlueStacks 原生截图 | Android 13 / API 33，1080×1920，38 张 PNG |
| PNG 解码、尺寸及 SHA-256 | 全部 131 张通过 |
| APK 签名 | Android Debug 签名校验通过 |
| Android 加密凭据 | AES / purposes=3 / 128 bit，随机密钥往返及已保存连接解密通过 |

APK 已归档到本轮目录的 `kooyu-refresh-debug.apk`。SHA-256：

`A808CCF8B62C0071E458B58C5BA5AB9496A3667880E05470DA3AC68D918DEA4B`

桌面覆盖新版三步引导、工作台、新建会话、待处理、全部设置页、11 个引擎详情、工作中心及表单、会话检查器、文件预览、深浅主题。Renderer 无未捕获异常，无文档横向溢出，关闭隐藏、重新显示以及 Host 存活验证通过。

Android 覆盖首次/手动配对、会话与项目、设置、用量、预算、引擎列表滚动、会话配置与记录、文件/Git、菜单与取消删除、深色主题、后台服务、系统通知、通知深链和已读回执、关闭提醒以及冷启动恢复。

扫码器设置了 `FLAG_SECURE`，ADB 返回 0 字节，无法保存有效 PNG。已验证真实扫码 Activity、原生无障碍内容及取消返回，保存 `android/37-qr-scanner-protected.xml` 和同名 `.capture.txt`，未绕过保护。该页不计入 131 张图片。

## 回归与脚本适配

本轮首次运行完整 Web 92 项用例，85 项通过，7 项因优化后的标题/占位文案与旧选择器不符而失败。仅更新测试选择器：新版“模型配置”“执行引擎”“工作台”“模型能力参数”及输入框占位“Kooyu”。随后重新运行全部 6 项引导测试及 2 项管理交互测试，8 项均通过，覆盖原先全部失败项；未将第一次完整运行描述为一次性全部通过。

截图检查发现引导第一页过早捕获加载态，增加已加载按钮等待后重跑桌面全部截图。Android 通知打开会话后已隐藏底部导航，补充“返回会话列表”步骤，重跑扩展页成功。两端最终 manifest 均为 `passed`，错误列表为空。

## 证据与清理

- `desktop/manifest.json`、`android/manifest.json`：页面、哈希和生命周期断言。
- `screenshot-verification.json`：131 张图片校验结果。
- `desktop/index.html`、`android/index.html`：逐页查看；各自 `overview.jpg` 为总览。
- `build-desktop.log`、`build-android.log`、`apk-signature.txt`：构建与签名证据。
- `test-ui.log`：首次完整回归及失败原因；`test-onboarding-final.log`、`test-workbench-copy-final.log`：适配后的定向复验。
- `capture-desktop.log`、`capture-android.log`、`capture-android-extras-retry.log`：原始截图执行记录，保留重跑历史。
- `android/unit-test-results/`、`android/lint-results-debug.txt`：本轮 Android 测试证据。
- `android/keystore-after-run.txt`、`android/process-exit-history.txt`：加密验证及退出记录；退出记录未见 CRASH / ANR。

截图完成后已关闭测试后台提醒、撤回临时相机权限，并停止本轮隔离 Host。保留 BlueStacks、最新 Debug APK、测试数据和全部证据以供复查。真实模型推理及相机实际识别二维码不属于本轮验证结论。
