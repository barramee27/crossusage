# Perplexity

> macOS: uses the Perplexity macOS app's local cache (no manual configuration).
> Windows/Linux: no local cache to read — paste a perplexity.ai session cookie instead (see below).

## Overview

- **Protocol:** HTTPS (JSON)
- **Auth (macOS):** Bearer token extracted from local Perplexity app cache request object
- **Auth (Windows/Linux):** `next-auth` session cookie, pasted via Settings → Providers → Perplexity → Set credentials
- **Data sources:**
  - `Cache.db` (local CFNetwork cache, macOS only) for token + app headers
  - REST API for balance + usage analytics

## Local Session (macOS only)

1. Install the Perplexity macOS app.
2. Open the app and sign in once.

The plugin checks for the Perplexity cache DB at:

- `~/Library/Containers/ai.perplexity.mac/Data/Library/Caches/ai.perplexity.mac/Cache.db`
- fallback: `~/Library/Caches/ai.perplexity.mac/Cache.db`

It reads the cached request object for:

- `https://www.perplexity.ai/api/user`

Then extracts the cached request's `Authorization: Bearer ...` token (and app-like headers).

The `Cache.db` this reads is a macOS CFNetwork cache produced by the native app's URL loading
system — the Windows and Linux Perplexity clients are Electron apps with a Chromium disk cache
(`Cache_Data/data_*`) instead, so there is no equivalent file to scrape on those platforms and no
Bearer token anywhere on disk. Both the website and the Electron app authenticate purely with
`next-auth` cookies.

## Session Cookie (Windows/Linux)

1. Open perplexity.ai in a browser, signed in.
2. DevTools → Network → reload → any request to `perplexity.ai/rest/...` → Request Headers → Cookie.
3. Copy the full cookie header (or at minimum `__Secure-next-auth.session-token`; including
   `cf_clearance` avoids a Cloudflare challenge on the first request).
4. Settings → Providers → Perplexity → Set credentials → paste into **Access token** → Save.

The plugin accepts either an existing `name=value; ...` cookie string or a bare token value (it is
wrapped as `__Secure-next-auth.session-token=<value>`). When the stored credential looks like a
cookie rather than a 3-segment Bearer JWT, the plugin sends it as a `Cookie` header against the
same REST API the website uses (`/rest/rate-limit/status`, `/rest/billing/credits`,
`/api/auth/session`) instead of scraping the local cache.

If no local session and no cookie credential is found, the plugin throws:

- `Not logged in. Auto-detect needs the macOS app; on Windows/Linux paste a perplexity.ai session
  cookie in Set credentials.`

## Balance + Usage (No Env Vars)

When a bearer token is present in the cache DB (macOS), the plugin calls:

- `GET https://www.perplexity.ai/rest/pplx-api/v2/groups` (resolve `<api_org_id>`)
- `GET https://www.perplexity.ai/rest/pplx-api/v2/groups/<api_org_id>` (read `customerInfo.balance`)
- `GET https://www.perplexity.ai/rest/pplx-api/v2/groups/<api_org_id>/usage-analytics` (sum `cost`)

When a session cookie is used instead (Windows/Linux), the plugin calls the same REST API the
website's account page uses:

- `GET https://www.perplexity.ai/rest/rate-limit/status` (per-mode availability: `pro_search`,
  `research`, `labs`, `agentic_research`)
- `GET https://www.perplexity.ai/rest/billing/credits` (`balance_cents` — purchased API credit
  balance, separate from subscription quota)
- `GET https://www.perplexity.ai/api/auth/session` (plan label from `user.subscription_tier`)

## Output

- **Plan**: `Pro` when `customerInfo.is_pro === true` (macOS) or `user.subscription_tier` (cookie)
- **Usage, macOS** (single progress bar line):
  - `limit = customerInfo.balance`
  - `used = sum(usage-analytics[].meter_event_summaries[].cost)`
  - `resetsAt` not set (UI shows `$<limit> limit`, no reset countdown)
- **Usage, cookie**: text lines, not a progress bar — the API only reports per-mode availability,
  not remaining counts, for most plans:
  - `API credits` — `$balance_cents / 100`, formatted as dollars
  - `Queries` / `Deep Research` / `Labs` — `<N> remaining` when `remaining_detail.kind === "exact"`,
    otherwise `available` / `not available`
  - `Agentic Research` — usually has an exact remaining count even on plans where the others don't

## Limitations

- Cache format is app-version dependent and may change (macOS).
- The REST endpoints used are not a public usage API (may change or break without notice).
- Some REST endpoints may be protected by Cloudflare; the plugin sends app-like headers from the cached request object, but may still be blocked (usage will be unavailable).
- Session cookies expire on logout/password change and are not refreshed automatically — re-paste
  when the plugin reports "Session cookie rejected."
