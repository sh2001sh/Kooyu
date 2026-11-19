# 消息操作、原位编辑与手动停止修复

日期：2026-11-17。

## 界面调整

- 用户消息的时间、复制和编辑操作移到消息气泡外侧、下方。
- 点击编辑直接在原消息位置显示文本编辑器，不再打开弹窗。支持取消、Escape、空内容校验和保存中的重复提交保护。保存失败时保留修改内容。
- 编辑沿用原有会话分支语义：修改后的内容进入新聊天草稿，由用户继续发送；不覆盖原生历史，不自动调用模型。编辑器明确说明此行为。
- Harness 回复的复制操作统一移到正文底部。原来只有一个分支动作的三点菜单改为直接显示“分支到新聊天”。
- 手机浏览器尺寸下操作可换行，点击区域至少 44px。
- 正常取消显示中性的“已停止”状态。
- 修复会话菜单在切换浏览器标签后，被延迟滚动事件意外关闭的问题：锚点未移动时保持菜单，实际移动或窗口尺寸变化时关闭。

## 后端修复

### 空闲会话删除

空闲会话不再因为结果未知的旧停止回执而无法本地删除。正在执行的命令、未知的发送/创建/交互命令和活动会话仍会阻止删除。源代码修复不改写命令审计，也不删除原生历史。

用户指定的原生会话 `01a1d580-a37c-7659-b5c2-2be6c46ca0d2` 对应本地 ID `17c00131-4044-40da-897f-423c035856fe`。运行中的旧 Host 尚未重启，因此通过现有对账接口处理了该实例：核对两条停止回执均为 `unconfirmed: native connection offline`，且最后一次执行为 completed、后续没有新发送，然后将这两条未送达的停止请求对账为 rejected，记录具体依据，再执行本地删除。

接口返回 `deleted-locally`、`nativeDeleted: false`，快照中已无该会话。删除前记录、结果及更新前数据库保存在 `.local/desktop-update-20261117-message-actions/`。

### Claude Code 手动取消

只有本地中断得到 SDK 确认，且结果属于已识别的取消信号时，才记录 cancelled。覆盖 SDK 的中断诊断、AbortError 和中断后的流结束；正常解析到的取消结果也会确认发送命令，避免继续显示未知发送失败。

真实执行错误、中断请求失败，以及没有本地中断时出现的相同诊断继续保留为错误。不会将未知的原生后台任务声称为已完成。原先已经保存的错误事件没有批量清除或重写。

## 验证结果

- 完整项目构建通过；菜单最终调整后重新构建 Web 通过。
- Host 针对性回归 93/93 通过：reliability、sdk-lifecycle、native-session-sync。
- Web 回归 15/15 通过：conversation-parity、search-navigation、model-provenance-and-stop。
- 1440px 与 390px 均验证操作位置、无编辑弹窗、取消编辑、失败后保留内容、保存新草稿、直接分支及停止状态。
- 修改的 TypeScript/TSX 文件通过 ESLint，`git diff --check` 通过。
- 打包桌面验证通过：首次引导、独立 Host、品牌图标、界面关闭重开、复用 Host 与会话。记录：`.local/verification/packaged-1794886872888/report.json`。最终菜单修复仅重新构建并更新了 Web 资源。
- 测试使用隔离 Host 与合成事件，没有发送付费模型请求。本次移动验证为浏览器尺寸测试，没有重新安装或验证 Android 原生 APK。

## 安装状态

已将 Web 与 Host 更新文件写入 `D:/Program Files/Kooyu/resources/host`，并核对 Host 关键文件及 Web 入口与构建结果一致。运行中的 Host 已在提供新的 Web 入口；当前打开的界面需要刷新才能加载。

Host 进程仍运行旧代码，后端修复需要下次启动 Host 才生效。用于停止并重启已安装进程的命令被自动审批以 `blocked by policy` 拒绝，未执行强制重启。此次前端更新和指定会话的本地删除已经完成。

## 截图

- [桌面消息操作](../output/playwright/message-actions-20261117-final/conversation-parity-messag-49948-nch-are-available-at-1440px/message-actions-1440.png)
- [桌面原位编辑](../output/playwright/message-actions-20261117-final/conversation-parity-messag-49948-nch-are-available-at-1440px/inline-edit-1440.png)
- [手机尺寸消息操作](../output/playwright/message-actions-20261117-final/conversation-parity-messag-c4774-anch-are-available-at-390px/message-actions-390.png)
- [手机尺寸原位编辑](../output/playwright/message-actions-20261117-final/conversation-parity-messag-c4774-anch-are-available-at-390px/inline-edit-390.png)
