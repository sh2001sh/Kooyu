import Foundation
import Observation
import SwiftUI

struct KooyuLanguageOption: Identifiable, Sendable {
    let code: String
    let label: String
    var id: String { code }
}

let kooyuLanguageOptions: [KooyuLanguageOption] = [
    KooyuLanguageOption(code: "system", label: "跟随系统 / System"),
    KooyuLanguageOption(code: "zh-CN", label: "简体中文"),
    KooyuLanguageOption(code: "en", label: "English"),
    KooyuLanguageOption(code: "ja", label: "日本語"),
]

func resolveKooyuLocale(_ setting: String?, systemLang: String = Locale.preferredLanguages.first ?? "zh-CN") -> String {
    if setting == "zh-CN" || setting == "en" || setting == "ja" { return setting! }
    let low = systemLang.lowercased()
    if low.hasPrefix("zh") { return "zh-CN" }
    if low.hasPrefix("ja") { return "ja" }
    if low.hasPrefix("en") { return "en" }
    return "zh-CN"
}

func kooyuLanguageLabel(_ code: String?) -> String {
    kooyuLanguageOptions.first { $0.code == code }?.label ?? kooyuLanguageOptions[0].label
}

private let kooyuStrings: [String: (zh: String, en: String, ja: String)] = [
    "dock.chats": ("对话", "Chats", "チャット"),
    "dock.projects": ("项目", "Projects", "プロジェクト"),
    "dock.usage": ("用量", "Usage", "使用量"),
    "dock.settings": ("设置", "Settings", "設定"),

    "settings.title": ("设置", "Settings", "設定"),
    "settings.section.remote": ("远程连接", "Remote Connection", "リモート接続"),
    "settings.section.workspace": ("工作台能力与资源", "Workspace & Engines", "ワークスペースとエンジン"),
    "settings.section.preferences": ("偏好与托管", "Preferences & Host", "環境設定とホスト"),
    "settings.section.about": ("关于", "About", "このアプリについて"),
    "settings.currentDevice": ("当前设备", "Current Device", "現在のデバイス"),
    "settings.connectionStatus": ("连接状态", "Status", "接続状態"),
    "settings.online": ("在线", "Online", "オンライン"),
    "settings.offline": ("离线 · 正在重连", "Offline · Reconnecting", "オフライン · 再接続中"),
    "settings.engines": ("执行引擎与安装状态", "Engines & Installations", "実行エンジンと状態"),
    "settings.providers": ("模型来源与绑定", "Model Sources & Bindings", "モデルソースと紐付け"),
    "settings.import": ("导入对话", "Import Chats", "チャットをインポート"),
    "settings.memory": ("记忆与约定", "Memory & Rules", "記憶とルール"),
    "settings.usage": ("用量与预算", "Usage & Budgets", "使用量と予算"),
    "settings.projects": ("项目与目录", "Projects & Folders", "プロジェクトとフォルダ"),
    "settings.general": ("通用与外观", "General & Appearance", "一般と外観"),
    "settings.host": ("托管管理", "Host Controls", "ホスト管理"),
    "settings.notifications": ("后台提醒", "Background Alerts", "バックグラウンド通知"),
    "settings.version": ("版本", "Version", "バージョン"),
    "settings.language": ("界面语言", "Interface Language", "表示言語"),
    "settings.language.hint": ("切换后立即生效并同步到已配对 Host", "Applies immediately and syncs with Host", "即座に反映され Host と同期されます"),
    "settings.defaultConfig": ("默认配置", "Default Settings", "既定の設定"),
    "settings.defaultEngine": ("默认引擎", "Default Engine", "既定のエンジン"),
    "settings.saved": ("已保存", "Saved", "保存済み"),
    "settings.saveInstructions": ("保存指令", "Save Instructions", "指示を保存"),

    "import.title": ("导入对话", "Import Chats", "チャットをインポート"),
    "import.allProjects": ("全部项目", "All Projects", "すべてのプロジェクト"),
    "import.allEngines": ("全部引擎", "All Engines", "すべてのエンジン"),
    "import.scan": ("重新扫描", "Rescan", "再スキャン"),
    "import.scanning": ("正在扫描本机引擎对话…", "Scanning local engine chats…", "ローカル履歴をスキャン中…"),
    "import.selectAll": ("全选未导入", "Select All", "未取込を全選択"),
    "import.clear": ("取消全选", "Clear", "解除"),
    "import.importedTag": ("已导入", "Imported", "取込済み"),
    "import.unassigned": ("未匹配项目", "Unassigned", "未割当"),
    "import.importBtn": ("导入所选对话", "Import Selected", "選択したチャットを取込"),
    "import.importing": ("正在导入…", "Importing…", "インポート中…"),
    "import.empty": ("未发现可导入的本地对话", "No importable local chats found", "インポート可能な履歴が見つかりません"),
    "import.done": ("已成功导入", "Imported", "インポート完了"),

    "voice.start": ("语音输入", "Voice input", "音声入力"),
    "voice.stop": ("完成语音输入", "Finish voice input", "音声入力を完了"),
    "voice.cancel": ("取消录音", "Cancel", "キャンセル"),
    "voice.listening": ("正在聆听…", "Listening…", "聞き取り中…"),
    "voice.err.permission": ("请在系统设置中允许麦克风与语音识别权限", "Allow microphone and speech recognition in Settings", "設定でマイクと音声認識を許可してください"),
    "voice.err.unavailable": ("当前设备暂不可用语音识别", "Speech recognition is unavailable right now", "現在、音声認識を利用できません"),

    "update.title": ("软件更新", "Software Update", "ソフトウェアアップデート"),
    "update.check": ("检查更新", "Check for Updates", "アップデートを確認"),
    "update.checking": ("正在检查更新…", "Checking for updates…", "確認中…"),
    "update.upToDate": ("已是最新版本", "Up to date", "最新です"),
    "update.available": ("发现新版本", "Update available", "新しいバージョン"),
    "update.channel": ("更新通道", "Release Channel", "更新チャネル"),
    "update.channel.stable": ("正式版", "Stable", "安定版"),
    "update.channel.preview": ("预览版", "Preview", "プレビュー"),
    "update.openRelease": ("打开发布页 / 下载", "Open Release Page", "リリースページを開く"),
    "update.hostVersion": ("电脑端 Host 版本", "Desktop Host Version", "デスクトップ Host バージョン"),
]

@MainActor func kooyuT(_ key: String, locale: String? = nil) -> String {
    let active = locale ?? LanguageStore.shared.resolvedLocale
    guard let entry = kooyuStrings[key] else { return key }
    switch active {
    case "en": return entry.en
    case "ja": return entry.ja
    default: return entry.zh
    }
}

@MainActor @Observable final class LanguageStore {
    static let shared = LanguageStore()
    private static let storageKey = "kooyu.language"

    var setting: String {
        didSet {
            UserDefaults.standard.set(setting, forKey: Self.storageKey)
            revision += 1
        }
    }
    var revision: Int = 0

    var resolvedLocale: String { resolveKooyuLocale(setting) }

    private init() {
        self.setting = UserDefaults.standard.string(forKey: Self.storageKey) ?? "system"
    }

    func syncFromHost(_ value: String?) {
        guard let value, ["system", "zh-CN", "en", "ja"].contains(value), value != setting else { return }
        setting = value
    }
}
