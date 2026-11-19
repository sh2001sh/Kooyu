# “最新消息”与桌面托盘图标修复验证

验证时间：2026-11-16 至 2026-11-17（Asia/Shanghai）。

## 修复结果

- 移除历史分页区域的“返回最新记录”按钮，使用输入框上方现有的“最新消息”按钮。
- 浏览历史分页或搜索快照时，底部按钮保持可用；点击后读取最新 300 条事件并返回实际最底部。
- 返回最新消息时清除旧阅读位置，避免恢复滚动位置覆盖主动跳转。
- 替换桌面托盘旧绿色 K 图标，使用正式珊瑚色 Kooyu 标识；窗口图标使用同一品牌。
- 桌面构建与打包前自动同步正式图标，避免资源再次遗漏。

## 验证

- Web 与桌面构建通过；完整核心构建通过。
- `search-navigation.spec.ts` 全部 5 项通过，包括搜索定位、跨标签会话删除、1440 / 390 像素历史分页与最新尾部跳转、思考内容隔离。
- 本次修改文件 ESLint 通过，`git diff --check` 通过。
- Electron 实际启动、托盘资源加载、关闭窗口保留 Host、重新显示窗口、退出界面保留 Host 验证通过。
- Windows 打包成功；打包程序独立资料目录中的启动、原品牌图标像素校验、再次启动复用 Host 与会话验证通过。
- 安装目录 `D:/Program Files/Kooyu` 的程序与应用资源已更新，文件哈希与验证版本一致；托盘 PNG 与正式品牌 32 像素 PNG 字节一致。
- 实际安装版本读取历史记录后，点击底部“最新消息”：距最底部为 -0.40 像素（滚动值小数取整），历史快照状态退出，顶部重复按钮不存在。

## 本机更新

当前旧 Host 缺少 `/api/notifications`、`/api/executors`，更新前确认全部 3 个会话空闲，并通过 SQLite 在线备份保存一致性数据库。更新后的 Host 两个接口均返回 HTTP 200，保留原 Host 身份及全部 3 个会话。

备份位于 `.local/desktop-update-20261116-latest/`，包括数据库、旧程序、旧应用资源与 Web 文件；安装目录的旧 Host 保存在 `D:/Program Files/Kooyu/resources/host-before-latest-20261116`。备份含本机私人数据，仅本地保留。

Windows 构建缓存曾返回访问被拒绝，改用现有本地 Electron 运行时及工作区构建缓存后成功。工作区内直接启动打包程序受本机运行环境影响，复制至独立 D 盘目录后完成实际验证。

## 截图与机器报告

[截图索引](../output/playwright/latest-and-tray-2026-11-16/index.html)

- `desktop-history-before.png`：实际安装版浏览历史时的底部按钮。
- `desktop-latest-after.png`：点击后的实际会话最底部。
- `regression-desktop.png`、`regression-narrow.png`：隔离回归数据中的完整最新回复。
- `tray.png`、`app.png`：从实际安装资源中提取并验证的正式图标。
- `electron-report.json`、`packaged-report.json`：Electron 与打包验证结果。

托盘图标完成资源一致性、运行时加载与安装更新验证；本次未保存 Windows 通知区域的截图。
