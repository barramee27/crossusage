# Antigravity

> Reverse-engineered from app bundle and language server binary. May change without notice.

Antigravity is built on Codeium/Windsurf-derived infrastructure and uses the same Codeium language server binary and Connect-RPC protocol. The discovery, port probing, and RPC endpoints are virtually identical to that stack. The key differences: Antigravity uses fraction-based per-model quota (not credits), and doesn't require an API key in the request metadata.

## Overview

- **Vendor:** Google (internal codename "Jetski")
- **Protocol:** Connect RPC v1 (JSON over HTTP) on local language server
- **Service:** `exa.language_server_pb.LanguageServerService`
- **Auth:** CSRF token from app/IDE process args; Google OAuth tokens from SQLite; `agy` token from macOS Keychain
- **Quota:** fraction (0.0–1.0, where 1.0 = 100% remaining)
- **Quota window:** 5 hours
- **Timestamps:** ISO 8601
- **Requires:** Antigravity app/IDE running, signed-in app/IDE SQLite credentials, or `agy` signed in

## Discovery

The Antigravity app/IDE language server listens on a random localhost port. Three values must be discovered from the running process.

```bash
# 1. Find process and extract CSRF token
ps -ax -o pid=,command= | grep -i '[l]anguage_server.*antigravity'
# Process name: language_server, language_server_macos, or language_server_macos_arm
# Match: --app_data_dir antigravity / antigravity-ide OR path contains /antigravity/
# Extract: --csrf_token <token>
# Extract: --extension_server_port <port>  (HTTP fallback)

# 2. Find listening ports
lsof -nP -iTCP -sTCP:LISTEN -a -p <pid>

# 3. Probe each port to find the Connect-RPC endpoint
POST https://127.0.0.1:<port>/.../GetUnleashData  → first 200 OK wins
```

Port and CSRF token change on every app/IDE restart. The LS may use HTTPS with a self-signed cert.

`agy` can also expose the same local service via an `agy` process. It has listening ports but no CSRF token or Antigravity marker flags, so discovery matches the `agy` executable directly.

## Headers (all local requests)

| Header | Required | Value |
|---|---|---|
| Content-Type | yes | `application/json` |
| Connect-Protocol-Version | yes | `1` |
| x-codeium-csrf-token | yes | `<csrf_token>` (from process args) |

## Endpoints

### GetUserStatus (primary)

Returns plan info and per-model quota for all models (Gemini, Claude, GPT-OSS) in a single call.

```
POST http://127.0.0.1:{port}/exa.language_server_pb.LanguageServerService/GetUserStatus
```

#### Request

```json
{
  "metadata": {
    "ideName": "antigravity",
    "extensionName": "antigravity",
    "ideVersion": "unknown",
    "locale": "en"
  }
}
```

#### Response

```jsonc
{
  "userStatus": {
    "planStatus": {
      "planInfo": {
        "planName": "Pro",                       // "Free" | "Pro" | "Teams" | "Ultra"
        "teamsTier": "TEAMS_TIER_PRO"
      }
    },

    "cascadeModelConfigData": {
      "clientModelConfigs": [
        {
          "label": "Gemini 3 Pro (High)",
          "modelOrAlias": { "model": "MODEL_PLACEHOLDER_M7" },
          "quotaInfo": {
            "remainingFraction": 1,              // 0.0–1.0
            "resetTime": "2026-02-07T14:23:01Z"
          }
        },
        {
          "label": "Claude Sonnet 4.5",
          "quotaInfo": { "remainingFraction": 1, "resetTime": "..." }
        },
        {
          "label": "Claude Opus 4.5 (Thinking)",
          "quotaInfo": { "remainingFraction": 1, "resetTime": "..." }
        },
        {
          "label": "GPT-OSS 120B (Medium)",
          "quotaInfo": { "remainingFraction": 1, "resetTime": "..." }
        }
        // ~7 models total, dynamic
      ]
    }
  }
}
```

### GetCommandModelConfigs (fallback)

Returns model configs with per-model quota only. No plan info, no email. Use when `GetUserStatus` fails.

```
POST http://127.0.0.1:{port}/exa.language_server_pb.LanguageServerService/GetCommandModelConfigs
```

#### Request

```json
{
  "metadata": {
    "ideName": "antigravity",
    "extensionName": "antigravity",
    "ideVersion": "unknown",
    "locale": "en"
  }
}
```

#### Response

```jsonc
{
  "clientModelConfigs": [
    // same shape as GetUserStatus.cascadeModelConfigData.clientModelConfigs
  ]
}
```

## Available Models

| Display Name | Internal ID | Provider |
|---|---|---|
| Gemini 3 Flash | 1018 | Google |
| Gemini 3 Pro (High) | 1008 | Google |
| Gemini 3 Pro (Low) | 1007 | Google |
| Claude Sonnet 4.5 | 333 | Anthropic (proxied) |
| Claude Sonnet 4.5 (Thinking) | 334 | Anthropic (proxied) |
| Claude Opus 4.6 (Thinking) | MODEL_PLACEHOLDER_M26 | Anthropic (proxied) |
| GPT-OSS 120B (Medium) | 342 | OpenAI (proxied) |

Models are dynamic — the list changes as Google adds/removes them. The plugin reads labels from the response, not a hardcoded list.

Interestingly, non-Google models (Claude, GPT-OSS) are proxied through Codeium/Windsurf infrastructure — Antigravity uses the same language server binary as Windsurf. The `GetUserStatus` response also includes `monthlyPromptCredits`, `monthlyFlowCredits`, and `monthlyFlexCreditPurchaseAmount` fields inherited from the Windsurf credit system, but these appear to be completely irrelevant to Antigravity's quota model which is purely fraction-based per model.

## Local SQLite Database

The Antigravity IDE stores auth credentials in VS Code-compatible state databases.

| Install | macOS | Linux | Windows |
| --- | --- | --- | --- |
| Current Antigravity IDE | `~/Library/Application Support/Antigravity IDE/User/globalStorage/state.vscdb` | `~/.config/Antigravity IDE/User/globalStorage/state.vscdb` | `%APPDATA%\Antigravity IDE\User\globalStorage\state.vscdb` |
| Legacy Antigravity | `~/Library/Application Support/Antigravity/User/globalStorage/state.vscdb` | `~/.config/Antigravity/User/globalStorage/state.vscdb` | `%APPDATA%\Antigravity\User\globalStorage\state.vscdb` |

The plugin only queries state databases that exist. Antigravity 2.x's `~/.gemini/antigravity/` directory contains agent and conversation data; it is not scanned for OAuth credentials.
- **Table:** `ItemTable` (`key` TEXT, `value` TEXT)

### antigravityUnifiedStateSync.oauthToken (sentinel envelope → protobuf)

Google OAuth tokens are stored under this key in a double-wrapped base64 envelope.

Decoding layers:

1. Base64-decode the DB `value` → `outer` bytes.
2. `outer` field 1 (wire type 2) → `wrapper` bytes.
3. Inside `wrapper`: field 1 is the sentinel string `"oauthTokenInfoSentinelKey"`; field 2 is `payload` bytes.
4. Inside `payload`: field 1 (wire type 2) is a **UTF-8 base64 string** (not raw bytes).
5. Base64-decode that string → final `OAuthTokenInfo` protobuf.

```protobuf
message OAuthTokenInfo {
  string access_token = 1;              // "ya29...." Google OAuth access token
  string token_type = 2;                // ignored
  string refresh_token = 3;             // "1//..." Google OAuth refresh token
  Timestamp expiry = 4;                 // field 4, wire type 2
}
message Timestamp {
  int64 seconds = 1;                    // Unix epoch seconds
}
```

The plugin decodes this using a minimal protobuf wire-format parser (varint, length-delimited, fixed32, fixed64). The access token is short-lived; the refresh token is used to obtain new access tokens via Google OAuth.

### Token Refresh

```
POST https://oauth2.googleapis.com/token
Content-Type: application/x-www-form-urlencoded

client_id=1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com
&client_secret=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
&refresh_token=<refresh_token>
&grant_type=refresh_token
```

Response: `{ "access_token": "ya29...", "expires_in": 3599 }`

Same client_id/secret is there in the Antigravity app bundle, used for the Google OAuth refresh token.

## Cloud Code API (fallback)

When the language server is not running, the plugin falls back to Google's Cloud Code API using a Google OAuth access token from the unified-state protobuf, a cached refreshed token, or the `agy` keychain account.

### retrieveUserQuotaSummary

```
POST https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary
Authorization: Bearer <access_token>
Content-Type: application/json
User-Agent: antigravity

{}
```

Base URLs tried in order:
1. `https://daily-cloudcode-pa.googleapis.com`
2. `https://cloudcode-pa.googleapis.com`

The response has two quota groups. The plugin exposes four progress lines: `Session`, `Weekly`, `Session — Claude and GPT Models`, and `Weekly — Claude and GPT Models`. A bucket's `remainingFraction` is converted to percentage used; `resetTime` is retained for the reset display.

### agy keychain fallback

`agy` stores its auth in the OS credential store under service `gemini`, account `antigravity`. OpenUsage reads that exact account only; after a `401`, it refreshes the OAuth token once before reporting a sign-in error.

`agy` uses the same `retrieveUserQuotaSummary` request and headers. The older `fetchAvailableModels`, `loadCodeAssist`, and `retrieveUserQuota` calls are compatibility fallbacks only if a Cloud Code deployment has no usable summary response.

#### Response shape

```jsonc
{
  "groups": [
    { "displayName": "Gemini Models", "buckets": [
      { "bucketId": "gemini-5h", "remainingFraction": 0.88, "resetTime": "..." },
      { "bucketId": "gemini-weekly", "remainingFraction": 0.98, "resetTime": "..." }
    ] },
    { "displayName": "Claude and GPT models", "buckets": [
      { "bucketId": "3p-5h", "remainingFraction": 1, "resetTime": "..." },
      { "bucketId": "3p-weekly", "remainingFraction": 1, "resetTime": "..." }
    ] }
  ]
}
```

Returns 401/403 if the token is invalid or expired — triggers reactive refresh.

## Plugin Strategy

1. Probe the Antigravity app/IDE language server.
2. Probe the `agy` local language server.
3. Read SQLite token candidates from both Antigravity state DB paths.
4. Try unexpired SQLite/cached access tokens with `retrieveUserQuotaSummary`.
5. Refresh SQLite refresh tokens only after auth failure or when no access token exists.
6. Read `agy` keychain token from service `gemini`, account `antigravity`, then call `retrieveUserQuotaSummary`.
7. If all strategies fail: error "Start Antigravity or run `agy` and try again."

Local spend tiles (Today / Yesterday / Last 30 Days / Usage Trend) come from read-only scans of `~/.gemini/antigravity-cli/conversations/*.db` via `host.antigravityLogs.queryDaily`. Missing DBs are `no_data`; quota probe still succeeds. Same tiles on **Antigravity CLI**; not **Antigravity IDE**.
