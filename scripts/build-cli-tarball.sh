#!/usr/bin/env bash
# Build a portable CLI bundle: binary + resources/bundled_plugins (for INSTALL_MODE=cli).
# Output: crossusage-cli_<version>_<os>_<arch>.tar.gz (matches scripts/install.sh)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./package.json').version")"

HOST="$(rustc -vV | sed -n 's/^host: //p')"
case "$HOST" in
  x86_64-unknown-linux-gnu)
    OS="linux"
    TAG="amd64"
    ;;
  aarch64-unknown-linux-gnu)
    OS="linux"
    TAG="arm64"
    ;;
  x86_64-apple-darwin)
    OS="darwin"
    TAG="amd64"
    ;;
  aarch64-apple-darwin)
    OS="darwin"
    TAG="arm64"
    ;;
  *)
    echo "Unsupported host: $HOST (build on Linux x86_64/aarch64 or macOS Intel/Apple Silicon)"
    exit 1
    ;;
esac

echo "==> Building crossusage-cli (release) for $HOST"
cargo build --release -p crossusage-cli

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

mkdir -p "$STAGE/root/resources"
cp "$ROOT/target/release/crossusage-cli" "$STAGE/root/"
cp -a "$ROOT/src-tauri/resources/bundled_plugins" "$STAGE/root/resources/"

OUT="$ROOT/crossusage-cli_${VERSION}_${OS}_${TAG}.tar.gz"
tar -czf "$OUT" -C "$STAGE/root" .
echo "==> Wrote $OUT"
ls -lh "$OUT"
