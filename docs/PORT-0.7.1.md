# OpenUsage v0.7.1 port (CrossUsage 1.3.0)

Upstream **v0.7.1** is Swift-only (`upstream/swift` tag). CrossUsage ports **plugins** and **rewrites** UI in React/Tauri. Target release: **1.3.0** (with i18n).

## Status legend

| Status | Meaning |
|--------|---------|
| **done** | Landed on `feat/i18n-locale-currency` |
| **wip** | In progress |
| **defer** | Swift-only / low ROI for 1.3.0 |
| **skip** | N/A for Linux/Windows fork |

## Plugin / provider

| Upstream change | Class | Status |
|-----------------|-------|--------|
| copilot: AI Credits + Extra Usage (#807) | plugin | **done** |
| claude: Fable weekly limit from `limits` (#814) | plugin | **done** |
| claude: re-login warning missing `user:profile` (#782) | plugin + UI | defer (no `warning` on probe yet) |
| codex: GPT-5.3-Codex-Spark meters (#796) | plugin | **done** (already via `additional_rate_limits`) |
| codex: drop review / per-model limits | plugin | **done** |
| codex: JWT `exp` refresh (#516) | plugin | **done** |
| openrouter provider (#763) | plugin | **done** |
| zai GLM plan (#783) | plugin | **done** (fork already has `plugins/zai`) |
| cursor: spend manifest GLM 5.2 + Sonnet 5 (#781, #813) | ccusage/manifest | defer |
| cursor: unknown-model spend warning (#789) | plugin + UI | defer |
| antigravity: "Not started" unused pools (#761) | UI | **done** (fresh session reset label) |
| providers: env API keys from login shell (#788) | rust | defer |
| spend: no-usage period "No data" (#790) | ccusage/UI | defer |

## UI / Swift rewrite

| Upstream change | Status |
|-----------------|--------|
| notifications: pace alerts 3 triggers (#633) | defer (fork has pace alerts; upstream stack differs) |
| share: Copy as Image (#762) | defer |
| share: screenshot footer submenu (#785) | defer |
| customize: undo widget removal (#603) | defer |
| customize: provider list in customize (#797) | defer |
| providers: quick-link buttons (#596, #799, #795) | partial (`links` in `plugin.json` where missing) |
| dynamic widget height single provider (#800) | defer |

## Workflow

```bash
git fetch upstream --tags
git diff v0.7.0..v0.7.1 --stat
git show v0.7.1:Sources/OpenUsage/Providers/<Provider>/   # reference
bun run test plugins/<id>/plugin.test.js
```

Document upstream tag in CHANGELOG **1.3.0** section when releasing.
