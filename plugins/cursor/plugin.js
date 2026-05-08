(function () {
  const STATE_DB =
    "~/Library/Application Support/Cursor/User/globalStorage/state.vscdb"
  const KEYCHAIN_ACCESS_TOKEN_SERVICE = "cursor-access-token"
  const KEYCHAIN_REFRESH_TOKEN_SERVICE = "cursor-refresh-token"
  const BASE_URL = "https://api2.cursor.sh"
  const USAGE_URL = BASE_URL + "/aiserver.v1.DashboardService/GetCurrentPeriodUsage"
  const PLAN_URL = BASE_URL + "/aiserver.v1.DashboardService/GetPlanInfo"
  const REFRESH_URL = BASE_URL + "/oauth/token"
  const CREDITS_URL = BASE_URL + "/aiserver.v1.DashboardService/GetCreditGrantsBalance"
  const USAGE_LIMIT_GRANTS_URL =
    BASE_URL + "/aiserver.v1.DashboardService/GetUsageLimitStatusAndActiveGrants"
  const REST_USAGE_URL = "https://cursor.com/api/usage"
  const STRIPE_URL = "https://cursor.com/api/auth/stripe"
  const CLIENT_ID = "KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB"
  /** Must match `buildDevMockProviderCredentials` when `VITE_PROVIDER_ACCOUNT_DEV_MOCK` is enabled. */
  const CROSSUSAGE_DEV_MOCK_ACCESS = "crossusage-dev-mock-access-token"
  const CROSSUSAGE_DEV_MOCK_REFRESH = "crossusage-dev-mock-refresh-token"
  const CROSSUSAGE_DEV_MOCK_SESSION_PREFIX = "crossusage-dev-mock-session:"
  const REFRESH_BUFFER_MS = 5 * 60 * 1000 // refresh 5 minutes before expiration
  const LOGIN_HINT = "Sign in via Cursor app or run `agent login`."
  /** Connect RPC (api2.cursor.sh) — short product UA. */
  const CONNECT_CLIENT_USER_AGENT = "Cursor/1.0.0"
  /** cursor.com web dashboard style (some endpoints reject non-browser UAs). */
  const CURSOR_WEB_USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
  const CONNECT_USAGE_FALLBACK_FAILED_MSG =
    "Cursor Connect API rejected usage (HTTP 400/403), and cursor.com/api/usage had no usable data " +
    "(no request limits or plan usage). Open Cursor, sign in again, update the app, then retry. " +
    LOGIN_HINT

  function extractConnectUsageErrorDetail(ctx, bodyText) {
    var j = ctx.util.tryParseJson(bodyText)
    if (!j || typeof j !== "object") return null
    if (typeof j.message === "string" && j.message.length > 0 && j.message !== "Error") {
      return j.message.trim()
    }
    if (Array.isArray(j.details)) {
      for (var i = 0; i < j.details.length; i++) {
        var d = j.details[i]
        if (!d || typeof d !== "object") continue
        if (d.debug && d.debug.details && typeof d.debug.details.detail === "string") {
          return d.debug.details.detail.trim()
        }
        if (d.debug && typeof d.debug.detail === "string") return d.debug.detail.trim()
      }
    }
    return null
  }

  function buildConnectFallbackFailedMessage(connectDetail) {
    if (
      connectDetail &&
      String(connectDetail).indexOf("Usage summary is not enabled") >= 0
    ) {
      return (
        "Cursor reports \"Usage summary is not enabled\" for this account (GetCurrentPeriodUsage is gated off). " +
        "CrossUsage tried alternate APIs and cursor.com; check usage in the Cursor app (Settings → Account). " +
        LOGIN_HINT
      )
    }
    return CONNECT_USAGE_FALLBACK_FAILED_MSG
  }

  /**
   * Map undocumented GetUsageLimitStatusAndActiveGrants JSON toward GetCurrentPeriodUsage shape.
   */
  function normalizeLimitGrantsToUsageShape(raw) {
    if (!raw || typeof raw !== "object") return null
    var u = raw
    if (u.data && typeof u.data === "object") u = u.data
    if (u.result && typeof u.result === "object" && !u.planUsage && u.result.planUsage) {
      u = u.result
    }
    if (u.usage && typeof u.usage === "object") {
      if (u.usage.planUsage && !u.planUsage) {
        u = Object.assign({}, u.usage, { planUsage: u.usage.planUsage })
      } else if (!u.planUsage) {
        u = u.usage
      }
    }
    if (u.planUsage && typeof u.planUsage === "object") {
      coerceUsageNumbers(u)
      return u
    }
    if (u.limitStatus && typeof u.limitStatus === "object") {
      var ls = u.limitStatus
      var pu = {}
      if (ls.limit != null) pu.limit = ls.limit
      if (ls.remaining != null) pu.remaining = ls.remaining
      if (ls.totalSpend != null) pu.totalSpend = ls.totalSpend
      if (ls.totalPercentUsed != null) pu.totalPercentUsed = ls.totalPercentUsed
      if (Object.keys(pu).length > 0) {
        return { enabled: true, planUsage: pu }
      }
    }
    var pct = readFiniteNumber(u.totalPercentUsed)
    if (Number.isFinite(pct)) {
      return { enabled: true, planUsage: { totalPercentUsed: pct } }
    }
    return null
  }

  function getCursorDbPath(ctx) {
    let home = ctx.host.fs.homeDir
    if (!home && ctx.app && ctx.app.appDataDir) {
      const m = String(ctx.app.appDataDir).match(/^(.+)\/\.local\/share\/[^/]+$/)
      if (m) home = m[1]
    }

    // macOS
    const macPath = "~/Library/Application Support/Cursor/User/globalStorage/state.vscdb"
    // Linux
    const linuxPath = "~/.config/Cursor/User/globalStorage/state.vscdb"
    // Windows
    const winPath = "~/AppData/Roaming/Cursor/User/globalStorage/state.vscdb"

    if (ctx.host.fs.exists(macPath)) return macPath
    if (ctx.host.fs.exists(linuxPath)) return linuxPath
    if (ctx.host.fs.exists(winPath)) return winPath

    // Fallback: try explicit paths when homeDir is available (e.g. when ~ expansion fails in some launch contexts)
    if (home) {
      const linuxAbs = home + "/.config/Cursor/User/globalStorage/state.vscdb"
      const macAbs = home + "/Library/Application Support/Cursor/User/globalStorage/state.vscdb"
      const winAbs = home + "/AppData/Roaming/Cursor/User/globalStorage/state.vscdb"
      if (ctx.host.fs.exists(linuxAbs)) return linuxAbs
      if (ctx.host.fs.exists(macAbs)) return macAbs
      if (ctx.host.fs.exists(winAbs)) return winAbs
    }

    // Fallback to macPath if none found (original behavior)
    return macPath
  }

  function readStateValue(ctx, key) {
    try {
      const dbPath = getCursorDbPath(ctx)
      const sql =
        "SELECT value FROM ItemTable WHERE key = '" + key + "' LIMIT 1;"
      const json = ctx.host.sqlite.query(dbPath, sql)
      const rows = ctx.util.tryParseJson(json)
      if (!Array.isArray(rows)) {
        throw new Error("sqlite returned invalid json")
      }
      if (rows.length > 0 && rows[0].value) {
        return rows[0].value
      }
    } catch (e) {
      ctx.host.log.warn("sqlite read failed for " + key + ": " + String(e))
    }
    return null
  }

  function writeStateValue(ctx, key, value) {
    try {
      const dbPath = getCursorDbPath(ctx)
      // Escape single quotes in value for SQL
      const escaped = String(value).replace(/'/g, "''")
      const sql =
        "INSERT OR REPLACE INTO ItemTable (key, value) VALUES ('" +
        key +
        "', '" +
        escaped +
        "');"
      ctx.host.sqlite.exec(dbPath, sql)
      return true
    } catch (e) {
      ctx.host.log.warn("sqlite write failed for " + key + ": " + String(e))
      return false
    }
  }

  function readKeychainValue(ctx, service) {
    if (!ctx.host.keychain || typeof ctx.host.keychain.readGenericPassword !== "function") {
      return null
    }
    try {
      const value = ctx.host.keychain.readGenericPassword(service)
      if (typeof value !== "string") return null
      const trimmed = value.trim()
      return trimmed || null
    } catch (e) {
      ctx.host.log.info("keychain read failed for " + service + ": " + String(e))
      return null
    }
  }

  function writeKeychainValue(ctx, service, value) {
    if (!ctx.host.keychain || typeof ctx.host.keychain.writeGenericPassword !== "function") {
      ctx.host.log.warn("keychain write unsupported")
      return false
    }
    try {
      ctx.host.keychain.writeGenericPassword(service, String(value))
      return true
    } catch (e) {
      ctx.host.log.warn("keychain write failed for " + service + ": " + String(e))
      return false
    }
  }

  function loadAuthState(ctx) {
    const injected = readInjectedCredential(ctx)
    if (injected) return injected

    const sqliteAccessToken = readStateValue(ctx, "cursorAuth/accessToken")
    const sqliteRefreshToken = readStateValue(ctx, "cursorAuth/refreshToken")
    const sqliteMembershipTypeRaw = readStateValue(ctx, "cursorAuth/stripeMembershipType")
    const sqliteMembershipType = typeof sqliteMembershipTypeRaw === "string"
      ? sqliteMembershipTypeRaw.trim().toLowerCase()
      : null

    const keychainAccessToken = readKeychainValue(ctx, KEYCHAIN_ACCESS_TOKEN_SERVICE)
    const keychainRefreshToken = readKeychainValue(ctx, KEYCHAIN_REFRESH_TOKEN_SERVICE)

    const sqliteSubject = getTokenSubject(ctx, sqliteAccessToken)
    const keychainSubject = getTokenSubject(ctx, keychainAccessToken)
    const hasDifferentSubjects = !!sqliteSubject && !!keychainSubject && sqliteSubject !== keychainSubject
    const sqliteLooksFree = sqliteMembershipType === "free"

    if (sqliteAccessToken || sqliteRefreshToken) {
      if ((keychainAccessToken || keychainRefreshToken) && sqliteLooksFree && hasDifferentSubjects) {
        ctx.host.log.info("sqlite auth looks free and differs from keychain account; preferring keychain token")
        return {
          accessToken: keychainAccessToken,
          refreshToken: keychainRefreshToken,
          source: "keychain",
        }
      }

      return {
        accessToken: sqliteAccessToken,
        refreshToken: sqliteRefreshToken,
        source: "sqlite",
      }
    }

    if (keychainAccessToken || keychainRefreshToken) {
      return {
        accessToken: keychainAccessToken,
        refreshToken: keychainRefreshToken,
        source: "keychain",
      }
    }

    return {
      accessToken: null,
      refreshToken: null,
      source: null,
    }
  }

  function readInjectedCredential(ctx) {
    try {
      if (!ctx.host.credentials || typeof ctx.host.credentials.get !== "function") return null
      const raw = ctx.host.credentials.get()
      if (!raw) return null
      const credential = ctx.util.tryParseJson(String(raw))
      if (!credential) return null
      const accessToken = String(credential.accessToken || credential.sessionKey || "").trim()
      const refreshToken = String(credential.refreshToken || "").trim()
      if (!accessToken && !refreshToken) return null
      return {
        accessToken: accessToken || null,
        refreshToken: refreshToken || null,
        source: "provider-account",
      }
    } catch (e) {
      ctx.host.log.warn("provider account credential read failed: " + String(e))
      return null
    }
  }

  function isCrossusageDevMockCredential(accessToken, refreshToken) {
    const at = accessToken ? String(accessToken).trim() : ""
    const rt = refreshToken ? String(refreshToken).trim() : ""
    if (at === CROSSUSAGE_DEV_MOCK_ACCESS) return true
    if (rt === CROSSUSAGE_DEV_MOCK_REFRESH) return true
    if (at.indexOf(CROSSUSAGE_DEV_MOCK_SESSION_PREFIX) === 0) return true
    return false
  }

  function buildCrossusageDevMockProbeOutput(ctx) {
    ctx.host.log.info("crossusage dev mock: skipping Cursor API (no network)")
    // Labels must match plugin.json manifest lines so tray + overview filters never go empty.
    return {
      plan: "Dev mock",
      lines: [
        ctx.line.text({
          label: "Data source",
          value: "Mock (CrossUsage dev)",
          subtitle: "Placeholder tokens from Settings; api2.cursor.sh is not called.",
        }),
        ctx.line.progress({
          label: "Total usage",
          used: 35,
          limit: 100,
          format: { kind: "percent" },
        }),
        ctx.line.progress({
          label: "Credits",
          used: 250,
          limit: 1000,
          format: { kind: "dollars" },
        }),
        ctx.line.progress({
          label: "Requests",
          used: 42,
          limit: 1000,
          format: { kind: "count", suffix: " req" },
        }),
        ctx.line.progress({
          label: "Auto usage",
          used: 18,
          limit: 100,
          format: { kind: "percent" },
        }),
        ctx.line.progress({
          label: "API usage",
          used: 7,
          limit: 50,
          format: { kind: "percent" },
        }),
        ctx.line.progress({
          label: "On-demand",
          used: 1,
          limit: 10,
          format: { kind: "percent" },
        }),
      ],
    }
  }

  function getTokenSubject(ctx, token) {
    if (!token) return null
    const payload = ctx.jwt.decodePayload(token)
    if (!payload || typeof payload.sub !== "string") return null
    const subject = payload.sub.trim()
    return subject || null
  }

  function persistAccessToken(ctx, source, accessToken) {
    if (source === "provider-account") {
      try {
        if (ctx.host.credentials && typeof ctx.host.credentials.update === "function") {
          const update = { accessToken: accessToken || null }
          ctx.host.credentials.update(JSON.stringify(update))
          return true
        }
      } catch (e) {
        ctx.host.log.warn("provider account credential update failed: " + String(e))
      }
      return false
    }
    if (source === "keychain") {
      return writeKeychainValue(ctx, KEYCHAIN_ACCESS_TOKEN_SERVICE, accessToken)
    }
    return writeStateValue(ctx, "cursorAuth/accessToken", accessToken)
  }

  function getTokenExpiration(ctx, token) {
    const payload = ctx.jwt.decodePayload(token)
    if (!payload || typeof payload.exp !== "number") return null
    return payload.exp * 1000 // Convert to milliseconds
  }

  function needsRefresh(ctx, accessToken, nowMs) {
    if (!accessToken) return true
    const expiresAt = getTokenExpiration(ctx, accessToken)
    return ctx.util.needsRefreshByExpiry({
      nowMs,
      expiresAtMs: expiresAt,
      bufferMs: REFRESH_BUFFER_MS,
    })
  }

  function refreshToken(ctx, refreshTokenValue, source) {
    if (!refreshTokenValue) {
      ctx.host.log.warn("refresh skipped: no refresh token")
      return null
    }

    ctx.host.log.info("attempting token refresh")
    try {
      const resp = ctx.util.request({
        method: "POST",
        url: REFRESH_URL,
        headers: { "Content-Type": "application/json" },
        bodyText: JSON.stringify({
          grant_type: "refresh_token",
          client_id: CLIENT_ID,
          refresh_token: refreshTokenValue,
        }),
        timeoutMs: 15000,
      })

      if (resp.status === 400 || resp.status === 401) {
        let errorInfo = null
        errorInfo = ctx.util.tryParseJson(resp.bodyText)
        const shouldLogout = errorInfo && errorInfo.shouldLogout === true
        ctx.host.log.error("refresh failed: status=" + resp.status + " shouldLogout=" + shouldLogout)
        if (shouldLogout) {
          throw "Session expired. " + LOGIN_HINT
        }
        throw "Token expired. " + LOGIN_HINT
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

      // Check if server wants us to logout
      if (body.shouldLogout === true) {
        ctx.host.log.error("refresh response indicates shouldLogout=true")
        throw "Session expired. " + LOGIN_HINT
      }

      const newAccessToken = body.access_token
      if (!newAccessToken) {
        ctx.host.log.warn("refresh response missing access_token")
        return null
      }

      // Persist updated access token to source where auth was loaded from.
      persistAccessToken(ctx, source, newAccessToken)
      ctx.host.log.info("refresh succeeded, token persisted")

      // Note: Cursor refresh returns access_token which is used as both
      // access and refresh token in some flows
      return newAccessToken
    } catch (e) {
      if (typeof e === "string") throw e
      ctx.host.log.error("refresh exception: " + String(e))
      return null
    }
  }

  function connectPost(ctx, url, token) {
    return ctx.util.request({
      method: "POST",
      url: url,
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        "Connect-Protocol-Version": "1",
        Accept: "application/json",
        "User-Agent": CONNECT_CLIENT_USER_AGENT,
      },
      bodyText: "{}",
      timeoutMs: 10000,
    })
  }

  /** Auth0-style `sub` is often `provider|opaqueId`; use last segment so `a|b|c` maps to `c`. */
  function userIdFromJwtSub(sub) {
    if (!sub || typeof sub !== "string") return null
    var parts = String(sub).trim().split("|")
    if (parts.length >= 2) {
      var last = parts[parts.length - 1]
      return last ? last.trim() : parts[0].trim()
    }
    return parts[0] ? parts[0].trim() : null
  }

  function buildSessionToken(ctx, accessToken) {
    var payload = ctx.jwt.decodePayload(accessToken)
    if (!payload || !payload.sub) return null
    var userId = userIdFromJwtSub(payload.sub)
    if (!userId) return null
    return { userId: userId, sessionToken: userId + "%3A%3A" + accessToken }
  }

  function coerceNumericField(obj, key) {
    if (!obj || typeof obj !== "object") return
    var v = obj[key]
    if (typeof v === "string" && v.trim() !== "") {
      var n = parseFloat(v)
      if (Number.isFinite(n)) obj[key] = n
    }
  }

  function coercePlanUsageObject(pu) {
    if (!pu || typeof pu !== "object") return
    var keys = [
      "limit",
      "remaining",
      "totalSpend",
      "includedSpend",
      "bonusSpend",
      "totalPercentUsed",
      "autoPercentUsed",
      "apiPercentUsed",
    ]
    for (var i = 0; i < keys.length; i++) {
      coerceNumericField(pu, keys[i])
    }
  }

  function coerceUsageNumbers(u) {
    if (!u || typeof u !== "object") return
    coerceNumericField(u, "billingCycleStart")
    coerceNumericField(u, "billingCycleEnd")
    if (u.planUsage) coercePlanUsageObject(u.planUsage)
    if (u.spendLimitUsage && typeof u.spendLimitUsage === "object") {
      var su = u.spendLimitUsage
      coerceNumericField(su, "individualLimit")
      coerceNumericField(su, "individualUsed")
      coerceNumericField(su, "individualRemaining")
      coerceNumericField(su, "pooledLimit")
      coerceNumericField(su, "pooledUsed")
      coerceNumericField(su, "pooledRemaining")
    }
  }

  /** Unwrap `{ data: ... }` / `{ usage: ... }` and coerce numeric strings from the dashboard API. */
  function normalizeRestUsagePayload(raw) {
    if (!raw || typeof raw !== "object") return null
    var u = raw
    if (u.data && typeof u.data === "object") u = u.data
    if (u.result && typeof u.result === "object" && !u.planUsage && u.result.planUsage) {
      u = u.result
    } else if (u.usage && typeof u.usage === "object" && !u.planUsage && u.usage.planUsage) {
      u = u.usage
    }
    coerceUsageNumbers(u)
    return u
  }

  function restUsageLooksPromising(u) {
    if (!u || typeof u !== "object") return false
    var g4 = u["gpt-4"]
    if (g4 && typeof g4.maxRequestUsage === "number" && g4.maxRequestUsage > 0) return true
    if (isConnectUsageRestShape(u)) return true
    return false
  }

  function fetchRequestBasedUsage(ctx, accessToken) {
    var session = buildSessionToken(ctx, accessToken)
    if (!session) {
      ctx.host.log.warn("request-based: cannot build session token")
      return null
    }
    var commonHeaders = {
      Authorization: "Bearer " + accessToken,
      Cookie: "WorkosCursorSessionToken=" + session.sessionToken,
      Accept: "application/json",
      Origin: "https://cursor.com",
      Referer: "https://cursor.com/dashboard",
      "User-Agent": CURSOR_WEB_USER_AGENT,
    }
    var urls = [
      REST_USAGE_URL + "?user=" + encodeURIComponent(session.userId),
      REST_USAGE_URL,
    ]
    var fallback = null
    for (var i = 0; i < urls.length; i++) {
      try {
        var resp = ctx.util.request({
          method: "GET",
          url: urls[i],
          headers: commonHeaders,
          timeoutMs: 15000,
        })
        if (resp.status < 200 || resp.status >= 300) {
          ctx.host.log.warn(
            "request-based usage returned status=" + resp.status + " url=" + urls[i]
          )
          continue
        }
        var parsed = ctx.util.tryParseJson(resp.bodyText)
        var norm = normalizeRestUsagePayload(parsed)
        if (norm && restUsageLooksPromising(norm)) {
          return norm
        }
        if (norm && !fallback) fallback = norm
      } catch (e) {
        ctx.host.log.warn("request-based usage fetch failed: " + String(e))
      }
    }
    return fallback
  }

  function fetchStripePayload(ctx, accessToken) {
    var session = buildSessionToken(ctx, accessToken)
    if (!session) {
      ctx.host.log.warn("stripe: cannot build session token")
      return null
    }
    try {
      var resp = ctx.util.request({
        method: "GET",
        url: STRIPE_URL,
        headers: {
          Authorization: "Bearer " + accessToken,
          Cookie: "WorkosCursorSessionToken=" + session.sessionToken,
          Accept: "application/json",
          Origin: "https://cursor.com",
          Referer: "https://cursor.com/dashboard",
          "User-Agent": CURSOR_WEB_USER_AGENT,
        },
        timeoutMs: 10000,
      })
      if (resp.status < 200 || resp.status >= 300) {
        ctx.host.log.warn("stripe payload returned status=" + resp.status)
        return null
      }
      return ctx.util.tryParseJson(resp.bodyText)
    } catch (e) {
      ctx.host.log.warn("stripe payload fetch failed: " + String(e))
      return null
    }
  }

  function fetchStripeBalance(ctx, accessToken) {
    var stripe = fetchStripePayload(ctx, accessToken)
    if (!stripe) return null
    var customerBalanceCents = Number(stripe.customerBalance)
    if (!Number.isFinite(customerBalanceCents)) return null
    // Stripe stores customer credits as a negative balance.
    return customerBalanceCents < 0 ? Math.abs(customerBalanceCents) : 0
  }

  function buildPartialStripeSubscriptionResult(ctx, accessToken, connectDetail) {
    var stripe = fetchStripePayload(ctx, accessToken)
    if (!stripe || typeof stripe !== "object") return null
    var mt = stripe.membershipType
    var ss = stripe.subscriptionStatus
    if (!mt && !ss) return null
    var tier = typeof mt === "string" ? mt : "unknown"
    var sub = typeof ss === "string" ? ss : "unknown"
    var msg = "Plan: " + tier + ", subscription: " + sub + ". "
    if (connectDetail && String(connectDetail).indexOf("Usage summary is not enabled") >= 0) {
      msg +=
        "Cursor does not expose usage summary for this account via API. Open Cursor → Settings → Account to see usage."
    } else {
      msg += "Usage meters unavailable from API; open Cursor → Account / Usage."
    }
    return {
      plan: null,
      lines: [
        ctx.line.text({
          label: "Account",
          value: msg,
        }),
      ],
    }
  }

  function readFiniteNumber(v) {
    if (typeof v === "number" && Number.isFinite(v)) return v
    if (typeof v === "string" && v.trim() !== "") {
      var n = parseFloat(v)
      if (Number.isFinite(n)) return n
    }
    return NaN
  }

  function getConnectUsageMetricFlags(usage) {
    const hasPlanUsage = !!usage.planUsage
    const pu = usage.planUsage
    const limitN = hasPlanUsage ? readFiniteNumber(pu.limit) : NaN
    const pctN = hasPlanUsage ? readFiniteNumber(pu.totalPercentUsed) : NaN
    const hasPlanUsageLimit = hasPlanUsage && Number.isFinite(limitN)
    const planUsageLimitMissing = hasPlanUsage && !hasPlanUsageLimit
    const hasTotalUsagePercent = hasPlanUsage && Number.isFinite(pctN)
    return {
      hasPlanUsage: hasPlanUsage,
      hasPlanUsageLimit: hasPlanUsageLimit,
      planUsageLimitMissing: planUsageLimitMissing,
      hasTotalUsagePercent: hasTotalUsagePercent,
      pu: pu,
    }
  }

  /**
   * Build plan label + progress lines from a Connect-shaped usage object (same JSON as
   * GetCurrentPeriodUsage). Returns null when a team account needs the legacy request-based REST path.
   */
  function buildPlanAndLinesFromConnectStyleUsage(ctx, usage, planName, options) {
    options = options || {}
    const creditGrants = options.creditGrants
    const stripeBalanceCents = options.stripeBalanceCents || 0

    coerceUsageNumbers(usage)

    if (usage.enabled === false || !usage.planUsage) {
      throw "No active Cursor subscription."
    }

    const normalizedPlanName = typeof planName === "string"
      ? planName.toLowerCase()
      : ""

    const flags = getConnectUsageMetricFlags(usage)
    const hasPlanUsageLimit = flags.hasPlanUsageLimit
    const hasTotalUsagePercent = flags.hasTotalUsagePercent
    const pu = flags.pu

    if (!hasPlanUsageLimit && !hasTotalUsagePercent) {
      throw "Total usage limit missing from API response."
    }

    let plan = null
    if (planName) {
      const planLabel = ctx.fmt.planLabel(planName)
      if (planLabel) {
        plan = planLabel
      }
    }

    const lines = []

    const hasCreditGrants = creditGrants && creditGrants.hasCreditGrants === true
    const grantTotalCents = hasCreditGrants ? parseInt(creditGrants.totalCents, 10) : 0
    const grantUsedCents = hasCreditGrants ? parseInt(creditGrants.usedCents, 10) : 0
    const hasValidGrantData = hasCreditGrants &&
      grantTotalCents > 0 &&
      !isNaN(grantTotalCents) &&
      !isNaN(grantUsedCents)
    const combinedTotalCents = (hasValidGrantData ? grantTotalCents : 0) + stripeBalanceCents

    if (combinedTotalCents > 0) {
      lines.push(ctx.line.progress({
        label: "Credits",
        used: ctx.fmt.dollars(hasValidGrantData ? grantUsedCents : 0),
        limit: ctx.fmt.dollars(combinedTotalCents),
        format: { kind: "dollars" },
      }))
    }

    const planUsed = hasPlanUsageLimit
      ? (typeof pu.totalSpend === "number"
        ? pu.totalSpend
        : pu.limit - (pu.remaining ?? 0))
      : 0
    const computedPercentUsed = hasPlanUsageLimit && pu.limit > 0
      ? (planUsed / pu.limit) * 100
      : 0
    const totalUsagePercent = hasTotalUsagePercent
      ? pu.totalPercentUsed
      : computedPercentUsed

    var billingPeriodMs = 30 * 24 * 60 * 60 * 1000
    var cycleStart = Number(usage.billingCycleStart)
    var cycleEnd = Number(usage.billingCycleEnd)
    if (Number.isFinite(cycleStart) && Number.isFinite(cycleEnd) && cycleEnd > cycleStart) {
      billingPeriodMs = cycleEnd - cycleStart
    }

    const su = usage.spendLimitUsage
    const isTeamAccount = (
      normalizedPlanName === "team" ||
      (su && su.limitType === "team") ||
      (su && typeof su.pooledLimit === "number")
    )

    if (isTeamAccount) {
      if (!hasPlanUsageLimit) {
        return null
      }
      lines.push(ctx.line.progress({
        label: "Total usage",
        used: ctx.fmt.dollars(planUsed),
        limit: ctx.fmt.dollars(pu.limit),
        format: { kind: "dollars" },
        resetsAt: ctx.util.toIso(usage.billingCycleEnd),
        periodDurationMs: billingPeriodMs,
      }))

      if (typeof pu.bonusSpend === "number" && pu.bonusSpend > 0) {
        lines.push(ctx.line.text({ label: "Bonus spend", value: "$" + String(ctx.fmt.dollars(pu.bonusSpend)) }))
      }
    } else {
      lines.push(ctx.line.progress({
        label: "Total usage",
        used: totalUsagePercent,
        limit: 100,
        format: { kind: "percent" },
        resetsAt: ctx.util.toIso(usage.billingCycleEnd),
        periodDurationMs: billingPeriodMs,
      }))
    }

    if (typeof pu.autoPercentUsed === "number" && Number.isFinite(pu.autoPercentUsed)) {
      lines.push(ctx.line.progress({
        label: "Auto usage",
        used: pu.autoPercentUsed,
        limit: 100,
        format: { kind: "percent" },
        resetsAt: ctx.util.toIso(usage.billingCycleEnd),
        periodDurationMs: billingPeriodMs,
      }))
    }

    if (typeof pu.apiPercentUsed === "number" && Number.isFinite(pu.apiPercentUsed)) {
      lines.push(ctx.line.progress({
        label: "API usage",
        used: pu.apiPercentUsed,
        limit: 100,
        format: { kind: "percent" },
        resetsAt: ctx.util.toIso(usage.billingCycleEnd),
        periodDurationMs: billingPeriodMs,
      }))
    }

    if (su) {
      const limit = su.individualLimit ?? su.pooledLimit ?? 0
      const remaining = su.individualRemaining ?? su.pooledRemaining ?? 0
      if (limit > 0) {
        const used = limit - remaining
        lines.push(ctx.line.progress({
          label: "On-demand",
          used: ctx.fmt.dollars(used),
          limit: ctx.fmt.dollars(limit),
          format: { kind: "dollars" },
        }))
      }
    }

    return { plan: plan, lines: lines }
  }

  function finalizePlanResult(ctx, planName, lines) {
    var plan = null
    if (planName) {
      var planLabel = ctx.fmt.planLabel(planName)
      if (planLabel) plan = planLabel
    }
    return { plan: plan, lines: lines }
  }

  /** True when REST /api/usage JSON looks like GetCurrentPeriodUsage (not gpt-4-only enterprise payload). */
  function isConnectUsageRestShape(u) {
    if (!u || typeof u !== "object") return false
    return (
      u.planUsage != null ||
      typeof u.enabled === "boolean" ||
      u.billingCycleStart != null ||
      u.billingCycleEnd != null ||
      u.spendLimitUsage != null ||
      typeof u.displayMessage === "string" ||
      typeof u.displayThreshold === "number"
    )
  }

  function buildRequestBasedResult(ctx, accessToken, planName, unavailableMessage) {
    var requestUsage = fetchRequestBasedUsage(ctx, accessToken)
    var lines = []

    if (requestUsage) {
      var gpt4 = requestUsage["gpt-4"]
      if (gpt4 && typeof gpt4.maxRequestUsage === "number" && gpt4.maxRequestUsage > 0) {
        var used = gpt4.numRequests || 0
        var limit = gpt4.maxRequestUsage

        var billingPeriodMs = 30 * 24 * 60 * 60 * 1000
        var cycleStart = requestUsage.startOfMonth
          ? ctx.util.parseDateMs(requestUsage.startOfMonth)
          : null
        var cycleEndMs = cycleStart ? cycleStart + billingPeriodMs : null

        lines.push(ctx.line.progress({
          label: "Requests",
          used: used,
          limit: limit,
          format: { kind: "count", suffix: "requests" },
          resetsAt: ctx.util.toIso(cycleEndMs),
          periodDurationMs: billingPeriodMs,
        }))
      }
    }

    if (lines.length > 0) {
      return finalizePlanResult(ctx, planName, lines)
    }

    if (requestUsage && isConnectUsageRestShape(requestUsage)) {
      var stripeBalanceCents = fetchStripeBalance(ctx, accessToken) || 0
      var creditGrants = null
      try {
        const creditsResp = connectPost(ctx, CREDITS_URL, accessToken)
        if (creditsResp.status >= 200 && creditsResp.status < 300) {
          creditGrants = ctx.util.tryParseJson(creditsResp.bodyText)
        }
      } catch (e) {
        ctx.host.log.warn("request-based: credit grants fetch failed: " + String(e))
      }
      try {
        var connectStyle = buildPlanAndLinesFromConnectStyleUsage(ctx, requestUsage, planName, {
          creditGrants: creditGrants,
          stripeBalanceCents: stripeBalanceCents,
        })
        if (connectStyle) {
          return connectStyle
        }
      } catch (e) {
        if (typeof e === "string") {
          if (e === "No active Cursor subscription." || e === "Total usage limit missing from API response.") {
            throw e
          }
          ctx.host.log.warn("request-based: connect-style parse failed: " + e)
        } else {
          ctx.host.log.warn("request-based: connect-style parse failed: " + String(e))
        }
      }
    }

    ctx.host.log.warn("request-based: no usage data available")
    throw unavailableMessage
  }

  function buildEnterpriseResult(ctx, accessToken, planName) {
    return buildRequestBasedResult(
      ctx,
      accessToken,
      planName,
      "Enterprise usage data unavailable. Try again later."
    )
  }

  function buildTeamRequestBasedResult(ctx, accessToken, planName) {
    return buildRequestBasedResult(
      ctx,
      accessToken,
      planName,
      "Team request-based usage data unavailable. Try again later."
    )
  }

  function buildUnknownRequestBasedResult(ctx, accessToken, planName) {
    return buildRequestBasedResult(
      ctx,
      accessToken,
      planName,
      "Cursor request-based usage data unavailable. Try again later."
    )
  }

  function probe(ctx) {
    const authState = loadAuthState(ctx)
    let accessToken = authState.accessToken
    const refreshTokenValue = authState.refreshToken
    const authSource = authState.source

    if (
      authSource === "provider-account" &&
      isCrossusageDevMockCredential(accessToken, refreshTokenValue)
    ) {
      return buildCrossusageDevMockProbeOutput(ctx)
    }

    if (!accessToken && !refreshTokenValue) {
      ctx.host.log.error("probe failed: no access or refresh token in sqlite/keychain")
      throw "Not logged in. " + LOGIN_HINT
    }

    ctx.host.log.info("tokens loaded from " + authSource + ": accessToken=" + (accessToken ? "yes" : "no") + " refreshToken=" + (refreshTokenValue ? "yes" : "no"))

    const nowMs = Date.now()

    // Proactively refresh if token is expired or about to expire
    if (needsRefresh(ctx, accessToken, nowMs)) {
      ctx.host.log.info("token needs refresh (expired or expiring soon)")
      let refreshed = null
      try {
        refreshed = refreshToken(ctx, refreshTokenValue, authSource)
      } catch (e) {
        // If refresh fails but we have an access token, try it anyway
        ctx.host.log.warn("refresh failed but have access token, will try: " + String(e))
        if (!accessToken) throw e
      }
      if (refreshed) {
        accessToken = refreshed
      } else if (!accessToken) {
        ctx.host.log.error("refresh failed and no access token available")
        throw "Not logged in. " + LOGIN_HINT
      }
    }

    let usageResp
    let didRefresh = false
    try {
      usageResp = ctx.util.retryOnceOnAuth({
        request: (token) => {
          try {
            return connectPost(ctx, USAGE_URL, token || accessToken)
          } catch (e) {
            ctx.host.log.error("usage request exception: " + String(e))
            if (didRefresh) {
              throw "Usage request failed after refresh. Try again."
            }
            throw "Usage request failed. Check your connection."
          }
        },
        refresh: () => {
          ctx.host.log.info("usage returned 401, attempting refresh")
          didRefresh = true
          const refreshed = refreshToken(ctx, refreshTokenValue, authSource)
          if (refreshed) accessToken = refreshed
          return refreshed
        },
      })
    } catch (e) {
      if (typeof e === "string") throw e
      ctx.host.log.error("usage request failed: " + String(e))
      throw "Usage request failed. Check your connection."
    }

    if (ctx.util.isAuthStatus(usageResp.status)) {
      ctx.host.log.error("usage returned auth error after all retries: status=" + usageResp.status)
      throw "Token expired. " + LOGIN_HINT
    }

    if (usageResp.status < 200 || usageResp.status >= 300) {
      const bodySnippet =
        typeof usageResp.bodyText === "string" ? usageResp.bodyText.slice(0, 240) : ""
      ctx.host.log.error(
        "usage returned error: status=" + usageResp.status + " body=" + bodySnippet
      )

      var connectDetail = null
      // Connect/gRPC-Web sometimes returns 400/403 while other endpoints or cursor.com still work.
      if (usageResp.status === 400 || usageResp.status === 403) {
        connectDetail = extractConnectUsageErrorDetail(ctx, usageResp.bodyText)
        ctx.host.log.warn(
          "GetCurrentPeriodUsage returned " +
            String(usageResp.status) +
            "; detail=" +
            String(connectDetail) +
            "; trying GetUsageLimitStatusAndActiveGrants, then REST, then Stripe summary"
        )

        try {
          var lgResp = connectPost(ctx, USAGE_LIMIT_GRANTS_URL, accessToken)
          if (lgResp.status >= 200 && lgResp.status < 300) {
            var lgRaw = ctx.util.tryParseJson(lgResp.bodyText)
            var usageShape = normalizeLimitGrantsToUsageShape(lgRaw)
            if (usageShape) {
              var planNameLg = ""
              try {
                var planRespLg = connectPost(ctx, PLAN_URL, accessToken)
                if (planRespLg.status >= 200 && planRespLg.status < 300) {
                  var planLg = ctx.util.tryParseJson(planRespLg.bodyText)
                  if (planLg && planLg.planInfo && planLg.planInfo.planName) {
                    planNameLg = planLg.planInfo.planName
                  }
                }
              } catch (ePlan) {
                ctx.host.log.warn("plan info during limit-grants fallback failed: " + String(ePlan))
              }
              var creditGrantsLg = null
              try {
                var creditsRespLg = connectPost(ctx, CREDITS_URL, accessToken)
                if (creditsRespLg.status >= 200 && creditsRespLg.status < 300) {
                  creditGrantsLg = ctx.util.tryParseJson(creditsRespLg.bodyText)
                }
              } catch (eCr) {
                ctx.host.log.warn("credit grants during limit-grants fallback failed: " + String(eCr))
              }
              var stripeBalanceLg = fetchStripeBalance(ctx, accessToken) || 0
              try {
                var builtLg = buildPlanAndLinesFromConnectStyleUsage(ctx, usageShape, planNameLg, {
                  creditGrants: creditGrantsLg,
                  stripeBalanceCents: stripeBalanceLg,
                })
                if (builtLg) return builtLg
              } catch (eBuild) {
                ctx.host.log.warn("limit-grants connect-style build failed: " + String(eBuild))
              }
            }
          } else {
            ctx.host.log.warn(
              "GetUsageLimitStatusAndActiveGrants returned status=" + lgResp.status
            )
          }
        } catch (eLg) {
          ctx.host.log.warn("GetUsageLimitStatusAndActiveGrants request failed: " + String(eLg))
        }

        try {
          return buildUnknownRequestBasedResult(ctx, accessToken, "")
        } catch (e) {
          ctx.host.log.warn("REST usage fallback after Connect error failed: " + String(e))
        }

        try {
          var partialStripe = buildPartialStripeSubscriptionResult(ctx, accessToken, connectDetail)
          if (partialStripe) return partialStripe
        } catch (eP) {
          ctx.host.log.warn("partial stripe fallback failed: " + String(eP))
        }

        throw buildConnectFallbackFailedMessage(connectDetail)
      }

      throw "Usage request failed (HTTP " + String(usageResp.status) + "). Try again later."
    }

    ctx.host.log.info("usage fetch succeeded")

    const usage = ctx.util.tryParseJson(usageResp.bodyText)
    if (usage === null) {
      throw "Usage response invalid. Try again later."
    }

    // Fetch plan info early (needed for request-based fallback detection)
    let planName = ""
    let planInfoUnavailable = false
    try {
      const planResp = connectPost(ctx, PLAN_URL, accessToken)
      if (planResp.status >= 200 && planResp.status < 300) {
        const plan = ctx.util.tryParseJson(planResp.bodyText)
        if (plan && plan.planInfo && plan.planInfo.planName) {
          planName = plan.planInfo.planName
        }
      } else {
        planInfoUnavailable = true
        ctx.host.log.warn("plan info returned error: status=" + planResp.status)
      }
    } catch (e) {
      planInfoUnavailable = true
      ctx.host.log.warn("plan info fetch failed: " + String(e))
    }

    const normalizedPlanName = typeof planName === "string"
      ? planName.toLowerCase()
      : ""

    const hasPlanUsage = !!usage.planUsage
    const hasPlanUsageLimit = hasPlanUsage &&
      typeof usage.planUsage.limit === "number" &&
      Number.isFinite(usage.planUsage.limit)
    const planUsageLimitMissing = hasPlanUsage && !hasPlanUsageLimit
    const hasTotalUsagePercent = hasPlanUsage &&
      typeof usage.planUsage.totalPercentUsed === "number" &&
      Number.isFinite(usage.planUsage.totalPercentUsed)

    // Enterprise and some Team request-based accounts can return no planUsage
    // or a planUsage object without limit from the Connect API.
    const needsRequestBasedFallback = usage.enabled !== false && (!hasPlanUsage || planUsageLimitMissing) && (
      normalizedPlanName === "enterprise" ||
      normalizedPlanName === "team"
    )
    if (needsRequestBasedFallback) {
      if (normalizedPlanName === "enterprise") {
        ctx.host.log.info("detected enterprise account, using REST usage API")
        return buildEnterpriseResult(ctx, accessToken, planName)
      }
      ctx.host.log.info("detected team request-based account, using REST usage API")
      return buildTeamRequestBasedResult(ctx, accessToken, planName)
    }

    const needsFallbackWithoutPlanInfo = usage.enabled !== false &&
      (!hasPlanUsage || planUsageLimitMissing) &&
      !hasTotalUsagePercent &&
      !normalizedPlanName &&
      planInfoUnavailable
    if (needsFallbackWithoutPlanInfo) {
      ctx.host.log.info("plan info unavailable with missing planUsage, attempting REST usage API fallback")
      return buildUnknownRequestBasedResult(ctx, accessToken, planName)
    }

    if (usage.enabled !== false && planUsageLimitMissing && !hasTotalUsagePercent) {
      ctx.host.log.warn("planUsage.limit missing, attempting REST usage API fallback")
      try {
        return buildUnknownRequestBasedResult(ctx, accessToken, planName)
      } catch (e) {
        ctx.host.log.warn("REST usage fallback unavailable: " + String(e))
      }
    }

    // Team plans may omit `enabled` even with valid plan usage data.
    if (usage.enabled === false || !usage.planUsage) {
      throw "No active Cursor subscription."
    }

    let creditGrants = null
    try {
      const creditsResp = connectPost(ctx, CREDITS_URL, accessToken)
      if (creditsResp.status >= 200 && creditsResp.status < 300) {
        creditGrants = ctx.util.tryParseJson(creditsResp.bodyText)
      }
    } catch (e) {
      ctx.host.log.warn("credit grants fetch failed: " + String(e))
    }

    const stripeBalanceCents = fetchStripeBalance(ctx, accessToken) || 0

    const connectResult = buildPlanAndLinesFromConnectStyleUsage(ctx, usage, planName, {
      creditGrants: creditGrants,
      stripeBalanceCents: stripeBalanceCents,
    })
    if (connectResult === null) {
      ctx.host.log.warn("team-inferred account missing planUsage.limit, attempting REST usage API fallback")
      return buildUnknownRequestBasedResult(ctx, accessToken, planName)
    }
    return connectResult
  }

  globalThis.__openusage_plugin = { id: "cursor", probe }
})()
