#!/usr/bin/env bash
# Build Linux (.deb, .rpm, .AppImage) + Windows (.exe + NSIS setup) from a Linux host.
# Requires: bun, Rust, NSIS (makensis) for the Windows installer bundle.
set -euo pipefail
cd "$(dirname "$0")/.."
unset CI

echo "==> Linux bundles (deb, rpm, appimage)"
bun run tauri build --bundles deb,rpm,appimage

echo "==> Windows (GNU cross-target: openusage.exe + NSIS setup)"
bun run tauri build --target x86_64-pc-windows-gnu

echo ""
echo "Outputs (version from tauri.conf.json):"
echo "  deb:       src-tauri/target/release/bundle/deb/"
echo "  rpm:       src-tauri/target/release/bundle/rpm/"
echo "  appimage:  src-tauri/target/release/bundle/appimage/"
echo "  win exe:   src-tauri/target/x86_64-pc-windows-gnu/release/openusage.exe"
echo "  win setup: src-tauri/target/x86_64-pc-windows-gnu/release/bundle/nsis/"
