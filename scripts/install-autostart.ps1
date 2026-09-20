# Makes Better Bookmark start on its own at sign-in, so the bookmark in your
# Chrome bar always has a server to talk to.
#
# Two mechanisms, and the script picks whichever it is allowed to use:
#
#   Scheduled Task   - needs administrator rights. Runs fully in the background
#                      with no window at all, and restarts itself if it crashes.
#   Startup shortcut - needs nothing. A PowerShell window blinks for a moment at
#                      sign-in, then the server runs hidden.
#
# Run this normally for the shortcut; right-click > "Run as administrator" (or
# run it from an elevated terminal) if you want the task instead.

$ErrorActionPreference = 'Stop'

$TaskName = 'BetterBookmark'
$LinkName = 'Better Bookmark.lnk'
$Root     = Split-Path -Parent $PSScriptRoot
$Entry    = Join-Path $Root 'server\src\index.ts'
$TsxCli   = Join-Path $Root 'node_modules\tsx\dist\cli.mjs'
$WebDist  = Join-Path $Root 'web\dist\index.html'
$Runner   = Join-Path $Root 'scripts\run-hidden.ps1'
$StartDir = [Environment]::GetFolderPath('Startup')
$LinkPath = Join-Path $StartDir $LinkName

# --- checks ------------------------------------------------------------------

$Node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $Node) { throw "node.exe was not found on PATH. Install Node.js, then run this again." }
if (-not (Test-Path $TsxCli)) { throw "Dependencies are missing. Run 'npm install' first." }
if (-not (Test-Path $Entry))  { throw "Could not find $Entry - run this from the project folder." }

if (-not (Test-Path $WebDist)) {
  Write-Host "web\dist is missing, building the UI first..." -ForegroundColor Yellow
  Push-Location $Root
  try { & npm run build | Out-Host } finally { Pop-Location }
}

# Start clean so re-running this never leaves both mechanisms registered.
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Remove-Item $LinkPath -Force -ErrorAction SilentlyContinue

$mode = $null

# --- preferred: a background scheduled task ----------------------------------

try {
  # Quote the paths: this project lives under a folder with a space in its name.
  $action = New-ScheduledTaskAction -Execute $Node `
    -Argument ('"{0}" "{1}"' -f $TsxCli, $Entry) `
    -WorkingDirectory $Root

  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -DontStopOnIdleEnd -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -Hidden

  # S4U runs with no window and stores no password.
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Limited

  Register-ScheduledTask -TaskName $TaskName `
    -Action $action `
    -Trigger (New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME) `
    -Settings $settings -Principal $principal `
    -Description 'Serves the Better Bookmark web app on http://127.0.0.1:8765' `
    -ErrorAction Stop | Out-Null

  Start-ScheduledTask -TaskName $TaskName
  $mode = 'scheduled task (fully hidden, restarts on failure)'
} catch {
  Write-Host "Scheduled task needs administrator rights - using a Startup shortcut instead." -ForegroundColor Yellow
}

# --- fallback: a Startup-folder shortcut, no admin needed --------------------

if (-not $mode) {
  $shell = New-Object -ComObject WScript.Shell
  $link = $shell.CreateShortcut($LinkPath)
  $link.TargetPath = (Get-Command powershell.exe).Source
  $link.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $Runner
  $link.WorkingDirectory = $Root
  $link.WindowStyle = 7   # minimised, so the launcher never takes focus
  $link.Description = 'Starts Better Bookmark on http://127.0.0.1:8765'
  $link.Save()

  & $Runner
  $mode = 'Startup shortcut'
}

# --- wait for it to answer ---------------------------------------------------

$up = $false
foreach ($i in 1..40) {
  Start-Sleep -Milliseconds 500
  try {
    if ((Invoke-WebRequest -Uri 'http://127.0.0.1:8765/api/status' -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) {
      $up = $true; break
    }
  } catch { }
}

Write-Host ''
if ($up) {
  Write-Host "  Better Bookmark is running at http://127.0.0.1:8765" -ForegroundColor Green
  Write-Host "  It will start again every time you sign in, via the $mode."
} else {
  Write-Host "  Registered the $mode, but the server did not answer within 20s." -ForegroundColor Yellow
  Write-Host "  Try 'npm start' in this folder to see what it says."
}
Write-Host "  To undo:  npm run autostart:uninstall"
Write-Host ''
