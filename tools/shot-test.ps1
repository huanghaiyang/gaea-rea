# Test which window-capture method actually returns Gaea's pixels.
#
# WPF + GPU surfaces refuse some methods while the DWM-composited screen copy shows whatever is on
# top. This script tries four methods against the live Gaea window and saves one PNG per method so the
# result can be inspected visually; the winner is then wired into tools/gaea-win.ps1.
param([string]$Title = 'Gaea - Untitled', [string]$OutDir = '.learn/raw/shot-test')

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing, System.Windows.Forms
if (-not ('Shot32' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class Shot32 {
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
    [DllImport("user32.dll")] public static extern IntPtr GetWindowDC(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr hWnd, IntPtr hdc);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
    [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool alt);
    [DllImport("user32.dll")] public static extern bool BitBlt(IntPtr dst, int x, int y, int w, int h, IntPtr src, int sx, int sy, int rop);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

    public static IntPtr Find(string titlePart) {
        IntPtr found = IntPtr.Zero;
        SetProcessDPIAware();
        EnumWindows((h, p) => {
            if (!IsWindowVisible(h)) return true;
            var sb = new StringBuilder(512);
            GetWindowText(h, sb, sb.Capacity);
            if (sb.ToString().Contains(titlePart)) { found = h; return false; }
            return true;
        }, IntPtr.Zero);
        return found;
    }
}
'@
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$hwnd = [Shot32]::Find($Title)
if ($hwnd -eq [IntPtr]::Zero) { Write-Error "window not found: $Title"; exit 2 }
$rect = New-Object Shot32+RECT
[Shot32]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
$w = $rect.Right - $rect.Left
$h = $rect.Bottom - $rect.Top
Write-Host "window=$hwnd rect=${w}x${h} at $($rect.Left),$($rect.Top)"

function Save-Shot([string]$name, [System.Drawing.Bitmap]$bmp) {
  $path = Join-Path $OutDir "$name.png"
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "saved $path"
}

# A/B: PrintWindow with and without PW_RENDERFULLCONTENT
foreach ($flags in 0, 2) {
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $hdc = $g.GetHdc()
  $ok = [Shot32]::PrintWindow($hwnd, $hdc, [uint32]$flags)
  $g.ReleaseHdc($hdc); $g.Dispose()
  Write-Host "PrintWindow(flags=$flags) -> $ok"
  if ($ok) { Save-Shot "printwindow-$flags" $bmp } else { $bmp.Dispose() }
}

# C: BitBlt from the window DC
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$dst = $g.GetHdc()
$src = [Shot32]::GetWindowDC($hwnd)
$ok = [Shot32]::BitBlt($dst, 0, 0, $w, $h, $src, 0, 0, 0x00CC0020)
[Shot32]::ReleaseDC($hwnd, $src) | Out-Null
$g.ReleaseHdc($dst); $g.Dispose()
Write-Host "BitBlt(GetWindowDC) -> $ok"
if ($ok) { Save-Shot 'bitblt-windowdc' $bmp } else { $bmp.Dispose() }

# D: force to foreground then copy the screen rect
[Shot32]::ShowWindow($hwnd, 9) | Out-Null   # SW_RESTORE
[Shot32]::SwitchToThisWindow($hwnd, $true)
[Shot32]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 600
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bmp.Size)
$g.Dispose()
Save-Shot 'screen-foreground' $bmp
Write-Host 'done'
