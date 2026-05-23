(function () {
  const PROVIDER_ID = "antigravity-cli"
  const CLI_STATE_DIR = "~/.gemini/antigravity-cli"
  const KEYCHAIN_SERVICE = "gemini"
  const KEYCHAIN_ACCOUNT = "antigravity"
  const LOGIN_MESSAGE = "Not logged in. Run `agy` and complete Google sign-in first."
  const SESSION_EXPIRED_MESSAGE =
    "Google sign-in expired. Run `agy` and complete Google sign-in again."
  const REQUEST_FAILED_MESSAGE = "Antigravity CLI quota request failed. Check your connection and try again."
  const GOOGLE_OAUTH_URL = "https://oauth2.googleapis.com/token"
  const GOOGLE_CLIENT_ID =
    "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com"
  const GOOGLE_CLIENT_SECRET = "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"
  const TOKEN_EXPIRY_SKEW_MS = 60 * 1000

  const CLOUD_CODE_BASES = [
    "https://daily-cloudcode-pa.googleapis.com",
    "https://cloudcode-pa.googleapis.com",
  ]
  const LOAD_CODE_ASSIST_PATH = "/v1internal:loadCodeAssist"
  const FETCH_MODELS_PATH = "/v1internal:fetchAvailableModels"
  const RETRIEVE_QUOTA_PATH = "/v1internal:retrieveUserQuota"
  const QUOTA_PERIOD_MS = 5 * 60 * 60 * 1000

  const IDE_METADATA = {
    ideType: "IDE_UNSPECIFIED",
    platform: "PLATFORM_UNSPECIFIED",
    pluginType: "GEMINI",
    duetProject: "default",
  }

  function trimString(value) {
    return typeof value === "string" ? value.trim() : ""
  }

  function decodeBase64(ctx, text) {
    try {
      return ctx.base64.decode(text)
    } catch (e) {
      return null
    }
  }

  function readKeychainValue(ctx) {
    if (!ctx.host.keychain || typeof ctx.host.keychain.readGenericPassword !== "function") {
      return null
    }

    try {
      var accountValue = ctx.host.keychain.readGenericPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
      if (accountValue) return accountValue
    } catch (e) {
      ctx.host.log.info("antigravity-cli account keychain read failed: " + String(e))
    }

    try {
      return ctx.host.keychain.readGenericPassword(KEYCHAIN_SERVICE)
    } catch (e) {
      ctx.host.log.info("antigravity-cli service keychain read failed: " + String(e))
      return null
    }
  }

  function unwrapKeychainText(ctx, raw) {
    var text = trimString(raw)
    if (!text) return null
    if (text.indexOf("go-keyring-base64:") === 0) {
      var decoded = decodeBase64(ctx, text.slice("go-keyring-base64:".length))
      text = trimString(decoded)
    }
    return text || null
  }

  function extractTokenFromObject(obj) {
    if (!obj || typeof obj !== "object") return null

    var directKeys = [
      "access_token",
      "accessToken",
      "token",
      "id_token",
      "idToken",
      "bearerToken",
      "auth_token",
      "authToken",
    ]
    for (var i = 0; i < directKeys.length; i += 1) {
      var value = obj[directKeys[i]]
      if (typeof value === "string" && value.trim()) return value.trim()
    }

    var nestedKeys = ["token", "tokens", "oauth", "oauth2", "credentials", "auth"]
    for (var j = 0; j < nestedKeys.length; j += 1) {
      var nested = extractTokenFromObject(obj[nestedKeys[j]])
      if (nested) return nested
    }

    return null
  }

  function parseKeychainPayload(ctx, raw) {
    var text = unwrapKeychainText(ctx, raw)
    if (!text) return { text: null, parsed: null }
    var parsed = ctx.util.tryParseJson(text)
    if (typeof parsed === "string" && parsed.trim()) {
      return { text: parsed.trim(), parsed: null, rawToken: parsed.trim() }
    }
    if (parsed && typeof parsed === "object") {
      return { text: text, parsed: parsed, rawToken: null }
    }
    if (text.indexOf("Bearer ") === 0) {
      return { text: text, parsed: null, rawToken: text.slice("Bearer ".length).trim() || null }
    }
    return { text: text, parsed: null, rawToken: text }
  }

  function extractAccessToken(ctx, raw) {
    var payload = parseKeychainPayload(ctx, raw)
    if (payload.rawToken && !payload.parsed) return payload.rawToken
    if (payload.parsed) {
      var token = extractTokenFromObject(payload.parsed)
      if (token) return token
    }
    return payload.rawToken || null
  }

  function readRefreshToken(parsed) {
    if (!parsed || typeof parsed !== "object") return null
    var keys = ["refresh_token", "refreshToken"]
    for (var i = 0; i < keys.length; i += 1) {
      var direct = parsed[keys[i]]
      if (typeof direct === "string" && direct.trim()) return direct.trim()
    }
    var nestedKeys = ["token", "tokens", "oauth", "oauth2", "credentials", "auth"]
    for (var j = 0; j < nestedKeys.length; j += 1) {
      var nested = readRefreshToken(parsed[nestedKeys[j]])
      if (nested) return nested
    }
    return null
  }

  function parseExpiryMs(value) {
    if (value == null) return null
    if (typeof value === "number" && Number.isFinite(value)) {
      return value < 1e12 ? value * 1000 : value
    }
    if (typeof value === "string" && value.trim()) {
      var asNum = Number(value)
      if (Number.isFinite(asNum)) return asNum < 1e12 ? asNum * 1000 : asNum
      var parsed = Date.parse(value)
      if (Number.isFinite(parsed)) return parsed
    }
    return null
  }

  function readExpiryMs(parsed) {
    if (!parsed || typeof parsed !== "object") return null
    var keys = ["expiry", "expires_at", "expiresAt", "expires", "exp"]
    for (var i = 0; i < keys.length; i += 1) {
      var ms = parseExpiryMs(parsed[keys[i]])
      if (ms != null) return ms
    }
    var nestedKeys = ["token", "tokens", "oauth", "oauth2", "credentials", "auth"]
    for (var j = 0; j < nestedKeys.length; j += 1) {
      var nested = readExpiryMs(parsed[nestedKeys[j]])
      if (nested != null) return nested
    }
    return null
  }

  function isAccessTokenExpired(expiryMs) {
    if (expiryMs == null) return false
    return expiryMs <= Date.now() + TOKEN_EXPIRY_SKEW_MS
  }

  function writeKeychainAuth(ctx, serialized) {
    if (
      !ctx.host.keychain ||
      typeof ctx.host.keychain.writeGenericPasswordForAccount !== "function"
    ) {
      return
    }
    try {
      ctx.host.keychain.writeGenericPasswordForAccount(
        KEYCHAIN_SERVICE,
        KEYCHAIN_ACCOUNT,
        serialized
      )
    } catch (e) {
      ctx.host.log.warn("antigravity-cli keychain write failed: " + String(e))
    }
  }

  function mergeRefreshedToken(parsed, accessToken, expiresInSeconds) {
    var root = parsed && typeof parsed === "object" ? parsed : {}
    var token =
      root.token && typeof root.token === "object" ? Object.assign({}, root.token) : {}
    token.access_token = accessToken
    token.token_type = token.token_type || "Bearer"
    token.expiry = new Date(
      Date.now() + (typeof expiresInSeconds === "number" ? expiresInSeconds : 3600) * 1000
    ).toISOString()
    root.token = token
    return root
  }

  function refreshAccessToken(ctx, refreshTokenValue, parsed) {
    if (!refreshTokenValue) return null
    ctx.host.log.info("antigravity-cli attempting Google OAuth token refresh")
    var resp
    try {
      resp = ctx.host.http.request({
        method: "POST",
        url: GOOGLE_OAUTH_URL,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        bodyText:
          "client_id=" +
          encodeURIComponent(GOOGLE_CLIENT_ID) +
          "&client_secret=" +
          encodeURIComponent(GOOGLE_CLIENT_SECRET) +
          "&refresh_token=" +
          encodeURIComponent(refreshTokenValue) +
          "&grant_type=refresh_token",
        timeoutMs: 15000,
      })
    } catch (e) {
      ctx.host.log.warn("antigravity-cli OAuth refresh failed: " + String(e))
      return null
    }
    if (!resp || resp.status < 200 || resp.status >= 300) {
      ctx.host.log.warn(
        "antigravity-cli OAuth refresh HTTP " + String(resp && resp.status)
      )
      return null
    }
    var body = ctx.util.tryParseJson(resp.bodyText)
    if (!body || typeof body.access_token !== "string" || !body.access_token.trim()) {
      ctx.host.log.warn("antigravity-cli OAuth refresh missing access_token")
      return null
    }
    var accessToken = body.access_token.trim()
    var expiresIn = typeof body.expires_in === "number" ? body.expires_in : 3600
    if (parsed && typeof parsed === "object") {
      var merged = mergeRefreshedToken(parsed, accessToken, expiresIn)
      writeKeychainAuth(ctx, JSON.stringify(merged))
    }
    return accessToken
  }

  function resolveAccessToken(ctx) {
    var raw = readKeychainValue(ctx)
    var payload = parseKeychainPayload(ctx, raw)
    var parsed = payload.parsed
    var accessToken = extractAccessToken(ctx, raw)
    var refreshToken = readRefreshToken(parsed)
    var expiryMs = readExpiryMs(parsed)

    if (accessToken && !isAccessTokenExpired(expiryMs)) return accessToken

    if (refreshToken) {
      var refreshed = refreshAccessToken(ctx, refreshToken, parsed)
      if (refreshed) return refreshed
    }

    if (accessToken && isAccessTokenExpired(expiryMs)) {
      throw SESSION_EXPIRED_MESSAGE
    }
    return accessToken
  }

  function readNonSecretCliContext(ctx) {
    var context = {}
    try {
      if (ctx.host.fs.exists(CLI_STATE_DIR)) {
        context.hasStateDir = true
      }
    } catch (e) {
      context.hasStateDir = false
    }
    return context
  }

  function cloudCodeUrls(path) {
    var urls = []
    for (var i = 0; i < CLOUD_CODE_BASES.length; i += 1) {
      urls.push(CLOUD_CODE_BASES[i] + path)
    }
    return urls
  }

  function requestJson(ctx, url, token, body, options) {
    var opts = options || {}
    var request = ctx.host.http && typeof ctx.host.http.request === "function"
      ? ctx.host.http.request
      : ctx.util.request
    var resp
    try {
      resp = request({
        method: "POST",
        url: url,
        headers: {
          Authorization: "Bearer " + token,
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "agy",
        },
        bodyText: JSON.stringify(body || {}),
        timeoutMs: 15000,
      })
    } catch (e) {
      if (opts.optional) {
        ctx.host.log.warn("antigravity-cli request failed: " + String(e))
        return null
      }
      throw REQUEST_FAILED_MESSAGE
    }
    if (!resp || typeof resp.status !== "number" || !Number.isFinite(resp.status)) {
      if (opts.optional) return null
      throw REQUEST_FAILED_MESSAGE
    }
    if (ctx.util.isAuthStatus(resp.status)) {
      if (opts.optional) {
        ctx.host.log.warn(
          "antigravity-cli optional request HTTP " +
            String(resp.status) +
            " for " +
            url +
            " (ignored)"
        )
        return null
      }
      if (opts.onAuthFailure) {
        var recovered = opts.onAuthFailure()
        if (recovered) {
          return requestJson(ctx, url, recovered, body, Object.assign({}, opts, { onAuthFailure: null }))
        }
      }
      throw opts.authFailureMessage || LOGIN_MESSAGE
    }
    if (resp.status < 200 || resp.status >= 300) {
      if (opts.optional) {
        ctx.host.log.warn(
          "antigravity-cli optional request HTTP " + String(resp.status) + " for " + url
        )
        return null
      }
      throw "Antigravity CLI quota request failed (HTTP " + String(resp.status) + "). Try again later."
    }
    var data = ctx.util.tryParseJson(resp.bodyText)
    return data && typeof data === "object" ? data : null
  }

  function requestJsonAcrossBases(ctx, path, token, body, options) {
    var urls = cloudCodeUrls(path)
    for (var i = 0; i < urls.length; i += 1) {
      var data = requestJson(ctx, urls[i], token, body, options)
      if (data) return data
    }
    return null
  }

  function makeAuthRetry(ctx, authState) {
    return function onAuthFailure() {
      if (authState.retried) return null
      authState.retried = true
      var raw = readKeychainValue(ctx)
      var payload = parseKeychainPayload(ctx, raw)
      var refreshToken = readRefreshToken(payload.parsed)
      if (!refreshToken) return null
      var refreshed = refreshAccessToken(ctx, refreshToken, payload.parsed)
      if (refreshed) {
        authState.token = refreshed
        return refreshed
      }
      return null
    }
  }

  function readFirstStringDeep(value, keys) {
    if (!value || typeof value !== "object") return null
    for (var i = 0; i < keys.length; i += 1) {
      var v = value[keys[i]]
      if (typeof v === "string" && v.trim()) return v.trim()
    }
    var values = Object.values(value)
    for (var j = 0; j < values.length; j += 1) {
      var found = readFirstStringDeep(values[j], keys)
      if (found) return found
    }
    return null
  }

  function readPlan(loadCodeAssistData) {
    var current = loadCodeAssistData && loadCodeAssistData.currentTier
    if (current && typeof current.name === "string" && current.name.trim()) {
      return current.name.trim()
    }
    var direct = loadCodeAssistData && loadCodeAssistData.userTier
    if (direct && typeof direct.name === "string" && direct.name.trim()) return direct.name.trim()
    var equivalent = readTierObjectName(loadCodeAssistData)
    if (equivalent) return equivalent
    return readFirstStringDeep(loadCodeAssistData, ["userTierName", "tierName", "planName"])
  }

  function readTierObjectName(value) {
    if (!value || typeof value !== "object") return null
    var tierKeys = ["userTier", "tier", "subscriptionTier", "plan"]
    for (var i = 0; i < tierKeys.length; i += 1) {
      var tier = value[tierKeys[i]]
      if (tier && typeof tier === "object" && typeof tier.name === "string" && tier.name.trim()) {
        return tier.name.trim()
      }
    }
    var values = Object.values(value)
    for (var j = 0; j < values.length; j += 1) {
      var found = readTierObjectName(values[j])
      if (found) return found
    }
    return null
  }

  function modelText(value) {
    var parts = []
    if (!value || typeof value !== "object") return ""
    var keys = ["label", "displayName", "name", "model", "modelId", "model_id", "id"]
    for (var i = 0; i < keys.length; i += 1) {
      if (typeof value[keys[i]] === "string") parts.push(value[keys[i]])
    }
    return parts.join(" ").toLowerCase()
  }

  function poolForText(text) {
    var lower = String(text || "").toLowerCase()
    if (lower.indexOf("gemini") !== -1 && lower.indexOf("pro") !== -1) return "Gemini Pro"
    if (lower.indexOf("gemini") !== -1 && lower.indexOf("flash") !== -1) return "Gemini Flash"
    if (lower.indexOf("gemini") !== -1) return null
    if (lower) return "Claude"
    return null
  }

  function pushBucket(out, pool, remainingFraction, resetTime) {
    if (!pool || !Number.isFinite(remainingFraction)) return
    out.push({
      pool: pool,
      remainingFraction: remainingFraction,
      resetTime: resetTime || null,
    })
  }

  function collectFetchModelBuckets(value, out) {
    if (Array.isArray(value)) {
      for (var i = 0; i < value.length; i += 1) collectFetchModelBuckets(value[i], out)
      return
    }
    if (!value || typeof value !== "object") return
    if (value.isInternal) return

    var quota = value.quotaInfo || value.quota || null
    var remaining = quota && typeof quota.remainingFraction === "number"
      ? quota.remainingFraction
      : typeof value.remainingFraction === "number"
        ? value.remainingFraction
        : null
    if (remaining !== null) {
      var text = modelText(value)
      if (text) {
        pushBucket(out, poolForText(text), remaining, (quota && (quota.resetTime || quota.reset_time)) || value.resetTime || value.reset_time)
      }
    }

    var children = Object.values(value)
    for (var j = 0; j < children.length; j += 1) collectFetchModelBuckets(children[j], out)
  }

  function collectQuotaBuckets(value, out, inheritedText) {
    if (Array.isArray(value)) {
      for (var i = 0; i < value.length; i += 1) collectQuotaBuckets(value[i], out, inheritedText)
      return
    }
    if (!value || typeof value !== "object") return

    var text = (inheritedText || "") + " " + modelText(value)
    if (typeof value.remainingFraction === "number") {
      pushBucket(out, poolForText(text), value.remainingFraction, value.resetTime || value.reset_time)
    }

    var entries = Object.keys(value)
    for (var j = 0; j < entries.length; j += 1) {
      var key = entries[j]
      collectQuotaBuckets(value[key], out, text + " " + key)
    }
  }

  function dedupeBuckets(buckets) {
    var byPool = {}
    for (var i = 0; i < buckets.length; i += 1) {
      var bucket = buckets[i]
      if (!byPool[bucket.pool] || bucket.remainingFraction < byPool[bucket.pool].remainingFraction) {
        byPool[bucket.pool] = bucket
      }
    }
    return byPool
  }

  function lineForBucket(ctx, label, bucket) {
    var clamped = Math.max(0, Math.min(1, Number(bucket.remainingFraction)))
    var opts = {
      label: label,
      used: Math.round((1 - clamped) * 100),
      limit: 100,
      format: { kind: "percent" },
      periodDurationMs: QUOTA_PERIOD_MS,
    }
    if (bucket.resetTime) {
      var iso = ctx.util.toIso ? ctx.util.toIso(bucket.resetTime) : bucket.resetTime
      if (iso) opts.resetsAt = iso
    }
    return ctx.line.progress(opts)
  }

  function buildLines(ctx, buckets) {
    var byPool = dedupeBuckets(buckets)
    var order = ["Gemini Pro", "Gemini Flash", "Claude"]
    var lines = []
    for (var i = 0; i < order.length; i += 1) {
      var label = order[i]
      if (byPool[label]) lines.push(lineForBucket(ctx, label, byPool[label]))
    }
    return lines
  }

  function probe(ctx) {
    readNonSecretCliContext(ctx)

    var token = resolveAccessToken(ctx)
    if (!token) throw LOGIN_MESSAGE

    var authState = { token: token, retried: false }
    var authOpts = {
      onAuthFailure: makeAuthRetry(ctx, authState),
      authFailureMessage: SESSION_EXPIRED_MESSAGE,
    }

    var loadData = requestJsonAcrossBases(
      ctx,
      LOAD_CODE_ASSIST_PATH,
      authState.token,
      { metadata: IDE_METADATA },
      authOpts
    )
    if (!loadData) throw REQUEST_FAILED_MESSAGE
    var plan = readPlan(loadData)

    var buckets = []
    // fetchAvailableModels rejects `metadata` in the body (HTTP 400); use {} like Antigravity IDE.
    var fetchData = requestJsonAcrossBases(ctx, FETCH_MODELS_PATH, authState.token, {}, {
      optional: true,
      onAuthFailure: authOpts.onAuthFailure,
      authFailureMessage: authOpts.authFailureMessage,
    })
    if (fetchData) collectFetchModelBuckets(fetchData, buckets)

    if (buckets.length === 0) {
      var quotaData = requestJsonAcrossBases(ctx, RETRIEVE_QUOTA_PATH, authState.token, {}, authOpts)
      if (quotaData) collectQuotaBuckets(quotaData, buckets, "")
    }

    var lines = buildLines(ctx, buckets)
    if (lines.length === 0) {
      lines.push(ctx.line.badge({ label: "Status", text: "No quota data", color: "#a3a3a3" }))
    }

    return { plan: plan || undefined, lines: lines }
  }

  globalThis.__openusage_plugin = { id: PROVIDER_ID, probe: probe }
})()
