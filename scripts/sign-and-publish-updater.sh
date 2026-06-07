#!/usr/bin/env bash
# Sign updater bundles + upload latest.json for an existing GitHub release.
# Requires: .tauri/crossusage.key (private; gitignored) + password in env.
#
# Usage:
#   export TAURI_SIGNING_PRIVATE_KEY_PASSWORD='your-password'
#   ./scripts/sign-and-publish-updater.sh v1.0.11
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
source "$(dirname "$0")/load-tauri-signing.sh"

TAG="${1:-}"
if [[ -z "$TAG" || ! "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Usage: $0 vMAJOR.MINOR.PATCH" >&2
  exit 1
fi

VERSION="${TAG#v}"
KEY="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$ROOT/.tauri/crossusage.key}"
REPO="${GITHUB_REPOSITORY:-barramee27/crossusage}"

if [[ ! -f "$KEY" ]]; then
  echo "Missing private key: $KEY" >&2
  echo "Generate with: bunx tauri signer generate -w $ROOT/.tauri/crossusage.key" >&2
  exit 1
fi

if [[ -z "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" ]]; then
  echo "Set TAURI_SIGNING_PRIVATE_KEY_PASSWORD (key is encrypted)." >&2
  exit 1
fi

DEB="releases/crossusage_${VERSION}_amd64.deb"
EXE="releases/crossusage_${VERSION}_x64-setup.exe"
for f in "$DEB" "$EXE"; do
  if [[ ! -f "$f" ]]; then
    echo "Missing $f — build/copy release artifacts first." >&2
    exit 1
  fi
done

sign_one() {
  local file="$1"
  echo "==> Signing $(basename "$file")"
  unset TAURI_SIGNING_PRIVATE_KEY
  bunx tauri signer sign -f "$KEY" -p "$TAURI_SIGNING_PRIVATE_KEY_PASSWORD" "$file"
}

sign_one "$DEB"
sign_one "$EXE"

DEB_SIG="${DEB}.sig"
EXE_SIG="${EXE}.sig"

PUB_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
LATEST="$ROOT/releases/latest.json"
export VERSION TAG REPO PUB_DATE DEB_SIG EXE_SIG LATEST
node -e "
const fs = require('fs');
const version = process.env.VERSION;
const tag = process.env.TAG;
const repo = process.env.REPO;
const pubDate = process.env.PUB_DATE;
const debSig = fs.readFileSync(process.env.DEB_SIG, 'utf8').trim();
const exeSig = fs.readFileSync(process.env.EXE_SIG, 'utf8').trim();
const out = {
  version,
  notes: 'CrossUsage ' + version + ' — see https://github.com/' + repo + '/releases/tag/' + tag,
  pub_date: pubDate,
  platforms: {
    'linux-x86_64': {
      signature: debSig,
      url: 'https://github.com/' + repo + '/releases/download/' + tag + '/crossusage_' + version + '_amd64.deb',
    },
    'windows-x86_64': {
      signature: exeSig,
      url: 'https://github.com/' + repo + '/releases/download/' + tag + '/crossusage_' + version + '_x64-setup.exe',
    },
  },
};
fs.writeFileSync(process.env.LATEST, JSON.stringify(out, null, 2) + '\n');
console.log('Wrote', process.env.LATEST, 'for', version);
"

echo "==> Uploading to GitHub release $TAG"
gh release upload "$TAG" \
  --repo "$REPO" \
  --clobber \
  "$DEB_SIG" \
  "$EXE_SIG" \
  "$LATEST"

echo "Done. Updater endpoint: https://github.com/${REPO}/releases/latest/download/latest.json"
