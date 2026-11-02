(function () {
  var QUOTA_FILENAME = "AIAssistantQuotaManager2.xml"
  var JUNIE_INSTANCES_DIR = "~/.junie/instances"
  var JUNIE_SESSIONS_DIR = "~/.junie/sessions"
  var JUNIE_SECURE_CREDENTIALS_FILE = "~/.junie/secure_credentials.json"
  var JUNIE_KEYCHAIN_SERVICE = "junie-cli"
  var JUNIE_ACCOUNT_KEY = "jb-account-stored"
  var INGRAZZIO_AUTH_TEST_URL = "https://ingrazzio-cloud-prod.labs.jb.gg/auth/test"
  var JBA_OAUTH_TOKEN_URL = "https://oauth.account.jetbrains.com/oauth2/token"

  // JetBrains stores AI quota in 1e-5 credit units; divide by this to get credits.
  var CREDIT_UNIT_SCALE = 100000

  // Included credits on current JetBrains plans. The Aug 2025 currency model used
  // 10 (Pro) and 35 (Ultimate); those caps clamp a live balance that is still
  // inside the real tariff, and top-ups can sit above either number.
  var AI_PRO_CREDITS = 20
  var AI_ULTIMATE_CREDITS = 70
  var UNKNOWN_PLAN_CREDIT_FLOOR = 10
  var TOKEN_REFRESH_SKEW_MS = 60 * 1000
  // An undated IDE quota file has no mtime. Sessions older than this do not
  // outrank it; a dated idea.log is compared by its own timestamp instead.
  var SESSION_UNDATED_LIVE_MAX_AGE_MS = 48 * 60 * 60 * 1000

  var LICENSE_NAMES = {
    AIP: "JetBrains AI Pro",
    AIPU: "JetBrains AI Ultimate",
    AIF: "JetBrains AI Free",
    TRIAL: "JetBrains AI Trial",
    JUNP: "Junie EAP",
  }

  var PRODUCT_PREFIXES = [
    "Aqua",
    "AndroidStudio",
    "CLion",
    "DataGrip",
    "DataSpell",
    "GoLand",
    "IdeaIC",
    "IntelliJIdea",
    "IntelliJIdeaCE",
    "PhpStorm",
    "PyCharm",
    "PyCharmCE",
    "Rider",
    "RubyMine",
    "RustRover",
    "WebStorm",
    "Writerside",
  ]

  function platformBaseDirs(platform) {
    if (platform === "macos") {
      return ["~/Library/Application Support/JetBrains"]
    }
    if (platform === "linux") {
      return ["~/.config/JetBrains"]
    }
    if (platform === "windows") {
      return ["~/AppData/Roaming/JetBrains"]
    }
    return [
      "~/Library/Application Support/JetBrains",
      "~/.config/JetBrains",
      "~/AppData/Roaming/JetBrains",
    ]
  }

  function platformLogDirs(platform) {
    if (platform === "macos") {
      return ["~/Library/Logs/JetBrains"]
    }
    if (platform === "linux") {
      return ["~/.cache/JetBrains"]
    }
    if (platform === "windows") {
      return ["~/AppData/Local/JetBrains"]
    }
    return [
      "~/Library/Logs/JetBrains",
      "~/.cache/JetBrains",
      "~/AppData/Local/JetBrains",
    ]
  }

  function isLikelyIdeDirName(name) {
    if (typeof name !== "string") return false
    var trimmed = name.trim()
    if (!trimmed) return false
    var hasPrefix = false
    for (var i = 0; i < PRODUCT_PREFIXES.length; i += 1) {
      if (trimmed.indexOf(PRODUCT_PREFIXES[i]) === 0) {
        hasPrefix = true
        break
      }
    }
    if (!hasPrefix) return false
    return /\d{4}\.\d/.test(trimmed)
  }

  function safeListDir(ctx, path) {
    if (
      !ctx.host.fs ||
      typeof ctx.host.fs.listDir !== "function" ||
      !ctx.host.fs.exists(path)
    ) {
      return []
    }

    try {
      var entries = ctx.host.fs.listDir(path)
      return Array.isArray(entries) ? entries : []
    } catch (e) {
      ctx.host.log.warn("listDir failed for " + path + ": " + String(e))
      return []
    }
  }

  function buildQuotaPaths(ctx) {
    var bases = platformBaseDirs(ctx.app.platform)
    var paths = []
    var seen = Object.create(null)
    for (var b = 0; b < bases.length; b += 1) {
      var base = bases[b]
      var entries = safeListDir(ctx, base)
      for (var i = 0; i < entries.length; i += 1) {
        var dirName = entries[i]
        if (!isLikelyIdeDirName(dirName)) continue
        var quotaPath = base + "/" + dirName + "/options/" + QUOTA_FILENAME
        if (!ctx.host.fs.exists(quotaPath)) continue
        if (!seen[quotaPath]) {
          seen[quotaPath] = true
          paths.push(quotaPath)
        }
      }
    }
    return paths
  }

  function buildIdeaLogPaths(ctx) {
    var bases = platformLogDirs(ctx.app.platform)
    var paths = []
    var seen = Object.create(null)
    for (var b = 0; b < bases.length; b += 1) {
      var base = bases[b]
      var entries = safeListDir(ctx, base)
      for (var i = 0; i < entries.length; i += 1) {
        var dirName = entries[i]
        if (!isLikelyIdeDirName(dirName)) continue
        var candidates = [
          base + "/" + dirName + "/log/idea.log",
          base + "/" + dirName + "/idea.log",
        ]
        for (var c = 0; c < candidates.length; c += 1) {
          var logPath = candidates[c]
          if (!ctx.host.fs.exists(logPath)) continue
          if (!seen[logPath]) {
            seen[logPath] = true
            paths.push(logPath)
          }
        }
      }
    }
    return paths
  }

  function decodeXmlEntities(text) {
    if (!text) return ""
    return String(text)
      .replace(/&#10;/g, "\n")
      .replace(/&#13;/g, "\r")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
  }

  function parseOptionJson(ctx, xml, optionName) {
    var elemMatch = xml.match(new RegExp('<option\\b[^>]*\\bname="' + optionName + '"[^>]*/>'))
    if (!elemMatch) return null
    var valueMatch = elemMatch[0].match(/\bvalue="([^"]*)"/)
    if (!valueMatch) return null
    return ctx.util.tryParseJson(decodeXmlEntities(valueMatch[1]))
  }

  function toNumber(value) {
    if (value === null || value === undefined || value === "") return null
    var n = Number(value)
    return Number.isFinite(n) ? n : null
  }

  function clamp(value, min, max) {
    if (value < min) return min
    if (value > max) return max
    return value
  }

  function resolvePlanLabel(licenseName, licenseType) {
    if (typeof licenseName === "string" && licenseName.trim()) {
      return licenseName.trim()
    }
    if (typeof licenseType === "string" && licenseType.trim()) {
      var code = licenseType.trim()
      if (LICENSE_NAMES[code]) return LICENSE_NAMES[code]
      return code
    }
    return null
  }

  function normalizeQuota(quotaInfo) {
    if (!quotaInfo || typeof quotaInfo !== "object") return null

    var maximum = toNumber(quotaInfo.maximum)
    if (maximum === null) maximum = toNumber(quotaInfo.creditsMaximum)

    var used = toNumber(quotaInfo.current)
    if (used === null) used = toNumber(quotaInfo.creditsUsed)

    var remaining = toNumber(quotaInfo.available)
    if (remaining === null) remaining = toNumber(quotaInfo.creditsAvailable)
    if (remaining === null) remaining = toNumber(quotaInfo.balanceLeft)

    var tariff = quotaInfo.tariffQuota && typeof quotaInfo.tariffQuota === "object"
      ? quotaInfo.tariffQuota
      : null
    var topUp = quotaInfo.topUpQuota && typeof quotaInfo.topUpQuota === "object"
      ? quotaInfo.topUpQuota
      : null

    if (maximum === null) {
      var tariffMaximum = tariff ? toNumber(tariff.maximum) : null
      var topUpMaximum = topUp ? toNumber(topUp.maximum) : null
      if (tariffMaximum !== null || topUpMaximum !== null) {
        maximum = (tariffMaximum !== null ? tariffMaximum : 0) + (topUpMaximum !== null ? topUpMaximum : 0)
      }
    }

    if (used === null) {
      var tariffUsed = tariff ? toNumber(tariff.current) : null
      var topUpUsed = topUp ? toNumber(topUp.current) : null
      if (tariffUsed !== null || topUpUsed !== null) {
        used = (tariffUsed !== null ? tariffUsed : 0) + (topUpUsed !== null ? topUpUsed : 0)
      }
    }

    if (remaining === null) {
      var tariffRemaining = tariff ? toNumber(tariff.available) : null
      var topUpRemaining = topUp ? toNumber(topUp.available) : null
      if (tariffRemaining !== null || topUpRemaining !== null) {
        remaining = (tariffRemaining !== null ? tariffRemaining : 0) + (topUpRemaining !== null ? topUpRemaining : 0)
      }
    }

    if (used === null && maximum !== null && remaining !== null) {
      used = maximum - remaining
    }

    if (remaining === null && maximum !== null && used !== null) {
      remaining = maximum - used
    }

    if (maximum === null || maximum <= 0 || used === null) return null

    used = clamp(used, 0, maximum)
    if (remaining !== null) remaining = clamp(remaining, 0, maximum)

    var until = quotaInfo.until || null
    if (!until && quotaInfo.nextRefillMillis) {
      var refillMs = toNumber(quotaInfo.nextRefillMillis)
      if (refillMs !== null && refillMs > 0) {
        until = new Date(refillMs).toISOString()
      }
    }

    return {
      used: used,
      maximum: maximum,
      remaining: remaining,
      until: until,
      plan: resolvePlanLabel(quotaInfo.licenseName, quotaInfo.licenseType),
    }
  }

  function readQuotaState(ctx, path) {
    if (!ctx.host.fs.exists(path)) return null
    try {
      var xml = ctx.host.fs.readText(path)
      var quotaInfo = parseOptionJson(ctx, xml, "quotaInfo")
      var nextRefill = parseOptionJson(ctx, xml, "nextRefill")
      var quota = normalizeQuota(quotaInfo)
      if (!quota) return null
      return { path: path, quota: quota, nextRefill: nextRefill, tier: 5 }
    } catch (e) {
      ctx.host.log.warn("failed reading quota state " + path + ": " + String(e))
      return null
    }
  }

  // Tier 1: Live JetBrains IDE Local JSON-RPC Bridge (~/.junie/instances/*.json)
  function probeLiveIdeRpc(ctx) {
    if (!ctx.host.http || typeof ctx.host.http.request !== "function") return []
    var entries = safeListDir(ctx, JUNIE_INSTANCES_DIR)
    var states = []

    for (var i = 0; i < entries.length; i += 1) {
      var fileName = entries[i]
      if (typeof fileName !== "string" || !/\.json$/i.test(fileName)) continue
      var instancePath = JUNIE_INSTANCES_DIR + "/" + fileName
      try {
        var raw = ctx.host.fs.readText(instancePath)
        var instance = ctx.util.tryParseJson(raw)
        if (!instance || typeof instance !== "object") continue
        var port = toNumber(instance.port)
        var rpcToken = typeof instance.rpc_token === "string" ? instance.rpc_token.trim() : ""
        if (!port || port <= 0 || port > 65535 || !rpcToken) continue

        var resp = ctx.host.http.request({
          method: "POST",
          url: "http://127.0.0.1:" + String(port) + "/rpc",
          headers: {
            "Content-Type": "application/json",
            Authorization: rpcToken,
          },
          bodyText: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "JunieSystemService.getQuotaInfo",
            params: {},
          }),
          timeoutMs: 1500,
        })

        if (!resp || resp.status < 200 || resp.status >= 300 || !resp.bodyText) continue
        var payload = ctx.util.tryParseJson(resp.bodyText)
        if (!payload || !payload.result || payload.result.error) continue

        var quota = normalizeQuota(payload.result)
        if (!quota) continue

        var nextRefill = null
        if (payload.result.nextRefillMillis) {
          var refillMs = toNumber(payload.result.nextRefillMillis)
          if (refillMs !== null && refillMs > 0) {
            nextRefill = { next: new Date(refillMs).toISOString() }
          }
        }

        states.push({
          path: "rpc://127.0.0.1:" + String(port) + " (" + fileName + ")",
          quota: quota,
          nextRefill: nextRefill,
          tier: 1,
        })
      } catch (e) {
        ctx.host.log.debug("IDE RPC probe skipped for " + instancePath + ": " + String(e))
      }
    }

    return states
  }

  function coerceEpochMs(ctx, value) {
    var n = toNumber(value)
    if (n !== null) {
      if (n <= 0) return null
      return n < 1000000000000 ? n * 1000 : n
    }
    if (typeof value === "string" && value.trim()) {
      return ctx.util.parseDateMs(value.trim())
    }
    return null
  }

  function readObservedAtMs(ctx, value) {
    if (!value || typeof value !== "object") return null
    var keys = ["timestampMs", "timestamp", "timeMs", "createdAt", "updatedAt"]
    for (var i = 0; i < keys.length; i += 1) {
      var ms = coerceEpochMs(ctx, value[keys[i]])
      if (ms !== null) return ms
    }
    return null
  }

  function eventObservedAtMs(ctx, parsed) {
    var direct = readObservedAtMs(ctx, parsed)
    if (direct !== null) return direct
    if (!parsed || typeof parsed !== "object") return null
    var fromEvent = readObservedAtMs(ctx, parsed.event)
    if (fromEvent !== null) return fromEvent
    return readObservedAtMs(ctx, parsed.completion)
  }

  function sessionIdObservedAtMs(sessionId) {
    if (typeof sessionId !== "string") return null
    var match = sessionId.match(/^session-(\d{2})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-|$)/)
    if (!match) return null
    var ms = Date.parse(
      "20" +
        match[1] +
        "-" +
        match[2] +
        "-" +
        match[3] +
        "T" +
        match[4] +
        ":" +
        match[5] +
        ":" +
        match[6] +
        "Z"
    )
    return Number.isFinite(ms) ? ms : null
  }

  function readJunieSessionIndexTimes(ctx) {
    var times = Object.create(null)
    var indexPath = JUNIE_SESSIONS_DIR + "/index.jsonl"
    if (!ctx.host.fs.exists(indexPath)) return times
    try {
      var text = ctx.host.fs.readText(indexPath)
      if (!text) return times
      var lines = text.split(/\r?\n/)
      for (var i = 0; i < lines.length; i += 1) {
        var line = lines[i].trim()
        if (!line) continue
        var row = ctx.util.tryParseJson(line)
        if (!row || typeof row.sessionId !== "string") continue
        var at = coerceEpochMs(ctx, row.updatedAt)
        if (at === null) at = coerceEpochMs(ctx, row.createdAt)
        if (at !== null) times[row.sessionId] = at
      }
    } catch (e) {
      ctx.host.log.debug("failed reading junie session index: " + String(e))
    }
    return times
  }

  function logLineObservedAtMs(line) {
    if (typeof line !== "string") return null
    var match = line.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:,(\d{1,3}))?/)
    if (!match) return null
    var frac = match[3] || "000"
    if (frac.length > 3) frac = frac.slice(0, 3)
    while (frac.length < 3) frac = frac + "0"
    // idea.log stamps are local wall time (ZoneId.systemDefault) and carry no offset.
    // Date.parse treats a date-time without Z as local. Appending Z would read that
    // wall clock as UTC and mis-rank it against real Unix session timestamps.
    var ms = Date.parse(match[1] + "T" + match[2] + "." + frac)
    return Number.isFinite(ms) ? ms : null
  }

  // Tier 3: Junie CLI Session Logs (~/.junie/sessions/*/events.jsonl)
  // Each session keeps the observation time of its newest quota event so a
  // leftover folder cannot outrank a later idea.log or XML snapshot.
  function probeJunieSessions(ctx) {
    var sessionDirs = safeListDir(ctx, JUNIE_SESSIONS_DIR)
    var indexTimes = readJunieSessionIndexTimes(ctx)
    var states = []

    for (var i = 0; i < sessionDirs.length; i += 1) {
      var sessionId = sessionDirs[i]
      var eventsPath = JUNIE_SESSIONS_DIR + "/" + sessionId + "/events.jsonl"
      if (!ctx.host.fs.exists(eventsPath)) continue
      try {
        var text = ctx.host.fs.readText(eventsPath)
        if (!text) continue
        var lines = text.split(/\r?\n/)
        for (var l = lines.length - 1; l >= 0; l -= 1) {
          var line = lines[l].trim()
          if (!line || line.indexOf("quota") === -1) continue
          var parsed = ctx.util.tryParseJson(line)
          if (!parsed || typeof parsed !== "object") continue
          var candidate =
            (parsed.completion && parsed.completion.quota) ||
            parsed.quotaInfo ||
            parsed.quota ||
            null
          if (!candidate) continue
          var quota = normalizeQuota(candidate)
          if (quota) {
            var observedAt = eventObservedAtMs(ctx, parsed)
            if (observedAt === null && typeof indexTimes[sessionId] === "number") {
              observedAt = indexTimes[sessionId]
            }
            if (observedAt === null) observedAt = sessionIdObservedAtMs(sessionId)
            states.push({
              path: eventsPath,
              quota: quota,
              nextRefill: candidate.nextRefill || null,
              tier: 3,
              observedAtMs: observedAt,
            })
            break
          }
        }
      } catch (e) {
        ctx.host.log.debug("failed reading junie session " + eventsPath + ": " + String(e))
      }
    }

    return states
  }

  // Tier 4: IDE Application Logs (idea.log -> QuotaManager2Impl)
  function extractLastLogQuotaState(ctx, logPath) {
    try {
      var text = ctx.host.fs.readText(logPath)
      if (!text || text.indexOf("QuotaManager2") === -1) return null
      var lines = text.split(/\r?\n/)
      var latestQuota = null
      var latestRefill = null
      var latestObservedAt = null

      for (var i = lines.length - 1; i >= 0; i -= 1) {
        var line = lines[i]
        if (!latestQuota && line.indexOf("New quota info") !== -1) {
          var braceIdx = line.indexOf("{")
          if (braceIdx !== -1) {
            var jsonCandidate = line.slice(braceIdx).trim()
            var parsed = ctx.util.tryParseJson(jsonCandidate)
            if (parsed) {
              latestQuota = normalizeQuota(parsed)
              if (latestQuota) latestObservedAt = logLineObservedAtMs(line)
            }
          }
        }
        if (!latestRefill && line.indexOf("New next refill") !== -1) {
          var refillBraceIdx = line.indexOf("{")
          if (refillBraceIdx !== -1) {
            latestRefill = ctx.util.tryParseJson(line.slice(refillBraceIdx).trim())
          }
        }
        if (latestQuota && latestRefill) break
      }

      if (!latestQuota) return null
      return {
        path: logPath,
        quota: latestQuota,
        nextRefill: latestRefill,
        tier: 4,
        observedAtMs: latestObservedAt,
      }
    } catch (e) {
      ctx.host.log.debug("failed reading idea.log " + logPath + ": " + String(e))
      return null
    }
  }

  function probeIdeaLogs(ctx) {
    var logPaths = buildIdeaLogPaths(ctx)
    var states = []
    for (var i = 0; i < logPaths.length; i += 1) {
      var state = extractLastLogQuotaState(ctx, logPaths[i])
      if (state) states.push(state)
    }
    return states
  }

  // Tier 2: Junie Cloud API (~/.junie/secure_credentials.json or OS keychain -> Ingrazzio /auth/test)
  function computeJuniePathKey(ctx) {
    if (
      !ctx.host.crypto ||
      typeof ctx.host.crypto.sha256Hex !== "function" ||
      !ctx.host.fs ||
      typeof ctx.host.fs.homeDir !== "string" ||
      !ctx.host.fs.homeDir
    ) {
      return null
    }
    var home = ctx.host.fs.homeDir.replace(/[\\/]+$/, "")
    var sep = ctx.app.platform === "windows" ? "\\" : "/"
    var junieHome = (home + sep + ".junie").toLowerCase()
    return ctx.host.crypto.sha256Hex(junieHome)
  }

  function readJunieStoredAccount(ctx) {
    // 1. Check ~/.junie/secure_credentials.json fallback store
    if (ctx.host.fs.exists(JUNIE_SECURE_CREDENTIALS_FILE)) {
      try {
        var raw = ctx.host.fs.readText(JUNIE_SECURE_CREDENTIALS_FILE)
        var store = ctx.util.tryParseJson(raw)
        if (store && Array.isArray(store.secrets)) {
          for (var i = 0; i < store.secrets.length; i += 1) {
            var entry = store.secrets[i]
            if (entry && entry.key === JUNIE_ACCOUNT_KEY && typeof entry.secret === "string") {
              var parsed = ctx.util.tryParseJson(entry.secret)
              if (parsed) return parsed
            }
          }
        }
      } catch (e) {
        ctx.host.log.debug("failed reading junie secure_credentials.json: " + String(e))
      }
    }

    // 2. Check OS Keychain / Secret Service (service: "junie-cli", account: "<sha256(junieHome)>jb-account-stored")
    if (ctx.host.keychain && typeof ctx.host.keychain.readGenericPassword === "function") {
      var pathKey = computeJuniePathKey(ctx)
      var accountsToTry = []
      if (pathKey) accountsToTry.push(pathKey + JUNIE_ACCOUNT_KEY)
      accountsToTry.push(JUNIE_ACCOUNT_KEY)

      for (var a = 0; a < accountsToTry.length; a += 1) {
        try {
          var secret = ctx.host.keychain.readGenericPassword(JUNIE_KEYCHAIN_SERVICE, accountsToTry[a])
          var parsedSecret = ctx.util.tryParseJson(secret)
          if (parsedSecret) return parsedSecret
        } catch (e) {
          // Ignore keychain miss
        }
      }
    }

    return null
  }

  function probeNowMs(ctx) {
    var parsed = ctx.nowIso ? ctx.util.parseDateMs(ctx.nowIso) : null
    if (parsed !== null) return parsed
    return Date.now()
  }

  function jwtExpiryMs(ctx, token) {
    if (!token || !ctx.jwt || typeof ctx.jwt.decodePayload !== "function") return null
    var payload = ctx.jwt.decodePayload(token)
    if (!payload || typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) return null
    return payload.exp * 1000
  }

  function isStoredTokenUsable(ctx, token) {
    var expMs = jwtExpiryMs(ctx, token)
    if (expMs === null) return true
    if (!ctx.util || typeof ctx.util.needsRefreshByExpiry !== "function") {
      return expMs > probeNowMs(ctx) + TOKEN_REFRESH_SKEW_MS
    }
    return !ctx.util.needsRefreshByExpiry({
      nowMs: probeNowMs(ctx),
      expiresAtMs: expMs,
      bufferMs: TOKEN_REFRESH_SKEW_MS,
    })
  }

  function readRefreshToken(stored) {
    if (!stored || typeof stored !== "object") return null
    var jb = stored.jbAccount
    if (!jb || typeof jb !== "object") return null
    if (typeof jb.refresh_token !== "string") return null
    var token = jb.refresh_token.trim()
    return token ? token : null
  }

  function refreshJetBrainsAccessToken(ctx, refreshToken) {
    if (
      !refreshToken ||
      !ctx.host.http ||
      typeof ctx.host.http.request !== "function"
    ) {
      return null
    }
    try {
      var resp = ctx.host.http.request({
        method: "POST",
        url: JBA_OAUTH_TOKEN_URL,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        bodyText:
          "client_id=junie-cli&grant_type=refresh_token&refresh_token=" +
          encodeURIComponent(refreshToken),
        timeoutMs: 4000,
      })
      if (resp && resp.status >= 200 && resp.status < 300 && resp.bodyText) {
        var tokenData = ctx.util.tryParseJson(resp.bodyText)
        if (tokenData) {
          if (typeof tokenData.id_token === "string" && tokenData.id_token.trim()) {
            return tokenData.id_token.trim()
          }
          if (typeof tokenData.access_token === "string" && tokenData.access_token.trim()) {
            return tokenData.access_token.trim()
          }
        }
      }
    } catch (e) {
      ctx.host.log.debug("junie token refresh failed: " + String(e))
    }
    return null
  }

  // Returns a stored bearer that is still inside its exp window. An expired
  // JWT is not returned, so the caller can run the refresh_token grant.
  function extractJwtTokenFromStoredAccount(ctx, stored) {
    if (!stored || typeof stored !== "object") return null
    var candidates = []
    if (typeof stored.simpleToken === "string" && stored.simpleToken.trim()) {
      candidates.push(stored.simpleToken.trim())
    }
    var jb = stored.jbAccount
    if (jb && typeof jb === "object") {
      if (typeof jb.id_token === "string" && jb.id_token.trim()) {
        candidates.push(jb.id_token.trim())
      }
      if (typeof jb.access_token === "string" && jb.access_token.trim()) {
        candidates.push(jb.access_token.trim())
      }
    }
    for (var i = 0; i < candidates.length; i += 1) {
      if (isStoredTokenUsable(ctx, candidates[i])) return candidates[i]
    }
    return null
  }

  function requestJunieAuthTest(ctx, token) {
    return ctx.host.http.request({
      method: "GET",
      url: INGRAZZIO_AUTH_TEST_URL,
      headers: {
        Authorization: "Bearer " + token,
        "X-Accept-EAP-License": "true",
        "X-Accept-Release-License": "true",
      },
      timeoutMs: 4000,
    })
  }

  function resolveCloudMaximum(licenseType, balanceLeft, fallbackMaximum) {
    if (fallbackMaximum !== null && fallbackMaximum >= balanceLeft) return fallbackMaximum
    var included = null
    if (licenseType === "AIPU") included = AI_ULTIMATE_CREDITS * CREDIT_UNIT_SCALE
    else if (licenseType === "AIP") included = AI_PRO_CREDITS * CREDIT_UNIT_SCALE
    // Top-ups leave balanceLeft above the tariff. Expand the cap to the live
    // balance instead of clamping remaining down to the included amount.
    if (included !== null) return balanceLeft > included ? balanceLeft : included
    var floor = UNKNOWN_PLAN_CREDIT_FLOOR * CREDIT_UNIT_SCALE
    return balanceLeft > floor ? balanceLeft : floor
  }

  function probeJunieCloudBalance(ctx, fallbackQuotaState) {
    if (!ctx.host.http || typeof ctx.host.http.request !== "function") return null
    var stored = readJunieStoredAccount(ctx)
    var token = extractJwtTokenFromStoredAccount(ctx, stored)
    var refreshedAlready = false
    if (!token) {
      token = refreshJetBrainsAccessToken(ctx, readRefreshToken(stored))
      refreshedAlready = true
    }
    if (!token) return null

    try {
      var resp = requestJunieAuthTest(ctx, token)
      if (resp && resp.status === 401 && !refreshedAlready) {
        var refreshed = refreshJetBrainsAccessToken(ctx, readRefreshToken(stored))
        if (refreshed && refreshed !== token) {
          resp = requestJunieAuthTest(ctx, refreshed)
        }
      }
      if (!resp || resp.status < 200 || resp.status >= 300 || !resp.bodyText) return null
      var authInfo = ctx.util.tryParseJson(resp.bodyText)
      if (!authInfo || typeof authInfo !== "object") return null

      var balanceLeft = toNumber(authInfo.balanceLeft)
      if (balanceLeft === null) return null

      var fallbackMaximum =
        fallbackQuotaState && fallbackQuotaState.quota && fallbackQuotaState.quota.maximum > 0
          ? fallbackQuotaState.quota.maximum
          : null
      var maximum = resolveCloudMaximum(authInfo.licenseType, balanceLeft, fallbackMaximum)

      if (!maximum || maximum <= 0) return null

      var remaining = clamp(balanceLeft, 0, maximum)
      var used = clamp(maximum - remaining, 0, maximum)

      return {
        path: INGRAZZIO_AUTH_TEST_URL,
        quota: {
          used: used,
          maximum: maximum,
          remaining: remaining,
          until: fallbackQuotaState && fallbackQuotaState.quota ? fallbackQuotaState.quota.until : null,
          plan: resolvePlanLabel(null, authInfo.licenseType),
        },
        nextRefill: fallbackQuotaState ? fallbackQuotaState.nextRefill : null,
        tier: 2,
      }
    } catch (e) {
      ctx.host.log.debug("junie cloud balance probe failed: " + String(e))
      return null
    }
  }

  // Handles only simple single-component durations (PTnH, PnD, PnW).
  // JetBrains currently uses values like PT720H or P30D.
  function parseIsoDurationMs(value) {
    if (typeof value !== "string" || !value) return null

    var h = value.match(/^PT(\d+)H$/)
    if (h) return Number(h[1]) * 60 * 60 * 1000

    var d = value.match(/^P(\d+)D$/)
    if (d) return Number(d[1]) * 24 * 60 * 60 * 1000

    var w = value.match(/^P(\d+)W$/)
    if (w) return Number(w[1]) * 7 * 24 * 60 * 60 * 1000

    return null
  }

  function filterSessionStates(ctx, sessionStates, liveStates) {
    if (!liveStates || liveStates.length === 0) return sessionStates
    var newestLiveAt = null
    for (var i = 0; i < liveStates.length; i += 1) {
      var liveAt = liveStates[i].observedAtMs
      if (typeof liveAt === "number" && (newestLiveAt === null || liveAt > newestLiveAt)) {
        newestLiveAt = liveAt
      }
    }
    var nowMs = ctx.nowIso ? ctx.util.parseDateMs(ctx.nowIso) : null
    if (nowMs === null) nowMs = Date.now()
    var kept = []
    for (var s = 0; s < sessionStates.length; s += 1) {
      var session = sessionStates[s]
      var sessionAt = session.observedAtMs
      if (typeof sessionAt !== "number") continue
      if (newestLiveAt !== null) {
        if (sessionAt >= newestLiveAt) kept.push(session)
        continue
      }
      if (nowMs - sessionAt <= SESSION_UNDATED_LIVE_MAX_AGE_MS) kept.push(session)
    }
    return kept
  }

  function localSourceRank(tier) {
    var rank = tier || 5
    // Session logs share `until` with idea.log and XML. That timestamp is the
    // billing-window end, so a lower tier number must not win the tie.
    if (rank === 3) return 6
    return rank
  }

  function pickBestState(ctx, states) {
    var best = null
    var bestMs = -Infinity

    for (var i = 0; i < states.length; i += 1) {
      var state = states[i]
      var untilMs = null

      if (state.quota.until) {
        untilMs = ctx.util.parseDateMs(state.quota.until)
      }
      if (untilMs === null && state.nextRefill && state.nextRefill.next) {
        untilMs = ctx.util.parseDateMs(state.nextRefill.next)
      }
      if (untilMs === null) untilMs = -Infinity

      if (!best || untilMs > bestMs) {
        best = state
        bestMs = untilMs
        continue
      }

      if (untilMs === bestMs) {
        var stateAt = typeof state.observedAtMs === "number" ? state.observedAtMs : null
        var bestAt = typeof best.observedAtMs === "number" ? best.observedAtMs : null
        if (stateAt !== null && bestAt !== null && stateAt !== bestAt) {
          if (stateAt > bestAt) {
            best = state
            continue
          }
          continue
        }

        var stateRank = localSourceRank(state.tier)
        var bestRank = localSourceRank(best.tier)
        if (stateRank < bestRank) {
          best = state
          continue
        }
        if (stateRank > bestRank) {
          continue
        }

        var currentRatio =
          state.quota.maximum > 0 ? state.quota.used / state.quota.maximum : 0
        var bestRatio =
          best.quota.maximum > 0 ? best.quota.used / best.quota.maximum : 0
        if (currentRatio > bestRatio) {
          best = state
          continue
        }
        if (currentRatio === bestRatio && state.quota.used > best.quota.used) {
          best = state
          continue
        }
      }
    }

    return best
  }

  function formatDecimal(value, places) {
    if (!Number.isFinite(value)) return null
    var factor = Math.pow(10, places)
    var rounded = Math.round(value * factor) / factor
    return rounded.toFixed(places).replace(/\.?0+$/, "")
  }

  function detectDisplayScale(quota, nextRefill) {
    var maxAbs = Math.max(
      Math.abs(quota.maximum || 0),
      Math.abs(quota.used || 0),
      Math.abs(quota.remaining || 0)
    )

    if (nextRefill && nextRefill.tariff && typeof nextRefill.tariff === "object") {
      var tariffAmount = toNumber(nextRefill.tariff.amount)
      if (tariffAmount !== null) {
        maxAbs = Math.max(maxAbs, Math.abs(tariffAmount))
      }
    }

    if (maxAbs >= CREDIT_UNIT_SCALE) return CREDIT_UNIT_SCALE
    return 1
  }

  function probe(ctx) {
    // 1. Check live running JetBrains IDEs via Junie local JSON-RPC bridge first
    var rpcStates = probeLiveIdeRpc(ctx)

    // 2. Gather local XML, session, and idea.log states
    var paths = buildQuotaPaths(ctx)
    var xmlStates = []
    for (var i = 0; i < paths.length; i += 1) {
      var xmlState = readQuotaState(ctx, paths[i])
      if (xmlState) xmlStates.push(xmlState)
    }

    var sessionStates = probeJunieSessions(ctx)
    var logStates = probeIdeaLogs(ctx)
    var liveStates = logStates.concat(xmlStates)
    // Drop session snapshots that are older than the live IDE files. A shared
    // billing-window `until` would otherwise let a leftover events.jsonl win,
    // including as the maximum/until donor for the cloud balance.
    var sessionCandidates = filterSessionStates(ctx, sessionStates, liveStates)

    var localFallbackBest = pickBestState(ctx, sessionCandidates.concat(liveStates))

    var chosen = null
    if (rpcStates.length > 0) {
      chosen = pickBestState(ctx, rpcStates)
      // Preserve tariff duration metadata from XML if RPC response only has nextRefillMillis
      if (
        chosen &&
        localFallbackBest &&
        localFallbackBest.nextRefill &&
        localFallbackBest.nextRefill.tariff &&
        (!chosen.nextRefill || !chosen.nextRefill.tariff)
      ) {
        chosen.nextRefill = {
          next:
            (chosen.nextRefill && chosen.nextRefill.next) ||
            localFallbackBest.nextRefill.next ||
            null,
          tariff: localFallbackBest.nextRefill.tariff,
        }
      }
    } else {
      var cloudState = probeJunieCloudBalance(ctx, localFallbackBest)
      if (cloudState) {
        chosen = cloudState
      } else {
        chosen = localFallbackBest
      }
    }

    if (!chosen) {
      throw paths.length > 0
        ? "JetBrains AI Assistant quota data unavailable. Open AI Assistant once and try again."
        : "JetBrains AI Assistant not detected. Open a JetBrains IDE with AI Assistant enabled."
    }

    var quota = chosen.quota
    var scale = detectDisplayScale(quota, chosen.nextRefill)
    var usedPercent = (quota.used / quota.maximum) * 100
    if (!Number.isFinite(usedPercent)) usedPercent = 0
    usedPercent = clamp(usedPercent, 0, 100)
    var line = {
      label: "Quota",
      used: usedPercent,
      limit: 100,
      format: { kind: "percent" },
    }

    var resetSource = null
    if (chosen.nextRefill && chosen.nextRefill.next) {
      resetSource = chosen.nextRefill.next
    } else if (quota.until) {
      resetSource = quota.until
    }

    var resetsAt = ctx.util.toIso(resetSource)
    if (resetsAt) line.resetsAt = resetsAt

    var duration = null
    if (
      chosen.nextRefill &&
      chosen.nextRefill.tariff &&
      typeof chosen.nextRefill.tariff === "object"
    ) {
      duration = parseIsoDurationMs(chosen.nextRefill.tariff.duration)
    }
    if (duration) line.periodDurationMs = duration

    var lines = [ctx.line.progress(line)]

    lines.push(
      ctx.line.text({
        label: "Used",
        value:
          scale > 1
            ? formatDecimal(quota.used / scale, 2) + " / " + formatDecimal(quota.maximum / scale, 2) + " credits"
            : String(quota.used),
      })
    )

    if (quota.remaining !== null) {
      lines.push(
        ctx.line.text({
          label: "Remaining",
          value: scale > 1 ? formatDecimal(quota.remaining / scale, 2) + " credits" : String(quota.remaining),
        })
      )
    }

    ctx.host.log.info("quota loaded from " + chosen.path)

    var result = { lines: lines }
    if (quota.plan) result.plan = quota.plan
    return result
  }

  globalThis.__openusage_plugin = { id: "jetbrains-ai-assistant", probe: probe }
})()
