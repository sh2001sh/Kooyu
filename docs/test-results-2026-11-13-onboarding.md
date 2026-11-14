# 首次启动引导验收记录（2026-11-13）

## 交付范围

实现本机首次启动三步引导：可选连接主 Agent API、准备原生 Harness、回顾后进入工作台。沿用 Kooyu 现有品牌、Provider 配置、系统凭据库及 EngineManager 接口。

- 全程提供「跳过引导」，不要求 API、模型绑定或安装任何引擎。
- 第一步首屏提供「跳过 API，先准备引擎」；手机端也能直接看到。
- 无主 Agent 绑定也能完成引导；回顾页明确标注未配置。原生引擎继续使用自己的账号与配置。
- API 保存支持已有来源、新增来源、接口格式、密钥显隐、模型发现、发现失败重试及手动填写模型。未知能力参数由用户确认，不猜默认值。
- Harness 列表检测安装状态；托管引擎仅在点击后安装，可显示进度、失败与重试，其他引擎提供原生说明入口。不会批量下载安装。
- 引导元数据保存在 Host SQLite，记录版本、修订、步骤、状态和更新时间；不含表单与密钥。检查点重载后继续，已有数据的安装不强制弹出。
- 可从「设置 → 通用 → 打开设置引导」返回；远程配对客户端不展示本机安装引导。

## 自动验证

| 验证 | 结果 | 范围 |
| --- | --- | --- |
| npm run build | 通过 | Protocol、Platform、Host、Web、Desktop 构建 |
| npm run typecheck | 通过 | 工作区类型检查 |
| npm run lint | 通过 | 当前工作区 ESLint |
| npm test | 324 / 324 通过 | Host 全部测试，含新增 3 项引导状态测试 |
| npm run test:ui -- onboarding.spec.ts native-interactions.spec.ts subagents.spec.ts | 20 / 20 通过 | 6 项引导、12 项原生交互、2 项子代理界面回归 |
| 新增引导文件 Prettier 检查 | 通过 | 引导组件、样式、协议、Host 状态与测试配置 |

引导专项覆盖：整段跳过与重开；跳过 API、恢复到 Harness 步骤及无绑定完成；桌面和手机 API 保存与默认模型绑定；发现失败后保留来源、手动模型参数；安装必须显式点击及失败重试。Host 测试覆盖首次状态固定、旧数据判定、重启持久化、修订冲突、跳过保留配置、无 API 完成及拒绝密钥等额外字段。

配置与绑定测试使用真实 Host API 和隔离数据库，模型目录由本机 HTTP 测试服务返回；断言上游请求全部是读取 models 的 GET，不发送推理消息。安装专项模拟管理与安装接口，不下载或更新本机引擎。其他界面专项使用其原有测试夹具，不代表真实账户验收。

日志位于 .local/onboarding-build.log、.local/onboarding-typecheck.log、.local/onboarding-lint.log、.local/onboarding-host-tests.log、.local/onboarding-ui.log。

## 视觉与边界

检查了 1440×960 桌面和 390×844 手机截图；修正了 API 跳过入口位置和切换步骤时的滚动位置。页面无横向溢出，使用键盘焦点样式及减少动态效果设置。截图位于 .local/verification/onboarding/。

本次没有运行完整 UI 套件、安装包首次启动真机验收、真实付费模型推理、实际引擎下载安装或逐家真实账号登录。模型目录可读不等于推理可用，程序可启动不等于账号已登录。此记录只确认本次引导实现与列明的测试，不能据此标记「所有 Harness 全功能完成」。

设计说明见 [首次启动引导](./first-launch-onboarding.md)。
