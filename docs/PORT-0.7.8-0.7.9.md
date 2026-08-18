# OpenUsage v0.7.8 + v0.7.9 port (CrossUsage 1.4.1)

Upstream **v0.7.8** (2026-08-11) and **v0.7.9** (2026-08-13) are Swift-only. Robin **skipped a public v0.7.7** (`v0.7.6...v0.7.8`; only `v0.7.7-beta.1` exists). Port by rewriting applicable Swift into JS plugins + Rust scanners + React/Tauri.

**Version:** [**1.4.1**](./VERSIONING.md) — upstream bundle = **PATCH**. Baseline: CrossUsage **1.4.0** (fork MINOR). Tags: `v0.7.8`, `v0.7.9`.

**Strategy:** One patch bundling **all applicable 0.7.8 + 0.7.9** behavior. User asked to PR/merge + GitHub Release.

## Status legend

| Status | Meaning |
|--------|---------|
| **ship** | In **1.4.1** scope |
| **skip** | macOS-only, upstream infra, or already in the fork |
| **later** | Valid fork work; OK to defer |

## Phase 1 — Pricing (**P0**)

| Upstream | CrossUsage action | Status |
|----------|-------------------|--------|
| Price Kimi K3 + Cursor Router prose labels (#1087) | Bundled `pricing_supplement.json` + `(?i)` alias compile | **done** |
| Claude Opus 5 (+ fast) (#1050) | Supplement rates + aliases | **done** |
| Grok 4.6; Grok 4.5 Fast output $12 (#1101) | Supplement + aliases | **done** |
| Daybreak Blue → `gpt-5.6-sol` (#1093) | Alias | **done** |
| Newer of cached vs bundled supplement (#1089) | Fork does **not** fetch gh-pages; bundled-only | **skip** |

## Phase 2 — Plugins / scanners

| Upstream | CrossUsage action | Status |
|----------|-------------------|--------|
| Codex auto-review slug stays visible; dated fallback for cost only (#1085) | `codex_usage_scanner.rs` `pricing_model` | **done** |
| OpenCode Go meters from `GET /zen/go/v1/usage` (#1097) | `plugins/opencode-go` — API when key present; SQLite leftover only without a key | **done** |
| Cache parsed JSONL logs across launches (#1017) | Persistent scanner cache | **later** (in-process `FILE_CACHE` already; disk cache is a large Swift port) |

## Phase 3 — Settings / UI

| Upstream | CrossUsage action | Status |
|----------|-------------------|--------|
| Reduce Animations (#1019) | Settings toggle + `reduce-animations` class | **done** |
| Reset All Settings with confirm (#1033) | Advanced row; restores UI prefs, not credentials / poll identity | **done** |

## Skip

| Upstream | Why |
|----------|-----|
| Account-first Phase 2 + 2b (#1030, #1031) | **Reverted** upstream before 0.7.8 (#1090) |
| Account-first Phase 0 + 1 (#1026, #1027) | Fork already has multi-account + encrypted credentials |
| PostHog iOS / Sparkle / `actions/stale` | macOS / upstream CI |
| JSONL persistent scan cache (#1017) | **later** (see above) |
| Pricing live fetch vs bundled (#1089) | No network pricing feed in fork |

## Tests & docs

| Item | Status |
|------|--------|
| `cargo test -p crossusage-core` pricing + auto-review | **done** (135 pass; 2 known ccusage subprocess fails in this env) |
| `bun run test` settings + opencode-go | **done** |
| `CHANGELOG.md` **1.4.1** cites **v0.7.8 + v0.7.9** | **done** |
| `docs/providers/opencode-go.md` | **done** |

## Release checklist (1.4.1)

1. Branch: `feat/port-openusage-0.7.8-0.7.9` from `feat/linux-windows-native-support` — **done** (local)
2. Bump **1.4.1** version files — **done**
3. `bun run test` + `cargo test -p crossusage-core` + `bun run build` — **done** (no GitHub push)
4. PR / merge / GitHub Release **v1.4.1** — in progress (user asked)
