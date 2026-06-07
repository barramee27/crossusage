#!/usr/bin/env bash
# Source before `tauri build` or `tauri signer sign` so updater artifacts (.sig) work.
# Reads optional repo-root .env; private key defaults to .tauri/crossusage.key (gitignored).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

KEY_PATH="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$ROOT/.tauri/crossusage.key}"
if [[ -f "$KEY_PATH" ]]; then
  export TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY_PATH")"
  export TAURI_SIGNING_PRIVATE_KEY_PATH="$KEY_PATH"
fi

if [[ -z "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" ]]; then
  echo "warn: TAURI_SIGNING_PRIVATE_KEY_PASSWORD unset — tauri build may fail at updater signing" >&2
fi
