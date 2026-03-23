#!/usr/bin/env bash
# List HTTP(S) strings in CrossUsage / OpenUsage source (plugins + crates).
# Usage:
#   ./scripts/list-api-urls.sh           # unique URLs only (sorted)
#   ./scripts/list-api-urls.sh --lines # file:line:full line (rg -n)
#   ./scripts/list-api-urls.sh --context # same as --lines plus 2 lines context (rg -C2)
#
# Does not crawl the network. See docs/api-urls.md for a curated table with purposes.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODE="${1:-}"

rg_plugins() {
  local args=("$@")
  rg "${args[@]}" \
    --glob '*.js' \
    --glob '!**/node_modules/**' \
    plugins
}

rg_crates() {
  local args=("$@")
  rg "${args[@]}" \
    --glob '*.rs' \
    crates
}

case "$MODE" in
  --lines|-n)
    rg_plugins -n 'https?://'
    rg_crates -n 'https?://'
    ;;
  --context|-C)
    rg_plugins -n -C2 'https?://'
    rg_crates -n -C2 'https?://'
    ;;
  --unique|-u|"")
    # Extract URL-like substrings (no paths); production plugin sources only + all crates
    {
      rg -o --no-filename 'https://[^"'\''\s\)]+' plugins \
        --glob '*.js' --glob '!*.test.js' --glob '!**/node_modules/**' 2>/dev/null || true
      rg -o --no-filename 'https://[^"'\''\s\)]+' crates --glob '*.rs' 2>/dev/null || true
    } | sort -u
    ;;
  --help|-h)
    sed -n '1,20p' "$0"
    exit 0
    ;;
  *)
    echo "Unknown option: $MODE" >&2
    echo "Use --unique (default), --lines, --context, or --help" >&2
    exit 1
    ;;
esac
