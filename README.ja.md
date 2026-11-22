<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="brand/icons/kooyu-app-dark.svg" />
  <source media="(prefers-color-scheme: light)" srcset="brand/icons/kooyu-app.svg" />
  <img src="brand/icons/kooyu-app.svg" width="96" height="96" alt="Kooyu アプリアイコン" />
</picture>

<br />

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="brand/logos/kooyu-wordmark-white.svg" />
  <source media="(prefers-color-scheme: light)" srcset="brand/logos/kooyu-wordmark.svg" />
  <img src="brand/logos/kooyu-wordmark.svg" height="44" alt="Kooyu" />
</picture>

<h3>すべてのコーディングエンジンを操る、ローカルファーストのパーソナル AI アシスタント</h3>

<p>
  <strong>Claude Code</strong>、<strong>Codex</strong>、<strong>DeepSeek</strong>、<strong>Gemini CLI</strong>、<strong>Google Antigravity</strong>、<strong>OpenCode</strong>、<strong>Cursor</strong>、<strong>ZCode</strong>、<strong>Kimi Code</strong> などの開発エンジンをひとつのパーソナル AI アシスタントに統合。スマートルーティング・制限時自動リレー、隔離 Worktree 競技場、ローカル永続記憶、ゼロトークン見守りを備え、デスクトップ・Web・iOS・Android・IM からいつでも制御できます。
</p>

<p>
  <a href="https://kooyu.app">
    <img src="https://img.shields.io/badge/Website-kooyu.app-E6533C?style=flat-square" alt="公式サイト" />
  </a>
  <a href="https://www.npmjs.com/package/kooyu">
    <img src="https://img.shields.io/npm/v/kooyu?style=flat-square&label=npm&color=141518" alt="npm CLI" />
  </a>
  <a href="https://github.com/sh2001sh/Kooyu/releases/latest">
    <img src="https://img.shields.io/github/v/release/sh2001sh/Kooyu?style=flat-square&label=Release&color=F17561" alt="最新安定版リリース" />
  </a>
  <a href="https://github.com/sh2001sh/Kooyu/actions/workflows/native-apps.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/sh2001sh/Kooyu/native-apps.yml?branch=main&style=flat-square&label=CI%20%26%20Build" alt="CI ステータス" />
  </a>
  <img src="https://img.shields.io/badge/Platforms-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Android%20%7C%20iOS%20%7C%20Web-141518?style=flat-square" alt="対応プラットフォーム" />
  <a href="LICENSE">
    <img src="https://img.shields.io/github/license/sh2001sh/Kooyu?style=flat-square&color=10A37F" alt="MIT ライセンス" />
  </a>
</p>

<p>
  🌐 <strong>公式サイト</strong>：<a href="https://kooyu.app"><strong>https://kooyu.app</strong></a> ·
  <a href="https://kooyu.app/download">ダウンロード</a> ·
  <a href="https://kooyu.app/docs">ドキュメント</a> ·
  <a href="https://kooyu.app/account">Web ワークベンチ</a> ·
  <a href="CHANGELOG.md">変更履歴</a>
</p>

<p>
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <strong>日本語</strong>
</p>

<p>
  <a href="#-クイックスタートとダウンロード">ターミナル導入・ダウンロード</a> ·
  <a href="#-主な特徴">主な特徴</a> ·
  <a href="#-対応エンジン">対応エンジン</a> ·
  <a href="#-インストール手順">インストール</a> ·
  <a href="#-マルチデバイスe2ee-連携">リモート連携</a> ·
  <a href="#-ソースからビルド">ソースビルド</a>
</p>

<br />

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/dark-workspace.png" />
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/hero-showcase.png" />
  <img src="docs/assets/hero-showcase.png" width="100%" alt="Kooyu デスクトップおよびモバイルワークスペース" />
</picture>

</div>

---

## ✨ 主な特徴

### マルチ Harness 指揮とエンジニアリング基盤
- **1 つの主控で 11+ コーディングエンジンを統括** — **Claude Code**、**Codex**、**DeepSeek Harness**、**Gemini CLI**、**Google Antigravity**、**OpenCode**、**ZCode**、**Cursor**、**Kimi Code**、**Grok Build**、**pi** と直接対話でき、複雑な要件は内蔵の **Kooyu スーパーバイザー**へ委譲可能。実装＋別エンジンレビュー、並列分割、CI ガード、深掘り調査などのプレイブックを搭載。
- **スマートルーティング & 429 レート制限自動リレー（`ROUTING.md`）** — タスク種別に応じて最適なエンジンを自動選択。`429` やクォータ上限に達した場合、進捗と差分をまとめて次の予備エンジンへシームレスに引き継ぎます。
- **マルチエンジン競技場（Multi-Harness Arena）** — 2〜3 種類のエンジンへ隔離 Git Worktree 上で同一課題を並列出題。実 `git diff` とテストコマンド（`checkCommand`）によるスコアカードを比較し、勝者ブランチをワンクリック採用できます。
- **無痕 Git チェックポイント & ワンクリック PR 交付** — 隠し参照（`refs/kooyu/checkpoints/*`）へ追跡・未追跡ファイルのスナップショットを保存し、`git log` や stash を汚さず即座に復元可能（復元前の保護スナップショット自動作成）。Hunk 単位の差分確認からマージ・PR 作成まで完結します。

### 使うほどあなたに馴染むパーソナル AI アシスタント
- **ローカルワークスペース文書と永続記憶** — `SOUL.md`、`USER.md`、`MEMORY.md`、`RULES.md`、`HEARTBEAT.md`、`AGENTS.md`、`ROUTING.md` をターンごとにホットリロード。Desktop / Web / Android / iOS の設定画面から直接編集できます。
- **全端末対応の確認カードとルール学習** — 重要な判断時は構造化カードで確認。「今後も自動適用」を選ぶと `RULES.md` へ即座に保存され、次回から反映されます。
- **ベクトル DB 不要のローカル知識ベース & 日次記憶蒸留** — 手元の Obsidian Vault や `docs/` を読み取り専用マウントし、`relativePath:line` 単位で正確に検索。日次ログからの経験抽出も決定論的に実行し、承認後に長期記憶へ統合します。
- **クロスエンジン・スキル蓄積（5世代復元）& オフラインレポート** — 成功ワークフローをバージョン付きスキルとして保存し、`~/.agents/skills/` 経由で他エンジンとも共有可能。厳格なオフライン CSP 付きの構造化レポート（`show_page`）も生成できます。
- **ゼロトークン事前チェック & 稼働レーダー** — 自動化タスクはローカル事前スクリプト（`checkScript`）を先に実行し、異常がない間は **0 トークン**でスキップ。スタック検知や `NO_REPLY` による静音ターン制御も搭載。

### 快適なデスクトップ体験と全端末 E2EE 連携
- **グローバル起動カプセル（`Alt+Space` / `Cmd+Shift+K`）** — どのアプリ作業中でもショートカット一つでフローティング入力を呼び出し、クリップボード内容をそのまま Kooyu へ送信可能。
- **ライブプレビュー・内蔵 PTY 端末・ログイン共有管理ブラウザ** — プレビューのコンソールエラーを即座にエージェントへ連携。管理 Chromium でログインした Cookie は安全にローカル保存（`0600`）され、後続タスク間で自動共有されます。
- **ゼロ知識 E2EE 同期 & IM 承認** — Kooyu アカウント（[kooyu.app](https://kooyu.app)）による PC 自動検出、iOS / Android の QR・ログイン両対応、音声通話・スクショ注釈、**WeChat・WeCom・Feishu・Telegram** からの承認に対応。
- **統合モデルハブ & 透明なコスト台帳** — 既存 CLI 設定を汚さずに 5 ロールモデル割り当て（Claude Code 対応）を一元管理し、トークン量・概算コスト・初回応答時間（TTFT）を可視化。

<div align="center">
  <img src="docs/assets/features-overview.png" width="100%" alt="モデルプロバイダー設定と使用量・応答速度分析" />
  <br />
  <sub>左：統合モデルハブとエンジン別ロール割り当て · 右：プロジェクト・エンジン・モデル別の使用量・コスト・TTFT 台帳</sub>
</div>

<details>
<summary><strong>ライトモード / ダークモードのワークスペースを見る</strong></summary>
<br />
<p align="center">
  <img src="docs/assets/hero-showcase.png" width="49%" alt="Kooyu ライトモード" />
  <img src="docs/assets/dark-workspace.png" width="49%" alt="Kooyu ダークモード" />
</p>
</details>

---

## 🤖 対応エンジン

インストール済みの CLI ツールやデスクトップアプリを自動検出し、各エンジンのネイティブ履歴・権限・ログイン状態を保ったまま連携します。

| エンジン | 役割 | カスタムプロバイダー対応 | 自動検出 |
| :--- | :--- | :---: | :---: |
| **Kooyu** | 内蔵パーソナル AI アシスタント & スーパーバイザー | ✅ | 内蔵 |
| **Claude Code** | ネイティブエージェント | ✅（5 スロットロール割当） | ✅ |
| **Codex** | ネイティブエージェント | ✅ | ✅ |
| **DeepSeek Harness** | ネイティブエージェント | ✅ | ✅ |
| **Gemini CLI** | ネイティブエージェント | ✅ | ✅ |
| **Google Antigravity** | ネイティブエージェント（`agy acp`） | ネイティブ認証（専用プロキシ対応） | ✅ |
| **OpenCode** | ネイティブエージェント | ✅ | ✅ |
| **ZCode** | ネイティブエージェント | ✅ | ✅ |
| **Cursor** | ネイティブエージェント | ネイティブ認証 | ✅ |
| **Kimi Code** | ネイティブエージェント | ✅ | ✅ |
| **Grok Build** | ネイティブエージェント | ✅ | ✅ |
| **pi** | スタンドアロンエージェント | ✅ | 内蔵 |

> 詳細は [docs/harness-catalog.md](docs/harness-catalog.md) および [docs/provider-configuration.md](docs/provider-configuration.md) を参照してください。

---

## 📦 クイックスタートとダウンロード

> 🌐 **公式サイト・ダウンロード**：**[https://kooyu.app](https://kooyu.app)** · **[kooyu.app/download](https://kooyu.app/download)** · **[kooyu.app/docs](https://kooyu.app/docs)**

### ⚡ ターミナルからのインストールと起動（Node.js `>= 24.13.0`）

```bash
# 1. インストール不要で即時起動（最新安定版）
npx kooyu@latest

# 2. グローバルインストールして kooyu コマンドとして利用
npm install -g kooyu@latest
kooyu

# 3. プレビュー版を試す
npx kooyu@next
```

主な CLI コマンド：

```bash
kooyu --port 4310                    # ポート指定（既定: 4310）
kooyu --data-dir ./kooyu-data        # データディレクトリ指定
kooyu account login                  # Kooyu アカウントへ紐付け（kooyu.app からリモート接続）
kooyu account logout                 # アカウント紐付け解除
kooyu --help                         # ヘルプ表示
```

### 💻 ネイティブインストーラー

全プラットフォーム向けインストーラーは [**GitHub Releases（最新安定版）**](https://github.com/sh2001sh/Kooyu/releases/latest) および [**kooyu.app/download**](https://kooyu.app/download) から取得できます。

| プラットフォーム | アーキテクチャ / 形式 | ダウンロード |
| :--- | :--- | :--- |
| **Windows** | x64 インストーラー（`.exe`） | [最新安定版](https://github.com/sh2001sh/Kooyu/releases/latest) |
| **macOS** | Apple Silicon M1–M4 / Intel x64（`.dmg` / `.zip`） | [最新安定版](https://github.com/sh2001sh/Kooyu/releases/latest) |
| **Linux** | x64（`.AppImage` / `.deb`） | [最新安定版](https://github.com/sh2001sh/Kooyu/releases/latest) |
| **Android** | ユニバーサル APK（`.apk`） | [最新安定版](https://github.com/sh2001sh/Kooyu/releases/latest) |
| **iOS** | Apple Silicon シミュレーター（`.zip`） / Xcode ビルド | [最新安定版](https://github.com/sh2001sh/Kooyu/releases/latest) |
| **Web / CLI** | ローカル Host + ブラウザワークベンチ | `npx kooyu@latest` |

> アプリ内の **設定 → 一般 → ソフトウェア更新** から、SHA-256 自動検証付きダウンロード・インストーラー起動（または保存フォルダを開く）・**安定版 / プレビュー版** チャンネル切替が行えます。

---

## 🚀 インストール手順

### Windows

1. [GitHub Releases](https://github.com/sh2001sh/Kooyu/releases/latest) から **`Kooyu-Setup-<version>.exe`** をダウンロードして実行します。
2. デスクトップ版は未署名のため、初回起動時に SmartScreen が表示された場合は **「詳細情報 → 実行」** を選択してください（詳細は [docs/windows-installation.md](docs/windows-installation.md)）。
3. 起動後はどの画面からでも **`Alt + Space`** でクイックカプセルを呼び出せます。上書き更新してもローカル履歴と設定は自動で保持されます。

### macOS

1. 対応アーキテクチャの `.dmg`（Apple Silicon は `arm64`、Intel は x64）を開き、**Kooyu.app** を **Applications** へドラッグします。
2. Apple 公証は未設定のため、初回起動前にターミナルで隔離属性を解除してください：
   ```bash
   xattr -cr /Applications/Kooyu.app
   ```
3. 起動後はどの画面からでも **`Cmd + Shift + K`** でクイックカプセルを呼び出せます。

### Linux

```bash
# AppImage
chmod +x Kooyu-*.AppImage
./Kooyu-*.AppImage

# Debian / Ubuntu (.deb)
sudo apt install ./kooyu_*_amd64.deb
```

### Android & iOS

- **Android**：`Kooyu-*-android-debug.apk` をインストール（一貫した署名鍵によりペアリング設定を保持したまま上書き更新可能）。Kooyu アカウントまたはデスクトップの QR コードで接続します。
- **iOS**：Apple Silicon Mac では `Kooyu-*-ios-simulator.zip` をシミュレーターで実行でき、実機ビルドは Xcode から自身の Apple 開発者アカウントで署名できます（詳細は [apps/ios/README.md](apps/ios/README.md)）。

### ダウンロード検証（SHA-256）

```bash
# macOS / Linux
shasum -a 256 -c SHA256SUMS.txt --ignore-missing
```

```powershell
# Windows PowerShell
Get-FileHash .\Kooyu-Setup-1.0.1.exe -Algorithm SHA256
```

---

## 📱 マルチデバイス・E2EE 連携

ポート開放や VPN 設定なしで、別の PC、[Web ワークベンチ](https://kooyu.app/account)、Android・iOS、IM から安全に接続できます：

1. ホスト PC を Kooyu アカウントに紐付けるか、**設定 → デバイス → ペアリングコードを生成** で QR コードを発行します。
2. すべての通信はエンドツーエンド暗号化（E2EE）され、新規端末の接続はホスト PC での明示承認が必須です。
3. セルフホスト構成は `deploy/` のテンプレートおよび [docs/mobile-relay.md](docs/mobile-relay.md)・[docs/self-hosted-operations.md](docs/self-hosted-operations.md) を参照してください。

---

## 🧱 アーキテクチャ

```mermaid
flowchart LR
  subgraph Clients["マルチプラットフォームクライアント & IM"]
    Desktop["デスクトップ + クイックカプセル\n(Windows · macOS · Linux)"]
    Mobile["モバイル & Web ワークベンチ\n(Android · iOS · PWA)"]
    IM["IM チャネル\n(WeChat · WeCom · Feishu · Telegram)"]
  end

  Bridge["ゼロ知識 E2EE 暗号化リレー\n(アカウント検出 / セルフホスト)"]

  subgraph Host["独立ローカル Session Host"]
    API["ワークスペース API & ライブストリーム"]
    Supervisor["Kooyu パーソナル AI アシスタント\n(文書 · 永続記憶 · スキル · 見守りレーダー)"]
    Router["スマートルーティング · 429 リレー · 競技場"]
    Adapters["11+ ネイティブエージェント"]
    Tools["Worktree · Git スナップショット · プレビュー\n内蔵端末 · 共有セッションブラウザ · ローカル KB"]
    Storage[("ローカル SQLite · Markdown 文書 · OS 鍵ストア")]
  end

  Desktop --> API
  Mobile --> Bridge --> API
  IM --> API
  API --> Supervisor
  Supervisor --> Router --> Adapters
  API --> Tools
  API --> Storage
```

### リポジトリ構成

| パス | 説明 |
| :--- | :--- |
| `apps/desktop` | Electron デスクトップシェル、常駐トレイ、クイックカプセル HUD、リモート接続・自動更新 |
| `apps/web` | クロスプラットフォーム Web ワークベンチ UI、確認カード、Git/PR 交付、ライブプレビュー、内蔵端末、Playwright テスト |
| `apps/android` | Android ネイティブアプリ（Kotlin / Jetpack Compose / Material 3 / APK アップデーター） |
| `apps/ios` | iOS ネイティブアプリ（Swift / SwiftUI / XcodeGen） |
| `packages/host` | 独立ローカル Session Host、文書・記憶蒸留、スキル蓄積、ローカル KB、ルーティング/競技場、Git チェックポイント、管理ブラウザ、IM・プロバイダーハブ |
| `packages/protocol` | 全クライアントと Host 間で共有されるプロトコル Schema と TypeScript 型定義 |
| `packages/platform` | クロスプラットフォームディレクトリ規約（`Kooyu/host`、旧 `Kodo/host` 互換）・Host 検出ユーティリティ |
| `services/relay` | セルフホスト可能な軽量 HTTPS/WSS E2EE ペアリング・オフライン信箱リレー |
| `deploy/` | Docker / Compose / Caddy / systemd セルフホスト用テンプレート |
| `brand/` | Kooyu 公式 SVG ロゴ・アプリアイコン・デザイントークン |
| `docs/` | アーキテクチャ・対応エンジン一覧・プロバイダー設定・セルフホスト・リリースガイド |

---

## 🛠️ ソースからビルド

### 動作要件

- **Node.js `>= 24.13.0`** および **npm `11+`**
- 対応コーディングエージェントのいずれか（または Kooyu 内で直接 API プロバイダーを設定）

### ローカル開発と起動

```bash
git clone https://github.com/sh2001sh/Kooyu.git
cd Kooyu
npm ci
npm run build

# デスクトップアプリ起動（独立ローカル Host を自動起動・再利用）
npm run start:desktop

# Web ワークベンチのみ起動 (http://127.0.0.1:4310)
npm run start:host
# フロントエンドのホットリロード開発：
npm run dev:web
```

### インストーラーのパッケージング

```bash
# 現在の OS 向けデスクトップインストーラー（出力先: release/desktop/）
npm run package:desktop -- --publish never

# Android APK（JDK 17 + Android SDK 36 が必要）
cd apps/android && ./gradlew testDebugUnitTest lintDebug assembleDebug

# iOS シミュレーター（macOS + Xcode 16 + XcodeGen が必要）
cd apps/ios && xcodegen generate
xcodebuild -project Kooyu.xcodeproj -scheme Kooyu -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

### テストと検証スイート

```bash
npm run lint
npm run format:check
npm run typecheck
npm test              # Host ユニット・統合テスト
npm run test:relay    # リレーセキュリティ・信箱テスト
npm run test:platform # Host 検出・ランチャーテスト
npm run test:ui       # Playwright UI 回帰テスト
```

### データディレクトリと環境変数

| OS | 既定の Host データディレクトリ |
| :--- | :--- |
| **Windows** | `%LOCALAPPDATA%\Kooyu\host` |
| **macOS** | `~/Library/Application Support/Kooyu/host` |
| **Linux** | `${XDG_DATA_HOME:-~/.local/share}/Kooyu/host` |

> 環境変数は `KOOYU_*`（`KOOYU_DATA_DIR`、`KOOYU_HOST_PORT`、`KOOYU_HOST_URL`、`KOOYU_RELAY_ORIGIN`、`KOOYU_QUICK_CAPTURE_SHORTCUT`）を既定とし、既存の `Kodo/host` ディレクトリや `KODO_*` 環境変数も自動互換で引き継ぎます。

---

## 🔒 セキュリティとプライバシー

- **ローカルファースト設計** — コード、会話履歴、長期記憶、マウント知識ベース、使用量データはすべてローカル端末に保存され、Host は既定で `127.0.0.1` のみで待機します。
- **OS ネイティブのシークレット保管** — API キーや OAuth トークンは OS 認証情報ストア（`Kooyu` サービス）に保管され、事前チェックやテスト実行時は機密環境変数を自動除外します。
- **既存 CLI 設定を非破壊で保護** — プロバイダー設定やモデルマッピングはセッション単位で分離適用され、`~/.claude` や `~/.codex` などの既存設定を上書きしません。
- **段階的なリモート権限管理** — ローカル MCP や IM 認証情報の管理はホスト本機のみに限定され、対話ターミナルやリモート Git Push は明示的に許可されたデバイスのみ利用できます。

---

## 📄 ライセンスと謝辞

[**MIT License**](LICENSE) のもとで公開されています。

- 公式サイト・ドキュメント：[https://kooyu.app](https://kooyu.app)
- 変更履歴：[CHANGELOG.md](CHANGELOG.md)
- ランタイム依存・サードパーティライセンス：[third-party/runtime-dependencies.md](third-party/runtime-dependencies.md)
- モデルカタログ出典：[third-party/models.dev/NOTICE.md](third-party/models.dev/NOTICE.md)
- デザイントークン出典：[third-party/craft-agents/EXTRACTION.md](third-party/craft-agents/EXTRACTION.md)

## コミュニティ・リンク

- [LINUX DO](https://linux.do) - 新的理想型社区
