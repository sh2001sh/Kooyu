package app.kooyu.android.ui.theme

import android.content.Context
import androidx.compose.runtime.*
import java.util.Locale

data class KooyuLanguageOption(val code: String, val label: String)

val KOOYU_LANGUAGES = listOf(
    KooyuLanguageOption("system", "跟随系统 / System"),
    KooyuLanguageOption("zh-CN", "简体中文"),
    KooyuLanguageOption("en", "English"),
    KooyuLanguageOption("ja", "日本語"),
)

fun resolveKooyuLocale(setting: String?, systemLang: String = Locale.getDefault().language): String {
    if (setting == "zh-CN" || setting == "en" || setting == "ja") return setting
    val low = systemLang.lowercase(Locale.ROOT)
    return when {
        low.startsWith("zh") -> "zh-CN"
        low.startsWith("ja") -> "ja"
        low.startsWith("en") -> "en"
        else -> "zh-CN"
    }
}

fun kooyuLanguageLabel(code: String?): String =
    KOOYU_LANGUAGES.firstOrNull { it.code == code }?.label ?: KOOYU_LANGUAGES.first().label

private val STRINGS: Map<String, Triple<String, String, String>> = mapOf(
    // (zh-CN, en, ja)
    "dock.chats" to Triple("对话", "Chats", "チャット"),
    "dock.projects" to Triple("项目", "Projects", "プロジェクト"),
    "dock.usage" to Triple("用量", "Usage", "使用量"),
    "dock.settings" to Triple("设置", "Settings", "設定"),

    "settings.title" to Triple("设置", "Settings", "設定"),
    "settings.section.workspace" to Triple("引擎与工作区", "Engines & Workspace", "エンジンとワークスペース"),
    "settings.section.preferences" to Triple("偏好与系统", "Preferences & System", "環境設定とシステム"),
    "settings.workhub" to Triple("工作与计划", "Work & Plans", "ワークと計画"),
    "settings.workhub.detail" to Triple("目标 · 成果 · 自动计划", "Goals · Artifacts · Schedules", "目標 · 成果 · 自動計画"),
    "settings.engines" to Triple("执行引擎与安装状态", "Engines & Installations", "実行エンジンと状態"),
    "settings.providers" to Triple("模型来源与绑定", "Model Sources & Bindings", "モデルソースと紐付け"),
    "settings.import" to Triple("导入对话", "Import Chats", "チャットをインポート"),
    "settings.import.detail" to Triple("按项目挑选导入本机引擎历史", "Select local engine chats by project", "プロジェクト別にローカル履歴を取込"),
    "settings.memory" to Triple("记忆与约定", "Memory & Rules", "記憶とルール"),
    "settings.usage" to Triple("用量与预算", "Usage & Budgets", "使用量と予算"),
    "settings.projects" to Triple("项目与目录", "Projects & Folders", "プロジェクトとフォルダ"),
    "settings.host" to Triple("托管管理", "Host Controls", "ホスト管理"),
    "settings.general" to Triple("通用与外观", "General & Appearance", "一般と外観"),
    "settings.general.detail" to Triple("语言 · 主题 · 颜色 · 默认配置", "Language · Theme · Color · Defaults", "言語 · テーマ · 色 · 既定値"),
    "settings.language" to Triple("界面语言", "Interface Language", "表示言語"),
    "settings.language.hint" to Triple("切换后立即生效并同步到 Host", "Applies immediately and syncs with Host", "即座に反映され Host と同期されます"),
    "settings.help" to Triple("帮助与反馈", "Help & Feedback", "ヘルプとフィードバック"),
    "settings.about" to Triple("关于", "About", "このアプリについて"),
    "settings.online" to Triple("在线 · 实时同步", "Online · Live Sync", "オンライン · 同期中"),
    "settings.offline" to Triple("离线", "Offline", "オフライン"),
    "settings.saved" to Triple("已保存", "Saved", "保存済み"),
    "settings.defaultConfig" to Triple("默认对话配置", "Default Chat Settings", "既定のチャット設定"),
    "settings.defaultEngine" to Triple("默认引擎", "Default Engine", "既定のエンジン"),
    "settings.instructions" to Triple("全局个人指令", "Global Personal Instructions", "グローバル個人指示"),

    "import.title" to Triple("导入对话", "Import Chats", "チャットをインポート"),
    "import.allProjects" to Triple("全部项目", "All Projects", "すべてのプロジェクト"),
    "import.allEngines" to Triple("全部引擎", "All Engines", "すべてのエンジン"),
    "import.scan" to Triple("重新扫描", "Rescan", "再スキャン"),
    "import.scanning" to Triple("正在扫描本机引擎对话…", "Scanning local engine chats…", "ローカル履歴をスキャン中…"),
    "import.selectAll" to Triple("全选未导入", "Select All", "未取込を全選択"),
    "import.clear" to Triple("取消全选", "Clear", "解除"),
    "import.importedTag" to Triple("已导入", "Imported", "取込済み"),
    "import.unassigned" to Triple("未匹配项目", "Unassigned", "未割当"),
    "import.importBtn" to Triple("导入所选对话", "Import Selected", "選択したチャットを取込"),
    "import.importing" to Triple("正在导入…", "Importing…", "インポート中…"),
    "import.empty" to Triple("未发现可导入的本地对话", "No importable local chats found", "インポート可能な履歴が見つかりません"),
    "import.done" to Triple("导入完成", "Import complete", "インポート完了"),

    "voice.start" to Triple("语音输入", "Voice input", "音声入力"),
    "voice.stop" to Triple("完成语音输入", "Finish voice input", "音声入力を完了"),
    "voice.cancel" to Triple("取消录音", "Cancel", "キャンセル"),
    "voice.listening" to Triple("正在聆听…", "Listening…", "聞き取り中…"),
    "voice.err.permission" to Triple("需要麦克风权限才能使用语音输入", "Microphone permission is required for voice input", "音声入力にはマイク権限が必要です"),
    "voice.err.unavailable" to Triple("当前设备未安装系统语音识别服务", "System speech recognition is unavailable on this device", "この端末で音声認識サービスが利用できません"),

    "update.title" to Triple("软件更新", "Software Update", "ソフトウェアアップデート"),
    "update.check" to Triple("检查更新", "Check for Updates", "アップデートを確認"),
    "update.checking" to Triple("正在检查更新…", "Checking for updates…", "確認中…"),
    "update.upToDate" to Triple("已是最新版本", "Up to date", "最新です"),
    "update.available" to Triple("发现新版本", "Update available", "新しいバージョン"),
    "update.channel.stable" to Triple("正式版", "Stable", "安定版"),
    "update.channel.preview" to Triple("预览版", "Preview", "プレビュー"),
    "update.downloadInstall" to Triple("下载并安装更新", "Download & Install", "ダウンロードしてインストール"),
    "update.installNow" to Triple("立即安装", "Install Now", "今すぐインストール"),
    "update.downloading" to Triple("正在下载安装包…", "Downloading APK…", "ダウンロード中…"),
    "update.verified" to Triple("SHA-256 已校验", "SHA-256 Verified", "SHA-256 検証済み"),
    "update.openRelease" to Triple("打开 GitHub 发布页", "Open Release Page", "リリースページを開く"),
    "update.allowUnknown" to Triple("请先在系统设置中允许 Kooyu 安装应用更新，返回后再次点击安装。", "Allow Kooyu to install app updates in system settings, then tap Install again.", "設定でアプリ更新のインストールを許可してから再度タップしてください。"),
)

fun kooyuTranslate(locale: String, key: String): String {
    val entry = STRINGS[key] ?: return key
    return when (locale) {
        "en" -> entry.second
        "ja" -> entry.third
        else -> entry.first
    }
}

val LocalKooyuLocale = compositionLocalOf { "zh-CN" }

@Composable fun kooyuT(key: String): String = kooyuTranslate(LocalKooyuLocale.current, key)

object KooyuLanguageStore {
    private const val PREFS = "kooyu_i18n"
    private const val KEY = "language"

    var setting by mutableStateOf("system")
        private set

    fun init(context: Context) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        setting = prefs.getString(KEY, "system") ?: "system"
    }

    fun update(context: Context, next: String) {
        val clean = if (next in setOf("system", "zh-CN", "en", "ja")) next else "system"
        setting = clean
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, clean).apply()
    }
}
