# Install

**End users:** download a release from the [README](README.md#download) and install the platform package (`.deb`, `.exe`, etc.). Normally `crossusage-cli` is bundled with the desktop app (same package). For **CLI-only**, use `INSTALL_MODE=cli` with the portable tarball (see below).

## One-line install from GitHub

Scripts live under [`scripts/`](scripts/): they query the [latest GitHub release](https://github.com/barramee27/crossusage/releases/latest), pick an artifact for your OS, install it, and run basic checks.

### Linux (`install.sh`)

- **Requires:** `curl` *or* `wget`; `jq` *or* `python3`; `sudo` for `.deb` / `.rpm`.
- **Behavior:** Prefers `.deb` when `apt-get`/`dpkg` are available, else `.rpm` when `dnf`/`yum`/`rpm` exist, else **AppImage** to `~/.local/bin/` (and a `crossusage` symlink). Architecture: `amd64`/`arm64` for `.deb` and AppImage; `x86_64`/`aarch64` for `.rpm`.
- **Full app (GUI + CLI when the `.deb` was built with the CLI sidecar):**

```bash
curl -fsSL https://raw.githubusercontent.com/barramee27/crossusage/feat/linux-windows-native-support/scripts/install.sh | bash
```

- **CLI-only (standalone portable bundle — binary + `resources/bundled_plugins`):** the script looks for `releases/crossusage-cli_<version>_linux_<arch>.tar.gz` on the branch (or the latest GitHub Release). The extracted layout must keep **`crossusage-cli`** and **`resources/bundled_plugins/`** side by side (install puts them under `~/.local/lib/crossusage/`). A bare `cargo install` of the CLI **does not** ship that folder — use this install mode, or set **`CROSSUSAGE_RESOURCES`**. Build with `bun run release:cli-tarball` on Linux, copy into `releases/`, commit, and push — or upload the tarball as a release asset.

```bash
curl -fsSL https://raw.githubusercontent.com/barramee27/crossusage/feat/linux-windows-native-support/scripts/install.sh | INSTALL_MODE=cli bash
```

If you installed the full `.deb` but `/usr/bin/crossusage-cli` is missing (older build), the script will **automatically** add the portable CLI under `~/.local/lib/crossusage` when that tarball exists on the branch or release.

- **Environment:** `GITHUB_REPO` (default `barramee27/crossusage`); `INSTALL_KIND=deb|rpm|appimage` to force a format (full mode); `INSTALL_MODE=cli` for tarball-only; `INSTALL_GIT_REF` for `releases/` URLs (defaults to **`feat/linux-windows-native-support`** in this fork’s `install.sh`).

**macOS (CLI only):** use the same command with `INSTALL_MODE=cli`. The installer tries, in order: `INSTALL_CLI_URL` override → versioned `releases/crossusage-cli_<version>_darwin_<arch>.tar.gz` on the branch (`INSTALL_GIT_REF`) → legacy unversioned name → **latest GitHub Release** asset matching `crossusage-cli_.+_darwin_<arch>.tar.gz`. The CLI resolves plugins via the real binary path (symlinks in `~/.local/bin` are OK); it will **not** use the shell’s current directory as a fake resource root. If you copy only the binary out of the tarball, set **`CROSSUSAGE_RESOURCES`** to the folder that still contains **`resources/bundled_plugins`** (or point it at `…/Contents/Resources` inside a `.app`).

- **Apple Silicon (`arm64`):** build locally with `bun run release:cli-tarball` / `./scripts/build-cli-tarball.sh` (after `bun install` and `bun run bundle:plugins`), **or** run **Actions → macOS CLI tarball** (workflow_dispatch). Then either commit the `.tar.gz` under [`releases/`](releases/README.md) on your branch **or** re-run that workflow with **Upload to latest GitHub Release** enabled so `install.sh` can use the release fallback without committing the binary to git (a release must already exist).
- **Intel (`amd64`):** GitHub’s macOS runners only produce `darwin_arm64`; build `crossusage-cli_<version>_darwin_amd64.tar.gz` on an Intel Mac with the same scripts, then publish it the same way (branch `releases/` and/or release asset).

This fork does not ship a macOS **desktop** installer here; for a macOS GUI, see [upstream OpenUsage](https://github.com/robinebers/openusage/releases/latest).

**Git Bash / MSYS on Windows:** `install.sh` tells you to use PowerShell and [`install.ps1`](scripts/install.ps1) instead.

### Windows (`install.ps1`)

- **Full app (default):** downloads the latest `*x64-setup.exe` (NSIS) and runs it (silent `/S` unless `INSTALL_SILENT=0`).
- **CLI-only (portable bundle — same idea as `INSTALL_MODE=cli` on Linux):** downloads `releases/crossusage-cli_<version>_windows_<arch>.zip` (or `.tar.gz`) from the branch, extracts to `%USERPROFILE%\.local\lib\crossusage\`, adds `%USERPROFILE%\.local\bin\crossusage-cli.cmd` to your **user** `PATH`, and verifies `crossusage-cli list`. Build the zip on Windows with [`scripts/build-cli-windows.ps1`](scripts/build-cli-windows.ps1), commit under `releases/`, then push.

- **Commands:**

```powershell
# Full installer (NSIS)
irm https://raw.githubusercontent.com/barramee27/crossusage/feat/linux-windows-native-support/scripts/install.ps1 | iex

# CLI-only (no desktop app)
$env:INSTALL_MODE = "cli"
irm https://raw.githubusercontent.com/barramee27/crossusage/feat/linux-windows-native-support/scripts/install.ps1 | iex
```

- **Environment:** `GITHUB_REPO`; `INSTALL_GIT_REF` (for `releases/` URLs, default `feat/linux-windows-native-support`); `INSTALL_MODE=full|cli`; `INSTALL_CLI_URL` to force a specific `.zip`/`.tar.gz` URL; `INSTALL_SILENT=0` (or `false`) for an interactive NSIS install (**full** mode only).

### Security

Review the scripts in this repo before piping to `bash` or `iex`. They use `https://api.github.com`, `https://raw.githubusercontent.com/...` (CLI bundles on a branch), and `https://github.com/.../releases/download/...`.

---

**Developers:** clone the repo and follow **Build from source** in the [README](README.md) (collapsed section at the bottom) for prerequisites, `bun install`, `cargo` / Tauri build, and `cargo run -p crossusage-cli`.

For resource path overrides when running the CLI outside the installed app, see `CROSSUSAGE_RESOURCES` in [`crates/crossusage-core/src/paths.rs`](crates/crossusage-core/src/paths.rs).
