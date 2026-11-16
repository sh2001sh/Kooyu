# 移动端模型与思考强度修复验证 · 2026-11-15

## 修复结果

Android 和 iOS 的新建对话、已有对话中，模型与思考强度固定显示在输入框上方。模型名过长时省略，思考强度保持直接可点；附件、引擎、权限仍位于输入框内的下方，发送按钮固定。

点击思考强度会主动读取引擎模型目录，支持刷新、加载、错误、默认恢复和未声明档位的说明。只显示 Host / 模型元数据声明的档位，不给未声明支持的模型编造选项。

## 原因

1. 移动端此前在没有读取到 reasoning 数组时隐藏或禁用控件，而模型发现仅在打开模型选择时触发，形成了无法直接配置的入口问题。
2. 原生模型的 provider/model、原始 ID、resolvedModel 和默认标记未统一匹配；重复目录项也可能优先命中缺少能力信息的近期记录。
3. 会话沿用默认模型时，移动端修改思考强度只提交 session.model（可能为 null），Host 无法据此验证档位；现在会提交已确定的有效模型。
4. 模型和强度与其它操作挤在同一个横向工具栏中，窄屏下难以找到。

## 代码范围

- Android：`ComposerControls.kt`、`DraftComposer.kt`、`WorkbenchComposer.kt`、`DesktopModels.kt`、`ComposerPolicyTest.kt`。
- iOS：`ComposerControls.swift`、`DraftComposer.swift`、`WorkbenchComposer.swift`、`ComposerPolicy.swift`、`ComposerPolicyTests.swift`。
- 测试：`scripts/platform-test-fixture.mjs` 新增可选隔离目录；`scripts/verify-reasoning-android.mjs` 执行原生 UI、Host 状态检查及截图。

绑定会话优先使用 Host 返回的绑定快照，保留原始模型 ID；固定绑定不会混入原生模型目录。显式空档位数组不会被绑定默认值覆盖；未知自定义模型不会借用其它模型的档位。新建对话选择强度时会固定对应模型并保留绑定选择。

## 验证

| 项目 | 结果 |
| --- | --- |
| Android 单元测试 | 57 项通过，0 失败、0 跳过；新增 3 项模型别名、元数据优先级、绑定与空档位回归 |
| Android Lint | 0 错误，26 项现有警告；本次新增的 Modifier 参数警告已修正 |
| Android debug APK | 构建成功，已覆盖安装到 BlueStacks，保留应用数据 |
| 原生目录 UI | Codex、Claude、OpenCode、Gemini、Kimi 均可选择 high，并核对 Host 保存的 model / reasoning / settingsRevision |
| 默认恢复 | 上述五个引擎均恢复 reasoning=null，并核对设置修订增加 |
| 新建对话 | 首次选择 Codex 的 high 后创建空草稿，Host 中模型与强度共同保存；未发送消息 |
| 模型切换 | 切换到明确声明 reasoning=[] 的模型后清除旧档位，展示说明与刷新入口，无旧档位泄漏 |
| 来源绑定 | Codex 固定绑定中保存 high，核对原始模型 ID 与 bindingId 均正确 |
| 布局 | 320dp 窄屏、键盘展开、130% 字体、深色模式截图检查通过 |
| 最终 APK 复核 | 再次安装最终构建，验证 Codex 档位保存和 320dp 布局 |
| iOS | 24 个应用源文件及 6 个测试源文件通过语法解析；Windows 未运行 Xcode 构建、SwiftUI 类型检查或 XCTest |

测试目录中的模型与档位为明确声明的合成数据，未启动真实 harness 推理，不代表各模型实际推理表现。测试使用独立 Host、SQLite 和工作目录，没有改动真实模型配置。BlueStacks 的分辨率、密度、字体和软键盘设置已恢复，并切回测试前使用的电脑 3。

## 产物

- [25 张截图画廊](../output/playwright/mobile-reasoning-2026-11-15/index.html)
- [最终窄屏截图](../output/playwright/mobile-reasoning-2026-11-15/android/17-final-narrow.png)
- [最终档位选择截图](../output/playwright/mobile-reasoning-2026-11-15/android/16-final-options.png)
- [完整截图和验证清单](../output/playwright/mobile-reasoning-2026-11-15/manifest.json)
- [Android APK](../apps/android/app/build/outputs/apk/debug/app-debug.apk)

最终 APK SHA-256：`840dd81edc1a2b2e2b2151eddaea0ddbda44d64f113fef2c0d9ea751a7412dbc`。

每张截图保留同名 XML、拍摄时间与对应 APK 哈希；15–17 为最终构建的确认截图，其余为本次功能验收截图。
