#!/bin/bash
set -e

cd "$(dirname "$0")/.."

# shellcheck disable=SC1091
source "$(dirname "$0")/load-tauri-signing.sh"

# Clean previous bundle (workspace: target/ at repo root)
rm -rf target/release/bundle

# Build
bun tauri build "$@"

echo ""
echo "✓ Build complete! Output:"
ls -la target/release/bundle/dmg/*.dmg 2>/dev/null || ls -la target/release/bundle/macos/*.app
