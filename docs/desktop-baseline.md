# Desktop baseline 决策

日期：2026-11-10。状态：按用户确认的 baseline 提取了固定提交的语义 tokens 和 Spinner；React 工作台、桌面/手机视口已构建并验证。许可、NOTICE、TRADEMARK 与具体范围见 [EXTRACTION](../third-party/craft-agents/EXTRACTION.md)。Electron 生命周期仍受本机环境缺陷（继承 ELECTRON_RUN_AS_NODE=1、GPU 初始化 0xC0000005）阻塞；已清理变量并提供软件渲染回退，当前探针仍失败，待实机验收，见 [实现状态](implementation-status.md)。

## 选择

选择 [Craft Agents](https://github.com/craft-ai-agents/craft-agents-oss/tree/1627c43e93bb4f5b1532116b8eb092c0ada4b23f) 的 **设计 tokens、选定聊天组件和布局**作为可修改的 UI baseline。应用保持 Electron + React + TypeScript；后台使用本项目的 Node Session Host 与基于 pi SDK 的 Kodo 内核。选择范围是实际可复用的 UI 源码及视觉规则，不是只找一张灵感图，也不是把 Craft 的整个产品 fork 进来。

用户已确认选定视觉方案。已完成最小提取验证；AppShell/ChatDisplay 连带业务状态较大，实际采用 tokens 与 Spinner，聊天 TurnCard 和产品外壳在本仓库轻量实现。

## 候选对照

| 候选 | 界面与复用优势 | 对本任务的主要成本 | 结论 |
| --- | --- | --- | --- |
| Craft Agents | Electron/React、安静的三栏结构、精细的语义颜色与消息呈现；已有 pi 接入经验 | AppShell/ChatDisplay 与业务状态耦合，需拆除原业务依赖 | **UI 主 baseline** |
| Codeg | 浅色工作区清晰，多 harness、移动端、原生历史高度贴合需求 | Tauri/Rust 宿主加 Node/pi；范围包含大量 IDE 与协作功能 | 接入参考、UI 备选 |
| Harnss | 多 harness 引擎与工具展示已有实现，Electron/React 可复用 | 生命周期不满足后台要求，项目早期重写风险 | adapter 参考 |
| bb | Web UI 与执行宿主分开，多端语义清晰 | 平台业务范围大，上游截图更偏深色 IDE 多面板 | 宿主架构主参考 |
| Pebrel | GPUI 原生终端、窗口驻留交互 | Rust/GPUI，与 React 手机界面无法直接共用，GPL 代码引入需单独处理 | 终端体验参考 |

已查看 Craft、Codeg、Harnss、bb 的上游截图，并结合源码做判断；未运行应用。Craft 的宣传截图未绑定明确源码版本，因此只支持整体视觉选择，不证明检出版本每个像素相同。Codeg 截图对应检出仓库中的 `docs/images/workspace-light.png`。

视觉依据：[Craft 上游界面截图](https://github.com/user-attachments/assets/3f1f2fe8-7cf6-4487-99ff-76f6c8c0a3fb)、[Codeg 固定提交的浅色工作区](https://github.com/spacering-net/codeg/blob/da2354235b67d04e94d1009781dee58516a4bd04/docs/images/workspace-light.png)。二者均为参考项目界面，不是本项目产物。

## 可提取范围

以下路径相对于 Craft 固定提交：

| 来源 | 拟复用方式 | 需要替换/验证的部分 |
| --- | --- | --- |
| `packages/ui/src/styles/tokens.css` | 表面、文本、边界、状态与动效 tokens 的起点 | 调整品牌色、确认暗色对比度和 Windows 字体 |
| `packages/ui/src/components/chat/TurnCard.tsx` | 可折叠消息、工具结果的表现组件 | 转接本项目 timeline view model，去除原 backend 专用类型 |
| `packages/ui/src/components/markdown/` | Markdown/代码显示能力 | 检查依赖与资源加载边界，再选择最小子集 |
| `apps/electron/src/renderer/components/app-shell/AppShell.tsx` | 三栏布局、分隔与导航交互参考 | 重建轻量 shell；不整体复制约 2,900 行业务容器 |
| 同目录 `SessionList.tsx`、`ChatDisplay.tsx` | 会话列表、输入与滚动行为参考 | 改接统一 host 协议，逐项拆除业务 contexts/Jotai 原子依赖 |

`SessionViewer.tsx` 仅适合只读展示，不承担交互式聊天。Craft 的 backend factory、服务端 SessionManager、自动化、sources 和商业集成不在提取范围。核心运行时不能因为 UI 复用而变成另一套主模型循环。

Craft 使用 Bun monorepo；选择其 UI 不意味着整套构建配置可以原样迁入 Node host 工程。实施时核对 React、样式、图标和 Markdown 依赖版本，并为提取组件建立独立依赖清单。

## 产品界面

默认桌面为三个区域：左侧导航，中间会话列表，右侧对话。窄窗口可折叠列表；文件/终端/改动详情仅按需打开，避免默认四五个面板。

- 导航：全局主对话、待处理、全部会话、未归属与项目；正在运行和已启用托管可固定为筛选入口；底部 Harness 与配置、用量、设置。
- 会话列表：默认项目 → 会话，项目主对话单独分组；harness 以标签/筛选显示，可选按 harness 分组。每行包含标题、最近活动、真实运行状态和必要的托管标记。
- 对话顶部：归属项目或全局主对话范围、实际工作位置、harness 与配置；运行、连接和托管状态分开展示。
- 输入区：消息、附件及当前 harness 支持的模型选项。支持时才出现 steer；发送回执和运行完成分别展示。
- 对话侧栏：管理目标、所属项目、监控模式、最近唤醒原因、暂停/撤销托管；关联卡片链接到真实会话。运行时间线与成果/diff 按需展开。
- 用量页：harness/绑定/模型/时间筛选，区分真实金额、估算费用、产品预算、供应商额度。

新建会话时，[首轮清单](harness-catalog.md)中的 10 种 harness 同级可选，支持搜索与最近使用，避免把所有选项常驻铺满输入区。Kodo 是独立列出的内置主 agent，pi 作为直接聊天的原生 harness 单独列出；界面不强迫所有消息先发给“总指挥”。输入区显示原生能力限制，而不隐藏其他 harness 的入口。

全局主对话不属于项目，可按目标创建多个；项目主对话属于一个项目，需要时才创建。管理目标始终留在自己的项目中，一个目标同时最多有一个自动续聊控制者。主对话显示简短事件与目标引用，长输出由用户或模型按需打开。具体层级、布局和创建流程以 [会话模型](session-model.md) 为准。

手机复用相同 view model：主对话/项目等范围 → 会话列表 → 对话单页，监控/配置放进详情页；消息、原生交互、停止和暂停托管始终可达。收件箱处理状态与桌面同步。配对后访问同一个 host；手机断线不会停止桌面执行。

## 苹果风格的具体约束

用中性色层级、轻边界、稳定间距和可读排版形成秩序；少量强调色表达选择与动作。采用系统字体栈，在 macOS 使用系统字体，在 Windows 使用系统 UI 字体；不打包 Apple 专有字体。标题栏与窗口按钮遵循所在系统，不在 Windows 画一套假的 macOS 控件。

视觉状态不能只依靠颜色；运行、等待输入、失联与已暂停均有文字。支持键盘导航、清晰焦点、减弱动效、高对比及大字号。长工具输出默认折叠，但可完整查看、选择和复制。新会话空态以选择 harness 和发送消息为主，不预装一屏工作流模板。

## 实现阶段的最小验证

1. 固定 Craft 提交，建立提取清单，保存原许可证、NOTICE 与修改记录；替换 Craft 名称、logo、bundle ID 等品牌标识。
2. 只导入 tokens、必要基础组件、Markdown 和一张消息卡片，接入明确标注的演示数据；核对依赖闭包，避免带入整个业务后端。
3. 构建轻量 shell 和统一会话 view model，再接真实 Session Host。桌面与手机从同一投影渲染；产品源数据不依附 UI store。
4. 验证长历史、流式输出、工具交互、停止、断线重连及 Windows/macOS 窗口行为；组件验证通过后才扩大提取范围。

Apache-2.0 允许按其条款复用源码；Craft 另有 `NOTICE` 与 `TRADEMARK.md`，代码许可不意味着可沿用品牌。具体第三方资产逐项核对。已提取的 tokens/Spinner 及修改说明见 [EXTRACTION](../third-party/craft-agents/EXTRACTION.md)，其余业务组件为本仓库实现。

源码版本与证据见 [清单](research-sources.json)，宿主结构与实施顺序见 [设计方案](design.md)。
