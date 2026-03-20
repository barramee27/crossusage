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

# Linux (native host build)
copy_glob "$ROOT/src-tauri/target/release/bundle/deb/"*.deb
copy_glob "$ROOT/src-tauri/target/release/bundle/rpm/"*.rpm
copy_glob "$ROOT/src-tauri/target/release/bundle/appimage/"*.AppImage

# Windows (GNU cross-target)
copy_glob "$ROOT/src-tauri/target/x86_64-pc-windows-gnu/release/bundle/nsis/"*.exe
copy_glob "$ROOT/src-tauri/target/x86_64-pc-windows-gnu/release/"crossusage.exe

cat > "$OUT/README.txt" << EOF
CrossUsage ${VERSION} — release artifacts
Fork: https://github.com/barramee27/crossusage
Upstream OpenUsage (Robin Ebers): https://github.com/robinebers/openusage

Typical filenames (Tauri uses productName "crossusage" + version ${VERSION}):
  - Debian:    crossusage_${VERSION}_amd64.deb
  - RPM:       crossusage-${VERSION}-1.x86_64.rpm (release may vary)
  - AppImage:  crossusage_${VERSION}_amd64.AppImage
  - Windows:   crossusage_${VERSION}_x64-setup.exe (NSIS) and crossusage.exe
EOF

echo "Done. See $OUT/README.txt"
