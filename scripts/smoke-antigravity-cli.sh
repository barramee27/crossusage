#!/usr/bin/env bash
# Smoke-test Antigravity CLI plugin (keyring + quota APIs). Run with CrossUsage dev app up for HTTP check.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="${ROOT}/target/debug/crossusage-cli"

if [[ ! -x "$CLI" ]]; then
  echo "Building crossusage-cli…" >&2
  cargo build -p crossusage-cli --manifest-path "$ROOT/Cargo.toml"
fi

echo "== crossusage-cli probe antigravity-cli =="
"$CLI" probe antigravity-cli --json | python3 -c "
import json, sys
d = json.load(sys.stdin)[0]
err = next((l for l in d.get('lines', []) if l.get('label') == 'Error'), None)
if err:
    print('FAIL:', err.get('text'))
    sys.exit(1)
print('OK plan=', d.get('plan'))
for l in d.get('lines', []):
    if l.get('type') == 'progress':
        print(' ', l.get('label'), 'used', l.get('used'))
"

if curl -sf --max-time 2 http://127.0.0.1:6736/v1/usage >/dev/null 2>&1; then
  echo ""
  echo "== curl local HTTP API (restart tauri:dev if 204 until next probe) =="
  curl -sS http://127.0.0.1:6736/v1/usage/antigravity-cli | python3 -c "
import json, sys
raw = sys.stdin.read().strip()
if not raw:
    print('204/empty — trigger refresh in app or wait for scheduled probe')
    sys.exit(0)
d = json.loads(raw)
print('cached plan=', d.get('plan'))
"
else
  echo "(skip HTTP: nothing on :6736 — start npm run tauri:dev)"
fi
