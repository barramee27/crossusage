# Antigravity CLI

This provider reads Google Antigravity CLI (`agy`) usage from the Cloud Code quota APIs used by the CLI. It is separate from the Antigravity IDE and Gemini providers because `agy` stores state and auth differently.

Authenticate with `agy` before enabling this provider:

```sh
agy
```

OpenUsage reads non-secret context only from `~/.gemini/antigravity-cli/`. It does not read legacy Gemini OAuth files such as `~/.gemini/oauth_creds.json`.

Authentication comes from the OS credential store entry with service `gemini` and username `antigravity` (same as `agy` / zalando/go-keyring). On Linux this is the Secret Service (unlock your session keyring). The provider accepts raw tokens, JSON OAuth-style payloads (including `{"token":{"access_token":"..."}}` from `agy`), and `go-keyring-base64:` wrapped values when the store returns them.

Quota uses `POST https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary`, then `https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary`, with body `{}`, JSON headers, `Authorization: Bearer <accessToken>`, and `User-Agent: antigravity`. The provider renders `Session`, `Weekly`, `Session — Claude and GPT Models`, and `Weekly — Claude and GPT Models`. Older Cloud Code model/quota calls remain fallback only.

The CLI and IDE appear to share Google platform/model quota, but OpenUsage tracks Antigravity CLI separately so the auth path and implementation remain clear.
