# Windows installer build and verification

Kooyu uses an assisted NSIS installer. Select **Only for me** and choose an
installation folder such as `D:\Kooyu`. Existing Kodo installations are separate.

## Build and export

```powershell
npm run package:desktop -- --win nsis --x64
node scripts/export-windows-installer.mjs "release/desktop/Kooyu-Setup-0.1.2.exe" "D:/Kooyu-Installers"
```

Run the exported installer from `D:\Kooyu-Installers`. The export helper creates
a new file with the destination folder's inherited permissions and verifies its
SHA-256 against the build artifact. It refuses to overwrite an existing file.
Choose another output directory if that version was already exported.

Some Windows agent workspaces label generated executables **Low integrity**.
Windows starts those executables with a Low-integrity token even when launched
from normal Explorer. Such an installer cannot write to ordinary application
folders. NSIS's default extraction path misleadingly reports that the application
cannot be closed; changing the archive to ZIP instead reports an output-file
error. Neither message proves that Kooyu is running or that the archive is corrupt.

The installer now detects a Low-integrity token before installation and explains
that the package should be copied to a normal directory outside the workspace.
Export to a normal Downloads or release folder; the helper does not change
Windows security settings or the workspace's permissions.

## Verify an installed copy

```powershell
node scripts/verify-packaged-desktop.mjs "D:/Kooyu/Kooyu.exe"
node scripts/verify-packaged-desktop.mjs "D:/Kooyu/Kooyu.exe" --default-port
```

This verification uses an isolated Host data directory and a random local port.
It checks bundled runtime and workspace dependencies, Host connectivity, session
creation, closing the UI while the Host survives, and reopening the same session.
Reports and screenshots are written under `.local/verification/packaged-*`.
The `--default-port` run removes the explicit test port, so it also verifies
automatic port selection and discovery on reopening while retaining isolated
Host data. A random-port-only test does not cover normal desktop startup.

## Startup port conflicts

Port 4310 can already belong to another application (QQ on the verified machine).
Its response may have HTTP status 200 and a binary body, so parsing it as Host
JSON produces an `Unexpected token` startup error.

Desktop startup now reuses the live Host recorded in the same data directory's
`host.json`, validating its identity and protocol. When starting a new Host with
no explicit endpoint, it selects an available loopback port if 4310 is occupied.
The selected port is passed to the Host and saved in discovery for reopening.
Explicit `KODO_HOST_URL` / `KODO_HOST_PORT` settings remain authoritative and get
a readable error if they point to another service. A live data-directory owner
is preserved rather than starting another writer or deleting its lock.

Locally built installers are development artifacts unless an actual signing
certificate is configured. An electron-builder log line mentioning signtool alone
does not establish that an artifact has a valid Authenticode signature.
