# Runtime and extraction license record

Checked against installed manifests and license files on 2026-11-11. Exact transitive versions are in package-lock.json. This record is a dependency inventory, not a claim that the whole distribution is MIT.

| Dependency | Installed version | Declared license |
| --- | --- | --- |
| Electron | 39.1.0 | MIT; its Chromium/Node notices also accompany a distribution |
| React / React DOM | 19.2.0 | MIT |
| pi coding-agent / pi-ai | 1.5.2 | MIT |
| Claude Agent SDK | 0.3.322 | Proprietary; SEE LICENSE IN README.md |
| ACP SDK | 2.5.0 | Apache-2.0 |
| @napi-rs/keyring | 2.1.2 | MIT |
| Zod | 4.6.7 | MIT |
| react-markdown / remark-gfm | 10.1.0 / 4.0.1 | MIT |
| lucide-react | 0.468.0 | ISC |
| qrcode | 1.5.4 | MIT |
| Vite | 7.2.2 | MIT |
| TypeScript | 7.0.2 | Apache-2.0 |
| Playwright test | 1.56.1 | Apache-2.0 |

The installed Claude Agent SDK LICENSE.md states: “© Anthropic PBC. All rights reserved. Use is subject to the Legal Agreements outlined here: https://code.claude.com/docs/en/legal-and-compliance.” Its README links the [Commercial Terms](https://www.anthropic.com/legal/commercial-terms) and [Privacy Policy](https://www.anthropic.com/legal/privacy). Kodo uses the installed native CLI when available and retains the SDK fallback. Native login, subscription eligibility and redistribution of the SDK/CLI remain subject to those upstream agreements; no entitlement compatibility is inferred from a successful API-authenticated test. No desktop installer or redistributed SDK bundle has been published.

Online model metadata now uses the MIT-licensed models.dev public catalog; attribution and retained license are in [models.dev/NOTICE.md](models.dev/NOTICE.md). No generator source or research cache is imported at runtime.

The original harness CLIs are external installations. Kodo does not relicense them or copy their branding. Native protocol interoperability was implemented in Kodo; fixed reference checkouts are never runtime imports.

Craft extraction has its own retained LICENSE/NOTICE/TRADEMARK and detailed [scope record](craft-agents/EXTRACTION.md). Only the selected tokens and Spinner were extracted; AppShell and TurnCard are authored locally. No CodexHost LGPL or Pebrel GPL source was copied. ZCode framing facts were checked at a9fe401eede6e6e5e01be9048679c206fe6f02d9 in shared/zcode-protocol-v4; the local decoder is authored here and does not depend on the cached source.
# 已安装 Desktop 的外部运行入口

2026-11-11：增加用户本机 Codex、ZCode、DeepSeek Harness、OpenCode desktop 附带原生入口发现。Kodo 不分发这些应用、二进制或 archive 源码，不把 `.local/research` 或诊断提取物作为依赖。OpenCode 桥直接在已安装应用自己的 runtime 中调用其原生 Server；相关应用的使用、模型授权和条款继续由原产品管理。本轮没有新增 npm 运行依赖，也没有以安装发现或已有登录推断额外订阅/模型权限。其他版本的打包布局和兼容性需独立验证。

