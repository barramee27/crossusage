# Antigravity CLI

Tracks Google Antigravity CLI (`agy`) Cloud Code quota.

## Setup

Sign in with the CLI first:

```bash
agy
```

OpenUsage uses the CLI keychain login. It does not start a browser OAuth flow.

Access tokens expire (~1 hour). CrossUsage refreshes them with the stored `refresh_token` (same Google OAuth client as Antigravity IDE) and writes the updated JSON back to the credential store. If refresh fails, run `agy` again — you should not need to sign in every day when refresh tokens remain valid.

## Data Sources

- Non-secret CLI context: `~/.gemini/antigravity-cli/`
- Auth: OS credential store — service `gemini`, username/account `antigravity` (macOS Keychain, Linux Secret Service via GNOME Keyring/KWallet, Windows Credential Manager target `gemini:antigravity` per go-keyring). JSON shape from `agy` includes `token.access_token`, `token.refresh_token`, and `token.expiry`.
- Quota APIs (tries `daily-cloudcode-pa` then `cloudcode-pa`):
  - `POST …/v1internal:loadCodeAssist` — body includes `metadata` (IDE/client context)
  - `POST …/v1internal:fetchAvailableModels` — body `{}` only (`metadata` causes HTTP 400)
  - `POST …/v1internal:retrieveUserQuota` — body `{}`; primary quota source for `agy` when fetch is denied or empty

The provider does not read legacy Gemini OAuth files such as `~/.gemini/oauth_creds.json`.

## Quota Lines

- Gemini model IDs or labels containing `gemini` and `pro` -> `Gemini Pro`
- Gemini model IDs or labels containing `gemini` and `flash` -> `Gemini Flash`
- Other non-Gemini model pools -> `Claude`

When multiple buckets map to the same line, OpenUsage shows the lowest remaining fraction.

## Notes

The CLI and IDE appear to share Google platform/model quota. OpenUsage tracks Antigravity CLI separately because the CLI uses different state and auth paths.
