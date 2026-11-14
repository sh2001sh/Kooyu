import { spawn, execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { resolveElectronRuntime } from "./electron-runtime.mjs";
import { electronEnvironment } from "./electron-environment.mjs";

const outDir =
  "C:/Users/admin/.gemini/antigravity/brain/caf3214e-ad51-4064-be34-697d7f06adc8/screenshots";
mkdirSync(outDir, { recursive: true });

const runtime = await resolveElectronRuntime();
console.log("Runtime path:", runtime.path);

const child = spawn(runtime.path, [resolve("apps/desktop")], {
  env: {
    ...electronEnvironment(),
  },
  stdio: "inherit",
});

console.log("Launched Electron PID:", child.pid);

// Wait for window to open and render
await new Promise((r) => setTimeout(r, 6000));

const psScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Drawing;
using System.Drawing.Imaging;

public class WindowCapture {
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("dwmapi.dll")]
    public static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out RECT pvAttribute, int cbAttribute);

    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    public static void Capture(IntPtr hWnd, string filePath) {
        RECT rect;
        if (DwmGetWindowAttribute(hWnd, 9, out rect, Marshal.SizeOf(typeof(RECT))) != 0) {
            GetWindowRect(hWnd, out rect);
        }
        int width = rect.Right - rect.Left;
        int height = rect.Bottom - rect.Top;
        if (width <= 0 || height <= 0) return;
        using (Bitmap bmp = new Bitmap(width, height)) {
            using (Graphics g = Graphics.FromImage(bmp)) {
                g.CopyFromScreen(rect.Left, rect.Top, 0, 0, new Size(width, height), CopyPixelOperation.SourceCopy);
            }
            bmp.Save(filePath, ImageFormat.Png);
        }
    }
}
"@ -ReferencedAssemblies System.Drawing, System.Windows.Forms

$procs = Get-Process -Name electron -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }
if (-not $procs) {
    $procs = Get-Process -Name Kooyu -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }
}
if ($procs) {
    $hWnd = $procs[0].MainWindowHandle
    [WindowCapture]::SetForegroundWindow($hWnd)
    Start-Sleep -Milliseconds 500
    [WindowCapture]::Capture($hWnd, "${outDir.replace(/\\/g, "/")}/real-desktop-window.png")
    Write-Output "SUCCESS: Window captured!"
} else {
    Write-Output "ERROR: Window handle not found."
}
`;

try {
  const result = execSync("powershell -NoProfile -Command -", {
    input: psScript,
    encoding: "utf8",
  });
  console.log("PS output:", result);
} catch (err) {
  console.error("PS error:", err);
} finally {
  child.kill();
}
