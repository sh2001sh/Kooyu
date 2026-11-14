---
name: Kooyu Workbench
description: A quiet, local session workbench combining Kooyu's Sunset Coral brand identity with a two-column iOS/iPadOS surface language, inset cards, and spring motion physics.
colors:
  accent-brand: "#f17561"
  accent-solid: "#c84634"
  accent-text: "#b93c2b"
  on-accent: "#ffffff"
  surface-navigator: "#f3efea"
  surface-paper: "#ffffff"
  surface-sunken: "#efece7"
  text: "#1c191d"
  text-secondary: "#544f57"
  text-tertiary: "#7a737e"
  border-control: "#9b959e"
  fill-hover: "rgba(28, 25, 29, 0.045)"
  fill-selected: "rgba(28, 25, 29, 0.065)"
  fill-bubble: "#fceae4"
  border-subtle: "rgba(28, 25, 29, 0.07)"
  border: "rgba(28, 25, 29, 0.11)"
  border-strong: "rgba(28, 25, 29, 0.18)"
  success-text: "#1b7a37"
  info-text: "#945200"
  destructive-text: "#c21824"
  info-tint: "rgba(245, 158, 11, 0.13)"
  destructive-tint: "rgba(225, 45, 57, 0.11)"
typography:
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Segoe UI", "Microsoft YaHei", sans-serif'
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.35
    letterSpacing: "-0.02em"
  panel-title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Segoe UI", "Microsoft YaHei", sans-serif'
    fontSize: "16.5px"
    fontWeight: 700
    lineHeight: 1.35
    letterSpacing: "-0.02em"
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Segoe UI", "Microsoft YaHei", sans-serif'
    fontSize: "13.5px"
    lineHeight: 1.5
  reading:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Segoe UI", "Microsoft YaHei", sans-serif'
    fontSize: "14.5px"
    lineHeight: 1.78
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Segoe UI", "Microsoft YaHei", sans-serif'
    fontSize: "11.5px"
    lineHeight: 1.5
  mono:
    fontFamily: 'ui-monospace, "SF Mono", "Cascadia Code", Consolas, monospace'
    fontSize: "12.5px"
    lineHeight: 1.65
rounded:
  control: "10px"
  row: "12px"
  card: "16px"
  message: "18px"
  dialog: "22px"
  pill: "999px"
spacing:
  inline: "8px"
  compact: "12px"
  content: "16px"
  section: "22px"
---

# Design System: Kooyu Workbench (iOS & Sunset Coral Edition)

## Overview

**Creative North Star: "Warm Precision, Native Fluidity"**

Kooyu blends its Sunset Coral brand identity (`brand/logos/kodo-mark-coral.svg` and `brand/product-design/`) with an iOS/iPadOS-inspired interface grammar informed by Codeg's mobile/desktop ergonomics and Craft Agents' spring physics (`--spring-snap`, `--spring-base`, `--spring-panel`).

- **Brand & Provenance**: Kooyu displays its authentic Sunset Coral Möbius ribbon mark and Kooyu wordmark. `src/styles/craft-tokens.css` and `src/components/Spinner.tsx` retain Craft Agents Apache-2.0 provenance and attribution (`third-party/craft-agents/EXTRACTION.md`); Kooyu's iOS surface overrides, Sunset Coral palette, and spring motion rules live in `src/styles/app.css`.
- **The State Has Words Rule**: Every status pill and dot pairs color with explicit Chinese state labels (`尚未启动` / `空闲` / `正在运行` / `等待输入` / `运行未知`, `原生已连接` / `原生未连接`, `自动继续已启用` / `自动继续未启用`).
- **The Native Type & Accessibility Rule**: Uses the operating system UI font stack without bundling proprietary fonts; keeps mobile inputs/selects/textareas at `16px` to prevent iOS Safari zoom; guarantees `44px` minimum mobile action touch targets; retains container-level `:focus-within` coral rings on the composer; honors `prefers-reduced-motion: reduce`.

## Layout & Surfaces

- **Desktop (Two-Column Sidebar Shell)**: One sidebar card houses a single-row brand header, a prominent full-width `新对话` pill button below it (`⌘N` / `Ctrl N`), a clean search + archive bar, a pinned L0 `Kooyu 主对话` commander zone (with `待处理` badge), a 2-tab view switcher (`按项目 | 按 Harness`), a collapsible 3-tier tree (where project rows carry an inline `+` trigger and session rows carry Harness badges + single-line metadata), and a 3-up horizontal footer toolbar (`配置` / `用量` / `手机`) above Host status. Width is drag-controlled (`248–460px`, default `320px`), double-click resets, `ArrowLeft`/`ArrowRight`/`Home`/`End` move it from the keyboard, and the value persists in `localStorage`. The rail collapses to a `76px` icon rail.
- **Right Inspector**: A floating overlay sheet (`min(360px, 100% - 24px)`, `--radius-sheet`, `--elev-sheet`) rather than a permanent third column. It dims the transcript behind a scrim and closes on backdrop click or the header button. Nothing reserves width for it, so the conversation never reflows when detail opens.
- **Mobile (`<= 760px`)**: Single column. Phone home displays the pinned commander zone, 2-tab switcher, search bar, and collapsible project/harness tree above the bottom tab bar (hiding the desktop draft view until a session, draft, or utility page opens), with a 62px top bar (`☰`, scope title, new-session). The `288px` slide-over drawer houses quick Inbox access, utility tools, Host status, and theme toggle. The inspector becomes a full-height bottom sheet with a grabber, `88dvh` cap, and safe-area padding.
- **Inline Root Draft Composer & Dropdowns**: Clicking `新对话` or any project/harness `+` switches the main pane into an inline `DraftWorkspace` (`RootComposeView` pattern from DeepSeek Harness / Codeg). Users select `Kooyu 主对话` or any native Harness and its discovered models or saved Harness bindings inside the Composer's bottom dropdown pills. New connections are configured through Provider, model catalog, and Harness binding settings. Users choose project/directory context in the draft header, then send the first message to materialize & launch or click `创建会话` to save an idle draft without calling a model.
- **Coral Discipline**: `--accent-brand` `#f17561` appears only in five places — the brand mark, primary actions, the selected-row marker, the focus ring, and the empty-state K. Every other state uses neutral fills or the iOS system semantic colours.

## Motion & Micro-interactions

- **Spring Physics**: Interactive controls use Craft-calibrated CSS `linear()` spring curves (`--spring-snap`, `--spring-panel`) for tactile press feedback (`scale(0.975)`), segmented-control sliding thumbs, inspector slide-ins, mobile drawer/bottom-sheet entrances, scroll-to-bottom floating pill, and tool-disclosure chevron rotations.
- **Reduced Motion**: `@media (prefers-reduced-motion: reduce)` removes animations and transitions globally.

<!-- Settings extension: documented from the implemented surface on 2026-11-12. -->

The following sections apply to **Settings only**. They capture the code-led extension defined in `design/settings.md`, using `src/styles/app.css` and the settings components as visual authority. Existing product-wide guidance and frontmatter are retained; this extension records the active Settings implementation.

## Colors

### Settings

Settings inherits the conversation workbench's current light/dark semantic tokens: neutral paper and raised surfaces, quiet selected fills, fine separators, and restrained filled actions. Use the active `--surface-*`, `--text*`, `--border*`, `--fill-*`, and `--accent*` values from `src/styles/app.css` rather than assigning a page-specific palette. The theme preference supports system, light, and dark.

**The Settings Contrast Rule.** Throughout the Settings shell, tertiary text resolves to the secondary text token. Keep group labels, icons, counts, and supporting metadata readable in both themes; status color always accompanies a written state.

## Typography

### Settings

Inherit the workbench UI font stack through `--font-sans`; use `--font-mono` for executable paths and raw configuration. Introductory headings are compact (20px, weight 620, line-height 1.4), decreasing on mobile (18px). Supporting introduction text (13px, line-height 1.75) explains the next action without competing with the controls. Prices and model limits use tabular numerals; long URLs, paths, and configuration values wrap within their containers.

## Layout

### Settings

- **Desktop navigation:** reuse the workbench sidebar, with a return-to-conversation action and four labeled groups: 工作台 (通用, 外观), 运行环境 (引擎与安装), 模型体系 (Provider, 模型库, 高级模型映射), and 会话策略 (新会话默认配置, 个人指令). Selected destinations combine a neutral fill, stronger text, an inset boundary, and a narrow marker. Counts supplement labels; the collapsed rail retains accessible names.
- **Content rhythm:** introductions stay bounded (70ch) above grouped rows. Preference rows pair a title and explanation with a control; engine details use separated sections. Provider and compatible protocol fields share two columns with a modest gap (12px), followed by their save action across the grid.
- **Mobile:** at the existing breakpoint (maximum 760px), provide horizontally scrolling section pills in the content area and retain the workbench's bottom navigation. Stack engine fields and native-file details, allow Provider headings and actions to wrap, and use full-width preference selects. Engine detail padding becomes compact (0 16px 20px), and preference rows use smaller insets (18px).
- **Touch targets:** installation links/buttons, engine route saves, and Provider form actions have a mobile minimum height (44px). Section pills retain their implemented compact height (34px); the larger action target rule is scoped to the actions listed here.

## Elevation & Depth

### Settings

Use tonal grouping and fine borders as the main hierarchy. Grouped settings lists sit on paper in light mode and raised surfaces in dark mode; individual Provider records are separated by rules. Editors stay inline with a quiet border, avoiding an additional overlay layer for routine configuration.

## Shapes

### Settings

Preserve the existing rounded grouping: settings containers (12px), inline Provider editors (16px), and desktop navigation rows (9px). Mobile navigation uses the inherited pill radius. Keep native selects, checkboxes, text fields, and disclosure semantics; the compact checkbox itself is not a large decorative switch.

## Components

### Settings Navigation and Engine Disclosure

Navigation uses real buttons with `aria-current="page"` on the selected destination. Engine rows use native `details`/`summary`: the summary pairs an engine badge and name with its current route, written availability, and chevron. Expanding the row reveals installation actions, Provider routing, and nested disclosures for history and native files/capabilities. Keep the browser's disclosure behavior and keyboard access. Installation progress, recovery, unavailable management, and errors remain explicit text near the relevant action.

### Provider, Models, and Conversation Routing

**The Route Then Model Rule.** Settings connects an engine to a Provider and compatible protocol endpoint; the conversation chooses its model. Saving a Provider automatically imports its models. A failed import keeps the saved Provider and exposes an inline retry. The model library presents window, capability, and price sources with the precedence manual override > current endpoint > public catalog; blank inputs restore automatic values, while zero remains an explicit free price. Show pricing units (USD / million tokens) beside the values.

Keep saved Provider routes, fixed-model mappings, and the native configuration/login route accessible from history; advanced fixed-model mapping remains a separate settings destination. Kooyu and standalone pi keep independent engine defaults and configuration identities, including when the user explicitly selects the same Provider for both. These workflow affordances extend the existing conversation model menu. See `../../docs/settings-workflow.md` for persistence and session timing.

### Preferences, Feedback, and Motion

Preferences pair each control with a title and explanation, show unsaved/saved/synced state, and keep restore/save actions together beneath the form. Preserve alert roles for errors and status roles for completion and discovery feedback. The personal-instructions field shows its character count and explains its new-session scope. Message-size preference changes transcript text while navigation and tools retain their density.

Settings inherits the workbench spring tokens for navigation and section entrances. Honor both the operating system's reduced-motion query and the saved reduce-motion preference; the former removes animation/transitions, while the latter reduces their duration (0.01ms) and restores automatic scrolling.

### Kooyu Management Confirmation

When Kooyu tools request a consequential management change, keep the existing conversation interaction surface as the authorization point. Render the operation, target session or project, destination harness, goal, and any continuation limits as readable labeled values; never expose a raw JSON wall for this product-owned request. The person accepts or declines one request. Do not hide or co-locate these actions in the session inspector. A denied, stopped, or stale request cannot complete a later action. Native history reads identify the target and remain separately distinguishable from live events.

## Do's and Don'ts

### Settings

- **Do** keep engine installation, Provider routing, model metadata, and session policy in their labeled groups, with advanced options progressively disclosed.
- **Do** use the active app theme tokens, readable secondary assistance, textual statuses, and the existing focus behavior.
- **Do** preserve native/history choices and the distinction between an engine's route and a conversation's model.
- **Don't** require a fixed model to save an engine's Provider route or silently merge Kooyu and pi configuration.
- **Don't** present automatic metadata as a manual override, an unknown price as zero, or a saved Provider as lost when discovery fails.
- **Don't** claim installation, login, or live model verification beyond the state reported by the Host.
