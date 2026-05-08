#!/usr/bin/env bash
# After `scripts/build-all-artifacts.sh`, copy bundles into ./release-artifacts/<version>/
# so filenames are easy to find (pattern is driven by tauri.conf.json productName + version).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./package.json').version")"
OUT="$ROOT/release-artifacts/crossusage-${VERSION}"
mkdir -p "$OUT"

echo "Collecting CrossUsage ${VERSION} bundles into $OUT"

copy_glob () {
  local pattern="$1"
  shopt -s nullglob
  local files=( $pattern )
  shopt -u nullglob
  if [ ${#files[@]} -eq 0 ]; then
    echo "  (skip) no files: $pattern"
    return 0
  fi
  for f in "${files[@]}"; do
    echo "  + $(basename "$f")"
    cp -f "$f" "$OUT/"
  done
}

# Linux (native host build) — workspace uses repo-root target/
# Pin to ${VERSION}: the bundle dirs accumulate older *.deb/*.rpm from past builds.
copy_glob "$ROOT/target/release/bundle/deb/crossusage_${VERSION}_amd64.deb"
copy_glob "$ROOT/target/release/bundle/rpm/crossusage-${VERSION}-"*.rpm
copy_glob "$ROOT/target/release/bundle/appimage/crossusage_${VERSION}_amd64.AppImage"

# Windows (GNU cross-target) — MinGW Tauri binary delay-loads WebView2Loader.dll from the exe directory.
copy_glob "$ROOT/target/x86_64-pc-windows-gnu/release/bundle/nsis/crossusage_${VERSION}_x64-setup.exe"
copy_glob "$ROOT/target/x86_64-pc-windows-gnu/release/crossusage.exe"
copy_glob "$ROOT/target/x86_64-pc-windows-gnu/release/WebView2Loader.dll"

# Single-file portable (optional — scripts/build-gui-portable-onefile-windows-gnu.sh)
copy_glob "$ROOT/crossusage_${VERSION}_windows_amd64_onefile"*.exe

# Portable Linux CLI (optional — run scripts/build-cli-tarball.sh on Linux amd64/arm64 first)
copy_glob "$ROOT/crossusage-cli_${VERSION}_linux_"*.tar.gz
copy_glob "$ROOT/crossusage-cli_${VERSION}_windows_"*.zip

# Portable Linux GUI (optional — scripts/build-gui-portable-linux-tarball.sh after tauri build)
copy_glob "$ROOT/crossusage_${VERSION}_linux_"*.tar.gz

# Portable Windows GUI (optional — scripts/build-gui-portable-windows.ps1 on Windows after tauri build)
copy_glob "$ROOT/crossusage_${VERSION}_windows_"*.zip

# Portable macOS GUI (optional — scripts/build-gui-portable-macos-tarball.sh)
copy_glob "$ROOT/crossusage_${VERSION}_darwin_"*.tar.gz

cat > "$OUT/README.txt" << EOF
CrossUsage ${VERSION} — release artifacts
Fork: https://github.com/barramee27/crossusage
Upstream OpenUsage (Robin Ebers): https://github.com/robinebers/openusage

Typical filenames (Tauri uses productName "crossusage" + version ${VERSION}):
  - Debian:    crossusage_${VERSION}_amd64.deb
  - RPM:       crossusage-${VERSION}-1.x86_64.rpm (release may vary)
  - AppImage:  crossusage_${VERSION}_amd64.AppImage
  - Windows:   crossusage_${VERSION}_x64-setup.exe (NSIS installer)
  - Windows:   crossusage.exe + WebView2Loader.dll (same folder — required for GNU/MinGW portable exe)
  - Windows:   crossusage_${VERSION}_windows_amd64_onefile*.exe (optional true single-file; see build-gui-portable-onefile-windows-gnu.sh)
  - CLI:       crossusage-cli (same .deb / installer as GUI when built with prepare-cli-sidecar.sh)
  - CLI tarball: crossusage-cli_${VERSION}_linux_amd64.tar.gz, crossusage-cli_${VERSION}_windows_amd64.zip (scripts/build-cli-tarball.sh / build-cli-zip-windows-gnu.sh) for INSTALL_MODE=cli
  - Portable GUI: crossusage_${VERSION}_linux_<arch>.tar.gz, crossusage_${VERSION}_windows_<arch>.zip, crossusage_${VERSION}_darwin_<arch>.tar.gz (see scripts/build-gui-portable-*.sh / .ps1)
EOF

echo "Done. See $OUT/README.txt"
