#!/usr/bin/env bash
# CrossUsage — install latest release from GitHub (Linux / macOS guidance / Windows redirect).
# Repo: https://github.com/barramee27/crossusage
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/barramee27/crossusage/main/scripts/install.sh | bash
#
# Environment:
#   GITHUB_REPO     default: barramee27/crossusage
#   INSTALL_MODE     full (default) | cli — full = .deb/.rpm/AppImage; cli = portable tarball from the repo (releases/) or Release assets
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

KERNEL="$(uname -s)"

case "$KERNEL" in
  Darwin)
    echo "CrossUsage (this fork) does not publish macOS installers on GitHub."
    echo "For macOS, use upstream OpenUsage:"
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

TMP="${TMPDIR:-/tmp}"

INSTALL_MODE="${INSTALL_MODE:-full}"
INSTALL_GIT_REF="${INSTALL_GIT_REF:-main}"

# --- CLI-only: one tarball = binary + resources/bundled_plugins (no desktop app / no WebKit) ---
if [[ "$INSTALL_MODE" == cli ]]; then
  TMP_CLI="$TMP/crossusage-cli-$$.tar.gz"
  REPO_URL_BASE="https://raw.githubusercontent.com/${GITHUB_REPO}/${INSTALL_GIT_REF}/releases"
  DEFAULT_CLI_URL="${REPO_URL_BASE}/crossusage-cli_linux_${DEB_ARCH}.tar.gz"
  INSTALL_CLI_SRC="${INSTALL_CLI_URL:-$DEFAULT_CLI_URL}"

  echo "Downloading portable CLI bundle …"
  if ! download_try "$INSTALL_CLI_SRC" "$TMP_CLI"; then
    echo "Trying GitHub Release assets instead …"
    JSON="$(fetch_json)" || die "failed to fetch release metadata"
    FALLBACK_URL="$(echo "$JSON" | pick_asset_url "crossusage-cli_.+_linux_${DEB_ARCH}\\.tar\\.gz\$" || true)"
    [[ -n "$FALLBACK_URL" ]] || die "No CLI tarball at ${DEFAULT_CLI_URL} and none on the latest GitHub Release. Push releases/crossusage-cli_linux_${DEB_ARCH}.tar.gz on branch ${INSTALL_GIT_REF}, or attach the tarball to a Release."
    download_to "$FALLBACK_URL" "$TMP_CLI"
  fi
  ROOT_CLI="${HOME}/.local/lib/crossusage"
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
    # Older .deb builds may omit crossusage-cli; try repo-hosted tarball, then Release asset.
    if [[ -x /usr/bin/crossusage ]] && [[ ! -x /usr/bin/crossusage-cli ]]; then
      REPO_CLI="https://raw.githubusercontent.com/${GITHUB_REPO}/${INSTALL_GIT_REF}/releases/crossusage-cli_linux_${DEB_ARCH}.tar.gz"
      TMP_CLI="$TMP/crossusage-cli-repair-$$.tar.gz"
      if download_try "$REPO_CLI" "$TMP_CLI" || { [[ -n "${INSTALL_CLI_URL:-}" ]] && download_try "$INSTALL_CLI_URL" "$TMP_CLI"; }; then
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
