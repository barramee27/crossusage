## 2026-06-21

- Local HTTP API: per-device bearer token in `local-http-api-token` (app data); `OPTIONS` stays unauthenticated for CORS preflight; kept `Access-Control-Allow-Origin: *` because clients with the token still need browser preflight.
- Provider credentials: `provider_accounts.json` written `0600` on Unix only (no Windows ACL change in this pass).
- Plugin host `fs`/`sqlite`: reject `..` path segments before `expand_path`; absolute paths outside home still allowed for legitimate provider DB reads.
