(function () {
  const AUTH_PATH = "~/.grok/auth.json"
  const BILLING_URL = "https://cli-chat-proxy.grok.com/v1/billing?format=credits"
  const SETTINGS_URL = "https://cli-chat-proxy.grok.com/v1/settings"
  const REFRESH_URL = "https://auth.x.ai/oauth2/token"
  const DEFAULT_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828"
  const TOKEN_AUTH_HEADER = "xai-grok-cli"
  const AUTH_REFRESH_BUFFER_MS = 5 * 60 * 1000
  const LOGIN_HINT = "Grok auth expired. Run `grok login` again."

  function readJson(ctx, path) {
    if (!ctx.host.fs.exists(path)) return null
    try {
      return ctx.util.tryParseJson(ctx.host.fs.readText(path))
    } catch {
      return null
    }
  }

  function entryExpiresAtMs(ctx, entry) {
    if (!entry || typeof entry !== "object") return null
    if (entry.expires_at) return ctx.util.parseDateMs(entry.expires_at)
    if (entry.expires) return ctx.util.parseDateMs(entry.expires)
    return null
  }

  function tokenExpiresAtMs(ctx, token) {
    const payload = ctx.jwt.decodePayload(token)
    if (!payload || typeof payload.exp !== "number") return null
    return payload.exp * 1000
  }

  function needsRefresh(ctx, entry, token, nowMs) {
    const entryMs = entryExpiresAtMs(ctx, entry)
    const tokenMs = tokenExpiresAtMs(ctx, token)
    const entryNeedsRefresh = entryMs !== null && ctx.util.needsRefreshByExpiry({
      nowMs,
      expiresAtMs: entryMs,
      bufferMs: AUTH_REFRESH_BUFFER_MS,
    })
    const tokenNeedsRefresh = tokenMs !== null && ctx.util.needsRefreshByExpiry({
      nowMs,
      expiresAtMs: tokenMs,
      bufferMs: AUTH_REFRESH_BUFFER_MS,
    })
    return entryNeedsRefresh || tokenNeedsRefresh
  }

  function isExpired(ctx, entry, token, nowMs) {
    const entryMs = entryExpiresAtMs(ctx, entry)
    const tokenMs = tokenExpiresAtMs(ctx, token)
    const expiresAtMs = tokenMs !== null ? tokenMs : entryMs
    if (expiresAtMs === null) return false
    return nowMs >= expiresAtMs
  }

  function readRefreshToken(entry) {
    if (!entry || typeof entry !== "object") return ""
    const refreshToken = typeof entry.refresh_token === "string" ? entry.refresh_token.trim() : ""
    if (refreshToken) return refreshToken
    return typeof entry.refresh === "string" ? entry.refresh.trim() : ""
  }

  function readClientId(entryKey, entry) {
    if (entry && typeof entry.oidc_client_id === "string" && entry.oidc_client_id.trim()) {
      return entry.oidc_client_id.trim()
    }
    const parts = String(entryKey || "").split("::")
    const fromKey = parts.length > 1 ? parts[parts.length - 1].trim() : ""
    return fromKey || DEFAULT_CLIENT_ID
  }

  function nowMs(ctx) {
    return ctx.util.parseDateMs(ctx.nowIso) || Date.now()
  }

  function refreshAuth(ctx, auth, entryKey, entry) {
    const refreshToken = readRefreshToken(entry)
    if (!refreshToken) {
      ctx.host.log.warn("refresh skipped: no refresh token")
      return null
    }

    ctx.host.log.info("attempting Grok auth refresh")
    try {
      const resp = ctx.util.request({
        method: "POST",
        url: REFRESH_URL,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        bodyText:
          "grant_type=refresh_token" +
          "&client_id=" + encodeURIComponent(readClientId(entryKey, entry)) +
          "&refresh_token=" + encodeURIComponent(refreshToken),
        timeoutMs: 15000,
      })

      if (resp.status === 400 || resp.status === 401 || resp.status === 403) {
        const body = ctx.util.tryParseJson(resp.bodyText)
        const code = body && ((body.error && body.error.code) || body.error || body.code)
        ctx.host.log.error("Grok auth refresh failed: status=" + resp.status + " code=" + String(code))
        return null
      }
      if (resp.status < 200 || resp.status >= 300) {
        ctx.host.log.warn("Grok auth refresh returned status: " + resp.status)
        return null
      }

      const body = ctx.util.tryParseJson(resp.bodyText)
      if (!body || typeof body.access_token !== "string" || !body.access_token.trim()) {
        ctx.host.log.warn("Grok auth refresh response missing access_token")
        return null
      }

      const accessToken = body.access_token.trim()
      entry.key = accessToken
      if (typeof body.refresh_token === "string" && body.refresh_token.trim()) {
        entry.refresh_token = body.refresh_token.trim()
      }
      if (typeof body.id_token === "string" && body.id_token.trim()) {
        entry.id_token = body.id_token.trim()
      }

      const refreshedAtMs = nowMs(ctx)
      const expiresIn = Number(body.expires_in)
      const tokenExpiryMs = tokenExpiresAtMs(ctx, accessToken)
      const expiresAtMs = Number.isFinite(expiresIn) && expiresIn > 0
        ? refreshedAtMs + expiresIn * 1000
        : tokenExpiryMs || refreshedAtMs + 3600 * 1000
      entry.expires_at = new Date(expiresAtMs).toISOString()

      try {
        ctx.host.fs.writeText(AUTH_PATH, JSON.stringify(auth, null, 2))
        ctx.host.log.info("Grok auth refresh succeeded, token persisted")
      } catch (e) {
        ctx.host.log.warn("Grok auth refresh succeeded but failed to save auth: " + String(e))
      }

      return accessToken
    } catch (e) {
      if (typeof e === "string") throw e
      ctx.host.log.error("Grok auth refresh exception: " + String(e))
      return null
    }
  }

  function loadAuth(ctx) {
    const credential = ctx.util.readProviderCredential && ctx.util.readProviderCredential()
    if (credential && credential.accessToken) {
      ctx.host.log.info("auth loaded from provider account")
      return { auth: null, entryKey: "provider-account", entry: credential, token: credential.accessToken }
    }
    const auth = readJson(ctx, AUTH_PATH)
    if (!auth || typeof auth !== "object") {
      throw "Grok not logged in. Run `grok login`."
    }

    const currentMs = nowMs(ctx)
    let expiredCandidate = false
    const keys = Object.keys(auth)
    for (let i = 0; i < keys.length; i++) {
      const entryKey = keys[i]
      const entry = auth[entryKey]
      if (!entry || typeof entry !== "object") continue
      const token = typeof entry.key === "string" ? entry.key.trim() : ""
      if (!token) continue
      if (needsRefresh(ctx, entry, token, currentMs)) {
        const refreshed = refreshAuth(ctx, auth, entryKey, entry)
        if (refreshed) return { auth, entryKey, entry, token: refreshed }
        if (!isExpired(ctx, entry, token, currentMs)) {
          ctx.host.log.warn("Grok refresh failed, trying existing access token")
          return { auth, entryKey, entry, token }
        }
        expiredCandidate = true
        continue
      }
      return { auth, entryKey, entry, token }
    }

    if (expiredCandidate) {
      throw LOGIN_HINT
    }
    throw "Grok auth invalid. Run `grok login` again."
  }

  function unitsValue(obj) {
    if (!obj || typeof obj !== "object") return null
    const n = Number(obj.val)
    return Number.isFinite(n) ? n : null
  }

  function clampPercent(value) {
    const n = Number(value)
    if (!Number.isFinite(n)) return 0
    if (n < 0) return 0
    if (n > 100) return 100
    return n
  }

  function fetchBillingResponse(ctx, token) {
    try {
      return ctx.util.request({
        method: "GET",
        url: BILLING_URL,
        headers: {
          Authorization: "Bearer " + token,
          "X-XAI-Token-Auth": TOKEN_AUTH_HEADER,
          Accept: "application/json",
          "User-Agent": "OpenUsage",
        },
        timeoutMs: 10000,
      })
    } catch {
      throw "Grok billing request failed. Check your connection."
    }
  }

  function parseBilling(ctx, resp) {
    if (ctx.util.isAuthStatus(resp.status)) {
      throw LOGIN_HINT
    }
    if (resp.status < 200 || resp.status >= 300) {
      throw "Grok billing request failed (HTTP " + String(resp.status) + "). Try again later."
    }

    const data = ctx.util.tryParseJson(resp.bodyText)
    if (!data) {
      throw "Grok billing response changed."
    }
    return data
  }

  function fetchPlanName(ctx, token) {
    try {
      const resp = ctx.util.request({
        method: "GET",
        url: SETTINGS_URL,
        headers: {
          Authorization: "Bearer " + token,
          "X-XAI-Token-Auth": TOKEN_AUTH_HEADER,
          Accept: "application/json",
          "User-Agent": "OpenUsage",
        },
        timeoutMs: 10000,
      })
      if (resp.status < 200 || resp.status >= 300) return null
      const data = ctx.util.tryParseJson(resp.bodyText)
      const plan = data && data.subscription_tier_display
      return typeof plan === "string" && plan.trim() ? plan.trim() : null
    } catch {
      return null
    }
  }

  function parseCreditsConfig(config) {
    if (!config || typeof config !== "object") return null
    const period = config.currentPeriod
    if (!period || typeof period !== "object") return null
    const periodType = typeof period.type === "string" ? period.type.trim() : ""
    if (!periodType) return null
    const start = typeof period.start === "string" ? period.start : null
    const end = typeof period.end === "string" ? period.end : null
    if (!start || !end) return null
    let usedPercent = 0
    if (config.creditUsagePercent != null) {
      const n = Number(config.creditUsagePercent)
      if (!Number.isFinite(n)) return null
      usedPercent = n
    }
    const onDemandCapUnits = unitsValue(config.onDemandCap) || 0
    return {
      periodType,
      usedPercent,
      periodEnd: end,
      onDemandCapUnits,
    }
  }

  function dailyHasUsage(daily) {
    if (!Array.isArray(daily) || daily.length === 0) return false
    for (let i = 0; i < daily.length; i++) {
      const tokens = Number(daily[i] && daily[i].totalTokens)
      if (Number.isFinite(tokens) && tokens > 0) return true
    }
    return false
  }

  function queryGrokLogs(ctx) {
    if (!ctx.host.grokLogs || typeof ctx.host.grokLogs.queryDaily !== "function") {
      return { status: "no_data", data: { daily: [] } }
    }
    const since = new Date()
    since.setDate(since.getDate() - 30)
    const y = since.getFullYear()
    const m = since.getMonth() + 1
    const d = since.getDate()
    const sinceStr = "" + y + (m < 10 ? "0" : "") + m + (d < 10 ? "0" : "") + d
    try {
      const native = ctx.host.grokLogs.queryDaily({ since: sinceStr })
      if (native && native.status === "ok" && native.data && Array.isArray(native.data.daily)) {
        return native
      }
    } catch (e) {
      ctx.host.log.warn("grokLogs scan failed: " + String(e))
    }
    return { status: "no_data", data: { daily: [] } }
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
    if (isoMatch) return isoMatch[1] + "-" + isoMatch[2] + "-" + isoMatch[3]
    const isoDatePrefixMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[Tt\s]|$)/)
    if (isoDatePrefixMatch) {
      return isoDatePrefixMatch[1] + "-" + isoDatePrefixMatch[2] + "-" + isoDatePrefixMatch[3]
    }
    const compactMatch = value.match(/^(\d{4})(\d{2})(\d{2})$/)
    if (compactMatch) return compactMatch[1] + "-" + compactMatch[2] + "-" + compactMatch[3]
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
    return parts.join(" \u00b7 ")
  }

  function modelTokenCount(modelUsage) {
    if (!modelUsage || typeof modelUsage !== "object") return 0
    const total = Number(modelUsage.totalTokens)
    if (Number.isFinite(total) && total > 0) return total
    return 0
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
    const names = Object.keys(totals)
    if (names.length === 0) return undefined
    let sumPct = 0
    const rows = names.map((name) => {
      const row = totals[name]
      return { model: name, tokens: row.tokens, costUsd: row.costUsd }
    }).sort((a, b) => b.tokens - a.tokens || a.model.localeCompare(b.model))
    const totalTokens = rows.reduce((sum, row) => sum + row.tokens, 0)
    if (totalTokens <= 0) return undefined
    for (let i = 0; i < rows.length; i++) {
      const pct = (rows[i].tokens / totalTokens) * 100
      rows[i].percent = i === rows.length - 1 ? Math.max(0, 100 - sumPct) : Math.round(pct * 10) / 10
      sumPct += rows[i].percent
      if (rows[i].costUsd == null || rows[i].costUsd <= 0) delete rows[i].costUsd
    }
    return rows
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

  function appendSpendLines(lines, ctx, usageResult) {
    if (!usageResult || usageResult.status !== "ok" || !usageResult.data) return
    const daily = usageResult.data.daily
    if (!Array.isArray(daily) || !dailyHasUsage(daily)) return

    const now = new Date()
    const todayKey = dayKeyFromDate(now)
    const yesterday = new Date(now.getTime())
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayKey = dayKeyFromDate(yesterday)
    let todayEntry = null
    let yesterdayEntry = null
    for (let i = 0; i < daily.length; i++) {
      const usageDayKey = dayKeyFromUsageDate(daily[i].date)
      if (usageDayKey === todayKey) {
        todayEntry = daily[i]
        continue
      }
      if (usageDayKey === yesterdayKey) yesterdayEntry = daily[i]
    }
    pushDayUsageLine(lines, ctx, "Today", todayEntry)
    pushDayUsageLine(lines, ctx, "Yesterday", yesterdayEntry)

    let totalTokens = 0
    let totalCostNanos = 0
    let hasCost = false
    for (let i = 0; i < daily.length; i++) {
      const dayTokens = Number(daily[i].totalTokens)
      if (Number.isFinite(dayTokens)) totalTokens += dayTokens
      const dayCost = usageCostUsd(daily[i])
      if (dayCost != null) {
        totalCostNanos += Math.round(dayCost * 1e9)
        hasCost = true
      }
    }
    if (totalTokens > 0) {
      lines.push(ctx.line.text({
        label: "Last 30 Days",
        value: costAndTokensLabel({ tokens: totalTokens, costUSD: hasCost ? totalCostNanos / 1e9 : null }),
        modelBreakdown: modelBreakdownForPeriod(daily),
      }))
    }
    const points = collectUsageChartPoints(daily)
    if (points.length === 0) return
    lines.push(ctx.line.barChart({
      label: "Usage Trend",
      points: points,
      note: "From your Grok logs (estimated)",
      color: "#000000",
    }))
  }

  function tryLoadAuth(ctx) {
    try {
      return { ok: true, auth: loadAuth(ctx) }
    } catch (e) {
      return { ok: false, error: e }
    }
  }

  function probe(ctx) {
    const usageResult = queryGrokLogs(ctx)
    const authResult = tryLoadAuth(ctx)
    if (!authResult.ok) {
      if (dailyHasUsage(usageResult.data && usageResult.data.daily)) {
        const lines = []
        appendSpendLines(lines, ctx, usageResult)
        return { plan: null, lines }
      }
      throw authResult.error
    }

    const auth = authResult.auth
    const billingResp = ctx.util.retryOnceOnAuth({
      request: (token) => fetchBillingResponse(ctx, token || auth.token),
      refresh: () => {
        const refreshed = refreshAuth(ctx, auth.auth, auth.entryKey, auth.entry)
        if (refreshed) auth.token = refreshed
        return refreshed
      },
    })
    const data = parseBilling(ctx, billingResp)
    const config = data && data.config
    if (!config || typeof config !== "object") {
      throw "Grok billing response changed."
    }

    const credits = parseCreditsConfig(config)
    if (!credits) {
      throw "Grok billing response changed."
    }

    const resetsAt = ctx.util.toIso(credits.periodEnd)
    if (!resetsAt) {
      throw "Grok billing response changed."
    }

    const lines = []
    if (credits.periodType === "USAGE_PERIOD_TYPE_WEEKLY") {
      lines.push(ctx.line.progress({
        label: "Weekly limit",
        used: clampPercent(credits.usedPercent),
        limit: 100,
        format: { kind: "percent" },
        resetsAt,
      }))
    }
    lines.push(ctx.line.badge({
      label: "Pay as you go",
      text: credits.onDemandCapUnits > 0 ? String(credits.onDemandCapUnits) + " cap" : "Disabled",
      color: credits.onDemandCapUnits > 0 ? "#22c55e" : "#a3a3a3",
    }))
    appendSpendLines(lines, ctx, usageResult)

    return { plan: fetchPlanName(ctx, auth.token), lines }
  }

  globalThis.__openusage_plugin = { id: "grok", probe }
})()
