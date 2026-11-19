# 文件预览、本轮编辑清单与 Harness 设置验收

日期：2026-11-17

## 文件查看与本轮改动

- 消息中的行内代码路径和明确的普通文件路径自动成为 Kooyu 内预览入口；原有 Markdown 链接继续可用。命令代码、代码块、外部网址保持原语义。
- 主对话和子代理页面共享文件预览与工作区变更入口，支持相对路径、带行号路径以及现有 Windows 路径解析。
- 每轮完成后，根据成功编辑工具记录显示“本轮编辑 N 个文件”，默认展示三个，可展开全部。点击文件打开预览，“查看变更”打开当前工作区差异。
- Read、失败调用、未确认完成的调用不计入编辑。按本轮事件归属统计，排除下一轮和重复 settled 通知；接入原生 fileChange、Write/Edit、apply_patch、ACP diff、OpenCode 与 Pi 形态。
- 原生报告 diff 时展示增删行；没有准确 diff 的文件不推测行数。命令执行中未提供明确文件编辑记录的改动不猜测归属，仍可在工作区变更面板查看。不提供未经实现和验证的撤销操作。
- 对当前生产会话只读验算，成功还原该轮创建的 `docs/frontend-design-and-refactoring-2026-11-17.md`。

## DeepSeek 与其他 Harness

- 将模型选择的路由编码集中到共享函数，补上 DeepSeek 的 provider，并避免对已经完整的路由重复添加 provider。新建与现有会话共用函数；固定绑定模型继续保持绑定模型身份。
- 11 个 Harness 检查覆盖：Kooyu、Pi、Codex、Claude Code、DeepSeek Harness、ZCode、OpenCode、Gemini、Cursor、Kimi Code、Grok Build。
- DeepSeek 增加原生默认、逐项审批、自动允许、拒绝需审批操作。协议 schema、Host 可选目录、草稿保存与现有会话控件同步。
- DeepSeek 运行时只对 `approval/request` 应用所选审批规则；问答请求继续交由用户处理。不是文件系统沙箱。测试确认同一原生会话在回合之间更改模式有效。

## 验证

- Core、Web 构建通过。
- Host 全量 499 项中 498 项首次通过；唯一失败是旧客户端契约仍断言 DeepSeek 不支持权限修改。更新该功能断言后，客户端契约 15/15 复验通过。新增编辑归属与 DSH 原生权限测试均通过。
- 界面回归 39/39：真实临时工作区 Markdown 预览、中文文件名、子代理预览、每轮清单、Read/失败排除、展开全部、变更入口、11 Harness 路由值、DSH/OpenCode/ZCode 草稿保存，以及已有模型/权限、首次发送、子代理导航、长工具滚动回归。
- 桌面、窄窗口截图批量检查后，修正文件列表文字居中的问题。两种宽度文件预览与清单 2/2 再验通过。
- 已修改文件 ESLint 与 `git diff --check` 通过。
- 日志：`.local/file-links-harness-{core,web,host,ui-final,contract-final}.log`、`.local/file-links-visual-final.log`。

## 更新准备与运行保护

- 已验证 Web 构建单独冻结在 `.local/file-links-harness-validated-web/`。同目录其他任务正在进行样式拆分，未将其未验收构建打入本轮更新。
- 完整准备包 `.local/desktop-update-20261117-file-links-harness/`，453 文件，包含安装前文件、SHA-256 manifest、生产快照与一致性 SQLite 备份。
- Web 准备版本：`index-Jh5GIywh.js`、`index-55417b0c109d.css`。布局确认后的窄修复同步于源码 `styles/workspace.css` 和冻结构建，并更新 CSS 内容标识。
- 延后更新入口仍为 `.local/apply-work-center-agents-final.ps1`，已指向本轮准备包。脚本检查活跃会话、在途命令、Host 身份、文件哈希，工作活跃时拒绝重启。之前脚本副本与所有备份保留。
- 用户此前要求保留运行任务。准备期间新 Pi 任务运行，随后 Claude 会话也开始新回合；截至准备完成，当前生产 Host PID 55512 保持运行，本轮包尚未安装。等确认任务结束且没有在途命令后再应用，无需重新询问更新许可。

## 后续安装完成（2026-11-18）

- 上述延后包的 Host/协议已合入 `.local/desktop-update-20261118-terminal-queue/`，连同新的失败结束状态修复完成安装。安装前确认空闲，安装后恢复接收请求，452 文件哈希一致，全部 7 个会话及原生会话 ID 保留。
- 当前 HTTP 已提供新 Web，DeepSeek 权限目录只读验证支持切换。既有桌面窗口需正常退出界面并重开。详细证据见 `test-results-2026-11-18-terminal-queue.md`。
