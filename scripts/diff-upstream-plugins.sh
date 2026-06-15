#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if ! git rev-parse --verify upstream/main >/dev/null 2>&1; then
  echo "Missing upstream/main — run: git fetch upstream" >&2
  exit 1
fi
echo "Plugins differing from upstream/main (plugin.js):"
shopt -s nullglob
changed=0
for dir in "$ROOT"/plugins/*/; do
  id="$(basename "$dir")"
  [[ -f "$dir/plugin.js" ]] || continue
  if ! git diff --quiet HEAD upstream/main -- "plugins/$id/plugin.js" 2>/dev/null; then
    echo "  - $id"
    changed=1
  fi
done
shopt -u nullglob
[[ "$changed" -eq 0 ]] && echo "  (none)"
