# Multi-account credentials

CrossUsage can track **more than one login per provider** (for example personal and work Cursor accounts). Each account is a separate row in Settings and on the dashboard, with its own probe instance id such as `cursor:work` or `openrouter:personal`.

**Scope (CrossUsage 1.3.1+):** every bundled provider except **Mock** supports **Add account** and **Set credentials** in Settings.

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

## Settings UI (all providers except Mock)

| Action | When |
| ------ | ---- |
| **Set credentials** | Paste or replace tokens for that row (base provider or extra account). |
| **Add account** | Base provider row only — creates `provider:label-slug` (e.g. `openrouter:work`). |
| **Rename** | Extra account rows — display label only. |
| **Remove account** | Extra account rows — removes row and stored credentials. |

**Dashboard:** each account has its own card/widget group. **Modern layout** uses metric ids like `cursor:work::Credits` (double colon).

**After restart:** account metadata is merged from encrypted `provider_accounts.json` into plugin settings; probes resolve the correct base provider for each instance.

### Credential fields

| Field | Purpose |
| ----- | ------- |
| **Account label** | Display name (e.g. `Work`). Builds instance id: `cursor` + `Work` → `cursor:work`. |
| **Access token** | API key or bearer JWT (most providers). |
| **Refresh token** | OAuth providers — strongly recommended. |
| **Session key** | **Cursor / Cursor Nightly only** — same JWT as access token if you prefer this box. |

Empty fields after reopening **Set credentials** are normal (secrets are never shown again).

### Universal paste flow

For any provider below:

1. CrossUsage → **Settings** → provider row → **Add account** (or **Set credentials** on the base row).
2. Enter **Account label**.
3. Paste values per that provider's section (**Access token** = API key for key-based providers).
4. **Save** — the row probes independently.

Pasted credentials **override** env vars and local files for **that instance only**.

---

## Step-by-step by provider

### Amp

1. Sign in to [Amp](https://ampcode.com/) and copy your API key (or read `~/.local/share/amp/secrets.json` → `apiKey@https://ampcode.com/`).
2. **Add account** → paste key in **Access token**.
3. Env fallback: none (file or pasted key only). See [amp.md](./amp.md).

### Antigravity

1. Sign in to the **Antigravity** app/IDE on the machine that holds the account (SQLite + keychain — see [antigravity.md](./antigravity.md)).
2. For a **second account**, use another OS user, VM, or machine; export OAuth tokens from that profile's Antigravity storage.
3. **Add account** → **Access token** = OAuth access token, **Refresh token** if available.
4. Antigravity must be running (or `agy` signed in) for local RPC discovery unless tokens alone suffice for your setup.

### Antigravity CLI

1. Run Antigravity CLI login for the target account on a machine/profile.
2. Copy access (and refresh) token from CLI auth storage — see [antigravity-cli.md](./antigravity-cli.md).
3. **Add account** → paste tokens.

### Antigravity IDE

Settings UI only — **credential injection not wired yet**. Use the **Antigravity** provider row for pasted tokens from the same Google account.

### Claude (Claude Code)

1. Sign in with the Anthropic account in **Claude Code** (`~/.claude/.credentials.json`).
2. Under **`claudeAiOauth`**, copy `accessToken` → **Access token**, `refreshToken` → **Refresh token**.
3. **Add account** → paste; set label (e.g. `Work`).
4. Second account: another OS user / machine with its own `~/.claude`. See [claude.md](./claude.md).

### Codex

1. Sign in with **Codex CLI** (`codex login` or ChatGPT OAuth flow).
2. Read auth JSON (first match wins):
   - `$CODEX_HOME/auth.json`
   - `~/.config/codex/auth.json`
   - `~/.codex/auth.json`
3. Copy `tokens.access_token` → **Access token**, `tokens.refresh_token` → **Refresh token**.
4. Second account: separate `CODEX_HOME` or machine. API-key-only auth does not support usage probe. See [codex.md](./codex.md).

### Command Code

1. Create an API key in the Command Code dashboard.
2. **Add account** → paste in **Access token**.
3. Env fallback: `COMMAND_CODE_API_KEY`. See [command-code.md](./command-code.md).

### Copilot

1. Authenticate **GitHub CLI**: `gh auth login` (scopes for Copilot), or copy a PAT with Copilot access.
2. Token sources: `gh:github.com` keychain entry, or `auth.json` fallback — see [copilot.md](./copilot.md).
3. **Add account** → **Access token** = GitHub token (`gho_…` / `github_pat_…`).
4. Second account: `gh auth login` under another OS user, or paste a second PAT.

### CrofAI

1. Get API key from CrofAI.
2. **Add account** → **Access token** = key.
3. Env fallback: `CROFAI_API_KEY`. See [crofai.md](./crofai.md).

### Cursor

1. Sign in to **Cursor** desktop for the target account.
2. Read `state.vscdb` (globalStorage):
   - **macOS:** `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb`
   - **Linux:** `~/.config/Cursor/User/globalStorage/state.vscdb`
   - **Windows:** `%APPDATA%\Cursor\User\globalStorage\state.vscdb`
3. ```bash
   sqlite3 "/path/to/state.vscdb" "SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken' LIMIT 1;"
   sqlite3 "/path/to/state.vscdb" "SELECT value FROM ItemTable WHERE key = 'cursorAuth/refreshToken' LIMIT 1;"
   ```
4. **Add account** → paste access + refresh; label e.g. `Work`.
5. **Or** Cursor CLI: `agent login` → keychain `cursor-access-token` / `cursor-refresh-token`.
6. Second account on same PC: separate OS user / VM / machine (one login per `state.vscdb`). See [cursor.md](./cursor.md).

### Cursor Nightly

Same as **Cursor**; Linux path: `~/.config/Cursor Nightly/User/globalStorage/state.vscdb`.

### DeepSeek

1. Create API key at [DeepSeek platform](https://platform.deepseek.com/).
2. **Add account** → **Access token** = key.
3. Env fallback: `DEEPSEEK_API_KEY`. See [deepseek.md](./deepseek.md).

### Devin

1. Run `devin auth login` or sign in to Devin desktop.
2. Copy session token from:
   - Linux/macOS: `~/.local/share/devin/credentials.toml`
   - Windows: `%LOCALAPPDATA%\devin\credentials.toml`
   - Or Devin app `state.vscdb` (`windsurfAuthStatus`) — see [devin.md](./devin.md).
3. **Add account** → **Access token** = session token.

### Factory (Droid)

1. Sign in with Factory CLI / app (`~/.factory/auth.v2.json` + `auth.v2.key`).
2. Copy OAuth `accessToken` / `refreshToken` from decrypted auth, or paste tokens from a machine where Factory is logged in.
3. **Add account** → paste access + refresh. See [factory.md](./factory.md).

### Fireworks AI

1. Create key at [Fireworks](https://fireworks.ai/).
2. **Add account** → **Access token** = key.
3. Env fallback: `FIREWORKS_API_KEY`. See [fireworks-ai.md](./fireworks-ai.md).

### Grok

1. Run `grok login` for the target account.
2. Read `~/.grok/auth.json` — copy access token (and refresh if present).
3. **Add account** → paste tokens.
4. Second account: another profile/machine with its own `~/.grok`. See [grok.md](./grok.md).

### JetBrains AI Assistant

Settings UI only — **credential injection not wired yet**. Usage still comes from local JetBrains auth when available.

### Kimi Code

1. Sign in with Kimi Code CLI (`~/.kimi/credentials/kimi-code.json`).
2. Copy `access_token` / `refresh_token` from that file.
3. **Add account** → paste. See [kimi.md](./kimi.md).

### Kiro

1. Sign in to **Kiro** (AWS CodeWhisperer-backed).
2. Token file: `~/.aws/sso/cache/kiro-auth-token.json`, or read from Kiro `state.vscdb` key `kiro.kiroAgent` — see [kiro.md](./kiro.md).
3. **Add account** → **Access token** (+ refresh if applicable).

### MiniMax

1. Create API key (global or CN endpoint per your plan).
2. **Add account** → **Access token** = key.
3. Env fallback: `MINIMAX_API_KEY`, `MINIMAX_CN_API_KEY`. See [minimax.md](./minimax.md).

### Neuralwatt

1. Create API key in Neuralwatt dashboard.
2. **Add account** → **Access token** = key.
3. Env fallback: `NEURALWATT_API_KEY`. See [neuralwatt.md](./neuralwatt.md).

### Ollama

1. If your Ollama Cloud / remote endpoint uses a key, copy it.
2. **Add account** → **Access token** = key (local-only Ollama may work without a key).
3. Env fallback: `OLLAMA_API_KEY`, `OLLAMA_HOST`. See [ollama.md](./ollama.md).

### OpenCode Go

1. Create API key in OpenCode Go settings.
2. **Add account** → **Access token** = key.
3. See [opencode-go.md](./opencode-go.md).

### OpenRouter

1. Create key at [openrouter.ai/keys](https://openrouter.ai/keys).
2. **Add account** → **Access token** = `sk-or-…` key (common multi-account use case: personal + work keys).
3. Env fallback: `OPENROUTER_API_KEY`, `OPENROUTER_KEY`; or `~/.config/openusage/openrouter.json`.

### Perplexity

1. Sign in to the **Perplexity** app (macOS cache is the default auto source).
2. For Linux/Windows or a second account: capture the `Authorization: Bearer …` token from browser devtools or the app's cached API request.
3. **Add account** → **Access token** = bearer token. See [perplexity.md](./perplexity.md).

### Synthetic

1. Get `syn_…` API key from Synthetic, or from `~/.crossusage/config.json` (`synthetic.apiKey`).
2. **Add account** → **Access token** = key.
3. Env fallback: `SYNTHETIC_API_KEY`. See [synthetic.md](./synthetic.md).

### Z.ai (GLM)

1. Create key at Z.ai / GLM platform.
2. **Add account** → **Access token** = key.
3. Env fallback: `ZAI_API_KEY`, `GLM_API_KEY`. See [zai.md](./zai.md).

### Mock

No credentials — dev/testing only.

---

## Quick reference matrix

| Provider | Paste in **Access token** | **Refresh token** | Env / file fallback |
| -------- | ------------------------- | ----------------- | ------------------- |
| Amp | API key | — | `~/.local/share/amp/secrets.json` |
| Antigravity | OAuth access | OAuth refresh | Local app SQLite / keychain |
| Antigravity CLI | OAuth access | OAuth refresh | CLI auth store |
| Antigravity IDE | — (not wired) | — | Use Antigravity row |
| Claude | OAuth access | OAuth refresh | `~/.claude/.credentials.json` |
| Codex | OAuth access | OAuth refresh | `~/.codex/auth.json`, etc. |
| Command Code | API key | — | `COMMAND_CODE_API_KEY` |
| Copilot | GitHub token | — | `gh auth` keychain |
| CrofAI | API key | — | `CROFAI_API_KEY` |
| Cursor / Nightly | JWT access | JWT refresh | `state.vscdb`, CLI keychain |
| DeepSeek | API key | — | `DEEPSEEK_API_KEY` |
| Devin | Session token | — | `credentials.toml`, `state.vscdb` |
| Factory | OAuth access | OAuth refresh | `~/.factory/auth.v2.json` |
| Fireworks AI | API key | — | `FIREWORKS_API_KEY` |
| Grok | CLI access | CLI refresh | `~/.grok/auth.json` |
| JetBrains AI Assistant | — (not wired) | — | Local IDE auth |
| Kimi | OAuth access | OAuth refresh | `~/.kimi/credentials/…` |
| Kiro | SSO / access | refresh if any | `kiro-auth-token.json`, `state.vscdb` |
| MiniMax | API key | — | `MINIMAX_API_KEY` |
| Neuralwatt | API key | — | `NEURALWATT_API_KEY` |
| Ollama | API key (if any) | — | `OLLAMA_API_KEY` |
| OpenCode Go | API key | — | plugin config |
| OpenRouter | API key | — | `OPENROUTER_API_KEY` |
| Perplexity | Bearer token | — | macOS app cache |
| Synthetic | API key | — | `SYNTHETIC_API_KEY` |
| Z.ai | API key | — | `ZAI_API_KEY` / `GLM_API_KEY` |

Plugins read **injected credentials first** (`readProviderCredential` / `readInjectedCredential`), then env vars and local auth files.

---

## Troubleshooting

| Symptom | Likely cause |
| ------- | ------------- |
| Account row missing after dev restart | Update to 1.3.1+ — bootstrap merges `provider_accounts.json` into settings. |
| Extra account shows `…` forever | Probe not running or bad tokens — re-save credentials; check instance id on dashboard. |
| Main account works, Work does not | Work tokens from wrong profile/machine — re-copy from where Work is logged in. |
| Save does nothing in dev | `VITE_PROVIDER_ACCOUNT_DEV_MOCK` enabled — disable and restart. |

---

## Fork vs upstream

This document describes **CrossUsage** ([barramee27/crossusage](https://github.com/barramee27/crossusage), `feat/linux-windows-native-support`, releases **1.3.x**). [Upstream OpenUsage](https://github.com/robinebers/openusage) may differ until ports are merged.
