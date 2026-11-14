param()
$ErrorActionPreference = "Stop"
$proj = $PSScriptRoot
Push-Location $proj
& .\build.ps1
if (Test-Path "C:\Program Files (x86)\Inno Setup 6\ISCC.exe") {
  & "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" (Join-Path $proj "installer\MyTunesReduxReborn.iss")
  Write-Host "Installer built in dist/"
} else {
  Write-Host "Inno Setup not found; SEA exe built only. Install Inno Setup to produce installer."
}
Pop-Location