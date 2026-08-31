# OpenUsage v0.7.10 port (CrossUsage 1.4.3)

Upstream **v0.7.10** (2026-08-27) is Swift-only. Port applicable behavior into JS plugins + Rust scanners + React/Tauri.

**Version:** [**1.4.3**](./VERSIONING.md) — upstream bundle = **PATCH**. Baseline: CrossUsage **1.4.2**. Tag: `v0.7.10`.

## Status legend

| Status | Meaning |
|--------|---------|
| **ship** | In **1.4.3** scope |
| **skip** | macOS-only, upstream infra, or already in the fork |
| **later** | Valid fork work; deferred |

## Phase 1 — Pricing

| Upstream | CrossUsage action | Status |
|----------|-------------------|--------|
| GLM 5.3 rates (#1171) | `pricing_supplement.json` | **done** |
| Gemini 3.7 Flash + GPT-5.6 rate refresh (#1112) | Supplement + Codex long-context terra/luna | **done** |
| `grok-proxy` → Grok Build (#1123) | Alias `^grok-proxy$` | **done** |
| Dashed `grok-4-6` CSV slugs (#1103) | `grok-4[.-]6` aliases | **done** |
| Codex auto-review as GPT-5.6 Luna from 2026-07-09 (#1125) | `AUTO_REVIEW_FALLBACKS` | **done** |
| Optional Codex fallback model picker (#1177) | Supplement has `fallback_models`; no Customize UI in the fork | **later** |

## Phase 2 — Plugins / scanners

| Upstream | CrossUsage action | Status |
|----------|-------------------|--------|
| Cursor Grok Bot + dashboard names (#1134, metric order) | Cursor Models / Other Models + GetSandUsageStatus | **done** |
| Antigravity local spend (#1139) | `antigravity_db_usage_scanner` + desktop/CLI tiles | **done** |
| Grok session ledgers (#1135) | `grok_usage_scanner` | **done** |
| Bound token counts (#1172) | `bounded_token_count` (no `i32` wrap) | **done** |
| Claude local spend without OAuth (#1138) | Spend tiles + Not logged in warning | **done** |
| Claude Fable below Weekly (#1141) | Runtime order + `plugin.json` | **done** |
| Claude sub-1% countdown (#1167) | `sessionStartSignal: missingResetDate` | **done** |
| Copilot personal credits on org seats (#1108) | Merge `credits_used` text line | **done** |
| OpenRouter Key Limit = current window (#1109) | `limit - limit_remaining` | **done** |
| Restore Codex Session default (#1165) | Already default in fork | **skip** |
| 30s provider refresh timeout (#1059) | `PROBE_TIMEOUT_SECS = 30` already | **skip** |
| Z.ai credit quota (#1105) | Already in fork | **skip** |

## Skip

| Upstream | Why |
|----------|-----|
| Multiple Claude accounts via Desktop Safe Storage (#1164) | macOS Desktop; fork already has Settings multi-account |
| Laggy Swift transitions / Settings (#1136) | Swift UI |
| PostHog extra-analytics (#1116) | Aptabase, not PostHog |
| Status-item strip skip (#1110) | macOS menu bar |
| Translucent card scroll (#1106) | Swift |
| Sparkle / PostHog bumps, GH contrib rules, Swift fixture cleanup | macOS / upstream infra |

## Tests & docs

| Item | Status |
|------|--------|
| Pricing aliases / Luna rates | **done** |
| Cursor Grok Bot + label migration | **done** |
| Claude spend-without-OAuth / Fable order / countdown | **done** |
| Copilot / OpenRouter | **done** |
| `CHANGELOG.md` **1.4.3** cites **v0.7.10** | **done** |
| Vitest (1483) + `crossusage-core` (known ccusage subprocess fails only) + `bun run build` | **done** |
