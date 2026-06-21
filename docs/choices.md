## 2026-06-21

- Local HTTP API auth removed per product request; loopback API stays unauthenticated (binds `127.0.0.1` only).
- Provider credentials: `provider_accounts.json` written `0600` on Unix only.
- Plugin host `fs`/`sqlite`: reject `..` path segments before `expand_path`.
