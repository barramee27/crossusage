## 2026-06-27

- Merged `feat/linux-windows-native-support` (#6 security) into Modern UI PR #7; resolved `server.rs` + breadcrumbs conflicts.
- Security on release base: JSON error escaping, provider_accounts `0600`, plugin `..` guard; browser cross-origin block (no bearer auth).

## 2026-06-21

- Cross-platform plugin paths: added `host.fs.firstExistingAppSupport` / `firstExisting` in `crossusage-core` host API; updated Cursor, Windsurf, Kiro, Antigravity, Gemini (fnm/pnpm/linux node_modules), Ollama (Firefox/LibreWolf Linux profile roots).
- **Antigravity CLI fix:** `host.keychain.readGenericPassword` now uses platform keyring on Linux/Windows (zalando/go-keyring: `service=gemini`, `username=antigravity`); plugin parses `token.access_token` JSON from `agy`.
- Remaining macOS-only by design or upstream: Perplexity (Mac app cache), Ollama keychain session on macOS.
- v0.6.26→1.0.11 merge: restored fork `plugins/cursor/plugin.js` (Linux `~/.config/Cursor/...` via `firstExistingAppSupport`); Devin multi-path credentials; merged `tray-primary-progress` (`trayLines` + `preferWeeklyLimit`).
- Usage history + ccusage merge: `host.usageDaily.ingest` persists ccusage `daily[]` into SQLite (`usage_daily`); Settings shows **Quota over time** + **Daily tokens (local logs)** under same toggle; Claude/Codex plugins call ingest after ccusage.
- **1.2.0 polish**: tray top insight line, `GET /v1/insights`, history retention setting, API docs.
- **Upstream #612** ported: Devin weekly-from-daily quota uses `buildQuotaLine` (remaining→used).
- **OpenUsage 0.7 port**: Modern UI + dual `uiLayout`; #613–#615 done; ship as 1.2.0 with insights after QA.
