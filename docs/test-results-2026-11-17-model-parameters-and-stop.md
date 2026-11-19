# 模型参数显示与报错后停止修复

日期：2026-11-17。

## 问题与修复

1. Provider 模式生成输入框模型选项时只传递参数值，没有传递参数来源。界面要求值与来源同时存在，因此已配置参数仍显示“参数未确认”。现在从每个会话冻结的模型记录构造选项，保留对应模型的参数来源，不借用其他来源或后续目录修订。
2. 固定模型绑定的参数转换遗漏了价格来源；现在补全价格，以及通过思考档位映射配置得到的来源。零价格会正常显示。
3. Provider 默认模型条目此前可能展示 harness 原生默认模型作为副标题；现在展示绑定的默认模型及思考档位。
4. “停止并暂停托管”受全局 busy 状态控制。发送请求或其他请求挂起时，停止也被禁用。现在停止使用独立请求状态与重复点击保护，按钮仅在 Host 未连接或停止正在提交时禁用。
5. SDK 的一次模型请求失败后仍可能等待重试，`turn-ended` 不代表整个执行已结束。输入框在存在待处理执行时继续提供中断按钮；收到 `settled` 才结束该执行对应的等待提示。错误事件不再直接视为正常空闲。
6. 原生执行已确认结束时，后端暂停托管不再尝试取消不存在的活动回合；SDK 在重试间隙收到取消后，最终结果记录为 cancelled。

## 验证

- 完整构建通过：protocol、platform、Host、Web、desktop。
- Host 针对性测试：87 项全部通过（providers、reliability、sdk-lifecycle）。覆盖冻结参数、来源、零价格、错误后发送未结束时停止、重试间隙取消和停止幂等。
- Web 回归：共 25 项通过。最终修改后重新运行 first-message 与 model-provenance-and-stop 共 12 项，全部通过；model-settings 的 13 项也已通过。
- 桌面 1440px 与移动 390px 均验证固定绑定和 Provider 模式参数、错误后中断与暂停、结束后移除等待提示、重复点击保护。慢速发送请求尚未返回时仍能提交停止。
- 修改文件的 ESLint 与格式检查通过。打包桌面启动、独立 Host、首次引导、图标、关闭重开、会话复用检查通过。
- 测试使用隔离 Host 和合成模型事件，不调用付费模型。移动界面使用浏览器尺寸回归，本次没有重新执行 Android 模拟器测试。

## 本机安装更新

已更新 `D:/Program Files/Kooyu` 安装中的 Host 代码与 Web 静态资源，并重启加载。

更新前先通过原 Host 停止接口暂停用户报错后挂起的 pi 会话。接口返回 paused，随后收到原生执行结束，挂起的发送命令变为 confirmed。没有重新递送消息。

数据库和被替换文件备份：`.local/desktop-update-20261117-model-stop/`。更新前后核对 Host ID、已有会话 ID、nativeSessionId、绑定 ID 和修订均一致。

安装后实际接口确认 `gemini-4-carbon` 的上下文为 1,048,576、最大输出 32,768、思考档位 low/medium/high，输入价格 $2、输出 $10、缓存读 $0.1，四类参数均带对应来源。实际页面核对等待指示器数量为 0，暂停按钮可用。

`Stream ended without finish_reason` 本身是模型流响应缺少结束标记的错误；本次修复它发生后的停止、重试取消及显示行为，没有将该模型调用标记为成功。

## 截图

- [本机安装后桌面参数](../output/playwright/model-stop-installed-desktop-20261117.png)
- [本机安装后移动尺寸参数](../output/playwright/model-stop-installed-mobile-20261117.png)
- [桌面报错后停止](../output/playwright/model-stop-20261117-final/model-provenance-and-stop--67b27-tch-stops-waiting-at-1440px/stopped-after-error-1440.png)
- [移动报错后停止](../output/playwright/model-stop-20261117-final/model-provenance-and-stop--f2553-atch-stops-waiting-at-390px/stopped-after-error-390.png)

打包测试记录：`.local/verification/packaged-1794885702872/report.json`。
