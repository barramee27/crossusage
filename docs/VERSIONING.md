# CrossUsage versioning

CrossUsage uses [Semantic Versioning](https://semver.org/): **`MAJOR.MINOR.PATCH`** (three numbers, e.g. `1.0.10`).

This is **not** the same as upstream [OpenUsage](https://github.com/robinebers/openusage). Upstream **0.6.x** was Tauri; **0.7+** is Swift (macOS). CrossUsage stays **Tauri on Linux/Windows**. When we port upstream work, we bump **PATCH** for upstream bundles (e.g. **1.1.1** at OpenUsage **v0.7.0** GA) or **MINOR** for fork-only features (e.g. **1.2.0**). Document upstream tags in [CHANGELOG.md](../CHANGELOG.md). See [FORK-UPSTREAM.md](FORK-UPSTREAM.md).

## What each number means

| Piece | Example | Meaning for CrossUsage |
|-------|---------|-------------------------|
| **MAJOR** | `1` → `2` | Breaking changes (big fork/API/UI breaks). |
| **MINOR** | `1.0` → `1.1` | New **CrossUsage** features, backward compatible. |
| **PATCH** | `1.0.9` → `1.0.10` | Bug fixes, security, small ports (e.g. merging upstream v0.6.25). |

## Quick rules (CrossUsage)

| Release type | Bump | Example |
|--------------|------|---------|
| **Upstream port** (merge OpenUsage `0.6.x`) | **PATCH** only — `x.y.ZZ` | `1.0.9` → `1.0.10` |
| **New CrossUsage feature** | **MINOR** — `x.Y.0` | `1.0.10` → `1.1.0` |
| **Breaking change** | **MAJOR** — `X.0.0` | `1.1.0` → `2.0.0` |

(`ZZ` is any patch number: `9`, `10`, `11` — not a special format.)

## Examples

| Version | When to use |
|---------|-------------|
| `1.0.10` | After `1.0.9`: upstream port + fixes — **patch** bump only. |
| `1.1.0` | New fork features (usage history UI, new platform behavior, etc.). |
| `2.0.0` | Intentional breaking change for users (config format, removed APIs, etc.). |

## Where the version is set

Keep these in sync when cutting a release:

- `package.json` → `"version"`
- `src-tauri/tauri.conf.json` → `"version"`
- `src-tauri/Cargo.toml` → `version`
- `crates/crossusage-core/Cargo.toml` → `version`
- `crates/crossusage-cli/Cargo.toml` → `version`
- [CHANGELOG.md](../CHANGELOG.md) → new `## x.y.z` section

The in-app footer reads the Tauri app version at runtime.
