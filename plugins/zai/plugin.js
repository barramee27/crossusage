(function () {
  const BASE_URL = "https://api.z.ai"
  const SUBSCRIPTION_URL = BASE_URL + "/api/biz/subscription/list"
  const QUOTA_URL = BASE_URL + "/api/monitor/usage/quota/limit"
  const PERIOD_MS = 5 * 60 * 60 * 1000
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000
  const MONTH_MS = 30 * 24 * 60 * 60 * 1000
  const ERR_INVALID_RESPONSE = "Usage response invalid. Try again later."

  function loadApiKey(ctx) {
    const providerKey = ctx.util.providerApiKey && ctx.util.providerApiKey()
    if (providerKey) {
      ctx.host.log.info("api key loaded from provider account")
      return providerKey
    }
    const zai = ctx.host.env.get("ZAI_API_KEY")
    if (typeof zai === "string" && zai.trim()) return zai.trim()

    const glm = ctx.host.env.get("GLM_API_KEY")
    if (typeof glm === "string" && glm.trim()) return glm.trim()

    return null
  }

  function fetchSubscription(ctx, apiKey) {
    try {
      const resp = ctx.util.request({
        method: "GET",
        url: SUBSCRIPTION_URL,
        headers: {
          Authorization: "Bearer " + apiKey,
          Accept: "application/json",
        },
        timeoutMs: 10000,
      })
      if (resp.status < 200 || resp.status >= 300) {
        ctx.host.log.warn("subscription request failed: HTTP " + resp.status)
        return null
      }
      const data = ctx.util.tryParseJson(resp.bodyText)
      if (!data) return null
      const list = data.data
      if (!Array.isArray(list) || list.length === 0) return null
      return {
        productName: list[0].productName || null,
        nextRenewTime: list[0].nextRenewTime || null,
      }
    } catch (e) {
      ctx.host.log.warn("subscription request exception: " + String(e))
      return null
    }
  }

  function fetchQuota(ctx, apiKey) {
    let resp
    try {
      resp = ctx.util.request({
        method: "GET",
        url: QUOTA_URL,
        headers: {
          Authorization: "Bearer " + apiKey,
          Accept: "application/json",
        },
        timeoutMs: 10000,
      })
    } catch (e) {
      ctx.host.log.error("usage request exception: " + String(e))
      throw "Usage request failed. Check your connection."
    }

    if (ctx.util.isAuthStatus(resp.status)) {
      throw "API key invalid. Check your Z.ai API key."
    }

    if (resp.status < 200 || resp.status >= 300) {
      throw "Usage request failed (HTTP " + String(resp.status) + "). Try again later."
    }

    const data = ctx.util.tryParseJson(resp.bodyText)
    if (!data) {
      throw ERR_INVALID_RESPONSE
    }

    return data
  }

  /// Accept JSON numbers and numeric strings; reject booleans and non-finite values (#951).
  function parseNumber(value) {
    if (typeof value === "boolean") return null
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null
    }
    if (typeof value === "string") {
      const trimmed = value.trim()
      if (!trimmed) return null
      const n = Number(trimmed)
      return Number.isFinite(n) ? n : null
    }
    return null
  }

  function clampPercent(value) {
    if (!Number.isFinite(value)) return 0
    return Math.min(100, Math.max(0, value))
  }

  function findLimit(limits, type, unit) {
    let fallback = null
    for (let i = 0; i < limits.length; i++) {
      const item = limits[i]
      if (item.type === type || item.name === type) {
        if (unit === undefined) {
          return item
        }
        if (item.unit === unit) {
          return item
        }
        // Store first entry without unit as fallback
        if (fallback === null && item.unit === undefined) {
          fallback = item
        }
      }
    }
    return fallback
  }

  function mapTokenProgress(ctx, entry, label, periodMs) {
    const rawPercentage = parseNumber(entry.percentage)
    if (rawPercentage === null) throw ERR_INVALID_RESPONSE
    const used = clampPercent(rawPercentage)
    const resetsAt = entry.nextResetTime != null
      ? (parseNumber(entry.nextResetTime) != null ? ctx.util.toIso(parseNumber(entry.nextResetTime)) : undefined)
      : undefined

    const progressOpts = {
      label: label,
      used: used,
      limit: 100,
      format: { kind: "percent" },
      periodDurationMs: periodMs,
    }
    if (resetsAt) progressOpts.resetsAt = resetsAt
    return ctx.line.progress(progressOpts)
  }

  function mapWebSearches(ctx, entry) {
    const used = parseNumber(entry.currentValue)
    const limit = parseNumber(entry.usage)
    if (used === null || limit === null || used < 0 || limit < 0) {
      throw ERR_INVALID_RESPONSE
    }
    const now = new Date()
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
    let webResetsAt = nextMonth.toISOString()
    if (entry.nextResetTime != null) {
      const resetMs = parseNumber(entry.nextResetTime)
      if (resetMs !== null) webResetsAt = ctx.util.toIso(resetMs)
    }

    return ctx.line.progress({
      label: "Web Searches",
      used: used,
      limit: limit,
      format: { kind: "count", suffix: "/ " + limit },
      periodDurationMs: MONTH_MS,
      resetsAt: webResetsAt,
    })
  }

  function extractLimits(quota) {
    if (!quota || typeof quota !== "object") return null
    // Legacy: some payloads used a bare limits array at the root.
    if (Array.isArray(quota)) return quota
    if (quota.data !== undefined) {
      if (Array.isArray(quota.data)) return null // must be object envelope
      if (!quota.data || typeof quota.data !== "object") return null
      if (quota.data.limits === undefined) return null
      if (!Array.isArray(quota.data.limits)) return null
      return quota.data.limits
    }
    if (quota.limits === undefined) return null
    if (!Array.isArray(quota.limits)) return null
    return quota.limits
  }

  function probe(ctx) {
    const apiKey = loadApiKey(ctx)
    if (!apiKey) {
      throw "No ZAI_API_KEY found. Set up environment variable first."
    }

    const sub = fetchSubscription(ctx, apiKey)
    const plan = sub && sub.productName ? ctx.fmt.planLabel(sub.productName) : null

    const quota = fetchQuota(ctx, apiKey)
    const lines = []

    const limits = extractLimits(quota)
    if (limits === null) {
      throw ERR_INVALID_RESPONSE
    }
    if (limits.length === 0) {
      lines.push(ctx.line.badge({ label: "Status", text: "No usage data", color: "#a3a3a3" }))
      return { plan, lines }
    }

    const tokenLimit = findLimit(limits, "TOKENS_LIMIT", 3)
    if (tokenLimit) {
      lines.push(mapTokenProgress(ctx, tokenLimit, "Session", PERIOD_MS))
    }

    const weeklyTokenLimit = findLimit(limits, "TOKENS_LIMIT", 6)
    if (weeklyTokenLimit) {
      lines.push(mapTokenProgress(ctx, weeklyTokenLimit, "Weekly", WEEK_MS))
    }

    const timeLimit = findLimit(limits, "TIME_LIMIT")
    if (timeLimit) {
      lines.push(mapWebSearches(ctx, timeLimit))
    }

    if (lines.length === 0) {
      lines.push(ctx.line.badge({ label: "Status", text: "No usage data", color: "#a3a3a3" }))
    }

    return { plan, lines }
  }

  globalThis.__openusage_plugin = { id: "zai", probe }
})()
