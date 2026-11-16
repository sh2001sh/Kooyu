# 桌面端与 Android 逐页验收（2026-11-15）

本轮完成真实 Electron 窗口的 **43 个页面/面板状态、93 张 PNG**，以及 BlueStacks **Android 13 原生端的 38 张 PNG**，共 **131 张截图**。Android 扫码页设置 `FLAG_SECURE`，ADB 返回 0 字节，单独保存原生 Activity / 无障碍结构与截屏限制记录；没有生成占位图或绕过保护。桌面和 Android 均使用独立测试 Host 与演示数据，不执行模型推理。

## 桌面端

- Electron 39.1.0，真实 BrowserWindow。沿用既有经哈希校验的系统盘运行时缓存和软件渲染，不关闭 sandbox。
- 独立 SQLite、Electron profile、工作目录和演示数据；fixture 禁止模型执行、不导入用户原生历史，不调用收费模型或发送真实业务消息。本机引擎安装状态不是逐一模型推理证据。
- 截图覆盖引导三步、工作台、新建对话、待处理、通用/引擎/模型来源/用量/手机连接/高级设置、11 个引擎展开详情、模型来源表单、六类工作中心、应用清单/OAuth/Webhook/节点目录/APNs 表单、主对话、目标/文件/改动/运行检查器、Markdown 预览、浅色/深色主题。
- 页面脚本错误 **0**、文档横向溢出 **0**；关闭窗口隐藏、重新打开及 Host 持续运行通过。只覆盖已列页面，不代表所有状态组合与真实厂商账户均已验收。
- Web Playwright **92/92 通过（3.1 分钟）**；Electron 生命周期脚本重新通过。
- 修复旧 Electron 验证脚本未处理首次引导的问题；截图脚本等待初始导航结束才操作，避免其自身 reload 中断启动。
- 追加 50 张内部滚动区域截图，相邻位置保留重叠并恢复原滚动位置；包含 APNs 表单底部的 Key ID、Bundle ID、私钥、启用开关与保存按钮。截图脚本记录滚动容器、位置和最大滚动距离，避免将 fullPage 当作内部滚动容器的完整截图。93 张 SHA-256 全部匹配，最终重新采集结果 passed。

截图目录为 output/playwright/desktop-android-2026-11-15/desktop/：

- index.html：逐页可浏览索引。
- overview.jpg：93 张截图总览；已检查总览、代表页面及长表单底部。
- manifest.json：逐项标签、路径、SHA-256、溢出和生命周期结果。

早期截图脚本失败诊断保存在同级 diagnostics/，不计入最终索引。

## Android

- 用户完成 BlueStacks 管理员安装后继续验收。实际版本 **5.22.290.1031**，程序位于 `C:/Program Files/BlueStacks_nxt/`，数据位于 `D:/Program Files/BlueStacks_nxt/`。安装器签名、下载来源及原先 UAC 阻塞历史保留在 `bluestacks-installation.json`。
- 默认 Pie64 / Android 9 实例存在 Keystore 异常：独立探针明确请求 AES 加密+解密目的（3），新密钥元数据仍返回目的 1，解密报 KeyStoreException -3。随机探针 alias 用后删除。证据为 `android/android9-keystore-probe.txt`。这证明该模拟器实例异常，不等于所有 Android 9 设备均不可用。
- 新建 **Tiramisu64 / Android 13 / SDK 33** 实例，4 核、4 GB、1080×1920、320 dpi；ADB **127.0.0.1:5555**。旧 Pie64 已停止，避免两实例争用端口。Android 13 新密钥目的为 3，加解密往返通过。产品继续使用 Android Keystore，没有明文降级或证书豁免。
- JDK 17、compile/target SDK 36；`testDebugUnitTest / lintDebug / assembleDebug` 通过。单测 **48/48**，lint **0 errors、22 warnings**。APK 安装成功，签名校验通过；安装的 APK SHA-256 为 `2FE26240E16B3DE4369181D6C9C50D9172F31EAA18058E706E32D2561FF49811`。
- 手动配对通过标准 HTTPS Relay 完成，列表真实加载隔离 Host 的两个会话。多次 force-stop / 冷启动恢复已保存电脑和会话，未重新输入凭据。
- 基础 21 项覆盖首次/手动配对、会话列表/新建、项目/新建、待处理、用量、三类设置、电脑重命名/添加、会话正文/用量/基础配置/事件/队列、文件列表/README 文本/Git 空状态。补充项目目录/重命名/删除确认、预算、会话菜单/重命名/删除确认、已归档空状态、切换电脑、深色主题和后台提醒。删除确认均取消，没有执行删除。
- 引擎列表追加一张重叠滚动截图，覆盖全部 11 个引擎及末尾说明。截图为真实 `adb exec-out screencap -p` PNG，同时保存当时的原生无障碍 XML。系统 uiautomator 无法进入 idle 时使用独立 instrumentation 探针读取当前原生 UI；不使用 WebView 或 Web 截图替代。
- 主动启用测试 App 的通知权限后，**remoteMessaging 前台 Service 启动、进入后台后继续运行、Host 生成的演示事项通知送达、点击定位同一会话并持久化已读回执、关闭后 Host 确认撤销**均通过。`33-system-notifications.png` 同时显示事项提醒与常驻连接通知。测试结束关闭提醒，相机测试权限已撤回。
- 扫码 Activity 真实启动，原生页面文本和取消返回通过；`FLAG_SECURE` 导致 ADB 无可用 PNG。`37-qr-scanner-protected.xml` 与 `.capture.txt` 保存限制证据，不计入 38 张 PNG。未测试真实相机识别二维码。
- `android/index.html` 为逐页索引，`overview.jpg` 为总览，`manifest.json` 保存标签、预期文本、尺寸、SHA-256、滚动与生命周期断言。失败排查放在 `diagnostics/`，不计入最终截图。
- 最终整轮脚本重新通过，38 张 Android PNG 与 93 张桌面 PNG **共 131 项 SHA-256 全部匹配**，PNG 解码与 Android 尺寸校验通过。加密凭据终检为 AES / purposes=3 / 128 bit，`VAULT_LOAD_OK devices=1`；退出历史未发现 CRASH / CRASH_NATIVE / ANR 条目。分别见 `android/android13-keystore-after-run.txt`、`android/process-exit-history.txt` 和总目录 `screenshot-verification.json`。

APK 为 Debug 开发签名包。以上是 Windows 上 BlueStacks Android 13 的原生验收，不代表 Android 8–16 所有版本、实体手机锁屏/厂商回收/切网、真实模型执行或全部状态组合均通过。部分会话、用量、事件和 Git 页面特意使用空状态演示数据。

## 本轮修复与回归

- 修复 Host Relay 使用 WHATWG WebSocket 客户端不接受的 close code：1008/1013 改为应用码 4008/4013，避免异常帧和重连分支抛 InvalidAccessError。增加异常帧关闭与恢复连接回归，Host Relay **2/2** 通过，Host 构建通过。
- 隔离测试 Host 的 Relay 私钥仅在内存中，改为每次使用新的临时身份目录，避免重启复用失效的磁盘公钥身份。
- 手动配对提示从“6 位配对码”改为“配对码 / 粘贴电脑生成的完整配对码”。
- 原生脚本按真实控件标签和父级启用状态定位；解决“项目”过滤器与底部导航重名、配对后尚未同步就截图、uiautomator 返回旧 XML 等测试脚本问题。新建对话、项目、设置、详情及文件等页面核对实际内容。
- 新增可复用的额外页面/后台通知验收、UI/Keystore 探针构建及离线截图索引生成脚本。针对本轮 JS/TS 的 ESLint、Prettier 和语法检查通过。

## 复现与待完成步骤

在仓库根目录的 PowerShell 中设置并启动隔离 Host：

    $env:KOOYU_QA_DIR = (Join-Path (Get-Location) '.local/verification/platform-android-pages-20261115')
    $env:TEMP = (Resolve-Path .local/tmp).Path
    $env:TMP = $env:TEMP
    npm run start:platform-fixture

保留 Host，在第二个终端继承同样的 KOOYU_QA_DIR 后执行 npm run verify:desktop-pages。脚本校验本地 fixture 记录和 Host 身份，拒绝误改普通 Host。

BlueStacks 现已安装。启用专用 Android 13 实例的 ADB，在第二终端设置：

    $env:KOOYU_QA_DIR = (Join-Path (Get-Location) '.local/verification/platform-android-pages-20261115')
    $env:KOOYU_ADB_SERIAL = '127.0.0.1:5555'
    $env:KOOYU_ANDROID_UI_PROBE = '1'
    $env:KOOYU_ANDROID_EXTRAS = '1'
    node scripts/build-android-ui-probe.mjs
    npm run verify:android-pages

实例已有同一隔离 Host 的有效配对时可额外设置 `KOOYU_ANDROID_RESUME=1`，保留首次配对两张截图并重跑后续步骤。仅补测子页面或扫码时可分别设置 `KOOYU_ANDROID_EXTRA_ONLY=1` 或 `KOOYU_ANDROID_SCANNER_ONLY=1`。这些模式只适用于同一测试实例/Host，不能当作新配对证据。配置不在 ProgramData 时可指定 `KOOYU_BLUESTACKS_CONFIG`；脚本只连接明确的回环 ADB 端口，不选择 USB 真机。

Android 脚本通过标准 HTTPS Relay 对隔离 Host 配对，不添加自签名证书豁免或明文 HTTP。脚本不清空或卸载应用；必须使用专用测试实例。重新启动测试 Host 会创建新临时 Relay 身份，应使用新的测试配对，不能期待旧邀请地址继续可达。

运行 `python scripts/build-platform-test-gallery.py` 校验各 PNG 哈希并生成桌面/Android 总览和总入口 `output/playwright/desktop-android-2026-11-15/index.html`。

本轮日志保存在 `output/playwright/desktop-android-2026-11-15/`：`desktop-pages-final.log`、`desktop-current.log`、`platform-full-ui.log`、`android-platform-final.log`、`android-pages-final.log`。最后一个包含基础页面、子页面、通知和受保护扫码页的完整运行结果。验收完成后停止本轮独立测试 Host，保留 BlueStacks 专用实例、开发 APK、SQLite 测试数据与全部证据，不影响普通 Host。
