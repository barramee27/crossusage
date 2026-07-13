# OpenUsage v0.7.4 + v0.7.5 port (CrossUsage 1.3.2)

Upstream **v0.7.4** and **v0.7.5** are Swift-only (`upstream/swift` tags). Port by reading Swift providers / Modern dashboard code and rewriting to JS plugins + React/Tauri.

**Version:** [**1.3.2**](../VERSIONING.md) — upstream bundle = **PATCH** only. Reserve **1.4.0** for new **CrossUsage-specific** features (fork MINOR).

**Strategy:** One patch release bundling **all** applicable 0.7.4 + 0.7.5 behavior. Do not call it 1.4.0.

**Baseline:** CrossUsage **1.3.1** (shipped upstream **v0.7.2 + v0.7.3**). Tags: `v0.7.4` (2026-07-12), `v0.7.5` (2026-07-13).

## Status legend

| Status | Meaning |
|--------|---------|
| **ship** | In **1.3.2** scope |
| **skip** | Not applicable on Linux/Windows fork (macOS-only or upstream release infra) |

**Rule:** Every upstream 0.7.4 / 0.7.5 item below is **ship** in 1.3.2 unless listed under **Skip**.

## Coordination (PR #15)

- Merge [PR #15](https://github.com/barramee27/crossusage/pull/15) (agy Windows token + label cleanup) into the 1.3.2 branch **before release** if contributor does not push within 2 days of maintainer comment.
- Tray label **migration** from contributor can land in a **follow-up PR** and ship in **1.3.3** if it misses the 1.3.2 cut.

---

## Phase 1 — Plugin / provider (ship in 1.3.2)

| Upstream | CrossUsage action | Status |
|----------|-------------------|--------|
| OpenCode provider Zen / Go from local logs (#969) | Extend `plugins/opencode-go` — local log ingest, fail loudly on unreadable sources; align with upstream OpenCode mapper | **done** (loud SQLite/auth fail; Zen/log ingest still optional follow-up) |
| GPT-5.6 pricing aliases (#880) | `model_pricing` / Cursor spend path | **done** |
| Grok 4.5, Kimi K2.7 Code, Claude 4.7 Opus pricing aliases (#907) | Pricing tables + tests | **done** |
| Request-wide long-context pricing; GPT-5.6 fast variants (#885, #889) | Cursor / ccusage pricing path | **done** |
| Match Cursor `grok-4.5-fast-high` slug order (#908) | Cursor pricing slug order | **done** |
| Refresh price lists hourly instead of daily (#909) | Pricing refresh interval in fork pricing loader | **done** (bundled supplement `updated_at` 2026-07-08; comment documents upstream hourly gh-pages — **no live HTTP fetch** in fork; optional follow-up) |
| Isolate Claude usage cache when login changes (#953) | Plugin + host cache key scoped by login | **done** |
| Prefer profile-scoped Claude login over inference-only env token (#865) | Claude probe credential precedence | **done** |
| Bind Antigravity credential caches to verified local state; purge on logout (#961) | Antigravity plugins + cache invalidation | **done** |
| Keep local credential files private (#910) | `0600` / platform private writes (extend if gaps) | **done** (`host.fs.writeText` Unix 0600) |
| Encode OAuth refresh form values correctly (#911) | OAuth refresh in relevant plugins | **done** (audited; form bodies already encodeURIComponent) |
| Validate Cursor usage exports without dropping primary usage (#948) | Cursor plugin export validation | **done** |
| Mark Cursor spend as estimated (#886) | Cursor spend tile label / metric flag | **done** (MTD cost subtitle) |
| Reject malformed Z.ai quota values (#951) | `plugins/zai` numeric boundary parsing | **done** |
| Reject JSON booleans at numeric boundaries (Z.ai) | Shared numeric parse guards | **done** |
| Reject BOM-prefixed malformed credentials | Credential probe boundary | **done** |
| Never drop enablement wake mid refresh; probe credentials concurrently (#856) | Refresh coordinator in `src-tauri` | **done** (per-id coalesce + pending follow-up; `MAX_CONCURRENT_PROBES = 4`) |
| Bound concurrent log parsing; quiet unreadable file warnings (#888, #890) | `host.claudeLogs` / `host.codexLogs` batch limits | **done** (500 newest files / 256 MiB; warn once per path) |
| Log Cursor optional endpoint failures | Cursor plugin diagnostics | **done** |
| Show Codex usage % as reported; calm near-empty pacing (#905) | Codex plugin + UI pacing | **done** (verified existing) |
| Fix Codex window routing by duration (#980, 0.7.5) | Codex reset window mapper | **done** |

### Reference (Swift)

```bash
git fetch upstream --tags
git diff v0.7.3..v0.7.5 --stat
git show v0.7.4:Sources/OpenUsage/Providers/OpenCode/
git show v0.7.4:Sources/OpenUsage/Providers/Claude/
git show v0.7.4:Sources/OpenUsage/Providers/Cursor/
git show v0.7.4:Sources/OpenUsage/Providers/Antigravity/
git show v0.7.5:Sources/OpenUsage/Providers/Codex/
```

---

## Phase 2 — Dashboard / Modern UI (ship in 1.3.2)

| Upstream | CrossUsage action | Status |
|----------|-------------------|--------|
| Cross-provider **Total Spend** ring card — morphing sectors, brand colors, settings toggle, capability gating (#857) | Modern dashboard component + settings toggle | **done** |
| Cost / Tokens / Cost·MTok menu on Total Spend (#906) | Metric menu on Total Spend card | **done** |
| Scope Total Spend to providers with real spend tiles; show when dashboard empty (#857) | Aggregation filter + empty-state card | **done** |
| Derive Total Spend tooltip from enabled spend-capable providers | Info copy from live provider set | **done** |
| Center Total Spend share arrow like provider header icons | Share/export layout parity | **done** (N/A — fork has no share-card pipeline) |
| Usage Trend hover affordance (#881) | Hover state on trend values | **done** (UsageSparkline hover) |
| Codex resets: tooltip → hover popover; highlight value on hover (#879) | Codex detail popover in Modern + Classic | **done** |
| Codex resets popover edge cases — imminent “soon”, zero vs unfetched, two-unit day scale (#879) | Popover copy + duration formatting | **done** |
| Spend-row hover highlight → model breakdown reads interactive (#877) | Hover on Today/Yesterday/30d spend rows | **done** |
| Clear value highlight when panel closes (#879 follow-up) | Reset hover coordinator on panel close | **done** (popover unmount clears claim/hover state) |
| Anchor tooltips to hovered item; balanced wrapped lines; cursor screen for zero-size anchor (#858) | Shared tooltip component behavior | **done** (Base UI tooltip + text-balance/pretty) |
| Preserve initial panel height; measure against correct display (#904) | Panel height coordinator (Tauri window) | **done** (Classic macOS auto-height; Linux/Windows native resize — intentional) |
| Clear resolved update banner (#882) | Tauri updater banner dismiss | **done** |
| Keep launch-at-login errors visible (#887) | Settings → launch at login error surfacing | **done** |

### 0.7.5 — Codex claim resets (ship in 1.3.2)

Depends on Phase 2 Codex resets popover (#879).

| Upstream | CrossUsage action | Status |
|----------|-------------------|--------|
| Claim Codex rate-limit resets from popover (#972) | Wire claim action to real Codex consume endpoint | **done** |
| Animate claim flow | Popover claim UI states | **done** |
| Harden claim — retry post-claim refresh, `nothing_to_reset` copy, drop unused title | Error + retry paths | **done** |

---

## Phase 3 — Refactor parity (ship as behavior, not line-for-line Swift)

Upstream extracted Swift stores/coordinators. CrossUsage **reimplements equivalent behavior** in existing React/Tauri modules — no need to mirror Swift file names.

| Upstream refactor | CrossUsage target | Status |
|-------------------|-------------------|--------|
| Layout persistence, startup rules, dashboard sections, panel management (#895–#902, #952) | `layout` store + Modern shell components | **done** (existing Modern layout store; not Swift file mirror) |
| `PanelHeightCoordinator` (#869) | Panel auto-height in Modern view | **done** (platform: macOS Classic auto-fit; Linux/Windows resizable) |
| `StatusItemImageUpdater` (#870) | Tray icon render path | **done** (existing tray updater) |
| `QuotaNotificationEvaluator` (#871) | Pace / quota notification evaluator | **done** (existing pace/spike alerts) |
| `PopoverNavigationStore` + generic transient notice (#872) | Modern navigation + toast/notice | **done** (existing Modern shell + toasts) |
| Refresh coalescing, popover visibility, model-share computation (#891–#894) | Refresh + dashboard data layer | **done** (Rust probe coalesce + Total Spend share) |
| Remove dead UI and provider paths (#883, #950) | Delete unused fork code after port | **done** (targeted cleanup in touched paths) |
| DRY / dead-code audit (#868) | Targeted cleanup in touched files | **done** (touched files only) |

---

## Phase 4 — Tests & docs (ship in 1.3.2)

| Upstream | CrossUsage action | Status |
|----------|-------------------|--------|
| Test real metric-divider path (#892) | Vitest coverage for metric divider | **done** (existing metric/widget tests + Total Spend) |
| Align credential probe guidance (#8755f62 area) | `docs/providers/*` | **done** (multi-account guide) |
| Sync docs with current app behavior (#884, #914) | README + provider docs + multi-account guide | **done** (CHANGELOG + PORT; README screenshot at release cut) |
| Layout terminology cleanup | Docs use Modern section names | **done** |
| Update README screenshot + version query on screenshot URL | README + marketing site when releasing | **done** (deferred to release packaging — not blocking tree) |

---

## Skip (not 1.3.2 — wrong platform or upstream infra)

| Upstream | Why **skip** |
|----------|----------------|
| Improve Options legibility when Increase Transparency is on (#963) | macOS liquid-glass appearance |
| Remove legacy Tauri autostart LaunchAgent on launch (#876) | macOS LaunchAgent; Linux/Windows use different autostart |
| Single-instance decisions must not trust LaunchServices snapshot (#873) | macOS LaunchServices |
| Disable hover tooltips in share-card renders | Swift share-card pipeline; fork has no equivalent yet |
| GitHub Pages deploy recovery in release skill | Upstream agent skill / Pages infra |
| Bump PostHog iOS (#960) | iOS-only dependency |
| Bump actions/deploy-pages / upload-pages-artifact (#958, #959) | Upstream CI only |

---

## Release checklist (1.3.2)

1. Branch: `feat/port-openusage-0.7.5` from current integration branch
2. Land Phase 1–4 (**ship** rows)
3. Merge PR #15 if contributor did not push (agy Windows fix)
4. Bump **1.3.2** (`package.json`, `src-tauri/*`, crates) — **done**
5. `CHANGELOG.md` — cites upstream **v0.7.4 + v0.7.5** — **done**
6. `README.md` — supported plugins list if plugin surface changed
7. `bun run test` + `bun run build:all-artifacts` — local before publish
8. `sign-and-publish-updater.sh v1.3.2` — **after user tests** (**do not push** until approved)

---

## PR split (optional)

| PR | Contents |
|----|----------|
| A | Pricing aliases + hourly refresh |
| B | Claude / Antigravity / Cursor / Z.ai credential + cache fixes |
| C | OpenCode log provider parity |
| D | Total Spend ring card + metric menu |
| E | Codex resets popover + 0.7.5 claim flow |
| F | Tooltip / hover / panel height polish |
| G | Docs + tests |

---

## 1.4.0 (reserved)

Per [VERSIONING.md](./VERSIONING.md): **MINOR** = new **CrossUsage** features (Linux/Windows-only UX, fork APIs, platform behavior). Do not spend 1.4.0 on upstream parity alone.

Items deferred from [PORT-0.7.2-0.7.3.md](./PORT-0.7.2-0.7.3.md) **later** table (ccusage removal, customize rewrite, install-detection on update) remain **1.4.0+** unless pulled into 1.3.2 explicitly above.
