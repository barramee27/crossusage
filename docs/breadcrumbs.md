## 2026-05-21

- Cross-platform plugin paths: added `host.fs.firstExistingAppSupport` / `firstExisting` in `crossusage-core` host API; updated Cursor, Windsurf, Kiro, Antigravity, Gemini (fnm/pnpm/linux node_modules), Ollama (Firefox/LibreWolf Linux profile roots).
- **Antigravity CLI fix:** `host.keychain.readGenericPassword` now uses platform keyring on Linux/Windows (zalando/go-keyring: `service=gemini`, `username=antigravity`); plugin parses `token.access_token` JSON from `agy`.
- Remaining macOS-only by design or upstream: Perplexity (Mac app cache), Ollama keychain session on macOS.
- User-facing fixes still uncommitted on branch: settings duplicate Usage Alerts removed, notification permission, global shortcut Super label.
- v0.6.26→1.0.11 merge (local, not pushed): restored fork `plugins/cursor/plugin.js` (Linux `~/.config/Cursor/...` via `firstExistingAppSupport`); Devin multi-path credentials; merged `tray-primary-progress` (`trayLines` + `preferWeeklyLimit`); vitest 1325/1325 green.
- Usage history + ccusage merge: `host.usageDaily.ingest` persists ccusage `daily[]` into SQLite (`usage_daily`); Settings shows **Quota over time** + **Daily tokens (local logs)** under same toggle; Claude/Codex plugins call ingest after ccusage.

## 2026-05-21 (evening)

- **1.2.0 polish** committed on `feat/release-1.2.0-insights-polish`: tray top insight line, `GET /v1/insights`, history retention setting, API docs.
- **Upstream #612** ported: Devin weekly-from-daily quota uses `buildQuotaLine` (remaining→used); Codex JS already had badge after ccusage — regression test added.
- `feat/port-openusage-0.7-prep` fast-forwarded to same HEAD (prep + 1.2.0 work together until 0.7 GA → 1.1.1, then ship 1.2.0 ~7d later).
- **Linux arm64:** `install.sh` + `build-cli-tarball.sh` / portable tarball support `aarch64`; `build-all-artifacts.sh` builds amd64 deb/rpm/AppImage on x86_64 host only. Updater `.sig` + `latest.json` today: **deb + NSIS setup** — AppImage/RPM not in signing script; document for users until Tauri updater targets exist.
- **Still todo on prep:** Swift rewrites #613–#615, beta.2 pre-pin stats; blocked on OpenUsage `v0.7.0` GA for 1.1.1 tag.
