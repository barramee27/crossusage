## 2026-07-13

- **1.3.2 port closeout:** Rust probe coalesce (#856); log scan caps + once-per-path unreadable warn (#888/#890); version **1.3.2**; CHANGELOG; pricing stays bundled (`updated_at` 2026-07-08, no live HTTP). **Do not push.**
- Phase 2 Modern UI (0.7.4/0.7.5): Total Spend ring card (`total-spend.ts` + card) with Cost/Cost·MTok/Tokens + period switcher; Codex Rate Limit Resets hover popover + claim via `claimResetCredit` / `codex_claim_reset_credit`; `line.text` now passes statusDot/modelBreakdown/resetCreditExpiries; launch-at-login error surfacing; update banner clears when channel says up-to-date. **Do not push.**
- Phase 1 plugin fixes (0.7.4/0.7.5): Claude cache isolation + profile-over-env; Antigravity auth.json fingerprint bind/purge; Z.ai reject malformed/boolean quotas; Codex window routing by `limit_window_seconds`; Cursor estimated MTD spend + export/optional logs; OpenCode loud SQLite fail; `host.fs.writeText` Unix 0600; BOM credential reject. **Do not push.**
- PORT 0.7.4 + 0.7.5 → 1.3.2: `docs/PORT-0.7.4-0.7.5.md` — all applicable upstream items **ship** in 1.3.2 (Total Spend, OpenCode logs, pricing, Codex claim, credential fixes). PR #15 merge on 2-day window; contributor migration → 1.3.3 if late. **Do not push.**
- Release plan: finish 1.3.2 port locally → comment on PR #15 (2-day merge deadline) → merge if no push → tag 1.3.2. Contributor follow-up → next release.

## 2026-07-12

- **Provider grid real logos:** marketing used letter placeholders (`makeLetterIcon`) instead of repo `plugins/*/icon.*`. Copied all 27 into `public/providers/`, render via `ProviderIcon` (CSS mask + brand color; PNG as img). Push + VPS deploy.
- **Provider grid logos invisible:** `displayColor()` still remapped near-black brands to `#fff` (dark-page leftover). Light redesign → Cursor/Grok/Ollama/etc vanished. Fixed: dark brands stay; only near-white → `#111`. In `sites/crossusage-web`. Deploy when ready.

## 2026-07-10

- **Modern + Classic demos**: live Modern panel mock (Dashboard / Customize / Settings tabs, grouped cards) + Classic sidebar; layout toggle on hero + `#try`. Settings Layout label matches active demo. **Do not push**.
- **Hero Classic plane**: replaced Modern screenshot bleed with live Classic `Panel` + dark desktop background; Modern screenshot remains in `#layouts`. **Do not push**.
- **Interactive app viewport** (`sites/crossusage-web`): in-browser Classic panel demo (React mock, no WASM) — tray toggle, overview/multi-account/settings steps, Cursor + Cursor (Work). Wired at `#try`; Modern screenshot kept under `#layouts`. **Do not push**.
- **Marketing site UX pass 2** (`sites/crossusage-web`): full-bleed first viewport (brand-first CrossUsage + one headline + one line + CTAs + edge product plane); mobile nav; provider marquee; dark layouts band; lift-card interactions; section reorder. Build OK. **Do not push**.
- **Marketing site redesign** (`sites/crossusage-web`): full visual scrap of dark cyan/CRT theme → light product studio (Syne/Manrope/IBM Plex Mono, mint accent). 1.3.1 copy (multi-account, encryption vs upstream 0.7.2/0.7.3). New landscape OG image. Build OK locally. **Do not push** until user asks.

## 2026-07-06

- **1.3.1 port (OpenUsage v0.7.2 + v0.7.3):** native scanners + pricing, plugin/UI ports, version 1.3.1. `bun run test` 1396/1396 pass. Build/publish deferred until user tests — **no GitHub push**.
- **1.3.1 plan:** Bundle upstream **v0.7.2 + v0.7.3** (PATCH per [VERSIONING.md](./VERSIONING.md)); **1.4.0** reserved for fork features. Tracking: [PORT-0.7.2-0.7.3.md](./PORT-0.7.2-0.7.3.md).

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
