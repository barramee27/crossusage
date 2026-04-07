# Portable **GUI** Windows bundle: crossusage.exe + crossusage-cli.exe + resources\
# (CLI-only zip from Linux: scripts/build-cli-zip-windows-gnu.sh — crossusage-cli.exe + plugins only.)
# From Linux (same GUI zip, cross-target): scripts/build-gui-portable-zip-windows-gnu.sh after
#   bun run tauri build --target x86_64-pc-windows-gnu
# Run from repo root after a release GUI build, e.g.:
#   bun run tauri build
# Output: crossusage_<version>_windows_<amd64|arm64>.zip (repo root)
$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $Root

$pkg = Get-Content -Raw (Join-Path $Root "package.json") | ConvertFrom-Json
$Version = [string]$pkg.version.Trim()

switch ($env:PROCESSOR_ARCHITECTURE) {
  "AMD64" { $Tag = "amd64" }
  "ARM64" { $Tag = "arm64" }
  default { throw "Unsupported PROCESSOR_ARCHITECTURE=$($env:PROCESSOR_ARCHITECTURE) (need AMD64 or ARM64)" }
}

$gui = Join-Path $Root "target\release\crossusage.exe"
$cli = Join-Path $Root "target\release\crossusage-cli.exe"
$res = Join-Path $Root "src-tauri\resources"

if (-not (Test-Path -LiteralPath $gui)) {
  throw "Missing $gui — run: bun run tauri build"
}
if (-not (Test-Path -LiteralPath $cli)) {
  throw "Missing $cli — run: bun run tauri build (or cargo build --release -p crossusage-cli)"
}
if (-not (Test-Path -LiteralPath (Join-Path $res "bundled_plugins"))) {
  throw "Missing bundled_plugins — run: bun run bundle:plugins"
}

$stage = Join-Path $env:TEMP ("crossusage-gui-portable-" + [guid]::NewGuid().ToString())
$rootStage = Join-Path $stage "root"
New-Item -ItemType Directory -Path $rootStage -Force | Out-Null
Copy-Item -LiteralPath $gui -Destination (Join-Path $rootStage "crossusage.exe") -Force
Copy-Item -LiteralPath $cli -Destination (Join-Path $rootStage "crossusage-cli.exe") -Force
Copy-Item -LiteralPath $res -Destination (Join-Path $rootStage "resources") -Recurse -Force

$zipName = "crossusage_${Version}_windows_${Tag}.zip"
$zipPath = Join-Path $Root $zipName
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
Compress-Archive -Path (Join-Path $rootStage "*") -DestinationPath $zipPath -Force
Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "==> Wrote $zipPath"
Get-Item $zipPath | Select-Object Name, Length

$rel = Join-Path $Root "releases"
if (Test-Path -LiteralPath $rel) {
  Copy-Item -LiteralPath $zipPath -Destination (Join-Path $rel $zipName) -Force
  Write-Host "==> Copied to releases\"
}
