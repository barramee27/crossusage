# OpenUsage v0.7.2 + v0.7.3 port (CrossUsage 1.3.1)

Upstream **v0.7.2** and **v0.7.3** are Swift-only (`upstream/swift` tags). There are **no `plugins/` diffs** between v0.7.1 and v0.7.3 — port by reading Swift providers and rewriting to JS + React/Tauri.

**Version:** [**1.3.1**](../VERSIONING.md) — upstream bundle = **PATCH** only. Reserve **1.4.0** for new **CrossUsage-specific** features (fork MINOR).

**Strategy:** One patch release bundling 0.7.2 + 0.7.3. Do not call it 1.4.0.

## Status legend

| Status | Meaning |
|--------|---------|
| **ship** | In 1.3.1 scope |
| **skip** | Not applicable on Linux/Windows fork (macOS-only or already covered) |
| **later** | Real upstream feature, blocked by a **dependency** we don't have yet — track in [PORT-0.7.1.md](./PORT-0.7.1.md) defer table or a 1.4.0+ epic; **not** laziness |

**We dropped the vague "defer" bucket.** Either we ship it in 1.3.1, **skip** it (N/A), or mark **later** with an explicit blocker.

---

## Phase 1 — Plugin / provider (ship in 1.3.1)

| Upstream | CrossUsage action | Status |
|----------|-------------------|--------|
| Copilot org-level AI credits (#843, #844) | `/user/orgs` + org billing summary; probe other orgs on outage; placeholder Extra Usage must not block lookup | **ship** |
| Grok weekly shared pool | Weekly pool from CLI JSON credits; drop monthly meter; varint overflow fix | **ship** |
| Antigravity Gemini pool + weekly (0.7.2) | `RetrieveUserQuotaSummary` merge; Session/Weekly labels | **ship** |
| Codex fresh-window latency (0.7.2) | No false 99% on untouched sessions after slow fetch | **ship** |
| Codex reset-credit status dot (#854) | Badge/dot on reset-credit expiry | **ship** |
| Claude rate-limited warning (#849) | `warning` on probe + header in UI | **ship** |
| Claude desktop-app-only hint (#828) | Hint when desktop signed in, no CLI creds | **ship** |
| Pricing Opus 4.7/4.8 fast-mode (#835) | Override in cursor spend path / ccusage opts where we price | **ship** (if spend tiles exist for Cursor) |

### Reference (Swift)

```bash
git fetch upstream --tags
git show v0.7.3:Sources/OpenUsage/Providers/Copilot/CopilotOrgBillingMapper.swift
git show v0.7.3:Sources/OpenUsage/Providers/Grok/GrokUsageMapper.swift
git show v0.7.2:Sources/OpenUsage/Providers/Antigravity/AntigravityUsageMapper.swift
git show v0.7.2:Sources/OpenUsage/Providers/Codex/CodexUsageMapper.swift
```

---

## Phase 2 — UI / UX (ship in 1.3.1)

| Upstream | CrossUsage action | Status |
|----------|-------------------|--------|
| Per-model spend breakdown on hover (#850) | Hover on Today/Yesterday/30d spend values | **ship** |
| Exclude unpriceable usage from totals (#853) | Filter spend aggregation | **ship** |
| Pace notification opens app (#840) | Focus Tauri window on notification click | **ship** |
| Reset timestamp jitter (#816) | Ignore sub-minute jitter in pace/reset alerts | **ship** |
| Onboarding detected providers (#830) | First-run auto-enable detected plugins (extend wizard) | **ship** |

---

## Skip (not 1.3.1 — wrong platform or duplicate)

| Upstream | Why **skip** |
|----------|----------------|
| Increase Transparency + Party easter egg (#784) | macOS liquid-glass appearance |
| Sparkle in-popover update banner (#842) | macOS Sparkle; we use Tauri updater |
| Footer Options menu / Customize primary button (0.7.2, #841) | Swift popover chrome; fork has Modern shell — reimplement only if UX gap |
| GitHub Pages pricing-supplement CI | Upstream release infra, not app behavior |
| Share / screenshot footer (#762, #785) | Swift-only; no macOS popover |

---

## Later (explicit blockers — post 1.3.1)

| Upstream | Blocker | When |
|----------|---------|------|
| Full ccusage removal (Amp/Kimi/Copilot/OpenCode) | Still on `host.ccusage.query` | 1.4.0+ when native scanners expand |
| GitHub Pages pricing-supplement CI | Upstream release infra | Optional fork infra |
| New providers on app update (#838) | Install-detection + settings migration on Tauri | **done in 1.4.0** (append+disable already; notify-once on update) |
| Reset All re-detects tools (#853) | Customize UX rewrite | 1.4.0+ |
| Customize undo / provider list in customize (#603, #797) | React customize stack rewrite | 1.4.0+ |

**1.3.1 shipped (hybrid):** native Claude/Codex log scanners + `model_pricing`; ccusage kept as fallback for Claude/Codex and primary for Amp/Kimi/Copilot/OpenCode. Cowork paths included in Claude scanner.

**Rule:** Upstream 0.7.2/0.7.3 items in Phase 1–2 tables above are **ship** in 1.3.1 unless listed under **Skip**.

---

## Release checklist (1.3.1)

1. Branch: `feat/port-openusage-0.7.3` (or current feature branch)
2. Phase 1 + 2 (**ship** rows) — done in tree
3. Bump **1.3.1** (`package.json`, `src-tauri/*`, crates) — done
4. `CHANGELOG.md` — cites upstream **v0.7.2 + v0.7.3** — done
5. `bun run test` + `bun run build:all-artifacts` — run locally before publish
6. `sign-and-publish-updater.sh v1.3.1` + onefile exe — **after user tests** (do not push until approved)

---

## PR split (optional)

| PR | Contents |
|----|----------|
| A | copilot org billing |
| B | grok weekly pool |
| C | antigravity + codex |
| D | UI: spend breakdown, unpriceable, notifications, pace jitter, claude warnings |
| E | onboarding auto-enable |

---

## 1.4.0 (reserved)

Per [VERSIONING.md](./VERSIONING.md): **MINOR** = new **CrossUsage** features (Linux/Windows-only UX, fork APIs, platform behavior). Do not spend 1.4.0 on upstream parity alone.

Examples that fit 1.4.0: native log scanners (fork epic), tray/Linux desktop integration, fork-specific provider, major customize rewrite.
