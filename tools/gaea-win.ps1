# gaea-win.ps1 — Windows desktop driver for Gaea (WPF).
#
# Gaea is a WPF desktop app: no HTTP API, no scripting port. The only way an MCP/agent can drive it is
# through Win32 + UI Automation, so this script is the single reviewed place that touches that interop.
# The Node MCP server (tools/gaea-mcp/server.mjs) shells out to it and turns the JSON into MCP tools.
#
# Confirmed capture notes (2026-10-18, Gaea 2.3.1.0 Community):
#   * PrintWindow(hwnd, hdc, 2 /*PW_RENDERFULLCONTENT*/) returns the real WPF pixels, so screenshots do
#     not need the window to be foreground (screen CopyFromScreen is only a last resort).
#   * Gaea's windows use class "HwndWrapper[Gaea;;<guid>]"; the main window is titled "Gaea - <file>".
#   * Gaea must be started OUTSIDE a restricted sandbox: it writes D:\Gaea 2\Data\Settings, \Logs and
#     \Cache on startup, and a blocked write surfaces as a .NET crash (0xe0434352), not an error dialog.
#
# Commands (all print one compact JSON line unless noted):
#   processes
#   list
#   find   -Window <regex|pid>
#   focus  -Window <regex|pid>
#   shot   -Out <path> [-Window <regex|pid>]
#   uia    [-Window <regex|pid>] [-Depth n] [-Types Button,Text,...]
#   click  -Window <regex|pid> (-Name <text> | -AutomationId <id>) [-Index n]
#   mouse  -Window <regex|pid> -X <px> -Y <px> [-Button left|right] [-Double]
#   keys   -Window <regex|pid> -Text <sendkeys>
#   wait   -Window <regex|pid> [-TimeoutSec n]
param(
  [Parameter(Mandatory = $true, Position = 0)][string]$Command,
  [string]$Out = '',
  [string]$Window = '',
  [int]$Depth = 14,
  [string]$Types = '',
  [string]$Name = '',
  [string]$AutomationId = '',
  [int]$Index = 0,
  [int]$X = -1,
  [int]$Y = -1,
  [string]$Button = 'left',
  [switch]$Double,
  [string]$Text = '',
  [int]$TimeoutSec = 30
)

$ErrorActionPreference = 'Stop'
# Gaea's UI and console contain CJK text; make JSON output UTF-8 so the MCP sees it intact.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Drawing, System.Windows.Forms, UIAutomationClient, UIAutomationTypes

if (-not ('GaeaWin' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class GaeaWin {
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
    [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool alt);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    public static void MoveCursor(int x, int y) { SetCursorPos(x, y); }
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

    public static List<object[]> Windows() {
        var list = new List<object[]>();
        SetProcessDPIAware();
        EnumWindows((h, p) => {
            var t = new StringBuilder(1024); GetWindowText(h, t, t.Capacity);
            var c = new StringBuilder(512); GetClassName(h, c, c.Capacity);
            RECT r; GetWindowRect(h, out r);
            list.Add(new object[] { (long)h, t.ToString(), c.ToString(), r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top, IsWindowVisible(h) });
            return true;
        }, IntPtr.Zero);
        return list;
    }

    public static void ClickAt(int x, int y, bool right, bool dbl) {
        SetCursorPos(x, y);
        System.Threading.Thread.Sleep(60);
        uint down = right ? 0x0008u : 0x0002u;
        uint up = right ? 0x0010u : 0x0004u;
        mouse_event(down, 0, 0, 0, UIntPtr.Zero);
        mouse_event(up, 0, 0, 0, UIntPtr.Zero);
        if (dbl) {
            System.Threading.Thread.Sleep(90);
            mouse_event(down, 0, 0, 0, UIntPtr.Zero);
            mouse_event(up, 0, 0, 0, UIntPtr.Zero);
        }
    }
}
'@
}

function Get-GaeaWindows {
  $fg = [GaeaWin]::GetForegroundWindow()
  [GaeaWin]::Windows() | ForEach-Object {
    [pscustomobject]@{ handle = $_[0]; title = $_[1]; class = $_[2]; x = $_[3]; y = $_[4]; w = $_[5]; h = $_[6]; visible = $_[7]; active = ([IntPtr]$_[0] -eq $fg) }
  } | Where-Object { $_.class -match 'HwndWrapper\[Gaea' -or $_.title -match '^Gaea - ' }
}

function Resolve-Window([string]$pattern) {
  # Popup/flyout windows (menus, node-palette categories) are ~100x100 px, so an explicit handle or
  # pattern must bypass the size filter that keeps "the main window" unambiguous.
  $wins = Get-GaeaWindows | Where-Object { $_.visible -and $_.w -gt 20 -and $_.h -gt 20 }
  if ($pattern) {
    $hit = $wins | Where-Object { $_.title -match $pattern -or $_.class -match $pattern -or ("$($_.handle)" -eq $pattern) }
  } else {
    $hit = $wins | Where-Object { $_.w -gt 300 -and $_.h -gt 200 }
  }
  # prefer the foreground window (Gaea keeps a second same-sized WPF frame in some states), then area
  $hit | Sort-Object -Property @{ Expression = { if ($_.active) { 1 } else { 0 } } }, @{ Expression = { $_.w * $_.h } } -Descending | Select-Object -First 1
}

function Get-UiaRoot($w) {
  [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$w.handle)
}

function Invoke-Element($el) {
  $pattern = $null
  foreach ($p in @([System.Windows.Automation.InvokePattern]::Pattern,
                   [System.Windows.Automation.SelectionItemPattern]::Pattern,
                   [System.Windows.Automation.TogglePattern]::Pattern,
                   [System.Windows.Automation.ExpandCollapsePattern]::Pattern)) {
    if ($el.TryGetCurrentPattern($p, [ref]$pattern)) {
      if ($p -eq [System.Windows.Automation.InvokePattern]::Pattern) { $pattern.Invoke() }
      elseif ($p -eq [System.Windows.Automation.SelectionItemPattern]::Pattern) { $pattern.Select() }
      elseif ($p -eq [System.Windows.Automation.TogglePattern]::Pattern) { $pattern.Toggle() }
      else { $pattern.Expand() }
      return $p.ProgrammaticName -replace 'PatternIdentifiers.Pattern', 'Pattern'
    }
  }
  # no pattern: fall back to a real mouse click at the element centre
  $r = $el.Current.BoundingRectangle
  [GaeaWin]::ClickAt([int]($r.X + $r.Width / 2), [int]($r.Y + $r.Height / 2), $false, $false)
  return 'mouse'
}

switch ($Command) {
  'processes' {
    Get-Process | Where-Object { $_.ProcessName -like 'Gaea*' } |
      Select-Object Id, ProcessName, MainWindowTitle, @{ N = 'responding'; E = { $_.Responding } } |
      ConvertTo-Json -Compress
  }
  'list' {
    @(Get-GaeaWindows | Where-Object { $_.visible }) | ConvertTo-Json -Compress
  }
  'find' {
    $w = Resolve-Window $Window
    if (-not $w) { Write-Error "window not found: '$Window'"; exit 2 }
    $w | ConvertTo-Json -Compress
  }
  'focus' {
    $w = Resolve-Window $Window
    if (-not $w) { Write-Error "window not found: '$Window'"; exit 2 }
    [GaeaWin]::ShowWindow([IntPtr]$w.handle, 9) | Out-Null
    [GaeaWin]::SwitchToThisWindow([IntPtr]$w.handle, $true)
    [GaeaWin]::SetForegroundWindow([IntPtr]$w.handle) | Out-Null
    Start-Sleep -Milliseconds 250
    [pscustomobject]@{ focused = $true; title = $w.title; handle = $w.handle } | ConvertTo-Json -Compress
  }
  'shot' {
    if (-not $Out) { Write-Error 'shot requires -Out <path>'; exit 3 }
    $w = Resolve-Window $Window
    if (-not $w) { Write-Error "window not found: '$Window'"; exit 2 }
    $dir = Split-Path -Parent $Out
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $method = ''
    foreach ($flags in @(2, 0)) {
      $bmp = New-Object System.Drawing.Bitmap($w.w, $w.h)
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $hdc = $g.GetHdc()
      $ok = [GaeaWin]::PrintWindow([IntPtr]$w.handle, $hdc, [uint32]$flags)
      $g.ReleaseHdc($hdc); $g.Dispose()
      if ($ok) { $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose(); $method = "printwindow-$flags"; break }
      $bmp.Dispose()
    }
    if (-not $method) {
      [GaeaWin]::ShowWindow([IntPtr]$w.handle, 9) | Out-Null
      [GaeaWin]::SwitchToThisWindow([IntPtr]$w.handle, $true)
      [GaeaWin]::SetForegroundWindow([IntPtr]$w.handle) | Out-Null
      Start-Sleep -Milliseconds 600
      $bmp = New-Object System.Drawing.Bitmap($w.w, $w.h)
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $g.CopyFromScreen($w.x, $w.y, 0, 0, $bmp.Size)
      $g.Dispose()
      $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
      $method = 'screen-rect'
    }
    [pscustomobject]@{ file = $Out; window = $w.title; handle = $w.handle; width = $w.w; height = $w.h; method = $method } | ConvertTo-Json -Compress
  }
  'shotall' {
    # Capture every visible Gaea window separately: the main frame plus the WPF popups Gaea opens for
    # menus and the node-palette category flyouts (those are separate HWNDs, so a main-window
    # PrintWindow does not include them). -Prefix builds file names; -OutDir is the directory.
    if (-not $Out) { Write-Error 'shotall requires -Out <directory>'; exit 3 }
    if (-not (Test-Path $Out)) { New-Item -ItemType Directory -Force -Path $Out | Out-Null }
    $prefix = if ($Name) { $Name } else { 'window' }
    $results = @()
    $i = 0
    foreach ($w in (Get-GaeaWindows | Where-Object { $_.visible -and ($_.w * $_.h) -gt 2000 } | Sort-Object -Property @{ Expression = { $_.w * $_.h } } -Descending)) {
      $file = Join-Path $Out ("{0}-{1}.png" -f $prefix, $i)
      $method = ''
      foreach ($flags in @(2, 0)) {
        $bmp = New-Object System.Drawing.Bitmap($w.w, $w.h)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $hdc = $g.GetHdc()
        $ok = [GaeaWin]::PrintWindow([IntPtr]$w.handle, $hdc, [uint32]$flags)
        $g.ReleaseHdc($hdc); $g.Dispose()
        if ($ok) { $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose(); $method = "printwindow-$flags"; break }
        $bmp.Dispose()
      }
      if ($method) {
        $results += [pscustomobject]@{ file = $file; handle = $w.handle; title = $w.title; width = $w.w; height = $w.h; method = $method }
        $i++
      }
    }
    ConvertTo-Json -Compress -Depth 4 -InputObject @($results)
  }
  'uia' {
    $w = Resolve-Window $Window
    if (-not $w) { Write-Error "window not found: '$Window'"; exit 2 }
    $root = Get-UiaRoot $w
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $rows = New-Object System.Collections.ArrayList
    $allowed = @()
    if ($Types) { $allowed = $Types.Split(',') | ForEach-Object { $_.Trim() } }
    function SafeInt([double]$v) {
      if ([double]::IsNaN($v) -or [double]::IsInfinity($v)) { return -1 }
      if ($v -gt 2147483647) { return 2147483647 }
      if ($v -lt -2147483648) { return -2147483648 }
      return [int]$v
    }
    function Walk($el, $level, $path) {
      if ($null -eq $el -or $level -gt $Depth) { return }
      $c = $el.Current
      $ct = $c.ControlType.ProgrammaticName -replace 'ControlType\.', ''
      if (-not $allowed -or $allowed -contains $ct) {
        [void]$rows.Add([pscustomobject]@{
          path = $path; level = $level; type = $ct; name = $c.Name; id = $c.AutomationId;
          enabled = $c.IsEnabled; offscreen = $c.IsOffscreen; focusable = $c.IsKeyboardFocusable;
          x = SafeInt $c.BoundingRectangle.X; y = SafeInt $c.BoundingRectangle.Y;
          w = SafeInt $c.BoundingRectangle.Width; h = SafeInt $c.BoundingRectangle.Height
        })
      }
      $child = $walker.GetFirstChild($el)
      $i = 0
      while ($null -ne $child) { Walk $child ($level + 1) "$path/$i"; $child = $walker.GetNextSibling($child); $i++ }
    }
    Walk $root 0 '0'
    ConvertTo-Json -Compress -Depth 5 -InputObject @($rows)
  }
  'click' {
    $w = Resolve-Window $Window
    if (-not $w) { Write-Error "window not found: '$Window'"; exit 2 }
    $root = Get-UiaRoot $w
    $el = $null
    if ($AutomationId) {
      $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, $AutomationId)
      $el = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
    } elseif ($Name) {
      $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $Name)
      $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
      if ($all.Count -gt $Index) { $el = $all.Item($Index) }
    } else { Write-Error 'click requires -Name or -AutomationId'; exit 3 }
    if (-not $el) {
      foreach ($cand in (Get-GaeaWindows | Where-Object { $_.visible })) {
        $r2 = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$cand.handle)
        if (-not $r2) { continue }
        if ($AutomationId) {
          $c2 = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, $AutomationId)
          $el = $r2.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $c2)
        } else {
          $c2 = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $Name)
          $all2 = $r2.FindAll([System.Windows.Automation.TreeScope]::Descendants, $c2)
          if ($all2.Count -gt $Index) { $el = $all2.Item($Index) }
        }
        if ($el) { break }
      }
    }
    if (-not $el) { Write-Error "control not found (name='$Name' id='$AutomationId' index=$Index)"; exit 5 }
    $via = Invoke-Element $el
    Start-Sleep -Milliseconds 200
    [pscustomobject]@{ clicked = $true; name = $el.Current.Name; id = $el.Current.AutomationId; type = $el.Current.ControlType.ProgrammaticName; via = $via } | ConvertTo-Json -Compress
  }
  'mouse' {
    $w = Resolve-Window $Window
    if (-not $w) { Write-Error "window not found: '$Window'"; exit 2 }
    if ($X -lt 0 -or $Y -lt 0) { Write-Error 'mouse requires -X and -Y (window-relative px)'; exit 3 }
    $ax = $w.x + $X; $ay = $w.y + $Y
    $right = $Button -eq 'right'
    [GaeaWin]::ClickAt($ax, $ay, $right, [bool]$Double)
    [pscustomobject]@{ clicked = $true; x = $ax; y = $ay; relative = @($X, $Y); button = $Button; double = [bool]$Double } | ConvertTo-Json -Compress
  }
  'menu' {
    # Open a top-level menu and read it INSIDE this process: WPF popups are separate HWNDs that close
    # when the process/session loses focus, so click -> wait -> UIA -> screenshot must share one run.
    if (-not $Name) { Write-Error 'menu requires -Name <menu name>'; exit 3 }
    $main = Resolve-Window ''
    if (-not $main) { Write-Error 'main Gaea window not found'; exit 2 }
    $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$main.handle)
    $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $Name)
    $el = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
    if (-not $el) { Write-Error "menu item not found: $Name"; exit 5 }
    $via = Invoke-Element $el
    Start-Sleep -Milliseconds 500
    # collect popup windows (menus are small; the main frame is millions of px)
    $wins = Get-GaeaWindows | Where-Object { $_.visible -and ($_.w * $_.h) -gt 1500 -and ($_.w * $_.h) -lt 900000 }
    $rows = @()
    $shots = @()
    $i = 0
    foreach ($pop in ($wins | Sort-Object -Property @{ Expression = { $_.w * $_.h } } -Descending)) {
      try {
        $proot = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$pop.handle)
        $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
        $stack = New-Object System.Collections.Stack
        $stack.Push(@($proot, 0))
        while ($stack.Count -gt 0) {
          $item = $stack.Pop()
          $node = $item[0]; $lvl = $item[1]
          if ($null -eq $node -or $lvl -gt 10) { continue }
          $c = $node.Current
          if ($c.Name) {
            $rows += [pscustomobject]@{
              name = $c.Name; type = ($c.ControlType.ProgrammaticName -replace 'ControlType\.', '');
              id = $c.AutomationId; x = SafeInt $c.BoundingRectangle.X; y = SafeInt $c.BoundingRectangle.Y;
              w = SafeInt $c.BoundingRectangle.Width; h = SafeInt $c.BoundingRectangle.Height; offscreen = $c.IsOffscreen
            }
          }
          $child = $walker.GetFirstChild($node)
          while ($null -ne $child) { $stack.Push(@($child, $lvl + 1)); $child = $walker.GetNextSibling($child) }
        }
      } catch { }
      if ($Out) {
        $file = Join-Path $Out ("menu-{0}.png" -f $i)
        $bmp = New-Object System.Drawing.Bitmap($pop.w, $pop.h)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $hdc = $g.GetHdc()
        $ok = [GaeaWin]::PrintWindow([IntPtr]$pop.handle, $hdc, [uint32]2)
        $g.ReleaseHdc($hdc); $g.Dispose()
        if ($ok) { $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png); $shots += [pscustomobject]@{ file = $file; handle = $pop.handle; width = $pop.w; height = $pop.h } }
        $bmp.Dispose()
      }
      $i++
    }
    ConvertTo-Json -Compress -Depth 5 -InputObject ([pscustomobject]@{ menu = $Name; via = $via; windows = @($wins).Count; items = @($rows); shots = @($shots) })
  }
  'closewindow' {
    # Close an auxiliary Gaea window (e.g. the F12 Debug Console) so it cannot steal foreground or
    # confuse window resolution during automated runs. Tries UIA WindowPattern.Close, then WM_CLOSE.
    $w = Resolve-Window $Window
    if (-not $w) { [pscustomobject]@{ closed = $false; reason = 'not found' } | ConvertTo-Json -Compress; exit 0 }
    $closed = $false
    try {
      $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$w.handle)
      $p = $null
      if ($root.TryGetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern, [ref]$p)) { $p.Close(); $closed = $true }
    } catch { }
    if (-not $closed) { [GaeaWin]::PostMessage([IntPtr]$w.handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null; $closed = $true }
    Start-Sleep -Milliseconds 300
    [pscustomobject]@{ closed = $closed; handle = $w.handle; title = $w.title } | ConvertTo-Json -Compress
  }
  'value' {
    # Read an automation element's ValuePattern text (Gaea's Debug Console exposes its whole log and
    # command box as Edit controls, so console output can be read as TEXT instead of OCR).
    $w = Resolve-Window $Window
    if (-not $w) { Write-Error "window not found: '$Window'"; exit 2 }
    if (-not $AutomationId) { Write-Error 'value requires -AutomationId <id>'; exit 3 }
    $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$w.handle)
    $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, $AutomationId)
    $el = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
    if (-not $el) { Write-Error "element not found: $AutomationId"; exit 5 }
    $pattern = $null
    if ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
      [pscustomobject]@{ id = $AutomationId; value = $pattern.Current.Value } | ConvertTo-Json -Compress
    } else {
      Write-Error "element $AutomationId has no ValuePattern"; exit 6
    }
  }
  'setvalue' {
    # Write a ValuePattern value (used to type into Gaea's Debug Console command box reliably: SendKeys
    # depends on keyboard focus, which Windows can refuse to grant to a background process).
    $w = Resolve-Window $Window
    if (-not $w) { Write-Error "window not found: '$Window'"; exit 2 }
    if (-not $AutomationId) { Write-Error 'setvalue requires -AutomationId <id>'; exit 3 }
    $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$w.handle)
    $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, $AutomationId)
    $el = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
    if (-not $el) { Write-Error "element not found: $AutomationId"; exit 5 }
    $pattern = $null
    if ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
      $pattern.SetValue($Text)
      [pscustomobject]@{ id = $AutomationId; value = $pattern.Current.Value } | ConvertTo-Json -Compress
    } else { Write-Error "element $AutomationId has no ValuePattern"; exit 6 }
  }
  'move' {
    # move the mouse without clicking (hover-driven UI: Gaea's node palette opens nested flyouts on hover)
    if ($X -lt 0 -or $Y -lt 0) { Write-Error 'move requires -X and -Y (absolute screen px)'; exit 3 }
    [GaeaWin]::MoveCursor($X, $Y)
    Start-Sleep -Milliseconds 120
    [pscustomobject]@{ moved = $true; x = $X; y = $Y } | ConvertTo-Json -Compress
  }
  'keys' {
    $w = Resolve-Window $Window
    if (-not $w) { Write-Error "window not found: '$Window'"; exit 2 }
    [GaeaWin]::ShowWindow([IntPtr]$w.handle, 9) | Out-Null
    [GaeaWin]::SwitchToThisWindow([IntPtr]$w.handle, $true)
    [GaeaWin]::SetForegroundWindow([IntPtr]$w.handle) | Out-Null
    Start-Sleep -Milliseconds 150
    [System.Windows.Forms.SendKeys]::SendWait($Text)
    [pscustomobject]@{ sent = $Text; window = $w.title } | ConvertTo-Json -Compress
  }
  'wait' {
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
      $w = Resolve-Window $Window
      if ($w) { $w | ConvertTo-Json -Compress; exit 0 }
      Start-Sleep -Milliseconds 500
    }
    Write-Error "timed out waiting for window: '$Window'"; exit 6
  }
  default { Write-Error "unknown command: $Command"; exit 9 }
}
