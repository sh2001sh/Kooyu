# 全局记忆实现与验收（2026-11-16）

已实现 Kooyu 主对话自动提炼稳定偏好，以及桌面/Web、Android、iOS 的“设置 → 全局记忆”。记忆与配置保存在 Host，同一 Host 的已配对设备共用，不同 Host 不自动同步。

## 使用与边界

- 默认启用全局记忆和自动保存。主对话提示词要求主动提炼长期偏好，也支持“记住我偏好简洁回答”“以后先给结论”“忘记我的语言偏好”等请求。
- 关闭自动保存后，新记忆是待确认建议，确认后下轮使用。不同的新建议不能静默覆盖已有已确认偏好，需在设置中编辑。
- 关闭全局记忆后，后续回合停止注入全局条目，不能形成新全局记忆；保留已有内容供管理。已出现在旧对话历史中的内容不会被抹除。
- 三端支持手动新增、编辑、确认、删除与查看来源。其它端修改后，刷新或重新进入页面读取最新结果。
- 全局偏好跨项目使用；项目资料继续放在项目约定。自动提炼与注入限定 Kooyu 主对话，不自动注入其它独立原生 Harness。
- 删除后下轮不再使用；历史修订和原始对话仍保留，不属于物理清除。

## 实现

独立 `GET/PATCH /api/memory/settings` 保存 `{revision, enabled, automaticSaving}`，请求去重与修订检查防止双端覆盖；不复用旧 app-settings 整体覆盖。移动端使用持久操作回执，未知结果不自动重发。

每个普通发送回合读取当前配置与已确认记忆，注入内容限制为 16,000 字符。模型通过 `memory.remember` 保存，`memory.forget` 忘记，`memory.list` 查看，原项目建议操作保留。Host 校验主对话身份、当前已派发用户命令和原文引用；来源由 Host 生成，含会话 ID、命令 ID 与原文。非用户来源、伪造引用、常见密钥模式、跨范围修改被拒绝。

提示词要求不记录临时进度、秘密、文档引用、其它代理输出或新的权限。Host 能核验原文来源；内容是否属于长期偏好仍依赖模型判断，模式检测不代表能识别所有敏感信息。同主题规范化去重，显式更新检查版本并保留历史。

桌面沿用现有设置组件与品牌样式，新增配置导航、开关、列表、来源与编辑器，打开表单自动滚动聚焦。Android/iOS 使用对应原生设置页，复用长期约定编辑器。

## 验证结果

| 项目 | 结果 |
| --- | --- |
| Host 全局记忆、自托管、客户端契约、身份回归 | 48 项通过，0 失败 |
| 正常派发链路 | 捕获、跨项目读取、建议模式、动态关闭通过 |
| 来源与一致性 | 伪造引用、非用户命令、秘密模式、跨范围写入、过期版本拒绝；请求去重、重启持久化通过 |
| Core/Web 构建、Host 类型检查 | 通过 |
| 相关 TS 与验收脚本 ESLint | 通过 |
| Android 单元测试 | 57 项通过，0 失败 |
| Android lintDebug / assembleDebug | 成功，0 错误、27 警告；新增全局记忆页面未列入警告 |
| Android 原生 UI | 新 APK 安装至 BlueStacks，ADB `127.0.0.1:5555` 验证通过 |
| 桌面 UI | Chromium 加载生产 Web 构建，浅色、深色与 390px 窄屏通过；未重新验证 Electron 壳层 |
| iOS | 25 个源文件 tree-sitter 语法检查无错误；未做 Xcode 构建、SwiftUI 类型检查和真机验证 |

桌面实际完成对话保存、自动保存切换、建议确认、手动新增/编辑/删除、停用和重开。Android 实际完成配对、读取桌面记忆、共享配置修改、手动新增/编辑/删除、手机对话保存与建议确认。Host API 核对条目内容及状态，桌面读到手机修改。Android 最后恢复之前的“电脑 3”。

隔离测试适配器收到 `MemoryQA: remember ...` 后调用真实 memory 工具；真实 Host 路由、数据库、回执、配对与原生客户端参与验证。未调用收费模型，结果不代表真实模型的偏好提炼质量评估。正式 Kooyu 通过每回合提示词与工具接入实现。

Impeccable 检查本次 TSX 无发现。完整既有 settings.css 存在字体、颜色、圆角、缓动历史建议，本次新增布局规则没有新增发现，未扩展修改既有设计系统。

## 产物

- 截图画廊：`output/playwright/global-memory-2026-11-16/index.html`。
- 总清单与哈希：`output/playwright/global-memory-2026-11-16/manifest.json`。
- 13 张桌面、10 张 Android 原生 PNG；初始过程与最终确认截图均保留。
- APK：`apps/android/app/build/outputs/apk/debug/app-debug.apk`，SHA256 `29EA4007847FC2F11037E37909A789612184D95CDD1081131D22C3DADDB7D034`。
- 回归：`packages/host/test/global-memory.test.ts`。
- 复验：先构建 Core/Web，以 `KOOYU_MEMORY_FIXTURE=1` 启动 `scripts/platform-test-fixture.mjs`，然后使用 `scripts/verify-global-memory-desktop.mjs` 与 `scripts/verify-global-memory-android.mjs`。默认隔离端口 4397，Playwright 会话 `global-memory`；不能针对生产数据运行。

用户正在查看隔离页面，测试 Host 暂留以供检查；它不调用真实模型。测试 Host 的自动计划页面不属于全局记忆配置。
