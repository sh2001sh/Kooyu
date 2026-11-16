# 移动端结构重构与桌面端对齐：实现及验证

日期：2026-11-15。对应本轮移动端导航、项目管理、输入框、原生询问/审批及双端主对话创建项目需求。

## 后续调整：项目授权改为按需动作

项目授权已从 Android/iOS 设置表单移除，原入口统一改名为「会话托管」。主对话接到需要创建执行对话的任务、且缺少对应项目授权时，通过 `harness_grant` 主动发起对话内确认；用户也可以直接在主对话中请求授权或撤销。工具提示要求采用任务需要的最小范围，仅在用户要求持续托管时申请创建并控制权限，拒绝后不得绕过。

后端继续保存已确认的授权状态，供后续执行检查；此次改变的是触发入口，不会在移除表单时自动授予或撤销既有权限。扩展对话管理测试核对：发起请求后、用户确认前，没有项目授权记录且无法创建执行对话；确认后才建立授权。

同时修复 Android 会话托管页面嵌套全屏弹层导致关闭按钮无效的问题，入口直接打开托管页面并可正常返回设置。

本次增量截图另存于 `output/playwright/on-demand-project-grant-2026-11-15/android/`，与下文上一轮 30 张 Android 截图分开保留。下文 APK 哈希对应上一轮构建，更新安装包哈希以增量截图 manifest 为准。

增量验证：Android 54 项测试、lint 与构建通过，已更新安装到 BlueStacks；逐屏滚动核查授权表单已移除，关闭托管页面可返回设置，保存 3 张截图并校验哈希。Host 对话管理 10 项测试、类型检查及构建通过；iOS 28 个 Swift 文件语法检查通过，仍未进行 Xcode 运行验证。本轮没有执行真实模型推理，主动调用策略由工具和主对话指令约束，授权等待和执行门禁由 Host 测试验证。最新 APK SHA-256：`a31f75dd842e1aafd0666cb4a06a1026c8aeb29b4c7ededa0cca4279cc7f58c1`。

## 已实现

| 需求 | 实现后的行为 |
| --- | --- |
| 首页同时管理项目和对话 | 底部为「对话 / 用量 / 模型来源 / 设置」。对话首页按全局、项目分组，每组可新建对话；项目管理在首页内打开，不再占一个底部标签。保留搜索、置顶、重命名、归档与删除。Android 宽屏采用侧栏与正文分栏。 |
| 对齐桌面输入界面 | 新建及已有对话使用共享原生输入组件：多行消息区在上，附件、引擎、权限、模型、思考选项在下；窄屏分两行工具栏，宽屏为一行。统一中性色、圆角、深浅主题与欢迎背景。 |
| 配置与桌面一致 | 新建对话支持项目、工作目录、执行节点及主对话/直接对话类型。模型支持原生登录、项目/电脑默认继承及显式绑定；模型和思考选项依据实际元数据，绑定模型不混入原生 provider 前缀。选择继承来源中的具体模型时会保留对应绑定。 |
| 自动排队 | 与桌面提交规则相同：只有 `idle` 发起新轮，运行、等待输入及未知状态均自动排队。空输入且正在运行时可停止当前轮，使用 `pause:false`。 |
| 管理待发消息 | 对话输入区及详情页共用待发列表，支持编辑、撤回及能力允许时立即发送/插入当前轮。编辑携带 `expectedRevision`，不再通过新建指令模拟编辑。 |
| 模型来源一级页 | 直接管理来源、模型、引擎绑定和各 harness 默认来源；无需先进入设置。 |
| 设置层级 | 一级直接显示远程电脑和连接情况；通用与外观、执行引擎、托管与授权等进入二级页面。 |
| 浏览路径建立项目 | 新建项目、增加工作区及对话目录选择均可浏览已连接电脑的目录，支持主目录、盘符、上级、子目录和失败重试。选定目录后建议项目名称，无需手工输入绝对路径。执行节点 ID 与工作区 host ID 分别处理，避免错误过滤工作区。 |
| 右上角收件箱 | 待处理问题、权限请求和历史通知从收件箱查看；点击进入对应对话，在对话内完成处理。通知历史支持继续加载。 |
| 回答 harness 询问和权限审批 | 已接入原生问题表单、原生审批动作及非标准请求的结构化回答入口。修复原生客户端提交交互时缺少 UUID `requestId` 而被 Host 拒绝的问题。待处理卡片存在时不再显示占据正文空间的空白欢迎页。 |
| 双端主对话创建项目 | Host 新增共享工具 `harness_project`，桌面及移动端全局主对话均可调用。通过已有对话内确认流程后创建项目，可关联已有电脑目录，并在后续刷新中出现在项目列表。 |

项目创建工具只授予本次创建操作。项目主对话仍限定在当前项目内；创建项目不启动执行、不转移当前对话，也不自动授予后续执行控制权。工具结果及创建记录持久化，同一工具调用回放不会重复建立项目。拒绝结果也会持久化。

## 主要源码

- Android：`MainActivity.kt`、`DraftComposer.kt`、`WorkbenchComposer.kt`、`ComposerControls.kt`、`PendingComposerMessages.kt`、`DirectoryPicker.kt`、`ConfigurationScreens.kt`、`NativeScreens.kt`、`Workbench.kt`，均位于 `apps/android/app/src/main/java/app/kooyu/android/`。
- iOS：`KooyuApp.swift`、`DraftComposer.swift`、`MobileNavigation.swift`、`WorkbenchComposer.swift`、`ComposerControls.swift`、`ComposerPolicy.swift`、`NativeScreens.swift`、`Workbench.swift`，均位于 `apps/ios/Kooyu/`。
- Host：`packages/host/src/kodo/tools.ts`、`packages/host/src/kodo/kernel.ts`。
- 测试：Android `ComposerPolicyTest.kt`、iOS `ComposerPolicyTests.swift`、Host `conversational-management.test.ts`；页面验收脚本 `scripts/verify-mobile-restructure.mjs`。

继续使用 Kotlin Compose / SwiftUI，没有更换原生技术栈。

## 验证结果

| 检查 | 结果与范围 |
| --- | --- |
| Android 构建、单元测试、lint | `:app:testDebugUnitTest :app:lintDebug :app:assembleDebug` 成功；7 个测试类，共 54 项，0 失败、0 错误、0 跳过。依赖更新提示及现有 analytics 目录写入提示不影响结果。 |
| Host 对话管理测试 | 10 项通过。新增覆盖项目创建审批、关联工作区、回放去重、不额外授予执行权限、拒绝持久化和项目范围限制。 |
| Host 原生客户端及客户端契约测试 | 14 项通过。 |
| 编译检查 | Core、Web、Desktop 构建成功；Host 源码和测试 TypeScript 类型检查通过；本轮 Host 文件及验收脚本 ESLint 通过。 |
| 桌面 UI | 重新构建的真实 Electron 应用，95 张截图；脚本未报告 renderer 错误或页面横向溢出。 |
| Android UI | BlueStacks Android 13，ADB `127.0.0.1:5555`，30 张截图，包括手机、深色、平板、大字体与软键盘展开。已在原应用上更新安装，保留原有电脑连接，另加隔离测试电脑。 |
| Android 实际提交 | 通过界面选择目录并创建项目；从收件箱进入对话；回答 Codex 原生单选问题；接受项目管理审批。问题和审批结果已核对 Host 保存记录。队列编辑已核对文本及 revision 增长，撤回及运行中自动 `queue` 已核对保存的指令。 |
| iOS | 同步实现并添加策略测试源码；28 个 Swift 文件通过 tree-sitter 语法检查。当前 Windows 没有 Xcode，未执行 Swift 类型检查、XCTest、iPhone/iPad 构建或运行，不能据此认定 iOS 验收通过。 |

Android APK：`apps/android/app/build/outputs/apk/debug/app-debug.apk`。

APK SHA-256：`0b0c15965002af1b84065aaa72f6df2f18cb3d265b13ae11b21a2501dcd751e7`。

截图总索引：[桌面及 Android 截图](../output/playwright/mobile-restructure-2026-11-15/index.html)。分平台目录内包含原始 PNG、manifest 和总览；Android 另存原生页面结构 XML。截图生成后逐张校验 PNG 和 SHA-256。

## 验证边界

- 页面验收连接独立 Host fixture，未调用收费模型、未运行实际模型任务。问题/审批回调是真实客户端到 Host 的提交；项目工具的实际创建和幂等性由 Host 测试验证，不能将 fixture 的审批截图视作真实模型自主调用工具的证据。
- 本次 live UI 验证了 Codex 单选问题和项目管理审批；其他 harness 的多选、自定义回答、跳过和特殊审批语义仍需对应实际引擎逐项回归。立即发送/插入当前轮保留能力检查，本次未将它计入 live UI 成功项。
- 30 张 Android 截图覆盖本轮重构相关页面和状态，不等同于全部既有功能、全部设备或长期流式运行均已验证。桌面 95 张也仅证明遍历过的页面状态。
- 首轮队列 UI 自动化曾因 BlueStacks 硬件键盘下误发返回键而关闭编辑弹层；修正脚本后重跑通过。阶段历史保留失败与成功记录。页面探针增加 accessibility 空闲等待和 root refresh，避免读到 Compose 切换前的界面树。
- 此文只更新本轮需求状态；历史前端问题清单中目标、成果、工作中心等范围应继续按当前源码和独立验收记录核查，不能由本轮导航重构推断已全部补齐。
