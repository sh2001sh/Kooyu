# Cursor、Gemini、Grok 与交互链路增补

后续的 ACP 发送竞态、OpenCode 待处理交互恢复、Kimi 交互与进程关闭见 [生命周期增补](test-results-2026-11-13-harness-lifecycle.md)。下文测试数量保留为本批次历史记录。

日期：2026-11-13。接续上一批 Harness 补齐，不重置仓库已有改动。本记录分别标注合成协议测试、真实原生进程检查和真实模型请求；通过其中一种不代表另外两种通过。

## 实现

| 范围 | 本轮改动 | 边界 |
| --- | --- | --- |
| Cursor | 优先独立 ACP session/list；分页、去重、工作目录匹配、重复游标检测、100 页 / 20,000 条 / 8 MiB 上限；旧版本保留本地元数据回退；本地路径防止逃逸 | 只有明确缺少 list 能力或首个 list 返回 -32601 才回退，鉴权、连接和数据损坏不伪装为空列表；不创建、加载或恢复会话 |
| Grok Build | 接入同一原生列表链路和受限的本地 summary 回退；新增真实 Grok 进程配合本地确定性模型的 Read 复现脚本 | 原生 Read 仍失败，详见下文；没有替换成 Host 自行读文件来冒充原生工具成功 |
| Gemini CLI | 未创建配置目录、项目映射或聊天目录时列表返回空；已有会话读不到仍报错；损坏映射和不安全路径继续拒绝 | 不把“新用户无历史”当作存储错误，也不吞掉真实损坏 |
| 全部 ACP 适配器 | 正常回合结束、下一轮开始、取消均更新审批代次；文件/终端请求在异步操作前后校验；Host 自动将已结束回合的 ACP 待审批项标记失效 | 不撤销其他协议中可能仍活动的子代理交互；不宣称通用 steer |
| Codex / Claude / OpenCode | 原生问题显示单选、多选、自定义回答；必答校验；Codex 私密文本使用密码输入；按各协议编码回答 | 未识别的结构继续提供 JSON，不推测 Kimi 或厂商私有问答格式 |
| Claude SDK | AskUserQuestion 的答案实际传入 updatedInput.answers；保留原问题，过滤额外字段；缺少答案或已中止时拒绝 | 普通工具授权不会接受客户端悄悄改写工具参数 |
| OpenCode | 权限请求提供允许本次 / 拒绝，发送 once / reject；取消问题调用原生 question/{id}/reject | 根据本机 /doc 的 V1 OpenAPI 验证；不外推 V2 表单能力 |
| 交互界面 | ACP 取消按钮、防重复提交、JSON 就地错误提示和输入保留；桌面与手机选项布局 | 保留现有界面样式和原生权限选项语义 |

## 验证

- Host：npm test，230 / 230 通过，日志 .local/harness-followup-tests.log。
- UI 专项：native-interactions.spec.ts、model-settings.spec.ts、desktop-installations.spec.ts，25 / 25 通过；包含桌面与 390px 手机视口的实际选择、输入、提交、取消。日志 .local/harness-followup-ui.log。
- UI 截图：.local/native-questions-desktop.png、.local/native-questions-mobile.png；完成一轮检查及一轮修正后的确认。
- 原生只读：npm run verify:harness-inspection，11 / 11 通过。Cursor 原生列表找到指定隔离测试会话，load 历史返回 5 条；Cursor / Grok / Kimi 的原生列表请求成功；四种 ACP initialize 成功；Codex / OpenCode 独立列表成功。零条列表本身不代表有历史数据，Cursor 的非空匹配另有单独断言。
- Typecheck、ESLint、完整构建均通过；改动文件的 Prettier 检查通过。最终日志为 .local/harness-followup-typecheck.log、.local/harness-followup-lint.log、.local/harness-followup-build.log。构建仍有既有的超过 500 kB 分包警告；Windows 默认临时目录出现 esbuild 文件锁后，使用工作区隔离临时目录完成构建。
- 本轮没有重跑并宣布整个旧 UI 套件通过；上一批旧导航等用例的失败记录仍然保留。

## Grok 尚未通过的真实链路

1. 已有 Provider 绑定 + 本机原生入口的真实 Read 请求没有返回文件标记内容；本次原生模型只返回了路径，没有完成工具验证。报告 .local/verification/provider-grok-build-tools-1794537398656/report.json。
2. 为排除模型是否主动调用工具的偶然性，新增 scripts/verify-grok-native-tools.mjs：启动真实 Grok，向本机 HTTP 模型夹具请求；模型夹具根据 Grok 提供的 read_file schema 发出 target_file 工具调用。工具读取的目标仅为新建隔离目录内的标记文件。
3. 确定性复现仍得到原生 status: failed，错误为 workspace session not found … call bind_local_session() first。默认路径和官方 --no-leader 路径都失败。最终默认路径报告 .local/verification/grok-native-tools-1794540036257/report.json；无 leader 路径报告 .local/verification/grok-native-tools-1794539735487/report.json。
4. 这说明当前原生安装的工作区绑定链路仍有故障；没有已确认的公开绑定方法可安全补调。仓库内的协议转换不能等同于修复该原生内部实现，不能将 Grok 全功能标记完成。诊断脚本在失败时返回非零状态。

复现命令（先构建 Host）：

    npm run build:core
    npm run verify:grok-native-tools
    npm run verify:grok-native-tools -- --no-leader

真实 Provider 验证也支持从已安装入口建立隔离配置：

    node scripts/verify-provider-configuration.mjs grok-build --tools --reopen --installed-runtime

后一个命令会通过既有授权 Provider 发送真实模型请求；前两个工具检查使用本地合成模型，不能算作真实模型质量或账户验收。

## 仍保留的能力限制

Cursor 自定义 Provider、通用 ACP 运行中 steer、外部活动会话接管、未声明的用量/额度接口和其他未确认的厂商私有能力，仍按原生证据标为不支持或未验证。Kimi 私有复杂问答仍可使用结构化 JSON。上一批 DSH / ZCode 等边界继续以各自记录为准，不将本轮公共链路完善写成所有上游功能已经支持。
