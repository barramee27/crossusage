# Multi-account credentials

CrossUsage can track **more than one login per provider** (for example personal and work Cursor accounts). Each account is a separate row in Settings and on the dashboard, with its own probe instance id such as `cursor:work` or `openrouter:personal`.

**Scope (CrossUsage 1.3.1+):** every bundled provider except **Mock** supports **Add account** and **Set credentials** in Settings. OAuth-heavy providers (Cursor, Claude) still have step-by-step guides below; API-key providers accept a key or bearer token in the credential form.

## Storage and security

| Layer | What happens |
| ----- | ------------ |
| **On disk** | `provider_accounts.json` under your CrossUsage app data dir is **AES-256-GCM encrypted** (envelope format `crossusage-provider-accounts-v1`). |
| **Master key** | Stored in the OS secret store when available: macOS Keychain, Windows Credential Manager, Linux Secret Service. Falls back to a `0600` file in app data only when no secret service exists. |
| **Migration** | Legacy plaintext `provider_accounts.json` is encrypted automatically on first load after upgrading. |
| **In memory** | Plugins receive injected credentials per probe; they are not written back to plugin-local SQLite by CrossUsage. |

> **Treat tokens like passwords.** Only paste them on a machine you trust. Revoke or rotate in the provider console if they leak.

Dev builds: if `VITE_PROVIDER_ACCOUNT_DEV_MOCK` is set, **Set credentials** saves placeholder tokens only — remove it and restart to store real values.

---

## Settings UI

On each provider row (except Mock):

| Action | When |
| ------ | ---- |
| **Set credentials** | Always — paste or replace tokens for that row (base provider or extra account). |
| **Add account** | Base provider row only — creates a new instance (`provider:label-slug`) under that provider. |
| **Rename** | Extra account rows — changes the display label only. |
| **Remove account** | Extra account rows — removes settings row and stored credentials. |

**Dashboard:** each account appears as its own card/widget group. **Modern layout** uses metric ids like `cursor:work::Credits` (double colon) so labels with colons do not break parsing.

**After restart:** account metadata is merged from encrypted `provider_accounts.json` into plugin settings so rows do not disappear; probes use the correct base provider id for each instance.

---

## Credential fields

| Field | Purpose |
| ----- | ------- |
| **Account label** | Display name (e.g. `Work`). Used to build the instance id: `cursor` + label `Work` → `cursor:work`. |
| **Access token** | Bearer JWT or API key sent as `Authorization: Bearer …` (or provider-specific header via plugin). |
| **Refresh token** | Optional but recommended for OAuth providers so CrossUsage can refresh without re-copying from disk. |
| **Session key** | **Cursor / Cursor Nightly only:** optional second paste box; plugin accepts the same JWT here or in Access token. |

Empty fields in **Set credentials** after reopening the dialog are normal — saved secrets are never shown again. Paste only when replacing stored credentials.

---

## Provider matrix (1.3.1)

All rows support multi-account via Settings unless noted.

| Provider | Credential type | Notes |
| -------- | ----------------- | ----- |
| Amp | API key | `AMP_API_KEY` or pasted key. |
| Antigravity | OAuth / session | Uses local Antigravity auth; multi-account via separate logins on other profiles/machines. |
| Antigravity CLI | CLI session | Same pattern as Antigravity. |
| Antigravity IDE | — | Settings UI present; credential injection not wired yet — use base Antigravity row. |
| Claude | OAuth | See [Claude step-by-step](#claude-claude-code--step-by-step) and [claude.md](./claude.md). |
| Codex | OAuth / ChatGPT | Uses Codex/ChatGPT session; second account via another OS user or machine. |
| Command Code | API key | |
| Copilot | GitHub OAuth | Token from `gh auth` / Copilot subscription flow. |
| CrofAI | API key | |
| Cursor | OAuth (desktop/CLI) | See [Cursor step-by-step](#cursor--step-by-step) and [cursor.md](./cursor.md). |
| Cursor Nightly | OAuth | Same as Cursor; paths use `Cursor Nightly` config dir on Linux. |
| DeepSeek | API key | |
| Devin | API key | |
| Factory | API key | |
| Fireworks AI | API key | |
| Grok | Session / API | |
| JetBrains AI Assistant | — | Settings UI present; credential injection not wired yet. |
| Kimi | API key | |
| Kiro | API key | |
| MiniMax | API key | |
| Neuralwatt | API key | |
| Ollama | Local (optional key) | Multiple endpoints/keys as separate accounts if needed. |
| OpenCode Go | API key | |
| OpenRouter | API key | `OPENROUTER_API_KEY` or pasted key — common multi-account use case. |
| Perplexity | API key | |
| Synthetic | API key | |
| Z.ai | API key | |
| **Mock** | — | No credentials; dev/testing only. |

Plugins read **injected credentials first** (`readProviderCredential` / `readInjectedCredential`), then fall back to env vars and local auth files on disk.

---

## Cursor — step-by-step

You need values that match what Cursor stores after a normal login.

### Option A — Cursor Desktop (`state.vscdb`) — macOS / Linux / Windows

1. **Sign in** to the Cursor account you want in the **Cursor** desktop app.
2. Find **`state.vscdb`** (VS Code global storage):
   - **macOS:** `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb`
   - **Linux:** `~/.config/Cursor/User/globalStorage/state.vscdb` or `~/.config/Cursor Nightly/User/globalStorage/state.vscdb`
   - **Windows:** `%APPDATA%\Cursor\User\globalStorage\state.vscdb`
3. Read the keys (requires `sqlite3` or a GUI SQLite tool):
   ```bash
   sqlite3 "/path/to/state.vscdb" "SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken' LIMIT 1;"
   sqlite3 "/path/to/state.vscdb" "SELECT value FROM ItemTable WHERE key = 'cursorAuth/refreshToken' LIMIT 1;"
   ```
4. In CrossUsage → Settings → **Cursor** → **Add account** (or **Set credentials**):
   - **Access token** ← `cursorAuth/accessToken`
   - **Refresh token** ← `cursorAuth/refreshToken`
5. Set **Account label** (e.g. `Work`) and save.

**Second Cursor account on the same PC:** the desktop app usually keeps **one** login per `state.vscdb`. For a second account without logging the first out, use a **separate OS user**, **VM**, or **second machine**, copy tokens from that profile's database, and add a second CrossUsage row.

### Option B — Cursor CLI (`agent login`) — keychain

1. Run **`agent login`** for the account you want.
2. Tokens live in the OS keychain (`cursor-access-token`, `cursor-refresh-token` — see [cursor.md](./cursor.md)).
3. Export or read those entries, then paste into CrossUsage.

When you **do not** use pasted provider-account credentials, the Cursor plugin still reads SQLite first, then keychain.

### Deeper reference

- [cursor.md](./cursor.md) — paths, refresh endpoint, troubleshooting.

---

## Claude (Claude Code) — step-by-step

You need the OAuth block Claude Code writes after login.

### Default location

1. **Sign in** with the intended Anthropic account in **Claude Code** (creates `~/.claude/.credentials.json`).
2. Open **`~/.claude/.credentials.json`** on the machine where that account is active.
3. Under **`claudeAiOauth`**, copy:
   - `accessToken` → CrossUsage **Access token**
   - `refreshToken` → CrossUsage **Refresh token**
4. Set an **Account label** and save.

**Second Claude account:** one `~/.claude` per user profile is usually one login. Use another **OS user**, **container**, or **machine** for the second JSON, then **Add account** in CrossUsage.

### Deeper reference

- [claude.md](./claude.md) — OAuth refresh URL, scopes, API shape.

---

## API-key providers (quick path)

1. Settings → find the provider → **Add account** (or **Set credentials** on the base row).
2. Enter **Account label** and **Access token** (API key or bearer token).
3. Add **Refresh token** only if the provider issued one.
4. Save — the row probes independently on the dashboard.

Common env fallbacks (when no pasted credential): `OPENROUTER_API_KEY`, `FIREWORKS_API_KEY`, `PERPLEXITY_API_KEY`, etc. Pasted credentials **override** env for that account instance only.

---

## Troubleshooting

| Symptom | Likely cause |
| ------- | ------------- |
| Account row missing after dev restart | Fixed in 1.3.1 — bootstrap merges `provider_accounts.json` into settings. Update and restart. |
| Extra account shows `…` forever | Probe not running for instance — update to 1.3.1+; re-save credentials if tokens expired. |
| Main account works, Work does not | Work tokens wrong or from wrong `state.vscdb` profile — re-copy from the machine where Work is logged in. |
| Save seems to do nothing in dev | `VITE_PROVIDER_ACCOUNT_DEV_MOCK` enabled — disable and restart. |

---

## Fork vs upstream

This document describes **CrossUsage** ([barramee27/crossusage](https://github.com/barramee27/crossusage), branch `feat/linux-windows-native-support` and releases **1.3.x**). [Upstream OpenUsage](https://github.com/robinebers/openusage) may differ until ports are merged.
