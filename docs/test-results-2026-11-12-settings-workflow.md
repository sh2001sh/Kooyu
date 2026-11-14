# 设置与引擎工作流验收

日期：2026-11-12。范围：设置分类、应用偏好、自动模型发现、模型参数与价格、引擎 Provider 路由、配置历史、Kodo/pi 隔离与安装管理。

## 自动化结果

- `npm run build`：通过 protocol、host、web 和 desktop 构建。Vite 提示主包超过 500 kB，构建成功。
- `npm run typecheck`：通过，包含 Host 测试类型检查。
- `npm run lint`：通过。
- `npm run test -w @kodo/host`：157 项通过，无失败。新增工作流覆盖自动发现失败保留与重试、Provider 内模型切换/单次重连/同原生身份恢复、运行中引导与排队、按已发送模型计价、历史修订冻结、参数更新的新会话继承、显式免费价格、个人指令首条附带、设置 CAS、独立 Kodo 默认值，以及安装切换/失败/恢复/目录穿越拒绝。
- UI 回归分批覆盖全部 34 项：安装发现/模型设置/新增设置工作流 17 项通过；Provider 3 项、草稿 3 项、搜索 2 项通过；工作台 9 项通过（其中两项更新折叠区域与新能力展示的选择器后单独重跑通过）。不是一次不中断的 34 项执行。
- 对比度修正后再次构建通过，新增设置工作流桌面与手机两项再次通过。

## 视觉检查

桌面 1440×960、手机 390×844 检查引擎总览和展开的 Provider 表单；无横向溢出。持久证据位于 `.impeccable/review/settings-{desktop,mobile}.png` 和 `settings-{desktop,mobile}-provider.png`。手机 Provider 文件有意呈现滚动到字段的局部状态，总览文件从内容顶部拍摄。

Impeccable 检测器对本次设置组件运行一次，返回 `[]`。独立视觉复核提出一项小字对比度修正，使用设置作用域的 `--text-tertiary: var(--text-secondary)` 加深分组标题、导航计数及占位文字，同时继承深色主题颜色。随后重新构建并重拍四份证据。相同审查者的 verdict 为 `ship`，该单项 finding 为 `resolved`；浅色画布和导航对比度分别为 7.13:1、6.66:1。该结论仅覆盖所列对比度修正，不表示所有设置页面或真实运行能力重新认证。记录见 `.impeccable/review/settings-review.md` 与 `.impeccable/review/settings-verdict.md`。

## 设计记录

最终修正后由独立 documenter 完成窄范围合并：`apps/web/DESIGN.md` 的 Settings 指导与 `apps/web/.impeccable/design.json` 的 `extensions.componentBehaviors.settings`。记录主题继承、分组导航、原生折叠、Provider/模型路由、响应式、反馈及减少动态效果。移动端 44px 规则仅适用于安装、引擎保存与 Provider 表单行动，导航 pills 保留实际 34px。已回读文档并解析 sidecar；其余既有设计内容保留。

## 证据边界

模型接口为明确的本地合成元数据；原生连接和安装包边界使用隔离 fixture。没有使用真实密钥发起推理，没有把测试包安装视为真正的引擎下载/升级，也没有宣称所有外部引擎的原生能力已运行验收。应用未主动改写用户原生配置。
