(function () {
  const LOCAL_USER_ENDPOINT = "https://www.perplexity.ai/api/user"
  const REST_API_BASE = "https://www.perplexity.ai/rest/pplx-api/v2"
  const REST_GROUPS_ENDPOINT = REST_API_BASE + "/groups"
  const RATE_LIMIT_ENDPOINT = "https://www.perplexity.ai/rest/rate-limit/all"

  const LOCAL_CACHE_DB_PATHS = [
    "~/Library/Containers/ai.perplexity.mac/Data/Library/Caches/ai.perplexity.mac/Cache.db",
    "~/Library/Caches/ai.perplexity.mac/Cache.db",
    "~/.config/Perplexity/Cache/Cache.db",
    "~/.config/Perplexity/GPUCache/Cache.db",
    "~/.cache/Perplexity/Cache.db",
    "~/.var/app/ai.perplexity.mac/cache/ai.perplexity.mac/Cache.db",
    "~/AppData/Local/Perplexity/Cache/Cache.db",
    "~/AppData/Roaming/Perplexity/Cache/Cache.db",
  ]

  // Only need request_object; receiver body is optional and can be malformed.
  const LOCAL_SESSION_SQL =
    "SELECT hex(b.request_object) AS requestHex " +
    "FROM cfurl_cache_response r " +
    "JOIN cfurl_cache_blob_data b ON b.entry_ID = r.entry_ID " +
    "WHERE r.request_key = '" + LOCAL_USER_ENDPOINT + "' " +
    "ORDER BY r.entry_ID DESC LIMIT 1;"

  const BEARER_HEX_PREFIX = "42656172657220" // "Bearer "
  const ASK_UA_HEX_PREFIX = "41736B2F" // Ask/
  const MACOS_DEVICE_ID_HEX_PREFIX = "6D61636F733A" // macos:
  const MAX_REQUEST_FIELD_LENGTH = 220
  const RATE_LIMIT_CATEGORIES = [
    { key: "remaining_pro", label: "Queries" },
    { key: "remaining_research", label: "Deep Research" },
    { key: "remaining_labs", label: "Labs" },
    { key: "remaining_agentic_research", label: "Agentic Research" },
  ]

  function readNumberField(obj, keys) {
    if (!obj || typeof obj !== "object") return null
    for (let i = 0; i < keys.length; i += 1) {
      const n = Number(obj[keys[i]])
      if (Number.isFinite(n)) return n
    }
    return null
  }

  function parseMoneyNumber(value) {
    if (value === null || value === undefined) return null
    if (typeof value === "number") return Number.isFinite(value) ? value : null
    if (typeof value !== "string") return null
    const trimmed = value.trim()
    if (!trimmed) return null
    const cleaned = trimmed.replace(/[$,]/g, "")
    const n = Number(cleaned)
    return Number.isFinite(n) ? n : null
  }

  function readMoneyLike(value) {
    const direct = parseMoneyNumber(value)
    if (direct !== null) return direct
    if (!value || typeof value !== "object") return null

    const cents = readNumberField(value, ["cents", "amount_cents", "amountCents", "value_cents", "valueCents"])
    if (cents !== null) {
      const dollars = cents / 100
      return Number.isFinite(dollars) ? dollars : null
    }

    return (
      readNumberField(value, ["usd", "amount_usd", "amountUsd", "value_usd", "valueUsd"]) ??
      readNumberField(value, ["amount", "value", "balance", "remaining", "available"])
    )
  }

  function isAllowedAuthByte(byte) {
    return (
      (byte >= 0x30 && byte <= 0x39) ||
      (byte >= 0x41 && byte <= 0x5a) ||
      (byte >= 0x61 && byte <= 0x7a) ||
      byte === 0x2e ||
      byte === 0x2d ||
      byte === 0x5f
    )
  }

  function extractAuthToken(requestHex) {
    if (typeof requestHex !== "string") return null
    const upper = requestHex.trim().toUpperCase()
    if (!upper) return null
    const idx = upper.indexOf(BEARER_HEX_PREFIX)
    if (idx === -1) return null
    const start = idx + BEARER_HEX_PREFIX.length
    let token = ""
    for (let i = start; i + 1 < upper.length; i += 2) {
      const byte = parseInt(upper.slice(i, i + 2), 16)
      if (!Number.isFinite(byte)) break
      if (!isAllowedAuthByte(byte)) break
      if (byte === 0x5f) {
        // Stop before bplist marker bytes; avoids capturing '_' that precedes plist int markers.
        const next = i + 3 < upper.length ? parseInt(upper.slice(i + 2, i + 4), 16) : NaN
        if (next === 0x10 || next === 0x11 || next === 0x12 || next === 0x13 || next === 0x14) break
      }
      token += String.fromCharCode(byte)
    }
    const dots = (token.match(/\./g) || []).length
    return dots >= 2 ? token : null
  }

  function isPrintableAscii(byte) {
    return byte >= 0x20 && byte <= 0x7e
  }

  function extractPrintableField(requestHex, prefixHex) {
    if (typeof requestHex !== "string") return null
    const upper = requestHex.trim().toUpperCase()
    if (!upper) return null
    const idx = upper.indexOf(prefixHex)
    if (idx === -1) return null
    let out = ""
    for (let i = idx; i + 1 < upper.length && out.length < MAX_REQUEST_FIELD_LENGTH; i += 2) {
      const byte = parseInt(upper.slice(i, i + 2), 16)
      if (!Number.isFinite(byte) || !isPrintableAscii(byte)) break
      out += String.fromCharCode(byte)
    }
    return out ? out : null
  }

  function askAppVersionFromUserAgent(userAgent) {
    if (typeof userAgent !== "string") return null
    const m = /^Ask\/([^/]+)/.exec(userAgent.trim())
    return m && m[1] ? m[1] : null
  }

  function makeRestHeaderOverrides(session) {
    const headers = {
      Accept: "*/*",
      "User-Agent": (session && session.userAgent) || "Ask/0 (macOS) isiOSOnMac/false",
      "X-Client-Name": "Perplexity-Mac",
      "X-App-ApiVersion": "2.17",
      "X-App-ApiClient": "macos",
      "X-Client-Env": "production",
    }
    if (session && session.appVersion) headers["X-App-Version"] = session.appVersion
    if (session && session.deviceId) headers["X-Device-ID"] = session.deviceId
    return headers
  }

  function fetchJsonOptional(ctx, url, authToken, extraHeaders) {
    if (!authToken) return null
    let resp
    try {
      const headers = {
        Authorization: "Bearer " + authToken,
        Accept: "application/json",
        "User-Agent": "OpenUsage",
      }
      if (extraHeaders && typeof extraHeaders === "object") for (const k in extraHeaders) headers[k] = extraHeaders[k]
      resp = ctx.util.request({ method: "GET", url: url, headers: headers, timeoutMs: 10000 })
    } catch (e) {
      ctx.host.log.warn("request failed (" + url + "): " + String(e))
      return null
    }
    if (ctx.util.isAuthStatus(resp.status)) {
      if (resp.status === 403 && typeof resp.bodyText === "string" && resp.bodyText.indexOf("Just a moment") !== -1) {
        ctx.host.log.warn("cloudflare challenge (try opening perplexity.ai in a browser once)")
      }
      ctx.host.log.warn("request unauthorized (" + url + "): status=" + String(resp.status))
      return null
    }
    if (resp.status < 200 || resp.status >= 300) {
      ctx.host.log.warn("request returned status " + String(resp.status) + " (" + url + ")")
      return null
    }
    const parsed = ctx.util.tryParseJson(resp.bodyText)
    if (!parsed || typeof parsed !== "object") {
      ctx.host.log.warn("request returned invalid JSON (" + url + ")")
      return null
    }
    return parsed
  }

  function readGroupId(value) {
    if (value === null || value === undefined) return null
    if (typeof value === "string") {
      const trimmed = value.trim()
      return trimmed ? trimmed : null
    }
    const n = Number(value)
    if (Number.isFinite(n)) return String(Math.floor(n))
    return null
  }

  function pickGroupId(groupsJson) {
    const tryFromObj = (obj) => {
      if (!obj || typeof obj !== "object") return null
      return (
        readGroupId(obj.api_org_id) ||
        readGroupId(obj.apiOrgId) ||
        readGroupId(obj.org_id) ||
        readGroupId(obj.orgId) ||
        readGroupId(obj.id) ||
        readGroupId(obj.group_id) ||
        readGroupId(obj.groupId)
      )
    }

    const tryFromArray = (arr) => {
      if (!Array.isArray(arr)) return null
      let first = null
      for (let i = 0; i < arr.length; i += 1) {
        const item = arr[i]
        const id = tryFromObj(item)
        if (!id) continue
        if (!first) first = id
        if (item && (item.is_default_org === true || item.isDefaultOrg === true)) return id
      }
      return first
    }

    if (Array.isArray(groupsJson)) return tryFromArray(groupsJson)
    if (!groupsJson || typeof groupsJson !== "object") return null

    const direct = tryFromObj(groupsJson)
    if (direct) return direct

    const keys = ["orgs", "groups", "results", "items", "data"]
    for (let i = 0; i < keys.length; i += 1) {
      const id = tryFromArray(groupsJson[keys[i]])
      if (id) return id
    }
    return null
  }

  function readBalanceUsd(group) {
    const wrappers = ["apiOrganization", "api_organization", "group", "org", "organization", "data", "result", "item"]
    const keys = ["balance_usd", "balanceUsd", "balance", "pending_balance", "pendingBalance"]

    const tryNode = (node) => {
      if (!node) return null
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i += 1) {
          const n = tryNode(node[i])
          if (n !== null) return n
        }
        return null
      }
      if (typeof node !== "object") return null

      for (let i = 0; i < wrappers.length; i += 1) {
        const n = tryNode(node[wrappers[i]])
        if (n !== null) return n
      }

      let n = readNumberField(node, keys)
      if (n !== null) return n

      for (let i = 0; i < keys.length; i += 1) {
        n = readMoneyLike(node[keys[i]])
        if (n !== null) return n
      }

      const nested = [node.customerInfo, node.wallet, node.billing, node.usage, node.account, node.balances]
      for (let i = 0; i < nested.length; i += 1) {
        n = tryNode(nested[i])
        if (n !== null) return n
      }

      for (const k in node) if (/(balance|credit|wallet|prepaid|available)/i.test(k)) {
        n = readMoneyLike(node[k])
        if (n !== null) return n
      }
      return null
    }

    return tryNode(group)
  }

  function sumUsageCostUsd(usageAnalytics) {
    if (!Array.isArray(usageAnalytics)) return null
    let costSum = 0
    let hasCost = false
    let hasValidMeter = usageAnalytics.length === 0
    for (let i = 0; i < usageAnalytics.length; i += 1) {
      const meter = usageAnalytics[i]
      if (!meter || typeof meter !== "object") continue
      const summaries = meter.meter_event_summaries || meter.meterEventSummaries
      if (!Array.isArray(summaries)) continue
      if (summaries.length === 0) hasValidMeter = true
      for (let j = 0; j < summaries.length; j += 1) {
        const s = summaries[j]
        if (!s || typeof s !== "object") continue
        const c = Number(s.cost)
        if (Number.isFinite(c)) {
          costSum += c
          hasCost = true
        }
      }
    }
    return (hasCost || hasValidMeter) ? costSum : null
  }

  function detectPlanLabel(customerInfo, user) {
    if (customerInfo && typeof customerInfo === "object") {
      if (customerInfo.is_max === true || customerInfo.subscription_tier === "max") return "Max"
      if (customerInfo.is_pro === true) return "Pro"
    }
    if (user && typeof user === "object") {
      const tier = user.subscription_tier
      if (tier === "max") return "Max"
      if (tier === "pro") return "Pro"
    }
    return null
  }

  function buildRateLimitLines(ctx, rateLimits) {
    if (!rateLimits || typeof rateLimits !== "object") return []
    const lines = []
    for (let i = 0; i < RATE_LIMIT_CATEGORIES.length; i += 1) {
      const category = RATE_LIMIT_CATEGORIES[i]
      const val = rateLimits[category.key]
      if (val === undefined || val === null) continue
      const n = Number(val)
      if (!Number.isFinite(n)) continue
      lines.push(ctx.line.text({
        label: category.label,
        value: String(Math.max(0, Math.floor(n))) + " remaining",
      }))
    }
    return lines
  }

  function queryLocalSessionFromCache(ctx, dbPath) {
    let rows
    try {
      const json = ctx.host.sqlite.query(dbPath, LOCAL_SESSION_SQL)
      rows = ctx.util.tryParseJson(json)
    } catch (e) {
      ctx.host.log.warn("local sqlite read failed (" + dbPath + "): " + String(e))
      return null
    }
    if (!Array.isArray(rows) || rows.length === 0) return null

    const row = rows[0] || {}
    const requestHex = typeof row.requestHex === "string" ? row.requestHex : null
    if (!requestHex) return null

    const authToken = extractAuthToken(requestHex)
    if (!authToken) return null

    const userAgent = extractPrintableField(requestHex, ASK_UA_HEX_PREFIX)
    const appVersion = askAppVersionFromUserAgent(userAgent)
    const deviceId = extractPrintableField(requestHex, MACOS_DEVICE_ID_HEX_PREFIX)

    return { authToken: authToken, userAgent: userAgent, appVersion: appVersion, deviceId: deviceId, sourcePath: dbPath }
  }

  function loadLocalSession(ctx) {
    const credential = ctx.util.readProviderCredential && ctx.util.readProviderCredential()
    if (credential && credential.accessToken) {
      ctx.host.log.info("session loaded from provider account")
      return {
        authToken: credential.accessToken,
        userAgent: "OpenUsage",
        appVersion: null,
        deviceId: null,
        sourcePath: "provider-account",
      }
    }
    for (let i = 0; i < LOCAL_CACHE_DB_PATHS.length; i += 1) {
      const dbPath = LOCAL_CACHE_DB_PATHS[i]
      try {
        if (!ctx.host.fs.exists(dbPath)) continue
      } catch (e) {
        ctx.host.log.warn("local cache exists check failed (" + dbPath + "): " + String(e))
        continue
      }
      const found = queryLocalSessionFromCache(ctx, dbPath)
      if (found) return found
    }
    return null
  }

  function fetchRestState(ctx, session) {
    const authToken = session && session.authToken
    if (!authToken) return null
    const restHeaders = makeRestHeaderOverrides(session)
    const user =
      fetchJsonOptional(ctx, LOCAL_USER_ENDPOINT, authToken, restHeaders) ||
      fetchJsonOptional(ctx, LOCAL_USER_ENDPOINT + "/", authToken, restHeaders)
    const groups =
      fetchJsonOptional(ctx, REST_GROUPS_ENDPOINT, authToken, restHeaders) ||
      fetchJsonOptional(ctx, REST_GROUPS_ENDPOINT + "/", authToken, restHeaders)
    const groupId = pickGroupId(groups)
    let group = null
    let usageAnalytics = null
    if (groupId) {
      const base = REST_API_BASE + "/groups/" + encodeURIComponent(groupId)
      group =
        fetchJsonOptional(ctx, base, authToken, restHeaders) ||
        fetchJsonOptional(ctx, base + "/", authToken, restHeaders)
      const usageUrl = base + "/usage-analytics"
      usageAnalytics =
        fetchJsonOptional(ctx, usageUrl, authToken, restHeaders) ||
        fetchJsonOptional(ctx, usageUrl + "/", authToken, restHeaders)
    }
    const rateLimits = fetchJsonOptional(ctx, RATE_LIMIT_ENDPOINT, authToken, restHeaders)
    return { user: user, groupId: groupId, group: group, usageAnalytics: usageAnalytics, rateLimits: rateLimits }
  }

  // --- Web-session (cookie) auth -------------------------------------------
  // The Bearer flow above only exists on macOS: it scrapes the CFURL cache of
  // the native app. On Windows/Linux there is no Bearer token anywhere — the
  // Electron app and the website both authenticate with next-auth cookies.
  // So accept a pasted session cookie and talk to the same REST API the web
  // client uses.
  const WEB_ORIGIN = "https://www.perplexity.ai"
  const WEB_QS = "?version=2.18&source=default"
  const WEB_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
  const SESSION_COOKIE_NAME = "__Secure-next-auth.session-token"

  const WEB_MODE_CATEGORIES = [
    { key: "pro_search", label: "Queries" },
    { key: "research", label: "Deep Research" },
    { key: "labs", label: "Labs" },
    { key: "agentic_research", label: "Agentic Research" },
  ]

  function looksLikeCookieCredential(value) {
    if (typeof value !== "string") return false
    const s = value.trim()
    if (!s) return false
    if (s.indexOf("=") !== -1) return true // full "name=value; name=value" string
    // next-auth cookies are JWE (5 segments, 2nd one empty) — a Bearer JWT has 3.
    return s.slice(0, 3) === "eyJ" && (s.match(/\./g) || []).length >= 3
  }

  function buildCookieHeader(value) {
    const s = String(value).trim().replace(/^Cookie:\s*/i, "")
    if (s.indexOf("=") !== -1) return s
    return SESSION_COOKIE_NAME + "=" + s
  }

  function fetchWebJson(ctx, cookieHeader, path) {
    let resp
    try {
      resp = ctx.util.request({
        method: "GET",
        url: WEB_ORIGIN + path + WEB_QS,
        headers: {
          Cookie: cookieHeader,
          Accept: "application/json",
          "User-Agent": WEB_UA,
          Origin: WEB_ORIGIN,
          Referer: WEB_ORIGIN + "/account/usage",
        },
        timeoutMs: 10000,
      })
    } catch (e) {
      ctx.host.log.warn("web request failed (" + path + "): " + String(e))
      return null
    }
    if (typeof resp.bodyText === "string" && resp.bodyText.indexOf("Just a moment") !== -1) {
      ctx.host.log.warn("cloudflare challenge on " + path + " — paste the full cookie string incl. cf_clearance")
      return null
    }
    if (ctx.util.isAuthStatus(resp.status)) {
      ctx.host.log.warn("web request unauthorized (" + path + "): status=" + String(resp.status))
      return null
    }
    if (resp.status < 200 || resp.status >= 300) {
      ctx.host.log.warn("web request status " + String(resp.status) + " (" + path + ")")
      return null
    }
    const parsed = ctx.util.tryParseJson(resp.bodyText)
    if (!parsed || typeof parsed !== "object") {
      ctx.host.log.warn("web request returned invalid JSON (" + path + ")")
      return null
    }
    return parsed
  }

  function describeModeAvailability(mode) {
    if (!mode || typeof mode !== "object") return null
    const detail = mode.remaining_detail || mode.remainingDetail
    if (detail && detail.kind === "exact") {
      const n = Number(detail.remaining)
      if (Number.isFinite(n)) return String(Math.max(0, Math.floor(n))) + " remaining"
    }
    if (mode.available === true) return "available"
    if (mode.available === false) return "not available"
    return null
  }

  function probeViaCookie(ctx, cookieHeader) {
    ctx.host.log.info("session loaded from provider account (web cookie)")

    const status = fetchWebJson(ctx, cookieHeader, "/rest/rate-limit/status")
    const authSession = fetchWebJson(ctx, cookieHeader, "/api/auth/session")
    const credits =
      fetchWebJson(ctx, cookieHeader, "/rest/billing/credits") ||
      fetchWebJson(ctx, cookieHeader, "/rest/billing/credits/computer-submit-gate")

    if (!status && !authSession && !credits) {
      throw "Session cookie rejected. Re-copy it from a logged-in perplexity.ai tab."
    }

    const lines = []

    const balanceCents = credits ? readNumberField(credits, ["balance_cents", "balanceCents"]) : null
    if (balanceCents !== null && Number.isFinite(balanceCents)) {
      lines.push(ctx.line.text({
        label: "API credits",
        value: "$" + (balanceCents / 100).toFixed(2),
      }))
    }

    const modes = status && (status.modes || status.Modes)
    if (modes && typeof modes === "object") {
      for (let i = 0; i < WEB_MODE_CATEGORIES.length; i += 1) {
        const cat = WEB_MODE_CATEGORIES[i]
        const text = describeModeAvailability(modes[cat.key])
        if (text) lines.push(ctx.line.text({ label: cat.label, value: text }))
      }
    }

    if (lines.length === 0) throw "Usage data unavailable. Try again later."

    const user = authSession && authSession.user
    const tier = user && (user.subscription_tier || user.subscriptionTier)
    const plan =
      typeof tier === "string" && tier
        ? tier
            .split("_")
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(" ")
        : null

    return plan ? { plan: plan, lines: lines } : { lines: lines }
  }

  function probe(ctx) {
    const cred = ctx.util.readProviderCredential && ctx.util.readProviderCredential()
    const credToken = cred && cred.accessToken ? String(cred.accessToken).trim() : ""
    if (credToken && looksLikeCookieCredential(credToken)) {
      return probeViaCookie(ctx, buildCookieHeader(credToken))
    }

    const session = loadLocalSession(ctx)
    if (!session) {
      throw "Not logged in. Auto-detect needs the macOS app; on Windows/Linux paste a perplexity.ai session cookie in Set credentials."
    }
    if (session.sourcePath) ctx.host.log.info("using cache db: " + session.sourcePath)

    const restState = fetchRestState(ctx, session)
    if (!restState || (!restState.group && !restState.user && !restState.rateLimits)) throw "Unable to connect. Try again later."

    const customerInfo = restState.group && restState.group.customerInfo
    const plan = detectPlanLabel(customerInfo, restState.user)

    const dollarLines = []
    const balanceUsd = restState.group ? readBalanceUsd(restState.group) : null
    if (balanceUsd !== null && balanceUsd > 0) {
      const usedUsd = sumUsageCostUsd(restState.usageAnalytics)
      if (usedUsd !== null) {
        const usedCents = Math.max(0, Math.round(usedUsd * 100))
        const limitCents = Math.max(0, Math.round(balanceUsd * 100))
        if (Number.isFinite(limitCents) && limitCents > 0) {
          dollarLines.push(ctx.line.progress({
            label: "API credits",
            used: usedCents / 100,
            limit: limitCents / 100,
            format: { kind: "dollars" },
          }))
        }
      }
    }

    const rateLines = buildRateLimitLines(ctx, restState.rateLimits)

    const lines = dollarLines.concat(rateLines)
    if (lines.length === 0) {
      if (balanceUsd !== null && balanceUsd > 0) throw "Usage data unavailable. Try again later."
      if (plan) throw "Rate limits unavailable. Try again later."
      throw "Balance unavailable. Try again later."
    }

    return plan ? { plan: plan, lines: lines } : { lines: lines }
  }

  globalThis.__openusage_plugin = { id: "perplexity", probe: probe }
})()
