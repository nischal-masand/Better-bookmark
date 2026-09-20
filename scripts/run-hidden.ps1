# Launches the server with no visible console window, then exits immediately.
# This is what the Startup shortcut points at.

$ErrorActionPreference = 'Stop'

$Root   = Split-Path -Parent $PSScriptRoot
$Node   = (Get-Command node -ErrorAction SilentlyContinue).Source
$TsxCli = Join-Path $Root 'node_modules\tsx\dist\cli.mjs'
$Entry  = Join-Path $Root 'server\src\index.ts'

if (-not $Node) { exit 1 }
if (-not (Test-Path $TsxCli)) { exit 1 }

# Already listening? Nothing to do — a second copy would just exit anyway.
if (Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue) { exit 0 }

Start-Process -FilePath $Node `
  -ArgumentList "`"$TsxCli`"", "`"$Entry`"" `
  -WorkingDirectory $Root `
  -WindowStyle Hidden
