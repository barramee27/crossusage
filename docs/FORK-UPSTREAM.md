# Forking upstream OpenUsage

CrossUsage is the **Tauri Linux/Windows** line. Upstream **OpenUsage 0.7+** is a **Swift native macOS** app (`v0.7.0-beta`). We do not merge Swift sources wholesale — we **rewrite** applicable UX in this repo or **copy** portable `plugins/` changes.

**Release trigger:** CrossUsage **1.1.1** ships when upstream **`v0.7.0` GA** (non-prerelease) drops, after prep on `feat/port-openusage-0.7-prep`. **1.2.0** follows ~7 days later (fork-only polish).

## What to port

| Kind | Action |
|------|--------|
| `plugins/<id>/plugin.js` + tests | Copy or merge; run plugin tests |
| `plugins/<id>/plugin.json` | Usually copy |
| Rust in `crates/crossusage-core` / `src-tauri` | Cherry-pick if still Tauri-shaped on `upstream/main` |
| Swift under `Sources/OpenUsage/` | **Rewrite** to React + Tauri |
| Retirement / “get new app” banners | **Skip** — CrossUsage *is* the continued desktop app on Linux/Windows |
| macOS-only panel/keychain | Port only if Linux/Windows benefit |

## PR tracking (0.7 prep)

Update this table as work lands on `feat/port-openusage-0.7-prep`.

| PR | Title | Class | CrossUsage status |
|----|-------|-------|-------------------|
| [#567](https://github.com/robinebers/openusage/pull/567) | Codex credits display | plugin-easy | **done** (codex plugin) |
| [#568](https://github.com/robinebers/openusage/pull/568) | Codex refresh token reuse | plugin-easy | **done** (codex plugin) |
| [#577](https://github.com/robinebers/openusage/pull/577) | Codex rate limit resets | plugin-easy | **done** (codex plugin) |
| [#570](https://github.com/robinebers/openusage/pull/570) | Rust security cargo update | rust-shared | **done** (`src-tauri/Cargo.lock`) |
| [#555](https://github.com/robinebers/openusage/pull/555) | Menubar weekly metric | fork-already | **skip** — already in CrossUsage settings/tray |
| [#616](https://github.com/robinebers/openusage/pull/616) | Retirement notice banner | skip | **skip** — points users to openusage.ai |
| [#612](https://github.com/robinebers/openusage/pull/612) | Codex/Devin usage bugs | plugin-easy | **done** — Devin weekly fallback flip; Codex badge ordering already correct in JS |
| [#613](https://github.com/robinebers/openusage/pull/613) | Settings refresh/style layout | swift-rewrite | **todo** — adapt Settings UX in Tauri |
| [#614](https://github.com/robinebers/openusage/pull/614) | Screen pager flicker fix | swift-rewrite | **todo** — overview navigation |
| [#615](https://github.com/robinebers/openusage/pull/615) | Debug logging → native app | swift-rewrite | **todo** — align with existing Tauri logging |
| beta.2 | Pre-pin common stats on first launch | swift-rewrite | **todo** — onboarding/settings bootstrap |

## Workflow

1. `git fetch upstream --tags`
2. Diff: `git log v0.6.27..upstream/main --oneline` and `git diff v0.6.27..upstream/main -- plugins/`
3. Classify each change (table above).
4. Port on **`feat/port-openusage-0.7-prep`** — **no version bump** until `v0.7.0` GA.
5. At GA: `git diff feat/port-openusage-0.7-prep...v0.7.0` → gap-fill → bump **1.1.1** → release.
6. Plugin-only follow-ups after GA: patch releases; document upstream tag in [CHANGELOG.md](../CHANGELOG.md).

## Plugin sync checklist

When copying a plugin from upstream:

- [ ] `plugin.js`, `plugin.json`, `plugin.test.js`
- [ ] `bun run test plugins/<id>/plugin.test.js`
- [ ] Redaction audit vs [`host_api.rs`](../src-tauri/src/plugin_engine/host_api.rs) (see [AGENTS.md](../AGENTS.md))
- [ ] `bun run bundle:plugins` if shipping

## Compare plugins quickly

```bash
./scripts/diff-upstream-plugins.sh
```

Lists plugins whose `plugin.js` differs between `HEAD` and `upstream/main`.
