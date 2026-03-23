# CrossUsage — install latest Windows release from GitHub (NSIS).
# Repo: https://github.com/barramee27/crossusage
#
# Usage (PowerShell):
#   irm https://raw.githubusercontent.com/barramee27/crossusage/feat/linux-windows-native-support/scripts/install.ps1 | iex
#
# Environment:
#   $env:GITHUB_REPO  default: barramee27/crossusage
#   $env:INSTALL_SILENT  if "0" or "false", run installer interactively (no /S)

$ErrorActionPreference = "Stop"

$GithubRepo = if ($env:GITHUB_REPO) { $env:GITHUB_REPO } else { "barramee27/crossusage" }
$apiUrl = "https://api.github.com/repos/$GithubRepo/releases/latest"

$headers = @{
  "User-Agent" = "CrossUsage-Install-Script"
  "Accept"     = "application/vnd.github+json"
}

Write-Host "Fetching latest release from GitHub ($GithubRepo) ..."
$release = Invoke-RestMethod -Uri $apiUrl -Headers $headers

$asset = $release.assets | Where-Object { $_.name -match 'x64-setup\.exe$' } | Select-Object -First 1
if (-not $asset) {
  Write-Error "No NSIS installer (*x64-setup.exe) found in latest release. See https://github.com/$GithubRepo/releases/latest"
  exit 1
}

$dest = Join-Path $env:TEMP ("crossusage-setup-" + [guid]::NewGuid().ToString() + ".exe")
Write-Host "Downloading $($asset.name) ..."
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $dest -UseBasicParsing

$silent = $true
if ($env:INSTALL_SILENT -match '^(0|false|no)$') { $silent = $false }

if ($silent) {
  Write-Host "Running installer silently (NSIS /S). Set `$env:INSTALL_SILENT=0 for interactive install."
  $p = Start-Process -FilePath $dest -ArgumentList @("/S") -PassThru -Wait
  if ($p.ExitCode -ne 0) {
    Write-Warning "Installer exit code $($p.ExitCode). Try interactive: `$env:INSTALL_SILENT=0; then re-run this script."
  }
} else {
  Write-Host "Running installer (interactive) ..."
  Start-Process -FilePath $dest -Wait
}

Remove-Item -Force -ErrorAction SilentlyContinue $dest

Write-Host ""
Write-Host "Verifying install ..."
$cli = Get-Command crossusage-cli -ErrorAction SilentlyContinue
if ($cli) {
  Write-Host "Found: $($cli.Source)"
} else {
  Write-Warning "crossusage-cli not on PATH yet. Open a new terminal or sign out/in; or add the install directory to PATH."
}

$app = Get-Command crossusage -ErrorAction SilentlyContinue
if ($app) {
  Write-Host "Found: $($app.Source)"
}

Write-Host "Done."
