# verify-headless.ps1 — render the Vue app in a headless browser and report what came out.
#
# SAFETY, and this is the point of the whole script: it launches its OWN Chrome with a dedicated
# `--user-data-dir` under the workspace, records that process's PID, and kills ONLY that PID at the
# end. It never enumerates or terminates Chrome processes by name. The machine has two dozen Chrome
# processes belonging to the user's own session, and killing by name would take those with it.
#
# It also uses a dedicated `--remote-debugging-port` that nothing else is using, so it cannot
# attach to or disturb an existing instance.

param(
  [string]$Url = 'http://127.0.0.1:5173/',
  [int]$BudgetMs = 12000,
  [switch]$KeepOpen
)

$ErrorActionPreference = 'Stop'

$chrome = 'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe'
if (-not (Test-Path $chrome)) { throw "Chrome not found at $chrome" }

$root     = Split-Path -Parent $PSScriptRoot
$profile  = Join-Path $root '.chrome-headless'
$outDom   = Join-Path $root '.chrome-headless-dom.html'
$outShot  = Join-Path $root '.chrome-headless-shot.png'

if (Test-Path $profile) { Remove-Item -Recurse -Force $profile }
New-Item -ItemType Directory -Force -Path $profile | Out-Null

# A port nothing else is likely to hold, so this instance is unambiguously ours.
$port = 9333
$args = @(
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--disable-background-networking',
  '--mute-audio',
  "--user-data-dir=$profile",
  "--remote-debugging-port=$port",
  "--virtual-time-budget=$BudgetMs",
  '--window-size=1440,900',
  '--dump-dom',
  $Url
)

Write-Host "  launching our own Chrome (profile: .chrome-headless, port $port)"
$proc = Start-Process -FilePath $chrome -ArgumentList $args -PassThru -NoNewWindow `
  -RedirectStandardOutput $outDom -RedirectStandardError (Join-Path $root '.chrome-headless-err.txt')

Write-Host "  our pid: $($proc.Id)"

try {
  # The dump finishes and the process exits on its own with --dump-dom; wait for that rather than
  # guessing a duration, but cap it so a hang cannot leave a browser running.
  if (-not $proc.WaitForExit($BudgetMs + 30000)) {
    Write-Host "  !! did not exit within the budget; killing only pid $($proc.Id)"
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    $proc.WaitForExit(5000) | Out-Null
  }
} catch {
  Write-Host "  wait failed: $_"
}

# ------------------------------------------------------------------ what came out
Write-Host ''
if (-not (Test-Path $outDom)) { Write-Host '  no DOM was produced'; exit 1 }
$dom = Get-Content $outDom -Raw
Write-Host "  DOM: $($dom.Length) bytes"

function Check([string]$label, [bool]$ok, [string]$detail = '') {
  $mark = if ($ok) { 'OK  ' } else { 'FAIL' }
  Write-Host ("    {0} {1}{2}" -f $mark, $label, $(if ($detail) { "  ($detail)" } else { '' }))
  return $ok
}

$pass = $true

# 1. Vue mounted at all: the mount point is replaced by the rendered shell.
$pass = (Check 'Vue mounted (#app is not empty)' ($dom -notmatch '<div id="app"></div>')) -and $pass
# 2. The shell rendered, not the error box.
$pass = (Check 'no boot error box' ($dom -notmatch 'failed to start')) -and $pass
# 3. The palette rendered its grouping.
$pass = (Check 'palette rendered' ($dom -match 'class="cat"')) -and $pass
# 4. The SVG graph surface exists, which is the rewrite.
$pass = (Check 'SVG graph surface present' ($dom -match '<svg[^>]*class="graph"')) -and $pass
# 5. Coverage is derived, so a real number must be present.
$m = [regex]::Match($dom, '(\d+)/(\d+)')
$pass = (Check 'coverage readout present' $m.Success $(if ($m.Success) { $m.Value } else { '' })) -and $pass
# 6. The inspector rendered.
$pass = (Check 'inspector rendered' ($dom -match 'inspector')) -and $pass

# Any console error the page produced is reported, because a rendered DOM can hide a broken store.
$errFile = Join-Path $root '.chrome-headless-err.txt'
if (Test-Path $errFile) {
  $err = Get-Content $errFile -Raw
  $interesting = ($err -split "`n") | Where-Object { $_ -match 'ERROR|Uncaught|SyntaxError|TypeError|ReferenceError' }
  if ($interesting) {
    Write-Host ''
    Write-Host '  browser errors:'
    $interesting | Select-Object -First 10 | ForEach-Object { Write-Host "    $_" }
    $pass = $false
  } else {
    Write-Host ''
    Write-Host '    OK   no browser errors on stderr'
  }
}

Write-Host ''
Write-Host "  artifacts: .chrome-headless-dom.html"
Write-Host ("  RESULT: {0}" -f $(if ($pass) { 'PASS' } else { 'FAIL' }))

# ------------------------------------------------------------------------ cleanup
$still = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
if ($still -and -not $KeepOpen) {
  Write-Host "  killing our pid $($proc.Id)"
  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
} elseif ($still) {
  Write-Host "  leaving our pid $($proc.Id) running (-KeepOpen)"
}
Write-Host '  (no other browser process was touched)'

exit $(if ($pass) { 0 } else { 1 })
