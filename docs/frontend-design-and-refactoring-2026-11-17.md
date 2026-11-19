# Kooyu 桌面端优化与移动端重构完整设计方案

> **版本**：2026-11-17  
> **覆盖范围**：Desktop (`apps/web` + `apps/desktop`) & Android (`apps/android` Jetpack Compose)  
> **设计哲学**：Warm Precision, Native Fluidity（温暖精确 · 原生流体物理交互）

---

## 1. 背景与现状诊断

通过对桌面端源码（`apps/web/DESIGN.md`、`craft-tokens.css`、`app.css`、`App.tsx`）以及通过 BlueStacks ADB (`127.0.0.1:5555`) 对 Android 真机界面与源码（`Theme.kt`、`MainActivity.kt`、`ChatTranscript.kt`、`NativeScreens.kt`）的交叉对比，当前项目在跨端视觉、信息架构和动画交互上存在以下核心割裂点：

### 1.1 视觉 Token“三套标准”冲突
1. **设计规范层 (`apps/web/DESIGN.md`)**：定义了 **Sunset Coral & Warm Paper** 体系（浅色 `#f3efea` 画布 + `#ffffff` 纸面 + `#f17561` 落日珊瑚强调色 + `#fceae4` 温暖用户气泡）。
2. **桌面实现层 (`apps/web/src/styles/app.css`)**：
   - 单文件膨胀至 **11,250+ 行**。
   - 在 371–490 行将 `craft-tokens.css` 覆盖为冷灰单色系（`--accent-brand: #18191d` / `#f4f4f6`），又在 11053 行追加了 `AWWWARDS ELEVATION LAYER` 二次覆盖，导致珊瑚色品牌锚点与冷色单色控件混杂。
3. **移动端实现层 (`apps/android/.../Theme.kt`)**：
   - 默认强制深色模式（`ThemeManager.themePreference = "dark"`，深蓝黑背景 `#0C0E14`）。
   - 主强调色 `accent` 被设为纯白/黑单色（`0xFFF4F4F6` / `0xFF18191D`），而 `brandCoral` (`0xFFE6533C`) 仅在零星徽标出现，用户气泡 (`bubble = 0x12FFFFFF`) 与系统卡片难以区分。

### 1.2 移动端 (BlueStacks ADB 实测) 信息架构与布局痛点
通过 ADB 抓取的 `1080×1920 @ 320dpi` 视图树分析，当前 Android 首页在首屏垂直空间内堆叠了 **7 层控制块**：
1. **顶栏过载**：同时塞入 `Logo + kooyu + 设备胶囊 (F827EF…FCBB) + 刷新图标 + 收件箱图标 + [+ 新建] 按钮`。
2. **离线横幅生硬**：`电脑未连接...` 占满顶部大面积红色边框卡片，缺少折叠或重试微交互。
3. **缺少 L0 `Kooyu 主对话` 置顶区**：桌面端将 `Kooyu 主对话 (Self-Hosted Commander)` 作为置顶一级入口，而移动端将其混入普通分组或隐藏。
4. **缺少 `按项目 | 按 Harness` 视图切换**：移动端仅有 `[项目目录]` 与 `[进行中 | 已归档]` 药丸按钮，无法按 Harness 引擎（Claude Code / Codex / Gemini 等）聚合查看会话。
5. **列表卡片厚重、缺少手势与选中锚点**：每个会话均为独立 `18.dp` 厚边框圆角卡片，缺乏桌面端 iOS Inset Grouped 紧凑分组感、左侧 `3.dp` 珊瑚色选中指示条及左滑归档/删除手势。
6. **空状态与新建流割裂**：点击 `+ 新建` 仅弹出 ActionSheet 选择引擎即直接创建空白会话，缺少桌面端 `DraftWorkspace`（先选项目、Harness、权限模式并输入首条 Prompt 再启动会话）的一体化体验。

### 1.3 跨端动画与交互断层
- **桌面端**：虽然定义了 `--spring-snap` / `--spring-base` / `--spring-panel` CSS `linear()` 弹簧曲线，但大量选择器与抽屉仍混用 `cubic-bezier` 或无过渡硬切；Segmented Control 缺少滑块物理跟随动画。
- **移动端**：`MainActivity.kt` 中底部 Tab 切换与会话进入/退出均使用线性感明显的 `tween(220)` / `tween(300)`，缺少真正的胡克定律 `spring(dampingRatio, stiffness)` 物理弹性、按压缩放反馈（Press Scale）与原生触觉反馈（HapticFeedback）。

---

## 2. 统一设计语言规范 (Unified Design System)

双端统一遵循 **“Warm Precision, Native Fluidity（温暖精确，原生流体）”** 原则，严格对齐一套语义化 Token。

### 2.1 双端语义色彩映射表 (Color Tokens)

| 语义角色 (Token Role) | Web CSS 变量 (`craft-tokens.css`) | Android `KooyuColors` (`Theme.kt`) | Light 值 (Warm Daylight) | Dark 值 (Obsidian Carbon) | 视觉用途说明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Canvas / Navigator** | `--surface-navigator` | `navigator` | `#F3EFEA` | `#0D0E11` | 窗口底色、侧边栏、移动端列表背景 |
| **Paper (主画布)** | `--surface-paper` | `paper` | `#FFFFFF` | `#14161B` | 桌面主对话卡片、移动端会话详情页底色 |
| **Raised (浮起卡片)** | `--surface-raised` | `raised` | `#FFFFFF` | `#1A1D24` | 列表分组容器、Composer 输入框、设置组 |
| **Sunken (凹陷槽)** | `--surface-sunken` | `sunken` | `#EFECE7` | `#101216` | 代码块、终端输出槽、Segmented 轨道 |
| **Glass (毛玻璃浮层)** | `--surface-floating` | `glassSurface` | `rgba(255,255,255,0.86)` | `rgba(24,27,34,0.84)` | 顶栏、底部浮动导航栏、底部抽屉 Sheet |
| **Text Primary** | `--text` | `text` | `#1A1917` | `#F4F2EE` | 正文、标题、主要控件文字 |
| **Text Secondary** | `--text-secondary` | `textSecondary` | `#524F4A` | `#B8B4AC` | 副标题、模型摘要、工具参数摘要 |
| **Text Tertiary** | `--text-tertiary` | `textTertiary` | `#78736C` | `#858078` | 时间戳、分组小标题、快捷键提示 |
| **Brand Coral (主强调)** | `--accent-solid` | `brandCoral` | `#E6533C` | `#F17561` | 发送按钮、选中指示条、新建主按钮、活跃焦点 |
| **Brand Coral Tint** | `--accent-tint` | `brandCoralTint` | `rgba(230,83,60,0.11)` | `rgba(241,117,97,0.16)` | 选中会话行背景、活跃胶囊底色 |
| **User Bubble** | `--fill-bubble` | `bubble` | `#FCEAE4` | `#261B19` | 用户发送的消息气泡（温暖珊瑚浅底） |
| **Control Ink (次强调)** | `--accent-ink` | `accent` | `#1A1917` | `#F4F2EE` | 辅助黑/白胶囊按钮、高对比度次级开关 |
| **Border Subtle** | `--border-subtle` | `borderSubtle` | `rgba(26,25,23,0.06)` | `rgba(244,242,238,0.06)` | 列表行内部分割线（Inset Hairline） |
| **Border Standard** | `--border` | `border` | `rgba(26,25,23,0.10)` | `rgba(244,242,238,0.10)` | 卡片外框、输入框默认描边 |
| **Status Running** | `--info-raw` | `info` | `#D97706` | `#F59E0B` | 运行中脉冲点、思考中呼吸态 |
| **Status Ready / Done** | `--success-raw` | `success` | `#16A34A` | `#34D399` | 就绪态、工具执行成功 |
| **Status Error** | `--destructive-raw` | `destructive` | `#DC2626` | `#F87171` | 审批拒绝、连接断开、报错提示 |

#### 珊瑚色克制原则 (Coral Discipline)
为避免界面变成刺眼的橙色海洋，`brandCoral` **仅允许出现在以下 5 处**：
1. 活跃会话行左侧 `3px / 3.dp` 垂直选中指示条与浅色行底 (`brandCoralTint`)。
2. Composer 右下角的圆形发送按钮（当输入非空可执行时）及 `+ 新建` 主触发器。
3. 用户消息气泡 (`bubble`) 的暖色底调与左边框。
4. 移动端底部浮动导航栏当前激活 Tab 的图标与指示点。
5. 键盘/无障碍焦点外环 (`focus-ring`)。

### 2.2 字体与排版层级 (Typography Scale)

| 层级名称 | 桌面端 CSS (`px / lh / weight`) | 移动端 Compose (`sp / lh / weight`) | 适用场景 |
| :--- | :--- | :--- | :--- |
| **Page Title** | `20px / 28px / 700` (`-0.015em`) | `20.sp / 26.sp / Bold` | 页面主标题、Sheet 标题 |
| **Section Header** | `12px / 16px / 600` | `12.sp / 16.sp / SemiBold` | 侧边栏分组头、设置分组标题 |
| **Session Row Title**| `13.5px / 18px / 600` | `14.sp / 19.sp / SemiBold` | 会话列表主标题（单行省略） |
| **Body Copy (聊天)** | `15px / 24px / 400` (`-0.011em`) | `15.sp / 23.sp / Normal` | AI 回复正文、用户消息气泡正文 |
| **UI Label / Pill** | `13px / 18px / 500` | `13.sp / 18.sp / Medium` | 按钮、模型胶囊、底部导航标签 |
| **Caption / Meta** | `11px / 14px / 500` (`tabular-nums`)| `11.sp / 14.sp / Medium` | 时间戳、Token 计数、引擎短标签 |
| **Monospace (代码)** | `12.5px / 18px` (`JetBrains Mono`) | `12.sp / 17.sp` (`FontFamily.Monospace`) | 代码块、Diff、终端输出、命令 |

### 2.3 “状态必有文字”法则 (The State Has Words Rule)
严禁在任何一端使用无文字的纯色圆点表达状态。所有会话状态必须采用 **`[6dp 状态点 + 中文状态词]`** 胶囊或前缀：
- `● 运行中`（琥珀色脉冲动画）
- `● 需确认`（珊瑚红高亮提醒）
- `● 就绪`（翠绿色静态点）
- `● 已完成`（柔和绿/次级灰）
- `● 异常`（警示红）

---

## 3. 跨平台物理动画与微交互规范 (Motion & Micro-interactions)

双端摒弃生硬的线性 `tween`，全面统一为 **胡克定律弹簧物理模型 (Spring Physics)**。

### 3.1 双端弹簧参数对照表

| 动画档位 | 物理特性 | 桌面端 CSS 变量 | Android Jetpack Compose `AnimationSpec` | 典型应用场景 |
| :--- | :--- | :--- | :--- | :--- |
| **Snap (迅捷微交互)** | 高刚度、无过冲 (`ζ = 1.0, stiffness = 700`) | `var(--spring-snap-dur) var(--spring-snap)` (`266ms`) | `spring(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = 700f)` | 按钮按压回弹 (`scale 0.96`)、Segmented 滑块位移、Checkbox/Switch 切换 |
| **Base (标准组件展开)**| 临界微弹 (`ζ = 0.86, stiffness = 420`) | `var(--spring-base-dur) var(--spring-base)` (`388ms`) | `spring(dampingRatio = 0.86f, stiffness = 420f)` | 工具卡片展开/折叠、推理过程折叠、消息气泡入场、列表项增删 (`animateItem`) |
| **Panel (页面与抽屉)** | 柔顺阻尼 (`ζ = 0.92, stiffness = 320`) | `var(--spring-panel-dur) var(--spring-panel)` (`494ms`) | `spring(dampingRatio = 0.92f, stiffness = 320f)` | 桌面右侧检查器开合、移动端会话推入/返回、BottomSheet 弹出 |
| **Pulse (状态呼吸)** | 正弦循环 (`1400ms`) | `@keyframes kooyu-pulse` | `infiniteRepeatable(tween(1400, easing = FastOutSlowInEasing), RepeatMode.Reverse)` | `运行中` 圆点呼吸、AI 思考中骨架光泽、流式输出游标 |

### 3.2 核心微交互清单 (Micro-interactions)

1. **Tactile Press Scale (触感按压缩放)**：
   - **桌面端**：所有可点击卡片、胶囊、图标按钮在 `:active` 时执行 `transform: scale(0.97)`，配合 `--dur-micro (100ms)`。
   - **移动端**：封装统一的 `Modifier.kooyuPressable()`，监听 `InteractionSource` 的 `collectIsPressedAsState()`，按压时以 `Snap` 弹簧缩放至 `0.96f`，并在触发时调用 `LocalHapticFeedback.current.performHapticFeedback(HapticFeedbackType.TextHandleMove)`。
2. **Sliding Pill Segmented Control (滑动胶囊分段控制器)**：
   - 桌面端与移动端的分段切换（如 `按项目 | 按 Harness`、`进行中 | 已归档`、设置页 Tab）均采用底层白色/浮起滑块 (`thumb`) 随选中项执行 `Snap` 弹簧位移动画，而非背景色瞬间闪烁。
3. **Streaming Message & Reasoning Choreo (流式消息与推理编排)**：
   - 新消息上屏：从底部向上位移 `8px / 8.dp` + 透明度 `0 -> 1`（`Base` 弹簧）。
   - 思考过程 (`ReasoningBlock`)：思考进行中时，左侧思维图标旋转/呼吸，右侧实时滚动显示最新一行摘要；思考完成后自动以 `Base` 弹簧平滑折叠为单行 `已思考 4.2s · 点击展开`，右侧箭头从 `90°` 旋转归位至 `0°`。
4. **Tool Call Disclosure (工具调用抽屉)**：
   - 连续多个只读工具调用（如 `Read`、`Glob`、`Grep`）自动聚合成紧凑的工具树卡片；点击任意工具行，右侧箭头 `90°` 弹簧旋转，下方 `OutputWell` 以 `expandVertically(springBase) + fadeIn()` 展开代码块与 Diff 高亮。
5. **Composer Morphing Send Button (发送按钮形态变换)**：
   - 当输入框为空时，右侧按钮显示灰色的不可用态或语音/快捷指令态；当输入第 1 个字符时，按钮以 `spring(dampingRatio = 0.65f, stiffness = 600f)` 弹性放大并变为珊瑚色 (`brandCoral`) 实心圆；当会话处于 `运行中` 时，平滑变形为珊瑚红圆角方形 `停止 (Stop)` 按钮。

---

## 4. 桌面端 (`apps/web`) 优化设计方案

### 4.1 样式架构解耦与清理 (`src/styles/`)
将当前 `11,250+` 行的单体 `app.css` 拆解为分层模块，消除第 371 行与第 11053 行的重复冲突覆盖：
```text
apps/web/src/styles/
├── tokens.css          # 唯一真相源：Warm Daylight & Obsidian Carbon 颜色、字体、圆角与弹簧变量
├── base.css            # Reset、滚动条、全局排版与无障碍 reduced-motion 规则
├── layout-shell.css    # 三栏 Workbench 框架（Sidebar + Paper Island + Inspector Sheet）
├── sidebar.css         # L0 Kooyu 主对话置顶卡、分段控制器、iOS Inset Grouped 会话行
├── transcript.css      # 消息气泡、Markdown 排版、Reasoning 折叠块、Tool Call 卡片与 Diff
├── composer.css        # 底部悬浮 Composer、模型/推理强度/权限胶囊、附件预览
├── modals-sheets.css   # ⌘K 命令面板、设置弹窗、QR 手机配对向导、目录选择器
└── pages.css           # 用量统计 (Usage)、模型来源 (Providers)、全局记忆与定时任务页
```

### 4.2 桌面端核心视觉与交互升级

1. **三栏岛式工作台 (Floating Paper Island)**：
   - 外层窗口保持 `--surface-navigator` (`#F3EFEA` / `#0D0E11`) 温暖底色。
   - 中间主舞台（主对话区 / 页面区）作为一张带有 `16px` 圆角、`1px` 细微内描边与柔和阴影 (`--elev-1`) 的独立纸张 (`--surface-paper`) 悬浮于画布右侧（外边距 `8px 8px 8px 0`）。
2. **左侧导航栏 (Sidebar) 层次精简**：
   - **顶部工具栏**：左侧品牌标识 + 全局搜索框 (`⌘K` 触发) + 右侧新建会话按钮。
   - **L0 置顶主控卡 (`Kooyu 主对话`)**：独立于普通项目列表之上，采用微暖渐变底色与专属星芒徽标，一键进入跨项目统筹 Agent。
   - **分段切换器 (`按项目 | 按 Harness | 归档`)**：植入带物理滑动滑块的 Segmented Control。
   - **会话行 (`SessionRow`)**：严格限制为 **两行信息密度**——第一行：`[Harness 18px 徽标] + 会话标题 + 右侧相对时间`；第二行：`[6px 状态点 + 状态词] + 简短模型名/最新摘要`。选中态在左侧绘制 `3px` 圆角珊瑚竖条 (`--accent-solid`)。
3. **中央对话舞台与悬浮 Composer**：
   - 顶栏采用 `backdrop-filter: blur(20px)` 半透明毛玻璃，展示面包屑 `[项目名] / [会话标题]`，右侧仅保留 `[最新动态]`、`[详情抽屉切换]` 与 `[更多 ⋯]`。
   - 底部 Composer 采用 `18px` 大圆角浮起卡片，聚焦时外圈浮现 `2px` 珊瑚色柔光环；底部工具栏集成 **Harness 选择胶囊 + 模型选择胶囊 + 思考强度胶囊 + 权限模式胶囊**，点击弹出带弹簧入场的轻量级 Popover。
4. **右侧检查器抽屉 (Inspector Sheet)**：
   - 宽度 `320px`，开合时使用 `--spring-panel` 驱动 `width` 与 `transform: translateX()`，避免主对话区文字发生生硬重排抖动。
   - 内部采用 iOS Inset Grouped 卡片展示：工作目录与 Git 分支、已修改文件列表（点击可预览 Diff）、子 Agent 树、当前会话 Token 与费用明细。

---

## 5. 移动端 (`apps/android`) 重新设计与重构方案

针对 BlueStacks ADB 实测暴露的“顶栏拥挤、控制层堆叠、缺少 L0 主对话与按 Harness 视图、单文件 1260+ 行难以维护”等问题，进行彻底的信息架构重塑与代码模块化。

### 5.1 移动端信息架构 (IA) 与页面布局重塑

#### A. 首页（`对话` Tab）垂直流重构（由 7 层精简为 4 层）
```text
┌──────────────────────────────────────────────────────────┐
│ [● kooyu]   [🟢 MacBook Pro ▾]          [🔔 2]  [＋ 新建] │  <- 1. 极简毛玻璃顶栏 (56.dp)
├──────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────────┐ │
│ │ 🔍 搜索会话、项目或工具记录…                   [归档] │ │  <- 2. 搜索与归档合一栏 (42.dp)
│ └──────────────────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ ✦ Kooyu 主对话                         ● 就绪  刚刚  │ │  <- 3. L0 置顶主控卡 (Pinned)
│ │   统筹本机所有项目、定时任务与全局记忆的智能中枢      │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                          │
│  [       按项目分组       |       按 Harness       ]     │  <- 4. 滑动弹簧分段切换器 (36.dp)
│                                                          │
│  ▼ 平台验收演示项目 (E:/sh/Coding/agent-harness)    [+]  │  <- 5. iOS Inset Grouped 分组容器
│  ┌────────────────────────────────────────────────────┐  │
│  │▌[CC] 桌面与移动端前端重构方案          14:20       │  │     - 左侧 3.dp 珊瑚指示条 (最近活跃)
│  │▌     ● 运行中 · claude-sonnet-4-5 · 正在写入文档   │  │     - 支持左滑 [归档] / [删除]
│  ├────────────────────────────────────────────────────┤  │
│  │ [CX] 修复 ACP 适配器超时问题           昨天        │  │
│  │      ● 已完成 · gpt-5-codex · 3 个文件变更         │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│       ╭──────────────────────────────────────────╮       │
│       │  💬 对话    📊 用量    🧩 来源    ⚙️ 设置  │       │  <- 6. 底部悬浮毛玻璃胶囊导航 (62.dp)
│       ╰──────────────────────────────────────────╯       │
└──────────────────────────────────────────────────────────┘
```

1. **顶栏瘦身与连接状态融合**：
   - 移除独立的“刷新”图标按钮，改为原生的 **下拉刷新 (`PullToRefreshBox`)**，下拉时触发珊瑚色旋转指示器与轻触觉反馈。
   - 将原先占满屏幕的“电脑未连接”红框横幅，融合进顶栏中间的 **设备状态胶囊**：
     - 在线时：`[🟢 桌面端已连接 ▾]`（翠绿点 + 主机名）。
     - 离线时：`[🟠 离线 · 点击重连 ▾]`（琥珀色脉冲点，点击弹出配对/重连 BottomSheet，不再挤压首屏会话列表）。
2. **L0 置顶 `Kooyu 主对话` 专属卡片**：
   - 始终置顶于分组列表上方，拥有珊瑚色微光描边 (`brandCoral.copy(alpha = 0.28f)`) 与星芒图标，确保移动端与桌面端拥有完全一致的 L0 指挥官入口。
3. **双视图弹簧分段器 (`按项目分组 | 按 Harness`)**：
   - **按项目分组**：以项目名作为折叠组头，右侧附带快捷 `[+]` 在该项目下直接新建会话。
   - **按 Harness 分组**：按 `Claude Code`、`Codex`、`Gemini`、`Kimi`、`OpenCode` 等引擎聚合所有会话，每个分组头展示引擎专属彩色徽标 (`HARNESS_VISUALS`) 与活跃会话数。
4. **iOS Inset Grouped 会话卡片与手势**：
   - 同组会话合并在一个 `RoundedCornerShape(16.dp)` 的 `raised` 容器内，行与行之间使用缩进 `52.dp` 的 `0.5.dp` `borderSubtle` 细线分割，彻底告别原先每个会话一个厚边框大卡片的臃肿感。
   - 引入 `SwipeToDismissBox`：左滑露出 `[归档]`（琥珀色）与 `[删除]`（珊瑚红），右滑快速切换 `[置顶/标记]`。

#### B. 新建会话与内联起草台 (`DraftWorkspaceSheet` / 空会话态)
- 点击 `+ 新建` 不再只是生硬弹出引擎列表并立即创建空记录，而是展开 **新建会话起草卡 (Draft Workspace)**：
  - 顶部快速选择 **所属项目目录** + **Harness 引擎横向滑动胶囊栏**（带彩色徽标）+ **模型与权限模式**。
  - 下方直接聚焦输入框，并提供 3 个快捷启动 Prompt 胶囊（如 `审查当前 Git 改动`、`运行测试并修复错误`、`分析项目架构`），用户输入第一句话点击发送时才真正创建并流式进入会话，与桌面端 `DraftWorkspace` 体验 100% 同步。

#### C. 会话详情页 (`ConversationScreen`) 深度打磨
1. **顶栏 (`ConversationTopBar`)**：
   - 左侧返回按钮 + 中部双行信息（主标题：会话名称；副标题：`[Harness 徽标] · [状态点+文字] · [项目短路径]`）+ 右侧 `[分支/历史]` 与 `[检查器 ⓘ]` 按钮。
   - 支持系统预测性返回手势 (`BackHandler` / Predictive Back)。
2. **对话流 (`TranscriptLazyColumn`)**：
   - **用户气泡**：右对齐，`RoundedCornerShape(20.dp, 20.dp, 6.dp, 20.dp)`，使用温暖的 `bubble` 底色，长按弹出支持 `[复制全文]`、`[从此处分叉 (Fork)]`、`[编辑重发]` 的浮动菜单。
   - **AI 响应流**：左对齐无外框纸面排版，顶部带紧凑的 `[Harness 徽标 + 模型名 + 耗时]` 头栏。
   - **思考块 (`ReasoningCard`) 与工具链 (`ToolGroupCard`)**：使用 `sunken` 底色与 `12.dp` 圆角，展开/收起全面绑定 `springBase` 动画；长代码输出支持横向滚动与一键复制。
   - **智能回到底部悬浮球 (`JumpToBottomFab`)**：当用户向上翻阅历史消息超过 `240.dp` 时，右下角以 `scaleIn(springSnap)` 浮现带未读/流式指示的回到底部胶囊按钮。
3. **底部一体化 Composer (`MobileComposer`)**：
   - 第一行（水平可滚动胶囊条）：`[Harness/模型切换]` · `[思考强度: 高]` · `[权限: 自动/询问]` · `[➕ 附件/图片]`。
   - 第二行（圆角输入舱）：自适应多行输入框（1~6 行平滑增高 `animateContentSize(springSnap)`）+ 右侧形态变换发送/停止按钮。
4. **会话详情检查器 (`SessionInspectorSheet`)**：
   - 点击顶栏 `[ⓘ]` 弹出 `88%` 屏幕高度的 `ModalBottomSheet`，内含 3 个分段 Tab：`概览与参数`（调整温度、推理强度、权限、工作目录）、`文件变更与工具`、`消息分支 (Branches)`。

### 5.2 Android 端代码模块化重构蓝图

将当前超过 `1,260` 行的 `MainActivity.kt` 按职责拆分为清晰的 Compose 组件包结构：

```text
apps/android/app/src/main/java/app/kooyu/android/
├── MainActivity.kt                  # 仅保留 Activity 入口、权限请求与顶层 KooyuApp 挂载 (< 150 行)
├── Workbench.kt                     # ViewModel 与后端 API / SSE 状态同步
├── Models.kt                        # 数据模型定义
├── ui/
│   ├── theme/
│   │   ├── Theme.kt                 # 对齐 Warm Daylight / Obsidian Carbon 的 KooyuColors 与排版
│   │   └── Motion.kt                # [新增] 统一定义 SpringSnap, SpringBase, SpringPanel 与 kooyuPressable 修饰符
│   ├── components/
│   │   ├── SegmentedControl.kt      # [新增] 带物理滑动滑块的通用分段控制器
│   │   ├── StatusBadge.kt           # [新增] 遵循“状态必有文字”的脉冲状态胶囊与 Harness 徽标
│   │   └── GlassBars.kt             # [新增] 顶部毛玻璃导航栏与底部悬浮胶囊 Dock
│   ├── home/
│   │   ├── HomeScreen.kt            # [重构] 对话首页（下拉刷新 + 搜索栏 + L0 主对话卡 + 分段列表）
│   │   ├── SessionGroupCard.kt      # [新增] iOS Inset Grouped 会话分组容器与左滑手势行
│   │   └── DraftSessionSheet.kt     # [新增] 一体化新建会话与快速起草 BottomSheet
│   ├── conversation/
│   │   ├── ConversationScreen.kt    # [重构] 会话主界面、预测返回、回到底部悬浮球
│   │   ├── ChatTranscript.kt        # 消息流、Reasoning 弹簧折叠块、Tool 调用卡片与 Diff 渲染
│   │   ├── MobileComposer.kt        # [新增] 多模态底部输入舱与参数胶囊栏
│   │   └── InspectorSheet.kt        # [新增] 88% 高度的会话上下文/参数/分支检查器 Sheet
│   └── screens/
│       ├── UsageScreen.kt           # [拆分] 用量与成本可视化页
│       ├── ProvidersScreen.kt       # [拆分] 模型来源与 Harness 状态管理页
│       └── SettingsScreen.kt        # [拆分] 主题（浅色/深色/跟随系统）、设备配对、全局记忆与定时任务页
```

---

## 6. 分阶段实施路线图 (Implementation Roadmap)

为确保重构过程零回归、可随时验证，按以下 4 个阶段推进：

### Phase 1：统一设计 Token 与物理动画底座（双端同步）
1. **Desktop**：整理 `craft-tokens.css` 与 `app.css`，统一浅色 Warm Daylight (`#F3EFEA` / `#FFFFFF` / `#E6533C`) 与深色 Obsidian Carbon (`#0D0E11` / `#14161B` / `#F17561`) 变量，消除 `app.css` 尾部的冲突覆盖。
2. **Android**：升级 `Theme.kt`（默认支持 `system` / `light` / `dark` 切换，校准 `LightKooyu` 与 `DarkKooyu` 色板），新建 `ui/theme/Motion.kt` 封装 `SpringSnap`、`SpringBase`、`SpringPanel` 及带触觉反馈的 `Modifier.kooyuPressable()`。

### Phase 2：移动端首页 IA 重构与代码解耦 (`apps/android`)
1. 创建 `SegmentedControl.kt`（滑动弹簧滑块）与 `SessionGroupCard.kt`（iOS Inset Grouped 分组容器 + `3.dp` 珊瑚选中条）。
2. 重构首页 `SessionList`：精简顶栏、接入下拉刷新、融合离线重连胶囊、置顶 **L0 `Kooyu 主对话` 卡片**、新增 **`按项目 | 按 Harness`** 切换视图，并升级新建会话 `DraftSessionSheet`。
3. 将 `MainActivity.kt` 中的页面跳转动画从 `tween` 全面替换为 `SpringPanel` 物理推入/弹出动画。

### Phase 3：移动端对话流、Composer 与检查器体验对齐
1. 升级 `ConversationScreen` 与 `ChatTranscript.kt`：优化温暖珊瑚用户气泡、流式消息弹簧入场、思考过程与工具抽屉的 `SpringBase` 展开动画，以及“回到底部”悬浮胶囊。
2. 升级底部 `MobileComposer` 与 88% 高度的 `InspectorSheet`，实现模型参数、思考强度、消息分叉与工作目录检查的完整闭环。

### Phase 4：桌面端精致度打磨与双端联合验收
1. **Desktop**：为侧边栏分段切换器、L0 主对话卡、Composer 发送按钮形态变换及右侧检查器抽屉补齐 `--spring-snap` / `--spring-panel` 物理过渡。
2. **双端真机验收**：
   - 通过 Playwright / Electron 验证桌面端浅色与深色模式下的布局、交互与帧率。
   - 编译 Android APK 并通过 `adb -s 127.0.0.1:5555 install -r` 安装至 BlueStacks，使用 ADB 截图与 UI 树检查验证首页、按 Harness 切换、L0 主对话、会话流及深浅色主题的一致性。
