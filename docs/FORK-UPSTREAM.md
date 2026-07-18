# Forking upstream OpenUsage

CrossUsage is the **Tauri Linux/Windows** line. Upstream **OpenUsage 0.7+** is a **Swift native macOS** app on branch **`upstream/swift`** (`v0.7.0-beta`). We do not merge Swift sources wholesale — we **rewrite** applicable UX in this repo or **copy** portable `plugins/` changes.

**UI diff target:** compare Modern layout work against **`upstream/swift`**, not `upstream/main`. Port spec: [OPENUSAGE-0.7-UI-SPEC.md](./OPENUSAGE-0.7-UI-SPEC.md).

**Release trigger:** **1.2.0** → v0.7.0 Modern UI. **1.3.0** → v0.7.1 + i18n ([PORT-0.7.1.md](./PORT-0.7.1.md)). **1.3.1** → bundled v0.7.2 + v0.7.3 ([PORT-0.7.2-0.7.3.md](./PORT-0.7.2-0.7.3.md)). **1.3.2** → bundled v0.7.4 + v0.7.5 ([PORT-0.7.4-0.7.5.md](./PORT-0.7.4-0.7.5.md)). **1.3.3** → v0.7.6 ([PORT-0.7.6.md](./PORT-0.7.6.md)). **1.4.0** → fork-only features per [VERSIONING.md](./VERSIONING.md).

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
| [#613](https://github.com/robinebers/openusage/pull/613) | Settings refresh/style layout | swift-rewrite | **done** — Modern shell + dual `uiLayout` |
| [#614](https://github.com/robinebers/openusage/pull/614) | Screen pager flicker fix | swift-rewrite | **done** — Modern tab nav |
| [#615](https://github.com/robinebers/openusage/pull/615) | Debug logging → native app | swift-rewrite | **done** — Settings log level + log path/reveal; default Info; `[refresh]` tags |
| beta.2 | Pre-pin common stats on first launch | swift-rewrite | **done** — `DefaultLayout` + tray migration in Modern |

## Workflow

1. `git fetch upstream --tags`
2. Diff: `git log v0.6.27..upstream/swift --oneline` and `git diff v0.6.27..upstream/swift -- plugins/`
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

Lists plugins whose `plugin.js` differs between `HEAD` and `upstream/swift` (override: `UPSTREAM_REF=upstream/main`).

## Dual UI (Classic + Modern)

One binary ships both layouts via Settings → **UI layout** (`uiLayout`: `classic` | `modern`). Default: **Classic**. Modern ports OpenUsage 0.7 grouped cards, Customize pins, and tray pin strip. See [OPENUSAGE-0.7-UI-SPEC.md](./OPENUSAGE-0.7-UI-SPEC.md).
