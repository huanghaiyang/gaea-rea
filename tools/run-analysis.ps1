#!/usr/bin/env pwsh
# Reproducible analysis pipeline for reverse-engineering Gaea 2.0.
#
# Re-runs every analysis step from a clean state so a Gaea update (or a fresh
# machine) can be re-analyzed identically. Every stage writes into
# evidence/ or docs/ and is idempotent.
#
# Usage:
#   pwsh -File tools/run-analysis.ps1 [-GaeaDir 'D:\Gaea 2'] [-SkipDecompile]
#
# Requires: .NET 8 SDK, Python 3, Node.js, and the dnSpy/Trae-provided
# ICSharpCode.Decompiler referenced by tools/GaeaDump/GaeaDump.csproj.
# No network access is used or required.

[CmdletBinding()]
param(
    [string]$GaeaDir = 'D:\Gaea 2',
    [string]$Workspace = 'D:\sgames\gaea-rea',
    [switch]$SkipDecompile,
    [switch]$SkipWebCheck
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Write-Stage([string]$msg) {
    Write-Host ''
    Write-Host ('=' * 72) -ForegroundColor DarkGray
    Write-Host "  $msg" -ForegroundColor Cyan
    Write-Host ('=' * 72) -ForegroundColor DarkGray
}

function Assert-Path([string]$p, [string]$what) {
    if (-not (Test-Path -LiteralPath $p)) {
        throw "$what not found: $p"
    }
}

$env:DOTNET_CLI_HOME = Join-Path $Workspace '.dotnet'
$null = New-Item -ItemType Directory -Force -Path $env:DOTNET_CLI_HOME

$dumpExe = Join-Path $Workspace 'tools\GaeaDump\bin\Release\net8.0\GaeaDump.exe'
$decDir = Join-Path $Workspace 'evidence\decompiled'
$docsDir = Join-Path $Workspace 'docs'
foreach ($d in @($decDir, $docsDir, (Join-Path $Workspace 'evidence'))) {
    $null = New-Item -ItemType Directory -Force -Path $d
}

# --------------------------------------------------------------------------
Write-Stage 'STAGE 0 — verify inputs'
# --------------------------------------------------------------------------
Assert-Path $GaeaDir 'Gaea installation'
Assert-Path (Join-Path $GaeaDir 'Resources\Nodes.json') 'Node catalog'
foreach ($asm in @('Gaea.dll', 'Gaea.Engine.dll', 'Gaea.Nodes.dll',
                   'Gaea.CE.dll', 'Gaea.CS.dll', 'Gaea.CW.dll', 'Gaea.TS.dll',
                   'Gaea.Native.dll', 'Gaea.oneAPI.dll', 'Gaea.AdaptiveCpp.dll')) {
    Assert-Path (Join-Path $GaeaDir $asm) "assembly $asm"
}
Write-Host "Gaea directory OK: $GaeaDir"

# --------------------------------------------------------------------------
Write-Stage 'STAGE 1 — build the offline decompiler (GaeaDump)'
# --------------------------------------------------------------------------
Push-Location $Workspace
try {
    dotnet build 'tools\GaeaDump\GaeaDump.csproj' -c Release --nologo | Out-Host
} finally {
    Pop-Location
}
Assert-Path $dumpExe 'GaeaDump build output'
Write-Host "GaeaDump ready: $dumpExe"

if (-not $SkipDecompile) {
    # ----------------------------------------------------------------------
    Write-Stage 'STAGE 2 — decompile Gaea.Nodes.dll (node specifications)'
    # ----------------------------------------------------------------------
    $wholeOut = Join-Path $decDir 'Gaea.Nodes.whole.cs'
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    & $dumpExe whole (Join-Path $GaeaDir 'Gaea.Nodes.dll') 2>$null > $wholeOut
    Write-Host ("whole-module decompile: {0:N0} bytes in {1:N1}s" -f (Get-Item $wholeOut).Length, $sw.Elapsed.TotalSeconds)

    # ----------------------------------------------------------------------
    Write-Stage 'STAGE 3 — decompile Gaea.Engine.dll (execution model)'
    # ----------------------------------------------------------------------
    foreach ($filter in @('QuadSpinner.Gaea.Engine.Fx.', 'QuadSpinner.Gaea.Engine.IO',
                          'QuadSpinner.Gaea.Engine.Utilities', 'QuadSpinner.Gaea.Engine.SyclFunctions')) {
        $safe = ($filter -replace '[^\w]', '_')
        $out = Join-Path $decDir "Gaea.Engine.$safe.cs"
        & $dumpExe dump (Join-Path $GaeaDir 'Gaea.Engine.dll') $filter 2>$null > $out
        Write-Host ("  {0,-40} -> {1:N0} bytes" -f $filter, (Get-Item $out).Length)
    }
}

# --------------------------------------------------------------------------
Write-Stage 'STAGE 4 — normalize encodings (PowerShell redirects emit UTF-16LE)'
# --------------------------------------------------------------------------
Push-Location $Workspace
try {
    python tools\to_utf8.py 'evidence' 'docs' | Out-Host
} finally {
    Pop-Location
}

# --------------------------------------------------------------------------
Write-Stage 'STAGE 5 — extract node specifications from decompiled IL'
# --------------------------------------------------------------------------
Push-Location $Workspace
try {
    python tools\extract_node_specs.py 'evidence\decompiled\Gaea.Nodes.whole.cs' `
        --json 'docs\node-specs-from-il.json' | Out-Host
    python tools\crosscheck_nodes.py (Join-Path $GaeaDir 'Resources\Nodes.json') `
        'docs\node-specs-from-il.json' --json 'docs\nodes-crosscheck-report.json' | Out-Host
} finally {
    Pop-Location
}

# --------------------------------------------------------------------------
Write-Stage 'STAGE 6 — rebuild web data and verify module integrity'
# --------------------------------------------------------------------------
if (-not $SkipWebCheck) {
    Push-Location $Workspace
    try {
        python tools\to_utf8.py 'web\data' 2>$null | Out-Null
        node 'web\data\build-catalog.mjs' | Out-Host
        node 'tools\web-import-check.mjs' | Out-Host
    } finally {
        Pop-Location
    }
}

# --------------------------------------------------------------------------
Write-Stage 'DONE — artifacts'
# --------------------------------------------------------------------------
Push-Location $Workspace
try {
    Get-ChildItem 'docs' -File | Select-Object Name,
        @{n='KB'; e={[math]::Round($_.Length / 1KB)}} | Format-Table -AutoSize
} finally {
    Pop-Location
}
Write-Host 'Analysis pipeline complete.' -ForegroundColor Green
