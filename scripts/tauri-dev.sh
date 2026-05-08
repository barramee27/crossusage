#!/usr/bin/env bash
# Dev launcher: npm leaves a parent `npm` process in the tty foreground group, so
# `trap '' TSTP` only in a child cannot stop Ctrl+Z from suspending the whole job.
# Temporarily `stty susp undef` while the stack runs so ^Z does not SIGTSTP the group.
set -euo pipefail

trap '' TSTP 2>/dev/null || true

TAURI_DEV_TTY=""
TAURI_DEV_OLD_STTY=""
restore_tty() {
  if [[ -n "${TAURI_DEV_OLD_STTY:-}" && -n "${TAURI_DEV_TTY:-}" ]]; then
    stty "$TAURI_DEV_OLD_STTY" <"$TAURI_DEV_TTY" 2>/dev/null || true
    TAURI_DEV_OLD_STTY=""
    TAURI_DEV_TTY=""
  fi
}

if [[ -t 0 ]]; then
  TAURI_DEV_TTY=/dev/stdin
elif [[ -r /dev/tty ]]; then
  TAURI_DEV_TTY=/dev/tty
fi
if [[ -n "$TAURI_DEV_TTY" ]]; then
  TAURI_DEV_OLD_STTY="$(stty -g <"$TAURI_DEV_TTY" 2>/dev/null || true)"
  if [[ -n "$TAURI_DEV_OLD_STTY" ]]; then
    stty susp undef <"$TAURI_DEV_TTY" 2>/dev/null || true
    trap restore_tty EXIT
  fi
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export RUST_LOG="${RUST_LOG:-info,ignore=warn,globset=warn,tauri_cli=warn}"

set +e
node "$SCRIPT_DIR/tauri-dev.cjs"
code=$?
set -e

restore_tty
trap - EXIT 2>/dev/null || true
exit "$code"
