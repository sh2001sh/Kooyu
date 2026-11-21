# Kooyu Web

Run the Kooyu agent workbench in your browser, backed by a Host on your own computer.
Windows, macOS and Linux require Node.js **24.13.0 or later** and npm.

```sh
npx kooyu@latest
```

Or install globally:

```sh
npm install -g kooyu
kooyu
```

Open the address printed in the terminal, normally **http://127.0.0.1:4310**.
Keep the terminal running; press Ctrl+C to stop. The first-run guide configures your models.
Model services and third-party native harnesses require their own accounts or installations.
Installing Kooyu does not include a paid model subscription.

```sh
kooyu --help
kooyu --version
kooyu start --port 4320 --data-dir ./kooyu-data
```

Web pages and the Host are precompiled; users do not need the source repository, Electron or a frontend build.
Native dependencies install for the target platform. Unusual architectures may require native build tools.
The managed browser feature additionally needs Chromium:

```sh
npx playwright@1.56.1 install chromium
```

The default persistent data directory is shared with the existing Kooyu Host:

| System  | Directory                                      |
| ------- | ---------------------------------------------- |
| Windows | `%LOCALAPPDATA%/Kooyu/host`                    |
| macOS   | `~/Library/Application Support/Kooyu/host`     |
| Linux   | `${XDG_DATA_HOME:-~/.local/share}/Kooyu/host`  |

Existing legacy `Kodo/host` directories remain automatically supported for seamless upgrades.

Only one Host can own a data directory at a time. Stop an existing desktop Host before starting
the npm Host, or use a different `--data-dir` and `--port` for a separate instance.
Updating or uninstalling the npm package does not remove this data.

Credentials use the operating system keyring by default. Headless Linux users should configure
the encrypted file vault as described in [self-hosted operations](https://github.com/sh2001sh/Kooyu/blob/main/docs/self-hosted-operations.md).
There is no plaintext credential fallback.

To bind a headless Host to your Kooyu account for remote discovery from [kooyu.app](https://kooyu.app/account):

```sh
kooyu account login
```

The listener defaults to the local computer. Remote HTTPS access requires `KOOYU_TLS_CERT`,
`KOOYU_TLS_KEY`, `KOOYU_PUBLIC_ORIGIN` and `--host` (legacy `KODO_*` variables remain supported);
use the documented pairing and access controls.

## Updating

Stop Kooyu, then update and restart:

```sh
npm install -g kooyu@latest
kooyu
```

For one-off runs, use `npx kooyu@latest`. A preview channel, when published, is available with
`npx kooyu@next`. The npm edition does not install desktop EXE/DMG updates.

[Website (kooyu.app)](https://kooyu.app) · [Source and issues](https://github.com/sh2001sh/Kooyu) · MIT license.
