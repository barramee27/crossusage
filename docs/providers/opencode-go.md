# OpenCode Go

> Go plan meters come from OpenCode's official usage API when a local Go API key exists. Without a key, CrossUsage falls back to observed local SQLite spend.

## Overview

- **Provider ID:** `opencode-go`
- **Auth:** `~/.local/share/opencode/auth.json` (`opencode-go` entry `key`) or a Settings provider-account API key
- **Account meters:** `GET https://opencode.ai/zen/go/v1/usage` (`Authorization: Bearer <key>`)
- **Local fallback:** `~/.local/share/opencode/opencode.db` assistant `cost` rows (this machine only)

## Detection

The plugin enables when either:

- auth has a non-empty Go key, or
- local history already contains `opencode-go` assistant messages with numeric `cost`

## Data source

**With a key:** Session / Weekly / Monthly are **account-wide percents** from `/zen/go/v1/usage` (same numbers as the OpenCode dashboard), plus ISO `resetsAt`. Local SQLite is not used for those bars.

**Without a key:** bars are observed local dollar spend vs published Go caps (`$12` / `$30` / `$60`), clamped at 100%.

## API errors

| HTTP | Meaning |
|------|---------|
| 401 | Key rejected — sign into OpenCode Go again |
| 403 `EntitlementError` | No Go subscription on this key |
| other / unreachable | Fail loudly (no silent $0) |

## Window rules (local fallback only)

- `5h`: rolling last 5 hours
- `Weekly`: UTC Monday `00:00`
- `Monthly`: earliest local Go usage as subscription-style anchor

## Port

OpenUsage **v0.7.9** (#1097). CrossUsage 1.4.1.
