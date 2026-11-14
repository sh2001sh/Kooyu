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
  "nav.general": { "zh-CN": "通用", en: "General", ja: "一般" },
  "nav.engines": { "zh-CN": "引擎", en: "Engines", ja: "エンジン" },
  "nav.providers": { "zh-CN": "模型来源", en: "Model sources", ja: "モデルソース" },
  "nav.usage": { "zh-CN": "用量", en: "Usage", ja: "使用量" },
  "nav.devices": { "zh-CN": "手机连接", en: "Devices", ja: "デバイス" },
  "nav.advanced": { "zh-CN": "高级", en: "Advanced", ja: "詳細" },
  "nav.group.preferences": { "zh-CN": "偏好", en: "Preferences", ja: "環境設定" },
  "nav.group.models": { "zh-CN": "引擎与模型", en: "Engines & models", ja: "エンジンとモデル" },
  "nav.group.account": { "zh-CN": "数据与设备", en: "Data & devices", ja: "データとデバイス" },

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
