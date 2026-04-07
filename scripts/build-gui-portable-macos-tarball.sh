#!/usr/bin/env bash
# Pack the built .app from `bun run tauri build` into a portable .tar.gz (for releases / manual install).
# Run on macOS only, after: bun install && bun run bundle:plugins && bun run tauri build
# Output: crossusage_<version>_darwin_<amd64|arm64>.tar.gz (repo root)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "macOS only" >&2
  exit 1
fi

VERSION="$(node -p "require('./package.json').version")"
case "$(uname -m)" in
  x86_64) TAG="amd64" ;;
  arm64) TAG="arm64" ;;
  *) echo "unsupported arch $(uname -m)" >&2; exit 1 ;;
esac

MACOS_DIR="$ROOT/target/release/bundle/macos"
shopt -s nullglob
apps=( "$MACOS_DIR"/*.app )
shopt -u nullglob
if [[ ${#apps[@]} -eq 0 ]]; then
  echo "No .app under $MACOS_DIR — run: bun run tauri build" >&2
  exit 1
fi

APP="${apps[0]}"
APP_NAME="$(basename "$APP")"
PARENT="$(dirname "$APP")"

OUT="$ROOT/crossusage_${VERSION}_darwin_${TAG}.tar.gz"
rm -f "$OUT"
tar -czf "$OUT" -C "$PARENT" "$APP_NAME"
echo "==> Wrote $OUT"
ls -lh "$OUT"
