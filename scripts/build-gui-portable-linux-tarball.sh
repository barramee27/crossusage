#!/usr/bin/env bash
# Portable Linux GUI bundle: crossusage + crossusage-cli + src-tauri/resources (same layout beside binaries).
# Prerequisites: `bun run bundle:plugins` and a release build of the app + CLI, e.g.:
#   bun run tauri build --bundles deb
# or: cargo build --release -p crossusage && cargo build --release -p crossusage-cli
# Output: crossusage_<version>_linux_<amd64|arm64>.tar.gz (repo root)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./package.json').version")"
HOST="$(rustc -vV | sed -n 's/^host: //p')"
case "$HOST" in
  x86_64-unknown-linux-gnu)
    TAG="amd64"
    ;;
  aarch64-unknown-linux-gnu)
    TAG="arm64"
    ;;
  *)
    echo "This script expects Linux x86_64 or aarch64 (got host: $HOST)" >&2
    exit 1
    ;;
esac

BIN="$ROOT/target/release/crossusage"
CLI="$ROOT/target/release/crossusage-cli"
RES="$ROOT/src-tauri/resources"

if [[ ! -f "$BIN" ]] || [[ ! -x "$BIN" ]]; then
  echo "Missing $BIN — run \`bun run tauri build\` (or cargo build --release -p crossusage)." >&2
  exit 1
fi
if [[ ! -f "$CLI" ]] || [[ ! -x "$CLI" ]]; then
  echo "Missing $CLI — run \`bun run tauri build\` (beforeBuildCommand builds the CLI sidecar) or:" >&2
  echo "  cargo build --release -p crossusage-cli" >&2
  exit 1
fi
if [[ ! -d "$RES/bundled_plugins" ]]; then
  echo "Missing $RES/bundled_plugins — run: bun run bundle:plugins" >&2
  exit 1
fi

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/root"
cp -f "$BIN" "$CLI" "$STAGE/root/"
cp -a "$RES" "$STAGE/root/resources"

OUT="$ROOT/crossusage_${VERSION}_linux_${TAG}.tar.gz"
rm -f "$OUT"
tar -czf "$OUT" -C "$STAGE/root" .
echo "==> Wrote $OUT"
ls -lh "$OUT"

REL="$ROOT/releases"
if [[ -d "$REL" ]]; then
  cp -f "$OUT" "$REL/"
  echo "==> Copied to $REL/"
fi
