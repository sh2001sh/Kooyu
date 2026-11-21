import { BrowserWindow, clipboard, globalShortcut, ipcMain, nativeTheme, screen } from "electron";
import { randomUUID } from "node:crypto";

let hudWindow: BrowserWindow | null = null;
let registeredShortcut: string | null = null;

function buildHudHtml(isDark: boolean, clipPreview: string): string {
  const safeClip = clipPreview
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const bg = isDark ? "#14161b" : "#ffffff";
  const fg = isDark ? "#f2f4f8" : "#111215";
  const muted = isDark ? "#9aa1b0" : "#646975";
  const border = isDark ? "rgba(255,255,255,0.12)" : "rgba(17,18,21,0.12)";
  const sunken = isDark ? "#1d2028" : "#f4f5f7";
  const accent = "#e8624a";
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; color: ${fg}; }
  .card {
    margin: 8px;
    background: ${bg};
    border: 1px solid ${border};
    border-radius: 16px;
    box-shadow: 0 18px 46px rgba(0,0,0,${isDark ? "0.52" : "0.18"});
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .top { display: flex; align-items: center; gap: 10px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: ${accent}; flex: none; }
  input {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    color: ${fg};
    font-size: 15px;
  }
  input::placeholder { color: ${muted}; }
  .clip {
    font-size: 12px;
    color: ${muted};
    background: ${sunken};
    border: 1px solid ${border};
    border-radius: 9px;
    padding: 6px 9px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .clip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; color: ${muted}; }
  .actions { display: flex; align-items: center; gap: 6px; }
  select, button {
    font: inherit;
    font-size: 12px;
    border-radius: 8px;
    border: 1px solid ${border};
    background: ${sunken};
    color: ${fg};
    padding: 5px 9px;
    cursor: pointer;
  }
  button.primary { background: ${accent}; border-color: ${accent}; color: #fff; font-weight: 600; }
</style>
</head>
<body>
  <div class="card">
    <div class="top">
      <span class="dot"></span>
      <input id="q" autofocus placeholder="告诉 Kooyu 做什么…（Enter 派发，Shift+Enter 打开主窗口，Esc 关闭）" />
    </div>
    ${
      safeClip
        ? `<div class="clip"><span>剪贴板：${safeClip}</span><label style="flex:none;display:flex;align-items:center;gap:4px;cursor:pointer;"><input type="checkbox" id="useClip" checked style="flex:none;width:13px;height:13px;" />附带</label></div>`
        : ""
    }
    <div class="foot">
      <span>Kooyu 快捷胶囊</span>
      <div class="actions">
        <select id="route">
          <option value="kodo">Kooyu 主助手</option>
          <option value="claude-code">优先 Claude Code</option>
          <option value="codex">优先 Codex</option>
          <option value="gemini">优先 Gemini</option>
        </select>
        <button id="send" class="primary">发送</button>
      </div>
    </div>
  </div>
  <script>
    const q = document.getElementById("q");
    const route = document.getElementById("route");
    const useClip = document.getElementById("useClip");
    const submit = (openMain) => {
      const text = q.value.trim();
      const includeClip = Boolean(useClip && useClip.checked);
      if (!text && !includeClip) return;
      window.location.href = "kooyu-hud://send?" + new URLSearchParams({
        text,
        route: route.value,
        clip: includeClip ? "1" : "0",
        openMain: openMain ? "1" : "0",
      }).toString();
    };
    document.getElementById("send").addEventListener("click", () => submit(false));
    q.addEventListener("keydown", (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "Escape") window.location.href = "kooyu-hud://close";
      if (e.key === "Enter") { e.preventDefault(); submit(e.shiftKey); }
    });
  </script>
</body>
</html>`;
}

async function dispatchQuickCapture(
  hostUrl: string,
  payload: { text: string; route: string; includeClip: boolean },
): Promise<void> {
  const clip = payload.includeClip ? clipboard.readText().trim().slice(0, 6000) : "";
  const routePrefix =
    payload.route && payload.route !== "kodo"
      ? `[快捷胶囊 · 优先调度 ${payload.route}] `
      : "[快捷胶囊] ";
  const combined = [
    `${routePrefix}${payload.text || "请分析以下剪贴板内容并处理："}`,
    clip ? `\n\`\`\`\n${clip}\n\`\`\`` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const snap = (await fetch(`${hostUrl}/api/snapshot`).then((r) => r.json())) as {
    sessions?: { id: string; harnessId: string; kind: string; archived?: boolean }[];
  };
  let targetId = snap.sessions?.find(
    (s) => s.harnessId === "kodo" && s.kind === "supervisor" && !s.archived,
  )?.id;

  if (!targetId) {
    const createdResponse = await fetch(`${hostUrl}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Kooyu 主助手", harnessId: "kodo", kind: "supervisor" }),
    });
    if (!createdResponse.ok) return;
    const created = (await createdResponse.json()) as { id?: string };
    targetId = created.id;
  }
  if (!targetId) return;

  await fetch(`${hostUrl}/api/sessions/${targetId}/send`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requestId: randomUUID(),
      text: combined,
      mode: "queue",
    }),
  });
}

export function toggleQuickCaptureHud(
  getHostUrl: () => string,
  showMainWindow: () => Promise<void>,
): void {
  if (hudWindow && !hudWindow.isDestroyed() && hudWindow.isVisible()) {
    hudWindow.hide();
    return;
  }
  const clipPreview = clipboard.readText().trim().replace(/\s+/g, " ").slice(0, 120);
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const width = 620;
  const height = clipPreview ? 176 : 134;
  const x = Math.round(display.workArea.x + (display.workArea.width - width) / 2);
  const y = Math.round(display.workArea.y + Math.min(140, display.workArea.height * 0.16));

  if (!hudWindow || hudWindow.isDestroyed()) {
    hudWindow = new BrowserWindow({
      width,
      height,
      x,
      y,
      frame: false,
      transparent: true,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    hudWindow.on("blur", () => {
      if (hudWindow && !hudWindow.isDestroyed()) hudWindow.hide();
    });
    hudWindow.webContents.on("will-navigate", (event, url) => {
      if (!url.startsWith("kooyu-hud://")) return;
      event.preventDefault();
      hudWindow?.hide();
      if (url.startsWith("kooyu-hud://send?")) {
        const params = new URL(url).searchParams;
        const text = params.get("text") ?? "";
        const route = params.get("route") ?? "kodo";
        const includeClip = params.get("clip") === "1";
        const openMain = params.get("openMain") === "1";
        const hostUrl = getHostUrl();
        if (hostUrl) {
          void dispatchQuickCapture(hostUrl, { text, route, includeClip }).catch(() => {});
        }
        if (openMain) void showMainWindow();
      }
    });
  } else {
    hudWindow.setBounds({ x, y, width, height });
  }

  const html = buildHudHtml(nativeTheme.shouldUseDarkColors, clipPreview);
  void hudWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).then(() => {
    hudWindow?.show();
    hudWindow?.focus();
  });
}

export function registerQuickCaptureShortcut(
  getHostUrl: () => string,
  showMainWindow: () => Promise<void>,
): string | null {
  const accelerator =
    process.env.KOOYU_QUICK_CAPTURE_SHORTCUT ??
    (process.platform === "darwin" ? "CommandOrControl+Shift+K" : "Alt+Space");
  try {
    if (registeredShortcut) globalShortcut.unregister(registeredShortcut);
    const ok = globalShortcut.register(accelerator, () => {
      toggleQuickCaptureHud(getHostUrl, showMainWindow);
    });
    registeredShortcut = ok ? accelerator : null;
    return registeredShortcut;
  } catch {
    return null;
  }
}

export function unregisterQuickCaptureShortcut(): void {
  if (registeredShortcut) {
    try {
      globalShortcut.unregister(registeredShortcut);
    } catch {}
    registeredShortcut = null;
  }
  if (hudWindow && !hudWindow.isDestroyed()) {
    hudWindow.destroy();
    hudWindow = null;
  }
  ipcMain.removeAllListeners("kooyu:quick-capture");
}
