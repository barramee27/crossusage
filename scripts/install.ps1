# CrossUsage — install from GitHub (Windows).
# Repo: https://github.com/barramee27/crossusage
#
# Usage (PowerShell):
#   irm https://raw.githubusercontent.com/barramee27/crossusage/feat/linux-windows-native-support/scripts/install.ps1 | iex
#
# Environment:
#   $env:GITHUB_REPO     default: barramee27/crossusage
#   $env:INSTALL_MODE    full (default) | cli — full = NSIS x64-setup.exe; cli = portable zip/tar.gz (binary + resources) like install.sh INSTALL_MODE=cli
#   $env:INSTALL_GIT_REF branch or tag for raw.githubusercontent.com CLI bundle (default: feat/linux-windows-native-support)
#   $env:INSTALL_CLI_URL optional override URL for the CLI .zip or .tar.gz
#   $env:INSTALL_SILENT  if "0" or "false", run NSIS installer interactively (full mode only; no effect in cli mode)

$ErrorActionPreference = "Stop"

$GithubRepo = if ($env:GITHUB_REPO) { $env:GITHUB_REPO } else { "barramee27/crossusage" }
$InstallGitRef = if ($env:INSTALL_GIT_REF) { $env:INSTALL_GIT_REF } else { "feat/linux-windows-native-support" }
$InstallMode = if ($env:INSTALL_MODE) { $env:INSTALL_MODE.Trim().ToLowerInvariant() } else { "full" }

$headers = @{
  "User-Agent" = "CrossUsage-Install-Script"
  "Accept"     = "application/vnd.github+json"
}

function Get-CliArchTag {
  switch ($env:PROCESSOR_ARCHITECTURE) {
    "AMD64" { return "amd64" }
    "ARM64" { return "arm64" }
    default {
      Write-Error "INSTALL_MODE=cli: unsupported processor architecture '$($env:PROCESSOR_ARCHITECTURE)' (need AMD64 or ARM64)."
      exit 1
    }
  }
}

function Get-RepoPackageVersion {
  $url = "https://raw.githubusercontent.com/$GithubRepo/$InstallGitRef/package.json"
  try {
    $pkg = Invoke-RestMethod -Uri $url -Headers $headers
    return [string]$pkg.version.Trim()
  } catch {
    return $null
  }
}

function Test-UrlOk {
  param([string]$Url)
  try {
    $r = Invoke-WebRequest -Uri $Url -Method Head -Headers $headers -UseBasicParsing -TimeoutSec 30
    return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 400)
  } catch {
    return $false
  }
}

function Download-File {
  param([string]$Url, [string]$Dest)
  Invoke-WebRequest -Uri $Url -OutFile $Dest -UseBasicParsing -Headers $headers
}

function Add-UserPathEntry {
  param([string]$Dir)
  if (-not (Test-Path -LiteralPath $Dir)) {
    New-Item -ItemType Directory -Path $Dir -Force | Out-Null
  }
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if (-not $userPath) { $userPath = "" }
  $parts = $userPath -split ";" | Where-Object { $_ -and $_.Trim() }
  $norm = $Dir.TrimEnd("\")
  $already = $false
  foreach ($p in $parts) {
    if ($p.TrimEnd("\").Equals($norm, [StringComparison]::OrdinalIgnoreCase)) {
      $already = $true
      break
    }
  }
  if (-not $already) {
    $newPath = if ($userPath) { "$userPath;$Dir" } else { $Dir }
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
  }
  if ($env:Path -notlike "*$Dir*") {
    $env:Path = "$Dir;$env:Path"
  }
}

function Install-PortableCli {
  $archTag = Get-CliArchTag
  $repoBase = "https://raw.githubusercontent.com/$GithubRepo/$InstallGitRef/releases"
  $ver = Get-RepoPackageVersion

  $versionedZip = $null
  $versionedTgz = $null
  if ($ver) {
    $versionedZip = "$repoBase/crossusage-cli_${ver}_windows_${archTag}.zip"
    $versionedTgz = "$repoBase/crossusage-cli_${ver}_windows_${archTag}.tar.gz"
  }
  $legacyZip = "$repoBase/crossusage-cli_windows_${archTag}.zip"
  $legacyTgz = "$repoBase/crossusage-cli_windows_${archTag}.tar.gz"

  $defaultUrl = $null
  $kind = "unknown"

  if ($env:INSTALL_CLI_URL -and $env:INSTALL_CLI_URL.Trim()) {
    $defaultUrl = $env:INSTALL_CLI_URL.Trim()
    $kind = "override"
  } elseif ($versionedZip) {
    $defaultUrl = $versionedZip
    $kind = "versioned-zip"
  } else {
    $defaultUrl = $legacyZip
    $kind = "legacy-zip"
  }

  $tmp = Join-Path $env:TEMP ("crossusage-cli-" + [guid]::NewGuid().ToString())
  $tmpZip = $tmp + ".zip"
  $tmpTgz = $tmp + ".tar.gz"

  Write-Host "Downloading portable CLI bundle (windows $archTag) …"

  $gotFrom = $null
  $downloaded = $false

  function Try-Download([string]$Url, [string]$Dest) {
    try {
      Download-File -Url $Url -Dest $Dest
      return (Test-Path -LiteralPath $Dest) -and ((Get-Item $Dest).Length -gt 0)
    } catch {
      return $false
    }
  }

  if ($defaultUrl -match "\.tar\.gz$") {
    if (Try-Download $defaultUrl $tmpTgz) { $downloaded = $true; $gotFrom = $kind }
  } else {
    if (Try-Download $defaultUrl $tmpZip) { $downloaded = $true; $gotFrom = $kind }
  }

  if (-not $downloaded -and -not ($env:INSTALL_CLI_URL -and $env:INSTALL_CLI_URL.Trim())) {
    if ($kind -eq "versioned-zip" -and $legacyZip) {
      Write-Host "Trying legacy repo path: releases/crossusage-cli_windows_${archTag}.zip …"
      if (Try-Download $legacyZip $tmpZip) { $downloaded = $true; $gotFrom = "legacy-zip" }
    }
    if (-not $downloaded -and $versionedTgz) {
      if (Try-Download $versionedTgz $tmpTgz) { $downloaded = $true; $gotFrom = "versioned-tgz" }
    }
    if (-not $downloaded -and $legacyTgz) {
      if (Try-Download $legacyTgz $tmpTgz) { $downloaded = $true; $gotFrom = "legacy-tgz" }
    }
  }

  if (-not $downloaded) {
    Write-Host "Trying GitHub Release assets instead …"
    $apiUrl = "https://api.github.com/repos/$GithubRepo/releases/latest"
    $release = Invoke-RestMethod -Uri $apiUrl -Headers $headers
    $reZip = [regex]::new("crossusage-cli_.+_windows_${archTag}\.zip$", "IgnoreCase")
    $reTgz = [regex]::new("crossusage-cli_.+_windows_${archTag}\.tar\.gz$", "IgnoreCase")
    $asset = $release.assets | Where-Object { $reZip.IsMatch($_.name) } | Select-Object -First 1
    if (-not $asset) {
      $asset = $release.assets | Where-Object { $reTgz.IsMatch($_.name) } | Select-Object -First 1
    }

    if (-not $asset) {
      Write-Error @"
No CLI bundle found for windows_${archTag}.
Add releases/crossusage-cli_<version>_windows_${archTag}.zip on branch $InstallGitRef (see scripts/build-cli-windows.ps1), or attach that asset to the latest GitHub Release.
"@
      exit 1
    }

    $ext = [System.IO.Path]::GetExtension($asset.name).ToLowerInvariant()
    if ($asset.name -match "\.tar\.gz$") {
      Download-File -Url $asset.browser_download_url -Dest $tmpTgz
      $gotFrom = "release-tgz"
    } else {
      Download-File -Url $asset.browser_download_url -Dest $tmpZip
      $gotFrom = "release-zip"
    }
    $downloaded = $true
  }

  if ($gotFrom -like "legacy-*" -and $ver) {
    Write-Warning "Used legacy filename; ensure releases/crossusage-cli_${ver}_windows_${archTag}.zip is committed on $InstallGitRef so installs get the matching build."
  }

  $rootCli = Join-Path $env:USERPROFILE ".local\lib\crossusage"
  $binDir = Join-Path $env:USERPROFILE ".local\bin"

  if (Test-Path -LiteralPath (Join-Path $rootCli "crossusage-cli.exe")) {
    Write-Host "Existing portable CLI found — replacing binary and resources under $rootCli (reinstall / update)."
  } else {
    Write-Host "Installing portable CLI under $rootCli …"
  }

  if (Test-Path -LiteralPath $rootCli) {
    Remove-Item -LiteralPath $rootCli -Recurse -Force
  }
  New-Item -ItemType Directory -Path $rootCli -Force | Out-Null

  if (Test-Path -LiteralPath $tmpZip) {
    Expand-Archive -LiteralPath $tmpZip -DestinationPath $rootCli -Force
    Remove-Item -Force -ErrorAction SilentlyContinue $tmpZip
  } elseif (Test-Path -LiteralPath $tmpTgz) {
    $tar = Get-Command tar -ErrorAction SilentlyContinue
    if (-not $tar) {
      Write-Error "Need tar.exe to extract .tar.gz (included in Windows 10+). Or publish a .zip bundle instead."
      exit 1
    }
    & tar.exe -xzf $tmpTgz -C $rootCli
    Remove-Item -Force -ErrorAction SilentlyContinue $tmpTgz
  } else {
    Write-Error "Download failed: no archive was saved."
    exit 1
  }

  $exePath = Join-Path $rootCli "crossusage-cli.exe"
  if (-not (Test-Path -LiteralPath $exePath)) {
    Write-Error "Bundle did not contain crossusage-cli.exe at the root of the archive. Expected layout: crossusage-cli.exe and resources\bundled_plugins\ (same as Linux tarball)."
    exit 1
  }

  New-Item -ItemType Directory -Path $binDir -Force | Out-Null
  $shim = Join-Path $binDir "crossusage-cli.cmd"
  $shimLines = @(
    '@echo off',
    'setlocal',
    'set "CU_EXE=%USERPROFILE%\.local\lib\crossusage\crossusage-cli.exe"',
    'if not exist "%CU_EXE%" (echo crossusage-cli: not installed at %CU_EXE% & exit /b 1)',
    'call "%CU_EXE%" %*',
    'exit /b %ERRORLEVEL%'
  )
  Set-Content -LiteralPath $shim -Value ($shimLines -join "`r`n") -Encoding ascii

  Add-UserPathEntry -Dir $binDir

  Write-Host "Installed portable CLI: $exePath"
  Write-Host "Shim on PATH: $shim"
  Write-Host ""
  Write-Host "Verifying ..."
  $env:Path = "$binDir;$env:Path"
  try {
    & $exePath list 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0 -or $LASTEXITCODE -eq $null) {
      Write-Host "crossusage-cli list: ok"
    } else {
      Write-Warning "crossusage-cli list: non-zero exit (check resources under $rootCli\resources)."
    }
  } catch {
    Write-Warning "crossusage-cli list: failed ($($_.Exception.Message))"
  }
  Write-Host "Done."
}

# --- CLI-only portable bundle (parity with install.sh INSTALL_MODE=cli) ---
if ($InstallMode -eq "cli") {
  Install-PortableCli
  exit 0
}

if ($InstallMode -ne "full") {
  Write-Error "Invalid INSTALL_MODE='$($env:INSTALL_MODE)' (use full or cli)."
  exit 1
}

# --- Full install: NSIS GUI + bundled CLI (classic) ---
$apiUrl = "https://api.github.com/repos/$GithubRepo/releases/latest"

Write-Host "Fetching latest release from GitHub ($GithubRepo) ..."
$release = Invoke-RestMethod -Uri $apiUrl -Headers $headers

$asset = $release.assets | Where-Object { $_.name -match 'x64-setup\.exe$' } | Select-Object -First 1
if (-not $asset) {
  Write-Error "No NSIS installer (*x64-setup.exe) found in latest release. For CLI-only (no installer), run:`n  `$env:INSTALL_MODE='cli'; irm https://raw.githubusercontent.com/$GithubRepo/$InstallGitRef/scripts/install.ps1 | iex`nSee https://github.com/$GithubRepo/releases/latest"
  exit 1
}

$dest = Join-Path $env:TEMP ("crossusage-setup-" + [guid]::NewGuid().ToString() + ".exe")
Write-Host "Downloading $($asset.name) ..."
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $dest -UseBasicParsing -Headers $headers

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
