#!/usr/bin/env bash
# Follow HTML links from ONE seed URL (wget recursive spider). For sitemaps / public help pages only.
#
# Do NOT use this to "discover" JSON API routes on api2.cursor.sh or similar — see
# docs/research/deep-crawl-and-vpn.md and ./scripts/print-cursor-endpoints.sh instead.
#
# Usage:
#   ./scripts/wget-html-spider.sh 'https://some-vendor.com/help/'
#   DEPTH=4 WAIT=3 ./scripts/wget-html-spider.sh 'https://example.com/docs/'
#
# Output: docs/research/crawl-output/ (gitignored). Run on YOUR machine; optional VPN is unrelated to route lists.

set -euo pipefail

URL="${1:-}"
if [[ -z "$URL" ]]; then
  echo "Usage: $0 'https://example.com/docs/'" >&2
  exit 1
fi

case "$URL" in
  *api2.cursor*|*api\.cursor*|*cursor.com/api*|*googleapis.com/v1internal*|*oauth2.googleapis.com/token*)
    echo "Refusing: recursive wget does not map JSON/API routes. For Cursor URLs already used by CrossUsage, run:" >&2
    echo "  ./scripts/print-cursor-endpoints.sh" >&2
    echo "See docs/research/deep-crawl-and-vpn.md" >&2
    exit 2
    ;;
esac

DEPTH="${DEPTH:-3}"
WAIT="${WAIT:-2}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/docs/research/crawl-output"
mkdir -p "$OUT"
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG="$OUT/spider-${STAMP}.log"
URLS="$OUT/urls-${STAMP}.txt"

echo "Spidering HTML (depth=$DEPTH wait=${WAIT}s) -> $LOG" >&2
wget \
  --spider \
  --no-parent \
  -r \
  -l "$DEPTH" \
  --wait="$WAIT" \
  --random-wait \
  -e robots=on \
  -o "$LOG" \
  "$URL" || true

if grep -q '^--' "$LOG" 2>/dev/null; then
  grep '^--' "$LOG" | awk '{print $3}' | sort -u > "$URLS"
else
  : > "$URLS"
fi

echo "Done. Log: $LOG" >&2
echo "URLs ($(wc -l < "$URLS") lines): $URLS" >&2
