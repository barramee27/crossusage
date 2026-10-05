# OpenUsage v0.7.13 port (CrossUsage 1.6.0)

Upstream **v0.7.13** (2026-10-02). Swift-only — port applicable behavior into JS plugins, the pricing supplement, and Rust spend math.

**Version:** [**1.6.0**](./VERSIONING.md) — **MINOR**, because the base account label is a CrossUsage feature. The v0.7.13 port would be PATCH alone. Baseline: CrossUsage **1.5.0** plus the already-merged extra-account and settings fixes. Tag: `v0.7.13`.

## Shipped

| Upstream | CrossUsage action |
|----------|-------------------|
| Sonnet 5.5, Opus 5.5, GPT-6 Sol / 6.1 Sol / Luna, Grok 4.7, `grok-bot-cua`, GPT-5.6 Sol promo rates | `pricing_supplement.json` |
| Ultrafast 6x on GPT-6 Astra; 272k rates for the new GPT-6 models (#1327, #1331) | `codex_pricing.rs` + scanner `service_tier == ultrafast` |
| Claude Rate Limit Resets / `cedar_ember` (#1290) | Usage URL query + `claude-cli` user agent + text row |
| Cursor usage CSV 20s deadline (#1324) | `cursor_usage_export` reqwest timeout |
| Grok team billing 412 (#1272) | Keep plan, warning, and local spend |
| Ollama monthly fraction (#1270) | `limits.monthly.usage` and a third settings-page percent |
| OpenCode 2 Go key in channel DBs (#1323) | `opencode-go` falls back to `credential` in `opencode.db` / `opencode-next.db` |
| Glued login-shell banner (#1320) | Marker search already accepts a prefix; regression test added |

## Skip

| Upstream | Why |
|----------|-----|
| Codex Swap (#1264) | macOS app account switcher, same class as the skipped Claude Swap port |
| One card per Codex home and pi login (#1321) | Swift account assembly. The fork already has manual extra accounts |
| OpenCode 2 ChatGPT OAuth attribution into Codex spend (#1284) | No OpenCode→Codex spend scanner in the fork |
| Claude launch-cached 429 (#1325) | macOS launch snapshot |
| Claude credential document preservation (#1316) | File/keychain refresh already writes the document that was read |
| Claude terminal-session counting (#1299) | Tied to upstream multi-account discovery |
| Process drain queues (#1318) | GCD utility-pool bug. Rust reads each pipe on the command task |
| Ollama unreadable `/api/me` warning (#1300) | Fork plan badge comes from the settings page, not that JSON |
| Analytics label, “Check Automatically” (#1328, #1330) | Swift settings copy |
| PostHog, Sparkle, keyboard shortcuts, checkout, pullfrog | Upstream infra |
