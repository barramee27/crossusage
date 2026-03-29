# Portable CLI tarballs (optional)

For **`INSTALL_MODE=cli`**, `install.sh` **prefers** a matching `crossusage-cli_*.tar.gz` asset on the **latest GitHub Release**, then falls back to the **`releases/`** folder on your branch via `raw.githubusercontent.com/.../releases/...` if the release has no asset. **`install.ps1`** (`INSTALL_MODE=cli`) still reads CLI zips from the branch `releases/` path. **Full** Linux/Windows installers (`install.sh` default / `install.ps1` default) look at **latest Release** for `.deb` / `.rpm` / AppImage / NSIS.

**Tarball contents (all platforms):** at archive root, **`crossusage-cli`** (or `crossusage-cli.exe` on Windows) and **`resources/bundled_plugins/`** with plugin payloads. The CLI finds plugins by canonicalizing **`current_exe`** and looking for **`resources/bundled_plugins`** next to that binary (plus app-bundle / Linux FHS / `CROSSUSAGE_RESOURCES` — see [`crates/crossusage-core/src/paths.rs`](../crates/crossusage-core/src/paths.rs)). Do not ship the binary alone without that tree unless users set **`CROSSUSAGE_RESOURCES`**.

`scripts/install.sh` with `INSTALL_MODE=cli` downloads from this folder on your branch, using **`package.json`’s `version`** (same naming as `scripts/build-cli-tarball.sh`):

**Linux**

- Versioned (preferred): `crossusage-cli_<version>_linux_<arch>.tar.gz` (`amd64` / `arm64`)
- Legacy fallback: `crossusage-cli_linux_<arch>.tar.gz`

**macOS** (this fork ships CLI from here — no upstream GUI installer on this repo)

- Versioned: `crossusage-cli_<version>_darwin_<arch>.tar.gz`
- Legacy: `crossusage-cli_darwin_<arch>.tar.gz`
- **Apple Silicon (`arm64`):** on a Mac run `./scripts/build-cli-tarball.sh` (or `bun run release:cli-tarball`). **Without a Mac:** GitHub → **Actions** → **macOS CLI tarball** → **Run workflow** → download **`crossusage-cli-darwin-arm64-tarball`**, then copy the `.tar.gz` into **`releases/`** on your branch and push. (That workflow runs **`bun run bundle:plugins`** first because **`bundled_plugins/`** contents are gitignored.)
- **Same workflow, attach to Release:** when running **macOS CLI tarball**, enable **“Upload to latest GitHub Release”**. That uploads `crossusage-cli_<version>_darwin_arm64.tar.gz` to the repo’s **latest** GitHub Release (`gh release upload … --clobber`). Then `scripts/install.sh` with `INSTALL_MODE=cli` **downloads from that release first** (no need to commit the tarball under `releases/` on the branch). You still need at least one GitHub Release to exist.
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

**macOS (`darwin_arm64`) from CI:** unzip the Actions artifact (`crossusage-cli-darwin-arm64-tarball.zip`), take the inner `crossusage-cli_<version>_darwin_arm64.tar.gz`, copy into **`releases/`**, then duplicate as legacy:

```bash
unzip -j ~/Downloads/crossusage-cli-darwin-arm64-tarball.zip -d /tmp/cu-darwin
cp /tmp/cu-darwin/crossusage-cli_*_darwin_arm64.tar.gz releases/
cp releases/crossusage-cli_1.0.1_darwin_arm64.tar.gz releases/crossusage-cli_darwin_arm64.tar.gz   # adjust version
```

Optionally keep a **legacy** copy in sync (install.sh uses it if the versioned file is missing):

```bash
cp releases/crossusage-cli_1.0.1_linux_amd64.tar.gz releases/crossusage-cli_linux_amd64.tar.gz
```

Commit and push — **`INSTALL_MODE=cli` still works** from branch `releases/` if the latest Release has no matching CLI asset (fallback).

**Re-running `install.sh` with `INSTALL_MODE=cli`** always downloads again and **overwrites** `~/.local/lib/crossusage/` (binary + `resources/`). There is no separate updater — it **is** the update path. Same `package.json` version ⇒ same tarball filename ⇒ each run still replaces files with whatever is on the branch now.
