import { beforeEach, describe, expect, it, vi } from "vitest"
import { makeCtx } from "../test-helpers.js"

const LOAD_CODE_ASSIST_URL = "https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist"
const FETCH_MODELS_URL = "https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels"
const RETRIEVE_QUOTA_URL = "https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota"
const RETRIEVE_QUOTA_SUMMARY_URL =
  "https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary"
const RETRIEVE_QUOTA_SUMMARY_FALLBACK_URL =
  "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary"
const LOGIN_MESSAGE = "Not logged in. Run `agy` and complete Google sign-in first."
const SESSION_EXPIRED_MESSAGE =
  "Google sign-in expired. Run `agy` and complete Google sign-in again."
const REQUEST_FAILED_MESSAGE = "Antigravity CLI quota request failed. Check your connection and try again."
const GOOGLE_OAUTH_URL = "https://oauth2.googleapis.com/token"

const loadPlugin = async () => {
  await import("./plugin.js")
  return globalThis.__openusage_plugin
}

function setKeychain(ctx, value) {
  ctx.host.keychain.readGenericPassword.mockImplementation((service, account) => {
    if (service === "gemini" && account === "antigravity") return value
    return null
  })
}

function mockResponses(ctx, responses) {
  ctx.host.http.request.mockImplementation((opts) => {
    const url = String(opts.url)
    if (!responses[url] && url.includes("retrieveUserQuotaSummary")) {
      return json(404, { error: { status: "NOT_FOUND" } })
    }
    if (!responses[url]) throw new Error("unexpected url: " + url)
    return responses[url](opts)
  })
}

function json(status, body) {
  return { status, bodyText: JSON.stringify(body) }
}

function makeQuotaSummaryResponse(overrides) {
  return Object.assign(
    {
      groups: [
        {
          displayName: "Gemini Models",
          buckets: [
            { bucketId: "gemini-weekly", remainingFraction: 0.97993034, resetTime: "2026-07-16T23:55:18Z" },
            { bucketId: "gemini-5h", remainingFraction: 0.879582, resetTime: "2026-07-10T04:55:18Z" },
          ],
        },
        {
          displayName: "Claude and GPT models",
          buckets: [
            { bucketId: "3p-weekly", remainingFraction: 1, resetTime: "2026-07-17T03:09:22Z" },
            { bucketId: "3p-5h", remainingFraction: 1, resetTime: "2026-07-10T08:09:22Z" },
          ],
        },
      ],
    },
    overrides
  )
}

describe("antigravity-cli plugin", () => {
  beforeEach(() => {
    delete globalThis.__openusage_plugin
    vi.resetModules()
  })

  it("loads a raw keychain bearer token and parses retrieveUserQuotaSummary", async () => {
    const ctx = makeCtx()
    setKeychain(ctx, "Bearer raw-token")
    mockResponses(ctx, {
      [RETRIEVE_QUOTA_SUMMARY_URL]: (opts) => {
        expect(opts.headers.Authorization).toBe("Bearer raw-token")
        expect(opts.headers["User-Agent"]).toBe("antigravity")
        expect(opts.bodyText).toBe("{}")
        return json(200, makeQuotaSummaryResponse())
      },
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    expect(plugin.id).toBe("antigravity-cli")
    expect(result.plan).toBeUndefined()
    expect(result.lines.map((line) => line.label)).toEqual([
      "Session",
      "Weekly",
      "Session — Claude and GPT Models",
      "Weekly — Claude and GPT Models",
    ])
    expect(result.lines.map((line) => line.used)).toEqual([12, 2, 0, 0])
    expect(result.lines.map((line) => line.color)).toEqual(["#4285F4", "#4285F4", "#4285F4", "#4285F4"])
    expect(result.lines.find((line) => line.label === "Weekly").periodDurationMs).toBe(604800000)
    expect(ctx.host.http.request).toHaveBeenCalledTimes(1)
  })

  it("falls back from daily quota summary host to standard quota summary host", async () => {
    const ctx = makeCtx()
    setKeychain(ctx, "token")
    mockResponses(ctx, {
      [RETRIEVE_QUOTA_SUMMARY_URL]: () => json(503, { error: { status: "UNAVAILABLE" } }),
      [RETRIEVE_QUOTA_SUMMARY_FALLBACK_URL]: () => json(200, makeQuotaSummaryResponse()),
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    expect(result.lines.map((line) => line.label)).toEqual([
      "Session",
      "Weekly",
      "Session — Claude and GPT Models",
      "Weekly — Claude and GPT Models",
    ])
    expect(ctx.host.http.request.mock.calls.map(([opts]) => opts.url)).toEqual([
      RETRIEVE_QUOTA_SUMMARY_URL,
      RETRIEVE_QUOTA_SUMMARY_FALLBACK_URL,
    ])
  })

  it("retries retrieveUserQuotaSummary after 401 using refresh_token", async () => {
    const ctx = makeCtx()
    setKeychain(
      ctx,
      JSON.stringify({
        token: {
          access_token: "live-token",
          refresh_token: "refresh-abc",
          expiry: new Date(Date.now() + 3_600_000).toISOString(),
        },
      })
    )
    var summaryCalls = 0
    mockResponses(ctx, {
      [GOOGLE_OAUTH_URL]: () =>
        json(200, { access_token: "fresh-token", expires_in: 3600, token_type: "Bearer" }),
      [RETRIEVE_QUOTA_SUMMARY_URL]: (opts) => {
        summaryCalls += 1
        if (summaryCalls === 1) {
          expect(opts.headers.Authorization).toBe("Bearer live-token")
          return json(401, {})
        }
        expect(opts.headers.Authorization).toBe("Bearer fresh-token")
        return json(200, makeQuotaSummaryResponse())
      },
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    expect(result.lines.find((line) => line.label === "Session").used).toBe(12)
    expect(summaryCalls).toBe(2)
    expect(ctx.host.keychain.writeGenericPasswordForAccount).toHaveBeenCalledWith(
      "gemini",
      "antigravity",
      expect.stringContaining("fresh-token")
    )
  })

  it("loads an OAuth-style JSON keychain token", async () => {
    const ctx = makeCtx()
    setKeychain(ctx, JSON.stringify({ access_token: "json-token", refresh_token: "refresh" }))
    mockResponses(ctx, {
      [LOAD_CODE_ASSIST_URL]: () => json(200, {}),
      [FETCH_MODELS_URL]: (opts) => {
        expect(opts.headers.Authorization).toBe("Bearer json-token")
        return json(200, {
          models: [{ label: "Gemini Pro", quotaInfo: { remainingFraction: 1 } }],
        })
      },
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.plan).toBeUndefined()
    expect(result.lines.find((line) => line.label === "Gemini Pro").used).toBe(0)
  })

  it("loads agy secret-service JSON (token.access_token)", async () => {
    const ctx = makeCtx()
    setKeychain(
      ctx,
      JSON.stringify({
        token: {
          access_token: "agy-secret-token",
          token_type: "Bearer",
          refresh_token: "refresh",
        },
        auth_method: "consumer",
      })
    )
    mockResponses(ctx, {
      [LOAD_CODE_ASSIST_URL]: () => json(200, { userTier: { name: "Pro" } }),
      [FETCH_MODELS_URL]: (opts) => {
        expect(opts.headers.Authorization).toBe("Bearer agy-secret-token")
        return json(200, {
          models: [{ label: "Gemini Pro", model: "gemini-3-pro", quotaInfo: { remainingFraction: 0.5 } }],
        })
      },
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.plan).toBe("Pro")
    expect(result.lines.find((line) => line.label === "Gemini Pro").used).toBe(50)
  })

  it("loads a go-keyring-base64 wrapped JSON token", async () => {
    const ctx = makeCtx()
    const encoded = ctx.base64.encode(JSON.stringify({ tokens: { accessToken: "wrapped-token" } }))
    setKeychain(ctx, "go-keyring-base64:" + encoded)
    mockResponses(ctx, {
      [LOAD_CODE_ASSIST_URL]: () => json(200, {}),
      [FETCH_MODELS_URL]: (opts) => {
        expect(opts.headers.Authorization).toBe("Bearer wrapped-token")
        return json(200, {
          models: [{ label: "Gemini Flash", model: "gemini-flash", quotaInfo: { remainingFraction: 0.55 } }],
        })
      },
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.lines.find((line) => line.label === "Gemini Flash").used).toBe(45)
  })

  it("throws agy login instruction when keychain entry is missing", async () => {
    const ctx = makeCtx()
    setKeychain(ctx, null)
    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow(LOGIN_MESSAGE)
    expect(ctx.host.http.request).not.toHaveBeenCalled()
  })

  it("treats fetchAvailableModels failure as optional and uses retrieveUserQuota", async () => {
    const ctx = makeCtx()
    setKeychain(ctx, "token")
    mockResponses(ctx, {
      [LOAD_CODE_ASSIST_URL]: () => json(200, { currentTier: { name: "Gemini Code Assist" } }),
      [FETCH_MODELS_URL]: () => json(400, { error: { message: 'Unknown name "metadata"' } }),
      [RETRIEVE_QUOTA_URL]: () => json(200, {
        buckets: [
          { modelId: "gemini-2.5-pro", remainingFraction: 0.4, resetTime: "2026-05-23T00:00:00Z" },
          { modelId: "gemini-2.5-flash", remainingFraction: 0.8, resetTime: "2026-05-23T00:00:00Z" },
        ],
      }),
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    expect(result.plan).toBe("Gemini Code Assist")
    expect(result.lines.find((line) => line.label === "Gemini Pro").used).toBe(60)
    expect(result.lines.find((line) => line.label === "Gemini Flash").used).toBe(20)
  })

  it("falls back to retrieveUserQuota nested buckets when fetchAvailableModels lacks quota", async () => {
    const ctx = makeCtx()
    setKeychain(ctx, "token")
    mockResponses(ctx, {
      [LOAD_CODE_ASSIST_URL]: () => json(200, { user: { tier: { name: "Ignored" } } }),
      [FETCH_MODELS_URL]: () => json(200, { models: [{ displayName: "Gemini Pro", model: "gemini-pro" }] }),
      [RETRIEVE_QUOTA_URL]: () => json(200, {
        quota: {
          pools: {
            gemini_pro: {
              buckets: [
                { modelId: "gemini-3-pro", remainingFraction: 0.7 },
                { modelId: "gemini-3-pro-high", remainingFraction: 0.2 },
              ],
            },
            gemini_flash: {
              buckets: [{ model_id: "gemini-3-flash", remainingFraction: 0.6 }],
            },
            third_party: {
              claude: [{ modelId: "claude-sonnet", remainingFraction: 0.3 }],
            },
          },
        },
      }),
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    expect(result.lines.find((line) => line.label === "Gemini Pro").used).toBe(80)
    expect(result.lines.find((line) => line.label === "Gemini Flash").used).toBe(40)
    expect(result.lines.find((line) => line.label === "Claude").used).toBe(70)
    expect(ctx.host.http.request).toHaveBeenCalledTimes(5)
  })

  it("returns no quota badge for missing or empty quota responses", async () => {
    const ctx = makeCtx()
    setKeychain(ctx, "token")
    mockResponses(ctx, {
      [LOAD_CODE_ASSIST_URL]: () => json(200, {}),
      [FETCH_MODELS_URL]: () => json(200, { models: [] }),
      [RETRIEVE_QUOTA_URL]: () => json(200, { quota: { pools: [] } }),
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.lines).toEqual([expect.objectContaining({ type: "badge", label: "Status", text: "No quota data" })])
  })

  it("ignores optional fetch 403 and still calls retrieveUserQuota", async () => {
    const ctx = makeCtx()
    setKeychain(ctx, "token")
    mockResponses(ctx, {
      [LOAD_CODE_ASSIST_URL]: () => json(200, { currentTier: { name: "Assist" } }),
      [FETCH_MODELS_URL]: () => json(403, { error: { status: "PERMISSION_DENIED" } }),
      [RETRIEVE_QUOTA_URL]: () => json(200, {
        buckets: [{ modelId: "gemini-2.5-pro", remainingFraction: 0.5 }],
      }),
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.lines.find((line) => line.label === "Gemini Pro").used).toBe(50)
    expect(ctx.host.http.request.mock.calls.length).toBeGreaterThanOrEqual(3)
  })

  it("throws session expired when token is rejected and refresh is unavailable", async () => {
    const ctx = makeCtx()
    setKeychain(ctx, "expired")
    mockResponses(ctx, {
      [LOAD_CODE_ASSIST_URL]: () => ({ status: 401, bodyText: "{}" }),
    })

    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow(SESSION_EXPIRED_MESSAGE)
  })

  it("refreshes an expired access token before quota requests", async () => {
    const ctx = makeCtx()
    const expiredAt = new Date(Date.now() - 60_000).toISOString()
    setKeychain(
      ctx,
      JSON.stringify({
        token: {
          access_token: "stale-token",
          refresh_token: "refresh-abc",
          expiry: expiredAt,
        },
        auth_method: "consumer",
      })
    )
    mockResponses(ctx, {
      [GOOGLE_OAUTH_URL]: () =>
        json(200, { access_token: "fresh-token", expires_in: 3600, token_type: "Bearer" }),
      [LOAD_CODE_ASSIST_URL]: (opts) => {
        expect(opts.headers.Authorization).toBe("Bearer fresh-token")
        return json(200, { userTier: { name: "Pro" } })
      },
      [FETCH_MODELS_URL]: (opts) => {
        expect(opts.headers.Authorization).toBe("Bearer fresh-token")
        return json(200, {
          models: [{ label: "Gemini Pro", model: "gemini-3-pro", quotaInfo: { remainingFraction: 0.5 } }],
        })
      },
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.plan).toBe("Pro")
    expect(ctx.host.keychain.writeGenericPasswordForAccount).toHaveBeenCalledWith(
      "gemini",
      "antigravity",
      expect.stringContaining("fresh-token")
    )
  })

  it("retries Cloud Code after 401 using refresh_token", async () => {
    const ctx = makeCtx()
    setKeychain(
      ctx,
      JSON.stringify({
        token: {
          access_token: "live-token",
          refresh_token: "refresh-abc",
          expiry: new Date(Date.now() + 3_600_000).toISOString(),
        },
      })
    )
    var loadCalls = 0
    mockResponses(ctx, {
      [GOOGLE_OAUTH_URL]: () =>
        json(200, { access_token: "fresh-token", expires_in: 3600, token_type: "Bearer" }),
      [LOAD_CODE_ASSIST_URL]: (opts) => {
        loadCalls += 1
        if (loadCalls === 1) {
          expect(opts.headers.Authorization).toBe("Bearer live-token")
          return json(401, {})
        }
        expect(opts.headers.Authorization).toBe("Bearer fresh-token")
        return json(200, { userTier: { name: "Retry OK" } })
      },
      [FETCH_MODELS_URL]: () =>
        json(200, {
          models: [{ label: "Gemini Flash", model: "gemini-flash", quotaInfo: { remainingFraction: 0.4 } }],
        }),
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    expect(result.plan).toBe("Retry OK")
    expect(loadCalls).toBe(2)
  })

  it("throws a clear request failure on transport errors", async () => {
    const ctx = makeCtx()
    setKeychain(ctx, "token")
    ctx.host.http.request.mockImplementation(() => {
      throw new Error("network down")
    })

    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow(REQUEST_FAILED_MESSAGE)
  })

  it("throws a clear request failure for malformed HTTP responses", async () => {
    const ctx = makeCtx()
    setKeychain(ctx, "token")
    mockResponses(ctx, {
      [LOAD_CODE_ASSIST_URL]: () => ({ bodyText: "{}" }),
    })

    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow(REQUEST_FAILED_MESSAGE)
  })

  it("does not read legacy Gemini OAuth files", async () => {
    const ctx = makeCtx()
    const existsCalls = []
    const readCalls = []
    ctx.host.fs.exists = (path) => {
      existsCalls.push(path)
      if (
        path === "~/.gemini/settings.json" ||
        path === "~/.gemini/oauth_creds.json" ||
        String(path).includes("@google/gemini-cli")
      ) {
        throw new Error("legacy Gemini path touched: " + path)
      }
      return path === "~/.gemini/antigravity-cli"
    }
    ctx.host.fs.readText = (path) => {
      readCalls.push(path)
      throw new Error("unexpected readText: " + path)
    }
    setKeychain(ctx, "token")
    mockResponses(ctx, {
      [LOAD_CODE_ASSIST_URL]: () => json(200, {}),
      [FETCH_MODELS_URL]: () => json(200, {
        models: [{ label: "Gemini Pro", model: "gemini-pro", quotaInfo: { remainingFraction: 0.5 } }],
      }),
    })

    const plugin = await loadPlugin()
    plugin.probe(ctx)

    expect(readCalls).not.toContain("~/.gemini/oauth_creds.json")
    expect(existsCalls).toContain("~/.gemini/antigravity-cli")
    expect(ctx.host.keychain.readGenericPassword).toHaveBeenCalledWith("gemini", "antigravity")
  })
})
