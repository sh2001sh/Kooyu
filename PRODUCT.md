# Product

## Platform

Target platforms are macOS, Windows, Linux, iOS and Android. HarmonyOS is deferred. Desktop uses the existing Electron shell and React/TypeScript workbench; iOS uses SwiftUI and Android uses Kotlin / Jetpack Compose. Windows remains the first verified development environment; each additional OS and architecture needs its own execution and distribution evidence.

The implemented first release model is desktop execution with native mobile access to the same independent Session Host. Desktop packaging includes a standalone Node runtime and production Host. Mobile projects use native views and platform credential storage, with no WebView. They support HTTPS pairing, sessions, messages, approvals, stop/pause and recovery without automatic resends. Mobile clients do not run desktop harnesses locally. See [the multiplatform implementation](docs/multiplatform-plan.md) for build instructions and verification boundaries; source and CI configuration do not imply all platforms have shipped.

## Confirmed requirements

Kooyu is a local session workbench for users working with ten native coding harnesses. Projects organize sessions; harness is a label/filter. Users can chat directly or explicitly enable Kooyu supervision. Kooyu is the product agent built on the pi SDK; standalone pi remains one of the ten native harnesses with its own direct-chat entry. Independent Node Host owns SQLite, execution and reliable delivery. UI closure detaches; it does not stop tasks. Native IDs, login, interaction semantics and capability limits remain visible. Secrets belong in the operating system credential store.

## Stack

User specified Electron + React + TypeScript + Node + SQLite, pi SDK and SessionManager. Craft Agents at the pinned revision supplies selected tokens and presentation baseline. See docs/design.md and docs/desktop-baseline.md. No audience or visual interview is needed: these choices were explicitly supplied in the implementation request.
