# Kooyu 移动端前端参考项目调研

> 后续参考更新：用户进一步指定 Marvis 为结构参考、提供的 Granola 拼图为视觉参考，分析与转译建议见 [Marvis 结构与 Granola 风格](kooyu-marvis-structure-granola-style-2026-11-15.md)。本篇保留原生实现与框架调研价值，其旧视觉建议不覆盖用户后续指定的方向。

日期：2026-11-15。范围：当前工作区的桌面 React、Android Compose 与 iOS SwiftUI；重点是 Android。此次交付为选型和实施依据，没有改写界面或引入运行时依赖。

## 结论

推荐采用「本项目桌面实际样式 + Craft 的组件语言 + 原生 Compose/SwiftUI + 成熟聊天交互参考」。Android 优先参考 **RikkaHub 的聊天流程、Jetchat 的输入状态、Reply 的列表详情适配、Now in Android 的导航与状态分层**；Compose Unstyled 仅作为定制弹层等少量组件的候选。iOS 补充参考 Exyte Chat。

统一风格需要共同的语义 tokens 和组件规则；导航、输入法、返回手势、触摸尺寸仍按原生平台实现。桌面 React 组件不能直接成为 Compose 或 SwiftUI 组件。现有原生架构已经适用，不需要为了使用另一套聊天库而迁移 Flutter、React Native 或嵌入 WebView。

Craft 是已经确认的历史视觉 baseline，但**当前桌面实际生效的源码比旧设计说明更具参考价值**。本轮发现桌面与移动端、文档与实现均有漂移，不能简单把 Android 再改成一套“更漂亮”的独立皮肤。

## 当前实现为什么仍然不统一

以下是本轮读取当前工作区所得的源码事实，不把之前截图当作用户最新修改后的界面。旧截图位于 `output/playwright/desktop-android-refresh-20261115-143756/`，仅保留为历史基线。

| 问题 | 当前证据 | 对用户的影响 |
| --- | --- | --- |
| 三端没有共同的有效主题来源 | 桌面 `app.css` 的浅色导航背景为 `#f7f7f9`、凹陷背景为 `#f1f2f4`，强调动作采用黑白；Android `LightKooyu` 仍是 `#f3efea` / `#efece7` 与珊瑚色。Android 主题注释声称匹配桌面，但数值已不同 | 同一产品看起来像两套应用；换 Logo 不能消除差异 |
| 桌面自身也发生了覆盖漂移 | `app.css` 末尾 `.dark` 再次将 paper 改成 `#0c0e14`、navigator 改成 `#08090d`，并追加侧栏玻璃效果；Android 深色 paper 仍是 `#18191d` | 只抄 CSS 前面的 token 定义，会继续对不齐实际桌面 |
| 设计记录滞后 | `apps/web/DESIGN.md` 仍描述 Sunset Coral 与暖色表面，当前 `app.css` 的主 token 已是黑白与中性灰 | 只照文档实现会复制旧风格；需要以生效样式校准后记录 |
| Android 只完成了部分主题化 | `Theme.kt` 有 `KooyuColors` 和 Material `ColorScheme` 两套配置；`MaterialTheme` 只传入 `colorScheme`，未统一 typography 与 shapes；页面混用两套入口 | 默认控件和自绘卡片的字体、圆角、状态色难以一致 |
| 主题设置没有完整状态模型 | `ThemeManager.themePreference` 为普通可变字符串，默认 `dark`，未知值/`system` 分支仍返回深色 | 系统主题无法按该入口正确跟随，也缺少可观察设置状态 |
| 移动导航视觉过重 | 窄屏底栏使用 32dp 圆角、14dp 阴影与玻璃色表面；五个入口全部同级 | 底部视觉权重过高，日常工作入口与低频设置入口竞争；是否保留五项应按任务频率验证 |
| 路由表达较分散 | 顶层使用 `tab: Int`、`selected`、`creating`、`devices` 等状态；已有 `BackHandler`、`rememberSaveable` 和通知跳转，不能说完全没有返回/恢复支持 | 列表、会话、项目、弹层与通知目标的返回关系难以统一扩展和测试 |
| 操作状态粒度偏粗 | `WorkbenchState.canWrite` 依赖共享 `busy`，`execute` 设置同一个 busy；页面也使用该值控制操作 | 不相关操作容易一起进入不可用状态；需区分发送、审批、配置保存等操作，同时保留必要的写入互斥 |
| 日常界面混入内部状态语言 | `LINK_HALTED · OFFLINE`、`PENDING_VERIFY` 直接出现在主界面 | 用户不容易判断是连接失败、发送结果待核对，还是任务已停止 |
| 创建入口仍偏表单化 | Android `SessionComposer` 集中处理项目、harness、模型/绑定及首条消息；桌面已有 inline draft composer | 用户在移动端需要先理解较多配置，再开始表达任务；应研究默认值继承与渐进展开 |

本轮没有重新逐页运行应用，因此“键盘遮挡、旋转丢失、通知返回错误”等属于后续验证项，不冒充已复现缺陷。功能是否齐全也应逐项核对现有能力契约，不能由组件库的功能列表推断。

源码入口：[桌面实际样式](../apps/web/src/styles/app.css)、[桌面设计记录](../apps/web/DESIGN.md)、[Android 主题](../apps/android/app/src/main/java/app/kooyu/android/Theme.kt)、[Android 外壳与会话](../apps/android/app/src/main/java/app/kooyu/android/MainActivity.kt)、[Android 新建与业务页面](../apps/android/app/src/main/java/app/kooyu/android/NativeScreens.kt)、[Android 状态](../apps/android/app/src/main/java/app/kooyu/android/Workbench.kt)。

## 框架与项目怎么选

### 1. Craft Agents：统一视觉与 Agent 对话的主参考

[项目](https://github.com/craft-ai-agents/craft-agents-oss) · Electron / React · Apache-2.0。

适合借鉴语义表面、文本层级、列表密度、输入区组织、消息回合和工具信息的渐进展开。它与本项目桌面栈一致，也是已有选择，适合作为跨端视觉规则的来源。

本项目实际提取版本是 `1627c43e93bb4f5b1532116b8eb092c0ada4b23f`，范围见 [EXTRACTION](../third-party/craft-agents/EXTRACTION.md)。此次查到的新提交仅补充研究，不意味着升级已提取 baseline。Android 应转译有效的设计规则，不直接搬 React 外壳或 Craft 的业务状态。

核查文件：[tokens.css](https://github.com/craft-ai-agents/craft-agents-oss/blob/3ce9fc12837541d688a59a8f0a2e9755ceb89ac2/packages/ui/src/styles/tokens.css)、[ChatInputZone.tsx](https://github.com/craft-ai-agents/craft-agents-oss/blob/3ce9fc12837541d688a59a8f0a2e9755ceb89ac2/apps/electron/src/renderer/components/app-shell/input/ChatInputZone.tsx)。复用时保留适用的 LICENSE / NOTICE，并遵守品牌与资产边界。

### 2. RikkaHub：最贴近 Android 端的 AI 聊天流程参考

[项目](https://github.com/rikkahub/rikkahub) · Kotlin / Compose · AGPL-3.0。

这是本轮最值得研究的原生 Android AI 聊天项目。核查的 `ChatInput` 将输入状态、发送/取消回调、输入法与系统导航栏 inset 分开组织；`ChatInputState` 单独处理文本、附件与消息编辑。可对应 Kooyu 的输入区、附件预览、编辑恢复和会话历史浏览。

采用方式：先按用户流程研究行为，再用 Kooyu 的协议与组件独立实现。其 Material 3 Expressive 外观不作为 Kooyu 新皮肤；其模型调用方式也不替代本项目 Session Host。尤其不能直接沿用“生成中仍有文字时发送”的分支，而忽略不同 harness 对 queue / steer / new 的能力限制。

该项目许可证与 MIT/Apache 候选不同，本轮没有复制其源码到产品。若后续决定复用源文件，应按实际复用范围处理 AGPL 要求。

核查文件：[ChatInput.kt](https://github.com/rikkahub/rikkahub/blob/90ef90b765105a775e1c3292a5d39f4ddd45be27/app/src/main/java/me/rerere/rikkahub/ui/components/ai/ChatInput.kt)、[ChatInputState.kt](https://github.com/rikkahub/rikkahub/blob/90ef90b765105a775e1c3292a5d39f4ddd45be27/app/src/main/java/me/rerere/rikkahub/ui/hooks/ChatInputState.kt)、[ConversationList.kt](https://github.com/rikkahub/rikkahub/blob/90ef90b765105a775e1c3292a5d39f4ddd45be27/app/src/main/java/me/rerere/rikkahub/ui/pages/chat/ConversationList.kt)。

### 3. Google Compose Samples：输入、返回与大小屏布局的实现参考

[项目](https://github.com/android/compose-samples) · 原生 Compose 官方样例 · Apache-2.0，图片等资产另核查许可。

优先读两个样例：

- **Jetchat**：输入状态、焦点、输入选择器、返回处理及 UI 测试。核查的 `UserInput` 使用可保存状态处理输入选择器等内容，并明确管理焦点。适合拆分 Kooyu 目前集中在会话页面中的输入交互。
- **Reply**：`ReplyApp` 根据窗口宽度与折叠姿态选择单/双面板，并从导航栈读取当前目的地。适合把“会话列表 → 详情”映射到手机、平板和分屏，而不只是按固定宽度隐藏某块区域。

它们是交互与结构样例，不是可直接投入生产的 Agent 工作台；不照搬演示数据、动态配色或邮件业务。触摸尺寸和字体保留原生要求，颜色与圆角映射到 Kooyu 组件规则。

核查文件：[Jetchat UserInput](https://github.com/android/compose-samples/blob/25631e8f544a9a1e3f01e296eaf1b4c28428196c/Jetchat/app/src/main/java/com/example/compose/jetchat/conversation/UserInput.kt)、[ConversationUiState](https://github.com/android/compose-samples/blob/25631e8f544a9a1e3f01e296eaf1b4c28428196c/Jetchat/app/src/main/java/com/example/compose/jetchat/conversation/ConversationUiState.kt)、[ReplyApp](https://github.com/android/compose-samples/blob/25631e8f544a9a1e3f01e296eaf1b4c28428196c/Reply/app/src/main/java/com/example/reply/ui/ReplyApp.kt)。

### 4. Now in Android：解决前端逻辑问题的主参考

[项目](https://github.com/android/nowinandroid) · 官方 Android 架构样例 · Apache-2.0。

最有价值的是 UI 状态、事件与数据层的边界，以及顶级目的地与子返回栈的管理。核查版本中的 `NavigationState` 已使用 Navigation 3，并为顶级目的地维护子栈与可保存状态。

对 Kooyu 的适用方式：把 Host 数据投影、页面加载状态、操作回执、导航目标分开；按功能抽出 `SessionList`、`Conversation`、`Inbox`、`Settings` 等状态与事件入口。保持已有 `StateFlow`、生命周期收集和可靠发送机制，避免把所有状态塞进新的全局 store。

不需要把它的整个多模块工程结构照搬过来。导航库采用哪个版本要验证现有 Kotlin、Compose BOM、Activity 和 Lifecycle 的兼容性，本轮不承诺直接套用上游依赖版本。

核查文件：[架构说明](https://github.com/android/nowinandroid/blob/2982e63cb691ad49cd009aab43dc206fee6699c2/docs/ArchitectureLearningJourney.md)、[NavigationState.kt](https://github.com/android/nowinandroid/blob/2982e63cb691ad49cd009aab43dc206fee6699c2/core/navigation/src/main/kotlin/com/google/samples/apps/nowinandroid/core/navigation/NavigationState.kt)。

### 5. Compose Unstyled：自有视觉下的可选基础组件

[项目](https://github.com/composablehorizons/compose-unstyled) · Compose Foundation 之上的无预设外观组件 · MIT。

其文档和源码提供 Bottom Sheet、菜单、对话框与自定义主题能力。价值是让 Kooyu 自己决定表面、排版和圆角，同时借助组件已有的状态与交互机制，适合当前 Material 默认控件和自绘界面混搭的问题。

优先用现有 Compose / Material3 完成统一封装；只有当某些组件需要持续重写默认样式时，再以一类弹层做验证。库的无障碍声明不能替代本项目的 TalkBack、焦点、返回与键盘测试。不要再引入一套平行的主题值。

核查文件：[Custom Themes](https://github.com/composablehorizons/compose-unstyled/blob/efc4f33e6160925f44cadf2c7424ad8086663a76/docs/pages/custom-themes.md)、[BottomSheet.kt](https://github.com/composablehorizons/compose-unstyled/blob/efc4f33e6160925f44cadf2c7424ad8086663a76/composeunstyled-bottom-sheet/src/commonMain/kotlin/com/composeunstyled/BottomSheet.kt)。依赖兼容与二进制体积尚未验证，因此列为候选，不是本轮新增依赖。

### 6. Exyte Chat：iOS 聊天组件与交互的补充参考

[项目](https://github.com/exyte/Chat) · SwiftUI · MIT。

README 和 builder 定义确认支持自定义消息与输入视图、分页、附件展示和消息菜单。可以研究长历史、媒体选择和长按操作，再映射到 Kooyu 的回合、工具与审批内容。

核查版本要求 iOS 17，和本项目部署目标一致；但它还有 Swift tools 6.1 要求以及 MediaPicker、Giphy、Kingfisher、AnchoredPopup 等依赖，不能仅因系统版本相符就宣称可直接接入。Agent 时间线不应为适应普通聊天消息模型而丢失命令回执、工具状态和关联目标。

核查文件：[ChatBuilderParameters.swift](https://github.com/exyte/Chat/blob/f382a147e3f9a127b8494df4a9314580dafc3cd4/Sources/ExyteChat/Views/ChatBuilderParameters.swift)、[Package.swift](https://github.com/exyte/Chat/blob/f382a147e3f9a127b8494df4a9314580dafc3cd4/Package.swift)。建议先研究交互，按需要独立实现少数组件。

### 7. assistant-ui：工具调用与流式状态的对照参考

[项目](https://github.com/assistant-ui/assistant-ui) · 以 TypeScript / React 为主，仓库也有 React Native bindings · MIT。

核查的 Composer 区分附件 uploading / done / error，并提供发送/停止状态；工具示例将参数、审批、结果和取消状态分开展示。这些值得用作 Kooyu 三端组件行为清单，避免消息界面只覆盖纯文本聊天。

React Native bindings 也不能直接用于 Kotlin Compose 或 SwiftUI。该项目对桌面 React 更有直接复用潜力；移动端采用交互参考，不因此改变现有技术栈。组件的流式状态也不能取代 Host 对命令投递与任务完成的事实判定。

核查文件：[Composer](https://github.com/assistant-ui/assistant-ui/blob/6029493d7b20f29f5f10f877de1d6e14c5b595c7/packages/ui/src/components/react/assistant-ui/elements/composer.tsx)、[Tool fallback samples](https://github.com/assistant-ui/assistant-ui/blob/6029493d7b20f29f5f10f877de1d6e14c5b595c7/apps/docs/components/pages/docs/samples/tool-fallback.tsx)、[React Native package](https://github.com/assistant-ui/assistant-ui/blob/6029493d7b20f29f5f10f877de1d6e14c5b595c7/packages/react-native/package.json)。

## 推荐组合与优先级

| 层次 | 首选 | 在本项目中的用途 |
| --- | --- | --- |
| 视觉来源 | 本地桌面生效样式，追溯 Craft baseline | 统一表面、文字、边界、动作、状态、圆角、图标规则 |
| Android 组件 | 现有 Compose / Material3 的 Kooyu 封装 | 优先统一基础控件，Compose Unstyled 按需验证 |
| Android 聊天行为 | RikkaHub + Jetchat | 草稿、附件、键盘、焦点、消息浏览、发送动作 |
| 导航与页面状态 | Now in Android + Reply | 显式路由、返回栈、通知目标、手机/平板适配 |
| Agent 信息呈现 | Craft + assistant-ui | 工具卡、审批、结果、取消、流式输出与消息回执 |
| iOS 补充 | 原生 SwiftUI + Exyte Chat 参考 | 保留平台返回和输入体验，共享产品语义 |

### 第一批：先消除跨端漂移

从桌面实际 CSS 级联提取有效 token，明确品牌标识色与主要动作色的区别；建立一份可追溯的中间 token 清单，再映射到 CSS、Compose 与 SwiftUI。统一颜色之外，还要统一字体角色、边界、圆角、选中状态和间距角色。像素尺寸允许随平台调整。

Android 将 Material 与自绘组件都接到同一语义来源，补全 typography / shapes；把主题偏好改为可观察、可持久化的设置，正确处理 system / light / dark。先对照会话列表、对话输入区、设置表单三类高频界面，避免各业务页面自行发明卡片。

验收：同一数据与主题下，两端主次层级一致；品牌色、主要动作与状态色不串用；浅深色和系统切换都生效。不要以三端字面值相等作为全部验收。

### 第二批：整理移动端导航与操作逻辑

参考导航样例，为会话、项目、待处理、详情与设置建立显式目的地；通知目标携带 host/session/item 标识，返回时保留合理的列表上下文。已有返回处理和可保存状态逐项迁移，避免重构回退。

参考 Now in Android 的状态边界，将共享 busy 拆成必要的页面加载、局部操作与投递状态；仍保留防重复提交、Host 切换隔离和写入安全。连接状态、任务运行状态、自动继续状态、消息投递结果分别表达。

验收：系统返回、弹层关闭、通知跳转、切换 Host、旋转/重建、平板分屏路径可预测；一次保存不会让所有无关动作同时失效；投递未知不会自动重发。

### 第三批：优化开始任务与继续处理的路径

参考桌面草稿输入和移动聊天项目，保留项目、harness 与模型能力约束，用继承默认值减轻首次输入前的配置负担；按需展开高级项。让停止、审批、待核对、附件错误和回到最新消息在对话中可达。

工具输出采用摘要与展开层级，但必须能查看完整结果。发送与停止由实际 harness capabilities 和 Host 状态决定；`queue`、`new`、`steer` 不因参考项目只有一个发送按钮而合并语义。

验收：从会话/项目入口到首条消息路径完整；创建失败、首条消息失败、附件上传失败可区分；长历史、流式输出与工具卡保持滚动锚点；用户能理解下一步动作。

## 后续运行验证清单

- Android 窄屏、平板/横屏；浅色、深色、系统主题；大字体与 TalkBack。
- 中文输入法展开/收起、多行输入、附件选择返回、草稿切换、应用重建。
- 新建对话、项目继承配置、模型限制、发送/停止/审批/待核对、历史分页与新消息定位。
- 通知进入具体事项、跨 Host 跳转、返回原上下文、断线重连与投递结果核对。
- 桌面和 Android 使用同一 fixture、同一状态与相近构图截图；iOS 单独在可运行环境验收，不用 Android 结果代替。

每个页面要覆盖空、加载、失败、离线及真实业务状态。截图应附构建版本与 fixture 标识，避免继续用旧截图评价新源码。

## 来源、维护情况与调研边界

本轮通过 GitHub 官方 API 查询元数据、截至 2026-11-15 的提交，并读取固定提交的 README、许可证和上述源码。七个仓库均未归档；以下日期说明近期有提交，不证明发行版稳定或已兼容本项目。

| 项目 | 核查提交 | 提交日期（UTC） | 根许可证 |
| --- | --- | --- | --- |
| Craft Agents | `3ce9fc128375` | 2026-11-11 | Apache-2.0 |
| RikkaHub | `90ef90b76510` | 2026-11-15 | AGPL-3.0 |
| Compose Unstyled | `efc4f33e6160` | 2026-11-14 | MIT |
| Compose Samples | `25631e8f544a` | 2026-10-23 | Apache-2.0 |
| Now in Android | `2982e63cb691` | 2026-10-20 | Apache-2.0 |
| assistant-ui | `6029493d7b20` | 2026-11-15 | MIT |
| Exyte Chat | `f382a147e3f9` | 2026-11-06 | MIT |

官方框架文档已核对可访问：[Compose 自定义设计系统](https://developer.android.com/develop/ui/compose/designsystems/custom)、[Navigation 3](https://developer.android.com/guide/navigation/navigation-3)、[自适应列表详情](https://developer.android.com/develop/ui/compose/layouts/adaptive/list-detail)。本轮仅核对页面与主题，不把官方网页视为固定提交，也没有据此指定未验证的依赖版本。

完整提交、文件来源、许可证链接与本地证据摘要见 [来源清单](mobile-ui-reference-sources-2026-11-15.json)。原始研究缓存保存在 `.local/research/mobile-ui-20261115/`，不作为产品依赖。

未安装或运行上述参考应用，未验证其全部功能与性能，未复制上游业务代码，也未修改当前前后端实现。现有 PRODUCT.md 是旧 prose schema；本轮不附带修改产品元数据。后续实施以当前技术栈和已确认的桌面视觉方向为约束。
