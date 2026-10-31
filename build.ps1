param()

$ErrorActionPreference = "Stop"
$proj = $PSScriptRoot
$node = "C:\Program Files\nodejs\node.exe"
$esbuild = "C:\Users\Poonjab\AppData\Roaming\npm\esbuild.cmd"
$postject = "C:\Users\Poonjab\AppData\Roaming\npm\postject.cmd"

$pkg = Get-Content (Join-Path $proj "package.json") | ConvertFrom-Json
$ver = $pkg.version
$dest = "C:\Users\Poonjab\Desktop\Projects\MytunesRedux\v$ver"
New-Item -ItemType Directory -Force -Path $dest | Out-Null

Push-Location $proj
& $esbuild server.js --bundle --platform=node --target=node26 --outfile=sea-main.js
& $node --experimental-sea-config sea-config.json
Copy-Item "C:\Program Files\nodejs\node.exe" (Join-Path $proj "MyTunesReduxReborn.exe") -Force
& $postject (Join-Path $proj "MyTunesReduxReborn.exe") NODE_SEA_BLOB sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
Copy-Item (Join-Path $proj "MyTunesReduxReborn.exe") (Join-Path $dest "MyTunesReduxReborn.exe") -Force
Pop-Location

Write-Host "Build complete: v$ver -> $dest"