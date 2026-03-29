#!/usr/bin/env bash
# Build and install crossusage-cli via cargo from a shallow git clone (no full dev tree).
# Does NOT include bundled_plugins in git — after install, use INSTALL_MODE=cli tarball for plugins,
# or set CROSSUSAGE_RESOURCES. See docs/cli-install-without-full-repo.md
#
# Usage:
#   ./scripts/install-cli-cargo.sh
#   GITHUB_REPO=user/fork ./scripts/install-cli-cargo.sh
#
# Requires: git, cargo, rustc

set -euo pipefail

REPO="${GITHUB_REPO:-barramee27/crossusage}"
URL="https://github.com/${REPO}.git"
TMP="${TMPDIR:-/tmp}/crossusage-cli-build-$$"

cleanup() {
  rm -rf "$TMP"
}
trap cleanup EXIT

echo "install-cli-cargo: shallow cloning ${URL} -> ${TMP}" >&2
git clone --depth 1 --single-branch --branch feat/linux-windows-native-support "$URL" "$TMP"

echo "install-cli-cargo: cargo install --path crates/crossusage-cli --locked" >&2
( cd "$TMP" && cargo install --path crates/crossusage-cli --locked )

echo "" >&2
echo "Installed: ~/.cargo/bin/crossusage-cli (ensure ~/.cargo/bin is on PATH)" >&2
echo "Bundled plugins are NOT in this repo snapshot — for a working CLI with plugins use:" >&2
echo "  curl -fsSL https://raw.githubusercontent.com/${REPO}/feat/linux-windows-native-support/scripts/install.sh | INSTALL_MODE=cli bash" >&2
echo "Or set CROSSUSAGE_RESOURCES to a directory containing bundled_plugins/ or resources/bundled_plugins/. See docs/cli-install-without-full-repo.md" >&2
