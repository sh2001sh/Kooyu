# Changelog

All notable releases of **Kooyu** are documented in this file.

## v1.0.0 — 2026-11-22

First official stable release of **Kooyu** across Desktop (Windows, macOS Apple Silicon & Intel, Linux), Mobile (Android & iOS), and Web / npm CLI (`npx kooyu@latest`).

### Highlights / 核心更新

- **Personal AI Assistant & Workspace Brain**: Managed hot-reloaded Markdown workspace docs (`SOUL.md`, `USER.md`, `MEMORY.md`, `RULES.md`, `HEARTBEAT.md`, `AGENTS.md`, `ROUTING.md`), daily deterministic memory distillation, zero-vector local knowledge base search (`relativePath:line`), versioned cross-harness skills with 5-version rollback, and interactive multi-platform decision cards with rule learning.
- **Multi-Harness Orchestration, Smart Routing & Arena**: Unified control over 10+ coding harnesses (Claude Code, Codex, DeepSeek Harness, Gemini CLI, OpenCode, ZCode, Cursor, Kimi Code, Grok Build, pi), automatic `429` quota handoff, isolated Git worktree **Multi-Harness Arena** with real benchmark scorecards, and zero-pollution hidden Git checkpoints (`refs/kooyu/checkpoints/*`) with hunk-by-hunk diff review & PR delivery.
- **Zero-Token Preflight Automations & Frictionless Desktop UX**: Shell preflight scripts (`checkScript`) with ambient secret stripping (0 LLM tokens when idle), Harness Health Radar, Global Quick-Capture HUD (`Alt+Space` / `Cmd+Shift+K`) with IME composition guard, live web preview, built-in PTY terminal, and shared-login managed Chromium browser.
- **Full-Platform E2EE Sync & IM Channels**: Zero-knowledge E2EE pairing via **Kooyu Account** ([kooyu.app](https://kooyu.app)) and QR codes across Desktop, Web Workbench, Android, and iOS, plus Voice Conversations and WeChat / WeCom / Feishu / Telegram approval integration.
- **Production Polish & Stability Fixes**:
  - Reliable Windows in-app updater via ShellExecute with safe Host handoff, SHA-256 verification, and one-click "Open installer folder" fallback.
  - macOS hardened runtime (`disable-library-validation`) entitlement and Spotlight-resilient DMG packaging; Swift 6 & JOSESwift fixes on iOS; Android Material 3 polish and consistent upgrade signing.
  - Eliminated `ModelControls` / `DraftWorkspace` loading deadlocks, hardened Host HTTP keep-alive timeouts (`65s`), and fortified cross-platform process-tree teardown on POSIX and Windows.

## v0.2.1 (Preview Series) — 2026-11-14 to 2026-11-21

- Preview builds (`preview-0.2.1-5` through `preview-0.2.1-21`) establishing the npm Web CLI distribution (`kooyu`), official Kooyu rebrand, native Android & iOS companion apps, unified model provider hub with Claude Code 5-slot role mapping, and automated multi-platform GitHub Actions releases.
