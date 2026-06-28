# Changelog

**CrossUsage** ships **1.x** releases from [github.com/barramee27/crossusage](https://github.com/barramee27/crossusage). Older **0.6.x** sections below are **archived OpenUsage upstream** notes, not CrossUsage release numbers.

## 1.2.0

**Theme:** Modern UI + insights — OpenUsage 0.7 layout port with bundled usage insights.

### New features

- **Modern UI layout** (`classic` | `modern`): grouped dashboard, customizable metric cards (show/hide/reorder).
- **Usage insights banner** v2 on home + tray toggle; `GET /v1/insights` local API.
- **Usage history charts** and rolling rollups on provider detail.
- **Log level control** (Settings → Troubleshooting): Error through Off; default Info.
- **Tray icon** shows provider logo + remaining % text.

### Security

- Block cross-site browser access to local API (`Sec-Fetch-Site`, `Origin`); no CORS.
- `provider_accounts.json` written with `0600` on Unix.
- Plugin path traversal guard (`..`) in host API.

---

## 1.1.0

**Theme:** Know before you run out — local-only insights on probe + history data.

### New features (fork)

- **Usage insights banner** on the home panel: behind-pace providers, tightest remaining quota, and next reset.
- **Pace burn-rate alerts** for the primary progress line (low remaining % and projected to run out before reset).
- **Rolling 7-day rollup** of tokens and estimated spend from local `usage_daily` history.
- **Cursor MTD usage** line from dashboard CSV export on the Cursor card (45-minute in-memory cache).
- **Insights banner v2:** click insight → open provider, dismiss rows, split token/cost deltas, 30-day rollup, 7-day sparkline.
- **History export** (Settings) and **local API** `GET /v1/history/quota` + `GET /v1/history/daily`.
- **Cursor billing table** on provider detail (GUI parity with `crossusage-cli usage-stats`).
- **Spend spike alert** when 7-day estimated local spend jumps vs prior week (opt-in).
- **Cursor Nightly** as a separate provider (`cursor-nightly`) with its own install path and icon.
- **Provider list** sorted A–Z by display name in Settings and navigation.

### Ports from [OpenUsage v0.6.27](https://github.com/robinebers/openusage/releases/tag/v0.6.27)

- **Devin:** support auth from the Devin - Next app ([#554](https://github.com/robinebers/openusage/pull/554)).
- **macOS panel:** clamp to visible screen when menu bar auto-hides ([#557](https://github.com/robinebers/openusage/pull/557)).
- **macOS keychain:** allow `readGenericPassword(service)` without account arg ([#559](https://github.com/robinebers/openusage/pull/559)).
- **Plugins:** remove retired Windsurf plugin from app data on startup ([#552](https://github.com/robinebers/openusage/pull/552)).

---

## 1.0.11

Ports **[OpenUsage v0.6.26](https://github.com/robinebers/openusage/releases/tag/v0.6.26)** while keeping CrossUsage fork UI (Linux/Windows native window, usage history, multi-account).

### New features (upstream v0.6.26)

- **Usage trend:** local usage trend chart and per-model usage percentages ([#542](https://github.com/robinebers/openusage/pull/542)).
- **Devin:** replace Windsurf provider with Devin ([#551](https://github.com/robinebers/openusage/pull/551)); Linux/Windows credential and app-state path discovery.

### Bug fixes (upstream v0.6.26)

- **Tray / Claude:** tray percentage fallback and Claude extra usage metric scope ([#548](https://github.com/robinebers/openusage/pull/548)).
- **Cursor:** handle free account pooled limit ([#544](https://github.com/robinebers/openusage/pull/544)).
- **UI:** scrollable provider rail ([#543](https://github.com/robinebers/openusage/pull/543)).

---

## 1.0.10

Ports **[OpenUsage v0.6.25](https://github.com/robinebers/openusage/releases/tag/v0.6.25)** while keeping CrossUsage fork UI (Linux/Windows native window, usage history, multi-account).

### New features (upstream v0.6.25)

- **Antigravity:** replace Gemini CLI plugin with agy Antigravity support ([#538](https://github.com/robinebers/openusage/pull/538)).
- **Tray:** copy log path action ([#541](https://github.com/robinebers/openusage/pull/541)).

### Bug fixes (upstream v0.6.25)

- **Grok:** refresh expired auth tokens ([#540](https://github.com/robinebers/openusage/pull/540)).
- **MiniMax:** prefer displayable CN usage rows ([#539](https://github.com/robinebers/openusage/pull/539)); `token_plan` API endpoints ([#534](https://github.com/robinebers/openusage/pull/534)).
- **Security:** patch critical/high vulnerabilities ([#537](https://github.com/robinebers/openusage/pull/537)).

### Refactor (upstream v0.6.25)

- Debounced usage API cache writes, bounded local HTTP API concurrency, capped concurrent plugin probes (4 workers), per-probe runtime deadline, skip in-flight auto-update probes, pause refresh ticker while panel hidden ([#498](https://github.com/robinebers/openusage/pull/498)–[#503](https://github.com/robinebers/openusage/pull/503)).

---

## v0.6.26 (archived upstream)

### New Features
- Add local usage trend chart and per-model usage percentages ([#542](https://github.com/robinebers/openusage/pull/542)) by @rohithgoud30
- Replace Windsurf provider with Devin ([#551](https://github.com/robinebers/openusage/pull/551)) by @robinebers

### Bug Fixes
- Fix tray percentage fallback and Claude extra usage metric scope ([#548](https://github.com/robinebers/openusage/pull/548)) by @krismolendyke
- Handle Cursor free account pooled limit ([#544](https://github.com/robinebers/openusage/pull/544)) by @rohithgoud30
- Make provider rail scrollable ([#543](https://github.com/robinebers/openusage/pull/543)) by @rohithgoud30

### Chores
- Rename Devin weekly quota label by @robinebers

---

## v0.6.25 (archived upstream)

### New Features
- Replace Gemini CLI with agy Antigravity support ([#538](https://github.com/robinebers/openusage/pull/538)) by @robinebers
- Add tray action to copy log path ([#541](https://github.com/robinebers/openusage/pull/541)) by @robinebers

### Bug Fixes
- fix(grok): refresh expired auth tokens ([#540](https://github.com/robinebers/openusage/pull/540)) by @robinebers
- fix(minimax): prefer displayable CN usage rows ([#539](https://github.com/robinebers/openusage/pull/539)) by @robinebers
- Update MiniMax API endpoint from coding_plan to token_plan ([#534](https://github.com/robinebers/openusage/pull/534)) by @doublezz10
- fix: patch critical/high vulnerabilities ([#537](https://github.com/robinebers/openusage/pull/537)) by @devin-ai-integration

### Refactor
- Debounce usage API cache writes ([#503](https://github.com/robinebers/openusage/pull/503)) by @zergzorg
- Bound local HTTP API concurrency ([#502](https://github.com/robinebers/openusage/pull/502)) by @zergzorg
- Cap concurrent plugin probes per batch ([#499](https://github.com/robinebers/openusage/pull/499)) by @zergzorg
- Add per-probe runtime deadline ([#500](https://github.com/robinebers/openusage/pull/500)) by @zergzorg
- Skip auto-update probes already in flight ([#498](https://github.com/robinebers/openusage/pull/498)) by @zergzorg
- Pause ticker while panel is hidden ([#490](https://github.com/robinebers/openusage/pull/490)) by @zergzorg

### Chores
- Stabilize ccusage timeout cleanup test ([#501](https://github.com/robinebers/openusage/pull/501)) by @zergzorg
- chore(deps): bump rquickjs from 0.11.0 to 0.12.0 in /src-tauri by @dependabot
- chore(deps): bump tauri-plugin-global-shortcut from 2.3.1 to 2.3.2 in /src-tauri by @dependabot
- chore(deps): bump reqwest from 0.13.3 to 0.13.4 in /src-tauri by @dependabot
- chore(deps): bump uuid from 1.23.1 to 1.23.2 in /src-tauri by @dependabot
- chore(deps): bump log from 0.4.29 to 0.4.30 in /src-tauri by @dependabot
- chore(deps): bump tokio from 1.52.1 to 1.52.3 in /src-tauri by @dependabot
- chore(deps): bump tauri from 2.11.1 to 2.11.2 in /src-tauri by @dependabot
- chore(deps): bump serde_json from 1.0.149 to 1.0.150 in /src-tauri by @dependabot
- chore(deps): bump tauri-plugin-opener from 2.5.3 to 2.5.4 in /src-tauri by @dependabot
- chore(deps): bump tauri-build from 2.6.1 to 2.6.2 in /src-tauri by @dependabot

---

### Changelog

**Full Changelog**: [v0.6.24...v0.6.25](https://github.com/robinebers/openusage/compare/v0.6.24...v0.6.25)

- [2fa079a](https://github.com/robinebers/openusage/commit/2fa079a700a14a67736f254084813af3ca7c7922) Replace Gemini CLI with agy Antigravity support by @robinebers
- [f33e6c0](https://github.com/robinebers/openusage/commit/f33e6c09943677f03831777e289117226ea9cb1a) Add tray action to copy log path by @robinebers
- [c063e54](https://github.com/robinebers/openusage/commit/c063e54f4a4f5c88de7d050dcf5dcf670dba7272) fix(grok): refresh expired auth tokens by @robinebers
- [8fc2165](https://github.com/robinebers/openusage/commit/8fc21651c75e5581523e2764ef245480d9d691ed) fix(minimax): prefer displayable CN usage rows by @robinebers
- [94ddf1a](https://github.com/robinebers/openusage/commit/94ddf1a7a226d65a6fdefebb6f53427d1a3f4e8b) Update MiniMax API endpoints from coding_plan to token_plan by @doublezz10
- [41d6716](https://github.com/robinebers/openusage/commit/41d67161883392dcb25a5e0010068ec3976f5ee8) chore(deps): bump rquickjs from 0.11.0 to 0.12.0 in /src-tauri by @dependabot
- [84b99e0](https://github.com/robinebers/openusage/commit/84b99e0a531a4150846a329fdd930946b6887c0e) chore(deps): bump tauri-plugin-global-shortcut from 2.3.1 to 2.3.2 in /src-tauri by @dependabot
- [dd8f8b1](https://github.com/robinebers/openusage/commit/dd8f8b1d5cb5d508da6b7f9c8b94443c8fb12c85) chore(deps): bump reqwest from 0.13.3 to 0.13.4 in /src-tauri by @dependabot
- [bf277f8](https://github.com/robinebers/openusage/commit/bf277f861c3a8067c3455d233135884628696e8c) chore(deps): bump uuid from 1.23.1 to 1.23.2 in /src-tauri by @dependabot
- [c6adbcc](https://github.com/robinebers/openusage/commit/c6adbcce3ab69b89bc18f81499f956663f8083b0) chore(deps): bump log from 0.4.29 to 0.4.30 in /src-tauri by @dependabot
- [52f5588](https://github.com/robinebers/openusage/commit/52f5588d7a8169f46e3e4d90bdfe93c7140f6d0c) fix: patch critical/high vulnerabilities by @devin-ai-integration
- [810b122](https://github.com/robinebers/openusage/commit/810b1226119c5ee66ac1d479e2a98ee70cce2cda) Debounce usage API cache writes by @zergzorg
- [ce7f682](https://github.com/robinebers/openusage/commit/ce7f68248a1b91e3c32756d2c3d58aa5c6579372) Bound local HTTP API concurrency by @zergzorg
- [d44008f](https://github.com/robinebers/openusage/commit/d44008f32a068494274bb400e4b95d333c7b2775) Pause ticker while panel is hidden by @zergzorg
- [a291696](https://github.com/robinebers/openusage/commit/a2916962c7c4a4dcd473d45b9449095e1aae3b3e) Skip auto-update probes already in flight by @zergzorg
- [f0e2914](https://github.com/robinebers/openusage/commit/f0e2914ff7cd03058b5debc1d1b6f949160dde9a) Stabilize ccusage timeout cleanup test by @zergzorg
- [9a9f01d](https://github.com/robinebers/openusage/commit/9a9f01df604d1da3625467c7c6c2f9551dcda46f) Add per-probe runtime deadline by @zergzorg
- [abc68e8](https://github.com/robinebers/openusage/commit/abc68e85e9a35fcbb552cf5491c930da184247c2) Cap concurrent plugin probes per batch by @zergzorg
- [5de48f1](https://github.com/robinebers/openusage/commit/5de48f1c187f72f3542432270899b614ac38fa8a) chore(deps): bump tokio from 1.52.1 to 1.52.3 in /src-tauri by @dependabot
- [ba0c01d](https://github.com/robinebers/openusage/commit/ba0c01d043652bcf6a6841757bc7a02937176888) chore(deps): bump tauri from 2.11.1 to 2.11.2 in /src-tauri by @dependabot
- [e523c7b](https://github.com/robinebers/openusage/commit/e523c7b2b74b3883c84d7b5809815506a59b8dd6) chore(deps): bump serde_json from 1.0.149 to 1.0.150 in /src-tauri by @dependabot
- [d61df10](https://github.com/robinebers/openusage/commit/d61df10e9eae37fa8e4b82ed5e8a491a54922ed2) chore(deps): bump tauri-plugin-opener from 2.5.3 to 2.5.4 in /src-tauri by @dependabot
- [6257fc9](https://github.com/robinebers/openusage/commit/6257fc9cd3c4142a371f716c2760c5b43e28f32c) chore(deps): bump tauri-build from 2.6.1 to 2.6.2 in /src-tauri by @dependabot

## v0.6.24

### New Features
- feat: add Grok usage plugin ([#484](https://github.com/robinebers/openusage/pull/484)) by @robinebers
- feat: add 12h/24h/auto time format setting ([#427](https://github.com/robinebers/openusage/pull/427)) by @HDash

### Bug Fixes
- fix(ui): improve pace marker visibility on usage bars ([#485](https://github.com/robinebers/openusage/pull/485)) by @robinebers
- fix(claude): prefer keychain credentials ([#483](https://github.com/robinebers/openusage/pull/483)) by @robinebers
- fix(ccusage): add release-age fallback for costs ([#482](https://github.com/robinebers/openusage/pull/482)) by @robinebers
- fix(codex): trust zero-credit usage response ([#481](https://github.com/robinebers/openusage/pull/481)) by @robinebers
- fix(ccusage): resolve nvm node bin path from alias/default ([#463](https://github.com/robinebers/openusage/pull/463)) by @devKagan
- fix(perplexity): handle missing group in API response ([#462](https://github.com/robinebers/openusage/pull/462)) by @malhobayyeb

### Chores
- chore(grok): move pay-as-you-go badge to detail scope by @robinebers
- chore(deps): bump tauri from 2.11.0 to 2.11.1 in /src-tauri by @dependabot
- chore(deps): bump tauri-plugin-store from 2.4.2 to 2.4.3 in /src-tauri by @dependabot
- chore(deps): bump libc from 0.2.184 to 0.2.186 in /src-tauri by @dependabot
- chore(deps): bump sha2 from 0.10.9 to 0.11.0 in /src-tauri by @dependabot
- chore: enforce package release age by @robinebers

---

### Changelog

**Full Changelog**: [v0.6.23...v0.6.24](https://github.com/robinebers/openusage/compare/v0.6.23...v0.6.24)

- [6fc6cd0](https://github.com/robinebers/openusage/commit/6fc6cd0d323d9863399f27a8018b87b2b8983ee0) chore(grok): move pay-as-you-go badge to detail scope by @robinebers
- [38786d0](https://github.com/robinebers/openusage/commit/38786d021b16247e41960b83fd054302b2db93ea) fix(ccusage): add release-age fallback for costs by @robinebers
- [7c83829](https://github.com/robinebers/openusage/commit/7c83829a6319f9b1b86d76bca388401e5ebca9ff) fix(codex): trust zero-credit usage response by @robinebers
- [eb7eaf7](https://github.com/robinebers/openusage/commit/eb7eaf7e5136437e79da7cf36c974afa94ea2a07) fix(claude): prefer keychain credentials by @robinebers
- [2a5605d](https://github.com/robinebers/openusage/commit/2a5605dd41ec6bc2bc545d7d5cab4ec6ddddb0c5) feat: add Grok usage plugin by @robinebers
- [8d2d51c](https://github.com/robinebers/openusage/commit/8d2d51c799cc27bee580f7be527d49ff2ff62f43) fix(ui): improve pace marker visibility on usage bars by @robinebers
- [41c2d79](https://github.com/robinebers/openusage/commit/41c2d79ea2fff927d44ca32309c1c6205d990176) fix(ccusage): resolve nvm node bin path from alias/default by @devKagan
- [f847b24](https://github.com/robinebers/openusage/commit/f847b247472c338be88ead07b37bd98743e22bae) fix(perplexity): handle missing group in API response by @malhobayyeb
- [88de6bd](https://github.com/robinebers/openusage/commit/88de6bd10ede77f81990bd9c1018d07ccc255225) feat: add 12h/24h/auto time format setting by @HDash
- [1ce87c1](https://github.com/robinebers/openusage/commit/1ce87c15c82f253da567fb816d070f3d24f255f9) chore(deps): bump tauri from 2.11.0 to 2.11.1 in /src-tauri by @dependabot
- [59a18e2](https://github.com/robinebers/openusage/commit/59a18e2c2b945a7b4cd5af4a55d546c7d4cf6485) chore(deps): bump sha2 from 0.10.9 to 0.11.0 in /src-tauri by @dependabot
- [83bc08e](https://github.com/robinebers/openusage/commit/83bc08e9a130eb0db5d20cc25df6eb298d541413) chore(deps): bump tauri-plugin-store from 2.4.2 to 2.4.3 in /src-tauri by @dependabot
- [047092e](https://github.com/robinebers/openusage/commit/047092edd56b09794d1be81d4080cf6aa4d718db) chore(deps): bump libc from 0.2.184 to 0.2.186 in /src-tauri by @dependabot
- [de22ad6](https://github.com/robinebers/openusage/commit/de22ad6540d4b23aae0d1f5dac723ed52d44c801) chore: enforce package release age by @robinebers

## v0.6.23

## 1.0.9

Stable **1.0.9** — merges **upstream [OpenUsage v0.6.24](https://github.com/robinebers/openusage/releases/tag/v0.6.24)** on **feat/linux-windows-native-support** (tray, usage history, multi-account, Linux/Windows native window). Release bundles: Linux `.deb`; Windows `crossusage.exe` + NSIS `crossusage_1.0.9_x64-setup.exe` (+ `WebView2Loader.dll` for portable folder layout).

### New features (upstream v0.6.24)

- **Grok** usage plugin — credits used, plan, pay-as-you-go cap ([#484](https://github.com/robinebers/openusage/pull/484)).
- **Time format** setting — 12h / 24h / auto ([#427](https://github.com/robinebers/openusage/pull/427)).

### Bug fixes (upstream v0.6.24)

- **UI:** pace marker visibility on usage bars ([#485](https://github.com/robinebers/openusage/pull/485)).
- **Claude:** prefer keychain credentials ([#483](https://github.com/robinebers/openusage/pull/483)).
- **ccusage:** release-age fallback for costs ([#482](https://github.com/robinebers/openusage/pull/482)).
- **Codex:** trust zero-credit usage response ([#481](https://github.com/robinebers/openusage/pull/481)).
- **ccusage:** resolve NVM node bin path from alias/default ([#463](https://github.com/robinebers/openusage/pull/463)).
- **Perplexity:** handle missing group in API response ([#462](https://github.com/robinebers/openusage/pull/462)).

### Chores (upstream v0.6.24)

- **Grok:** pay-as-you-go badge on detail scope only.
- **Deps:** Tauri **2.11.1**, `tauri-plugin-store` **2.4.3**, `libc` **0.2.186**, `sha2` **0.11.0**; package release-age enforcement for ccusage.

### App (fork, since 1.0.9-beta.1)

- Usage history, tray, multi-account, Linux/Windows framed window — see **1.0.9-beta.1** below.
- **Frontend:** restore settings bootstrap / onboarding wiring after upstream merge (fixes blank UI on `tauri:dev`).
- **Linux/Windows:** cross-platform keyring read/write; **Antigravity CLI** OAuth refresh; notification sounds (paplay / SystemSounds).
- **Windows:** Credential Manager target `gemini:antigravity` for `agy`; hide PowerShell window for alert sounds (may still flash briefly on some systems — see release notes).
- **In-app updates:** Tauri updater signing enabled (`latest.json` + `.sig` on installer bundles); portable onefile is manual download only.

## 1.0.9-beta.1

Pre-release for testing ([crossusage.dev](https://crossusage.dev/) / portable builds) — merges **upstream OpenUsage `main` through [v0.6.23](https://github.com/robinebers/openusage/releases/tag/v0.6.23)** plus post-release `chore: enforce package release age`, on top of fork **feat/linux-windows-native-support** (tray, usage history, multi-account, Linux/Windows).

### App

- **Usage history (optional):** Settings → *Usage history* — local SQLite (`usage_history.sqlite3` in app data) stores normalized snapshots after successful probes when enabled; ~32s debounce per account; clear from Settings. Not uploaded by CrossUsage.
- **Updates:** When an update has downloaded, the footer replaces **CrossUsage `<version>`** with **Ready to update** (click to restart and install). No separate Settings section or “check for updates” control—tray **Restart to update** still applies the pending build.
- **Tray:** Dynamic tray icons pick **white or black** raster ink from the **system** dark/light preference, independent of CrossUsage App Theme; provider PNG logos are unchanged. Indicator placement on GNOME is shell-controlled.
- **Glass:** stronger panel, nav, and card opacity so text stays readable over terminal/editor backgrounds.
- **Cursor:** Default tray **percentage / bars primary line** is **Total usage** (not Credits), via `primaryOrder` in the Cursor plugin manifest. Custom tray line selections in Settings are unchanged.
- **Windows / Linux:** Default panel size increased from **380×700** to **600×800** logical px so Settings and provider views stay readable (resolution/display scaling does not widen a fixed window).

### Upstream parity ([OpenUsage v0.6.23](https://github.com/robinebers/openusage/releases/tag/v0.6.23))

- **Claude (plugin):** Removed PromoClock / “Peak Hours” supplemental badge and `promoclock.co` fetch; docs trimmed accordingly.
- **Codex (plugin):** “Usage dashboard” link now points to ChatGPT Codex usage (`https://chatgpt.com/codex/settings/usage`).
- **Analytics:** Dropped UI-side Aptabase custom events (`provider_refreshed`, `providers_reordered`, `setting_changed`, `update_accepted`, `provider_toggled`); removed `@aptabase/tauri` from the frontend bundle (Rust may still emit lifecycle events such as `app_started`).

### Fix

- **Windows portable / GNU:** Added a **single-file** portable exe build (`release:gui-portable-onefile-windows-gnu`) where **crossusage.exe** embeds the Tauri GUI, CLI, resources, and **WebView2Loader.dll**, extracts them to temp, then starts the GUI. Optional unique output names: `release:gui-portable-onefile-windows-gnu:unique`, `CROSSUSAGE_ONEFILE_TAG`, or `CROSSUSAGE_UNIQUE_ONEFILE=1`. The zip build still supports the folder layout. NSIS installer unchanged.
- **Windows startup:** Windows release builds now show the main window on launch instead of relying only on the tray icon, and tray startup falls back to an embedded tray icon if the packaged resource is missing.

## 1.0.8

Stable **1.0.8** — version bump (`package.json`, Tauri config, `crossusage`, `crossusage-cli`, `crossusage-core`). Release bundles: Linux `.deb`, `.rpm`, `.AppImage`; Windows `crossusage.exe` and NSIS `crossusage_1.0.8_x64-setup.exe` (from `scripts/build-all-artifacts.sh` on Linux with GNU Windows target + NSIS).

## 1.0.8-beta.1

Pre-release **1.0.8-beta.1** — version bump only (`package.json`, Tauri config, `crossusage`, `crossusage-cli`, `crossusage-core`). Portable / onefile Windows builds use this label for testing before **1.0.8** stable.

## 1.0.7

### App

- Version **1.0.7** (`package.json`, Tauri config, `crossusage`, `crossusage-cli`, `crossusage-core`).

### Upstream parity ([OpenUsage v0.6.21](https://github.com/robinebers/openusage/releases/tag/v0.6.21)–[v0.6.22](https://github.com/robinebers/openusage/releases/tag/v0.6.22))

Ports [v0.6.20…v0.6.22](https://github.com/robinebers/openusage/compare/v0.6.20...v0.6.22) into the shared host and plugins (Linux/Windows get the non–macOS-specific parts):

- **ccusage (Rust host):** on timeout, kill the **child process group** on Unix (`process_group` + `kill(-pgid, SIGKILL)`), with fallback `child.kill()`; **TimedOut** skips remaining runners; **one concurrent query per provider** (Claude vs Codex); expand home paths and redact runner paths in logs ([#433](https://github.com/robinebers/openusage/pull/433)).
- **Claude (plugin):** macOS keychain service names that include a **hashed** `CLAUDE_CONFIG_DIR` suffix; hash only when that env var is set ([#423](https://github.com/robinebers/openusage/issues/423), [#424](https://github.com/robinebers/openusage/pull/424)).
- **Codex (plugin):** lazy-load keychain auth fallback; `docs/providers/codex.md` wording.
- **Deps:** Tauri **2.11.x**, `@tauri-apps/api` **2.11.x**, **reqwest** **0.13.3**; bundled plugins refreshed.

### Fix

- **About → Release notes:** loads GitHub releases from **this fork** (`barramee27/crossusage`), not upstream OpenUsage; “full changelog” / “View all releases” open the fork’s releases page.

## 1.0.6

### App

- Version **1.0.6** (`package.json`, Tauri config, `crossusage`, `crossusage-cli`, `crossusage-core`).
- **Linux / Windows UI:** Root flex layout so the main provider list **scrolls** under native window chrome (bounded height chain + scroll region `flex-1 min-h-0`).
- **Upstream port (OpenUsage v0.6.16–v0.6.20):** preserve usage data during refresh (stale-while-revalidate); factory GET retry on HTTP **405**; read OAuth tokens from unified state key; Antigravity OAuth refresh only on auth failure; Z.ai shell/env noise fixes; Gemini OAuth refresh for non-default install layouts; Codex **Pro 20x** label + auth fallback; `uuid` / `tokio` bumps; host API `dbTokens` naming in probe path.
- **Antigravity (fork):** **Linux + Windows** — discover `state.vscdb` under `%APPDATA%`, `$XDG_CONFIG_HOME`, `~/.config`, and Library-style paths; LS discovery matches `**language_server*`** with Antigravity markers (fixes false “Start Antigravity” on Linux).

## 1.0.5

### App

- Version **1.0.5** (`package.json`, Tauri config, `crossusage`, `crossusage-cli`, and `crossusage-core` Cargo packages).
- Ports upstream OpenUsage **v0.6.15**; details under **Upstream changes incorporated** below.
- **Linux / Windows:** native window frame (title bar, taskbar, minimize/maximize); tray arrow and in-window close only on **macOS**; no blur-to-hide on Linux/Windows.
- **Linux / Windows:** window is **resizable** with a sensible minimum size; frontend no longer forces outer `setSize` on every layout change (that blocked manual resize).
- **Build:** `tsconfig.json` — valid `ignoreDeprecations` value for TypeScript 5.9 (`tsc` / `tauri build`).

### Upstream changes incorporated (OpenUsage v0.6.15)

Merged from [robinebers/openusage v0.6.15](https://github.com/robinebers/openusage/releases/tag/v0.6.15) ([compare v0.6.14…v0.6.15](https://github.com/robinebers/openusage/compare/v0.6.14...v0.6.15)):

- **Claude:** Claude Design weekly detail metric ([#388](https://github.com/robinebers/openusage/pull/388)).
- **Claude:** graceful HTTP 429 handling with `Retry-After` ([#378](https://github.com/robinebers/openusage/pull/378)).
- **Codex:** plan labels mapped to **Pro 5x** and **Pro 10x** ([#380](https://github.com/robinebers/openusage/pull/380)).
- **Settings:** Base UI plugin enable checkbox — stop internal `click()` bubbling (upstream double-toggle fix).
- **Docs / tooling:** `docs/providers/claude.md`, README star-history chart, `.codex/environments/environment.toml`, `CLAUDE.md`.

### Install & CI

- **Windows `[scripts/install.ps1](scripts/install.ps1)`:** `**INSTALL_MODE=cli`** — prefers the **latest GitHub Release** asset matching `crossusage-cli_*_windows_<arch>.zip` (or `.tar.gz`), then falls back to `releases/` on the branch. Extracts to `%USERPROFILE%\.local\lib\crossusage` and adds `%USERPROFILE%\.local\bin` (with `crossusage-cli.cmd` shim). `**[scripts/build-cli-windows.ps1](scripts/build-cli-windows.ps1)`** builds the zip for publishing.
- **Linux → Windows CLI zip:** `**[scripts/build-cli-zip-windows-gnu.sh](scripts/build-cli-zip-windows-gnu.sh)`** cross-compiles `x86_64-pc-windows-gnu` and zips for `releases/`. `**[.cargo/config.toml](.cargo/config.toml)`** sets the MinGW linker.
- **Windows GUI builds in CI:** `[.github/workflows/windows-gui.yml](.github/workflows/windows-gui.yml)` — run **Actions → Windows GUI (Tauri) → Run workflow** to download NSIS `*x64-setup.exe`, `crossusage.exe`, and `crossusage-cli.exe` artifacts (no tag required).
- **Publish workflow:** `[.github/workflows/publish.yml](.github/workflows/publish.yml)` no longer runs on `**v*` tag push** (it targeted signed macOS DMGs and failed without Apple/Tauri secrets). It is `**workflow_dispatch` only**, with a required **tag** input, if you ever configure those secrets.
- **macOS CLI CI:** `[.github/workflows/macos-cli-tarball.yml](.github/workflows/macos-cli-tarball.yml)` — `**workflow_dispatch`** on `**macos-latest`**: `**bundle:plugins`**, `**build-cli-tarball.sh**`, verify tarball contains `**resources/bundled_plugins/**` (supports `**./resources/...**` from bsdtar), artifact `**crossusage-cli-darwin-arm64-tarball**`. Optional upload to latest GitHub Release. GUI (.dmg) is not built in this job (use local `tauri build` or `**publish.yml**` with signing secrets).

## 1.0.4

### App

- Version **1.0.4** (`package.json`, Tauri config, `crossusage`, `crossusage-cli`, and `crossusage-core` Cargo packages).

## 1.0.3

### App

- Version **1.0.3** (`package.json`, Tauri config, `crossusage`, `crossusage-cli`, and `crossusage-core` Cargo packages).

### Packaging

- **Portable GUI:** `[scripts/build-gui-portable-linux-tarball.sh](scripts/build-gui-portable-linux-tarball.sh)` (Linux `.tar.gz`), `[scripts/build-gui-portable-windows.ps1](scripts/build-gui-portable-windows.ps1)` (Windows `.zip`), `[scripts/build-gui-portable-zip-windows-gnu.sh](scripts/build-gui-portable-zip-windows-gnu.sh)` (same GUI `.zip` from Linux after `tauri build --target x86_64-pc-windows-gnu`), `[scripts/build-gui-portable-macos-tarball.sh](scripts/build-gui-portable-macos-tarball.sh)` (macOS `.tar.gz` of the `.app`). `[scripts/collect-release-artifacts.sh](scripts/collect-release-artifacts.sh)` collects these when present.
- **Portable CLI (Windows zip from Linux):** `[scripts/build-cli-zip-windows-gnu.sh](scripts/build-cli-zip-windows-gnu.sh)` — `**crossusage-cli.exe` + `resources/bundled_plugins` only** (no `crossusage.exe`). Install: `INSTALL_MODE=cli` / `install.ps1`.

## 1.0.2

### App

- Version **1.0.2** (`package.json`, Tauri config, `crossusage` / `crossusage-cli` Cargo packages).
- **Cursor** plugin: progress line label **Total usage** (replaces **All usage**). Saved tray line selections for either old label normalize to **Total usage**.

### Docs

- [Local HTTP API](docs/local-http-api.md): **curl** smoke-test section while the app is running.

## 1.0.0

### Fork branding

- **Renamed the app to CrossUsage** to avoid confusion with upstream [OpenUsage](https://github.com/robinebers/openusage) (still on the 0.6.x line). This repository is **barramee27/crossusage** — a cross-platform–focused fork.
- **Version 1.0.0** starts the fork’s own semver; it is not the same sequence as upstream releases.
- **App identifier** is now `com.barramee27.crossusage`. Settings and data may live under a new path on disk (fresh install or migrate manually from the old OpenUsage fork paths if needed).
- User-facing strings, About dialog, tray, and GitHub links point to this fork; release notes and changelog APIs use `barramee27/crossusage`.

### Developer / CLI

- **Cargo workspace** with `crossusage-core` (shared `plugin_engine` + path helpers) and `**crossusage-cli`** (`list`, `probe`, `--json` / `--plain`). The CLI ships in the **same** app bundle as the GUI (Tauri `externalBin`), e.g. `crossusage-cli` next to the main binary on Linux `.deb`.
- **Install scripts:** `[scripts/install.sh](scripts/install.sh)` (Linux: GitHub latest `.deb` / `.rpm` / AppImage; `**INSTALL_MODE=cli`** portable tarball; auto-repair when `.deb` lacks `crossusage-cli`; macOS message; Windows redirect), `[scripts/install.ps1](scripts/install.ps1)` (Windows NSIS), and `[scripts/build-cli-tarball.sh](scripts/build-cli-tarball.sh)` for release assets. Documented in [README](README.md) and [INSTALL.md](INSTALL.md).
- **CLI:** `crossusage-cli dashboard` — full-screen TUI (ratatui) with a multi-panel usage view (`q` / `Esc` to quit), optional JSONL history (`persist_history` in `~/.config/crossusage/config.toml`), and `**crossusage-cli export`** (`--format json|csv`, optional `--from-file` for JSONL).
- **CI:** GitHub Actions job **crossusage-cli** builds/tests the CLI on Linux, Windows, and macOS.
- **CLI:** `crossusage-cli daemon` — background polling with `**notify-rust`** desktop alerts when usage crosses `**--threshold-percent`** (default 85); `**--detach`** spawns a child and exits; optional `**--log-file**`.
- **CLI (btop-style refresh):** default command opens the **dashboard** (no subcommand); global flags `**--config`**, `**--theme`**, `**--refresh-sec**`, `**--no-mouse**`, `**--daemon**` (mutually exclusive with subcommands); `**probe**` defaults to JSON (`--human` for tables); `**list**` probes and shows usage columns; TUI adds **header** (clock, CPU/RAM, est. spend), **chart** pane, **probe progress** line, **quit confirm**, themes `**btop-rainbow`** / `**auto`**; panic hook **press any key to exit**.
- **Vitest**: global `testTimeout` raised to reduce flaky timeouts under parallel runs; `main.test.tsx` mocks entry deps and Tauri log to stabilize the bootstrap test.

### Included from prior fork work (summary)

- Cursor **Total usage** line label + tray line migration (later releases may rename labels; CrossUsage **1.0.2** uses **Total usage** again); provider card spacing; effective tray-line selection in Settings for all providers; `aes-gcm` on all platforms for Windows/cross-builds; build helper scripts.

---

## Archived upstream history (OpenUsage 0.6.x)

The `**## 0.6.11` and older** sections below are the **original [OpenUsage](https://github.com/robinebers/openusage) project changelog** (semver **0.6.x**). They are **not** CrossUsage release numbers.

---

## 0.6.11

### Changes

- Cursor: rename the **Total usage** metric to **All usage**; migrate saved tray line settings from the old label.
- UI: add vertical spacing between consecutive metric rows in provider cards.
- Build: depend on `aes-gcm` on all platforms (not Unix-only) so Windows / cross-compiles resolve the plugin host API.

## 0.6.10

### New Features

- Add OpenCode Go plugin with tracking and limits ([#270](https://github.com/robinebers/openusage/pull/270)) by @praveenjuge
- Show Max 5x/20x tier in plan badge (claude) ([#284](https://github.com/robinebers/openusage/pull/284)) by @DiogoDuart3

### Bug Fixes

- Bump ccusage to v18.0.10 ([#295](https://github.com/robinebers/openusage/pull/295)) by @robinebers
- Count daily active usage more accurately ([#294](https://github.com/robinebers/openusage/pull/294)) by @robinebers
- Accept percent-only free usage payloads (cursor) ([#269](https://github.com/robinebers/openusage/pull/269)) by @davidarny
- Prefer auth.encrypted over auth.json (factory) ([#268](https://github.com/robinebers/openusage/pull/268)) by @sudoanmol

### Chores

- Bump lucide-react from 0.575.0 to 0.577.0 ([#276](https://github.com/robinebers/openusage/pull/276)) by @dependabot
- Bump @vitejs/plugin-react from 5.2.0 to 6.0.1 ([#290](https://github.com/robinebers/openusage/pull/290)) by @dependabot
- Bump uuid from 1.21.0 to 1.22.0 in /src-tauri ([#275](https://github.com/robinebers/openusage/pull/275)) by @dependabot
- Bump vite from 7.3.1 to 8.0.0 ([#289](https://github.com/robinebers/openusage/pull/289)) by @dependabot

### Changelog

**Full Changelog**: [v0.6.9...v0.6.10](https://github.com/robinebers/openusage/compare/v0.6.9...v0.6.10)

- [50f577f](https://github.com/robinebers/openusage/commit/50f577f) fix(ccusage): bump to v18.0.10 (#295) by @robinebers
- [78b5270](https://github.com/robinebers/openusage/commit/78b5270) fix(analytics): count daily active usage more accurately (#294) by @robinebers
- [2aaadf0](https://github.com/robinebers/openusage/commit/2aaadf0) feat(opencode-go): add OpenCode Go plugin with tracking and limits (#270) by @praveenjuge
- [7bfc51d](https://github.com/robinebers/openusage/commit/7bfc51d) fix(cursor): accept percent-only free usage payloads (#269) by @davidarny
- [54f7bac](https://github.com/robinebers/openusage/commit/54f7bac) chore(deps): bump lucide-react from 0.575.0 to 0.577.0 (#276) by @dependabot
- [5a475ab](https://github.com/robinebers/openusage/commit/5a475ab) chore(deps-dev): bump @vitejs/plugin-react from 5.2.0 to 6.0.1 (#290) by @dependabot
- [3477cdf](https://github.com/robinebers/openusage/commit/3477cdf) chore(deps): bump uuid from 1.21.0 to 1.22.0 in /src-tauri (#275) by @dependabot
- [b0900bc](https://github.com/robinebers/openusage/commit/b0900bc) chore(deps-dev): bump vite from 7.3.1 to 8.0.0 (#289) by @dependabot
- [5339e08](https://github.com/robinebers/openusage/commit/5339e08) feat(claude): show Max 5x/20x tier in plan badge (#284) by @DiogoDuart3
- [a04c8ee](https://github.com/robinebers/openusage/commit/a04c8ee) Merge pull request #268 from sudoanmol/fix/factory-auth-path-order by @sudoanmol
- [a6c3e30](https://github.com/robinebers/openusage/commit/a6c3e30) test(factory): add regression test for auth.encrypted preference over stale auth.json by @sudoanmol
- [526d6ca](https://github.com/robinebers/openusage/commit/526d6ca) fix(factory): prefer auth.encrypted over auth.json by @sudoanmol

## 0.6.8

### New Features

- Auto-detect MiniMax CN/global endpoint and show region label ([#230](https://github.com/robinebers/openusage/pull/230)) by @FrankieeW
- Add Total usage, Auto usage, API usage metrics for Cursor ([#226](https://github.com/robinebers/openusage/pull/226)) by @robinebers
- Restore bars mode and simplify menubar options ([#234](https://github.com/robinebers/openusage/pull/234)) by @robinebers

### Bug Fixes

- Update About dialog with contributor credits and green icon ([#240](https://github.com/robinebers/openusage/pull/240)) by @robinebers
- Clarify Claude extra usage metric by renaming label to "Extra usage spent" ([#239](https://github.com/robinebers/openusage/pull/239)) by @app/copilot-swe-agent
- Centralize ccusage version pinning and add bump command ([#238](https://github.com/robinebers/openusage/pull/238)) by @robinebers
- Compact loading skeleton and dedupe line grouping ([#228](https://github.com/robinebers/openusage/pull/228)) by @davidarny
- Harden PATH enrichment and add regression tests ([#220](https://github.com/robinebers/openusage/pull/220)) by @robinebers

### Chores

- Remove outdated note about Windows/Linux testing from README by @robinebers
- Update .gitignore to include .vscode and .conductor directories by @robinebers
- Remove deprecated VSCode extensions configuration file by @robinebers

### Changelog

**Full Changelog**: [v0.6.7...v0.6.8](https://github.com/robinebers/openusage/compare/v0.6.7...v0.6.8)

- [10635c6](https://github.com/robinebers/openusage/commit/10635c6) chore: bump version to 0.6.8 by @robinebers
- [9aa5371](https://github.com/robinebers/openusage/commit/9aa5371) fix(ui): update About dialog with contributor credits and green icon (#240) by @robinebers
- [903e6b2](https://github.com/robinebers/openusage/commit/903e6b2) feat(minimax): auto-detect CN/global endpoint and region label (#230) by @FrankieeW
- [7bd1383](https://github.com/robinebers/openusage/commit/7bd1383) Clarify Claude extra usage metric by renaming label to "Extra usage spent" (#239) by @app/copilot-swe-agent
- [208eb2d](https://github.com/robinebers/openusage/commit/208eb2d) fix(ccusage): centralize version pinning and add bump command (#238) by @robinebers
- [49b0b59](https://github.com/robinebers/openusage/commit/49b0b59) feat(cursor): add Total usage, Auto usage, API usage metrics (#226) by @robinebers
- [c768281](https://github.com/robinebers/openusage/commit/c768281) feat(tray): restore bars mode and simplify menubar options (#234) by @robinebers
- [e58837b](https://github.com/robinebers/openusage/commit/e58837b) test: raise coverage and enforce global 90% thresholds (#219) by @robinebers
- [28d9014](https://github.com/robinebers/openusage/commit/28d9014) fix(ui): compact loading skeleton and dedupe line grouping (#228) by @davidarny
- [240df4e](https://github.com/robinebers/openusage/commit/240df4e) chore: remove outdated note about Windows/Linux testing from README by @robinebers
- [1755ed3](https://github.com/robinebers/openusage/commit/1755ed3) chore: update .gitignore to include .vscode and .conductor directories by @robinebers
- [d06cdf3](https://github.com/robinebers/openusage/commit/d06cdf3) chore: remove deprecated VSCode extensions configuration file by @robinebers
- [35a921f](https://github.com/robinebers/openusage/commit/35a921f) fix(ccusage): harden PATH enrichment and add regression tests (#220) by @robinebers

## 0.6.7

### New Features

- Add right-click context menu to sidebar plugin icons to remove a provider without going to settings ([#197](https://github.com/robinebers/openusage/pull/197)) by @MariosPapadakis
- Simplify menubar icon to provider + percentage ([#215](https://github.com/robinebers/openusage/pull/215)) by @robinebers
- Show deficit percentage and runs-out ETA below progress bars ([#212](https://github.com/robinebers/openusage/pull/212)) by @robinebers
- Add sqlite-first auth with keychain fallback for Cursor ([#210](https://github.com/robinebers/openusage/pull/210)) by @robinebers

### Bug Fixes

- Bump ccusage to v18.0.6 for GPT 5.3 Codex pricing fix ([#218](https://github.com/robinebers/openusage/pull/218)) by @robinebers
- Correct MiniMax API endpoint and treat usage_count as remaining prompts ([#217](https://github.com/robinebers/openusage/pull/217)) by @davidarny

### Refactor

- Split monolithic App into focused hooks and atomic stores ([#209](https://github.com/robinebers/openusage/pull/209)) by @davidarny

### Chores

- Add test cases for handling tiny deficits in formatting and display ([#216](https://github.com/robinebers/openusage/pull/216)) by @validatedev
- Compact token usage text lines (Today/Yesterday/Last 30 Days) ([#211](https://github.com/robinebers/openusage/pull/211)) by @davidarny
- Increase test coverage back to over 90% ([#207](https://github.com/robinebers/openusage/pull/207)) by @robinebers

---

### Changelog

**Full Changelog**: [v0.6.6...v0.6.7](https://github.com/robinebers/openusage/compare/v0.6.6...v0.6.7)

- [3032c24](https://github.com/robinebers/openusage/commit/3032c24) feat: add right-click context menu to sidebar plugin icons order to be able to remove a provider without going to the settings. (#197) by @MariosPapadakis
- [a10ed10](https://github.com/robinebers/openusage/commit/a10ed10) fix: bump ccusage to v18.0.6 for GPT 5.3 Codex pricing fix (#218) by @robinebers
- [9cc62e6](https://github.com/robinebers/openusage/commit/9cc62e6) feat(tray): simplify menubar icon to provider + percentage (#215) by @robinebers
- [51dd686](https://github.com/robinebers/openusage/commit/51dd686) fix(minimax): correct API endpoint and treat usage_count as remaining prompts (#217) by @davidarny
- [b6754d3](https://github.com/robinebers/openusage/commit/b6754d3) test: add cases for handling tiny deficits in formatting and display (#216) by @validatedev
- [e28f85c](https://github.com/robinebers/openusage/commit/e28f85c) feat: show deficit percentage and runs-out ETA below progress bars (#212) by @robinebers
- [9bca9f4](https://github.com/robinebers/openusage/commit/9bca9f4) refactor(app): split monolithic App into focused hooks and atomic stores (#209) by @davidarny
- [deba467](https://github.com/robinebers/openusage/commit/deba467) feat(cursor): add sqlite-first auth with keychain fallback (#210) by @robinebers
- [0b63ade](https://github.com/robinebers/openusage/commit/0b63ade) style: compact token usage text lines (Today/Yesterday/Last 30 Days) (#211) by @davidarny
- [63c4128](https://github.com/robinebers/openusage/commit/63c4128) Increasing test coverage back to over 90% (#207) by @robinebers

## 0.6.6

### New Features

- Add local Claude/Codex usage tracking (via ccusage) ([#193](https://github.com/robinebers/openusage/pull/193)) by @validatedev
- Add MiniMax provider support ([#168](https://github.com/robinebers/openusage/pull/168)) by @davidarny

### Bug Fixes

- Show drained models + consolidate quota pools in antigravity ([#204](https://github.com/robinebers/openusage/pull/204)) by @validatedev

### Chores

- Bump version to 0.6.6 by @robinebers
- Add Factory/Droid to supported providers ([#205](https://github.com/robinebers/openusage/pull/205)) by @davidarny
- Add non-technical log capture guide by @davidarny
- Bump lucide-react from 0.564.0 to 0.575.0 ([#203](https://github.com/robinebers/openusage/pull/203)) by @app/dependabot
- Remove worktree setup configuration and update PR review feedback instructions by @robinebers
- Add worktree setup configuration by @robinebers

---

### Changelog

**Full Changelog**: [v0.6.5...v0.6.6](https://github.com/robinebers/openusage/compare/v0.6.5...v0.6.6)

- [e425fa6](https://github.com/robinebers/openusage/commit/e425fa6) chore: bump version to 0.6.6 by @robinebers
- [a3f0c0e](https://github.com/robinebers/openusage/commit/a3f0c0e) fix(antigravity): show drained models + consolidate quota pools (#204) by @validatedev
- [e994d8b](https://github.com/robinebers/openusage/commit/e994d8b) docs: add Factory/Droid to supported providers (#205) by @davidarny
- [96d0c8b](https://github.com/robinebers/openusage/commit/96d0c8b) feat: add local Claude/Codex usage tracking (via ccusage) (#193) by @validatedev
- [c735db3](https://github.com/robinebers/openusage/commit/c735db3) chore(deps): bump lucide-react from 0.564.0 to 0.575.0 (#203) by @app/dependabot
- [cd6d7ac](https://github.com/robinebers/openusage/commit/cd6d7ac) feat: add MiniMax provider support (#168) by @davidarny
- [ebef705](https://github.com/robinebers/openusage/commit/ebef705) docs: add non-technical log capture guide by @davidarny
- [d52dc11](https://github.com/robinebers/openusage/commit/d52dc11) chore: remove worktree setup configuration and update PR review feedback instructions by @robinebers
- [41e50e3](https://github.com/robinebers/openusage/commit/41e50e3) chore: add worktree setup configuration by @robinebers

## 0.6.5

### New Features

- add Gemini provider plugin (oauth-personal, pro/flash usage) ([#189](https://github.com/robinebers/openusage/pull/189)) by @Rich627

### Bug Fixes

- improve tray icon positioning logic for macOS ([#154](https://github.com/robinebers/openusage/pull/154)) by @MuhammadAli511
- Merge pull request #188 from AdamAmr05/fix-panel-active-space by @validatedev
- Merge branch 'main' into fix-panel-active-space by @validatedev
- handle team usage without enabled flag ([#190](https://github.com/robinebers/openusage/pull/190)) by @davidarny
- Fix panel opening on the active macOS Space by @AdamAmr05
- update model versions and improve filtering logic ([#186](https://github.com/robinebers/openusage/pull/186)) by @validatedev

### Chores

- bump version to 0.6.5 by @robinebers
- update README to improve clarity and formatting by @robinebers
- update release tag management in publish workflow and clarify CONTRIBUTING.md guidelines by @robinebers
- update CONTRIBUTING.md to include maintainers and approval requirements; modify CODEOWNERS for broader review responsibility by @robinebers
- bump uuid from 1.20.0 to 1.21.0 in /src-tauri ([#179](https://github.com/robinebers/openusage/pull/179)) by @app/dependabot
- bump lucide-react from 0.563.0 to 0.564.0 ([#180](https://github.com/robinebers/openusage/pull/180)) by @app/dependabot
- remove outdated spec for next update label global refresh by @robinebers

---

### Changelog

**Full Changelog**: [v0.6.4...v0.6.5](https://github.com/robinebers/openusage/compare/v0.6.4...v0.6.5)

- [4e35520](https://github.com/robinebers/openusage/commit/4e35520362d1cc6b1ccef57e037431b00f1e29fb) chore: bump version to 0.6.5 by @robinebers
- [d3fb059](https://github.com/robinebers/openusage/commit/d3fb059fa31bc866f1ee0fabf8fb66ad6795a982) fix(panel): improve tray icon positioning logic for macOS (#154) by @MuhammadAli511
- [59035da](https://github.com/robinebers/openusage/commit/59035dab9fa1861d28a6c7a1ce2f29b251ea2417) docs: update README to improve clarity and formatting by @robinebers
- [7dbd489](https://github.com/robinebers/openusage/commit/7dbd489aec34ea8a4054d01587c0b764ce52670e) chore: update release tag management in publish workflow and clarify CONTRIBUTING.md guidelines by @robinebers
- [1c42015](https://github.com/robinebers/openusage/commit/1c42015d4dc93306684b990e17433392a3825608) feat(gemini): add Gemini provider plugin (oauth-personal, pro/flash usage) (#189) by @Rich627
- [3997b9a](https://github.com/robinebers/openusage/commit/3997b9af0af890cb059b5f86b60966c68f7e271a) Merge pull request #188 from AdamAmr05/fix-panel-active-space by @validatedev
- [a782533](https://github.com/robinebers/openusage/commit/a78253365da4c4f411f4899e923c26d1fee3ea90) Merge branch 'main' into fix-panel-active-space by @validatedev
- [debfcd3](https://github.com/robinebers/openusage/commit/debfcd398606d7905e49dd86c0005f5ad0a3bae7) fix(cursor): handle team usage without enabled flag (#190) by @davidarny
- [fd86cde](https://github.com/robinebers/openusage/commit/fd86cde4c497f0e797e67bfbc70dfdaa5906ecd4) Fix panel opening on the active macOS Space by @AdamAmr05
- [c3305c4](https://github.com/robinebers/openusage/commit/c3305c4f7cce180ba0b6da4eb2d013a70db51a35) docs: update CONTRIBUTING.md to include maintainers and approval requirements; modify CODEOWNERS for broader review responsibility by @robinebers
- [dd0d7a4](https://github.com/robinebers/openusage/commit/dd0d7a4ef61a779e005d2f054acb4304d451ec0c) chore(deps): bump uuid from 1.20.0 to 1.21.0 in /src-tauri (#179) by @app/dependabot
- [c993fa7](https://github.com/robinebers/openusage/commit/c993fa73a3692972d773ed1f5890cde74919dc1d) chore(deps): bump lucide-react from 0.563.0 to 0.564.0 (#180) by @app/dependabot
- [12ce55f](https://github.com/robinebers/openusage/commit/12ce55f0de77de7c1eedfa51c516d3cbf5b2906d) fix: update model versions and improve filtering logic (#186) by @validatedev
- [e0036a5](https://github.com/robinebers/openusage/commit/e0036a5b34298e8583f15f5b4f000a30cccaa2f4) chore: remove outdated spec for next update label global refresh by @robinebers

## 0.6.4

### Bug Fixes

- Resolve env vars for GUI launches (fish/zsh) ([#183](https://github.com/robinebers/openusage/pull/183)) by @davidarny

### Refactor

- Remove provider_fetch_error deduplication logic by @robinebers

---

### Changelog

**Full Changelog**: [v0.6.3...v0.6.4](https://github.com/robinebers/openusage/compare/v0.6.3...v0.6.4)

- [a7b230c](https://github.com/robinebers/openusage/commit/a7b230c) fix: resolve env vars for GUI launches (fish/zsh) (#183) by @davidarny
- [d46ce12](https://github.com/robinebers/openusage/commit/d46ce12) refactor(analytics): remove provider_fetch_error deduplication logic by @robinebers

## v0.6.3

### New Features

- Surface GPT-5.3-Codex-Spark per-model rate limits in Codex plugin ([#176](https://github.com/robinebers/openusage/pull/176)) by @robinebers

### Bug Fixes

- Reduce noisy analytics event volume with dedupe guards ([#172](https://github.com/robinebers/openusage/pull/172)) by @robinebers
- Replace `var` with `const`/`let` in Codex rate-limit loop by @robinebers

### Chores

- Bump version to 0.6.3 by @robinebers

---

### Changelog

**Full Changelog**: [v0.6.2...v0.6.3](https://github.com/robinebers/openusage/compare/v0.6.2...v0.6.3)

- [b9a595f](https://github.com/robinebers/openusage/commit/b9a595f) fix(analytics): reduce noisy event volume with dedupe guards (#172) by @robinebers
- [3e8e3b7](https://github.com/robinebers/openusage/commit/3e8e3b7) feat(codex): surface GPT-5.3-Codex-Spark per-model rate limits (#176) by @robinebers
- [6ca4794](https://github.com/robinebers/openusage/commit/6ca4794) fix(codex): replace var with const/let in rate-limit loop by @robinebers
- [abe3f24](https://github.com/robinebers/openusage/commit/abe3f24) chore: bump version to 0.6.3 by @robinebers

## v0.6.2

### New Features

- Implement Tauri runtime check for event tracking by @robinebers

### Bug Fixes

- Fix whitelisted env vars not being resolved from terminal zsh ([#167](https://github.com/robinebers/openusage/pull/167)) by @robinebers

---

### Changelog

**Full Changelog**: [v0.6.1...v0.6.2](https://github.com/robinebers/openusage/compare/v0.6.1...v0.6.2)

- [824e3da](https://github.com/robinebers/openusage/commit/824e3da) fix(plugin-engine): read whitelisted env vars from terminal zsh (#167) by @robinebers
- [ffb8883](https://github.com/robinebers/openusage/commit/ffb8883) feat(analytics): implement Tauri runtime check for event tracking by @robinebers

## 0.6.0

### New Features

- feat: add global shortcut to toggle panel ([#132](https://github.com/robinebers/openusage/pull/132)) by @MuhammadAli511
- Feat/perplexity plugin ([#138](https://github.com/robinebers/openusage/pull/138)) by @garanda21
- Add Factory/Droid plugin provider ([#130](https://github.com/robinebers/openusage/pull/130)) by @MuhammadAli511

### Bug Fixes

- fix(provider-card): update progress marker logic to hide when pace is unavailable by @robinebers
- fix: improve pace meter tooltip copy, marker logic, and styling ([#147](https://github.com/robinebers/openusage/pull/147)) by @robinebers
- fix(provider-card): streamline reset label formatting by @robinebers
- fix(codex): support keychain-backed auth storage ([#146](https://github.com/robinebers/openusage/pull/146)) by @robinebers
- fix: keep reset labels at "Resets soon" near reset ([#143](https://github.com/robinebers/openusage/pull/143)) by @robinebers
- Update AGENTS.md to include new guideline for executive summaries by @robinebers
- Reset timers display mode ([#142](https://github.com/robinebers/openusage/pull/142)) by @robinebers
- pacing: Add progress-bar pace marker ([#140](https://github.com/robinebers/openusage/pull/140)) by @robinebers
- Update README.md to add warning about main branch stability before Stack subsection. by @robinebers
- Next update label refresh ([#141](https://github.com/robinebers/openusage/pull/141)) by @robinebers
- fix(update): soften transient update check error UX ([#139](https://github.com/robinebers/openusage/pull/139)) by @robinebers

### Refactor

- Enhance redaction functionality and update AGENTS.md guidelines by @robinebers
- feat(kimi, mock, perplexity, windsurf): enhance plugin tests and functionality by @robinebers

### Chores

- chore: bump version to 0.6.0 by @robinebers
- chore: bump version to 0.5.3 by @robinebers

---

### Changelog

**Full Changelog**: [v0.5.2...v0.6.0](https://github.com/robinebers/openusage/compare/v0.5.2...v0.6.0)

- [f99f1d2](https://github.com/robinebers/openusage/commit/f99f1d2) chore: bump version to 0.6.0 by @robinebers
- [740c3e5](https://github.com/robinebers/openusage/commit/740c3e5) chore: bump version to 0.5.3 by @robinebers
- [47268fe](https://github.com/robinebers/openusage/commit/47268fe) feat(kimi, mock, perplexity, windsurf): enhance plugin tests and functionality by @robinebers
- [b4c6934](https://github.com/robinebers/openusage/commit/b4c6934) fix(provider-card): update progress marker logic to hide when pace is unavailable by @robinebers
- [efba3e4](https://github.com/robinebers/openusage/commit/efba3e4) feat: add global shortcut to toggle panel (#132) by @MuhammadAli511
- [f86add4](https://github.com/robinebers/openusage/commit/f86add4) fix: improve pace meter tooltip copy, marker logic, and styling (#147) by @robinebers
- [f6cedf9](https://github.com/robinebers/openusage/commit/f6cedf9) fix(provider-card): streamline reset label formatting by @robinebers
- [54e5a90](https://github.com/robinebers/openusage/commit/54e5a90) fix(codex): support keychain-backed auth storage (#146) by @robinebers
- [79a530f](https://github.com/robinebers/openusage/commit/79a530f) Feat/perplexity plugin (#138) by @garanda21
- [e4bdae2](https://github.com/robinebers/openusage/commit/e4bdae2) fix: keep reset labels at "Resets soon" near reset (#143) by @robinebers
- [39346b1](https://github.com/robinebers/openusage/commit/39346b1) Update AGENTS.md to include new guideline for executive summaries by @robinebers
- [4075e47](https://github.com/robinebers/openusage/commit/4075e47) Enhance redaction functionality and update AGENTS.md guidelines by @robinebers
- [8f7907e](https://github.com/robinebers/openusage/commit/8f7907e) Reset timers display mode (#142) by @robinebers
- [5ce2d9b](https://github.com/robinebers/openusage/commit/5ce2d9b) pacing: Add progress-bar pace marker (#140) by @robinebers
- [cdcddde](https://github.com/robinebers/openusage/commit/cdcddde) Update README.md to add warning about main branch stability before Stack subsection. by @robinebers
- [cf71b2e](https://github.com/robinebers/openusage/commit/cf71b2e) Next update label refresh (#141) by @robinebers
- [e23091c](https://github.com/robinebers/openusage/commit/e23091c) Add Factory/Droid plugin provider (#130) by @MuhammadAli511
- [ffdab91](https://github.com/robinebers/openusage/commit/ffdab91) fix(update): soften transient update check error UX (#139) by @robinebers

## v0.5.2

### New Features

- Add Aptabase analytics events for key user interactions ([#124](https://github.com/robinebers/openusage/pull/124)) by @robinebers
- Antigravity OAuth fallback ([#128](https://github.com/robinebers/openusage/pull/128)) by @validatedev

### Bug Fixes

- Added a little `pr-review` command for Cursor that makes reviewing PRs easier by @robinebers

### Chores

- Update icon assets by replacing the main icon and removing outdated iOS icon exports ([#125](https://github.com/robinebers/openusage/pull/125)) by @robinebers
- Bump version to 0.5.2 by @robinebers

---

### Changelog

**Full Changelog**: [v0.5.1...v0.5.2](https://github.com/robinebers/openusage/compare/v0.5.1...v0.5.2)

- [e80f8a4](https://github.com/robinebers/openusage/commit/e80f8a4) chore: bump version to 0.5.2 by @robinebers
- [d067b1f](https://github.com/robinebers/openusage/commit/d067b1f) feat: Antigravity OAuth fallback (#128) by @validatedev
- [9deed51](https://github.com/robinebers/openusage/commit/9deed51) Added a little `pr-review` command for Cursor that makes reviewing PRs easier by @robinebers
- [7f6a42d](https://github.com/robinebers/openusage/commit/7f6a42d) feat: add Aptabase analytics events for key user interactions (#124) by @robinebers
- [1386897](https://github.com/robinebers/openusage/commit/1386897) chore: update icon assets by replacing the main icon and removing outdated iOS icon exports (#125) by @robinebers

## v0.5.1

### New Features

- Add Amp provider plugin ([#111](https://github.com/robinebers/openusage/pull/111)) by @validatedev
- Add Kimi provider plugin with full-color icon support ([#109](https://github.com/robinebers/openusage/pull/109)) by @Yan-Yu-Lin
- Add Windsurf Next variant support ([#114](https://github.com/robinebers/openusage/pull/114)) by @robinebers
- Add Applications drag target layout for macOS DMG ([#113](https://github.com/robinebers/openusage/pull/113)) by @daeshawnballard

### Bug Fixes

- Stop showing billing cycle pacing for Windsurf flex credits ([#119](https://github.com/robinebers/openusage/pull/119)) by @robinebers
- Support Cursor Enterprise accounts with request-based usage ([#118](https://github.com/robinebers/openusage/pull/118)) by @iicdii

### Chores

- Update README.md to encourage community contributions by @robinebers
- Update README.md to include Amp provider in supported providers list by @robinebers
- Update AGENTS.md to include PR preparation guidelines by @robinebers
- Update README.md to highlight AI-generated project features by @robinebers

---

### Changelog

**Full Changelog**: [v0.5.0...v0.5.1](https://github.com/robinebers/openusage/compare/v0.5.0...v0.5.1)

- [98e861c](https://github.com/robinebers/openusage/commit/98e861c) fix(windsurf): stop showing billing cycle pacing for flex credits (#119) by @robinebers
- [f6a8bfc](https://github.com/robinebers/openusage/commit/f6a8bfc) fix(cursor): support Enterprise accounts with request-based usage (#118) by @iicdii
- [09187ec](https://github.com/robinebers/openusage/commit/09187ec) docs: update README.md to encourage community contributions by @robinebers
- [30583f4](https://github.com/robinebers/openusage/commit/30583f4) docs: update README.md to include Amp provider in supported providers list by @robinebers
- [65e7913](https://github.com/robinebers/openusage/commit/65e7913) feat: add Amp provider plugin (#111) by @validatedev
- [28a92f2](https://github.com/robinebers/openusage/commit/28a92f2) feat(kimi): add Kimi provider plugin with full-color icon support (#109) by @Yan-Yu-Lin
- [8ad9283](https://github.com/robinebers/openusage/commit/8ad9283) docs: update AGENTS.md to include PR preparation guidelines by @robinebers
- [fd92d28](https://github.com/robinebers/openusage/commit/fd92d28) windsurf: add Windsurf Next variant support (#114) by @robinebers
- [d28384d](https://github.com/robinebers/openusage/commit/d28384d) tauri(dmg): add Applications drag target layout (#113) by @daeshawnballard
- [caa12e5](https://github.com/robinebers/openusage/commit/caa12e5) docs: update README.md to highlight AI-generated project features by @robinebers

## v0.5.0

### New Features

- Auto-disable new non-default plugins ([#105](https://github.com/robinebers/openusage/pull/105)) by @robinebers
- Resolve auth path via CODEX_HOME and host env API ([#90](https://github.com/robinebers/openusage/pull/90)) by @igalarzab
- Add name field to redaction logic and corresponding tests by @robinebers
- Add Windsurf plugin provider ([#93](https://github.com/robinebers/openusage/pull/93)) by @robinebers
- Add Antigravity plugin provider ([#91](https://github.com/robinebers/openusage/pull/91)) by @robinebers

### Bug Fixes

- Updated dark theme, scrollable panel, and sidebar refinements ([#88](https://github.com/robinebers/openusage/pull/88)) by @robinebers

### Refactor

- Simplify HTTP request handling in probePort function by @robinebers

### Chores

- Bump reqwest from 0.12.28 to 0.13.2 in /src-tauri ([#104](https://github.com/robinebers/openusage/pull/104)) by @dependabot
- Bump tauri-plugin-updater in /src-tauri ([#99](https://github.com/robinebers/openusage/pull/99)) by @dependabot
- Bump rquickjs from 0.10.0 to 0.11.0 in /src-tauri ([#98](https://github.com/robinebers/openusage/pull/98)) by @dependabot
- Bump @vitejs/plugin-react from 4.7.0 to 5.1.3 ([#100](https://github.com/robinebers/openusage/pull/100)) by @dependabot
- Bump jsdom from 27.4.0 to 28.0.0 ([#101](https://github.com/robinebers/openusage/pull/101)) by @dependabot
- Bump typescript from 5.8.3 to 5.9.3 ([#102](https://github.com/robinebers/openusage/pull/102)) by @dependabot
- Bump time from 0.3.46 to 0.3.47 in /src-tauri ([#103](https://github.com/robinebers/openusage/pull/103)) by @dependabot
- Add open-source community files and CI workflows ([#95](https://github.com/robinebers/openusage/pull/95)) by @robinebers
- Update README.md to reflect new provider additions and modify upcoming features section by @robinebers
- Update package metadata in Cargo.toml by @robinebers
- Bump version to 0.5.0 by @robinebers

---

### Changelog

**Full Changelog**: [v0.4.2...v0.5.0](https://github.com/robinebers/openusage/compare/v0.4.2...v0.5.0)

- [f1cf2bc](https://github.com/robinebers/openusage/commit/f1cf2bc) feat(settings): auto-disable new non-default plugins (#105) by @robinebers
- [c7bf1cc](https://github.com/robinebers/openusage/commit/c7bf1cc) feat(codex): resolve auth path via CODEX_HOME and host env API (#90) by @igalarzab
- [c49ce70](https://github.com/robinebers/openusage/commit/c49ce70) chore(deps): bump reqwest from 0.12.28 to 0.13.2 in /src-tauri (#104) by @dependabot
- [83f8c44](https://github.com/robinebers/openusage/commit/83f8c44) chore(deps): bump tauri-plugin-updater in /src-tauri (#99) by @dependabot
- [a07abf9](https://github.com/robinebers/openusage/commit/a07abf9) chore(deps): bump rquickjs from 0.10.0 to 0.11.0 in /src-tauri (#98) by @dependabot
- [c5167b7](https://github.com/robinebers/openusage/commit/c5167b7) chore(deps-dev): bump @vitejs/plugin-react from 4.7.0 to 5.1.3 (#100) by @dependabot
- [0f14a64](https://github.com/robinebers/openusage/commit/0f14a64) chore(deps-dev): bump jsdom from 27.4.0 to 28.0.0 (#101) by @dependabot
- [7dfb11e](https://github.com/robinebers/openusage/commit/7dfb11e) chore(deps-dev): bump typescript from 5.8.3 to 5.9.3 (#102) by @dependabot
- [5c9b948](https://github.com/robinebers/openusage/commit/5c9b948) chore(deps): bump time from 0.3.46 to 0.3.47 in /src-tauri (#103) by @dependabot
- [b1e52eb](https://github.com/robinebers/openusage/commit/b1e52eb) docs: Update README.md to reflect new provider additions and modify upcoming features section by @robinebers
- [661ca68](https://github.com/robinebers/openusage/commit/661ca68) chore: Add open-source community files and CI workflows (#95) by @robinebers
- [bb57cd3](https://github.com/robinebers/openusage/commit/bb57cd3) refactor(antigravity): simplify HTTP request handling in probePort function by @robinebers
- [463fb0c](https://github.com/robinebers/openusage/commit/463fb0c) feat(redaction): Add name field to redaction logic and corresponding tests by @robinebers
- [f2d1e9e](https://github.com/robinebers/openusage/commit/f2d1e9e) feat(windsurf): Add Windsurf plugin provider (#93) by @robinebers
- [01d81ce](https://github.com/robinebers/openusage/commit/01d81ce) feat(antigravity): Add Antigravity plugin provider (#91) by @robinebers
- [7905417](https://github.com/robinebers/openusage/commit/7905417) ui: Updated dark theme, scrollable panel, and sidebar refinements (#88) by @robinebers
- [46a452e](https://github.com/robinebers/openusage/commit/46a452e) chore: update package metadata in Cargo.toml by @robinebers
- [f73192c](https://github.com/robinebers/openusage/commit/f73192c) chore: bump version to 0.5.0 by @robinebers

## v0.4.2

### New Features

- Add Help button to open GitHub issues page by @robinebers
- Pacing tooltip projection and limit hit ETA ([#87](https://github.com/robinebers/openusage/pull/87)) by @marcjaner
- Add provider icon style option to tray ([#81](https://github.com/robinebers/openusage/pull/81)) by @robinebers

### Chores

- Bump version to 0.4.2
- Bump version to 0.4.1

---

### Changelog

**Full Changelog**: [v0.4.1...v0.4.2](https://github.com/robinebers/openusage/compare/v0.4.1...v0.4.2)

- [0d52efd](https://github.com/robinebers/openusage/commit/0d52efd) chore: bump version to 0.4.2
- [0d17daa](https://github.com/robinebers/openusage/commit/0d17daa) feat(side-nav): add Help button to open GitHub issues page
- [0605d4b](https://github.com/robinebers/openusage/commit/0605d4b) Feat/pacing tooltip projection and limit hit eta (#87)
- [618cca7](https://github.com/robinebers/openusage/commit/618cca7) chore: bump version to 0.4.1
- [de401e3](https://github.com/robinebers/openusage/commit/de401e3) tray: add provider icon style option (#81)

## v0.4.1

### New Features

- Add provider icon style and enhance settings functionality by @robinebers

### Bug Fixes

- Update references from "Claude" to "Provider" for consistency by @robinebers

### Refactor

- Update section headings and descriptions for clarity by @robinebers
- Update checkbox component to use new primitive and improve styling by @robinebers

### Chores

- Update dark theme colors and enhance settings page text by @robinebers
- Update SVG attributes for improved icon rendering by @robinebers

---

### Changelog

**Full Changelog**: [v0.4.0...v0.4.1](https://github.com/robinebers/openusage/compare/v0.4.0...v0.4.1)

- [cd6225e](https://github.com/robinebers/openusage/commit/cd6225e) chore: bump version to 0.4.1
- [eb6a92a](https://github.com/robinebers/openusage/commit/eb6a92a) style(settings): update SVG attributes for improved icon rendering
- [c8795f2](https://github.com/robinebers/openusage/commit/c8795f2) fix(provider): update references from "Claude" to "Provider" for consistency
- [8b0022a](https://github.com/robinebers/openusage/commit/8b0022a) refactor(settings): update section headings and descriptions for clarity
- [13b5cd2](https://github.com/robinebers/openusage/commit/13b5cd2) refactor(checkbox): update checkbox component to use new primitive and improve styling
- [8efb8e7](https://github.com/robinebers/openusage/commit/8efb8e7) feat(tray): add provider icon style and enhance settings functionality
- [2efe6dd](https://github.com/robinebers/openusage/commit/2efe6dd) style: update dark theme colors and enhance settings page text

## v0.4.0

### New Features

- Customizable tray icon styles and percentage text ([#78](https://github.com/robinebers/openusage/pull/78))

### Bug Fixes

- Prevent background timer suspension on macOS ([#74](https://github.com/robinebers/openusage/pull/74))
- Remove emdashes ([8d456f9](https://github.com/robinebers/openusage/commit/8d456f9))

### Chores

- Update icon assets and icon configuration ([32948c9](https://github.com/robinebers/openusage/commit/32948c9))
- Update README to enhance clarity and detail ([8e3a7e2](https://github.com/robinebers/openusage/commit/8e3a7e2))

---

### Changelog

**Full Changelog**: [v0.3.1...v0.4.0](https://github.com/robinebers/openusage/compare/v0.3.1...v0.4.0)

- [a0b1519](https://github.com/robinebers/openusage/commit/a0b1519) chore: bump version to 0.4.0
- [168f23b](https://github.com/robinebers/openusage/commit/168f23b) tray: customizable icon styles and percentage text (#78)
- [8d456f9](https://github.com/robinebers/openusage/commit/8d456f9) remove god damn emdashes
- [8e3a7e2](https://github.com/robinebers/openusage/commit/8e3a7e2) docs: update README to enhance clarity and detail
- [32948c9](https://github.com/robinebers/openusage/commit/32948c9) chore: update icon assets and icon configuration
- [4800e36](https://github.com/robinebers/openusage/commit/4800e36) fix(macos): prevent background timer suspension (#74)

## v0.3.1

### Bug Fixes

- Prevent background timer suspension on macOS by disabling WebKit's `inactiveSchedulingPolicy` and App Nap at startup
- Use `NSActivityUserInitiatedAllowingIdleSystemSleep` instead of `NSActivityBackground` to reliably prevent App Nap

---

### Changelog

**Full Changelog**: [v0.3.0...v0.3.1](https://github.com/robinebers/openusage/compare/v0.3.0...v0.3.1)

- [19164fa](https://github.com/robinebers/openusage/commit/19164fa) feat(macos): add objc2 dependencies and implement app nap and webview suspension handling
- [6ff19ba](https://github.com/robinebers/openusage/commit/6ff19ba) fix(macos): use NSActivityUserInitiatedAllowingIdleSystemSleep instead of NSActivityBackground
- [c532c69](https://github.com/robinebers/openusage/commit/c532c69) chore: bump version to 0.3.1

## v0.3.0

### New Features

- Add Copilot plugin and tests ([#69](https://github.com/robinebers/openusage/pull/69)) by @tomhhealy
- Add pace tracking indicator for usage metrics ([#70](https://github.com/robinebers/openusage/pull/70)) by @robinebers
- Enhance log redaction and add new sensitive keys ([#72](https://github.com/robinebers/openusage/pull/72)) by @robinebers

### Chores

- Update progress line structure in Copilot plugin.json by @robinebers

---

### Changelog

**Full Changelog**: [v0.2.2...v0.3.0](https://github.com/robinebers/openusage/compare/v0.2.2...v0.3.0)

- [819b9bb](https://github.com/robinebers/openusage/commit/819b9bb) chore: bump version to 0.3.0
- [8d8da67](https://github.com/robinebers/openusage/commit/8d8da67) refactor(copilot): update progress line structure in plugin.json
- [b86478d](https://github.com/robinebers/openusage/commit/b86478d) feat(logging): enhance log redaction and add new sensitive keys (#72)
- [c85b3f1](https://github.com/robinebers/openusage/commit/c85b3f1) feat: add Copilot plugin and tests (#69)
- [acaac92](https://github.com/robinebers/openusage/commit/acaac92) feat: Add pace tracking indicator for usage metrics (#70)

## v0.2.2

### New Features

- Conditional primary metrics + Cursor credits balance ([#68](https://github.com/robinebers/openusage/pull/68)) by @robinebers

---

### Changelog

**Full Changelog**: [v0.2.1...v0.2.2](https://github.com/robinebers/openusage/compare/v0.2.1...v0.2.2)

- [eb99a67](https://github.com/robinebers/openusage/commit/eb99a67) chore: bump version to 0.2.2
- [c280059](https://github.com/robinebers/openusage/commit/c280059) plugins: Conditional primary metrics + Cursor credits balance (#68)

## v0.2.1

### New Features

- Add 15-minute auto-check interval for app updates ([#66](https://github.com/robinebers/openusage/pull/66)) by @robinebers

### Bug Fixes

- Use immutable=1 to prevent WAL false negatives after sleep ([#65](https://github.com/robinebers/openusage/pull/65)) by @robinebers

---

### Changelog

**Full Changelog**: [v0.2.0...v0.2.1](https://github.com/robinebers/openusage/compare/v0.2.0...v0.2.1)

- [0aff5a3](https://github.com/robinebers/openusage/commit/0aff5a3) chore: bump version to 0.2.1
- [46f76ea](https://github.com/robinebers/openusage/commit/46f76ea) feat(update): add 15-minute auto-check interval for app updates (#66)
- [c4cbdfa](https://github.com/robinebers/openusage/commit/c4cbdfa) fix(sqlite): use immutable=1 to prevent WAL false negatives after sleep (#65)

## v0.2.0

### New Features

- **Usage display modes**: Show "used" or "left" with configurable default ([#60](https://github.com/robinebers/openusage/pull/60), [#63](https://github.com/robinebers/openusage/pull/63))
- **Debug logging**: Tray menu option to set log level for troubleshooting ([#64](https://github.com/robinebers/openusage/pull/64))
- **Escape to dismiss**: Press Escape to hide the panel
- **Update button animation**: Animated border beam on available updates ([#58](https://github.com/robinebers/openusage/pull/58))

### Bug Fixes

- Fix a keychain JSON storage causing credential read failures in Claude ([#61](https://github.com/robinebers/openusage/pull/61))
- Exclude test files from production builds ([#62](https://github.com/robinebers/openusage/pull/62))
- Adjust panel positioning on macOS ([#59](https://github.com/robinebers/openusage/pull/59))

---

**Full Changelog**: [v0.1.2...v0.2.0](https://github.com/robinebers/openusage/compare/v0.1.2...v0.2.0)

## 0.1.2

### New Features

- Dynamic tray icon with primary progress bars + about dialog ([#51](https://github.com/robinebers/openusage/pull/51))
- Add AboutDialog and enhance version display interaction ([#49](https://github.com/robinebers/openusage/pull/49))
- Add settings button, plugins subtitle, and tray context menu ([#50](https://github.com/robinebers/openusage/pull/50))

### Bug Fixes

- Update subtitle fallback for session status in Claude and Codex plugins and fix about plugin text, replaced home icon with OpenUsage logo ([#57](https://github.com/robinebers/openusage/pull/57))
- Resolve gray border artifact on macOS transparent windows ([#53](https://github.com/robinebers/openusage/pull/53))
- Handle hex-encoded keychain credentials ([#48](https://github.com/robinebers/openusage/pull/48))

### Refactor

- Refactor plugins to use ctx.util helpers ([#54](https://github.com/robinebers/openusage/pull/54))
- Standardize provider documentation to minimal format ([#52](https://github.com/robinebers/openusage/pull/52))

### Chores

- Update AGENTS.md with new tauri-action parallel build information

---

### Changelog

**Full Changelog**: [v0.1.1...v0.1.2](https://github.com/robinebers/openusage/compare/v0.1.1...v0.1.2)

- [07854d1](https://github.com/robinebers/openusage/commit/07854d1) fix(plugins): update subtitle fallback for session status in Claude and Codex plugins and fix about plugin text, replaced home icon with OpenUsage logo (#57)
- [cfeb157](https://github.com/robinebers/openusage/commit/cfeb157) fix(panel): resolve gray border artifact on macOS transparent windows (#53)
- [1cf9c68](https://github.com/robinebers/openusage/commit/1cf9c68) Refactor plugins to use ctx.util helpers (#54)
- [9e276bf](https://github.com/robinebers/openusage/commit/9e276bf) Standardize provider documentation to minimal format (#52)
- [b2495ad](https://github.com/robinebers/openusage/commit/b2495ad) feat(tray): Dynamic tray icon with primary progress bars + about dialog (#51)
- [8dc1e99](https://github.com/robinebers/openusage/commit/8dc1e99) Add settings button, plugins subtitle, and tray context menu (#50)
- [8768474](https://github.com/robinebers/openusage/commit/8768474) feat(panel-footer): add AboutDialog and enhance version display interaction (#49)
- [5f14123](https://github.com/robinebers/openusage/commit/5f14123) fix(claude): handle hex-encoded keychain credentials (#48)
- [4808686](https://github.com/robinebers/openusage/commit/4808686) docs: update AGENTS.md with new tauri-action parallel build information

## v0.1.1

### New Features

- Add line scope API for overview/detail filtering ([#44](https://github.com/robinebers/openusage/pull/44))
- Add upward-pointing arrow to tray panel ([#43](https://github.com/robinebers/openusage/pull/43))
- Replace refresh button with countdown timer ([#41](https://github.com/robinebers/openusage/pull/41))
- fetch and display app version in footer

### Refactor

- streamline update handling by removing download trigger

### Chores

- enhance publish workflow and plugin initialization
- update publish workflow and remove unused bundled_plugins directory
- update documentation and .gitignore for auto-update interval feature ([#42](https://github.com/robinebers/openusage/pull/42))
- update screenshot asset

---

### Changelog

**Full Changelog**: [v0.0.2...v0.1.1](https://github.com/robinebers/openusage/compare/v0.0.2...v0.1.1)

- [6a72419](https://github.com/robinebers/openusage/commit/6a72419) plugins: Add line scope API for overview/detail filtering (#44)
- [aa4be14](https://github.com/robinebers/openusage/commit/aa4be14) Add upward-pointing arrow to tray panel (#43)
- [6c5502c](https://github.com/robinebers/openusage/commit/6c5502c) chore: update documentation and .gitignore for auto-update interval feature (#42)
- [0b918a8](https://github.com/robinebers/openusage/commit/0b918a8) chore: update screenshot asset
- [2d1c367](https://github.com/robinebers/openusage/commit/2d1c367) footer: Replace refresh button with countdown timer (#41)
- [f17ba61](https://github.com/robinebers/openusage/commit/f17ba61) feat: fetch and display app version in footer
- [55e30f4](https://github.com/robinebers/openusage/commit/55e30f4) refactor: streamline update handling by removing download trigger
- [b52ec74](https://github.com/robinebers/openusage/commit/b52ec74) chore: enhance publish workflow and plugin initialization
- [8feca7a](https://github.com/robinebers/openusage/commit/8feca7a) chore: update publish workflow and remove unused bundled_plugins directory

## v0.1.0

### Changelog

**Full Changelog**: [v0.0.2...v0.1.0](https://github.com/robinebers/openusage/compare/v0.0.2...v0.1.0)

- Replace refresh button with countdown timer ([#41](https://github.com/robinebers/openusage/pull/41)) by @robinebers
- Fix broken links and update outdated refresh references ([#42](https://github.com/robinebers/openusage/pull/42)) by @robinebers
- Add upward-pointing arrow to tray panel ([#43](https://github.com/robinebers/openusage/pull/43)) by @robinebers
- Add line scope API for overview/detail filtering ([#44](https://github.com/robinebers/openusage/pull/44)) by @robinebers

## v0.0.2

*No release notes*

## v0.0.1

*No release notes*