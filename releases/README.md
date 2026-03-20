# Portable CLI tarballs (optional)

These files are served by GitHub at:

`https://raw.githubusercontent.com/<user>/<repo>/<branch>/releases/crossusage-cli_linux_<arch>.tar.gz`

Build or refresh with:

```bash
bun run release:cli-tarball
cp crossusage-cli_*_linux_amd64.tar.gz releases/crossusage-cli_linux_amd64.tar.gz
```

Then commit and push — **no GitHub Release attachment required** for `INSTALL_MODE=cli`.
