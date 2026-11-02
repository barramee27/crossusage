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

  // Tier 3: Junie CLI Session Logs (~/.junie/sessions/*/events.jsonl)
  function probeJunieSessions(ctx) {
    var sessionDirs = safeListDir(ctx, JUNIE_SESSIONS_DIR)
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
            states.push({
              path: eventsPath,
              quota: quota,
              nextRefill: candidate.nextRefill || null,
              tier: 3,
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

      for (var i = lines.length - 1; i >= 0; i -= 1) {
        var line = lines[i]
        if (!latestQuota && line.indexOf("New quota info") !== -1) {
          var braceIdx = line.indexOf("{")
          if (braceIdx !== -1) {
            var jsonCandidate = line.slice(braceIdx).trim()
            var parsed = ctx.util.tryParseJson(jsonCandidate)
            if (parsed) {
              latestQuota = normalizeQuota(parsed)
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

  function extractJwtTokenFromStoredAccount(ctx, stored) {
    if (!stored || typeof stored !== "object") return null
    if (typeof stored.simpleToken === "string" && stored.simpleToken.trim()) {
      return stored.simpleToken.trim()
    }
    var jb = stored.jbAccount
    if (jb && typeof jb === "object") {
      if (typeof jb.id_token === "string" && jb.id_token.trim()) {
        return jb.id_token.trim()
      }
      if (typeof jb.access_token === "string" && jb.access_token.trim()) {
        return jb.access_token.trim()
      }
      if (
        typeof jb.refresh_token === "string" &&
        jb.refresh_token.trim() &&
        ctx.host.http &&
        typeof ctx.host.http.request === "function"
      ) {
        try {
          var resp = ctx.host.http.request({
            method: "POST",
            url: JBA_OAUTH_TOKEN_URL,
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            bodyText:
              "client_id=junie-cli&grant_type=refresh_token&refresh_token=" +
              encodeURIComponent(jb.refresh_token.trim()),
            timeoutMs: 4000,
          })
          if (resp && resp.status >= 200 && resp.status < 300 && resp.bodyText) {
            var tokenData = ctx.util.tryParseJson(resp.bodyText)
            if (tokenData) {
              return tokenData.id_token || tokenData.access_token || null
            }
          }
        } catch (e) {
          ctx.host.log.debug("junie token refresh failed: " + String(e))
        }
      }
    }
    return null
  }

  function probeJunieCloudBalance(ctx, fallbackQuotaState) {
    if (!ctx.host.http || typeof ctx.host.http.request !== "function") return null
    var stored = readJunieStoredAccount(ctx)
    var token = extractJwtTokenFromStoredAccount(ctx, stored)
    if (!token) return null

    try {
      var resp = ctx.host.http.request({
        method: "GET",
        url: INGRAZZIO_AUTH_TEST_URL,
        headers: {
          Authorization: "Bearer " + token,
          "X-Accept-EAP-License": "true",
          "X-Accept-Release-License": "true",
        },
        timeoutMs: 4000,
      })
      if (!resp || resp.status < 200 || resp.status >= 300 || !resp.bodyText) return null
      var authInfo = ctx.util.tryParseJson(resp.bodyText)
      if (!authInfo || typeof authInfo !== "object") return null

      var balanceLeft = toNumber(authInfo.balanceLeft)
      if (balanceLeft === null) return null

      // Combine live balanceLeft with known maximum from fallback state if available
      var maximum =
        fallbackQuotaState && fallbackQuotaState.quota && fallbackQuotaState.quota.maximum > 0
          ? fallbackQuotaState.quota.maximum
          : null

      // Standard JetBrains tariff maxima when only balanceLeft is returned
      if (maximum === null || maximum < balanceLeft) {
        if (authInfo.licenseType === "AIPU") {
          maximum = 35 * CREDIT_UNIT_SCALE
        } else if (authInfo.licenseType === "AIP") {
          maximum = 10 * CREDIT_UNIT_SCALE
        } else if (balanceLeft > 0) {
          maximum = Math.max(balanceLeft, 10 * CREDIT_UNIT_SCALE)
        }
      }

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
        var stateTier = state.tier || 5
        var bestTier = best.tier || 5
        if (stateTier < bestTier) {
          best = state
          continue
        }
        if (stateTier > bestTier) {
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

    var localFallbackBest = pickBestState(
      ctx,
      sessionStates.concat(logStates).concat(xmlStates)
    )

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
