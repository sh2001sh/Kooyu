# Windows D 盘安装验证：2026-11-13

结论：Kooyu 0.1.1 已实际安装到 `D:\Kooyu`，文件完整性、安装注册、快捷方式和安装后运行验证通过。

## 交付物

- 安装包：`D:\Kooyu-Installers\Kooyu-Setup-0.1.1.exe`。
- 大小：284,141,863 bytes。
- SHA-256：`cd8098e4f18a7bc3c36f39f34cb37987eeacbd61c373f77a0d1daa9c55014cc4`。
- Authenticode：`NotSigned`，本地开发测试包。
- 安装目录：`D:\Kooyu`。桌面和开始菜单的 Kooyu 快捷方式均指向 `D:\Kooyu\Kooyu.exe`。

## 根因与修改

工作区及其中生成的 EXE 继承了 `Low Mandatory Level`。从该路径启动的
安装器进程完整性 SID 为 `S-1-16-4096`，普通资源管理器为 `S-1-16-8192`。
安装器因此无法写入普通 D 盘目录，原 NSIS 7z 复制路径把写入失败误报为
“Kooyu 无法关闭”；改为 ZIP 仍失败，表现为 `Error opening output file(s)`。

对照探针验证：同一份 EXE 在工作区调用 `CreateFileW` 返回错误 5，
按字节导出到普通 D 盘目录后，SHA-256 不变，同一写入成功、错误码为 0。
实际 D 盘安装器进程完整性 SID 为 `S-1-16-8192`。

- 恢复 NSIS 默认压缩路径，不再把更换 ZIP 当作根因修复。
- `scripts/windows-installer.nsh` 在低完整性启动时提前给出明确目录提示；静默模式返回 5。
- `scripts/export-windows-installer.mjs` 在发布目录创建新文件并核对 SHA-256，避免继承工作区文件安全描述符；不覆盖既有文件。
- 清除桌面 staging 中不应发布的 `kooyu-relay` workspace junction。
- `scripts/verify-packaged-desktop.mjs` 支持新用户首次设置流程，显式点击“跳过引导”后再验证工作台，并在失败时保留截图。

## 实际验证

| 项目 | 结果 |
| --- | --- |
| electron-builder Windows x64 NSIS 构建 | 通过 |
| 低完整性探针 / 普通目录探针对照 | 分别返回 5 / 0，符合预期 |
| 实际构建包从工作区静默启动 | 提前诊断并返回 5 |
| D 盘导出包执行安装 | `/S /currentuser /D=D:\Kooyu`；完成文件、注册和快捷方式写入 |
| 安装文件逐个大小及 SHA-256 对比 | 29,871 个源文件全部一致，无缺失或差异 |
| 安装目录文件数 | 29,872，额外文件为卸载程序 |
| 卸载注册信息 | Kooyu 0.1.1；卸载程序位于 D 盘 |
| 安装后内置 Node | 24.13.0 / win32 / x64 |
| 原生窗口和首次设置 | 显示正常；跳过引导后进入工作台 |
| Host 连接与协议 | 通过 |
| 创建测试会话 | 通过，不发送模型请求 |
| 隐藏并重新显示窗口 | 通过 |
| 退出界面后 Host 保活 | 通过 |
| 重开应用复用 Host 和会话 | 通过 |
| 修改的验证及导出脚本 ESLint / Prettier | 通过 |

运行验证使用隔离 Host 数据目录及随机本地端口，结束后已清理测试进程。
既有 `D:\Program Files\Kodo` 保留。

本机完整安装观察约 9 分 34 秒，主要耗时在约 1 GB、近 3 万个依赖文件的
解包与复制。最初的 180 秒观察超时后安装器继续运行；重新附加监控未能
保留原始退出码，因此记录为 `null`，不声称已捕获退出码 0。安装完成结论
来自完整文件校验、注册信息、快捷方式及实际运行结果。

首次运行旧 smoke 脚本因首次设置向导遮住工作台入口而超时；修正测试流程
后重跑通过。没有为通过测试而跳过 Host 连接、会话持久化或文件校验。

## 证据

- 构建日志：`.local/windows-installer-final-build.log`。
- 安装记录：`.local/installer-diagnostics/final-install.json`。
- 文件校验：`.local/installer-diagnostics/installed-files.json`。
- 目录标签：`.local/installer-diagnostics/release-file-labels.txt`。
- 进程完整性：`.local/installer-diagnostics/process-integrity.json`。
- 运行报告：`.local/verification/packaged-1794569815711/report.json`。
- 运行截图：`.local/verification/packaged-1794569815711/desktop.png`。
- 构建和导出说明：`docs/windows-installation.md`。
