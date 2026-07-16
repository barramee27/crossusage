## 2026-07-13

- Probe coalesce (#856): per-instance `in_flight` + `pending` follow-up in `start_probe_batch`; keep `MAX_CONCURRENT_PROBES = 4`. No JS-side queue.
- Log scan bounds (#888/#890): newest 500 files + 256 MiB soft budget; unreadable warn once per path per process. Empty installs stay `NoData`.
- Pricing #909: update bundled `pricing_supplement.json` only (no half-baked HTTP refresher); document upstream hourly gh-pages in module comment.
- Phase 2: Total Spend prefs use `showTotalSpend` (default true) + `totalSpendMetric` (`apiSpend`|`costPerMtok`|`tokens`) in app preferences store; claim via plugin.js HTTP + Tauri `codex_claim_reset_credit` (not a generic plugin-action bus).
- **1.3.2** bundles upstream **v0.7.4 + v0.7.5** in one PATCH (incl. Total Spend ring, Codex claim resets). Skip only macOS-only / upstream CI. PR #15 ships in 1.3.2 if no contributor push after 2-day comment.
- No GitHub push until user approves (port work + release).
- Phase 1 plugin defaults: Claude env token never shadows profile-scoped stored login; Antigravity auth.json bound to refresh-token fingerprint (unbound/orphan cache purged); Z.ai throws on missing/boolean quota numerics (numeric strings still accepted); Codex Session/Weekly classified by `limit_window_seconds` with slot fallback; OpenCode auth+unreadable DB → amber status warning (not silent empty); `host.fs.writeText` sets `0600` on Unix.

## 2026-07-12

- Marketing provider icons: use copied `plugins/*/icon.*` under `public/providers/` + CSS mask tint (not letter placeholders / not hand-ported React SVGs for the grid).
- Marketing `displayColor`: light page keeps dark brand hex; only near-white (`avg > 220`) maps to `#111`. Do not map blacks to white.

## 2026-07-10

- Marketing “viewport” = lightweight React panel mocks (Classic sidebar + Modern tabs/cards), not Tauri/WASM. Hero + `#try` toggle Classic|Modern; Settings Layout label matches active layout.
- Marketing site (`sites/crossusage-web`): scrap dark cyan/CRT cyberpunk look for light product studio (Syne + Manrope + IBM Plex Mono, mint accent `#0f9f7a`). Hero uses Modern UI screenshot; Classic still mentioned. Copy updated for 1.3.1 multi-account + encrypted credentials vs OpenUsage 0.7.2/0.7.3 ports. No push until user asks.

## 2026-06-21

- Local HTTP API: no bearer auth; block browser cross-origin via `Sec-Fetch-Site` / foreign `Origin`; omit CORS headers. `curl` unchanged.
- Provider credentials: `provider_accounts.json` written `0600` on Unix only.
- Plugin host `fs`/`sqlite`: reject `..` path segments before `expand_path`.
