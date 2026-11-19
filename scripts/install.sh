#!/usr/bin/env bash
# CrossUsage — install from GitHub Releases (Linux desktop / Linux+macOS CLI / Windows redirect).
# Repo: https://github.com/barramee27/crossusage
#
# Where downloads come from:
#   • Default: latest GitHub Release (`.../releases/latest`), or pin via INSTALL_RELEASE_TAG=v1.6.1.
#   • Linux full: auto-detects distro via /etc/os-release (Debian/Ubuntu/Mint -> .deb,
#     Fedora/RHEL/openSUSE -> .rpm, Arch/Manjaro/NixOS/Void/Alpine/other -> .AppImage),
#     or override with INSTALL_KIND=deb|rpm|appimage|tarball.
#   • INSTALL_MODE=cli: portable CLI tarball from GitHub Release first, then branch releases/ fallback.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/barramee27/crossusage/feat/linux-windows-native-support/scripts/install.sh | bash
#
# Environment:
#   GITHUB_REPO          default: barramee27/crossusage
#   INSTALL_RELEASE_TAG  default: latest (or explicit tag like v1.6.1)
#   INSTALL_MODE         full (default) | cli
#   INSTALL_KIND         force: deb | rpm | appimage | tarball (Linux full mode only)
#   INSTALL_GIT_REF      branch or tag for raw.githubusercontent.com fallbacks (default: feat/linux-windows-native-support)
#   INSTALL_CLI_URL      override URL for the CLI .tar.gz (optional; skips GitHub Release + branch fallbacks)

set -euo pipefail

GITHUB_REPO="${GITHUB_REPO:-barramee27/crossusage}"
INSTALL_RELEASE_TAG="${INSTALL_RELEASE_TAG:-latest}"
if [[ "$INSTALL_RELEASE_TAG" == "latest" ]]; then
  API_URL="https://api.github.com/repos/${GITHUB_REPO}/releases/latest"
  RELEASE_PAGE_URL="https://github.com/${GITHUB_REPO}/releases/latest"
else
  API_URL="https://api.github.com/repos/${GITHUB_REPO}/releases/tags/${INSTALL_RELEASE_TAG}"
  RELEASE_PAGE_URL="https://github.com/${GITHUB_REPO}/releases/tag/${INSTALL_RELEASE_TAG}"
fi

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
# Arg: Python/jq-compatible regex pattern (asset filename).
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

# Detect Linux distro family from /etc/os-release before falling back to command probing.
# Prevents Arch/NixOS/Void systems that happen to have dpkg/rpm installed from mis-detecting.
detect_linux_distro_family() {
  local id="" id_like="" tokens=""
  if [[ -r /etc/os-release ]]; then
    id="$(awk -F= '$1=="ID" { gsub(/["'\'']/, "", $2); print tolower($2) }' /etc/os-release | head -1)"
    id_like="$(awk -F= '$1=="ID_LIKE" { gsub(/["'\'']/, "", $2); print tolower($2) }' /etc/os-release | head -1)"
    tokens=" ${id} ${id_like} "
  fi

  case "$tokens" in
    *" debian "*|*" ubuntu "*|*" linuxmint "*|*" pop "*|*" elementary "*|*" zorin "*|*" kali "*|*" raspbian "*|*" neon "*|*" mx "*|*" parrot "*|*" deepin "*|*" devuan "*)
      echo "deb"
      return 0
      ;;
    *" fedora "*|*" rhel "*|*" centos "*|*" rocky "*|*" almalinux "*|*" ol "*|*" nobara "*|*" bazzite "*|*" opensuse"*|*" suse "*|*" sles "*|*" mageia "*)
      echo "rpm"
      return 0
      ;;
    *" arch "*|*" archlinux "*|*" manjaro "*|*" endeavouros "*|*" cachyos "*|*" garuda "*|*" artix "*|*" nixos "*|*" alpine "*|*" void "*|*" gentoo "*|*" solus "*|*" slackware "*|*" chimera "*|*" guix "*)
      echo "appimage"
      return 0
      ;;
  esac
  echo ""
}

# --- OS branches ---

TMP="${TMPDIR:-/tmp}"
INSTALL_MODE="${INSTALL_MODE:-full}"
INSTALL_GIT_REF="${INSTALL_GIT_REF:-feat/linux-windows-native-support}"
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

  echo "Downloading portable CLI bundle (${CLI_OS} ${CLI_ARCH_TAG}) …"
  rm -f "$TMP_CLI"
  GOT_FROM=""
  # Prefer INSTALL_CLI_URL override, then GitHub Release asset, then branch releases/ on raw.githubusercontent.com.
  if [[ -n "${INSTALL_CLI_URL:-}" ]]; then
    download_to "$INSTALL_CLI_URL" "$TMP_CLI"
    GOT_FROM="override"
  else
    RELEASE_URL=""
    JSON=""
    if JSON="$(fetch_json 2>/dev/null)"; then
      RELEASE_URL="$(echo "$JSON" | pick_asset_url "crossusage-cli_.+_${CLI_OS}_${CLI_ARCH_TAG}\\.tar\\.gz\$" || true)"
    fi
    if [[ -n "$RELEASE_URL" ]] && download_try "$RELEASE_URL" "$TMP_CLI"; then
      GOT_FROM="release"
    else
      rm -f "$TMP_CLI"
      if [[ -n "$VERSIONED_CLI_URL" ]] && download_try "$VERSIONED_CLI_URL" "$TMP_CLI"; then
        GOT_FROM="versioned"
      else
        rm -f "$TMP_CLI"
        if [[ -n "$VERSIONED_CLI_URL" ]]; then
          echo "Trying legacy branch path: releases/crossusage-cli_${CLI_OS}_${CLI_ARCH_TAG}.tar.gz …" >&2
        fi
        if download_try "$LEGACY_CLI_URL" "$TMP_CLI"; then
          GOT_FROM="legacy"
        fi
      fi
    fi
  fi
  if [[ ! -s "$TMP_CLI" ]]; then
    if [[ "$CLI_OS" == "darwin" ]]; then
      die "No prebuilt macOS CLI tarball in release ${INSTALL_RELEASE_TAG}. Build from source with: cargo build --release -p crossusage-cli (or see ${RELEASE_PAGE_URL})."
    fi
    die "No CLI tarball found for ${CLI_OS}_${CLI_ARCH_TAG} in release ${INSTALL_RELEASE_TAG} (see ${RELEASE_PAGE_URL})."
  fi
  if [[ "$GOT_FROM" == "legacy" && -n "$REPO_VER" ]]; then
    echo "Note: used legacy filename; ensure releases/crossusage-cli_${REPO_VER}_${CLI_OS}_${CLI_ARCH_TAG}.tar.gz is available." >&2
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
    crossusage-cli --json list >/dev/null 2>&1 && echo "crossusage-cli --json list: ok" || echo "crossusage-cli --json list: failed (check plugin resources under ${ROOT_CLI}/resources)" >&2
  fi
  echo "Done."
  exit 0
fi

case "$KERNEL" in
  Darwin)
    echo "CrossUsage (this fork) focuses on native Linux & Windows desktop packages."
    echo "For the native Swift macOS menu-bar app, grab upstream OpenUsage:"
    echo "  https://github.com/robinebers/openusage/releases/latest"
    echo "Or build the CrossUsage CLI from source on macOS:"
    echo "  cargo build --release -p crossusage-cli"
    exit 0
    ;;
  MINGW*|MSYS*|CYGWIN*)
    echo "This script is for Unix shells. On Windows, use PowerShell:"
    echo "  irm https://raw.githubusercontent.com/${GITHUB_REPO}/${INSTALL_GIT_REF}/scripts/install.ps1 | iex"
    echo "Or download the Windows installer from:"
    echo "  ${RELEASE_PAGE_URL}"
    exit 0
    ;;
esac

if [[ "$KERNEL" != Linux ]]; then
  die "unsupported OS: $KERNEL (try manual download from ${RELEASE_PAGE_URL})"
fi

DEB_ARCH="$(map_deb_arch)"
AI_ARCH="$(map_appimage_arch)"
RPM_ARCH="$(map_rpm_arch_suffix)"

JSON="$(fetch_json)" || die "failed to fetch release metadata from ${API_URL}"

# Regex patterns (jq test / Python re); escape dots for literal.
INSTALL_DEB_URL=""
INSTALL_RPM_URL=""
INSTALL_AI_URL=""
INSTALL_TAR_URL=""
INSTALL_CLI_URL="$(echo "$JSON" | pick_asset_url "crossusage-cli_.+_linux_${DEB_ARCH}\\.tar\\.gz\$" || true)"
INSTALL_DEB_URL="$(echo "$JSON" | pick_asset_url "crossusage_.+_${DEB_ARCH}\\.deb\$" || true)"
INSTALL_RPM_URL="$(echo "$JSON" | pick_asset_url "crossusage-.+\\.${RPM_ARCH}\\.rpm\$" || true)"
INSTALL_AI_URL="$(echo "$JSON" | pick_asset_url "crossusage_.+_${AI_ARCH}\\.AppImage\$" || true)"
INSTALL_TAR_URL="$(echo "$JSON" | pick_asset_url "^crossusage_[0-9].+_linux_${DEB_ARCH}\\.tar\\.gz\$" || true)"

if [[ -z "$INSTALL_DEB_URL" && -z "$INSTALL_RPM_URL" && -z "$INSTALL_AI_URL" && -z "$INSTALL_TAR_URL" ]]; then
  die "no Linux assets found in release ${INSTALL_RELEASE_TAG} for ${DEB_ARCH} (see ${RELEASE_PAGE_URL})"
fi

KIND="${INSTALL_KIND:-}"

if [[ -z "$KIND" ]]; then
  DISTRO_FAMILY="$(detect_linux_distro_family)"
  case "$DISTRO_FAMILY" in
    deb)
      if have_cmd apt-get && have_cmd dpkg && [[ -n "$INSTALL_DEB_URL" ]]; then
        KIND=deb
      elif [[ -n "$INSTALL_AI_URL" ]]; then
        KIND=appimage
      elif [[ -n "$INSTALL_TAR_URL" ]]; then
        KIND=tarball
      fi
      ;;
    rpm)
      if (have_cmd dnf || have_cmd zypper || have_cmd yum || have_cmd rpm) && [[ -n "$INSTALL_RPM_URL" ]]; then
        KIND=rpm
      elif [[ -n "$INSTALL_AI_URL" ]]; then
        KIND=appimage
      elif [[ -n "$INSTALL_TAR_URL" ]]; then
        KIND=tarball
      fi
      ;;
    appimage)
      if [[ -n "$INSTALL_AI_URL" ]]; then
        KIND=appimage
      elif [[ -n "$INSTALL_TAR_URL" ]]; then
        KIND=tarball
      fi
      ;;
    *)
      if have_cmd apt-get && have_cmd dpkg && [[ -n "$INSTALL_DEB_URL" ]]; then
        KIND=deb
      elif (have_cmd dnf || have_cmd zypper || have_cmd yum || have_cmd rpm) && [[ -n "$INSTALL_RPM_URL" ]]; then
        KIND=rpm
      elif [[ -n "$INSTALL_AI_URL" ]]; then
        KIND=appimage
      elif [[ -n "$INSTALL_TAR_URL" ]]; then
        KIND=tarball
      fi
      ;;
  esac
  [[ -n "$KIND" ]] || die "no suitable package for this system; see ${RELEASE_PAGE_URL}"
fi

echo "Selected Linux package format: ${KIND} (override with INSTALL_KIND=deb|rpm|appimage|tarball)"

case "$KIND" in
  deb)
    [[ -n "$INSTALL_DEB_URL" ]] || die "no .deb for ${DEB_ARCH} in release ${INSTALL_RELEASE_TAG}"
    DEB_FILE="$TMP/crossusage-install-$$.deb"
    echo "Downloading .deb ..."
    download_to "$INSTALL_DEB_URL" "$DEB_FILE"
    chmod 644 "$DEB_FILE"
    ensure_sudo
    echo "Installing .deb (requires sudo) ..."
    if have_cmd apt-get; then
      run_sudo apt-get install -y "$DEB_FILE" || {
        run_sudo dpkg -i "$DEB_FILE" || true
        run_sudo apt-get install -f -y -q
      }
    else
      run_sudo dpkg -i "$DEB_FILE"
    fi
    rm -f "$DEB_FILE"
    # Older .deb builds may omit crossusage-cli; install portable CLI if missing.
    if [[ -x /usr/bin/crossusage ]] && [[ ! -x /usr/bin/crossusage-cli ]] && [[ -n "${INSTALL_CLI_URL:-}" ]]; then
      TMP_CLI="$TMP/crossusage-cli-repair-$$.tar.gz"
      rm -f "$TMP_CLI"
      if download_try "$INSTALL_CLI_URL" "$TMP_CLI"; then
        echo "Adding portable crossusage-cli from release tarball …"
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
    [[ -n "$INSTALL_RPM_URL" ]] || die "no .rpm for ${RPM_ARCH} in release ${INSTALL_RELEASE_TAG}"
    RPM_FILE="$TMP/crossusage-install-$$.rpm"
    echo "Downloading .rpm ..."
    download_to "$INSTALL_RPM_URL" "$RPM_FILE"
    ensure_sudo
    echo "Installing .rpm (requires sudo) ..."
    if have_cmd dnf; then
      run_sudo dnf install -y "$RPM_FILE"
    elif have_cmd zypper; then
      run_sudo zypper --non-interactive install --allow-unsigned-rpm "$RPM_FILE"
    elif have_cmd yum; then
      run_sudo yum install -y "$RPM_FILE"
    elif have_cmd rpm; then
      run_sudo rpm -Uvh "$RPM_FILE" || run_sudo rpm -ivh "$RPM_FILE"
    else
      die "rpm install tool (dnf / zypper / yum / rpm) not found"
    fi
    rm -f "$RPM_FILE"
    ;;
  appimage)
    [[ -n "$INSTALL_AI_URL" ]] || die "no .AppImage for ${AI_ARCH} in release ${INSTALL_RELEASE_TAG}"
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
  tarball)
    [[ -n "$INSTALL_TAR_URL" ]] || die "no portable Linux .tar.gz for ${DEB_ARCH} in release ${INSTALL_RELEASE_TAG}"
    TAR_FILE="$TMP/crossusage-install-$$.tar.gz"
    echo "Downloading portable Linux archive (.tar.gz) ..."
    download_to "$INSTALL_TAR_URL" "$TAR_FILE"
    ROOT_APP="${HOME}/.local/lib/crossusage-app"
    rm -rf "$ROOT_APP"
    mkdir -p "$ROOT_APP"
    tar xzf "$TAR_FILE" -C "$ROOT_APP"
    rm -f "$TAR_FILE"
    LOCAL_BIN="${HOME}/.local/bin"
    mkdir -p "$LOCAL_BIN"
    if [[ -x "${ROOT_APP}/crossusage" ]]; then
      ln -sfn "${ROOT_APP}/crossusage" "${LOCAL_BIN}/crossusage"
    fi
    if [[ -x "${ROOT_APP}/crossusage-cli" ]]; then
      ln -sfn "${ROOT_APP}/crossusage-cli" "${LOCAL_BIN}/crossusage-cli"
    fi
    echo "Installed portable bundle under ${ROOT_APP}"
    echo "Symlinks created in ${LOCAL_BIN}"
    if [[ ":${PATH}:" != *":${LOCAL_BIN}:"* ]]; then
      echo "Add to PATH (e.g. in ~/.profile):"
      echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
    fi
    ;;
  *)
    die "invalid INSTALL_KIND=$KIND (use deb, rpm, appimage, or tarball)"
    ;;
esac

echo ""
echo "Verifying install ..."

# Remove stale portable CLI symlink in ~/.local/bin if a system package now provides /usr/bin/crossusage-cli.
if [[ "$KIND" == deb || "$KIND" == rpm ]] && [[ -x /usr/bin/crossusage-cli ]] && [[ -L "${HOME}/.local/bin/crossusage-cli" ]]; then
  LINK_TARGET="$(readlink "${HOME}/.local/bin/crossusage-cli" 2>/dev/null || true)"
  if [[ "$LINK_TARGET" == "${HOME}/.local/lib/crossusage/"* || "$LINK_TARGET" == "${HOME}/.local/lib/crossusage-app/"* ]]; then
    rm -f "${HOME}/.local/bin/crossusage-cli"
    echo "Removed stale portable symlink ${HOME}/.local/bin/crossusage-cli (now using /usr/bin/crossusage-cli)"
  fi
fi

if command -v crossusage-cli >/dev/null 2>&1; then
  ACTIVE_CLI="$(command -v crossusage-cli)"
  ACTIVE_VER="$(crossusage-cli -V 2>/dev/null || true)"
  echo "Found: ${ACTIVE_CLI}${ACTIVE_VER:+ (${ACTIVE_VER})}"
  if [[ "$KIND" == deb || "$KIND" == rpm ]] && [[ -x /usr/bin/crossusage-cli ]] && [[ "$ACTIVE_CLI" != "/usr/bin/crossusage-cli" && "$ACTIVE_CLI" != "/bin/crossusage-cli" ]]; then
    SYS_VER="$(/usr/bin/crossusage-cli -V 2>/dev/null || true)"
    echo "Warning: ${ACTIVE_CLI} shadows /usr/bin/crossusage-cli${SYS_VER:+ (${SYS_VER})} earlier on PATH. Remove or update ${ACTIVE_CLI} if you want the system package version." >&2
  fi
  if crossusage-cli --json list >/dev/null 2>&1; then
    echo "crossusage-cli --json list: ok"
  else
    echo "crossusage-cli --json list: failed (set CROSSUSAGE_RESOURCES if plugins are missing; see crates/crossusage-core/src/paths.rs)" >&2
  fi
else
  if [[ "$KIND" == appimage ]]; then
    echo "Note: For standalone CLI alongside AppImage, run: curl -fsSL https://raw.githubusercontent.com/${GITHUB_REPO}/${INSTALL_GIT_REF}/scripts/install.sh | INSTALL_MODE=cli bash"
  elif [[ -x "${HOME}/.local/bin/crossusage-cli" ]]; then
    echo "Found: ${HOME}/.local/bin/crossusage-cli (add ~/.local/bin to PATH if needed)"
    export PATH="${HOME}/.local/bin:${PATH}"
    crossusage-cli --json list >/dev/null 2>&1 && echo "crossusage-cli --json list: ok" || true
  else
    echo "Warning: crossusage-cli not on PATH. Open a new shell, or run: export PATH=\"\$HOME/.local/bin:\$PATH\"" >&2
  fi
fi

if command -v crossusage >/dev/null 2>&1; then
  echo "Found: $(command -v crossusage)"
fi

echo "Done."
