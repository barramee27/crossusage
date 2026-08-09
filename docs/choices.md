# Choices

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
- **Pi scanner:** no incremental file cache (simpler; ~350 LOC budget). Re-parse session files each query.
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
