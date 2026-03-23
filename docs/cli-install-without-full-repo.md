# Run `crossusage-cli` without a huge local checkout

A full developer tree can get very large (`node_modules/`, `target/`, GUI assets, full git history). **You do not need that** just to run the CLI.

## Option 1 — Pre-built CLI bundle (recommended)

Downloads a small **tarball** (binary + `bundled_plugins`) from GitHub Releases — **no `git clone`**.

```bash
curl -fsSL https://raw.githubusercontent.com/barramee27/crossusage/feat/linux-windows-native-support/scripts/install.sh | INSTALL_MODE=cli bash
```

Requires `curl` or `wget`, and `jq` or `python3`. See [INSTALL.md](../INSTALL.md) for `GITHUB_REPO`, `INSTALL_GIT_REF`, etc.

After install, ensure `~/.local/bin` (or the script’s target) is on your **`PATH`**, then:

```bash
crossusage-cli list
```

## Option 2 — One-command build from a **shallow** clone

If you have **Rust** (`cargo`) and **git** but want to compile yourself without keeping a 47GB tree:

```bash
./scripts/install-cli-cargo.sh
```

Or manually:

```bash
git clone --depth 1 --single-branch --branch feat/linux-windows-native-support https://github.com/barramee27/crossusage.git crossusage-tmp
cd crossusage-tmp
cargo install --path crates/crossusage-cli --locked
cd .. && rm -rf crossusage-tmp   # optional: removes sources; binary stays in ~/.cargo/bin
```

**`cargo install --git`:** after the duplicate `crates/crossusage` crate was removed, this should work once your branch is pushed:

```bash
cargo install --git https://github.com/barramee27/crossusage.git \
  --branch feat/linux-windows-native-support \
  crossusage-cli
```

**Plugins:** `src-tauri/resources/bundled_plugins/*` is **not** fully committed to git (only a `.gitkeep`). A bare `cargo install` puts **`crossusage-cli` in `~/.cargo/bin` without bundled JS plugins** next to it.

To get plugins:

- Prefer **Option 1** (tarball includes them), or  
- Extract `bundled_plugins` from a release tarball and point the CLI at them:

```bash
export CROSSUSAGE_RESOURCES=/path/to/extracted/folder
# folder should contain bundled_plugins/ or resources/bundled_plugins/
crossusage-cli list
```

Or build the bundle after a full dev setup (`bun install` and `bun run release:cli-tarball` per [INSTALL.md](../INSTALL.md)).

## Option 3 — `.deb` / installer (GUI + CLI)

Installing the **desktop** package from [Releases](https://github.com/barramee27/crossusage/releases) usually installs **`crossusage-cli`** under `/usr/bin/` with resources under `/usr/share/crossusage/` (Linux). Same repo — no separate clone for daily use.

## Why your checkout might look like “47GB”

- **`target/`** — run `cargo clean` or delete it if you don’t need build artifacts.  
- **`node_modules/`** — only needed for the web/Tauri GUI; skip if you only use the Rust CLI.  
- **Full git history** — use `git clone --depth 1` for a minimal tree.

## Summary

| Goal | Use |
|------|-----|
| Smallest friction, full CLI + plugins | **Option 1** (`INSTALL_MODE=cli`) |
| Compile yourself | **Option 2** + plugins from tarball or `CROSSUSAGE_RESOURCES` |
| GUI + tray + CLI | **Option 3** (release installer / `.deb`) |
