# Choices

## 2026-09-02

- **Tray provider pick:** Classic follows the open sidebar provider. Modern may use pin focus / first pinned. Do not apply Modern pin focus on Classic (it froze the logo on one plugin).
- **Tray readout dialog:** Logo+% / fill / pie / all-logos open a body-portaled picker when more than one enabled plugin or meter can drive the icon. Battery bars apply immediately. Style previews use a mid fill (`0.62`) so they are not all full at 90% remaining.
- **Full-color tray logos:** SVGs without `currentColor` (and rasters) render as `<img>`, not a CSS mask.

## 2026-08-28

- **No file line-count budget** (AGENTS.md). Do not split or drop code to stay under a LOC cap.
- **1.4.3 port scope:** OpenUsage **v0.7.10** as one PATCH. Skip Swift UI / PostHog / Sparkle / macOS status-item / Claude Desktop Safe Storage. Codex fallback-model picker (#1177) **later** (fork has no Customize → Codex UI; `fallback_models` is in the bundled supplement).
- **Antigravity local spend (0.7.10):** simple re-scan of `~/.gemini/antigravity-cli/conversations/*.db` (no WAL fingerprint cache). Unpriced models skipped (no `unknownModels` on `DailyUsageRow`). Spend tiles on both `antigravity` and `antigravity-cli` (shared CLI conversation DBs); not `antigravity-ide`. Missing DBs are `no_data` — quota probe still succeeds.
- **Cursor dashboard names:** `Auto usage` → **Cursor Models**, `API usage` → **Other Models**. Widget IDs stay `autoPercentUsed` / `apiPercentUsed`. Migrate stored trayLines + Modern metric IDs for `cursor`, `cursor-nightly`, and `cursor:` / `cursor-nightly:` instances.
- **Grok Bot:** optional `GetSandUsageStatus` Connect RPC; skip pooled/zero-included; failures never drop primary Cursor usage. Insert after Other Models (else after Total).
- **Grok session spend:** native `host.grokLogs.queryDaily` from coordinator `updates.jsonl` (OpenUsage 0.7.10). No disk JSONL cache. Token cap **1e9** (i32 `DailyUsageRow`; Swift 1e12). Unknown models without carried cost skipped. No-auth + local spend still shows Today/Yesterday/30d/trend; no-auth + no spend keeps login error. Empty logs do not fail the probe.

## 2026-08-19

- **Modern vs Classic motion:** Classic keeps bar sheen/sparks (one provider at a time). Modern dashboard drops looping bar lights, card bob, and MotionField overlay — too many meters at once.

## 2026-08-18

- **Motion vs Reduce animations:** No live 3D/zoom on the whole panel. No concentric grain rings (looked like ~100 circles) and no click ripples. Orbs stay. Pointer drives spotlight/comet/grid. OS reduce-motion still hard-kills.

## 2026-08-13

- **1.4.1 port scope:** OpenUsage **v0.7.8 + v0.7.9** as one PATCH. Skip public v0.7.7 (never shipped). Skip Account-first Phase 2/2b (reverted #1090), PostHog/Sparkle/stale, JSONL disk cache (#1017 later), live pricing fetch (#1089 — fork bundled-only).
- **Reset all settings:** restore UI prefs only. Keep plugin order/disabled/credentials and poll `installId` / answers / dismissals. Polls enabled returns to default ON. Other locales fall back to English for new strings.
- **OpenCode Go:** official `GET /zen/go/v1/usage` when a Go API key exists; SQLite leftover meters only without a key (matches #1097).
- **Aptabase poll close:** Saturday **15 Aug 2026, 23:59 UTC** (`expiresAt`). Same sentence in `body`. After expiry, `/active` still returns the poll (`ended: true`) so a winner can show; set `active: false` to hide. Open poll preferred if several are published.

## 2026-08-09

- **Polls dismiss telemetry:** app POSTs `not_now` / `dont_ask`; admin-only `GET …/stats` via `X-Polls-Admin`. Public results stay vote-only.
- **Polls anti-spam:** hashed IP, **1 new vote/IP/poll** + burst 429 (5 POSTs/min/IP) + nginx `limit_req`. `installId` alone is forgeable; no CAPTCHA for product feedback.
- **1.4.0 scope:** polls + Windows #18 + #838 notify-once + limits JSON. Out: customize rewrite, screenshot share, #962, full ccusage removal.
- **#838:** keep disabled-list model; notify once when newly bundled plugins appear after update (no credential auto-enable in v1).
- **Limits schema:** `crossusage.limits.v1` (fork id); map progress lines only; `/v1/usage` stays UI-shaped.

## 2026-07-31

- **Product polls UI:** dedicated Polls page (not blocking overlay) for Classic + Modern; soft badge when unanswered; show aggregate results only after local vote (or when poll ended) to avoid herding.
- **Polls enabled default ON** — kill-switch in Settings; empty API = quiet empty Polls page, no nag elsewhere.
- **Votes:** opaque install UUID + poll/option ids only; server stores SHA-256 of install id.

## 2026-07-17

- **#962 Claude Desktop Safe Storage:** **later** for 1.3.3 — macOS-centric decrypt; Linux/Windows has no equivalent store path worth shipping half-baked.
- **Phase 3 UI/CLI (#989, #982):** stay **later**; fork already has CLI/HTTP.
- **Pi fold-in at `query_daily_since`:** Claude/Codex merge pi rows even when the native scan returns no files/empty, so pi-only usage still shows on those cards (matches upstream `DailyUsageAccumulator.merged`).
- **Pi scanner:** no incremental file cache. Re-parse session files each query.
- **Unknown pi models:** skipped from totals (no `unknownModelsByDay` on `DailyUsageRow`); same as existing Claude/Codex Rust aggregate.
- **Cursor enterprise on-demand without limit:** CrossUsage has no `values` MetricLine; emit `text` (`$X.XX`) when usage-summary has used>0 but no positive limit (Swift uses `.values`).

## 2026-07-14

- Antigravity label migration: migrate old desktop/CLI line labels in both Classic `trayLines` and Modern `metricId` state; exclude `antigravity-ide` because its labels/API path were intentionally left alone.
- Antigravity display color: carry `#4285F4` as `line.color` from desktop/CLI plugin output and let Modern widget progress fill/pace dot honor custom line colors.

## 2026-07-10

- Tauri dev on Windows: use explicit IPv4 loopback (`127.0.0.1:1420`) for both `devUrl` and Vite host. Avoid `localhost` because Vite can bind only `[::1]`, leaving WebView unable to reach the dev server on some Windows setups.
- Antigravity CLI quota: match the desktop `agy` path by preferring `retrieveUserQuotaSummary` and rendering Gemini session/weekly lines first, then Claude and GPT session/weekly lines. Keep older `loadCodeAssist` / model quota calls as compatibility fallback only.
- Antigravity remote quota: prefer `retrieveUserQuotaSummary` on the daily Cloud Code host, then the standard Cloud Code host; render its four stable group/window buckets rather than individual model pools. Retain legacy model calls only when no summary is returned.
- Antigravity credential discovery: use `host.fs.firstExistingAppSupport` for the platform-native VS Code state database; do not infer credentials from `.gemini/antigravity` conversation files. On Windows, read `agy`'s Go-keyring target as raw UTF-8 bytes; refresh only after Cloud Code returns `401`/`403`.
