#!/usr/bin/env bash
# CrossUsage — install latest release from GitHub (Linux desktop / macOS+Linux CLI / Windows redirect).
# Repo: https://github.com/barramee27/crossusage
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/barramee27/crossusage/main/scripts/install.sh | bash
#
# Environment:
#   GITHUB_REPO     default: barramee27/crossusage
#   INSTALL_MODE     full (default) | cli — full = Linux .deb/.rpm/AppImage; cli = portable tarball (Linux or macOS) from releases/ or Release assets (re-runs overwrite ~/.local/lib/crossusage — reinstall/update)
#   INSTALL_KIND     force: deb | rpm | appimage (Linux full mode only)
#   INSTALL_GIT_REF  branch or tag for raw.githubusercontent.com CLI tarball (default: main)
#   INSTALL_CLI_URL  override URL for the CLI .tar.gz (optional)

set -euo pipefail

GITHUB_REPO="${GITHUB_REPO:-barramee27/crossusage}"
API_URL="https://api.github.com/repos/${GITHUB_REPO}/releases/latest"

die() {
  echo "install.sh: $*" >&2
  exit 1
}

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

fetch_json() {
  if have_cmd curl; then
    curl -fsSL --proto '=https' --tlsv1.2 "$API_URL"
  elif have_cmd wget; then
    wget -qO- --https-only "$API_URL"
  else
    die "need curl or wget to download release metadata"
  fi
}

# Print first matching asset URL from release JSON on stdin.
# Arg: Python-compatible regex pattern (asset filename).
pick_asset_url() {
  local pattern="$1"
  local url=""
  if have_cmd jq; then
    url="$(jq -r --arg p "$pattern" '.assets[] | select(.name | test($p)) | .browser_download_url' | head -1 | tr -d '\r')"
  elif have_cmd python3; then
    url="$(python3 -c "
import json, sys, re
pattern = sys.argv[1]
data = json.load(sys.stdin)
for a in data.get('assets', []):
    name = a.get('name') or ''
    if re.search(pattern, name):
        u = a.get('browser_download_url') or ''
        if u:
            print(u)
            sys.exit(0)
sys.exit(1)
" "$pattern")"
  else
    die "need jq or python3 to parse GitHub API JSON"
  fi
  url="$(echo -n "$url" | tr -d '\r')"
  [[ -n "$url" ]] || return 1
  printf '%s\n' "$url"
}

download_to() {
  local url="$1"
  local dest="$2"
  if have_cmd curl; then
    curl -fSL --proto '=https' --tlsv1.2 -o "$dest" "$url"
  else
    wget -q --https-only -O "$dest" "$url"
  fi
}

# Same as download_to but returns 1 on 404 / network error (for fallbacks).
download_try() {
  local url="$1"
  local dest="$2"
  if have_cmd curl; then
    curl -fSL --proto '=https' --tlsv1.2 -o "$dest" "$url" 2>/dev/null && return 0
    return 1
  fi
  if have_cmd wget; then
    wget -q --https-only -O "$dest" "$url" 2>/dev/null && return 0
    return 1
  fi
  return 1
}

# Matches scripts/build-cli-tarball.sh output: crossusage-cli_${VERSION}_linux_${arch}.tar.gz
fetch_repo_package_version() {
  local url="https://raw.githubusercontent.com/${GITHUB_REPO}/${INSTALL_GIT_REF}/package.json"
  local json=""
  if have_cmd curl; then
    json="$(curl -fsSL --proto '=https' --tlsv1.2 "$url" 2>/dev/null)" || return 1
  elif have_cmd wget; then
    json="$(wget -qO- --https-only "$url" 2>/dev/null)" || return 1
  else
    return 1
  fi
  if have_cmd python3; then
    printf '%s' "$json" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("version","").strip())' 2>/dev/null
  elif have_cmd jq; then
    printf '%s' "$json" | jq -r '.version // empty' 2>/dev/null
  else
    return 1
  fi
}

ensure_sudo() {
  if [[ "$(id -u)" -eq 0 ]]; then
    return 0
  fi
  if have_cmd sudo; then
    return 0
  fi
  die "need root or sudo to install this package type"
}

run_sudo() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

map_deb_arch() {
  case "$(uname -m)" in
    x86_64) echo "amd64" ;;
    aarch64|arm64) echo "arm64" ;;
    *) die "unsupported machine $(uname -m) for .deb (need x86_64 or aarch64/arm64)" ;;
  esac
}

map_appimage_arch() {
  case "$(uname -m)" in
    x86_64) echo "amd64" ;;
    aarch64|arm64) echo "arm64" ;;
    *) die "unsupported machine $(uname -m) for AppImage" ;;
  esac
}

# RPM filenames use x86_64 / aarch64 (Tauri).
map_rpm_arch_suffix() {
  case "$(uname -m)" in
    x86_64) echo "x86_64" ;;
    aarch64|arm64) echo "aarch64" ;;
    *) die "unsupported machine $(uname -m) for .rpm" ;;
  esac
}

# --- OS branches ---

TMP="${TMPDIR:-/tmp}"
INSTALL_MODE="${INSTALL_MODE:-full}"
INSTALL_GIT_REF="${INSTALL_GIT_REF:-main}"
KERNEL="$(uname -s)"

# --- CLI-only: one tarball = binary + resources/bundled_plugins (Linux + macOS; no desktop app / no WebKit) ---
if [[ "$INSTALL_MODE" == cli ]]; then
  case "$KERNEL" in
    Linux)
      CLI_OS="linux"
      CLI_ARCH_TAG="$(map_deb_arch)"
      ;;
    Darwin)
      CLI_OS="darwin"
      case "$(uname -m)" in
        x86_64) CLI_ARCH_TAG="amd64" ;;
        arm64) CLI_ARCH_TAG="arm64" ;;
        *) die "unsupported macOS machine $(uname -m) (need x86_64 or arm64)" ;;
      esac
      ;;
    *)
      die "INSTALL_MODE=cli is only supported on Linux and macOS (got: $KERNEL)"
      ;;
  esac

  TMP_CLI="$TMP/crossusage-cli-$$.tar.gz"
  REPO_URL_BASE="https://raw.githubusercontent.com/${GITHUB_REPO}/${INSTALL_GIT_REF}/releases"
  REPO_VER="$(fetch_repo_package_version || true)"
  VERSIONED_CLI_URL=""
  if [[ -n "$REPO_VER" ]]; then
    VERSIONED_CLI_URL="${REPO_URL_BASE}/crossusage-cli_${REPO_VER}_${CLI_OS}_${CLI_ARCH_TAG}.tar.gz"
  fi
  LEGACY_CLI_URL="${REPO_URL_BASE}/crossusage-cli_${CLI_OS}_${CLI_ARCH_TAG}.tar.gz"
  # Prefer INSTALL_CLI_URL override, then versioned name (matches scripts/build-cli-tarball.sh), then legacy unversioned path.
  if [[ -n "${INSTALL_CLI_URL:-}" ]]; then
    DEFAULT_CLI_URL="$INSTALL_CLI_URL"
  elif [[ -n "$VERSIONED_CLI_URL" ]]; then
    DEFAULT_CLI_URL="$VERSIONED_CLI_URL"
  else
    DEFAULT_CLI_URL="$LEGACY_CLI_URL"
  fi

  echo "Downloading portable CLI bundle (${CLI_OS} ${CLI_ARCH_TAG}) …"
  rm -f "$TMP_CLI"
  GOT_FROM=""
  if ! download_try "$DEFAULT_CLI_URL" "$TMP_CLI"; then
    if [[ -z "${INSTALL_CLI_URL:-}" && -n "$VERSIONED_CLI_URL" && "$DEFAULT_CLI_URL" != "$LEGACY_CLI_URL" ]]; then
      echo "Trying legacy repo path: releases/crossusage-cli_${CLI_OS}_${CLI_ARCH_TAG}.tar.gz …"
      rm -f "$TMP_CLI"
      if download_try "$LEGACY_CLI_URL" "$TMP_CLI"; then
        GOT_FROM="legacy"
      fi
    fi
  else
    if [[ "$DEFAULT_CLI_URL" == "$VERSIONED_CLI_URL" ]]; then
      GOT_FROM="versioned"
    elif [[ "$DEFAULT_CLI_URL" == "$LEGACY_CLI_URL" ]]; then
      GOT_FROM="legacy"
    else
      GOT_FROM="override"
    fi
  fi
  if [[ ! -s "$TMP_CLI" ]]; then
    echo "Trying GitHub Release assets instead …"
    JSON="$(fetch_json)" || die "failed to fetch release metadata"
    FALLBACK_URL="$(echo "$JSON" | pick_asset_url "crossusage-cli_.+_${CLI_OS}_${CLI_ARCH_TAG}\\.tar\\.gz\$" || true)"
    [[ -n "$FALLBACK_URL" ]] || die "No CLI tarball found. Add releases/crossusage-cli_<version>_${CLI_OS}_${CLI_ARCH_TAG}.tar.gz on branch ${INSTALL_GIT_REF} (see scripts/build-cli-tarball.sh), or attach that asset to the latest GitHub Release."
    download_to "$FALLBACK_URL" "$TMP_CLI"
    GOT_FROM="release"
  fi
  if [[ "$GOT_FROM" == "legacy" && -n "$REPO_VER" ]]; then
    echo "Note: used legacy filename; ensure releases/crossusage-cli_${REPO_VER}_${CLI_OS}_${CLI_ARCH_TAG}.tar.gz is committed on ${INSTALL_GIT_REF} so installs get the matching build." >&2
  fi
  ROOT_CLI="${HOME}/.local/lib/crossusage"
  if [[ -x "${ROOT_CLI}/crossusage-cli" ]]; then
    echo "Existing portable CLI found — replacing binary and resources under ${ROOT_CLI} (reinstall / update)."
  else
    echo "Installing portable CLI under ${ROOT_CLI} …"
  fi
  mkdir -p "$ROOT_CLI"
  tar xzf "$TMP_CLI" -C "$ROOT_CLI"
  rm -f "$TMP_CLI"
  chmod +x "${ROOT_CLI}/crossusage-cli"
  mkdir -p "${HOME}/.local/bin"
  ln -sfn "${ROOT_CLI}/crossusage-cli" "${HOME}/.local/bin/crossusage-cli"
  echo "Installed portable CLI: ${ROOT_CLI}/crossusage-cli"
  echo "Symlink: ${HOME}/.local/bin/crossusage-cli"
  if [[ ":${PATH}:" != *":${HOME}/.local/bin:"* ]]; then
    echo "Add to PATH: export PATH=\"\$HOME/.local/bin:\$PATH\""
  fi
  echo ""
  echo "Verifying ..."
  export PATH="${HOME}/.local/bin:${PATH}"
  if command -v crossusage-cli >/dev/null 2>&1; then
    crossusage-cli list >/dev/null 2>&1 && echo "crossusage-cli list: ok" || echo "crossusage-cli list: failed (check plugin resources under ${ROOT_CLI}/resources)" >&2
  fi
  echo "Done."
  exit 0
fi

case "$KERNEL" in
  Darwin)
    echo "CrossUsage (this fork) does not publish a macOS desktop installer (.dmg) on this repo."
    echo "For the terminal CLI from this fork, use:"
    echo "  curl -fsSL https://raw.githubusercontent.com/${GITHUB_REPO}/main/scripts/install.sh | INSTALL_MODE=cli bash"
    echo "Upstream OpenUsage may publish macOS GUI builds separately:"
    echo "  https://github.com/robinebers/openusage/releases/latest"
    exit 0
    ;;
  MINGW*|MSYS*|CYGWIN*)
    echo "This script is for Unix shells. On Windows, use PowerShell:"
    echo "  irm https://raw.githubusercontent.com/${GITHUB_REPO}/main/scripts/install.ps1 | iex"
    echo "Or download the latest .exe from:"
    echo "  https://github.com/${GITHUB_REPO}/releases/latest"
    exit 0
    ;;
esac

if [[ "$KERNEL" != Linux ]]; then
  die "unsupported OS: $KERNEL (try manual download from https://github.com/${GITHUB_REPO}/releases/latest)"
fi

DEB_ARCH="$(map_deb_arch)"
AI_ARCH="$(map_appimage_arch)"
RPM_ARCH="$(map_rpm_arch_suffix)"

JSON="$(fetch_json)" || die "failed to fetch release metadata"

# Regex patterns (jq test / Python re); escape dots for literal.
INSTALL_DEB_URL=""
INSTALL_RPM_URL=""
INSTALL_AI_URL=""
INSTALL_CLI_URL="$(echo "$JSON" | pick_asset_url "crossusage-cli_.+_linux_${DEB_ARCH}\\.tar\\.gz\$" || true)"
INSTALL_DEB_URL="$(echo "$JSON" | pick_asset_url "crossusage_.+_${DEB_ARCH}\\.deb\$" || true)"
INSTALL_RPM_URL="$(echo "$JSON" | pick_asset_url "crossusage-.+\\.${RPM_ARCH}\\.rpm\$" || true)"
INSTALL_AI_URL="$(echo "$JSON" | pick_asset_url "crossusage_.+_${AI_ARCH}\\.AppImage\$" || true)"

if [[ -z "$INSTALL_DEB_URL" && -z "$INSTALL_RPM_URL" && -z "$INSTALL_AI_URL" ]]; then
  die "no Linux assets found in latest release (expected .deb / .rpm / .AppImage for ${DEB_ARCH})"
fi

KIND="${INSTALL_KIND:-}"

if [[ -z "$KIND" ]]; then
  if have_cmd apt-get && have_cmd dpkg && [[ -n "$INSTALL_DEB_URL" ]]; then
    KIND=deb
  elif (have_cmd rpm || have_cmd dnf || have_cmd yum) && [[ -n "$INSTALL_RPM_URL" ]]; then
    KIND=rpm
  elif [[ -n "$INSTALL_AI_URL" ]]; then
    KIND=appimage
  elif [[ -n "$INSTALL_DEB_URL" ]]; then
    KIND=deb
  elif [[ -n "$INSTALL_RPM_URL" ]]; then
    KIND=rpm
  else
    die "no suitable package for this system; see https://github.com/${GITHUB_REPO}/releases/latest"
  fi
fi

case "$KIND" in
  deb)
    [[ -n "$INSTALL_DEB_URL" ]] || die "no .deb for ${DEB_ARCH} in latest release"
    DEB_FILE="$TMP/crossusage-install-$$.deb"
    echo "Downloading .deb ..."
    download_to "$INSTALL_DEB_URL" "$DEB_FILE"
    ensure_sudo
    echo "Installing .deb (requires sudo) ..."
    run_sudo dpkg -i "$DEB_FILE" || true
    if have_cmd apt-get; then
      run_sudo apt-get install -f -y -q || true
    fi
    rm -f "$DEB_FILE"
    # Older .deb builds may omit crossusage-cli; try repo-hosted tarball (versioned = build-cli-tarball.sh), legacy path, then Release asset from JSON.
    if [[ -x /usr/bin/crossusage ]] && [[ ! -x /usr/bin/crossusage-cli ]]; then
      REPO_VER_DEB="$(fetch_repo_package_version || true)"
      REPO_URL_BASE_DEB="https://raw.githubusercontent.com/${GITHUB_REPO}/${INSTALL_GIT_REF}/releases"
      VERSIONED_CLI_DEB=""
      if [[ -n "$REPO_VER_DEB" ]]; then
        VERSIONED_CLI_DEB="${REPO_URL_BASE_DEB}/crossusage-cli_${REPO_VER_DEB}_linux_${DEB_ARCH}.tar.gz"
      fi
      LEGACY_CLI_DEB="${REPO_URL_BASE_DEB}/crossusage-cli_linux_${DEB_ARCH}.tar.gz"
      TMP_CLI="$TMP/crossusage-cli-repair-$$.tar.gz"
      rm -f "$TMP_CLI"
      GOT_CLI=0
      if [[ -n "$VERSIONED_CLI_DEB" ]] && download_try "$VERSIONED_CLI_DEB" "$TMP_CLI"; then
        GOT_CLI=1
      elif download_try "$LEGACY_CLI_DEB" "$TMP_CLI"; then
        GOT_CLI=1
      elif [[ -n "${INSTALL_CLI_URL:-}" ]] && download_try "$INSTALL_CLI_URL" "$TMP_CLI"; then
        GOT_CLI=1
      fi
      if [[ "$GOT_CLI" -eq 1 ]]; then
        echo "This .deb has no /usr/bin/crossusage-cli. Adding portable CLI from tarball …"
        ROOT_CLI="${HOME}/.local/lib/crossusage"
        mkdir -p "$ROOT_CLI"
        tar xzf "$TMP_CLI" -C "$ROOT_CLI"
        rm -f "$TMP_CLI"
        chmod +x "${ROOT_CLI}/crossusage-cli"
        mkdir -p "${HOME}/.local/bin"
        ln -sfn "${ROOT_CLI}/crossusage-cli" "${HOME}/.local/bin/crossusage-cli"
        echo "Portable CLI: ${ROOT_CLI}/crossusage-cli → ${HOME}/.local/bin/crossusage-cli"
        export PATH="${HOME}/.local/bin:${PATH}"
      else
        rm -f "$TMP_CLI"
      fi
    fi
    ;;
  rpm)
    [[ -n "$INSTALL_RPM_URL" ]] || die "no .rpm in latest release"
    RPM_FILE="$TMP/crossusage-install-$$.rpm"
    echo "Downloading .rpm ..."
    download_to "$INSTALL_RPM_URL" "$RPM_FILE"
    ensure_sudo
    echo "Installing .rpm (requires sudo) ..."
    if have_cmd dnf; then
      run_sudo dnf install -y "$RPM_FILE"
    elif have_cmd yum; then
      run_sudo yum install -y "$RPM_FILE"
    elif have_cmd rpm; then
      run_sudo rpm -Uvh "$RPM_FILE" || run_sudo rpm -ivh "$RPM_FILE"
    else
      die "rpm install tool not found"
    fi
    rm -f "$RPM_FILE"
    ;;
  appimage)
    [[ -n "$INSTALL_AI_URL" ]] || die "no .AppImage for ${AI_ARCH} in latest release"
    AI_FILE="$TMP/crossusage-install-$$.AppImage"
    echo "Downloading AppImage ..."
    download_to "$INSTALL_AI_URL" "$AI_FILE"
    chmod +x "$AI_FILE"
    LOCAL_BIN="${HOME}/.local/bin"
    mkdir -p "$LOCAL_BIN"
    DEST="${LOCAL_BIN}/crossusage.AppImage"
    mv -f "$AI_FILE" "$DEST"
    ln -sfn "$DEST" "${LOCAL_BIN}/crossusage"
    echo "Installed: $DEST"
    echo "Symlink:   ${LOCAL_BIN}/crossusage -> crossusage.AppImage"
    if [[ ":${PATH}:" != *":${LOCAL_BIN}:"* ]]; then
      echo "Add to PATH (e.g. in ~/.profile):"
      echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
    fi
    ;;
  *)
    die "invalid INSTALL_KIND=$KIND (use deb, rpm, or appimage)"
    ;;
esac

echo ""
echo "Verifying install ..."

if command -v crossusage-cli >/dev/null 2>&1; then
  echo "Found: $(command -v crossusage-cli)"
  if crossusage-cli list >/dev/null 2>&1; then
    echo "crossusage-cli list: ok"
  else
    echo "crossusage-cli list: failed (set CROSSUSAGE_RESOURCES if plugins are missing; see crates/crossusage-core/src/paths.rs)" >&2
  fi
else
  if [[ "$KIND" == appimage ]]; then
    echo "Note: crossusage-cli is not on PATH with the AppImage layout; use the GUI or install the .deb/.rpm for full CLI integration."
  elif [[ -x "${HOME}/.local/bin/crossusage-cli" ]]; then
    echo "Found: ${HOME}/.local/bin/crossusage-cli (add ~/.local/bin to PATH if needed)"
    export PATH="${HOME}/.local/bin:${PATH}"
    crossusage-cli list >/dev/null 2>&1 && echo "crossusage-cli list: ok" || true
  else
    echo "Warning: crossusage-cli not on PATH. Open a new shell, or run: export PATH=\"\$HOME/.local/bin:\$PATH\"" >&2
  fi
fi

if command -v crossusage >/dev/null 2>&1; then
  echo "Found: $(command -v crossusage)"
fi

echo "Done."
