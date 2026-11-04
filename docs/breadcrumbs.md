# Breadcrumbs

## 2026-11-04

- Antigravity CLI quota summary: an unversioned client identity returned only third-party buckets on a live Google account. A versioned CLI identity (`antigravity/cli/1.5.0`) restored Gemini session and weekly buckets in both `plugins/antigravity-cli/plugin.js` (#49) and the `probeAgyCloudCode` fallback in `plugins/antigravity/plugin.js`. The plugin tests assert the header, and a live probe verified the returned buckets on one account.

## 2026-11-02

- JetBrains AI Assistant live quota fix (#41): added multi-source probing to `plugins/jetbrains-ai-assistant/plugin.js` — Tier 1 live IDE JSON-RPC (`~/.junie/instances/*.json` → `http://127.0.0.1:<port>/rpc` `JunieSystemService.getQuotaInfo`), Tier 2 Junie CLI / Grazzio cloud API (`~/.junie/secure_credentials.json` or `junie-cli` keychain → `GET https://ingrazzio-cloud-prod.labs.jb.gg/auth/test` + OAuth refresh), Tier 3 Junie CLI session logs (`~/.junie/sessions/*/events.jsonl`), Tier 4 IDE `idea.log` (`QuotaManager2Impl`), and Tier 5 `AIAssistantQuotaManager2.xml` fallback; added `username`, `rpc_token`, `simpleToken` redaction in `host_api.rs`.
- Reviewed and merged PRs #43, #44, #45, and #46 onto `feat/linux-windows-native-support`.
- Post-merge polish: updated `cursor_state_db_has_auth` to ignore `cursor-safe-storage:` ciphertext; allowed `cursor_usage_export` (`fetch_cursor_month_to_date_totals_uncached`, `download_cursor_usage_csv_for_plugin`, `fetch_cursor_usage_rows_via_events`) to authenticate via Cursor CLI `auth.json` even when `state.vscdb` is absent; formatted underscore-separated Perplexity `subscription_tier` values (e.g. `enterprise_pro` → `Enterprise Pro`); and extended `redact_body` JWT regex in `host_api.rs` to redact 5-segment JWE tokens (such as `next-auth` session cookies).

## 2026-11-01

- Provider order: startup normalization preserves saved order instead of alphabetically sorting every launch. Regression coverage includes custom provider orders, disabled entries, and newly discovered providers. Modern dashboard and Customize both use plugins.order; modernLayout.providerOrder is legacy state.
- `feat/perplexity-cookie-auth`: Perplexity on Windows/Linux via a pasted session cookie. `plugins/perplexity/plugin.js` gets `probeViaCookie` (cookie-shape detection, `fetchWebJson`, `buildCookieHeader`); `probe()` tries it first and falls back to the unchanged macOS cache path. Docs (`docs/providers/perplexity.md`, `multi-account-credentials.md`) and the credentials-dialog placeholder/hint in `settings.tsx` updated. Verified live on Windows against a real account: `rate-limit/status`, `billing/credits`, `api/auth/session` all 200, no Cloudflare challenge. 13 new tests in `plugin.test.js`.
- Checked `host_api.rs` redaction per AGENTS.md: request headers (including the new `Cookie`) are never logged, only the redacted URL and redacted response body. No redaction-list changes needed.
- Run `npx tsc --noEmit` before pushing UI changes: vitest does not typecheck, and a redundant `form.mode !== "rename"` inside the `!isRename` branch passed all tests but failed `tsc`.
- Open finding, not fixed here: `redact_body`'s JWT regex expects 3 dot-separated segments; `next-auth` cookies are JWE (5 segments, empty 2nd). A JWE appearing in a response body would not be redacted. Perplexity response bodies carry no token, so this PR is unaffected; worth its own issue.

## 2026-10-19

- Resolved Grok Bot QA notes and CI checks on PR #40: added `crates/crossusage-cli/build.rs` so `embedded_plugins.rs` stages filtered runtime plugins into `$OUT_DIR/bundled_plugins` without requiring `copy-bundled.cjs` first; auto-created the dev CLI sidecar stub in `scripts/tauri-before-dev.cjs` for clean checkouts; localized the Modern top navigation tabs (`dashboard`, `customize`, `polls`, `settings`) in `modern-shell.tsx` across all 13 locales; fixed `cursorPaths.resolveStateDb` zero-argument arity in `host_api.rs`; and silenced Windows dead-code warnings in `chromium_cookies.rs`.
- Ported OpenUsage **v0.7.15** onto `perf/optimize-build-and-size` and bumped CrossUsage to **1.6.1** (PATCH): Codex dashboard link (`chatgpt.com/settings/usage`), Gemini `-n` effort pricing alias, Codex `codex-auto-review` $0 cost since Oct 6 2026, OpenCode Go `20260805200742_import_legacy_credentials` migration check, Ollama `/api/balance` dollar allowance + `Purchased Credits`, Claude `Rate Limit Resets` hourly throttling, and Cursor paged `get-filtered-usage-events` incremental day-by-day history cache (`docs/PORT-0.7.15.md`).
- Replaced legacy macOS `screenshot.png` (1.06 MB) with a native Linux CrossUsage 1.6.1 showcase composite (194 KB) displaying the Modern UI Dashboard, Classic UI Overview, and Classic UI Provider Detail views (`#39`).

## 2026-10-16

- Ported OpenUsage **v0.7.14** onto `perf/optimize-build-and-size`: Codex plan names (`Pro 100`, `Pro 200`, `Pro 500`), Cursor team model pool preference over legacy $20 allowance, OpenCode Go sub-1% Session reset countdowns + 5h placeholder reset drop, and `docs/PORT-0.7.14.md`.

## 2026-10-14

- Build/size optimization pass: added `[profile.release]` (`strip = "symbols"`, `lto = "thin"`, `codegen-units = 1`) and `[profile.dev]` (`debug = 1`); set `src-tauri` `crate-type = ["rlib"]`; skipped `--target` in `prepare-cli-sidecar.sh` when native; replaced `tauri-plugin-aptabase` with direct `reqwest::blocking` POST; gated `tauri-plugin-liquid-glass` to macOS; dropped `rquickjs` `bindgen`, `time`, `users`, `color-eyre`, `textwrap`, `owo-colors`, and unused CLI deps; stripped `*.test.js`/`*.md` from bundled plugins and 6.4 MB of unused icons; code-split frontend views/locales and dropped `@base-ui/react`.

## 2026-10-05

- Ship number on `feat/port-openusage-0.7.13` is **1.6.0** (MINOR). The base account label sets the bump; the v0.7.13 port rides along.

## 2026-10-04

- Port OpenUsage **v0.7.13** on `feat/port-openusage-0.7.13`. Tracker: [PORT-0.7.13.md](./PORT-0.7.13.md).

## 2026-09-25

- Base provider rows can take a display label (`providerLabels`) via Settings → Rename. Add account stays; Remove stays off the base row.

## 2026-09-20

- Port OpenUsage **v0.7.11 + v0.7.12** + Gemini Apps → CrossUsage **1.5.0** (MINOR) on `feat/port-openusage-0.7.12`. Pricing supplement 2026-09-11; pace zero-usage; Grok subagent ledgers; Codex Business Premium + gpt-reserve@Luna + Astra; Antigravity sibling conversation stores; Devin exhausted weekly; Claude null nested model + live `/api/oauth/profile`. Tracker: [PORT-0.7.11-0.7.12.md](./PORT-0.7.11-0.7.12.md).

## 2026-09-14

- Gemini Apps: keep cookies from one Chromium profile; require PSID+SAPISID before skipping `GEMINI_COOKIE`; plan label from `sJBwce` only.
- Ported lab `gemini-apps` onto `feat/gemini-apps` from `origin/feat/linux-windows-native-support` (1.4.4). Host: `chromium_cookies.rs`, `GEMINI_COOKIE`, `http1Only`, Google cookie redaction, `sha1Hex`. Grok.com stays lab.

## 2026-09-02

- Tray readout (provider + meter, portal to `document.body`) + Classic vs Modern tray provider pick + mid-fill style previews. Lab Gemini Apps / Grok.com stay off this branch. Apply keeps other `trayLines` meters; Modern pin-sync does not clobber tray focus. Confirming an already-pinned only meter does not `unshift` it (other providers stay put).

## 2026-08-28

- Port OpenUsage **v0.7.10** → CrossUsage **1.4.3** on `feat/port-openusage-0.7.10`. Pricing supplement 2026-08-26; Cursor Grok Bot; Antigravity/Grok local spend; Claude spend-without-OAuth + Fable + sub-1% countdown; Copilot org credits; OpenRouter key window. Tracker: [PORT-0.7.10.md](./PORT-0.7.10.md).
- Antigravity local spend: `antigravity_proto.rs` + `antigravity_db_usage_scanner.rs`, `host.antigravityLogs.queryDaily` (FelixIsaac #1058/#1120).
- Cursor Grok Bot + dashboard names: rename Auto/API labels, fetch `GetSandUsageStatus`, migrate stored Cursor tray/metric IDs.
- Grok session-ledger spend → `grok_usage_scanner.rs` + `host.grokLogs.queryDaily`.
- Dropped the ~400 LOC file budget (AGENTS.md). Do not split/truncate code to stay under a cap.
- Quiet **Modern** motion: no bar sheen/sparks, no overlay field, no card float. Classic unchanged.

## 2026-08-18

- 1.4.1 motion pass 6: removed **concentric grain rings** (the “100 circles”). Restored orbs. Click ripples still off.
- 1.4.1 motion pass 4: still **no panel tilt/zoom**. Extra overlay FX: dual aurora, parallax grid, dust, slow scan, spark cursor. Reduce animations still kills all FX.

## 2026-08-13

- Port OpenUsage **v0.7.8 + v0.7.9** → CrossUsage **1.4.1** on `feat/port-openusage-0.7.8-0.7.9` (not pushed). Public **v0.7.7** skipped upstream (`v0.7.6...v0.7.8`). Pricing supplement 2026-08-13; Codex auto-review slug; OpenCode Go official usage API; Reduce animations; Reset all settings. Tracker: [PORT-0.7.8-0.7.9.md](./PORT-0.7.8-0.7.9.md).
- Live poll `aptabase-extra-2026-08`: `expiresAt` 2026-08-15T23:59:59Z + close date in body. `selectActivePoll` keeps expired/ended published polls on `/active` for results. `/active` cache 60s. Server-only — 1.4.0 clients already render `body` + `ended`.

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

