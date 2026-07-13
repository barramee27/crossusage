(function () {
  const AUTH_FILE = "auth.json"
  const CONFIG_AUTH_PATHS = ["~/.config/codex", "~/.codex"]
  const KEYCHAIN_SERVICE = "Codex Auth"
  const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
  const REFRESH_URL = "https://auth.openai.com/oauth/token"
  const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage"
  const RESET_CREDITS_URL = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits"
  const CONSUME_RESET_URL = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume"
  const CREDIT_USD_RATE = 0.04
  const REFRESH_AGE_MS = 8 * 24 * 60 * 60 * 1000
  const ACCESS_TOKEN_REFRESH_WINDOW_MS = 5 * 60 * 1000
  const PERIOD_SESSION_MS = 5 * 60 * 60 * 1000    // 5 hours
  const PERIOD_WEEKLY_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
  const ERR_NOT_LOGGED_IN = "Not logged in. Run `codex` to authenticate."
  const ERR_SESSION_EXPIRED = "Session expired. Run `codex` to log in again."
  const ERR_TOKEN_CONFLICT = "Token conflict. Run `codex` to log in again."
  const ERR_TOKEN_REVOKED = "Token revoked. Run `codex` to log in again."
  const ERR_TOKEN_EXPIRED = "Token expired. Run `codex` to log in again."
  const ERR_USAGE_API_KEY = "Usage not available for API key."
  const ERR_USAGE_CONNECTION = "Usage request failed. Check your connection."
  const ERR_USAGE_AFTER_REFRESH = "Usage request failed after refresh. Try again."

  function joinPath(base, leaf) {
    return base.replace(/[\\/]+$/, "") + "/" + leaf
  }

  function readCodexHome(ctx) {
    if (!ctx.host.env || typeof ctx.host.env.get !== "function") {
      return null
    }

    try {
      const value = ctx.host.env.get("CODEX_HOME")
      if (typeof value !== "string") return null
      const trimmed = value.trim()
      return trimmed || null
    } catch (e) {
      ctx.host.log.warn("CODEX_HOME read failed: " + String(e))
      return null
    }
  }

  function decodeHexUtf8(hex) {
    try {
      const bytes = []
      for (let i = 0; i < hex.length; i += 2) {
        bytes.push(parseInt(hex.slice(i, i + 2), 16))
      }

      if (typeof TextDecoder !== "undefined") {
        try {
          return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes))
        } catch {}
      }

      let escaped = ""
      for (const b of bytes) {
        const h = b.toString(16)
        escaped += "%" + (h.length === 1 ? "0" + h : h)
      }
      return decodeURIComponent(escaped)
    } catch {
      return null
    }
  }

  function tryParseAuthJson(ctx, text) {
    if (!text) return null
    const parsed = ctx.util.tryParseJson(text)
    if (parsed) return parsed

    // Some keychain payloads can be returned as hex-encoded UTF-8 bytes.
    let hex = String(text).trim()
    if (hex.startsWith("0x") || hex.startsWith("0X")) hex = hex.slice(2)
    if (!hex || hex.length % 2 !== 0) return null
    if (!/^[0-9a-fA-F]+$/.test(hex)) return null

    const decoded = decodeHexUtf8(hex)
    if (!decoded) return null
    return ctx.util.tryParseJson(decoded)
  }

  function resolveAuthPaths(ctx) {
    const codexHome = readCodexHome(ctx)

    // If CODEX_HOME is set, use it
    if (codexHome) {
      return [joinPath(codexHome, AUTH_FILE)]
    }

    return CONFIG_AUTH_PATHS.map((basePath) => joinPath(basePath, AUTH_FILE))
  }

  function hasTokenLikeAuth(auth) {
    if (!auth || typeof auth !== "object") return false
    if (auth.tokens && auth.tokens.access_token) return true
    if (auth.OPENAI_API_KEY) return true
    return false
  }

  function hasAccessTokenAuth(auth) {
    return !!(auth && auth.tokens && auth.tokens.access_token)
  }

  function isAuthFallbackError(e) {
    if (typeof e !== "string") return false
    return (
      e === ERR_SESSION_EXPIRED ||
      e === ERR_TOKEN_CONFLICT ||
      e === ERR_TOKEN_REVOKED ||
      e === ERR_TOKEN_EXPIRED
    )
  }

  function loadAuthFromKeychain(ctx) {
    if (!ctx.host.keychain || typeof ctx.host.keychain.readGenericPassword !== "function") {
      return null
    }

    try {
      const value = ctx.host.keychain.readGenericPassword(KEYCHAIN_SERVICE)
      if (!value) return null
      const auth = tryParseAuthJson(ctx, value)
      if (!hasTokenLikeAuth(auth)) {
        ctx.host.log.warn("keychain has data but no codex auth payload")
        return null
      }
      ctx.host.log.info("auth loaded from keychain: " + KEYCHAIN_SERVICE)
      return { auth, authPath: null, source: "keychain" }
    } catch (e) {
      ctx.host.log.info("keychain read failed (may not exist): " + String(e))
      return null
    }
  }

  function saveAuth(ctx, authState) {
    const auth = authState && authState.auth ? authState.auth : null
    if (!auth) return false

    if (authState.source === "file" && authState.authPath) {
      ctx.host.fs.writeText(authState.authPath, JSON.stringify(auth, null, 2))
      return true
    }

    if (authState.source === "keychain") {
      if (!ctx.host.keychain || typeof ctx.host.keychain.writeGenericPassword !== "function") {
        ctx.host.log.warn("keychain write unsupported in this host")
        return false
      }
      // Use compact JSON to avoid newline-induced keychain encoding issues.
      ctx.host.keychain.writeGenericPassword(KEYCHAIN_SERVICE, JSON.stringify(auth))
      return true
    }

    if (authState.source === "provider-account") {
      const tokens = auth.tokens || {}
      return ctx.util.writeProviderCredential({
        accessToken: tokens.access_token || null,
        refreshToken: tokens.refresh_token || null,
      })
    }

    return false
  }

  function loadFileAuthCandidates(ctx) {
    const authPaths = resolveAuthPaths(ctx)
    const candidates = []
    const missingPaths = []
    for (const authPath of authPaths) {
      if (!ctx.host.fs.exists(authPath)) {
        missingPaths.push(authPath)
        continue
      }
      try {
        const text = ctx.host.fs.readText(authPath)
        const auth = tryParseAuthJson(ctx, text)
        if (!hasTokenLikeAuth(auth)) {
          ctx.host.log.warn("auth file exists but no valid codex auth payload: " + authPath)
          continue
        }
        ctx.host.log.info("auth loaded from file: " + authPath)
        candidates.push({ auth, authPath, source: "file" })
      } catch (e) {
        ctx.host.log.warn("auth file read failed: " + authPath + ": " + String(e))
      }
    }

    return { candidates, missingPaths }
  }

  function needsRefresh(ctx, auth, nowMs) {
    const accessToken = auth.tokens && auth.tokens.access_token
    if (accessToken && ctx.jwt && typeof ctx.jwt.decodePayload === "function") {
      const payload = ctx.jwt.decodePayload(accessToken)
      const expiresAtSeconds = payload && payload.exp
      if (typeof expiresAtSeconds === "number" && Number.isFinite(expiresAtSeconds)) {
        const expiresAtMs = expiresAtSeconds * 1000
        return expiresAtMs <= nowMs + ACCESS_TOKEN_REFRESH_WINDOW_MS
      }
    }

    if (!auth.last_refresh) return false
    const lastMs = ctx.util.parseDateMs(auth.last_refresh)
    if (lastMs === null) return false
    return nowMs - lastMs > REFRESH_AGE_MS
  }

  function reloadAuthState(ctx, authState) {
    let reloaded = null
    if (authState.source === "file" && authState.authPath) {
      try {
        const auth = tryParseAuthJson(ctx, ctx.host.fs.readText(authState.authPath))
        if (hasTokenLikeAuth(auth)) {
          reloaded = { auth, authPath: authState.authPath, source: "file" }
        }
      } catch (e) {
        ctx.host.log.warn("auth reload failed for file " + authState.authPath + ": " + String(e))
      }
    } else if (authState.source === "keychain") {
      reloaded = loadAuthFromKeychain(ctx)
    }

    if (!reloaded) return { status: "unchanged", authState }
    if (!hasAccessTokenAuth(reloaded.auth)) {
      return { status: "error", error: ERR_TOKEN_CONFLICT }
    }

    const expectedAccountId = authState.auth.tokens && authState.auth.tokens.account_id
    const reloadedAccountId = reloaded.auth.tokens && reloaded.auth.tokens.account_id
    if (expectedAccountId && reloadedAccountId !== expectedAccountId) {
      return { status: "error", error: ERR_TOKEN_CONFLICT }
    }

    if (JSON.stringify(reloaded.auth) !== JSON.stringify(authState.auth)) {
      ctx.host.log.info("auth changed during guarded reload, using updated credentials")
      return { status: "changed", authState: reloaded }
    }
    return { status: "unchanged", authState }
  }

  function refreshToken(ctx, authState) {
    const auth = authState.auth
    if (!auth.tokens || !auth.tokens.refresh_token) {
      ctx.host.log.warn("refresh skipped: no refresh token")
      return null
    }

    ctx.host.log.info("attempting token refresh")
    try {
      const resp = ctx.util.request({
        method: "POST",
        url: REFRESH_URL,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        bodyText:
          "grant_type=refresh_token" +
          "&client_id=" + encodeURIComponent(CLIENT_ID) +
          "&refresh_token=" + encodeURIComponent(auth.tokens.refresh_token),
        timeoutMs: 15000,
      })

      if (resp.status === 400 || resp.status === 401) {
        let code = null
        const body = ctx.util.tryParseJson(resp.bodyText)
        if (body) {
          code = body.error?.code || body.error || body.code
        }
        ctx.host.log.error("refresh failed: status=" + resp.status + " code=" + String(code))
        if (code === "refresh_token_expired") {
          throw ERR_SESSION_EXPIRED
        }
        if (code === "refresh_token_reused") {
          throw ERR_TOKEN_CONFLICT
        }
        if (code === "refresh_token_invalidated") {
          throw ERR_TOKEN_REVOKED
        }
        throw ERR_TOKEN_EXPIRED
      }
      if (resp.status < 200 || resp.status >= 300) {
        ctx.host.log.warn("refresh returned unexpected status: " + resp.status)
        return null
      }

      const body = ctx.util.tryParseJson(resp.bodyText)
      if (!body) {
        ctx.host.log.warn("refresh response not valid JSON")
        return null
      }
      const newAccessToken = body.access_token
      if (!newAccessToken) {
        ctx.host.log.warn("refresh response missing access_token")
        return null
      }

      auth.tokens.access_token = newAccessToken
      if (body.refresh_token) auth.tokens.refresh_token = body.refresh_token
      if (body.id_token) auth.tokens.id_token = body.id_token
      auth.last_refresh = new Date().toISOString()

      try {
        const saved = saveAuth(ctx, authState)
        if (saved) {
          ctx.host.log.info("refresh succeeded, auth persisted to " + authState.source)
        } else {
          ctx.host.log.warn("refresh succeeded but auth persistence was not possible")
        }
      } catch (e) {
        ctx.host.log.warn("refresh succeeded but failed to save auth: " + String(e))
      }

      return newAccessToken
    } catch (e) {
      if (typeof e === "string") throw e
      ctx.host.log.error("refresh exception: " + String(e))
      return null
    }
  }

  function fetchUsage(ctx, accessToken, accountId) {
    const headers = {
      Authorization: "Bearer " + accessToken,
      Accept: "application/json",
      "User-Agent": "OpenUsage",
    }
    if (accountId) {
      headers["ChatGPT-Account-Id"] = accountId
    }
    return ctx.util.request({
      method: "GET",
      url: USAGE_URL,
      headers,
      timeoutMs: 10000,
    })
  }

  function resetCreditHeaders(accessToken, accountId, withJson) {
    const headers = {
      Authorization: "Bearer " + accessToken,
      Accept: "application/json",
      "User-Agent": "OpenUsage",
      "OpenAI-Beta": "codex-1",
      originator: "Codex Desktop",
    }
    if (withJson) headers["Content-Type"] = "application/json"
    if (accountId) headers["ChatGPT-Account-Id"] = accountId
    return headers
  }

  function fetchResetCredits(ctx, accessToken, accountId) {
    return ctx.util.request({
      method: "GET",
      url: RESET_CREDITS_URL,
      headers: resetCreditHeaders(accessToken, accountId, false),
      timeoutMs: 10000,
    })
  }

  function consumeResetCredit(ctx, accessToken, accountId, creditId, redeemRequestId) {
    return ctx.util.request({
      method: "POST",
      url: CONSUME_RESET_URL,
      headers: resetCreditHeaders(accessToken, accountId, true),
      bodyText: JSON.stringify({
        redeem_request_id: redeemRequestId,
        credit_id: creditId,
      }),
      timeoutMs: 15000,
    })
  }

  function outcomeFromConsume(status, bodyText) {
    if (status < 200 || status >= 300) return "failed"
    const parsed = ctxUtilTryParse(bodyText)
    if (!parsed || typeof parsed.code !== "string") return "failed"
    if (parsed.code === "reset" || parsed.code === "already_redeemed") return "success"
    if (parsed.code === "nothing_to_reset") return "nothing_to_reset"
    if (parsed.code === "no_credit") return "no_credit"
    return "failed"
  }

  function ctxUtilTryParse(text) {
    try {
      return JSON.parse(String(text || ""))
    } catch {
      return null
    }
  }

  function parseExpiryMs(value) {
    if (typeof value === "string") {
      const ms = Date.parse(value)
      return Number.isFinite(ms) ? ms : null
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return value < 1e12 ? value * 1000 : value
    }
    return null
  }

  function creditIdForExpiry(body, expiryMs) {
    const credits = body && Array.isArray(body.credits) ? body.credits : []
    for (let i = 0; i < credits.length; i++) {
      const credit = credits[i]
      if (!credit || typeof credit !== "object") continue
      if (typeof credit.status === "string" && credit.status !== "available") continue
      const ms = parseExpiryMs(credit.expires_at)
      if (ms == null) continue
      if (Math.abs(ms - expiryMs) < 1000 && typeof credit.id === "string" && credit.id) {
        return credit.id
      }
    }
    return null
  }

  function collectAuthCandidates(ctx) {
    const out = []
    const providerAuth = loadAuthFromProviderAccount(ctx)
    if (providerAuth && providerAuth.auth && providerAuth.auth.tokens && providerAuth.auth.tokens.access_token) {
      out.push({
        accessToken: providerAuth.auth.tokens.access_token,
        accountId: providerAuth.auth.tokens.account_id || null,
      })
    }
    const fileAuth = loadFileAuthCandidates(ctx)
    for (let i = 0; i < fileAuth.candidates.length; i++) {
      const auth = fileAuth.candidates[i].auth
      if (auth && auth.tokens && auth.tokens.access_token) {
        out.push({
          accessToken: auth.tokens.access_token,
          accountId: auth.tokens.account_id || null,
        })
      }
    }
    const keychainAuth = loadAuthFromKeychain(ctx)
    if (keychainAuth && keychainAuth.auth && keychainAuth.auth.tokens && keychainAuth.auth.tokens.access_token) {
      out.push({
        accessToken: keychainAuth.auth.tokens.access_token,
        accountId: keychainAuth.auth.tokens.account_id || null,
      })
    }
    return out
  }

  /**
   * Claim a reset credit by expiry ISO. Returns outcome string:
   * success | nothing_to_reset | no_credit | failed
   */
  function claimResetCredit(ctx, args) {
    const expiresAtIso = args && args.expiresAtIso
    const redeemRequestId = args && args.redeemRequestId
    if (!expiresAtIso || !redeemRequestId) return "failed"
    const expiryMs = Date.parse(expiresAtIso)
    if (!Number.isFinite(expiryMs)) return "failed"

    const candidates = collectAuthCandidates(ctx)
    if (!candidates.length) {
      ctx.host.log.error("reset claim: no usable Codex credentials")
      return "failed"
    }

    let creditId = null
    let preferred = candidates
    let lastFailure = "no credential candidate authenticated"
    for (let i = 0; i < candidates.length; i++) {
      const creds = candidates[i]
      let list
      try {
        list = fetchResetCredits(ctx, creds.accessToken, creds.accountId)
      } catch (e) {
        ctx.host.log.error("reset claim: credit list fetch failed: " + String(e))
        return "failed"
      }
      if (list.status === 401 || list.status === 403) {
        lastFailure = "credit list fetch rejected (" + list.status + ")"
        continue
      }
      if (list.status < 200 || list.status >= 300) {
        ctx.host.log.error("reset claim: credit list fetch failed (" + list.status + ")")
        return "failed"
      }
      const body = ctxUtilTryParse(list.bodyText)
      if (!body) {
        ctx.host.log.error("reset claim: credit list body invalid")
        return "failed"
      }
      creditId = creditIdForExpiry(body, expiryMs)
      if (!creditId) return "no_credit"
      preferred = [creds].concat(candidates.filter(function (c) {
        return c.accessToken !== creds.accessToken || c.accountId !== creds.accountId
      }))
      break
    }
    if (!creditId) {
      ctx.host.log.error("reset claim: " + lastFailure)
      return "failed"
    }

    let lastRejection = null
    for (let j = 0; j < preferred.length; j++) {
      const creds = preferred[j]
      let resp
      try {
        resp = consumeResetCredit(ctx, creds.accessToken, creds.accountId, creditId, redeemRequestId)
      } catch (e) {
        ctx.host.log.error("reset claim: consume request failed: " + String(e))
        return "failed"
      }
      if (resp.status === 401 || resp.status === 403) {
        lastRejection = resp.status
        continue
      }
      const outcome = outcomeFromConsume(resp.status, resp.bodyText)
      if (outcome === "failed") {
        ctx.host.log.error("reset claim: consume failed (" + resp.status + ")")
      }
      return outcome
    }
    ctx.host.log.error("reset claim: consume rejected for every credential (last: " + (lastRejection || "none") + ")")
    return "failed"
  }

  function readPercent(value) {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }

  function readNumber(value) {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }

  function readCreditsRemaining(resp, data) {
    const credits = data && data.credits && typeof data.credits === "object" ? data.credits : null
    if (credits) {
      const bodyBalance = readNumber(credits.balance)
      if (bodyBalance !== null) return bodyBalance
      if (credits.has_credits === false) return 0
    }

    return readNumber(resp.headers["x-codex-credits-balance"])
  }

  function formatCodexPlan(ctx, planType) {
    const rawPlan = typeof planType === "string" ? planType.trim() : ""
    if (!rawPlan) return null
    if (rawPlan.toLowerCase() === "prolite") return "Pro 5x"
    if (rawPlan.toLowerCase() === "pro") return "Pro 20x"
    return ctx.fmt.planLabel(rawPlan) || null
  }

  function getResetsAtIso(ctx, nowSec, window) {
    if (!window) return null
    if (typeof window.reset_at === "number") {
      return ctx.util.toIso(window.reset_at)
    }
    if (typeof window.reset_after_seconds === "number") {
      return ctx.util.toIso(nowSec + window.reset_after_seconds)
    }
    return null
  }

  function resetAtMs(ctx, nowSec, window) {
    const iso = getResetsAtIso(ctx, nowSec, window)
    if (!iso) return NaN
    const ms = Date.parse(iso)
    return Number.isFinite(ms) ? ms : NaN
  }

  function readPeriodMs(window, fallbackMs) {
    if (window && typeof window.limit_window_seconds === "number") {
      return window.limit_window_seconds * 1000
    }
    return fallbackMs
  }

  function exactWindowKind(window) {
    if (!window || typeof window !== "object") return null
    if (typeof window.limit_window_seconds !== "number") return null
    const periodMs = window.limit_window_seconds * 1000
    if (periodMs === PERIOD_SESSION_MS) return "session"
    if (periodMs === PERIOD_WEEKLY_MS) return "weekly"
    return null
  }

  function windowCandidate(window, headerPercent, fallbackKind) {
    if (!window || typeof window !== "object") {
      if (headerPercent == null) return null
      return { window: {}, usedPercent: headerPercent, fallbackKind: fallbackKind }
    }
    const usedPercent = typeof window.used_percent === "number"
      ? window.used_percent
      : headerPercent
    if (usedPercent == null || typeof usedPercent !== "number") return null
    return { window: window, usedPercent: usedPercent, fallbackKind: fallbackKind }
  }

  function classifiedWindowLine(ctx, kind, label, candidates, nowSec) {
    let candidate = null
    for (let i = 0; i < candidates.length; i++) {
      if (exactWindowKind(candidates[i].window) === kind) {
        candidate = candidates[i]
        break
      }
    }
    if (!candidate) {
      for (let j = 0; j < candidates.length; j++) {
        if (exactWindowKind(candidates[j].window) == null && candidates[j].fallbackKind === kind) {
          candidate = candidates[j]
          break
        }
      }
    }
    if (!candidate) return null
    const defaultPeriodMs = kind === "session" ? PERIOD_SESSION_MS : PERIOD_WEEKLY_MS
    const periodMs = readPeriodMs(candidate.window, defaultPeriodMs)
    return ctx.line.progress({
      label: label,
      used: normalizedUsedPercent(ctx, candidate.usedPercent, candidate.window, nowSec, periodMs),
      limit: 100,
      format: { kind: "percent" },
      resetsAt: getResetsAtIso(ctx, nowSec, candidate.window),
      periodDurationMs: periodMs,
    })
  }

  function classifiedWindowLines(ctx, rateLimit, labels, headerPercents, nowSec) {
    const candidates = [
      windowCandidate(
        rateLimit && rateLimit.primary_window,
        headerPercents && headerPercents.primary,
        "session",
      ),
      windowCandidate(
        rateLimit && rateLimit.secondary_window,
        headerPercents && headerPercents.secondary,
        "weekly",
      ),
    ].filter(Boolean)

    return [
      classifiedWindowLine(ctx, "session", labels.session, candidates, nowSec),
      classifiedWindowLine(ctx, "weekly", labels.weekly, candidates, nowSec),
    ].filter(Boolean)
  }

  function isFreshRateLimitWindow(nowMs, resetsAtMs, periodDurationMs) {
    if (!Number.isFinite(resetsAtMs) || !Number.isFinite(periodDurationMs) || periodDurationMs <= 0) {
      return false
    }
    if (!Number.isFinite(nowMs) || nowMs >= resetsAtMs) return false
    const graceMs = Math.max(60_000, periodDurationMs * 0.01)
    return resetsAtMs - nowMs >= periodDurationMs - graceMs
  }

  function normalizedUsedPercent(ctx, used, window, nowSec, periodDurationMs) {
    if (typeof used !== "number" || !Number.isFinite(used)) return used
    const nowMs = nowSec * 1000
    const resetsAtMs = resetAtMs(ctx, nowSec, window)
    if (isFreshRateLimitWindow(nowMs, resetsAtMs, periodDurationMs) && used <= 1) {
      return 0
    }
    return used
  }

  function readResetCredits(data) {
    let src = data && data.rate_limit_reset_credits
    // Dedicated /rate-limit-reset-credits response is the credits object itself.
    if ((!src || typeof src !== "object") && data && typeof data === "object" && data.available_count != null) {
      src = data
    }
    if (!src || typeof src !== "object") return null
    if (src.available_count == null) return null
    const count = readNumber(src.available_count)
    if (count === null || count < 0) return null
    const expiries = []
    const credits = Array.isArray(src.credits) ? src.credits : []
    for (let i = 0; i < credits.length; i++) {
      const credit = credits[i]
      if (!credit || typeof credit !== "object") continue
      const status = credit.status
      if (status && status !== "available") continue
      const expiresAt = credit.expires_at
      let ms = NaN
      if (typeof expiresAt === "number") ms = expiresAt < 1e12 ? expiresAt * 1000 : expiresAt
      else if (typeof expiresAt === "string") ms = Date.parse(expiresAt)
      if (Number.isFinite(ms)) expiries.push(ms)
    }
    expiries.sort((a, b) => a - b)
    return { count: Math.floor(count), expiries: expiries }
  }

  function expiryStatusDot(expiries, nowMs) {
    if (!expiries.length) return "normal"
    const remaining = expiries[0] - nowMs
    const criticalMs = 48 * 60 * 60 * 1000
    const warningMs = 7 * 24 * 60 * 60 * 1000
    if (remaining <= criticalMs) return "critical"
    if (remaining <= warningMs) return "warning"
    return "normal"
  }

  function formatExpiryTooltip(expiries) {
    if (!expiries.length) return undefined
    const lines = ["Resets expire in:"]
    for (let i = 0; i < expiries.length; i++) {
      const ms = expiries[i] - Date.now()
      const abs = Math.max(0, ms)
      const hours = Math.floor(abs / (60 * 60 * 1000))
      const days = Math.floor(hours / 24)
      const remHours = hours % 24
      const label = days > 0 ? days + "d " + remHours + "h" : hours + "h"
      lines.push(String(i + 1) + ". " + label)
    }
    return lines.join("\n")
  }

  function dailyHasUsage(daily) {
    if (!Array.isArray(daily) || daily.length === 0) return false
    for (let i = 0; i < daily.length; i++) {
      const tokens = Number(daily[i] && daily[i].totalTokens)
      if (Number.isFinite(tokens) && tokens > 0) return true
    }
    return false
  }

  function queryCcusageDaily(ctx, queryOpts, provider, logPrefix) {
    if (!ctx.host.ccusage || typeof ctx.host.ccusage.query !== "function") {
      return { status: "no_runner", data: null }
    }
    const opts = Object.assign({}, queryOpts)
    if (provider) opts.provider = provider
    const result = ctx.host.ccusage.query(opts)
    if (!result || typeof result !== "object" || typeof result.status !== "string") {
      if (logPrefix) {
        ctx.host.log.warn(logPrefix + " ccusage returned invalid shape")
      }
      return { status: "runner_failed", data: null }
    }
    if (result.status !== "ok") {
      if (logPrefix) {
        ctx.host.log.info(logPrefix + " ccusage status=" + result.status)
      }
      return { status: result.status, data: null }
    }
    if (!result.data || !Array.isArray(result.data.daily)) {
      if (logPrefix) {
        ctx.host.log.warn(logPrefix + " ccusage ok but daily missing")
      }
      return { status: "runner_failed", data: null }
    }
    return { status: "ok", data: result.data }
  }

  function queryTokenUsage(ctx) {
    const since = new Date()
    // Inclusive range: today + previous 30 days = 31 calendar days.
    since.setDate(since.getDate() - 30)
    const y = since.getFullYear()
    const m = since.getMonth() + 1
    const d = since.getDate()
    const sinceStr = "" + y + (m < 10 ? "0" : "") + m + (d < 10 ? "0" : "") + d
    const queryOpts = { since: sinceStr }
    const codexHome = readCodexHome(ctx)
    if (codexHome) {
      queryOpts.homePath = codexHome
    }

    if (ctx.host.codexLogs && typeof ctx.host.codexLogs.queryDaily === "function") {
      try {
        const native = ctx.host.codexLogs.queryDaily(queryOpts)
        if (
          native &&
          native.status === "ok" &&
          native.data &&
          dailyHasUsage(native.data.daily)
        ) {
          return { status: "ok", data: native.data }
        }
        const reason = !native
          ? "no response"
          : native.status !== "ok"
            ? "status=" + String(native.status)
            : "empty daily"
        ctx.host.log.info("codexLogs " + reason + ", falling back to ccusage")
      } catch (e) {
        ctx.host.log.warn("codexLogs native scan failed, falling back to ccusage: " + String(e))
      }
    }

    return queryCcusageDaily(ctx, queryOpts, "codex", "codex")
  }

  function fmtTokens(n) {
    const abs = Math.abs(n)
    const sign = n < 0 ? "-" : ""
    const units = [
      { threshold: 1e9, divisor: 1e9, suffix: "B" },
      { threshold: 1e6, divisor: 1e6, suffix: "M" },
      { threshold: 1e3, divisor: 1e3, suffix: "K" },
    ]
    for (let i = 0; i < units.length; i++) {
      const unit = units[i]
      if (abs >= unit.threshold) {
        const scaled = abs / unit.divisor
        const formatted = scaled >= 10
          ? Math.round(scaled).toString()
          : scaled.toFixed(1).replace(/\.0$/, "")
        return sign + formatted + unit.suffix
      }
    }
    return sign + Math.round(abs).toString()
  }

  function dayKeyFromDate(date) {
    const year = date.getFullYear()
    const month = date.getMonth() + 1
    const day = date.getDate()
    return year + "-" + (month < 10 ? "0" : "") + month + "-" + (day < 10 ? "0" : "") + day
  }

  function dayKeyFromUsageDate(rawDate) {
    if (typeof rawDate !== "string") return null
    const value = rawDate.trim()
    if (!value) return null

    const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (isoMatch) {
      return isoMatch[1] + "-" + isoMatch[2] + "-" + isoMatch[3]
    }

    const isoDatePrefixMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[Tt\s]|$)/)
    if (isoDatePrefixMatch) {
      return isoDatePrefixMatch[1] + "-" + isoDatePrefixMatch[2] + "-" + isoDatePrefixMatch[3]
    }

    const compactMatch = value.match(/^(\d{4})(\d{2})(\d{2})$/)
    if (compactMatch) {
      return compactMatch[1] + "-" + compactMatch[2] + "-" + compactMatch[3]
    }

    const ms = Date.parse(value)
    if (!Number.isFinite(ms)) return null
    return dayKeyFromDate(new Date(ms))
  }

  function usageCostUsd(day) {
    if (!day || typeof day !== "object") return null

    if (day.totalCost != null) {
      const totalCost = Number(day.totalCost)
      if (Number.isFinite(totalCost)) return totalCost
    }

    if (day.costUSD != null) {
      const costUSD = Number(day.costUSD)
      if (Number.isFinite(costUSD)) return costUSD
    }

    return null
  }

  function costAndTokensLabel(data, opts) {
    const includeZeroTokens = !!(opts && opts.includeZeroTokens)
    const parts = []
    if (data.costUSD != null) parts.push("$" + data.costUSD.toFixed(2))
    if (data.tokens > 0 || (includeZeroTokens && data.tokens === 0)) {
      parts.push(fmtTokens(data.tokens) + " tokens")
    }
    return parts.join(" · ")
  }

  function modelTokenCount(modelUsage) {
    if (!modelUsage || typeof modelUsage !== "object") return 0
    const total = Number(modelUsage.totalTokens)
    if (Number.isFinite(total) && total > 0) return total

    const fields = [
      "inputTokens",
      "cachedInputTokens",
      "cacheCreationTokens",
      "cacheReadTokens",
      "outputTokens",
      "reasoningOutputTokens",
    ]
    let sum = 0
    for (let i = 0; i < fields.length; i++) {
      const n = Number(modelUsage[fields[i]])
      if (Number.isFinite(n) && n > 0) sum += n
    }
    return sum
  }

  function collectModelUsage(daily) {
    const totals = {}
    let totalTokens = 0
    for (let i = 0; i < daily.length; i++) {
      const day = daily[i]
      const models = day && day.models
      if (models && typeof models === "object") {
        const names = Object.keys(models)
        for (let j = 0; j < names.length; j++) {
          const name = names[j]
          const tokens = modelTokenCount(models[name])
          if (tokens <= 0) continue
          totals[name] = (totals[name] || 0) + tokens
          totalTokens += tokens
        }
      }

      const breakdowns = day && day.modelBreakdowns
      if (Array.isArray(breakdowns)) {
        for (let j = 0; j < breakdowns.length; j++) {
          const breakdown = breakdowns[j]
          const name = String(
            (breakdown && (breakdown.modelName || breakdown.name || breakdown.model)) || ""
          ).trim()
          if (!name) continue
          const tokens = modelTokenCount(breakdown)
          if (tokens <= 0) continue
          totals[name] = (totals[name] || 0) + tokens
          totalTokens += tokens
        }
      }
    }

    if (totalTokens <= 0) return []
    return Object.keys(totals)
      .map((name) => ({ name, tokens: totals[name], percent: (totals[name] / totalTokens) * 100 }))
      .sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name))
  }

  function percentLabel(value) {
    if (value > 0 && value < 0.1) return "<0.1%"
    const rounded = Math.round(value * 10) / 10
    return (rounded % 1 === 0 ? String(Math.round(rounded)) : String(rounded)) + "%"
  }

  function pushModelUsageLines(lines, ctx, daily) {
    const models = collectModelUsage(daily)
    for (let i = 0; i < models.length; i++) {
      const model = models[i]
      lines.push(ctx.line.text({
        label: model.name,
        value: percentLabel(model.percent),
      }))
    }
  }

  function usageDayLabel(rawDate) {
    const key = dayKeyFromUsageDate(rawDate)
    if (!key) return String(rawDate || "").slice(0, 10) || "Usage"
    const month = Number(key.slice(5, 7))
    const day = Number(key.slice(8, 10))
    return month + "/" + day
  }

  function collectUsageChartPoints(daily) {
    const points = []
    for (let i = 0; i < daily.length; i++) {
      const day = daily[i]
      const tokens = Number(day && day.totalTokens)
      if (!Number.isFinite(tokens) || tokens < 0) continue
      const key = dayKeyFromUsageDate(day.date)
      if (!key) continue
      points.push({
        key: key,
        label: usageDayLabel(day.date),
        value: tokens,
        valueLabel: fmtTokens(tokens) + " tokens",
      })
    }
    return points
      .sort((a, b) => a.key.localeCompare(b.key))
      .slice(-31)
      .map((point) => ({
        label: point.label,
        value: point.value,
        valueLabel: point.valueLabel,
      }))
  }

  function pushUsageChartLine(lines, ctx, daily) {
    const points = collectUsageChartPoints(daily)
    if (points.length === 0) return
    lines.push(ctx.line.barChart({
      label: "Usage Trend",
      points: points,
      note: "Estimated from local Codex logs for the selected account.",
      color: "#74AA9C",
    }))
  }

  function modelBreakdownForPeriod(daily) {
    const totals = {}
    for (let i = 0; i < daily.length; i++) {
      const day = daily[i]
      const models = day && day.models
      if (!models || typeof models !== "object") continue
      const names = Object.keys(models)
      for (let j = 0; j < names.length; j++) {
        const name = names[j]
        const usage = models[name]
        const tokens = modelTokenCount(usage)
        if (tokens <= 0) continue
        if (!totals[name]) totals[name] = { tokens: 0, costUsd: undefined }
        totals[name].tokens += tokens
        const cost = usage && usage.totalCost != null ? Number(usage.totalCost) : undefined
        if (Number.isFinite(cost) && cost > 0) {
          totals[name].costUsd = (totals[name].costUsd || 0) + cost
        }
      }
    }
    const keys = Object.keys(totals)
    if (keys.length === 0) return undefined
    let sumPct = 0
    const rows = keys.map((name) => {
      const row = totals[name]
      return {
        model: name,
        tokens: row.tokens,
        costUsd: row.costUsd,
      }
    }).sort((a, b) => b.tokens - a.tokens || a.model.localeCompare(b.model))
    const total = rows.reduce((sum, row) => sum + row.tokens, 0)
    if (total <= 0) return undefined
    for (let i = 0; i < rows.length; i++) {
      const pct = (rows[i].tokens / total) * 100
      rows[i].percent = i === rows.length - 1 ? Math.max(0, 100 - sumPct) : Math.round(pct * 10) / 10
      sumPct += rows[i].percent
      if (rows[i].costUsd == null || rows[i].costUsd <= 0) {
        delete rows[i].costUsd
      }
    }
    return rows
  }

  function modelBreakdownForDay(dayEntry) {
    if (!dayEntry || !dayEntry.models || typeof dayEntry.models !== "object") return undefined
    const names = Object.keys(dayEntry.models)
    if (names.length === 0) return undefined
    let total = 0
    const rows = []
    for (let i = 0; i < names.length; i++) {
      const name = names[i]
      const usage = dayEntry.models[name]
      const tokens = modelTokenCount(usage)
      if (tokens <= 0) continue
      total += tokens
      const cost = usage && usage.totalCost != null ? Number(usage.totalCost) : undefined
      rows.push({ model: name, tokens: tokens, costUsd: Number.isFinite(cost) ? cost : undefined })
    }
    if (total <= 0 || rows.length === 0) return undefined
    let sumPct = 0
    for (let i = 0; i < rows.length; i++) {
      const pct = (rows[i].tokens / total) * 100
      rows[i].percent = i === rows.length - 1 ? Math.max(0, 100 - sumPct) : Math.round(pct * 10) / 10
      sumPct += rows[i].percent
    }
    return rows.sort((a, b) => b.tokens - a.tokens || a.model.localeCompare(b.model))
  }

  function pushDayUsageLine(lines, ctx, label, dayEntry) {
    const tokens = Number(dayEntry && dayEntry.totalTokens) || 0
    const cost = usageCostUsd(dayEntry)
    const modelBreakdown = modelBreakdownForDay(dayEntry)
    if (tokens > 0) {
      lines.push(ctx.line.text({
        label: label,
        value: costAndTokensLabel({ tokens: tokens, costUSD: cost }),
        modelBreakdown: modelBreakdown,
      }))
      return
    }

    lines.push(ctx.line.text({
      label: label,
      value: costAndTokensLabel({ tokens: 0, costUSD: 0 }, { includeZeroTokens: true }),
      modelBreakdown: modelBreakdown,
    }))
  }

  function probeWithAuthState(ctx, initialAuthState) {
    let authState = initialAuthState
    let auth = authState.auth

    if (auth.tokens && auth.tokens.access_token) {
      const nowMs = Date.now()
      let accessToken = auth.tokens.access_token
      let accountId = auth.tokens.account_id
      let proactiveRefreshAuthError = null

      if (needsRefresh(ctx, auth, nowMs)) {
        ctx.host.log.info("token needs refresh")
        const reload = reloadAuthState(ctx, authState)
        if (reload.status === "error") throw reload.error
        authState = reload.authState
        auth = authState.auth
        accessToken = auth.tokens.access_token
        accountId = auth.tokens.account_id
        let refreshed = null
        if (needsRefresh(ctx, auth, nowMs)) {
          try {
            refreshed = refreshToken(ctx, authState)
          } catch (e) {
            if (!isAuthFallbackError(e)) throw e
            proactiveRefreshAuthError = e
            ctx.host.log.warn("proactive refresh failed, trying existing token: " + String(e))
          }
        }
        if (refreshed) {
          accessToken = refreshed
        } else if (!proactiveRefreshAuthError) {
          ctx.host.log.warn("proactive refresh failed, trying with existing token")
        }
      }

      let resp
      let didRefresh = false
      let didReloadAuth = false
      try {
        resp = ctx.util.retryOnceOnAuth({
          request: (token) => {
            try {
              return fetchUsage(ctx, token || accessToken, accountId)
            } catch (e) {
              ctx.host.log.error("usage request exception: " + String(e))
              if (didRefresh) {
                throw ERR_USAGE_AFTER_REFRESH
              }
              throw ERR_USAGE_CONNECTION
            }
          },
          refresh: () => {
            const reload = reloadAuthState(ctx, authState)
            if (reload.status === "error") throw reload.error
            if (reload.status === "changed") {
              authState = reload.authState
              auth = authState.auth
              accessToken = auth.tokens.access_token
              accountId = auth.tokens.account_id
              proactiveRefreshAuthError = null
              didReloadAuth = true
              ctx.host.log.info("usage returned 401, retrying with reloaded auth")
              return accessToken
            }
            if (proactiveRefreshAuthError) throw proactiveRefreshAuthError
            ctx.host.log.info("usage returned 401, attempting refresh")
            didRefresh = true
            return refreshToken(ctx, authState)
          },
        })
      } catch (e) {
        if (typeof e === "string") throw e
        ctx.host.log.error("usage request failed: " + String(e))
        throw ERR_USAGE_CONNECTION
      }

      if (didReloadAuth && ctx.util.isAuthStatus(resp.status)) {
        ctx.host.log.info("reloaded auth returned 401, attempting refresh")
        didRefresh = true
        const refreshed = refreshToken(ctx, authState)
        if (refreshed) {
          try {
            resp = fetchUsage(ctx, refreshed, accountId)
          } catch (e) {
            ctx.host.log.error("usage request exception after reloaded auth refresh: " + String(e))
            throw ERR_USAGE_AFTER_REFRESH
          }
        }
      }

      if (ctx.util.isAuthStatus(resp.status)) {
        ctx.host.log.error("usage returned auth error after all retries: status=" + resp.status)
        throw ERR_TOKEN_EXPIRED
      }

      if (resp.status < 200 || resp.status >= 300) {
        ctx.host.log.error("usage returned error: status=" + resp.status)
        throw "Usage request failed (HTTP " + String(resp.status) + "). Try again later."
      }

      ctx.host.log.info("usage fetch succeeded")

      const data = ctx.util.tryParseJson(resp.bodyText)
      if (data === null) {
        throw "Usage response invalid. Try again later."
      }

      const lines = []
      const nowSec = Math.floor(Date.now() / 1000)
      const rateLimit = data.rate_limit || null

      const headerPrimary = readPercent(resp.headers["x-codex-primary-used-percent"])
      const headerSecondary = readPercent(resp.headers["x-codex-secondary-used-percent"])

      // Classify Session vs Weekly by limit_window_seconds duration when present (#980).
      // Codex can move a sole weekly limit into the primary slot.
      const classified = classifiedWindowLines(
        ctx,
        rateLimit,
        { session: "Session", weekly: "Weekly" },
        { primary: headerPrimary, secondary: headerSecondary },
        nowSec,
      )
      for (let i = 0; i < classified.length; i++) lines.push(classified[i])

      if (Array.isArray(data.additional_rate_limits)) {
        for (const entry of data.additional_rate_limits) {
          if (!entry || !entry.rate_limit) continue
          const name = typeof entry.limit_name === "string" ? entry.limit_name : ""
          let shortName = name.replace(/^GPT-[\d.]+-Codex-/, "")
          if (!shortName) shortName = name || "Model"
          const sparkLines = classifiedWindowLines(
            ctx,
            entry.rate_limit,
            { session: shortName, weekly: shortName + " Weekly" },
            { primary: null, secondary: null },
            nowSec,
          )
          for (let s = 0; s < sparkLines.length; s++) lines.push(sparkLines[s])
        }
      }

      const resetCredits = readResetCredits(data)
      // Dedicated expiry list only when usage reported credits (count) — avoid an extra call otherwise.
      let mergedCredits = resetCredits
      if (accessToken && resetCredits !== null) {
        try {
          const creditsResp = fetchResetCredits(ctx, accessToken, accountId)
          if (creditsResp && creditsResp.status >= 200 && creditsResp.status < 300) {
            const creditsBody = ctxUtilTryParse(creditsResp.bodyText)
            const detailed = readResetCredits(creditsBody)
            if (detailed) {
              mergedCredits = {
                count: detailed.count,
                expiries: detailed.expiries.length ? detailed.expiries : resetCredits.expiries,
              }
            }
          }
        } catch (e) {
          ctx.host.log.warn("reset credits detail fetch failed: " + String(e))
        }
      }
      if (mergedCredits !== null) {
        const nowMs = Date.now()
        const expiryIsos = mergedCredits.expiries.map(function (ms) {
          return new Date(ms).toISOString()
        })
        lines.push(ctx.line.text({
          label: "Rate Limit Resets",
          value: mergedCredits.count + " available",
          statusDot: expiryStatusDot(mergedCredits.expiries, nowMs),
          expiryTooltip: formatExpiryTooltip(mergedCredits.expiries),
          resetCreditExpiries: expiryIsos,
        }))
      }

      const creditsRemaining = readCreditsRemaining(resp, data)
      if (creditsRemaining !== null) {
        const remaining = Math.max(0, Math.floor(creditsRemaining))
        const usdValue = (remaining * CREDIT_USD_RATE).toFixed(2)
        lines.push(ctx.line.text({
          label: "Credits",
          value: "$" + usdValue + " · " + remaining + " credits",
        }))
      }

      let plan = null
      if (data.plan_type) {
        const planLabel = formatCodexPlan(ctx, data.plan_type)
        if (planLabel) {
          plan = planLabel
        }
      }

      const tokenUsageResult = queryTokenUsage(ctx)
      if (tokenUsageResult.status === "ok") {
        const tokenUsage = tokenUsageResult.data
        const now = new Date()
        const todayKey = dayKeyFromDate(now)
        const yesterday = new Date(now.getTime())
        yesterday.setDate(yesterday.getDate() - 1)
        const yesterdayKey = dayKeyFromDate(yesterday)

        let todayEntry = null
        let yesterdayEntry = null
        for (let i = 0; i < tokenUsage.daily.length; i++) {
          const usageDayKey = dayKeyFromUsageDate(tokenUsage.daily[i].date)
          if (usageDayKey === todayKey) {
            todayEntry = tokenUsage.daily[i]
            continue
          }
          if (usageDayKey === yesterdayKey) {
            yesterdayEntry = tokenUsage.daily[i]
          }
        }

        pushDayUsageLine(lines, ctx, "Today", todayEntry)
        pushDayUsageLine(lines, ctx, "Yesterday", yesterdayEntry)

        let totalTokens = 0
        let totalCostNanos = 0
        let hasCost = false
        for (let i = 0; i < tokenUsage.daily.length; i++) {
          const day = tokenUsage.daily[i]
          const dayTokens = Number(day.totalTokens)
          if (Number.isFinite(dayTokens)) {
            totalTokens += dayTokens
          }

          const dayCost = usageCostUsd(day)
          if (dayCost != null) {
            totalCostNanos += Math.round(dayCost * 1e9)
            hasCost = true
          }
        }

        if (totalTokens > 0) {
          lines.push(ctx.line.text({
            label: "Last 30 Days",
            value: costAndTokensLabel({ tokens: totalTokens, costUSD: hasCost ? totalCostNanos / 1e9 : null }),
            modelBreakdown: modelBreakdownForPeriod(tokenUsage.daily),
          }))
        }

        pushUsageChartLine(lines, ctx, tokenUsage.daily)
        pushModelUsageLines(lines, ctx, tokenUsage.daily)
      }

      if (lines.length === 0) {
        lines.push(ctx.line.badge({ label: "Status", text: "No usage data", color: "#a3a3a3" }))
      }

      return { plan: plan, lines: lines }
    }

    if (auth.OPENAI_API_KEY) {
      throw ERR_USAGE_API_KEY
    }

    throw ERR_NOT_LOGGED_IN
  }

  function loadAuthFromProviderAccount(ctx) {
    const credential = ctx.util.readProviderCredential && ctx.util.readProviderCredential()
    if (!credential || !credential.accessToken) return null
    return {
      auth: {
        tokens: {
          access_token: credential.accessToken,
          refresh_token: credential.refreshToken || undefined,
        },
      },
      authPath: null,
      source: "provider-account",
    }
  }

  function probe(ctx) {
    const providerAuth = loadAuthFromProviderAccount(ctx)
    if (providerAuth) {
      try {
        return probeWithAuthState(ctx, providerAuth)
      } catch (e) {
        if (!isAuthFallbackError(e)) throw e
        ctx.host.log.warn("provider account auth failed: " + String(e))
      }
    }

    const fileAuth = loadFileAuthCandidates(ctx)
    let lastAuthFallbackError = null
    for (let i = 0; i < fileAuth.candidates.length; i++) {
      const authState = fileAuth.candidates[i]
      try {
        return probeWithAuthState(ctx, authState)
      } catch (e) {
        if (!isAuthFallbackError(e)) {
          throw e
        }
        lastAuthFallbackError = e
        ctx.host.log.warn("auth failed for file " + authState.authPath + ", trying next auth source: " + String(e))
      }
    }

    const keychainAuth = loadAuthFromKeychain(ctx)
    if (keychainAuth) {
      try {
        return probeWithAuthState(ctx, keychainAuth)
      } catch (e) {
        if (!isAuthFallbackError(e)) throw e
        lastAuthFallbackError = e
        ctx.host.log.warn("keychain auth failed: " + String(e))
      }
    }

    if (lastAuthFallbackError) throw lastAuthFallbackError

    for (const authPath of fileAuth.missingPaths) {
      ctx.host.log.warn("auth file not found: " + authPath)
    }

    ctx.host.log.error("probe failed: not logged in")
    throw ERR_NOT_LOGGED_IN
  }

  globalThis.__openusage_plugin = { id: "codex", probe, claimResetCredit }
})()
