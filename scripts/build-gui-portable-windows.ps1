# Portable **GUI** Windows bundle: **crossusage.exe** (launcher when WebView2Loader.dll exists) +
# **crossusage_gui.exe** (Tauri) + **crossusage-cli.exe** + **WebView2Loader.dll** + **resources\**
# If the MSVC build does not emit WebView2Loader.dll next to the exe, we ship the Tauri binary as
# **crossusage.exe** only (legacy layout).
# From Linux (GNU zip with launcher): scripts/build-gui-portable-zip-windows-gnu.sh after
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
$wv2 = Join-Path $Root "target\release\WebView2Loader.dll"
$res = Join-Path $Root "src-tauri\resources"
$icons = Join-Path $Root "src-tauri\icons"

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

Copy-Item -LiteralPath $cli -Destination (Join-Path $rootStage "crossusage-cli.exe") -Force
Copy-Item -LiteralPath $res -Destination (Join-Path $rootStage "resources") -Recurse -Force
Copy-Item -LiteralPath $icons -Destination (Join-Path $rootStage "icons") -Recurse -Force
Copy-Item -LiteralPath (Join-Path $Root "src-tauri\resources\WINDOWS-PORTABLE.txt") -Destination (Join-Path $rootStage "README-Windows.txt") -Force

if (Test-Path -LiteralPath $wv2) {
  Write-Host "==> Building crossusage-win-launcher (WebView2Loader.dll present) …"
  cargo build --release -p crossusage-win-launcher
  $launcher = Join-Path $Root "target\release\crossusage-win-launcher.exe"
  if (-not (Test-Path -LiteralPath $launcher)) {
    throw "Missing $launcher after cargo build -p crossusage-win-launcher"
  }
  Copy-Item -LiteralPath $gui -Destination (Join-Path $rootStage "crossusage_gui.exe") -Force
  Copy-Item -LiteralPath $launcher -Destination (Join-Path $rootStage "crossusage.exe") -Force
  Copy-Item -LiteralPath $wv2 -Destination (Join-Path $rootStage "WebView2Loader.dll") -Force
} else {
  Write-Warning "Missing $wv2 — shipping single crossusage.exe (MSVC layout; no embedded WebView2 loader stub)."
  Copy-Item -LiteralPath $gui -Destination (Join-Path $rootStage "crossusage.exe") -Force
}

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
