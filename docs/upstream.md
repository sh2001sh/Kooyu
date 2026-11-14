# pi 上游基线

核对日期：2026-11-10。

产品主 agent 名称为 **Kodo**，采用独立 kodo 身份；本文件中的 pi 是底层 SDK/原生 agent loop 的上游名称。另有独立 pi harness，提供自己的直接聊天入口、基础工具、会话与配置。

| 项目 | 固定值 |
| --- | --- |
| 原仓库地址 | https://github.com/badlogic/pi-mono.git |
| 当前上游地址 | https://github.com/earendil-works/pi.git |
| 本地源码 | `vendor/pi` |
| 引入方式 | Git submodule，提交固定在父仓库索引中 |
| 提交 | `058496badc9aec0479058311988c5f134325c2f5` |
| 上游提交日期 | 2026-11-10 |
| `git describe` | `v1.5.2-7-g058496bad` |
| 三个核心包的 manifest 版本 | `1.5.2` |
| Node 要求 | `>=22.19.0` |
| 上游许可证 | MIT，见 `vendor/pi/LICENSE` |

这是拉取时的 main 提交，位于 v1.5.2 标签之后；不能把 npm 发布的 1.5.2 当作与该源码提交完全一致的构建。运行依赖已选择 npm 发布版 1.5.2，通过根锁文件固定；未在 vendor/pi 中安装或构建上游工程。产品已真实调用 SDK 并验证 SessionManager 恢复、settled，以及六个产品工具创建 Codex/发送/持久事件唤醒/读取/停止的闭环。

## 选用的集成层

| 包 | 用途 | 产品侧处理 |
| --- | --- | --- |
| `@earendil-works/pi-coding-agent` | 会话、工具、持久化、压缩、扩展和事件 | 通过 SDK 嵌入 host 进程 |
| `@earendil-works/pi-agent-core` | 模型与工具调用循环 | 复用上层 SDK 的实现，不另写循环 |
| `@earendil-works/pi-ai` | 模型和 provider 接口 | 复用上层运行时，并配置产品自有 绑定 |

本次检出的包名已经是 `@earendil-works/*`，设计不能继续沿用历史示例中的旧包名前缀。`vendor/pi` 保持上游原样；桌面业务、适配器和产品数据放在子模块外。

首个实现版本优先选已验证的稳定发布版本，并记录与本源码基线的差异；如果需要本提交新增接口，则从本固定提交构建并锁定构建产物。两种方式择一落地，避免运行依赖版本与参考源码悄悄分叉。

## 已核对的接口事实

- SDK 的 `createAgentSession()` 提供完整 `AgentSession`；`SessionManager` 管理正式会话上下文及分支。
- SDK 可以指定 `tools`、`customTools`、`resourceLoader` 和 `modelRuntime`，适合只装配需要的能力。
- `prompt()`、`steer()`、`followUp()` 分别用于普通输入、当前运行中的引导和后续输入。
- `agent_end` 只表示一次底层 agent run 结束；自动恢复或排队输入可能继续执行。产品判断 pi 已完全停下应使用 `agent_settled`。
- 上游提供 read、write、edit、bash、powershell 等工具。Windows 可直接评估 PowerShell 工具，不必为调度引入额外 shell 层。
- SDK 会话不自动装配 CLI 的全部内置扩展，可显式选择需要的资源。
- 独立进程集成可以改用 RPC／`RpcClient`，但 TypeScript host 首选 SDK，先减少协议层。

依据：[SDK](../vendor/pi/packages/coding-agent/docs/sdk.md)、[RPC](../vendor/pi/packages/coding-agent/docs/rpc.md)、[工具定义](../vendor/pi/packages/coding-agent/src/core/tools/index.ts)、[agent core](../vendor/pi/packages/agent/README.md)。

## 更新上游

初始化使用 `git submodule update --init --recursive`。升级时先选择具体 release 或 commit，再检出该版本、验证适配器契约并更新父仓库的 gitlink 和本文记录；不让日常安装自动跟随上游 main。

根项目与上游各自保留许可证。修改上游时遵守其 `AGENTS.md`，普通产品开发不需要改动上游源码。

## 当前运行版本

Host 锁定 `@earendil-works/pi-coding-agent` / `pi-ai` 1.5.2，未从 main 子模块构建产物，不能声称等同于 `058496bad`。已验证所用 SessionManager、ModelRuntime、customTools、订阅和 agent_settled 接口在发布版存在；其余 tag 后改动未移植。产品不依赖 `.local/research`，vendor/pi 无本地修改。
