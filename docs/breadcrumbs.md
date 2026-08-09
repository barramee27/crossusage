# Breadcrumbs

## 2026-08-09

- Polls dismiss telemetry (`not_now`/`dont_ask`) + admin `GET /api/polls/:id/stats`; public results stay vote-only.
- CrossUsage **1.4.0** on `feat/1.4.0-release-bundle`: product polls + Polls visit force-fetch; Windows #18 keyring harden (`get_secret`/UTF-16LE/`set_secret`); #838 notify-once for newly bundled providers; `crossusage.limits.v1` via `/v1/limits` + `crossusage-cli limits`.

## 2026-07-31

- Product polls (1.4.0 planned): dumb-shell client + Polls page (Classic SideNav + Modern tab), soft badge, Settings toggle default on; VPS `deploy/crossusage.dev/polls-api` (Bun/SQLite) + nginx `/api/polls/`.

## 2026-07-17

- Port OpenUsage **v0.7.6** → CrossUsage **1.3.3** on `feat/port-openusage-0.7.6` (not pushed).
- New: `codex_pricing.rs`, `pi_usage_scanner.rs`; Codex `ChildReplayGate` + session canonicalize/dedup; Claude advisor iterations + fast speed; Cursor enterprise usage-summary; Grok icon + aliases.
- Fixed session discovery bug: double `seen.insert` skipped all `sessions/*.jsonl`.
- Version bump **1.3.3**; CHANGELOG + PORT-0.7.6 status; #962 Claude Desktop → later.

- Ported OpenUsage v0.7.6 PiUsageScanner → `crates/crossusage-core/src/pi_usage_scanner.rs`; wired into Claude/Codex via `merge_daily_rows`.
- Claude `parse_entries` emits `advisor_message` iterations as separate entries (`message_id:advisor:N`).
- Minor codex compile fix: dropped explicit `ref` in `if let` (edition 2024 binding mode).
- Cursor enterprise: `buildEnterpriseResult` now fetches `/api/usage` + `/api/usage-summary` (mirrors Swift `CursorUsageSummaryMapper`); synced to `cursor-nightly`. Grok icon replaced from `/tmp/grok.svg`.

## 2026-07-14

- Antigravity label/color pass: added shared old-label migration for `antigravity` and `antigravity-cli` Classic tray settings plus Modern dashboard metric IDs; added tests for migration and `#4285F4` line color.

## 2026-07-10

- Tauri dev WebView fix: changed `devUrl` and `scripts/tauri-before-dev.cjs` to IPv4 loopback (`127.0.0.1:1420`) after Vite was observed listening only on `[::1]:1420` while WebView still showed `ERR_EMPTY_RESPONSE` for `localhost`.
- Antigravity CLI quota UI: updated `plugins/antigravity-cli` to call Cloud Code `retrieveUserQuotaSummary` first and expose the same four summary lines as desktop Antigravity; left `antigravity-ide` unchanged.
- Antigravity quota UI: Cloud Code now uses `retrieveUserQuotaSummary`; manifest and parser expose Gemini session/weekly lines first, then Claude and GPT session/weekly lines.
- Antigravity Windows auth fix: resolve existing `Antigravity IDE`/legacy paths through `firstExistingAppSupport` (`%APPDATA%` on Windows), skipping nonexistent macOS paths and their SQLite warnings; read `gemini:antigravity` as raw Go-keyring UTF-8 bytes and refresh once after an auth failure.
