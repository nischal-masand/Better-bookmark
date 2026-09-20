# Removes whichever autostart mechanism is installed and stops the server.
# Your bookmarks, tags, notes and cached previews in .\data are untouched.

$ErrorActionPreference = 'Stop'

$TaskName = 'BetterBookmark'
$LinkPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'Better Bookmark.lnk'
$removed  = $false

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Removed the '$TaskName' logon task." -ForegroundColor Green
  $removed = $true
}

if (Test-Path $LinkPath) {
  Remove-Item $LinkPath -Force
  Write-Host "Removed the Startup shortcut." -ForegroundColor Green
  $removed = $true
}

if (-not $removed) { Write-Host "Nothing was installed - no autostart entry found." }

$listener = Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue
if ($listener) {
  $listener | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
  Write-Host "Stopped the server on port 8765."
}

Write-Host "Your data in .\data is untouched. Start it again any time with: npm start"
