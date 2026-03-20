# Portable CLI tarballs (optional)

`scripts/install.sh` with `INSTALL_MODE=cli` downloads from the repo first, using **`package.json`’s `version`** to build the URL (same naming as `scripts/build-cli-tarball.sh`):

`https://raw.githubusercontent.com/<user>/<repo>/<branch>/releases/crossusage-cli_<version>_linux_<arch>.tar.gz`

Legacy unversioned name is still tried as a fallback:

`.../releases/crossusage-cli_linux_<arch>.tar.gz`

Build or refresh with:

```bash
bun run release:cli-tarball
# Writes e.g. crossusage-cli_1.0.0_linux_amd64.tar.gz — copy into releases/ (versioned name is preferred)
cp crossusage-cli_*_linux_amd64.tar.gz releases/
```

Optionally also copy a **legacy unversioned** filename (install.sh tries it if the versioned URL fails):

```bash
# from repo root, after copying the versioned tarball into releases/
cp releases/crossusage-cli_1.0.0_linux_amd64.tar.gz releases/crossusage-cli_linux_amd64.tar.gz
```

Then commit and push — **no GitHub Release attachment required** for `INSTALL_MODE=cli` when the versioned file exists on the branch.
