## 2026-06-21

- Local HTTP API: no bearer auth; block browser cross-origin via `Sec-Fetch-Site` / foreign `Origin`; omit CORS headers. `curl` unchanged.
- Provider credentials: `provider_accounts.json` written `0600` on Unix only.
- Plugin host `fs`/`sqlite`: reject `..` path segments before `expand_path`.
