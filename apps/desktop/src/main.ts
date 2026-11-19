import { app, BrowserWindow, Menu, Tray, nativeImage, dialog, nativeTheme, shell } from "electron";
import { ensureHost } from "./host-client.js";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
// Keep the existing browser profile while changing the visible application name.
const legacyUserData = app.getPath("userData");
app.setName("Kooyu");
app.setPath("userData", legacyUserData);
const appIconPath = fileURLToPath(new URL("../assets/app.png", import.meta.url));
// This Windows host has a GPU initialization access violation. Keep the
// rendering fallback explicit and reversible without weakening the sandbox.
if (
  process.env.KODO_SOFTWARE_RENDERING === "1" ||
  (process.platform === "win32" && process.env.KODO_SOFTWARE_RENDERING !== "0")
) {
  app.disableHardwareAcceleration();
}
let window: BrowserWindow | undefined,
  tray: Tray | undefined,
  quitting = false,
  hostUrl = "";
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
async function show() {
  if (window) {
    window.show();
    window.focus();
    return;
  }
  const dark = nativeTheme.shouldUseDarkColors;
  const applyWindowChrome = (isDark: boolean, bgHex?: string) => {
    if (!window || window.isDestroyed()) return;
    const bg = bgHex ?? (isDark ? "#0b0c0e" : "#f5f5f7");
    try {
      window.setBackgroundColor(bg);
    } catch {}
    if (process.platform === "win32") {
      try {
        window.setTitleBarOverlay({
          color: "#00000000",
          symbolColor: isDark ? "#a6aab3" : "#52555c",
          height: 38,
        });
      } catch {}
    }
  };
  const isHexDark = (hex: string): boolean => {
    const clean = hex.replace(/^#/, "");
    if (!/^[0-9a-fA-F]{6}$/.test(clean)) return nativeTheme.shouldUseDarkColors;
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
  };
  window = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 760,
    minHeight: 580,
    title: "Kooyu",
    icon: appIconPath,
    backgroundColor: dark ? "#0b0c0e" : "#f5f5f7",
    titleBarStyle: "hidden",
    ...(process.platform === "darwin" ? { trafficLightPosition: { x: 14, y: 17 } } : {}),
    titleBarOverlay:
      process.platform === "win32"
        ? {
            color: "#00000000",
            symbolColor: dark ? "#a6aab3" : "#52555c",
            height: 38,
          }
        : undefined,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  const onNativeThemeUpdated = () => {
    applyWindowChrome(nativeTheme.shouldUseDarkColors);
  };
  nativeTheme.on("updated", onNativeThemeUpdated);
  window.webContents.on("did-change-theme-color", (_event, color) => {
    if (!color) return;
    applyWindowChrome(isHexDark(color), color);
  });
  window.on("closed", () => {
    nativeTheme.off("updated", onNativeThemeUpdated);
  });
  if (process.platform !== "darwin") window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      if (target.protocol === "https:" && !target.username && !target.password)
        void shell.openExternal(target.href).catch(() => {});
    } catch {}
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== new URL(hostUrl).origin) event.preventDefault();
  });
  const allowedOrigin = new URL(process.env.KODO_DEV_URL ?? hostUrl).origin;
  window.webContents.session.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    if (permission === "media") {
      try {
        return new URL(requestingOrigin).origin === allowedOrigin;
      } catch {
        return false;
      }
    }
    return false;
  });
  window.webContents.session.setPermissionRequestHandler((wc, permission, callback) => {
    if (permission === "media") {
      try {
        callback(new URL(wc.getURL()).origin === allowedOrigin);
        return;
      } catch {}
    }
    callback(false);
  });
  window.on("close", (event) => {
    if (!quitting && (tray || process.platform === "darwin")) {
      event.preventDefault();
      window?.hide();
    }
  });
  window.on("closed", () => {
    window = undefined;
  });
  await window.loadURL(process.env.KODO_DEV_URL ?? hostUrl);
}
app.on("second-instance", () => {
  void show();
});
app.on("window-all-closed", () => {
  if (!tray && process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  void show();
});
app.on("before-quit", () => {
  quitting = true;
});
app
  .whenReady()
  .then(async () => {
    if (process.platform === "win32") app.setAppUserModelId("app.kodo.desktop");
    hostUrl = await ensureHost(app.isPackaged ? process.resourcesPath : undefined);
    const icon = nativeImage.createFromPath(
      fileURLToPath(new URL("../assets/tray.png", import.meta.url)),
    );
    const openUpdateCenter = async () => {
      await show();
      try {
        await window?.webContents.executeJavaScript(
          'window.dispatchEvent(new Event("kooyu:open-update"))',
        );
      } catch {}
    };
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
        {
          label: "窗口",
          submenu: [
            {
              label: "打开 Kooyu",
              click: () => {
                void show();
              },
            },
            {
              label: "检查更新…",
              click: () => {
                void openUpdateCenter();
              },
            },
            { type: "separator" as const },
            { role: "quit" as const },
          ],
        },
        { role: "editMenu" },
      ]),
    );
    try {
      if (icon.isEmpty()) throw new Error("托盘图标不可用");
      tray = new Tray(icon);
    } catch {
      tray = undefined;
    }
    tray?.setToolTip("Kooyu · Host 独立运行");
    tray?.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: "打开 Kooyu",
          click: () => {
            void show();
          },
        },
        {
          label: "检查更新…",
          click: () => {
            void openUpdateCenter();
          },
        },
        {
          label: "退出界面（Host 与任务继续运行）",
          click: () => {
            quitting = true;
            app.quit();
          },
        },
        {
          label: "停止全部并退出界面",
          click: async () => {
            const choice = await dialog.showMessageBox({
              type: "question",
              message: "停止并暂停全部会话？",
              detail: "逐项请求原生取消；不支持取消或失联的目标可能继续运行。",
              buttons: ["返回", "停止全部"],
              defaultId: 0,
              cancelId: 0,
            });
            if (choice.response !== 1) return;
            const snapshot = await fetch(`${hostUrl}/api/snapshot`).then((r) => r.json());
            const results = await Promise.all(
              snapshot.sessions.map(async (s: { id: string; title: string }) => ({
                title: s.title,
                ...(await fetch(`${hostUrl}/api/sessions/${s.id}/stop`, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ pause: true, requestId: randomUUID() }),
                }).then((r) => r.json())),
              })),
            );
            await dialog.showMessageBox({
              message: "停止请求结果",
              detail: JSON.stringify(results, null, 2),
              buttons: ["关闭界面"],
            });
            quitting = true;
            app.quit();
          },
        },
      ]),
    );
    tray?.on("double-click", () => {
      void show();
    });
    await show();
  })
  .catch((error) => {
    dialog.showErrorBox("Kooyu 启动失败", error.message);
    quitting = true;
    app.quit();
  });
