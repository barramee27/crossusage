#!/usr/bin/env bash
# Build crossusage-cli for the same target as the Tauri app and place it where Tauri externalBin expects.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -n "${CARGO_BUILD_TARGET:-}" ]]; then
  TARGET="$CARGO_BUILD_TARGET"
else
  TARGET="$(rustc -vV | awk '/host:/{print $2}')"
fi

echo "==> Building crossusage-cli for $TARGET"
cargo build --release -p crossusage-cli --target "$TARGET"

mkdir -p "$ROOT/src-tauri/binaries"
if [[ "$TARGET" == *"windows"* ]]; then
  SRC="$ROOT/target/$TARGET/release/crossusage-cli.exe"
  DEST="$ROOT/src-tauri/binaries/crossusage-cli-$TARGET.exe"
else
  SRC="$ROOT/target/$TARGET/release/crossusage-cli"
  DEST="$ROOT/src-tauri/binaries/crossusage-cli-$TARGET"
fi

cp -f "$SRC" "$DEST"
chmod +x "$DEST" 2>/dev/null || true
echo "==> CLI sidecar: $DEST"
