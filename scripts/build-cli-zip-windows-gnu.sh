#!/usr/bin/env bash
# Build portable Windows CLI bundle (.zip) from Linux: crossusage-cli.exe + resources/bundled_plugins
# (same layout as scripts/build-cli-windows.ps1 / install.ps1 INSTALL_MODE=cli).
#
# Prerequisites (Debian/Ubuntu example):
#   sudo apt install -y mingw-w64 zip
#   rustup target add x86_64-pc-windows-gnu
#
# Run from repo root:
#   ./scripts/build-cli-zip-windows-gnu.sh
#
# Output: crossusage-cli_<version>_windows_amd64.zip (+ optional copies under releases/)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TARGET="x86_64-pc-windows-gnu"
VERSION="$(node -p "require('./package.json').version")"

if ! rustup target list --installed | grep -q "^${TARGET}\$"; then
  echo "Missing Rust target ${TARGET}. Run: rustup target add ${TARGET}" >&2
  exit 1
fi

if ! command -v x86_64-w64-mingw32-gcc >/dev/null 2>&1; then
  echo "Missing MinGW linker (x86_64-w64-mingw32-gcc). On Debian/Ubuntu: sudo apt install -y mingw-w64" >&2
  exit 1
fi

echo "==> Building crossusage-cli (release) for ${TARGET}"
cargo build --release -p crossusage-cli --target "${TARGET}"

EXE="${ROOT}/target/${TARGET}/release/crossusage-cli.exe"
if [[ ! -f "$EXE" ]]; then
  echo "Expected ${EXE} after cargo build" >&2
  exit 1
fi

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "${STAGE}/root/resources"
cp -f "$EXE" "${STAGE}/root/crossusage-cli.exe"
cp -a "${ROOT}/src-tauri/resources/bundled_plugins" "${STAGE}/root/resources/"

OUT="${ROOT}/crossusage-cli_${VERSION}_windows_amd64.zip"
rm -f "$OUT"
(
  cd "${STAGE}/root"
  if command -v zip >/dev/null 2>&1; then
    zip -qr "$OUT" .
  else
    echo "Need zip(1). On Debian/Ubuntu: sudo apt install -y zip" >&2
    exit 1
  fi
)

echo "==> Wrote $OUT"
ls -lh "$OUT"

REL="${ROOT}/releases"
if [[ -d "$REL" ]]; then
  cp -f "$OUT" "${REL}/crossusage-cli_${VERSION}_windows_amd64.zip"
  cp -f "$OUT" "${REL}/crossusage-cli_windows_amd64.zip"
  echo "==> Copied to releases/ (and legacy crossusage-cli_windows_amd64.zip)"
fi
