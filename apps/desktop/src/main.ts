import { app, BrowserWindow, Menu, Tray, nativeImage, dialog, nativeTheme, shell } from "electron";
import { ensureHost } from "./host-client.js";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
// Keep the existing browser profile while changing the visible application name.
const legacyUserData = app.getPath("userData");
app.setName("Kooyu");
app.setPath("userData", legacyUserData);
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
  window = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 760,
    minHeight: 580,
    title: "Kooyu",
    backgroundColor: dark ? "#141517" : "#ffffff",
    titleBarStyle: "hidden",
    titleBarOverlay:
      process.platform === "win32"
        ? {
            color: dark ? "#141517" : "#ffffff",
            symbolColor: dark ? "#9ca3af" : "#4b5563",
            height: 38,
          }
        : undefined,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  if (process.platform === "win32") {
    nativeTheme.on("updated", () => {
      if (!window) return;
      const isDark = nativeTheme.shouldUseDarkColors;
      try {
        window.setTitleBarOverlay({
          color: isDark ? "#141517" : "#ffffff",
          symbolColor: isDark ? "#9ca3af" : "#4b5563",
          height: 38,
        });
      } catch {}
    });
  }
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
