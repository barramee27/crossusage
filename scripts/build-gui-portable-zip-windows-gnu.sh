#!/usr/bin/env bash
# Portable **GUI** Windows bundle from Linux: crossusage.exe + crossusage-cli.exe + resources/
# (Same layout as scripts/build-gui-portable-windows.ps1 on Windows, but uses the MinGW cross target.)
#
# This is **not** the CLI-only zip — that is scripts/build-cli-zip-windows-gnu.sh (crossusage-cli.exe only).
#
# Prerequisites (Debian/Ubuntu example):
#   sudo apt install -y mingw-w64 zip
#   rustup target add x86_64-pc-windows-gnu
#   bun install
#
# 1) Build the Windows GUI (produces target/x86_64-pc-windows-gnu/release/*.exe):
#      bun run tauri build --target x86_64-pc-windows-gnu
# 2) Then:
#      ./scripts/build-gui-portable-zip-windows-gnu.sh
#
# Output: crossusage_<version>_windows_amd64.zip (repo root)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TARGET="x86_64-pc-windows-gnu"
VERSION="$(node -p "require('./package.json').version")"
TAG="amd64"

if ! rustup target list --installed | grep -q "^${TARGET}\$"; then
  echo "Missing Rust target ${TARGET}. Run: rustup target add ${TARGET}" >&2
  exit 1
fi

if ! command -v x86_64-w64-mingw32-gcc >/dev/null 2>&1; then
  echo "Missing MinGW linker (x86_64-w64-mingw32-gcc). On Debian/Ubuntu: sudo apt install -y mingw-w64" >&2
  exit 1
fi

if ! command -v zip >/dev/null 2>&1; then
  echo "Need zip(1). On Debian/Ubuntu: sudo apt install -y zip" >&2
  exit 1
fi

GUI="${ROOT}/target/${TARGET}/release/crossusage.exe"
CLI="${ROOT}/target/${TARGET}/release/crossusage-cli.exe"
RES="${ROOT}/src-tauri/resources"

if [[ ! -f "$GUI" ]]; then
  echo "Missing $GUI" >&2
  echo "Build the Windows GUI first, e.g.: bun run tauri build --target ${TARGET}" >&2
  exit 1
fi

if [[ ! -f "$CLI" ]]; then
  echo "Missing $CLI — building crossusage-cli for ${TARGET} …"
  cargo build --release -p crossusage-cli --target "${TARGET}"
fi

if [[ ! -d "$RES/bundled_plugins" ]]; then
  echo "Missing $RES/bundled_plugins — run: bun run bundle:plugins" >&2
  exit 1
fi

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "${STAGE}/root"
cp -f "$GUI" "$CLI" "${STAGE}/root/"
cp -a "$RES" "${STAGE}/root/resources"

OUT="${ROOT}/crossusage_${VERSION}_windows_${TAG}.zip"
rm -f "$OUT"
(
  cd "${STAGE}/root"
  zip -qr "$OUT" .
)

echo "==> Wrote $OUT"
ls -lh "$OUT"

REL="${ROOT}/releases"
if [[ -d "$REL" ]]; then
  cp -f "$OUT" "${REL}/"
  echo "==> Copied to releases/"
fi
