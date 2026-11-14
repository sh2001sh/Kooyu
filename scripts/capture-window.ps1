Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$source = @"
using System;
using System.Runtime.InteropServices;
using System.Drawing;
using System.Drawing.Imaging;

public class WinCap {
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

    public static bool Capture(IntPtr hWnd, string filePath) {
        RECT rect;
        if (DwmGetWindowAttribute(hWnd, 9, out rect, Marshal.SizeOf(typeof(RECT))) != 0) {
            GetWindowRect(hWnd, out rect);
        }
        int width = rect.Right - rect.Left;
        int height = rect.Bottom - rect.Top;
        if (width <= 0 || height <= 0) return false;
        using (Bitmap bmp = new Bitmap(width, height)) {
            using (Graphics g = Graphics.FromImage(bmp)) {
                g.CopyFromScreen(rect.Left, rect.Top, 0, 0, new Size(width, height), CopyPixelOperation.SourceCopy);
            }
            bmp.Save(filePath, ImageFormat.Png);
        }
        return true;
    }
}
"@

Add-Type -TypeDefinition $source -ReferencedAssemblies "System.Drawing"

$procs = Get-Process -Name electron -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }
if (-not $procs) {
    $procs = Get-Process -Name Kooyu -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }
}
if ($procs) {
    $hWnd = $procs[0].MainWindowHandle
    [WinCap]::SetForegroundWindow($hWnd) | Out-Null
    Start-Sleep -Milliseconds 600
    $outPath = "C:/Users/admin/.gemini/antigravity/brain/caf3214e-ad51-4064-be34-697d7f06adc8/screenshots/real-desktop-os-window.png"
    $ok = [WinCap]::Capture($hWnd, $outPath)
    Write-Output "SUCCESS: $ok - $outPath"
} else {
    Write-Output "ERROR: No electron/Kooyu window with MainWindowHandle found."
}
