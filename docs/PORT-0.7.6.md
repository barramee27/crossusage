# OpenUsage v0.7.6 port (CrossUsage 1.3.3)

Upstream **v0.7.6** is Swift-only (`upstream/swift` tag, 2026-07-17). Port by reading Swift providers / log scanners / pricing code and rewriting to JS plugins + Rust scanners + React/Tauri.

**Version:** [**1.3.3**](./VERSIONING.md) — upstream bundle = **PATCH** only. Reserve **1.4.0** for new **CrossUsage-specific** features (fork MINOR).

**Strategy:** One patch release bundling **all applicable 0.7.6** behavior. Prioritize **spend accuracy** (#1001, #995) before polish.

**Baseline:** CrossUsage **1.3.2** (shipped upstream **v0.7.4 + v0.7.5**). Tag: `v0.7.6`.

## Status legend

| Status | Meaning |
|--------|---------|
| **ship** | In **1.3.3** scope |
| **skip** | Not applicable on Linux/Windows fork (macOS-only or upstream repo infra) |
| **later** | Valid fork work; OK to defer past 1.3.3 if timeboxed |

**Rule:** Every upstream 0.7.6 item below is **ship** in 1.3.3 unless listed under **Skip** or **Later**.

## Coordination

- [PR #15](https://github.com/barramee27/crossusage/pull/15) (agy Windows + quota summary) — merge when keyring fallback lands; can ship in **1.3.3** with or after 0.7.6 port.
- **1.3.2** is already released (`v1.3.2`); do not re-cut unless a hotfix is required before 1.3.3 ships.

---

## Phase 1 — Spend accuracy & log scanners (**P0**)

| Upstream | CrossUsage action | Status |
|----------|-------------------|--------|
| Fix ~20× Codex spend inflation from subagent replay logs (#1001) | `codex_usage_scanner.rs` — `ChildReplayGate`, equal-count skip; unit tests | **done** |
| Fix Claude and Codex token cost calculations (#995) | `model_pricing.rs` + `codex_pricing.rs` + Claude scanner fast/advisor | **done** |
| Price Codex fast tier per session from rollout logs (#995 / cfdfdd0) | `thread_settings_applied` → `is_fast` | **done** |
| Handle persisted Claude print usage + Codex fast aliases (#995) | Claude iterations + Codex `-fast` alias unwrap | **done** |
| Fold **pi** coding agent usage into Claude and Codex (#975) | `pi_usage_scanner.rs` + `merge_daily_rows` | **done** |
| Follow symlinked log directories when scanning (#973) | Canonicalize Codex session homes/dirs | **done** |
| Strip resolved dir prefix when deduping Codex session files (#b75e329) | Dedup by `(home, relative)`; skip archived dupes | **done** |

### Reference (Swift / Rust upstream)

```bash
git fetch upstream --tags
git log v0.7.5..v0.7.6 --oneline
git diff v0.7.5..v0.7.6 --stat
git show v0.7.6:Sources/OpenUsage/Providers/Codex/
git show v0.7.6:Sources/OpenUsage/Providers/Claude/
git show v0.7.6:Sources/OpenUsage/LogScanning/
```

---

## Phase 2 — Plugins & pricing

| Upstream | CrossUsage action | Status |
|----------|-------------------|--------|
| Restore Cursor Enterprise included-request and on-demand usage (#986) | `plugins/cursor` + nightly — `/api/usage` + `/api/usage-summary` | **done** |
| Recognize Cursor Grok 4.5 usage slugs (#981) | Pricing alias patterns | **done** |
| Accept `xhigh` effort suffix on Grok 4.5 alias rules (#999) | Alias table + tests | **done** |
| Read Claude Desktop login safely as read-only fallback (#962) | Desktop Safe Storage decrypt | **later** (macOS-heavy; Linux/Windows deferred) |
| Update Grok provider logo (#1005) | `plugins/grok/icon.svg` (`currentColor`) | **done** |

---

## Phase 3 — UI / CLI (optional in 1.3.3)

| Upstream | CrossUsage action | Status |
|----------|-------------------|--------|
| Hover-revealed screenshot copying on provider headers (#989) | Provider header / share affordance in Modern + Classic | **later** (no share-card pipeline yet; nice UX) |
| Machine-readable limits API + global `openusage` command (#982) | Evaluate overlap with `crossusage-cli limits` / local HTTP API | **later** (fork already has CLI; port only missing JSON shape if needed) |

---

## Phase 4 — Tests & docs

| Upstream | CrossUsage action | Status |
|----------|-------------------|--------|
| Codex subagent replay regression | `cargo test -p crossusage-core` codex unit tests | **done** |
| Token cost / fast-tier pricing tests | `model_pricing` + `codex_pricing` | **done** |
| Cursor enterprise usage tests | `plugins/cursor/plugin.test.js` (72) | **done** |
| Symlink log scan note | `docs/providers/codex.md` / `claude.md` | **done** |
| `CHANGELOG.md` **1.3.3** | Cite upstream **v0.7.6** | **done** |
| `README.md` | Plugin list if surface changes | **n/a** (no plugin list change) |

---

## Skip (not 1.3.3 — wrong platform or upstream infra)

| Upstream | Why **skip** |
|----------|----------------|
| Hide menu bar usage while screen is shared (#1013) | macOS menu-bar / screen-share API |
| Sync usage history across Macs with iCloud (#984) | macOS iCloud + Keychain device identity |
| Keep Sparkle updater windows in foreground (#985) | macOS Sparkle; fork uses Tauri updater |
| Fix menu-bar icon not closing panel on second click (#1012) | macOS status-item hit testing |
| Keep inactive issues open 30 days before warning (#998) | Upstream `.github/stale.yml` only |
| Ignore `.build-test/` directory (#e4b9fba) | Upstream dev convenience; optional cherry-pick |

---

## Release checklist (1.3.3)

1. Branch: `feat/port-openusage-0.7.6` from `feat/linux-windows-native-support` — **done**
2. Land Phase 1–2 (**ship** rows); Phase 3 **later** — **done** (code; not pushed)
3. Merge PR #15 when ready (agy; independent of 0.7.6 but same release is fine)
4. Bump **1.3.3** (`package.json`, `src-tauri/*`, crates) — **done**
5. `CHANGELOG.md` — cites upstream **v0.7.6** — **done**
6. `bun run test` + `cargo test -p crossusage-core` + `bun run build` — run before release cut
7. `scripts/build-all-artifacts.sh` → `scripts/collect-release-artifacts.sh`
8. Tag `v1.3.3`, GitHub Release, `sign-and-publish-updater.sh v1.3.3` — **after user tests** (**do not push** until approved)

---

## PR split (optional)

| PR | Contents |
|----|----------|
| A | Codex subagent replay dedup (#1001) + tests |
| B | Token cost / fast-tier pricing (#995) |
| C | Pi agent → Claude/Codex attribution (#975) |
| D | Symlink log dirs + Codex session dedup (#973) |
| E | Cursor enterprise + Grok 4.5 slugs/aliases (#986, #981, #999) |
| F | Claude Desktop read-only fallback (#962) — **later** |
| G | Grok logo + docs + CHANGELOG |

---

## 1.4.0 (reserved)

Per [VERSIONING.md](./VERSIONING.md): **MINOR** = new **CrossUsage** features. Items from [PORT-0.7.2-0.7.3.md](./PORT-0.7.2-0.7.3.md) **later** table (ccusage removal, customize rewrite, install-detection on update) remain **1.4.0+** unless explicitly pulled into 1.3.3 above.
