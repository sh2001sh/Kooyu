import { useAppPreferences } from "./preferences";

export type Locale = "zh-CN" | "en" | "ja";
export const LANGUAGES: { value: "system" | Locale; label: string }[] = [
  { value: "system", label: "跟随系统 / System" },
  { value: "zh-CN", label: "简体中文" },
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
];

/**
 * Interface strings. Chinese is the source text; each key is looked up for the
 * active language and falls back to Chinese when a translation is missing.
 */
const STRINGS = {
  "settings.title": { "zh-CN": "设置", en: "Settings", ja: "設定" },
  "settings.back": { "zh-CN": "返回对话", en: "Back to chats", ja: "チャットに戻る" },
  "nav.work": { "zh-CN": "自动化与通知", en: "Automation & notifications", ja: "自動化と通知" },
  "nav.memory": { "zh-CN": "记忆与约定", en: "Memory & conventions", ja: "記憶とルール" },
  "nav.appearance": { "zh-CN": "外观", en: "Appearance", ja: "外観" },
  "nav.general": { "zh-CN": "通用", en: "General", ja: "一般" },
  "nav.engines": { "zh-CN": "引擎", en: "Engines", ja: "エンジン" },
  "nav.providers": { "zh-CN": "模型来源", en: "Model sources", ja: "モデルソース" },
  "nav.usage": { "zh-CN": "用量", en: "Usage", ja: "使用量" },
  "nav.import": { "zh-CN": "导入对话", en: "Import chats", ja: "チャット取込" },
  "nav.devices": { "zh-CN": "手机连接", en: "Devices", ja: "デバイス" },
  "nav.advanced": { "zh-CN": "高级", en: "Advanced", ja: "詳細" },
  "nav.group.preferences": { "zh-CN": "偏好", en: "Preferences", ja: "環境設定" },
  "nav.group.models": { "zh-CN": "引擎与模型", en: "Engines & models", ja: "エンジンとモデル" },
  "nav.group.account": { "zh-CN": "数据与设备", en: "Data & devices", ja: "データとデバイス" },
  "nav.group.workbench": { "zh-CN": "工作台", en: "Workbench", ja: "ワークベンチ" },
  "nav.workbenchHub": { "zh-CN": "工作与计划", en: "Work & plans", ja: "タスクと計画" },
  "nav.workbenchHubDesc": {
    "zh-CN": "目标 · 成果 · 自动计划",
    en: "Goals · Outcomes · Automations",
    ja: "目標・成果・自動計画",
  },
  "status.localOnline": { "zh-CN": "本机在线", en: "Online", ja: "オンライン" },
  "status.connecting": { "zh-CN": "连接中", en: "Connecting", ja: "接続中" },

  "dock.chats": { "zh-CN": "对话", en: "Chats", ja: "チャット" },
  "dock.projects": { "zh-CN": "项目", en: "Projects", ja: "プロジェクト" },
  "dock.usage": { "zh-CN": "用量", en: "Usage", ja: "使用量" },
  "dock.settings": { "zh-CN": "设置", en: "Settings", ja: "設定" },

  "sidebar.newChat": { "zh-CN": "新对话", en: "New chat", ja: "新規チャット" },
  "sidebar.newShort": { "zh-CN": "新建", en: "New", ja: "新規" },
  "sidebar.searchPlaceholder": { "zh-CN": "搜索对话…", en: "Search chats…", ja: "チャットを検索…" },
  "sidebar.hostConnected": { "zh-CN": "Host 已连接", en: "Host connected", ja: "Host 接続済み" },
  "sidebar.hostOffline": { "zh-CN": "桌面 Host 未连接", en: "Host offline", ja: "Host 未接続" },
  "sidebar.lightTheme": { "zh-CN": "浅色主题", en: "Light mode", ja: "ライト" },
  "sidebar.darkTheme": { "zh-CN": "深色主题", en: "Dark mode", ja: "ダーク" },
  "sidebar.switchToLight": {
    "zh-CN": "切换到浅色外观",
    en: "Switch to light mode",
    ja: "ライト外観に切り替え",
  },
  "sidebar.switchToDark": {
    "zh-CN": "切换到深色外观",
    en: "Switch to dark mode",
    ja: "ダーク外観に切り替え",
  },
  "sidebar.manageDevices": {
    "zh-CN": "管理手机连接与配对码",
    en: "Manage paired devices",
    ja: "デバイス接続を管理",
  },
  "sidebar.tab.all": { "zh-CN": "全部对话", en: "All", ja: "すべて" },
  "sidebar.tab.projects": { "zh-CN": "按项目", en: "Projects", ja: "プロジェクト" },
  "sidebar.tab.engines": { "zh-CN": "按引擎", en: "Engines", ja: "エンジン" },
  "sidebar.tab.harness": { "zh-CN": "按 Harness", en: "Engines", ja: "エンジン" },
  "sidebar.tab.archived": { "zh-CN": "已归档", en: "Archived", ja: "アーカイブ" },
  "sidebar.tab.archivedShort": { "zh-CN": "归档", en: "Archived", ja: "アーカイブ" },
  "sidebar.mainChat": { "zh-CN": "主对话", en: "Main chat", ja: "メインチャット" },

  "general.setupSection": { "zh-CN": "首次设置引导", en: "Setup wizard", ja: "初期セットアップ" },
  "general.setupRow": {
    "zh-CN": "重新检查主 Agent 与执行引擎",
    en: "Re-check main agent & execution engines",
    ja: "メイン Agent と実行エンジンを再確認",
  },
  "general.openSetup": { "zh-CN": "打开设置引导", en: "Open setup", ja: "ガイドを開く" },
  "general.appearanceCustomize": {
    "zh-CN": "主题与色彩自定义",
    en: "Theme & color studio",
    ja: "テーマと配色カスタム",
  },
  "general.openAppearance": {
    "zh-CN": "打开外观面板",
    en: "Open appearance",
    ja: "外観を開く",
  },
  "general.languageApplied": {
    "zh-CN": "切换后立即生效并同步到已配对设备",
    en: "Applies immediately and syncs to paired devices",
    ja: "即座に反映され、ペアリング済みデバイスと同期されます",
  },

  "projects.title": {
    "zh-CN": "项目与目录",
    en: "Projects & folders",
    ja: "プロジェクトとフォルダ",
  },
  "projects.new": { "zh-CN": "新建项目", en: "New project", ja: "新規プロジェクト" },
  "projects.empty": { "zh-CN": "暂无项目", en: "No projects yet", ja: "プロジェクトがありません" },
  "projects.newChat": { "zh-CN": "新建对话", en: "New chat", ja: "新規チャット" },

  "usage.pageTitle": { "zh-CN": "用量与预算", en: "Usage & budgets", ja: "使用量と予算" },
  "usage.ledgerTitle": { "zh-CN": "使用明细", en: "Usage ledger", ja: "使用明細" },
  "usage.avgTtft": { "zh-CN": "平均首字", en: "Avg TTFT", ja: "平均 TTFT" },
  "usage.avgDuration": { "zh-CN": "平均总耗时", en: "Avg total", ja: "平均所要時間" },
  "usage.col.engineSession": {
    "zh-CN": "引擎 / 会话",
    en: "Engine / Chat",
    ja: "エンジン / チャット",
  },
  "usage.col.model": { "zh-CN": "模型", en: "Model", ja: "モデル" },
  "usage.col.tokens": { "zh-CN": "Token", en: "Tokens", ja: "トークン" },
  "usage.col.ttft": { "zh-CN": "首字时间", en: "TTFT", ja: "初回トークン" },
  "usage.col.duration": { "zh-CN": "总时间", en: "Duration", ja: "合計時間" },
  "usage.col.cost": { "zh-CN": "费用", en: "Cost", ja: "費用" },
  "usage.col.time": { "zh-CN": "时间", en: "Time", ja: "時刻" },
  "usage.prevPage": { "zh-CN": "上一页", en: "Previous", ja: "前へ" },
  "usage.nextPage": { "zh-CN": "下一页", en: "Next", ja: "次へ" },

  "inbox.pending": { "zh-CN": "待处理", en: "Pending", ja: "保留中" },
  "inbox.errors": { "zh-CN": "运行异常", en: "Issues", ja: "異常" },
  "inbox.recent": { "zh-CN": "最近动态", en: "Recent", ja: "最近の通知" },
  "inbox.empty": { "zh-CN": "暂无待处理事项", en: "All caught up", ja: "保留中の項目はありません" },
  "inbox.open": { "zh-CN": "打开会话", en: "Open chat", ja: "チャットを開く" },
  "inbox.markRead": { "zh-CN": "标记已读", en: "Mark read", ja: "既読にする" },
  "inbox.markAllRead": { "zh-CN": "全部已读", en: "Mark all read", ja: "すべて既読" },
  "inbox.delete": { "zh-CN": "删除", en: "Delete", ja: "削除" },

  "import.title": { "zh-CN": "导入对话", en: "Import chats", ja: "チャットをインポート" },
  "import.desc": {
    "zh-CN":
      "扫描本机各引擎已有的历史会话，按项目按需勾选导入到 Kooyu，导入后可查看历史并继续对话。",
    en: "Scan existing local sessions from your engines and selectively import specific chats by project into Kooyu.",
    ja: "各エンジンのローカル履歴をスキャンし、プロジェクト別に必要なチャットだけを選んで Kooyu に取り込めます。",
  },
  "import.filterSection": { "zh-CN": "扫描范围", en: "Scan scope", ja: "スキャン範囲" },
  "import.projectFilter": { "zh-CN": "所属项目", en: "Project", ja: "プロジェクト" },
  "import.allProjects": { "zh-CN": "全部项目", en: "All projects", ja: "すべてのプロジェクト" },
  "import.chooseProject": {
    "zh-CN": "请选择项目（必选）",
    en: "Choose a project (required)",
    ja: "プロジェクトを選択（必須）",
  },
  "import.readyTitle": {
    "zh-CN": "选择项目后开始扫描",
    en: "Choose a project to scan",
    ja: "プロジェクトを選んでスキャン",
  },
  "import.readyDesc": {
    "zh-CN": "项目必选，引擎可选。点击「扫描本地对话」后才会读取本地历史。",
    en: "A project is required; the engine is optional. Local history is read only when you click Scan local chats.",
    ja: "プロジェクトは必須、エンジンは任意です。スキャンボタンを押すとローカル履歴を読み取ります。",
  },
  "import.engineFilter": { "zh-CN": "来源引擎", en: "Engine", ja: "エンジン" },
  "import.allEngines": { "zh-CN": "全部引擎", en: "All engines", ja: "すべてのエンジン" },
  "import.searchPlaceholder": {
    "zh-CN": "搜索对话标题、模型或目录…",
    en: "Filter by title, model or path…",
    ja: "タイトル・モデル・パスで絞り込み…",
  },
  "import.scan": { "zh-CN": "扫描本地对话", en: "Scan local chats", ja: "ローカル履歴をスキャン" },
  "import.scanning": { "zh-CN": "正在扫描…", en: "Scanning…", ja: "スキャン中…" },
  "import.listSection": { "zh-CN": "可导入对话", en: "Discovered chats", ja: "検出されたチャット" },
  "import.selectAll": { "zh-CN": "全选未导入", en: "Select all", ja: "未取込を全選択" },
  "import.clearSelection": { "zh-CN": "取消全选", en: "Clear", ja: "選択解除" },
  "import.hideImported": { "zh-CN": "隐藏已导入", en: "Hide imported", ja: "取込済みを非表示" },
  "import.alreadyImported": { "zh-CN": "已导入", en: "Imported", ja: "取込済み" },
  "import.openSession": { "zh-CN": "打开对话", en: "Open", ja: "開く" },
  "import.unassignedProject": {
    "zh-CN": "未匹配项目",
    en: "Unassigned folder",
    ja: "未割当フォルダ",
  },
  "import.targetProject": { "zh-CN": "导入到项目", en: "Import into", ja: "インポート先" },
  "import.autoProject": {
    "zh-CN": "自动匹配原项目目录",
    en: "Auto-match source project",
    ja: "元のプロジェクトに自動割当",
  },
  "import.importAction": {
    "zh-CN": "导入所选对话",
    en: "Import selected",
    ja: "選択したチャットを取込",
  },
  "import.importing": { "zh-CN": "正在导入…", en: "Importing…", ja: "インポート中…" },
  "import.emptyTitle": {
    "zh-CN": "未发现可导入的本地会话",
    en: "No local sessions found",
    ja: "インポート可能な履歴が見つかりません",
  },
  "import.emptyDesc": {
    "zh-CN": "请切换项目或引擎筛选后点击「扫描本地对话」重试。",
    en: "Try changing the project or engine filter and click Scan local chats.",
    ja: "プロジェクトやエンジンの条件を変更して再スキャンしてください。",
  },
  "import.warningsTitle": {
    "zh-CN": "部分引擎扫描提示",
    en: "Some engines reported warnings",
    ja: "一部エンジンのスキャン警告",
  },

  "voice.start": { "zh-CN": "语音输入", en: "Voice input", ja: "音声入力" },
  "voice.stop": { "zh-CN": "完成语音输入", en: "Finish voice input", ja: "音声入力を完了" },
  "voice.cancel": { "zh-CN": "取消录音", en: "Cancel recording", ja: "録音をキャンセル" },
  "voice.listening": { "zh-CN": "正在聆听…", en: "Listening…", ja: "聞き取り中…" },
  "voice.recording": { "zh-CN": "正在录音…", en: "Recording…", ja: "録音中…" },
  "voice.transcribing": { "zh-CN": "正在转写语音…", en: "Transcribing…", ja: "文字起こし中…" },
  "voice.section": { "zh-CN": "语音输入", en: "Voice input", ja: "音声入力" },
  "voice.engine": { "zh-CN": "识别方式", en: "Recognition mode", ja: "音声認識方式" },
  "voice.engine.auto": {
    "zh-CN": "自动（浏览器实时 / 桌面端走模型来源）",
    en: "Auto (Browser live / Provider on Desktop)",
    ja: "自動（ブラウザ優先 / デスクトップはモデルソース）",
  },
  "voice.engine.browser": {
    "zh-CN": "浏览器原生语音（实时）",
    en: "Browser native speech (live)",
    ja: "ブラウザ標準音声（リアルタイム）",
  },
  "voice.engine.provider": {
    "zh-CN": "模型来源转写（Whisper / 高精度）",
    en: "Model source transcription (Whisper)",
    ja: "モデルソース文字起こし (Whisper)",
  },
  "voice.provider": { "zh-CN": "转写模型来源", en: "Transcription source", ja: "文字起こしソース" },
  "voice.provider.auto": {
    "zh-CN": "自动选择可用来源",
    en: "Auto-select available source",
    ja: "利用可能なソースを自動選択",
  },
  "voice.provider.none": {
    "zh-CN": "暂无 OpenAI 兼容模型来源（浏览器原生语音仍可用）",
    en: "No OpenAI-compatible source yet (browser speech still works)",
    ja: "OpenAI 互換ソースがありません（ブラウザ音声は利用可能）",
  },
  "voice.model": { "zh-CN": "转写模型", en: "Transcription model", ja: "文字起こしモデル" },
  "voice.language": { "zh-CN": "语音语言", en: "Speech language", ja: "音声言語" },
  "voice.language.auto": {
    "zh-CN": "跟随界面语言",
    en: "Follow interface language",
    ja: "表示言語に合わせる",
  },
  "voice.autoSend": {
    "zh-CN": "识别完成后自动发送",
    en: "Auto-send after transcription",
    ja: "文字起こし後に自動送信",
  },
  "voice.err.permission": {
    "zh-CN": "麦克风权限被拒绝，请在浏览器或系统设置中允许访问麦克风。",
    en: "Microphone permission denied. Allow microphone access in browser or OS settings.",
    ja: "マイクへのアクセスが拒否されました。ブラウザまたは OS 設定を確認してください。",
  },
  "voice.err.noMic": {
    "zh-CN": "未检测到可用麦克风设备。",
    en: "No microphone device detected.",
    ja: "利用可能なマイクが見つかりません。",
  },
  "voice.err.unsupported": {
    "zh-CN":
      "当前环境不支持浏览器语音；请在「设置 → 模型来源」配置 OpenAI 兼容来源以启用高精度语音转写。",
    en: "Browser speech is unavailable here. Add an OpenAI-compatible model source for voice transcription.",
    ja: "この環境ではブラウザ音声を利用できません。モデルソースを追加してください。",
  },
  "voice.err.empty": {
    "zh-CN": "未识别到有效语音，请重试。",
    en: "No speech detected. Please try again.",
    ja: "有効な音声が検出されませんでした。",
  },

  "update.section": { "zh-CN": "软件更新", en: "Software update", ja: "ソフトウェアアップデート" },
  "update.check": { "zh-CN": "检查更新", en: "Check for updates", ja: "アップデートを確認" },
  "update.checking": { "zh-CN": "正在检查…", en: "Checking…", ja: "確認中…" },
  "update.upToDate": { "zh-CN": "已是最新版本", en: "Up to date", ja: "最新です" },
  "update.available": { "zh-CN": "发现新版本", en: "Update available", ja: "新しいバージョン" },
  "update.channel": { "zh-CN": "更新通道", en: "Release channel", ja: "更新チャネル" },
  "update.channel.stable": { "zh-CN": "正式版 (Stable)", en: "Stable", ja: "安定版 (Stable)" },
  "update.channel.preview": {
    "zh-CN": "预览版 (Preview)",
    en: "Preview",
    ja: "プレビュー版 (Preview)",
  },
  "update.autoCheck": {
    "zh-CN": "自动检查新版本",
    en: "Check for updates automatically",
    ja: "自動でアップデートを確認",
  },
  "update.download": { "zh-CN": "下载更新", en: "Download update", ja: "ダウンロード" },
  "update.downloading": { "zh-CN": "正在下载", en: "Downloading", ja: "ダウンロード中" },
  "update.verifying": {
    "zh-CN": "正在校验 SHA-256…",
    en: "Verifying SHA-256…",
    ja: "SHA-256 を検証中…",
  },
  "update.install": { "zh-CN": "立即安装更新", en: "Install update", ja: "今すぐインストール" },
  "update.installing": {
    "zh-CN": "已启动安装程序",
    en: "Installer launched",
    ja: "インストーラーを起動しました",
  },
  "update.verified": { "zh-CN": "SHA-256 已校验", en: "SHA-256 verified", ja: "SHA-256 検証済み" },
  "update.releaseNotes": { "zh-CN": "更新日志", en: "Release notes", ja: "リリースノート" },
  "update.openRelease": { "zh-CN": "查看发布页", en: "Release page", ja: "リリースページ" },
  "update.androidApk": {
    "zh-CN": "Android 安装包 (APK)",
    en: "Android APK",
    ja: "Android APK",
  },
  "update.noLocalAsset": {
    "zh-CN": "当前平台暂无自动安装包，请前往发布页手动下载",
    en: "Open the release page to download for this platform",
    ja: "リリースページからダウンロードしてください",
  },

  "general.desc": {
    "zh-CN": "语言、工作台、外观与对话显示。设置保存在本机 Host，所有已配对设备共用。",
    en: "Language, workspace, appearance and chat display. Stored on this computer's host and shared with paired devices.",
    ja: "言語、ワークスペース、外観、チャット表示。この PC の Host に保存され、ペアリング済みデバイスと共有されます。",
  },
  "general.section.language": { "zh-CN": "语言", en: "Language", ja: "言語" },
  "general.language": { "zh-CN": "界面语言", en: "Interface language", ja: "表示言語" },
  "general.language.desc": {
    "zh-CN": "菜单、设置与提示文字使用的语言。",
    en: "Language for menus, settings and messages.",
    ja: "メニュー、設定、メッセージの言語。",
  },
  "general.section.workspace": { "zh-CN": "工作台", en: "Workspace", ja: "ワークスペース" },
  "general.defaultEngine": { "zh-CN": "默认引擎", en: "Default engine", ja: "既定のエンジン" },
  "general.defaultEngine.desc": {
    "zh-CN": "新对话默认使用的引擎，对话中仍可切换。",
    en: "Engine used for new chats. You can still switch in a chat.",
    ja: "新しいチャットで使うエンジン。チャット中に切り替えできます。",
  },
  "general.notInstalled": {
    "zh-CN": "（未安装）",
    en: " (not installed)",
    ja: "（未インストール）",
  },
  "general.sendKey": { "zh-CN": "发送快捷键", en: "Send shortcut", ja: "送信キー" },
  "general.sendKey.desc": {
    "zh-CN": "Shift + Enter 始终换行；输入法确认候选词不会发送。",
    en: "Shift + Enter always adds a line. Confirming an IME candidate never sends.",
    ja: "Shift + Enter は常に改行。IME の確定では送信しません。",
  },
  "general.sendKey.enter": { "zh-CN": "Enter 发送", en: "Enter sends", ja: "Enter で送信" },
  "general.sendKey.mod": {
    "zh-CN": "Ctrl / ⌘ + Enter 发送",
    en: "Ctrl / ⌘ + Enter sends",
    ja: "Ctrl / ⌘ + Enter で送信",
  },
  "general.autoModels": {
    "zh-CN": "自动更新模型资料",
    en: "Update model data automatically",
    ja: "モデル情報を自動更新",
  },
  "general.autoModels.desc": {
    "zh-CN": "定期从 models.dev 更新上下文窗口、思考档位与参考价格；手动修改的值不会被覆盖。",
    en: "Refresh context windows, reasoning levels and list prices from models.dev. Your edits are kept.",
    ja: "models.dev からコンテキスト長・推論レベル・参考価格を更新します。手動の変更は保持されます。",
  },
  "general.section.appearance": { "zh-CN": "外观", en: "Appearance", ja: "外観" },
  "general.theme": { "zh-CN": "主题", en: "Theme", ja: "テーマ" },
  "general.theme.system": { "zh-CN": "跟随系统", en: "System", ja: "システム" },
  "general.theme.light": { "zh-CN": "浅色", en: "Light", ja: "ライト" },
  "general.theme.dark": { "zh-CN": "深色", en: "Dark", ja: "ダーク" },
  "general.fontSize": {
    "zh-CN": "消息字号",
    en: "Message text size",
    ja: "メッセージの文字サイズ",
  },
  "general.fontSize.desc": {
    "zh-CN": "只影响对话正文。",
    en: "Only affects chat text.",
    ja: "チャット本文のみ。",
  },
  "general.motion": { "zh-CN": "减少动态效果", en: "Reduce motion", ja: "動きを減らす" },
  "general.motion.desc": {
    "zh-CN": "关闭界面动画；系统的减少动态效果设置也会生效。",
    en: "Turn off interface animations. The system setting also applies.",
    ja: "アニメーションをオフにします。システム設定も適用されます。",
  },
  "general.section.chat": { "zh-CN": "对话显示", en: "Chat display", ja: "チャット表示" },
  "general.thinking": {
    "zh-CN": "生成时展开思考过程",
    en: "Expand thinking while generating",
    ja: "生成中は思考を展開",
  },
  "general.thinking.desc": {
    "zh-CN": "关闭后思考过程始终折叠，点击即可查看。",
    en: "When off, thinking stays collapsed; click to view.",
    ja: "オフの場合は折りたたまれ、クリックで表示します。",
  },
  "general.tools": {
    "zh-CN": "折叠工具调用",
    en: "Collapse tool calls",
    ja: "ツール呼び出しを折りたたむ",
  },
  "general.tools.desc": {
    "zh-CN": "连续的工具调用合并为一行，默认收起输出。",
    en: "Consecutive tool calls merge into one row with output hidden.",
    ja: "連続したツール呼び出しを 1 行にまとめ、出力を隠します。",
  },
  "general.section.instructions": {
    "zh-CN": "个人指令",
    en: "Personal instructions",
    ja: "個人用の指示",
  },
  "general.instructions.desc": {
    "zh-CN":
      "新对话创建时保存一份，随第一条消息发送；已有对话不受影响。项目里的 AGENTS.md 与引擎自身规则照常生效。",
    en: "Saved with each new chat and sent with its first message. Existing chats are unchanged; AGENTS.md and engine rules still apply.",
    ja: "新しいチャットに保存され最初のメッセージと一緒に送信されます。既存のチャットには影響しません。",
  },
  "general.instructions.label": { "zh-CN": "指令内容", en: "Instructions", ja: "指示内容" },
  "general.instructions.placeholder": {
    "zh-CN": "例如：请用中文回复。修改代码后说明验证结果与尚未验证的部分。",
    en: "e.g. Reply in English. After changing code, say what was verified and what wasn't.",
    ja: "例：日本語で回答してください。",
  },

  "save.unsaved": {
    "zh-CN": "有未保存的更改",
    en: "Unsaved changes",
    ja: "未保存の変更があります",
  },
  "save.saved": { "zh-CN": "已保存", en: "Saved", ja: "保存しました" },
  "save.reset": { "zh-CN": "还原", en: "Revert", ja: "元に戻す" },
  "save.save": { "zh-CN": "保存", en: "Save", ja: "保存" },
  "save.saving": { "zh-CN": "正在保存…", en: "Saving…", ja: "保存中…" },
  "common.cancel": { "zh-CN": "取消", en: "Cancel", ja: "キャンセル" },
  "common.close": { "zh-CN": "关闭", en: "Close", ja: "閉じる" },
  "common.edit": { "zh-CN": "编辑", en: "Edit", ja: "編集" },
  "common.delete": { "zh-CN": "删除", en: "Delete", ja: "削除" },

  "engines.title": { "zh-CN": "引擎", en: "Engines", ja: "エンジン" },
  "engines.desc": {
    "zh-CN": "每个引擎可以用自己的登录与配置，也可以改用你添加的模型来源。",
    en: "Each engine can use its own login and config, or one of your model sources.",
    ja: "各エンジンは自身のログインと設定、または追加したモデルソースを使えます。",
  },
  "engines.recheck": { "zh-CN": "重新检测", en: "Re-detect", ja: "再検出" },
  "engines.ready": { "zh-CN": "已就绪", en: "Ready", ja: "利用可能" },
  "engines.install": { "zh-CN": "安装", en: "Install", ja: "インストール" },
  "engines.source": { "zh-CN": "模型来源", en: "Model source", ja: "モデルソース" },
  "engines.defaults": {
    "zh-CN": "新对话默认值",
    en: "New chat defaults",
    ja: "新しいチャットの既定値",
  },
  "engines.mapping": { "zh-CN": "模型映射", en: "Model mapping", ja: "モデルのマッピング" },
  "engines.configFiles": { "zh-CN": "配置文件", en: "Config files", ja: "設定ファイル" },
  "engines.notCreated": { "zh-CN": "尚未创建", en: "not created yet", ja: "未作成" },

  "file.title": { "zh-CN": "编辑配置文件", en: "Edit config file", ja: "設定ファイルを編集" },
  "file.desc": {
    "zh-CN": "保存前会检查格式，并在 Kooyu 数据目录备份原文件。",
    en: "The format is checked before saving, and the original is backed up to Kooyu's data folder.",
    ja: "保存前に形式を確認し、元のファイルを Kooyu のデータフォルダーにバックアップします。",
  },
  "file.discard": { "zh-CN": "不保存", en: "Discard", ja: "保存しない" },
  "file.confirmDiscard": {
    "zh-CN": "放弃未保存的修改？",
    en: "Discard unsaved changes?",
    ja: "未保存の変更を破棄しますか？",
  },

  "providers.title": { "zh-CN": "模型来源", en: "Model sources", ja: "モデルソース" },
  "usage.title": { "zh-CN": "用量", en: "Usage", ja: "使用量" },
  "devices.title": { "zh-CN": "手机连接", en: "Devices", ja: "デバイス" },
  "advanced.title": { "zh-CN": "高级", en: "Advanced", ja: "詳細" },

  "delegation.section": { "zh-CN": "委派工单", en: "Delegated tasks", ja: "委任タスク" },
  "delegation.escalate": {
    "zh-CN": "转交 Kooyu 主控",
    en: "Hand off to Kooyu",
    ja: "Kooyu に引き継ぐ",
  },
  "delegation.managedBanner": {
    "zh-CN": "由 Kooyu 主控编排 · 手动发言将自动暂停主控",
    en: "Managed by Kooyu · Typing here pauses automation",
    ja: "Kooyu が管理中・手動送信で自動続行を一時停止",
  },
  "delegation.sharedWorkspace": {
    "zh-CN": "共享工作区",
    en: "Shared workspace",
    ja: "共有ワークスペース",
  },
  "delegation.viewController": {
    "zh-CN": "查看主对话",
    en: "Main chat",
    ja: "メインチャット",
  },
  "delegation.viewWorker": {
    "zh-CN": "下钻直聊",
    en: "Inspect chat",
    ja: "サブ会話へ",
  },
  "delegation.reviewDiff": {
    "zh-CN": "审阅改动",
    en: "Review diff",
    ja: "差分を確認",
  },
  "delegation.takeover": {
    "zh-CN": "接管暂停",
    en: "Take over",
    ja: "引き取る",
  },
  "delegation.handback": {
    "zh-CN": "交还主控",
    en: "Return to Kooyu",
    ja: "Kooyu に戻す",
  },
  "delegation.status.provisioning": { "zh-CN": "准备中", en: "Provisioning", ja: "準備中" },
  "delegation.status.running": { "zh-CN": "托管中", en: "Running", ja: "実行中" },
  "delegation.status.awaiting-review": {
    "zh-CN": "待审查",
    en: "Awaiting review",
    ja: "レビュー待ち",
  },
  "delegation.status.completed": { "zh-CN": "已完成", en: "Completed", ja: "完了" },
  "delegation.status.blocked": { "zh-CN": "已暂停", en: "Paused", ja: "一時停止" },
  "delegation.status.cancelled": { "zh-CN": "已撤销", en: "Cancelled", ja: "キャンセル" },
  "delegation.status.failed": { "zh-CN": "失败", en: "Failed", ja: "失敗" },

  "playbook.group": { "zh-CN": "主控剧本", en: "Playbooks", ja: "プレイブック" },
  "playbook.implReview": { "zh-CN": "实现与审查", en: "Build & review", ja: "実装とレビュー" },
  "playbook.parallel": { "zh-CN": "并行分工", en: "Parallel split", ja: "並列分担" },
  "playbook.ciGuard": { "zh-CN": "修 CI / 单测守护", en: "Fix CI & tests", ja: "CI・テスト修復" },
  "playbook.research": { "zh-CN": "深度联网调研", en: "Deep research", ja: "深掘り調査" },

  "git.title": { "zh-CN": "Git 交付", en: "Git delivery", ja: "Git 納品" },
  "git.worktrees": { "zh-CN": "可合入分支", en: "Ready branches", ja: "マージ可能なブランチ" },
  "git.mergeFf": { "zh-CN": "快进合入", en: "Fast-forward", ja: "FF マージ" },
  "git.mergeSquash": { "zh-CN": "压缩合入", en: "Squash", ja: "スカッシュ" },
  "git.abortMerge": { "zh-CN": "中止合入", en: "Abort merge", ja: "マージ中止" },
  "git.askAgentConflict": {
    "zh-CN": "交给 Agent 解决冲突",
    en: "Ask agent to resolve",
    ja: "Agent に競合解決を依頼",
  },
  "git.stageFile": { "zh-CN": "暂存文件", en: "Stage file", ja: "ステージ" },
  "git.unstageFile": { "zh-CN": "取消暂存", en: "Unstage", ja: "アンステージ" },
  "git.discardFile": { "zh-CN": "丢弃改动", en: "Discard file", ja: "変更を破棄" },
  "git.loadHunks": { "zh-CN": "逐块处理", en: "Hunks", ja: "ハンク選択" },
  "git.stageHunk": { "zh-CN": "暂存此块", en: "Stage hunk", ja: "この塊をステージ" },
  "git.discardHunk": { "zh-CN": "丢弃此块", en: "Discard hunk", ja: "この塊を破棄" },
  "git.confirmDiscard": {
    "zh-CN": "确认丢弃？此操作会还原工作区内容。",
    en: "Discard changes? This restores the workspace content.",
    ja: "変更を破棄しますか？作業ツリーの内容が元に戻ります。",
  },
  "git.confirmYes": { "zh-CN": "确认丢弃", en: "Discard", ja: "破棄する" },
  "git.suggestMsg": { "zh-CN": "智能生成", en: "Auto-write", ja: "自動生成" },
  "git.msgPlaceholder": {
    "zh-CN": "输入提交说明或 PR 标题…",
    en: "Commit message or PR title…",
    ja: "コミットメッセージまたは PR タイトル…",
  },
  "git.commit": { "zh-CN": "提交暂存", en: "Commit staged", ja: "コミット" },
  "git.createPr": { "zh-CN": "推送并建 PR", en: "Push & create PR", ja: "Push して PR 作成" },
  "git.done": { "zh-CN": "操作已完成", en: "Done", ja: "完了しました" },
  "git.noHunks": {
    "zh-CN": "没有可逐块处理的未暂存改动。",
    en: "No unstaged hunks available.",
    ja: "未ステージの差分ブロックはありません。",
  },

  "terminal.title": { "zh-CN": "交互式终端", en: "Interactive terminal", ja: "ターミナル" },
  "terminal.open": { "zh-CN": "打开终端", en: "Open terminal", ja: "ターミナルを開く" },
  "terminal.close": { "zh-CN": "关闭终端", en: "Close terminal", ja: "閉じる" },
  "terminal.quoteError": {
    "zh-CN": "引用末尾输出发给 Agent",
    en: "Send tail output to agent",
    ja: "末尾ログを Agent に送る",
  },

  "preview.code": { "zh-CN": "代码", en: "Code", ja: "コード" },
  "preview.live": { "zh-CN": "实时预览", en: "Live preview", ja: "ライブプレビュー" },
  "preview.devServer": {
    "zh-CN": "开发服务器预览",
    en: "Dev server preview",
    ja: "開発サーバープレビュー",
  },
  "preview.localPort": { "zh-CN": "本机端口", en: "Local port", ja: "ローカルポート" },
  "preview.openLink": { "zh-CN": "生成预览链接", en: "Open preview", ja: "プレビュー生成" },
  "preview.shareLink": {
    "zh-CN": "远程一次性链接",
    en: "One-time remote link",
    ja: "リモート一時リンク",
  },
  "preview.openTab": { "zh-CN": "新标签打开", en: "Open in tab", ja: "新しいタブで開く" },
  "preview.isolated": { "zh-CN": "隔离域打开", en: "Isolated origin", ja: "分離オリジンで開く" },
  "preview.sendConsoleErr": {
    "zh-CN": "将控制台报错发给 Agent",
    en: "Send console errors to agent",
    ja: "コンソールエラーを Agent に送る",
  },

  "browser.tabs": { "zh-CN": "标签页", en: "Tabs", ja: "タブ" },
  "browser.recordStart": { "zh-CN": "开始示教", en: "Record steps", ja: "操作を録画" },
  "browser.recordStop": { "zh-CN": "结束示教", en: "Stop recording", ja: "録画を終了" },
  "browser.annotate": { "zh-CN": "截图批注", en: "Annotate", ja: "スクリーンショット注釈" },
  "browser.downloadSkill": {
    "zh-CN": "下载 SKILL.md",
    en: "Download SKILL.md",
    ja: "SKILL.md を保存",
  },
  "browser.dailyTime": { "zh-CN": "每日执行时间", en: "Daily schedule", ja: "毎日の実行時刻" },
  "browser.createSchedule": { "zh-CN": "创建每日计划", en: "Schedule daily", ja: "毎日実行を作成" },
  "browser.scheduled": { "zh-CN": "计划已启用", en: "Scheduled", ja: "スケジュール済み" },

  "annotate.title": { "zh-CN": "截图批注", en: "Annotate image", ja: "画像注釈" },
  "annotate.pen": { "zh-CN": "画笔", en: "Pen", ja: "ペン" },
  "annotate.arrow": { "zh-CN": "箭头", en: "Arrow", ja: "矢印" },
  "annotate.rect": { "zh-CN": "矩形", en: "Box", ja: "四角" },
  "annotate.ellipse": { "zh-CN": "圆框", en: "Oval", ja: "楕円" },
  "annotate.undo": { "zh-CN": "撤销", en: "Undo", ja: "戻す" },
  "annotate.clear": { "zh-CN": "清空", en: "Clear", ja: "クリア" },
  "annotate.attach": { "zh-CN": "附带到消息", en: "Attach to chat", ja: "メッセージに添付" },
  "annotate.save": { "zh-CN": "保存 PNG", en: "Save PNG", ja: "PNG 保存" },

  "voiceCall.start": { "zh-CN": "开始语音通话", en: "Start voice call", ja: "音声通話を開始" },
  "voiceCall.end": { "zh-CN": "结束语音通话", en: "End voice call", ja: "音声通話を終了" },
  "voiceCall.opening": {
    "zh-CN": "正在打开麦克风…",
    en: "Opening mic…",
    ja: "マイクを開いています…",
  },
  "voiceCall.listening": { "zh-CN": "正在聆听…", en: "Listening…", ja: "聞き取り中…" },
  "voiceCall.speaking": {
    "zh-CN": "正在播报回复…",
    en: "Speaking reply…",
    ja: "応答を読み上げ中…",
  },

  "mailbox.send": {
    "zh-CN": "加密投递到离线信箱",
    en: "Send to offline mailbox",
    ja: "オフライン受信箱へ暗号送信",
  },
  "mailbox.sent": {
    "zh-CN": "已加密存入离线信箱，Host 恢复上线后自动送达。",
    en: "Encrypted and queued in offline mailbox for Host delivery.",
    ja: "暗号化してオフライン受信箱に保存しました。Host 復帰後に自動配送されます。",
  },

  "devices.permissions": { "zh-CN": "设备授权范围", en: "Device permissions", ja: "デバイス権限" },
  "devices.perm.goalsCheck": {
    "zh-CN": "运行检查与验收",
    en: "Run verification checks",
    ja: "検証チェックを実行",
  },
  "devices.perm.terminal": {
    "zh-CN": "访问交互式终端",
    en: "Interactive terminal access",
    ja: "ターミナルアクセス",
  },
  "devices.perm.gitPush": {
    "zh-CN": "推送分支与创建 PR",
    en: "Push branches & create PRs",
    ja: "ブランチ Push と PR 作成",
  },
  "devices.pushEnable": {
    "zh-CN": "启用浏览器推送",
    en: "Enable browser push",
    ja: "ブラウザ通知を有効化",
  },
  "devices.pushDisable": {
    "zh-CN": "关闭浏览器推送",
    en: "Disable browser push",
    ja: "ブラウザ通知をオフ",
  },

  "inbox.approveIntake": { "zh-CN": "批准并派发执行", en: "Approve & run", ja: "承認して実行" },
  "inbox.intakeApproved": {
    "zh-CN": "已派发至主对话",
    en: "Dispatched to main chat",
    ja: "メインチャットに送信済み",
  },

  "im.mode": { "zh-CN": "准入模式", en: "Admission mode", ja: "受付モード" },
  "im.mode.observe": { "zh-CN": "仅观察记录", en: "Observe only", ja: "記録のみ" },
  "im.mode.propose": {
    "zh-CN": "建议（待人工批准）",
    en: "Propose (approve in Inbox)",
    ja: "提案（受信箱で承認）",
  },
  "im.mode.auto": { "zh-CN": "自动派发执行", en: "Auto-dispatch", ja: "自動実行" },
  "im.groupChat": {
    "zh-CN": "群聊模式（未 @ 时 0-Token 静默缓存上下文）",
    en: "Group mode (0-token context buffer when not mentioned)",
    ja: "グループモード（メンション無しは文脈のみ蓄積）",
  },
} as const;

export type MessageKey = keyof typeof STRINGS;

export function resolveLocale(setting: string | undefined): Locale {
  if (setting === "zh-CN" || setting === "en" || setting === "ja") return setting;
  const nav = (typeof navigator !== "undefined" ? navigator.language : "zh-CN").toLowerCase();
  if (nav.startsWith("zh")) return "zh-CN";
  if (nav.startsWith("ja")) return "ja";
  return nav.startsWith("en") ? "en" : "zh-CN";
}

export function translate(locale: Locale, key: MessageKey): string {
  const entry = STRINGS[key] as Partial<Record<Locale, string>>;
  return entry[locale] ?? entry["zh-CN"] ?? key;
}

/** Translator for the language chosen in settings. */
export function useT() {
  const { settings } = useAppPreferences();
  const locale = resolveLocale(settings.language);
  return Object.assign((key: MessageKey) => translate(locale, key), { locale });
}
