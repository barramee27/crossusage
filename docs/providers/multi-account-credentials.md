# Multi-account credentials (Cursor & Claude)

CrossUsage can track **more than one** Cursor or Claude account by storing **OAuth tokens per account** in **Settings → Add account / Set credentials**. Those fields map to the same tokens the official apps already use on disk.

> **Security:** access and refresh tokens are full account credentials. Only copy them on a machine you trust. Revoke or rotate them in the provider if they leak.

## What each field means


| Field                      | Purpose                                                                                                                                                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Access token**           | Short-lived **JWT** sent as `Authorization: Bearer …` to the provider API.                                                                                                                                            |
| **Refresh token**          | Longer-lived secret used to **mint new access tokens**. Strongly recommended so CrossUsage can refresh without you re-copying from SQLite.                                                                            |
| **Session key** (optional) | **Cursor only:** CrossUsage accepts the same JWT here if you prefer to paste it in this box instead of **Access token** (the plugin treats either as the bearer token). Not a separate “session product” from Cursor. |


If you only paste an access token and it expires without a refresh token, probes will fail until you paste a fresh pair.

---

## Cursor — step by step

You need values that match what Cursor stores after a normal login.

### Option A — Cursor Desktop (`state.vscdb`) — macOS / Linux / Windows

1. **Sign in** to the Cursor account you want in the **Cursor** desktop app (one login per OS user profile is typical).
2. Find `**state.vscdb`** (VS Code global storage):
  - **macOS:** `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb`
  - **Linux:** `~/.config/Cursor/User/globalStorage/state.vscdb`
  - **Windows:** `%APPDATA%\Cursor\User\globalStorage\state.vscdb`
3. Read the keys (requires `sqlite3` installed, or a GUI SQLite tool):
  ```bash
   sqlite3 "/path/to/state.vscdb" "SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken' LIMIT 1;"
   sqlite3 "/path/to/state.vscdb" "SELECT value FROM ItemTable WHERE key = 'cursorAuth/refreshToken' LIMIT 1;"
  ```
4. In CrossUsage, paste:
  - **Access token** ← output of `cursorAuth/accessToken`
  - **Refresh token** ← output of `cursorAuth/refreshToken`
5. Give the row an **Account label** (e.g. `Work`) and save.

**Second Cursor account on the same PC:** the desktop app only keeps **one** login in that database at a time. To add another account without logging the first out, use a **separate OS user**, **VM**, or **second machine**, copy tokens from *that* profile’s `state.vscdb`, and paste them into a second CrossUsage provider row. See also Option B.

### Option B — Cursor CLI (`agent login`) — keychain

1. Install/use the Cursor CLI and run `**agent login`** for the account you want.
2. Tokens are stored in the OS **keychain** under services such as `cursor-access-token` and `cursor-refresh-token` (see [cursor.md](./cursor.md) § Authentication).
3. Export or read those entries (depends on OS), then paste into CrossUsage as **Access token** / **Refresh token**.

The CrossUsage **plugin** also reads SQLite first, then keychain, when you are **not** using pasted provider-account credentials.

### Deeper reference

- [cursor.md](./cursor.md) — paths, refresh endpoint, cookie format, troubleshooting.

---

## Claude (Claude Code) — step by step

You need the OAuth block Claude Code writes after login.

### Default location

1. **Sign in** with the intended Anthropic account in **Claude Code** (terminal flow that creates `~/.claude/.credentials.json`).
2. Open `**~/.claude/.credentials.json`** on the machine where that account is active.
3. Under `**claudeAiOauth`**, copy:
  - `accessToken` → CrossUsage **Access token**
  - `refreshToken` → CrossUsage **Refresh token**
4. If your CrossUsage build exposes token expiry, align it with `expiresAt` (unix **milliseconds** in the file).
5. Set an **Account label** and save.

**Second Claude account:** same as Cursor — one `~/.claude` per user profile is usually one login. Use another **OS user**, **container**, or **machine** to obtain the second JSON, then paste into a second CrossUsage row.

### Deeper reference

- [claude.md](./claude.md) — OAuth refresh URL, scopes, API shape.

---

## Upstream vs this fork

This tutorial lives in the **CrossUsage** repo. The same path may exist on **[upstream OpenUsage](https://github.com/robinebers/openusage)** after changes are merged.