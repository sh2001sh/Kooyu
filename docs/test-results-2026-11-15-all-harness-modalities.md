# 全部 Harness 输入模态与思考档位检查

日期：2026-11-15（Asia/Shanghai）。本记录补充 `test-results-2026-11-15-composer-modalities.md`，不替代其移动端和前端验收记录。

## 发现与修复

- Provider 模型选项遗漏 `input`，Codex、OpenCode、DSH、ZCode 的部分原生目录声明也未传到 Host 模型选项，现已补齐。OpenCode 明确的 `capabilities.input.image: false` 优先于旧版 `modalities.input`，不会被同名目录记录重新打开。
- Codex、OpenCode、Claude、ACP、DSH、ZCode、Kimi Server 均在结构化图片发送前检查当前目标模型；协议不支持或已知仅文本时拒绝直接传图。正常 Host 附件流程仍会按运行时能力降级为文件引用，文件引用不等于模型直接看图。
- 模态解析复用已有 models.dev / 原生声明解析器。只有模型 ID、协议、完整 Base URL 能精确对应唯一已保存入口时，才应用该入口的手工覆盖；缺少路由身份时，不跨供应商套用覆盖。绑定仍使用冻结的模型参数。
- DeepSeek Harness：补充 `contentBlocks` 编码图片；模型切换重建运行时时完整转发附件。原生 profile 的解析结果写入 Host 自己的临时配置 overlay，原 profile 不变。
- ZCode：补充 V4 附件 begin/chunk/commit/abort 事务；每块最多 512 KiB，每图最多 20 MiB，校验 SHA-256，提交成功得到引用后才发 `sendText`。保留个人配置的 `inputFormat.supportsImage`。
- Kimi Server：读取原生目录 `capabilities.image_in`，按原生协议发送 `image.source = {kind: base64, media_type, data}`，没有误用 SDK 内部的 `image_url` 格式。
- Claude 原生自定义入口：不再因为存在 `ANTHROPIC_BASE_URL` 就一律禁止图片；可解析明确模型及入口的模态。损坏、冲突的原生设置仍保守处理。
- OpenCode：没有显式指定模型时，读取原生 `/config.model`；图片发送显式固定这个已检查的模型。无法确定实际默认模型时不猜测。
- ACP（Gemini / Cursor / Kimi legacy / Grok）：同时受 `promptCapabilities.image` 和模型/绑定限制；模型参数不能越过协议上限。
- Gemini Google→Chat、Claude Messages→Chat 网关仍只实现文本和工具转换，不能因模型声明支持图片就放行。这是当前转换器能力边界。
- Kimi Server 思考档位：显式档位先按原生目录校验；`max → 默认` 时显式恢复原生初始值或目录 `default_effort`。无法确认默认值时明确要求选择档位，避免静默沿用上次设置。原生 `off` / `on` 与 `always_thinking` 按能力分别处理。

## 检查矩阵

| Harness | 图片路径 | 档位检查与证据 |
| --- | --- | --- |
| Kooyu 内核（kodo） | pi SDK 结构化图片，沿用上一轮修复 | 本轮完整回归包含真实 SDK stub 的参数、工具与设置恢复测试 |
| pi | 独立 SDK 实例，自动解析及精确入口覆盖 | 本轮完整回归复查；无收费模型调用 |
| Codex | `localImage.path`；原生 `inputModalities` 优先 | app-server model/list 声明校验，turn/start 传 effort；协议 peer 验证 |
| Claude Code | SDK Messages base64 image blocks；自定义入口精确解析 | supportedModels 校验并传 SDK effort；SDK stub 验证 |
| DeepSeek Harness | SDK `contentBlocks` 编码图片，切换后附件不丢 | initialize/replacement 的 reasoningEffort；已有模型切换回归及新增图片回归 |
| ZCode | V4 分块上传后发 attachment refs | modelSelection.options.reasoningLevel；协议 peer 验证 |
| OpenCode | data URL file parts，固定已检查默认模型 | /provider variants 校验，prompt_async variant；协议 peer 验证 |
| Gemini | ACP image blocks；Google→Chat 网关禁用结构化图片 | set_config_option 后核对返回值；协议 peer 验证 |
| Cursor | ACP image blocks，受原生能力限制 | 原生 thought_level 协商；协议 peer 验证 |
| Kimi Code | Server API 原生 image blocks；旧入口另测 ACP | Server 显式传 thinking、恢复默认；Server fetch/WebSocket stub + ACP peer 验证 |
| Grok Build | ACP image blocks，受原生能力限制 | 原生 thought_level 协商；协议 peer 验证 |

## 验证结果

- Host 全量测试：417 / 417 通过，0 失败。日志：`.local/harness-modalities-tests-20261115.log`。
- Host 构建、生产代码和测试代码类型检查通过；本轮相关文件 ESLint 通过。
- 新增覆盖：全部 4 种 ACP 引擎有/无图片能力、仅文本绑定、图片绑定、切模型、网关；Codex 未声明时回退及明确仅文本拒绝；OpenCode 默认模型与纯图片；DSH 覆盖配置和重建运行时转发；ZCode 多块上传与提交顺序；Claude 自定义入口和网关；Kimi Server 图片 wire、`max → 默认` 和无效档位拒绝。
- 首次全量运行 416 / 417：既有身份测试只因工具注册顺序不同失败，工具集合一致。断言改为比较排序后的完整名单，仍检查缺失、额外和重复工具及 pi 实例隔离；最终全量通过。
- 本轮是协议/SDK stub 回归与已检出的原生协议源码核对，没有发送真实图片推理、收费模型调用，也没有重新构建或验收 Android/iOS。
- 思考档位决定请求参数，不能据此保证模型输出的可见思考字数或时长。实际服务是否执行该参数，需要上游响应或该服务的观测数据，不能仅凭界面文本长度判断。

## 部署状态

用户明确回复“允许本次重启 Host”后，确认 8 个会话全部 idle，并用 SQLite 在线备份保存至 `.local/preview/backups/all-harness-modalities-20261115-1794741730369/kodo.sqlite`，`integrity_check` 为 ok。

仅停止已核对的 4330 Host（旧 PID 33008），用原数据目录 `.local/preview` 启动已构建版本，新 PID **57696**。核验 `/api/health` 为 ok、协议版本 2，页面 `/` 和 `/api/provider-configuration` 均 200，8 个会话仍全部 idle。另对编译后的 Codex / OpenCode 模态解析函数执行断言并通过。启动日志只有 SQLite experimental 提示，没有启动错误。

未修改已冻结的会话绑定、重发结果未知的消息或创建生产测试回合；未停止 4357 的独立视觉测试 Host。
