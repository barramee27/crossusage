# Portable CLI tarballs (optional)

**You do not need a GitHub “Release”** for CLI-only installs: `install.sh` / `install.ps1` (`INSTALL_MODE=cli`) read these files from the **git branch** via `raw.githubusercontent.com/.../releases/...`. The GitHub Releases page is only a **fallback** if the branch file is missing, and **full** Linux/Windows installers (`install.sh` default / `install.ps1` default) still look at **latest Release** for `.deb` / `.rpm` / AppImage / NSIS.

`scripts/install.sh` with `INSTALL_MODE=cli` downloads from this folder on your branch, using **`package.json`’s `version`** (same naming as `scripts/build-cli-tarball.sh`):

**Linux**

- Versioned (preferred): `crossusage-cli_<version>_linux_<arch>.tar.gz` (`amd64` / `arm64`)
- Legacy fallback: `crossusage-cli_linux_<arch>.tar.gz`

**macOS** (this fork ships CLI from here — no upstream GUI installer on this repo)

- Versioned: `crossusage-cli_<version>_darwin_<arch>.tar.gz`
- Legacy: `crossusage-cli_darwin_<arch>.tar.gz`
- **Apple Silicon (`arm64`):** on a Mac run `./scripts/build-cli-tarball.sh` (or `bun run release:cli-tarball`). **Without a Mac:** GitHub → **Actions** → **macOS CLI tarball** → **Run workflow** → download **`crossusage-cli-darwin-arm64-tarball`**, then copy the `.tar.gz` into **`releases/`** on your branch and push. (That workflow runs **`bun run bundle:plugins`** first because **`bundled_plugins/`** contents are gitignored.)
- **Intel (`amd64`):** run the same script **on an Intel Mac** (GitHub’s `macos-latest` runners are ARM64, so they only produce `darwin_arm64`).

**Windows** (`scripts/install.ps1` with `$env:INSTALL_MODE='cli'`)

- Build on **Windows:** [`scripts/build-cli-windows.ps1`](../scripts/build-cli-windows.ps1)
- Build on **Linux** (cross-compile to `x86_64-pc-windows-gnu`): [`scripts/build-cli-zip-windows-gnu.sh`](../scripts/build-cli-zip-windows-gnu.sh) — needs `mingw-w64`, `zip`, and `rustup target add x86_64-pc-windows-gnu` (see script header)

- Versioned (preferred): `crossusage-cli_<version>_windows_<arch>.zip` (`amd64` / `arm64`)
- Legacy fallback: `crossusage-cli_windows_<arch>.zip`
- Optional: `.tar.gz` with the same basename (extracted with `tar.exe`)

Raw URL pattern:

`https://raw.githubusercontent.com/<user>/<repo>/<branch>/releases/<filename>.tar.gz`

Build and publish:

```bash
bun run release:cli-tarball
# Writes e.g. crossusage-cli_1.0.1_linux_amd64.tar.gz (or _darwin_arm64 on Apple Silicon)
cp crossusage-cli_*_linux_amd64.tar.gz releases/   # example: Linux x86_64
```

Optionally keep a **legacy** copy in sync (install.sh uses it if the versioned file is missing):

```bash
cp releases/crossusage-cli_1.0.1_linux_amd64.tar.gz releases/crossusage-cli_linux_amd64.tar.gz
```

Commit and push — **no GitHub Release attachment required** for `INSTALL_MODE=cli` when these files exist on the branch.

**Re-running `install.sh` with `INSTALL_MODE=cli`** always downloads again and **overwrites** `~/.local/lib/crossusage/` (binary + `resources/`). There is no separate updater — it **is** the update path. Same `package.json` version ⇒ same tarball filename ⇒ each run still replaces files with whatever is on the branch now.
