## 2026-05-21

- Cross-platform plugin paths: added `host.fs.firstExistingAppSupport` / `firstExisting` in `crossusage-core` host API; updated Cursor, Windsurf, Kiro, Antigravity, Gemini (fnm/pnpm/linux node_modules), Ollama (Firefox/LibreWolf Linux profile roots).
- **Antigravity CLI fix:** `host.keychain.readGenericPassword` now uses platform keyring on Linux/Windows (zalando/go-keyring: `service=gemini`, `username=antigravity`); plugin parses `token.access_token` JSON from `agy`.
- Remaining macOS-only by design or upstream: Perplexity (Mac app cache), Ollama keychain session on macOS.
- User-facing fixes still uncommitted on branch: settings duplicate Usage Alerts removed, notification permission, global shortcut Super label.
- v0.6.26→1.0.11 merge (local, not pushed): restored fork `plugins/cursor/plugin.js` (Linux `~/.config/Cursor/...` via `firstExistingAppSupport`); Devin multi-path credentials; merged `tray-primary-progress` (`trayLines` + `preferWeeklyLimit`); vitest 1325/1325 green.
- Usage history + ccusage merge: `host.usageDaily.ingest` persists ccusage `daily[]` into SQLite (`usage_daily`); Settings shows **Quota over time** + **Daily tokens (local logs)** under same toggle; Claude/Codex plugins call ingest after ccusage.
