# Choices

## 2026-07-17

- **#962 Claude Desktop Safe Storage:** **later** for 1.3.3 — macOS-centric decrypt; Linux/Windows has no equivalent store path worth shipping half-baked.
- **Phase 3 UI/CLI (#989, #982):** stay **later**; fork already has CLI/HTTP.
- **Pi fold-in at `query_daily_since`:** Claude/Codex merge pi rows even when the native scan returns no files/empty, so pi-only usage still shows on those cards (matches upstream `DailyUsageAccumulator.merged`).
- **Pi scanner:** no incremental file cache (simpler; ~350 LOC budget). Re-parse session files each query.
- **Unknown pi models:** skipped from totals (no `unknownModelsByDay` on `DailyUsageRow`); same as existing Claude/Codex Rust aggregate.
- **Cursor enterprise on-demand without limit:** CrossUsage has no `values` MetricLine; emit `text` (`$X.XX`) when usage-summary has used>0 but no positive limit (Swift uses `.values`).

## 2026-07-10

- Tauri dev on Windows: use explicit IPv4 loopback (`127.0.0.1:1420`) for both `devUrl` and Vite host. Avoid `localhost` because Vite can bind only `[::1]`, leaving WebView unable to reach the dev server on some Windows setups.
- Antigravity CLI quota: match the desktop `agy` path by preferring `retrieveUserQuotaSummary` and rendering Gemini session/weekly lines first, then Claude and GPT session/weekly lines. Keep older `loadCodeAssist` / model quota calls as compatibility fallback only.
- Antigravity remote quota: prefer `retrieveUserQuotaSummary` on the daily Cloud Code host, then the standard Cloud Code host; render its four stable group/window buckets rather than individual model pools. Retain legacy model calls only when no summary is returned.
- Antigravity credential discovery: use `host.fs.firstExistingAppSupport` for the platform-native VS Code state database; do not infer credentials from `.gemini/antigravity` conversation files. On Windows, read `agy`'s Go-keyring target as raw UTF-8 bytes; refresh only after Cloud Code returns `401`/`403`.
