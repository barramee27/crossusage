# Breadcrumbs

## 2026-07-17

- Port OpenUsage **v0.7.6** → CrossUsage **1.3.3** on `feat/port-openusage-0.7.6` (not pushed).
- New: `codex_pricing.rs`, `pi_usage_scanner.rs`; Codex `ChildReplayGate` + session canonicalize/dedup; Claude advisor iterations + fast speed; Cursor enterprise usage-summary; Grok icon + aliases.
- Fixed session discovery bug: double `seen.insert` skipped all `sessions/*.jsonl`.
- Version bump **1.3.3**; CHANGELOG + PORT-0.7.6 status; #962 Claude Desktop → later.

- Ported OpenUsage v0.7.6 PiUsageScanner → `crates/crossusage-core/src/pi_usage_scanner.rs`; wired into Claude/Codex via `merge_daily_rows`.
- Claude `parse_entries` emits `advisor_message` iterations as separate entries (`message_id:advisor:N`).
- Minor codex compile fix: dropped explicit `ref` in `if let` (edition 2024 binding mode).
- Cursor enterprise: `buildEnterpriseResult` now fetches `/api/usage` + `/api/usage-summary` (mirrors Swift `CursorUsageSummaryMapper`); synced to `cursor-nightly`. Grok icon replaced from `/tmp/grok.svg`.
