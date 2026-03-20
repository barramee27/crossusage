# Install

**End users:** download a release from the [README](README.md#download) and install the platform package (`.deb`, `.exe`, etc.). Normally `crossusage-cli` is bundled with the desktop app (same package). For **CLI-only**, use `INSTALL_MODE=cli` with the portable tarball (see below).

## One-line install from GitHub

Scripts live under [`scripts/`](scripts/): they query the [latest GitHub release](https://github.com/barramee27/crossusage/releases/latest), pick an artifact for your OS, install it, and run basic checks.

### Linux (`install.sh`)

- **Requires:** `curl` *or* `wget`; `jq` *or* `python3`; `sudo` for `.deb` / `.rpm`.
- **Behavior:** Prefers `.deb` when `apt-get`/`dpkg` are available, else `.rpm` when `dnf`/`yum`/`rpm` exist, else **AppImage** to `~/.local/bin/` (and a `crossusage` symlink). Architecture: `amd64`/`arm64` for `.deb` and AppImage; `x86_64`/`aarch64` for `.rpm`.
- **Full app (GUI + CLI when the `.deb` was built with the CLI sidecar):**

```bash
curl -fsSL https://raw.githubusercontent.com/barramee27/crossusage/main/scripts/install.sh | bash
```

- **CLI-only (standalone portable bundle — binary + `resources/bundled_plugins`):** the script looks for `releases/crossusage-cli_<version>_linux_<arch>.tar.gz` on the branch (or the latest GitHub Release). Build with `bun run release:cli-tarball` on Linux, copy into `releases/`, commit, and push — or upload the tarball as a release asset.

```bash
curl -fsSL https://raw.githubusercontent.com/barramee27/crossusage/main/scripts/install.sh | INSTALL_MODE=cli bash
```

If you installed the full `.deb` but `/usr/bin/crossusage-cli` is missing (older build), the script will **automatically** add the portable CLI under `~/.local/lib/crossusage` when that tarball exists on the branch or release.

- **Environment:** `GITHUB_REPO` (default `barramee27/crossusage`); `INSTALL_KIND=deb|rpm|appimage` to force a format (full mode); `INSTALL_MODE=cli` for tarball-only; `INSTALL_GIT_REF` to pick a branch/tag for `releases/` URLs.

**macOS (CLI only):** use the same command with `INSTALL_MODE=cli`. You need `releases/crossusage-cli_<version>_darwin_amd64.tar.gz` or `_darwin_arm64.tar.gz` (build with `bun run release:cli-tarball` on an Intel or Apple Silicon Mac, commit under `releases/`). This fork does not ship a macOS **desktop** installer here; for a macOS GUI, see [upstream OpenUsage](https://github.com/robinebers/openusage/releases/latest).

**Git Bash / MSYS on Windows:** `install.sh` tells you to use PowerShell and [`install.ps1`](scripts/install.ps1) instead.

### Windows (`install.ps1`)

- Downloads the latest `*x64-setup.exe` (NSIS) and runs it (silent `/S` unless `INSTALL_SILENT=0`).
- **Command:**

```powershell
irm https://raw.githubusercontent.com/barramee27/crossusage/main/scripts/install.ps1 | iex
```

- **Environment:** `GITHUB_REPO`; `INSTALL_SILENT=0` (or `false`) for an interactive installer.

### Security

Review the scripts in this repo before piping to `bash` or `iex`. They only use `https://api.github.com` and `https://github.com/.../releases/download/...`.

---

**Developers:** clone the repo and follow **Build from source** in the [README](README.md) (collapsed section at the bottom) for prerequisites, `bun install`, `cargo` / Tauri build, and `cargo run -p crossusage-cli`.

For resource path overrides when running the CLI outside the installed app, see `CROSSUSAGE_RESOURCES` in [`crates/crossusage-core/src/paths.rs`](crates/crossusage-core/src/paths.rs).
