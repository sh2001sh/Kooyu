# Craft Agents extraction

Source: craft-ai-agents/craft-agents-oss, revision 1627c43e93bb4f5b1532116b8eb092c0ada4b23f.

- `packages/ui/src/styles/tokens.css` lines 25–282 → `apps/web/src/styles/craft-tokens.css`. CSS semantic roles and scales extracted without Tailwind. Accent and layout overrides are in app.css.
- `packages/ui/src/components/ui/LoadingIndicator.tsx`, Spinner → `apps/web/src/components/Spinner.tsx`. Removed i18next and cn; translated loading label; generated nine spans using React; local CSS preserves a compact indicator with reduced-motion support.
- TurnCard/AppShell/markdown dependency audit: TurnCard imports annotations, motion, core/shared types, contexts and runtime-specific helpers. These were not copied. Kodo's TurnCard.tsx is a new presentation component using react-markdown and remark-gfm; foldable tool display and three-pane layout follow the selected baseline.

Retained LICENSE, NOTICE and TRADEMARK.md. No Craft names, logo, domains, bundle identifier or service endpoints appear as product branding. No LGPL CodexHost or GPL Pebrel code copied. Reference caches are never runtime dependencies.

Runtime UI dependencies: React/React DOM (MIT), react-markdown/remark-gfm (MIT), lucide-react (ISC), qrcode (MIT). See lockfile for exact dependency tree.
