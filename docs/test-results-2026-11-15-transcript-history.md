# 历史分页与思考内容分离回归

日期：2026-11-15。范围：桌面端共用的 Web 会话界面及其窄屏布局。

## 原因与修复

- 加载“更早记录”原先直接替换当前事件列表，导致最新回复被移出列表；滑到底只能看到旧页末尾，流式内容也可能停在半条回复。现在按 sequence 去重并向前追加历史，保留已加载记录；使用可见消息正文的 DOM 坐标保持阅读位置，避免追加后跳动。
- 历史模式的“最新消息”原先只滚动到旧页底部。现在与“返回最新记录”一样重新请求最新记录，再恢复跟随底部。搜索定位时禁止自动跟底覆盖定位。
- 调整消息容器的 flex 收缩和滚动锚定，避免长内容的滚动高度不正确。
- 展示层原先仅识别部分 thought/reasoning 标记，analysis 通道、原生 thinking 内容和正文开头的 `<analysis>` 等包裹可能被当作正式正文。现在统一分离这些内容，放入可折叠的思考区；流式标签拆片不会闪入正式答案。用户消息、正文中间的字面标签及代码示例保留原样。
- 分离只影响显示及正式答案的复制内容，不重写已存储消息或后续模型上下文。该解析也用于子代理输出。

## 验证结果

- Protocol 构建、Web 类型检查及生产构建通过。
- 本轮相关 TypeScript / TSX 文件的 ESLint 通过。
- 内容解析单元测试 3 / 3 通过，覆盖通道、原生内容块、嵌套 payload、reasoning_content、流式标签前缀及字面示例。
- Playwright 界面回归 7 / 7 通过：搜索定位、跨标签页删除同步、1440px / 390px 的连续历史分页及长回复、analysis 分离、桌面 / 窄屏的子代理输出。
- 分页场景初始加载 300 条，连续追加至 600 / 900 条；正文阅读锚点偏差小于 8px，35 段长回复的末尾标记完整可见。历史模式返回最新消息时确认发起 tail 请求，显示后来新增的回复，并恢复 300 条窗口。
- 检查桌面与窄屏截图，回复末尾位于输入框上方，可正常滚动至结尾。截图位于 `apps/web/test-results/search-navigation-older-hi-*/history-complete-*.png`。

命令：

```powershell
npx tsx --test packages/host/test/assistant-content.test.ts
$env:KODO_UI_TEST_PORT = '4361'
npm run test:ui -w @kodo/web -- test/search-navigation.spec.ts test/subagents.spec.ts
```

测试使用独立 Host 和合成会话，没有模型调用或生产会话数据修改。本轮未构建、验收原生 Android / iOS。

## 生效状态

4330 Host 健康检查为 ok；页面已引用本轮构建的 `assets/index-JdC67DR2.js`。静态文件由现有 Host 读取，本轮无需重启 Host，刷新页面即可加载。未重启生产 Host。
