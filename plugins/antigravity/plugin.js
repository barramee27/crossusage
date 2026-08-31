(function () {
  var LS_SERVICE = "exa.language_server_pb.LanguageServerService"
  var STATE_DB_RELATIVE_PATHS = [
    "Antigravity IDE/User/globalStorage/state.vscdb",
    "Antigravity/User/globalStorage/state.vscdb",
  ]
  var STATE_DB_FALLBACK_PATHS = [
    "~/Library/Application Support/Antigravity IDE/User/globalStorage/state.vscdb",
    "~/Library/Application Support/Antigravity/User/globalStorage/state.vscdb",
  ]
  var AGY_KEYCHAIN_SERVICE = "gemini"
  var AGY_KEYCHAIN_ACCOUNT = "antigravity"
  var CLOUD_CODE_URLS = [
    "https://daily-cloudcode-pa.googleapis.com",
    "https://cloudcode-pa.googleapis.com",
  ]
  var RETRIEVE_QUOTA_SUMMARY_PATH = "/v1internal:retrieveUserQuotaSummary"
  // Kept only for providers that have not rolled out quota summaries yet.
  var LOAD_CODE_ASSIST_PATH = "/v1internal:loadCodeAssist"
  var FETCH_MODELS_PATH = "/v1internal:fetchAvailableModels"
  var RETRIEVE_QUOTA_PATH = "/v1internal:retrieveUserQuota"
  var LOGIN_MESSAGE = "Start Antigravity or run `agy` and try again."
  var GOOGLE_OAUTH_URL = "https://oauth2.googleapis.com/token"
  var GOOGLE_CLIENT_ID = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com"
  var GOOGLE_CLIENT_SECRET = "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"
  var OAUTH_TOKEN_KEY = "antigravityUnifiedStateSync.oauthToken"
  var OAUTH_TOKEN_SENTINEL = "oauthTokenInfoSentinelKey"
  var CC_MODEL_BLACKLIST = {
    "MODEL_CHAT_20706": true,
    "MODEL_CHAT_23310": true,
    "MODEL_GOOGLE_GEMINI_2_5_FLASH": true,
    "MODEL_GOOGLE_GEMINI_2_5_FLASH_THINKING": true,
    "MODEL_GOOGLE_GEMINI_2_5_FLASH_LITE": true,
    "MODEL_GOOGLE_GEMINI_2_5_PRO": true,
    "MODEL_PLACEHOLDER_M19": true,
    "MODEL_PLACEHOLDER_M9": true,
    "MODEL_PLACEHOLDER_M12": true,
  }
  // --- Protobuf wire-format decoder ---

  function readVarint(s, pos) {
    var v = 0
    var shift = 0
    while (pos < s.length) {
      var b = s.charCodeAt(pos++)
      v += (b & 0x7f) * Math.pow(2, shift)
      if ((b & 0x80) === 0) return { v: v, p: pos }
      shift += 7
    }
    return null
  }

  function readFields(s) {
    var fields = {}
    var pos = 0
    while (pos < s.length) {
      var tag = readVarint(s, pos)
      if (!tag) break
      pos = tag.p
      var fieldNum = Math.floor(tag.v / 8)
      var wireType = tag.v % 8
      if (wireType === 0) {
        var val = readVarint(s, pos)
        if (!val) break
        fields[fieldNum] = { type: 0, value: val.v }
        pos = val.p
      } else if (wireType === 1) {
        if (pos + 8 > s.length) break
        pos += 8
      } else if (wireType === 2) {
        var len = readVarint(s, pos)
        if (!len) break
        pos = len.p
        if (pos + len.v > s.length) break
        fields[fieldNum] = { type: 2, data: s.substring(pos, pos + len.v) }
        pos += len.v
      } else if (wireType === 5) {
        if (pos + 4 > s.length) break
        pos += 4
      } else {
        break
      }
    }
    return fields
  }

  // --- SQLite credential reading ---

  // Antigravity wraps OAuth state in a double-base64 envelope:
  //   b64(outer.f1 = wrapper{ f1=sentinel, f2=payload{ f1=b64(inner proto) } }).
  // The inner base64 layer is the unusual part — it's a UTF-8 string field, not raw bytes.
  function unwrapOAuthSentinel(ctx, base64Text) {
    var trimmed = String(base64Text || "").replace(/^\s+|\s+$/g, "")
    if (!trimmed) return null
    var outer = ctx.base64.decode(trimmed)
    var outerFields = readFields(outer)
    if (!outerFields[1] || outerFields[1].type !== 2) return null
    var wrapper = readFields(outerFields[1].data)
    var sentinel = (wrapper[1] && wrapper[1].type === 2) ? wrapper[1].data : null
    var payload = (wrapper[2] && wrapper[2].type === 2) ? wrapper[2].data : null
    if (sentinel !== OAUTH_TOKEN_SENTINEL || !payload) return null
    var payloadFields = readFields(payload)
    if (!payloadFields[1] || payloadFields[1].type !== 2) return null
    var innerText = payloadFields[1].data.replace(/^\s+|\s+$/g, "")
    if (!innerText) return null
    return ctx.base64.decode(innerText)
  }

  function loadOAuthTokensFromDb(ctx, dbPath) {
    try {
      var rows = ctx.host.sqlite.query(
        dbPath,
        "SELECT value FROM ItemTable WHERE key = '" + OAUTH_TOKEN_KEY + "' LIMIT 1"
      )
      var parsed = ctx.util.tryParseJson(rows)
      if (!parsed || !parsed.length || !parsed[0].value) return null
      var inner = unwrapOAuthSentinel(ctx, parsed[0].value)
      if (!inner) return null
      var fields = readFields(inner)
      var accessToken = (fields[1] && fields[1].type === 2) ? fields[1].data : null
      var refreshToken = (fields[3] && fields[3].type === 2) ? fields[3].data : null
      var expirySeconds = null
      if (fields[4] && fields[4].type === 2) {
        var ts = readFields(fields[4].data)
        if (ts[1] && ts[1].type === 0) expirySeconds = ts[1].value
      }
      if (!accessToken && !refreshToken) return null
      return { accessToken: accessToken, refreshToken: refreshToken, expirySeconds: expirySeconds }
    } catch (e) {
      ctx.host.log.warn("failed to read unified oauth token from " + dbPath + ": " + String(e))
      return null
    }
  }

  function resolveStateDbPaths(ctx) {
    if (ctx.host.fs && typeof ctx.host.fs.firstExistingAppSupport === "function") {
      var paths = []
      for (var i = 0; i < STATE_DB_RELATIVE_PATHS.length; i++) {
        var found = ctx.host.fs.firstExistingAppSupport(STATE_DB_RELATIVE_PATHS[i])
        if (found && paths.indexOf(found) === -1) paths.push(found)
      }
      return paths
    }
    return STATE_DB_FALLBACK_PATHS
  }

  function loadOAuthTokenCandidates(ctx) {
    var candidates = []
    var stateDbs = resolveStateDbPaths(ctx)
    for (var i = 0; i < stateDbs.length; i++) {
      var tokens = loadOAuthTokensFromDb(ctx, stateDbs[i])
      if (tokens) candidates.push(tokens)
    }
    return candidates
  }

  // --- Google OAuth token refresh ---

  function refreshAccessToken(ctx, refreshTokenValue) {
    if (!refreshTokenValue) {
      ctx.host.log.warn("refresh skipped: no refresh token")
      return null
    }
    ctx.host.log.info("attempting Google OAuth token refresh")
    try {
      var resp = ctx.host.http.request({
        method: "POST",
        url: GOOGLE_OAUTH_URL,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        bodyText:
          "client_id=" + encodeURIComponent(GOOGLE_CLIENT_ID) +
          "&client_secret=" + encodeURIComponent(GOOGLE_CLIENT_SECRET) +
          "&refresh_token=" + encodeURIComponent(refreshTokenValue) +
          "&grant_type=refresh_token",
        timeoutMs: 15000,
      })
      if (resp.status < 200 || resp.status >= 300) {
        ctx.host.log.warn("Google OAuth refresh returned status: " + resp.status)
        return null
      }
      var body = ctx.util.tryParseJson(resp.bodyText)
      if (!body || !body.access_token) {
        ctx.host.log.warn("Google OAuth refresh response missing access_token")
        return null
      }
      var expiresIn = (typeof body.expires_in === "number") ? body.expires_in : 3600
      cacheToken(ctx, body.access_token, expiresIn, refreshTokenValue)
      return body.access_token
    } catch (e) {
      ctx.host.log.warn("Google OAuth refresh failed: " + String(e))
      return null
    }
  }

  // --- Token cache ---

  function credentialFingerprint(ctx, refreshTokenValue) {
    var token = trimString(refreshTokenValue)
    if (!token) return null
    if (ctx.host.crypto && typeof ctx.host.crypto.sha256Hex === "function") {
      return ctx.host.crypto.sha256Hex(token)
    }
    return token
  }

  function discardCachedToken(ctx) {
    var path = ctx.app.pluginDataDir + "/auth.json"
    try {
      if (ctx.host.fs.exists(path)) {
        // Host fs has no remove; overwrite so loadCachedToken treats it as a miss.
        ctx.host.fs.writeText(path, "")
      }
    } catch (e) {
      ctx.host.log.warn("failed to remove stale refreshed-token cache: " + String(e))
    }
  }

  function loadCachedToken(ctx, sourceRefreshToken) {
    var expectedFingerprint = credentialFingerprint(ctx, sourceRefreshToken)
    if (!expectedFingerprint) {
      discardCachedToken(ctx)
      return null
    }
    var path = ctx.app.pluginDataDir + "/auth.json"
    try {
      if (!ctx.host.fs.exists(path)) return null
      var data = ctx.util.tryParseJson(ctx.host.fs.readText(path))
      if (!data || !data.accessToken || !data.expiresAtMs) {
        discardCachedToken(ctx)
        return null
      }
      // Bind cache to the verified local refresh credential (#961). Older unbound
      // caches decode as a safe miss and are discarded.
      if (data.credentialFingerprint !== expectedFingerprint) {
        discardCachedToken(ctx)
        return null
      }
      // Require refreshBuffer of life left (5 min), matching local token usability.
      if (data.expiresAtMs <= Date.now() + 5 * 60 * 1000) {
        discardCachedToken(ctx)
        return null
      }
      return data.accessToken
    } catch (e) {
      ctx.host.log.warn("failed to read cached token: " + String(e))
      return null
    }
  }

  function cacheToken(ctx, accessToken, expiresInSeconds, sourceRefreshToken) {
    var fingerprint = credentialFingerprint(ctx, sourceRefreshToken)
    if (!fingerprint || !trimString(accessToken)) return
    var path = ctx.app.pluginDataDir + "/auth.json"
    try {
      ctx.host.fs.writeText(path, JSON.stringify({
        accessToken: accessToken,
        expiresAtMs: Date.now() + (expiresInSeconds || 3600) * 1000,
        credentialFingerprint: fingerprint,
      }))
    } catch (e) {
      ctx.host.log.warn("failed to cache refreshed token: " + String(e))
    }
  }

  // --- agy keychain token ---

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

  function unwrapAgyKeychainText(ctx, raw) {
    var text = trimString(raw)
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
    text = trimString(text)
    if (!text) return null
    if (text.indexOf("go-keyring-base64:") === 0) {
      text = trimString(decodeBase64(ctx, text.slice("go-keyring-base64:".length)))
      if (text && text.charCodeAt(0) === 0xfeff) text = text.slice(1)
      text = trimString(text)
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
    for (var i = 0; i < directKeys.length; i++) {
      var value = obj[directKeys[i]]
      if (typeof value === "string" && value.trim()) return value.trim()
    }

    var nestedKeys = ["token", "tokens", "oauth", "oauth2", "credentials", "auth"]
    for (var j = 0; j < nestedKeys.length; j++) {
      var nested = extractTokenFromObject(obj[nestedKeys[j]])
      if (nested) return nested
    }

    return null
  }

  function extractAgyAccessToken(ctx, raw) {
    var text = unwrapAgyKeychainText(ctx, raw)
    if (!text) return null

    var looksStructured = text.charAt(0) === "{" || text.charAt(0) === "["
    var parsed = ctx.util.tryParseJson(text)
    if (typeof parsed === "string" && parsed.trim()) return parsed.trim()
    if (parsed) return extractTokenFromObject(parsed)
    // BOM-prefixed / malformed structured credentials must not be sent as Bearer tokens.
    if (looksStructured) return null

    if (text.indexOf("Bearer ") === 0) return text.slice("Bearer ".length).trim() || null
    return text
  }

  function extractAgyRefreshTokenFromObject(obj) {
    if (!obj || typeof obj !== "object") return null
    var directKeys = ["refresh_token", "refreshToken"]
    for (var i = 0; i < directKeys.length; i++) {
      var value = obj[directKeys[i]]
      if (typeof value === "string" && value.trim()) return value.trim()
    }

    var nestedKeys = ["token", "tokens", "oauth", "oauth2", "credentials", "auth"]
    for (var j = 0; j < nestedKeys.length; j++) {
      var nested = extractAgyRefreshTokenFromObject(obj[nestedKeys[j]])
      if (nested) return nested
    }

    return null
  }

  function extractAgyRefreshToken(ctx, raw) {
    var text = unwrapAgyKeychainText(ctx, raw)
    if (!text) return null
    return extractAgyRefreshTokenFromObject(ctx.util.tryParseJson(text))
  }

  function loadAgyKeychainTokens(ctx) {
    if (!ctx.host.keychain || typeof ctx.host.keychain.readGenericPassword !== "function") {
      return null
    }
    try {
      var raw = ctx.host.keychain.readGenericPassword(AGY_KEYCHAIN_SERVICE, AGY_KEYCHAIN_ACCOUNT)
      var accessToken = extractAgyAccessToken(ctx, raw)
      if (!accessToken) return null
      return {
        accessToken: accessToken,
        refreshToken: extractAgyRefreshToken(ctx, raw),
      }
    } catch (e) {
      ctx.host.log.info("agy keychain read failed: " + String(e))
      return null
    }
  }

  // --- LS discovery ---

  function discoverLs(ctx) {
    return ctx.host.ls.discover({
      processName: "language_server",
      markers: ["antigravity", "antigravity-ide"],
      csrfFlag: "--csrf_token",
      portFlag: "--extension_server_port",
    })
  }

  function discoverAgyLs(ctx) {
    return ctx.host.ls.discover({
      processName: "agy",
      markers: [],
      csrfFlag: "",
      portFlag: null,
    })
  }

  function probePort(ctx, scheme, port, csrf) {
    ctx.host.http.request({
      method: "POST",
      url: scheme + "://127.0.0.1:" + port + "/" + LS_SERVICE + "/GetUnleashData",
      headers: {
        "Content-Type": "application/json",
        "Connect-Protocol-Version": "1",
        "x-codeium-csrf-token": csrf,
      },
      bodyText: JSON.stringify({
        context: {
          properties: {
            devMode: "false",
            extensionVersion: "unknown",
            ide: "antigravity",
            ideVersion: "unknown",
            os: "macos",
          },
        },
      }),
      timeoutMs: 5000,
      dangerouslyIgnoreTls: scheme === "https",
    })
    // Any HTTP response means this port is alive (even 400 validation errors).
    return true
  }

  function findWorkingPort(ctx, discovery) {
    var ports = discovery.ports || []
    for (var i = 0; i < ports.length; i++) {
      var port = ports[i]
      // Try HTTPS first (LS may use self-signed cert), then HTTP
      try { if (probePort(ctx, "https", port, discovery.csrf)) return { port: port, scheme: "https" } } catch (e) { /* ignore */ }
      try { if (probePort(ctx, "http", port, discovery.csrf)) return { port: port, scheme: "http" } } catch (e) { /* ignore */ }
      ctx.host.log.info("port " + port + " probe failed on both schemes")
    }
    if (discovery.extensionPort) return { port: discovery.extensionPort, scheme: "http" }
    return null
  }

  function callLs(ctx, port, scheme, csrf, method, body) {
    var resp = ctx.host.http.request({
      method: "POST",
      url: scheme + "://127.0.0.1:" + port + "/" + LS_SERVICE + "/" + method,
      headers: {
        "Content-Type": "application/json",
        "Connect-Protocol-Version": "1",
        "x-codeium-csrf-token": csrf,
      },
      bodyText: JSON.stringify(body || {}),
      timeoutMs: 10000,
      dangerouslyIgnoreTls: scheme === "https",
    })
    if (resp.status < 200 || resp.status >= 300) {
      ctx.host.log.warn("callLs " + method + " returned " + resp.status)
      return null
    }
    return ctx.util.tryParseJson(resp.bodyText)
  }

  // --- Line builders ---

  function normalizeLabel(label) {
    // "Gemini 3 Pro (High)" -> "Gemini 3 Pro"
    return label.replace(/\s*\([^)]*\)\s*$/, "").trim()
  }

  function poolLabel(normalizedLabel) {
    var lower = normalizedLabel.toLowerCase()
    if (lower.indexOf("gemini") !== -1 && lower.indexOf("pro") !== -1) return "Gemini Pro"
    if (lower.indexOf("gemini") !== -1 && lower.indexOf("flash") !== -1) return "Gemini Flash"
    // All non-Gemini models (Claude, GPT-OSS, etc.) share a single quota pool
    return "Claude"
  }

  function modelSortKey(label) {
    var lower = label.toLowerCase()
    // Gemini Pro variants first, then other Gemini, then Claude Opus, then other Claude, then rest
    if (lower.indexOf("gemini") !== -1 && lower.indexOf("pro") !== -1) return "0a_" + label
    if (lower.indexOf("gemini") !== -1) return "0b_" + label
    if (lower.indexOf("claude") !== -1 && lower.indexOf("opus") !== -1) return "1a_" + label
    if (lower.indexOf("claude") !== -1) return "1b_" + label
    return "2_" + label
  }

  var QUOTA_PERIOD_MS = 5 * 60 * 60 * 1000 // 5 hours
  var QUOTA_WEEKLY_MS = 7 * 24 * 60 * 60 * 1000

  var SUMMARY_BUCKETS = [
    { bucketId: "gemini-5h", label: "Session", periodMs: QUOTA_PERIOD_MS },
    { bucketId: "gemini-weekly", label: "Weekly", periodMs: QUOTA_WEEKLY_MS },
    { bucketId: "3p-5h", label: "Session \u2014 Claude and GPT Models", periodMs: QUOTA_PERIOD_MS },
    { bucketId: "3p-weekly", label: "Weekly \u2014 Claude and GPT Models", periodMs: QUOTA_WEEKLY_MS },
  ]

  function modelLine(ctx, label, remainingFraction, resetTime, periodMs) {
    var duration = typeof periodMs === "number" ? periodMs : QUOTA_PERIOD_MS
    var clamped = Math.max(0, Math.min(1, remainingFraction))
    var used = Math.round((1 - clamped) * 100)
    return ctx.line.progress({
      label: label,
      used: used,
      limit: 100,
      format: { kind: "percent" },
      resetsAt: resetTime || undefined,
      periodDurationMs: duration,
      color: "#4285F4",
    })
  }

  function parseQuotaSummary(ctx, data) {
    if (!data || typeof data !== "object") return null
    var groups = (data.response && data.response.groups) || data.groups
    if (!Array.isArray(groups)) return null

    var pooled = {}
    for (var gi = 0; gi < groups.length; gi++) {
      var buckets = groups[gi] && groups[gi].buckets
      if (!Array.isArray(buckets)) continue
      for (var bi = 0; bi < buckets.length; bi++) {
        var bucket = buckets[bi]
        if (!bucket || typeof bucket !== "object") continue
        var id = typeof bucket.bucketId === "string" ? bucket.bucketId : ""
        if (!id || pooled[id]) continue
        var spec = null
        for (var si = 0; si < SUMMARY_BUCKETS.length; si++) {
          if (SUMMARY_BUCKETS[si].bucketId === id) {
            spec = SUMMARY_BUCKETS[si]
            break
          }
        }
        if (!spec) continue
        var frac = bucket.remainingFraction
        if (typeof frac !== "number" || !Number.isFinite(frac)) continue
        pooled[id] = {
          fraction: frac,
          resetTime: bucket.resetTime || undefined,
          periodMs: spec.periodMs,
          label: spec.label,
        }
      }
    }

    var lines = []
    for (var i = 0; i < SUMMARY_BUCKETS.length; i++) {
      var entry = pooled[SUMMARY_BUCKETS[i].bucketId]
      if (!entry) continue
      lines.push(modelLine(ctx, entry.label, entry.fraction, entry.resetTime, entry.periodMs))
    }
    return lines
  }

  function readPlanFromUserStatus(data, hasUserStatus) {
    if (!hasUserStatus || !data || !data.userStatus) return null
    var ut = data.userStatus.userTier
    var userTierName =
      ut && typeof ut.name === "string" && ut.name.trim() ? ut.name.trim() : null
    if (userTierName) return userTierName
    var ps = data.userStatus.planStatus || {}
    var pi = ps.planInfo || {}
    return typeof pi.planName === "string" && pi.planName.trim() ? pi.planName.trim() : null
  }

  function buildModelLines(ctx, configs) {
    var deduped = {}
    for (var i = 0; i < configs.length; i++) {
      var c = configs[i]
      var label = (typeof c.label === "string") ? c.label.trim() : ""
      if (!label) continue
      var qi = c.quotaInfo
      var frac = (qi && typeof qi.remainingFraction === "number") ? qi.remainingFraction : 0
      var rtime = (qi && qi.resetTime) || undefined
      var pool = poolLabel(normalizeLabel(label))
      if (!deduped[pool] || frac < deduped[pool].remainingFraction) {
        deduped[pool] = {
          label: pool,
          remainingFraction: frac,
          resetTime: rtime,
        }
      }
    }

    var models = []
    var keys = Object.keys(deduped)
    for (var i = 0; i < keys.length; i++) {
      var m = deduped[keys[i]]
      m.sortKey = modelSortKey(m.label)
      models.push(m)
    }

    models.sort(function (a, b) {
      return a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0
    })

    var lines = []
    for (var i = 0; i < models.length; i++) {
      lines.push(modelLine(ctx, models[i].label, models[i].remainingFraction, models[i].resetTime))
    }
    return lines
  }

  // --- Cloud Code API ---

  function requestCloudCodeJson(ctx, path, token, userAgent, body) {
    for (var i = 0; i < CLOUD_CODE_URLS.length; i++) {
      try {
        var resp = ctx.host.http.request({
          method: "POST",
          url: CLOUD_CODE_URLS[i] + path,
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
            "User-Agent": userAgent || "antigravity",
          },
          bodyText: JSON.stringify(body || {}),
          timeoutMs: 15000,
        })
        if (!resp || typeof resp.status !== "number" || !Number.isFinite(resp.status)) {
          ctx.host.log.warn("Cloud Code returned invalid response shape (" + CLOUD_CODE_URLS[i] + ")")
          continue
        }
        if (ctx.util.isAuthStatus(resp.status)) return { _authFailed: true }
        if (resp.status >= 200 && resp.status < 300) {
          var json = ctx.util.tryParseJson(resp.bodyText)
          if (!json || typeof json !== "object") {
            ctx.host.log.warn("Cloud Code returned invalid JSON (" + CLOUD_CODE_URLS[i] + ")")
            continue
          }
          return json
        }
      } catch (e) {
        ctx.host.log.warn("Cloud Code request failed (" + CLOUD_CODE_URLS[i] + "): " + String(e))
      }
    }
    return null
  }

  function hasQuotaSummary(ctx, data) {
    var lines = parseQuotaSummary(ctx, data)
    return lines !== null && lines.length > 0
  }

  function probeCloudCode(ctx, token) {
    var summaryData = requestCloudCodeJson(ctx, RETRIEVE_QUOTA_SUMMARY_PATH, token, "antigravity", {})
    if (summaryData && summaryData._authFailed) return summaryData
    if (hasQuotaSummary(ctx, summaryData)) return summaryData

    // Older Cloud Code deployments can still lack quota summaries. Preserve the
    // established model endpoint only as a compatibility fallback.
    return requestCloudCodeJson(ctx, FETCH_MODELS_PATH, token, "antigravity", {})
  }

  function parseCloudCodeModels(data) {
    var modelsObj = data && data.models
    if (!modelsObj || typeof modelsObj !== "object") return []
    var keys = Object.keys(modelsObj)
    var configs = []
    for (var i = 0; i < keys.length; i++) {
      var m = modelsObj[keys[i]]
      if (!m || typeof m !== "object") continue
      if (m.isInternal) continue
      var modelId = m.model || keys[i]
      if (CC_MODEL_BLACKLIST[modelId]) continue
      var displayName =
        (typeof m.displayName === "string" && m.displayName.trim()) ||
        (typeof m.label === "string" && m.label.trim()) ||
        ""
      if (!displayName) continue
      var qi = m.quotaInfo
      var frac = (qi && typeof qi.remainingFraction === "number") ? qi.remainingFraction : 0
      var rtime = (qi && qi.resetTime) || undefined
      configs.push({
        label: displayName,
        quotaInfo: { remainingFraction: frac, resetTime: rtime },
      })
    }
    return configs
  }

  function readAgyPlan(loadData) {
    var paidTier = loadData && loadData.paidTier
    if (paidTier && typeof paidTier.name === "string" && paidTier.name.trim()) {
      return paidTier.name.trim()
    }
    var currentTier = loadData && loadData.currentTier
    if (currentTier && typeof currentTier.name === "string" && currentTier.name.trim()) {
      return currentTier.name.trim()
    }
    return null
  }

  function parseAgyQuotaBuckets(data) {
    var buckets = data && data.buckets
    if (!Array.isArray(buckets)) return []
    var configs = []
    for (var i = 0; i < buckets.length; i++) {
      var bucket = buckets[i]
      if (!bucket || typeof bucket !== "object") continue
      var modelId = (typeof bucket.modelId === "string" && bucket.modelId.trim()) || ""
      if (!modelId) continue
      var frac = (typeof bucket.remainingFraction === "number") ? bucket.remainingFraction : 0
      configs.push({
        label: modelId,
        quotaInfo: { remainingFraction: frac, resetTime: bucket.resetTime || undefined },
      })
    }
    return configs
  }

  function probeAgyCloudCode(ctx, token) {
    var summaryData = requestCloudCodeJson(ctx, RETRIEVE_QUOTA_SUMMARY_PATH, token, "antigravity", {})
    if (summaryData && summaryData._authFailed) return summaryData
    var summaryLines = parseQuotaSummary(ctx, summaryData)
    if (summaryLines && summaryLines.length > 0) return { plan: null, lines: summaryLines }

    // `agy` used these endpoints before retrieveUserQuotaSummary was available.
    // Keep them only for older installations that return no usable summary.
    var loadData = requestCloudCodeJson(ctx, LOAD_CODE_ASSIST_PATH, token, "agy", {})
    if (!loadData || loadData._authFailed) return loadData

    var project =
      typeof loadData.cloudaicompanionProject === "string" && loadData.cloudaicompanionProject.trim()
        ? loadData.cloudaicompanionProject.trim()
        : null
    var quotaData = null
    if (project) {
      quotaData = requestCloudCodeJson(ctx, RETRIEVE_QUOTA_PATH, token, "agy", { project: project })
    }
    if (!quotaData || quotaData._authFailed) {
      quotaData = requestCloudCodeJson(ctx, RETRIEVE_QUOTA_PATH, token, "agy", {})
    }
    if (!quotaData || quotaData._authFailed) return quotaData

    var lines = buildModelLines(ctx, parseAgyQuotaBuckets(quotaData))
    if (lines.length === 0) return null
    return { plan: readAgyPlan(loadData), lines: lines }
  }

  // --- LS probe ---

  function probeDiscovery(ctx, discovery) {
    if (!discovery) return null

    var found = findWorkingPort(ctx, discovery)
    if (!found) return null

    ctx.host.log.info("using LS at " + found.scheme + "://127.0.0.1:" + found.port)

    var metadata = {
      ideName: "antigravity",
      extensionName: "antigravity",
      ideVersion: "unknown",
      locale: "en",
    }

    var summaryData = null
    try {
      summaryData = callLs(
        ctx,
        found.port,
        found.scheme,
        discovery.csrf,
        "RetrieveUserQuotaSummary",
        { metadata: metadata },
      )
    } catch (e) {
      ctx.host.log.warn("RetrieveUserQuotaSummary threw: " + String(e))
    }

    // Try GetUserStatus first, fall back to GetCommandModelConfigs
    var data = null
    try {
      data = callLs(ctx, found.port, found.scheme, discovery.csrf, "GetUserStatus", { metadata: metadata })
    } catch (e) {
      ctx.host.log.warn("GetUserStatus threw: " + String(e))
    }
    var hasUserStatus = data && data.userStatus

    if (summaryData) {
      var summaryLines = parseQuotaSummary(ctx, summaryData)
      if (summaryLines !== null) {
        return {
          plan: readPlanFromUserStatus(data, hasUserStatus),
          lines: summaryLines,
        }
      }
    }

    if (!hasUserStatus) {
      ctx.host.log.warn("GetUserStatus failed, trying GetCommandModelConfigs")
      data = callLs(ctx, found.port, found.scheme, discovery.csrf, "GetCommandModelConfigs", { metadata: metadata })
    }

    // Parse model configs
    var configs
    if (hasUserStatus) {
      configs = (data.userStatus.cascadeModelConfigData || {}).clientModelConfigs || []
    } else if (data && data.clientModelConfigs) {
      configs = data.clientModelConfigs
    } else {
      return null
    }

    var filtered = []
    for (var j = 0; j < configs.length; j++) {
      var mid = configs[j].modelOrAlias && configs[j].modelOrAlias.model
      if (mid && CC_MODEL_BLACKLIST[mid]) continue
      filtered.push(configs[j])
    }

    var lines = buildModelLines(ctx, filtered)
    if (lines.length === 0) return null

    return { plan: readPlanFromUserStatus(data, hasUserStatus), lines: lines }
  }

  function probeLs(ctx) {
    return probeDiscovery(ctx, discoverLs(ctx))
  }

  function probeAgyLs(ctx) {
    return probeDiscovery(ctx, discoverAgyLs(ctx))
  }

  // --- Local conversation spend (SQLite protobuf via host.antigravityLogs) ---

  function fmtSpendTokens(n) {
    var abs = Math.abs(n)
    var sign = n < 0 ? "-" : ""
    if (abs >= 1e9) return sign + (abs / 1e9 >= 10 ? Math.round(abs / 1e9) : (abs / 1e9).toFixed(1).replace(/\.0$/, "")) + "B"
    if (abs >= 1e6) return sign + (abs / 1e6 >= 10 ? Math.round(abs / 1e6) : (abs / 1e6).toFixed(1).replace(/\.0$/, "")) + "M"
    if (abs >= 1e3) return sign + (abs / 1e3 >= 10 ? Math.round(abs / 1e3) : (abs / 1e3).toFixed(1).replace(/\.0$/, "")) + "K"
    return sign + Math.round(abs).toString()
  }

  function spendDayKey(date) {
    var y = date.getFullYear()
    var m = date.getMonth() + 1
    var d = date.getDate()
    return y + "-" + (m < 10 ? "0" : "") + m + "-" + (d < 10 ? "0" : "") + d
  }

  function spendUsageDayKey(raw) {
    if (typeof raw !== "string") return null
    var v = raw.trim()
    var m = v.match(/^(\d{4})-(\d{2})-(\d{2})/)
    return m ? m[1] + "-" + m[2] + "-" + m[3] : null
  }

  function spendCostUsd(day) {
    if (!day || typeof day !== "object") return null
    if (day.totalCost != null && Number.isFinite(Number(day.totalCost))) return Number(day.totalCost)
    if (day.costUSD != null && Number.isFinite(Number(day.costUSD))) return Number(day.costUSD)
    return null
  }

  function spendLabel(tokens, cost, includeZero) {
    var parts = []
    if (cost != null && Number.isFinite(cost)) parts.push("$" + cost.toFixed(2))
    if (tokens > 0 || (includeZero && tokens === 0)) parts.push(fmtSpendTokens(tokens) + " tokens")
    return parts.join(" \u00b7 ")
  }

  function spendModelBreakdown(day) {
    if (!day || !day.models || typeof day.models !== "object") return undefined
    var names = Object.keys(day.models)
    var rows = []
    var total = 0
    for (var i = 0; i < names.length; i++) {
      var usage = day.models[names[i]]
      var tokens = Number(usage && usage.totalTokens) || 0
      if (tokens <= 0) continue
      total += tokens
      var cost = usage && usage.totalCost != null ? Number(usage.totalCost) : undefined
      rows.push({ model: names[i], tokens: tokens, costUsd: Number.isFinite(cost) ? cost : undefined })
    }
    if (total <= 0 || rows.length === 0) return undefined
    var sumPct = 0
    rows.sort(function (a, b) { return b.tokens - a.tokens || a.model.localeCompare(b.model) })
    for (var j = 0; j < rows.length; j++) {
      var pct = (rows[j].tokens / total) * 100
      rows[j].percent = j === rows.length - 1 ? Math.max(0, 100 - sumPct) : Math.round(pct * 10) / 10
      sumPct += rows[j].percent
    }
    return rows
  }

  function attachLocalSpend(ctx, result, displayName) {
    if (!result || !Array.isArray(result.lines)) return result
    if (!ctx.host.antigravityLogs || typeof ctx.host.antigravityLogs.queryDaily !== "function") return result
    try {
      var since = new Date()
      since.setDate(since.getDate() - 30)
      var sinceStr = "" + since.getFullYear()
        + (since.getMonth() + 1 < 10 ? "0" : "") + (since.getMonth() + 1)
        + (since.getDate() < 10 ? "0" : "") + since.getDate()
      var resp = ctx.host.antigravityLogs.queryDaily({ since: sinceStr })
      if (!resp || resp.status !== "ok" || !resp.data || !Array.isArray(resp.data.daily)) return result
      var daily = resp.data.daily
      var now = new Date()
      var todayKey = spendDayKey(now)
      var yest = new Date(now.getTime())
      yest.setDate(yest.getDate() - 1)
      var yestKey = spendDayKey(yest)
      var todayEntry = null
      var yestEntry = null
      var totalTokens = 0
      var totalCostNanos = 0
      var hasCost = false
      var points = []
      for (var i = 0; i < daily.length; i++) {
        var day = daily[i]
        var key = spendUsageDayKey(day && day.date)
        var tokens = Number(day && day.totalTokens)
        if (!Number.isFinite(tokens) || tokens < 0) tokens = 0
        if (key === todayKey) todayEntry = day
        else if (key === yestKey) yestEntry = day
        totalTokens += tokens
        var dayCost = spendCostUsd(day)
        if (dayCost != null) {
          totalCostNanos += Math.round(dayCost * 1e9)
          hasCost = true
        }
        if (key && tokens >= 0) {
          var month = Number(key.slice(5, 7))
          var dom = Number(key.slice(8, 10))
          points.push({
            key: key,
            label: month + "/" + dom,
            value: tokens,
            valueLabel: fmtSpendTokens(tokens) + " tokens",
          })
        }
      }
      function pushDay(label, entry) {
        var tokens = Number(entry && entry.totalTokens) || 0
        var cost = spendCostUsd(entry)
        result.lines.push(ctx.line.text({
          label: label,
          value: spendLabel(tokens, tokens > 0 ? cost : (tokens === 0 ? 0 : cost), tokens === 0),
          modelBreakdown: spendModelBreakdown(entry),
        }))
      }
      pushDay("Today", todayEntry)
      pushDay("Yesterday", yestEntry)
      if (totalTokens > 0) {
        result.lines.push(ctx.line.text({
          label: "Last 30 Days",
          value: spendLabel(totalTokens, hasCost ? totalCostNanos / 1e9 : null, false),
        }))
      }
      points.sort(function (a, b) { return a.key.localeCompare(b.key) })
      points = points.slice(-31).map(function (p) {
        return { label: p.label, value: p.value, valueLabel: p.valueLabel }
      })
      if (points.length > 0) {
        result.lines.push(ctx.line.barChart({
          label: "Usage Trend",
          points: points,
          note: "Estimated from local Antigravity conversation logs at API rates.",
          color: "#4285F4",
        }))
      }
      if (ctx.host.usageDaily && typeof ctx.host.usageDaily.ingest === "function" && daily.length) {
        try { ctx.host.usageDaily.ingest({ displayName: displayName, daily: daily }) } catch (e) { /* ignore */ }
      }
    } catch (e) {
      ctx.host.log.warn("antigravityLogs spend scan failed: " + String(e))
    }
    return result
  }

  // --- Probe ---

  function probe(ctx) {
    return attachLocalSpend(ctx, probeQuota(ctx), "Antigravity")
  }

  function probeQuota(ctx) {
    var lsResult = probeLs(ctx)
    if (lsResult) return lsResult

    var agyLsResult = probeAgyLs(ctx)
    if (agyLsResult) return agyLsResult

    var dbTokenCandidates = loadOAuthTokenCandidates(ctx)

    var tokens = []
    var injected = ctx.util.readProviderCredential && ctx.util.readProviderCredential()
    if (injected && injected.accessToken && tokens.indexOf(injected.accessToken) === -1) {
      tokens.push(injected.accessToken)
    }
    var nowSec = Math.floor(Date.now() / 1000)
    var localRefreshTokens = []
    for (var i = 0; i < dbTokenCandidates.length; i++) {
      var dbTokens = dbTokenCandidates[i]
      if (dbTokens.accessToken && (!dbTokens.expirySeconds || dbTokens.expirySeconds > nowSec)) {
        if (tokens.indexOf(dbTokens.accessToken) === -1) tokens.push(dbTokens.accessToken)
      }
      if (dbTokens.refreshToken && localRefreshTokens.indexOf(dbTokens.refreshToken) === -1) {
        localRefreshTokens.push(dbTokens.refreshToken)
      }
    }
    if (injected && injected.refreshToken && localRefreshTokens.indexOf(injected.refreshToken) === -1) {
      localRefreshTokens.push(injected.refreshToken)
    }

    // No verified local auth → purge any derived cache so a logout cannot reuse it (#961).
    if (localRefreshTokens.length === 0 && tokens.length === 0) {
      discardCachedToken(ctx)
    } else {
      for (var c = 0; c < localRefreshTokens.length; c++) {
        var cached = loadCachedToken(ctx, localRefreshTokens[c])
        if (cached && tokens.indexOf(cached) === -1) tokens.push(cached)
      }
    }

    var ccData = null
    var sawAuthFailure = false
    for (var i = 0; i < tokens.length; i++) {
      var nextData = probeCloudCode(ctx, tokens[i])
      if (nextData && !nextData._authFailed) {
        ccData = nextData
        break
      }
      if (nextData && nextData._authFailed) sawAuthFailure = true
    }

    // Only refresh on evidence of an auth failure, or when there were no tokens to try.
    // probeCloudCode returns null for transient failures (5xx/timeouts); without this
    // guard a Cloud Code incident would trigger a Google OAuth refresh every probe cycle
    // instead of ~once per token lifetime — risking refresh-token throttling or rotation.
    if (!ccData && (sawAuthFailure || tokens.length === 0)) {
      var refreshTokens = localRefreshTokens.slice()
      for (var k = 0; k < refreshTokens.length; k++) {
        var refreshed = refreshAccessToken(ctx, refreshTokens[k])
        if (!refreshed) continue
        var refreshedData = probeCloudCode(ctx, refreshed)
        if (refreshedData && !refreshedData._authFailed) {
          ccData = refreshedData
          break
        }
        if (refreshedData && refreshedData._authFailed) ccData = refreshedData
      }
    }

    if (!ccData || ccData._authFailed) {
      var agyTokens = loadAgyKeychainTokens(ctx)
      if (agyTokens) {
        var agyResult = probeAgyCloudCode(ctx, agyTokens.accessToken)
        if (agyResult && !agyResult._authFailed) return agyResult
        if (agyResult && agyResult._authFailed) {
          ccData = agyResult
          if (agyTokens.refreshToken) {
            var refreshedAgyToken = refreshAccessToken(ctx, agyTokens.refreshToken)
            if (refreshedAgyToken) {
              var refreshedAgyResult = probeAgyCloudCode(ctx, refreshedAgyToken)
              if (refreshedAgyResult && !refreshedAgyResult._authFailed) return refreshedAgyResult
              if (refreshedAgyResult && refreshedAgyResult._authFailed) ccData = refreshedAgyResult
            }
          }
        }
      }
    }

    if (ccData && !ccData._authFailed) {
      var summaryLines = parseQuotaSummary(ctx, ccData)
      if (summaryLines && summaryLines.length > 0) return { plan: null, lines: summaryLines }
      var configs = parseCloudCodeModels(ccData)
      var lines = buildModelLines(ctx, configs)
      if (lines.length > 0) return { plan: null, lines: lines }
    }

    throw LOGIN_MESSAGE
  }

  globalThis.__openusage_plugin = { id: "antigravity", probe: probe }
})()
