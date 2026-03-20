# Portable CLI tarballs (optional)

`scripts/install.sh` with `INSTALL_MODE=cli` downloads from this folder on your branch, using **`package.json`’s `version`** (same naming as `scripts/build-cli-tarball.sh`):

**Linux**

- Versioned (preferred): `crossusage-cli_<version>_linux_<arch>.tar.gz` (`amd64` / `arm64`)
- Legacy fallback: `crossusage-cli_linux_<arch>.tar.gz`

**macOS** (build the tarball on a Mac; this fork ships CLI from here — no upstream CLI requirement)

- Versioned: `crossusage-cli_<version>_darwin_<arch>.tar.gz`
- Legacy: `crossusage-cli_darwin_<arch>.tar.gz`

Raw URL pattern:

`https://raw.githubusercontent.com/<user>/<repo>/<branch>/releases/<filename>.tar.gz`

Build and publish:

```bash
bun run release:cli-tarball
# Writes e.g. crossusage-cli_1.0.0_linux_amd64.tar.gz (or _darwin_arm64 on Apple Silicon)
cp crossusage-cli_*_linux_amd64.tar.gz releases/   # example: Linux x86_64
```

Optionally keep a **legacy** copy in sync (install.sh uses it if the versioned file is missing):

```bash
cp releases/crossusage-cli_1.0.0_linux_amd64.tar.gz releases/crossusage-cli_linux_amd64.tar.gz
```

Commit and push — **no GitHub Release attachment required** for `INSTALL_MODE=cli` when these files exist on the branch.

**Re-running `install.sh` with `INSTALL_MODE=cli`** always downloads again and **overwrites** `~/.local/lib/crossusage/` (binary + `resources/`). There is no separate updater — it **is** the update path. Same `package.json` version ⇒ same tarball filename ⇒ each run still replaces files with whatever is on the branch now.
