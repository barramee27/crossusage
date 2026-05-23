## 2026-05-21

- Cross-platform plugin paths: added `host.fs.firstExistingAppSupport` / `firstExisting` in `crossusage-core` host API; updated Cursor, Windsurf, Kiro, Antigravity, Gemini (fnm/pnpm/linux node_modules), Ollama (Firefox/LibreWolf Linux profile roots).
- **Antigravity CLI fix:** `host.keychain.readGenericPassword` now uses platform keyring on Linux/Windows (zalando/go-keyring: `service=gemini`, `username=antigravity`); plugin parses `token.access_token` JSON from `agy`.
- Remaining macOS-only by design or upstream: Perplexity (Mac app cache), Ollama keychain session on macOS.
- User-facing fixes still uncommitted on branch: settings duplicate Usage Alerts removed, notification permission, global shortcut Super label.
