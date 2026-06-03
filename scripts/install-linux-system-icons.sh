#!/usr/bin/env bash
# GNOME/KDE app switcher uses Icon=crossusage from the .desktop file →
# /usr/share/icons/hicolor/*/apps/crossusage.png (NOT the binary embed).
# Run after ./scripts/sync-branding-icons.sh when icons look stale in Alt+Tab.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ICONS="$ROOT/src-tauri/icons"
THEME="/usr/share/icons/hicolor"

install_one() {
  local src="$1" dest_dir="$2"
  if [[ ! -f "$src" ]]; then
    echo "missing: $src" >&2
    exit 1
  fi
  \cp -f "$src" "$dest_dir/crossusage.png"
  echo "  $dest_dir/crossusage.png"
}

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Re-run with sudo (updates system icon theme for crossusage.desktop):" >&2
  echo "  sudo $0" >&2
  exit 1
fi

install_one "$ICONS/32x32.png" "$THEME/32x32/apps"
install_one "$ICONS/128x128.png" "$THEME/128x128/apps"
install_one "$ICONS/128x128@2x.png" "$THEME/256x256@2/apps"
if [[ -f "$ICONS/icon.png" ]]; then
  install_one "$ICONS/icon.png" "$THEME/512x512/apps" 2>/dev/null || true
fi

if command -v gtk-update-icon-cache >/dev/null; then
  gtk-update-icon-cache -f "$THEME" || true
fi
if command -v update-icon-caches >/dev/null; then
  update-icon-caches /usr/share/icons/hicolor || true
fi
echo "Done. Quit CrossUsage fully, then start again."
