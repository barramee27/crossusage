import { spawnSync } from "node:child_process"
import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { makeCtx } from "../test-helpers.js"

const DARWIN_PATH = "~/Library/Application Support/JetBrains/WebStorm2025.3/options/AIAssistantQuotaManager2.xml"
const LINUX_PATH = "~/.config/JetBrains/IntelliJIdea2025.3/options/AIAssistantQuotaManager2.xml"

const loadPlugin = async () => {
  await import("./plugin.js")
  return globalThis.__openusage_plugin
}

function encodeXmlValue(value) {
  return JSON.stringify(value, null, 4)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "&#10;")
}

function makeQuotaXml({ quotaInfo, nextRefill }) {
  return [
    "<application>",
    '  <component name="AIAssistantQuotaManager2">',
    `    <option name="nextRefill" value="${encodeXmlValue(nextRefill)}" />`,
    `    <option name="quotaInfo" value="${encodeXmlValue(quotaInfo)}" />`,
    "  </component>",
    "</application>",
  ].join("\n")
}

describe("jetbrains-ai-assistant plugin", () => {
  beforeEach(() => {
    delete globalThis.__openusage_plugin
    vi.resetModules()
  })

  it("parses quota xml and emits quota + remaining lines", async () => {
    const ctx = makeCtx()
    ctx.host.fs.writeText(
      DARWIN_PATH,
      makeQuotaXml({
        quotaInfo: {
          type: "Available",
          current: "75",
          maximum: "100",
          available: "25",
          until: "2099-01-31T00:00:00Z",
        },
        nextRefill: {
          type: "Known",
          next: "2099-01-01T00:00:00Z",
          tariff: { amount: "100", duration: "PT720H" },
        },
      })
    )

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)

    const quota = result.lines.find((line) => line.label === "Quota")
    const used = result.lines.find((line) => line.label === "Used")
    const remaining = result.lines.find((line) => line.label === "Remaining")

    expect(quota && quota.used).toBe(75)
    expect(quota && quota.limit).toBe(100)
    expect(quota && quota.resetsAt).toBe("2099-01-01T00:00:00.000Z")
    expect(quota && quota.periodDurationMs).toBe(2592000000)
    expect(used && used.value).toBe("75")
    expect(remaining && remaining.value).toBe("25")
  })

  it("falls back to quota until when nextRefill is missing", async () => {
    const ctx = makeCtx()
    ctx.host.fs.writeText(
      DARWIN_PATH,
      makeQuotaXml({
        quotaInfo: {
          type: "Available",
          current: "50",
          maximum: "100",
          available: "50",
          until: "2099-01-31T00:00:00Z",
        },
        nextRefill: null,
      })
    )

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    const quota = result.lines.find((line) => line.label === "Quota")
    expect(quota && quota.resetsAt).toBe("2099-01-31T00:00:00.000Z")
  })

  it("prefers the quota state with the latest until window", async () => {
    const ctx = makeCtx()
    ctx.app.platform = "macos"

    ctx.host.fs.writeText(
      DARWIN_PATH,
      makeQuotaXml({
        quotaInfo: {
          type: "Available",
          current: "10",
          maximum: "100",
          available: "90",
          until: "2099-01-01T00:00:00Z",
        },
        nextRefill: { type: "Known", next: "2099-01-01T00:00:00Z", tariff: { amount: "0", duration: "PT720H" } },
      })
    )

    // Unknown platforms probe all base paths. Write second valid file in Linux path to verify latest-until selection.
    ctx.app.platform = "unknown"
    ctx.host.fs.writeText(
      LINUX_PATH,
      makeQuotaXml({
        quotaInfo: {
          type: "Available",
          current: "20",
          maximum: "100",
          available: "80",
          until: "2099-02-01T00:00:00Z",
        },
        nextRefill: { type: "Known", next: "2099-02-01T00:00:00Z", tariff: { amount: "0", duration: "PT720H" } },
      })
    )

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    const quota = result.lines.find((line) => line.label === "Quota")
    expect(quota && quota.used).toBe(20)
  })

  it("computes remaining when available is missing", async () => {
    const ctx = makeCtx()
    ctx.host.fs.writeText(
      DARWIN_PATH,
      makeQuotaXml({
        quotaInfo: {
          type: "Available",
          current: "60",
          maximum: "100",
          until: "2099-01-31T00:00:00Z",
        },
        nextRefill: { type: "Known", next: "2099-01-01T00:00:00Z", tariff: { amount: "0", duration: "P30D" } },
      })
    )

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    const remaining = result.lines.find((line) => line.label === "Remaining")
    expect(remaining && remaining.value).toBe("40")
  })

  it("prefers explicit tariff/topUp available over maximum-current math", async () => {
    const ctx = makeCtx()
    ctx.host.fs.writeText(
      DARWIN_PATH,
      makeQuotaXml({
        quotaInfo: {
          type: "Available",
          current: "90",
          maximum: "100",
          // Intentionally inconsistent to verify explicit available is preferred.
          tariffQuota: { current: "90", maximum: "100", available: "12.5" },
          topUpQuota: { current: "0", maximum: "0", available: "3.5" },
          until: "2099-01-31T00:00:00Z",
        },
        nextRefill: { type: "Known", next: "2099-01-01T00:00:00Z", tariff: { amount: "0", duration: "P30D" } },
      })
    )

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    const remaining = result.lines.find((line) => line.label === "Remaining")
    expect(remaining && remaining.value).toBe("16")
  })

  it("breaks equal-until ties by higher used ratio", async () => {
    const ctx = makeCtx()
    ctx.app.platform = "unknown"

    ctx.host.fs.writeText(
      DARWIN_PATH,
      makeQuotaXml({
        quotaInfo: {
          type: "Available",
          current: "80",
          maximum: "100",
          available: "20",
          until: "2099-01-31T00:00:00Z",
        },
        nextRefill: { type: "Known", next: "2099-01-01T00:00:00Z", tariff: { amount: "0", duration: "PT720H" } },
      })
    )
    ctx.host.fs.writeText(
      LINUX_PATH,
      makeQuotaXml({
        quotaInfo: {
          type: "Available",
          current: "30",
          maximum: "100",
          available: "70",
          until: "2099-01-31T00:00:00Z",
        },
        nextRefill: { type: "Known", next: "2099-01-01T00:00:00Z", tariff: { amount: "0", duration: "PT720H" } },
      })
    )

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    const used = result.lines.find((line) => line.label === "Used")
    expect(used && used.value).toBe("80")
  })

  it("converts JetBrains raw quota units to credits for display", async () => {
    const ctx = makeCtx()
    ctx.host.fs.writeText(
      DARWIN_PATH,
      makeQuotaXml({
        quotaInfo: {
          type: "Available",
          current: "1981684.92",
          maximum: "2367648.941",
          tariffQuota: { current: "1981684.92", maximum: "2367648.941", available: "385964.21" },
          topUpQuota: { current: "0", maximum: "0", available: "0" },
          until: "2026-04-30T21:00:00Z",
        },
        nextRefill: {
          type: "Known",
          next: "2026-03-14T06:00:54.020Z",
          tariff: { amount: "2000000", duration: "PT720H" },
        },
      })
    )

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    const used = result.lines.find((line) => line.label === "Used")
    const remaining = result.lines.find((line) => line.label === "Remaining")

    expect(used && used.value).toBe("19.82 / 23.68 credits")
    expect(remaining && remaining.value).toBe("3.86 credits")
  })

  it("throws when no quota file is detected", async () => {
    const ctx = makeCtx()
    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("JetBrains AI Assistant not detected")
  })

  it("throws when quota payload is present but invalid", async () => {
    const ctx = makeCtx()
    ctx.host.fs.writeText(
      DARWIN_PATH,
      makeQuotaXml({
        quotaInfo: {
          type: "Available",
          current: "0",
          maximum: "0",
          until: "2099-01-31T00:00:00Z",
        },
        nextRefill: { type: "Known", next: "2099-01-01T00:00:00Z", tariff: { amount: "0", duration: "PT720H" } },
      })
    )

    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("quota data unavailable")
  })

  it("discovers quota on windows", async () => {
    const ctx = makeCtx()
    ctx.app.platform = "windows"
    ctx.host.fs.writeText(
      "~/AppData/Roaming/JetBrains/WebStorm2025.3/options/AIAssistantQuotaManager2.xml",
      makeQuotaXml({
        quotaInfo: { current: "50", maximum: "100", available: "50", until: "2099-01-31T00:00:00Z" },
        nextRefill: { type: "Known", next: "2099-01-01T00:00:00Z", tariff: { amount: "100", duration: "PT720H" } },
      })
    )

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    const quota = result.lines.find((line) => line.label === "Quota")
    expect(quota && quota.used).toBe(50)
  })

  it("continues gracefully when listDir throws", async () => {
    const ctx = makeCtx()
    ctx.host.fs.writeText(DARWIN_PATH, makeQuotaXml({
      quotaInfo: { current: "50", maximum: "100", available: "50", until: "2099-01-31T00:00:00Z" },
      nextRefill: null,
    }))
    ctx.host.fs.listDir = () => { throw new Error("permission denied") }

    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("JetBrains AI Assistant not detected")
  })

  it("throws when quota file exists but quotaInfo element is absent", async () => {
    const ctx = makeCtx()
    ctx.host.fs.writeText(
      DARWIN_PATH,
      '<application><component name="AIAssistantQuotaManager2"></component></application>'
    )

    const plugin = await loadPlugin()
    expect(() => plugin.probe(ctx)).toThrow("quota data unavailable")
  })

  it("parses P30D and P4W durations", async () => {
    const ctx = makeCtx()
    ctx.host.fs.writeText(
      DARWIN_PATH,
      makeQuotaXml({
        quotaInfo: { current: "50", maximum: "100", available: "50", until: "2099-01-31T00:00:00Z" },
        nextRefill: { type: "Known", next: "2099-01-01T00:00:00Z", tariff: { amount: "100", duration: "P30D" } },
      })
    )
    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    const quota = result.lines.find((line) => line.label === "Quota")
    expect(quota && quota.periodDurationMs).toBe(30 * 24 * 60 * 60 * 1000)

    delete globalThis.__openusage_plugin
    vi.resetModules()
    ctx.host.fs.writeText(
      DARWIN_PATH,
      makeQuotaXml({
        quotaInfo: { current: "50", maximum: "100", available: "50", until: "2099-01-31T00:00:00Z" },
        nextRefill: { type: "Known", next: "2099-01-01T00:00:00Z", tariff: { amount: "100", duration: "P4W" } },
      })
    )
    const plugin2 = await loadPlugin()
    const result2 = plugin2.probe(ctx)
    const quota2 = result2.lines.find((line) => line.label === "Quota")
    expect(quota2 && quota2.periodDurationMs).toBe(4 * 7 * 24 * 60 * 60 * 1000)
  })

  it("prefers live IDE JSON-RPC over stale AIAssistantQuotaManager2.xml (#41)", async () => {
    const ctx = makeCtx()
    ctx.app.platform = "windows"

    // Stale XML showing 86% used (14% remaining)
    ctx.host.fs.writeText(
      "~/AppData/Roaming/JetBrains/Rider2025.3/options/AIAssistantQuotaManager2.xml",
      makeQuotaXml({
        quotaInfo: {
          current: "860000",
          maximum: "1000000",
          available: "140000",
          until: "2026-11-30T00:00:00Z",
        },
        nextRefill: {
          type: "Known",
          next: "2026-11-30T00:00:00Z",
          tariff: { amount: "1000000", duration: "P30D" },
        },
      })
    )

    // Running IDE instance registered in ~/.junie/instances/12345.json
    ctx.host.fs.writeText(
      "~/.junie/instances/12345.json",
      JSON.stringify({
        schema_version: 3,
        plugin_version: "253.1.0",
        project_path: "C:/work/app",
        port: 54321,
        pid: 12345,
        rpc_token: "secret-rpc-token",
      })
    )

    ctx.host.http.request.mockImplementation((opts) => {
      expect(opts.url).toBe("http://127.0.0.1:54321/rpc")
      expect(opts.headers.Authorization).toBe("secret-rpc-token")
      const body = JSON.parse(opts.bodyText)
      expect(body.method).toBe("JunieSystemService.getQuotaInfo")
      return {
        status: 200,
        bodyText: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: {
            licenseName: "JetBrains AI Pro",
            licenseType: "AIP",
            creditsUsed: 250000,
            creditsMaximum: 1000000,
            creditsAvailable: 750000,
            nextRefillMillis: Date.parse("2026-12-01T00:00:00Z"),
            error: null,
          },
        }),
      }
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    const quota = result.lines.find((line) => line.label === "Quota")
    const used = result.lines.find((line) => line.label === "Used")
    const remaining = result.lines.find((line) => line.label === "Remaining")

    expect(result.plan).toBe("JetBrains AI Pro")
    expect(quota && quota.used).toBe(25)
    expect(used && used.value).toBe("2.5 / 10 credits")
    expect(remaining && remaining.value).toBe("7.5 credits")
  })

  it("queries Junie cloud API when IDE is closed and secure_credentials.json exists", async () => {
    const ctx = makeCtx()
    ctx.host.fs.writeText(
      DARWIN_PATH,
      makeQuotaXml({
        quotaInfo: {
          current: "860000",
          maximum: "1000000",
          available: "140000",
          until: "2026-11-30T00:00:00Z",
        },
        nextRefill: {
          type: "Known",
          next: "2026-11-30T00:00:00Z",
          tariff: { amount: "1000000", duration: "P30D" },
        },
      })
    )

    ctx.host.fs.writeText(
      "~/.junie/secure_credentials.json",
      JSON.stringify({
        secrets: [
          {
            key: "jb-account-stored",
            secret: JSON.stringify({
              jbAccount: {
                id_token: "live-jwt-token",
                refresh_token: "refresh-token",
              },
            }),
          },
        ],
      })
    )

    ctx.host.http.request.mockImplementation((opts) => {
      if (opts.url === "https://ingrazzio-cloud-prod.labs.jb.gg/auth/test") {
        expect(opts.headers.Authorization).toBe("Bearer live-jwt-token")
        return {
          status: 200,
          bodyText: JSON.stringify({
            username: "pmarti9",
            active: true,
            balanceLeft: 600000,
            licenseType: "AIP",
            balanceUnit: "CREDITS",
          }),
        }
      }
      return { status: 404, bodyText: "" }
    })

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    const quota = result.lines.find((line) => line.label === "Quota")
    const remaining = result.lines.find((line) => line.label === "Remaining")

    expect(result.plan).toBe("JetBrains AI Pro")
    expect(quota && quota.used).toBe(40)
    expect(remaining && remaining.value).toBe("6 credits")
  })

  it("reads newer quota state from idea.log when XML has not flushed", async () => {
    const ctx = makeCtx()
    ctx.app.platform = "windows"

    ctx.host.fs.writeText(
      "~/AppData/Roaming/JetBrains/Rider2025.3/options/AIAssistantQuotaManager2.xml",
      makeQuotaXml({
        quotaInfo: {
          current: "860000",
          maximum: "1000000",
          available: "140000",
          until: "2026-10-30T00:00:00Z",
        },
        nextRefill: null,
      })
    )

    ctx.host.fs.writeText(
      "~/AppData/Local/JetBrains/Rider2025.3/log/idea.log",
      [
        "2026-11-02 10:00:00,000 [ 12345] INFO - #c.i.m.l.c.q.QuotaManager2Impl - New quota info is received: {\"type\":\"Available\",\"current\":\"300000\",\"maximum\":\"1000000\",\"available\":\"700000\",\"until\":\"2026-11-30T00:00:00Z\"}",
      ].join("\n")
    )

    const plugin = await loadPlugin()
    const result = plugin.probe(ctx)
    const quota = result.lines.find((line) => line.label === "Quota")
    expect(quota && quota.used).toBe(30)
  })

  function writeStoredAccount(ctx, jbAccount, simpleToken) {
    const stored = {}
    if (simpleToken) stored.simpleToken = simpleToken
    if (jbAccount) stored.jbAccount = jbAccount
    ctx.host.fs.writeText(
      "~/.junie/secure_credentials.json",
      JSON.stringify({
        secrets: [{ key: "jb-account-stored", secret: JSON.stringify(stored) }],
      })
    )
  }

  function makeJwt(ctx, payload) {
    const header = ctx.base64.encode(JSON.stringify({ alg: "none", typ: "JWT" }))
    const body = ctx.base64.encode(JSON.stringify(payload))
    return `${header}.${body}.sig`
  }

  function quotaLines(result) {
    return {
      quota: result.lines.find((line) => line.label === "Quota"),
      used: result.lines.find((line) => line.label === "Used"),
      remaining: result.lines.find((line) => line.label === "Remaining"),
    }
  }

  it("raises a too-small local cap when a Pro balance is still inside 20 credits", async () => {
    const ctx = makeCtx()
    ctx.host.fs.writeText(
      DARWIN_PATH,
      makeQuotaXml({
        quotaInfo: {
          current: "200000",
          maximum: "1000000",
          available: "800000",
          until: "2099-01-31T00:00:00Z",
        },
        nextRefill: null,
      })
    )
    writeStoredAccount(ctx, { id_token: "live-jwt-token" })
    ctx.host.http.request.mockImplementation(() => ({
      status: 200,
      bodyText: JSON.stringify({ balanceLeft: 1500000, licenseType: "AIP" }),
    }))

    const plugin = await loadPlugin()
    const { quota, used, remaining } = quotaLines(plugin.probe(ctx))
    expect(quota && quota.used).toBe(25)
    expect(used && used.value).toBe("5 / 20 credits")
    expect(remaining && remaining.value).toBe("15 credits")
  })

  it("uses the 20 credit Pro tariff when the cloud balance has no local maximum", async () => {
    const ctx = makeCtx()
    writeStoredAccount(ctx, { id_token: "live-jwt-token", refresh_token: "refresh-token" })
    ctx.host.http.request.mockImplementation((opts) => {
      if (opts.url === "https://ingrazzio-cloud-prod.labs.jb.gg/auth/test") {
        return {
          status: 200,
          bodyText: JSON.stringify({ balanceLeft: 1500000, licenseType: "AIP" }),
        }
      }
      return { status: 404, bodyText: "" }
    })

    const plugin = await loadPlugin()
    const { quota, used, remaining } = quotaLines(plugin.probe(ctx))
    expect(quota && quota.used).toBe(25)
    expect(used && used.value).toBe("5 / 20 credits")
    expect(remaining && remaining.value).toBe("15 credits")
  })

  it("expands the Ultimate cap when the live balance exceeds 70 credits", async () => {
    const ctx = makeCtx()
    writeStoredAccount(ctx, { id_token: "live-jwt-token" })
    ctx.host.http.request.mockImplementation(() => ({
      status: 200,
      bodyText: JSON.stringify({ balanceLeft: 8000000, licenseType: "AIPU" }),
    }))

    const plugin = await loadPlugin()
    const { quota, used, remaining } = quotaLines(plugin.probe(ctx))
    expect(quota && quota.used).toBe(0)
    expect(used && used.value).toBe("0 / 80 credits")
    expect(remaining && remaining.value).toBe("80 credits")
  })

  it("reports an exhausted unknown plan instead of dropping the cloud probe", async () => {
    const ctx = makeCtx()
    writeStoredAccount(ctx, { id_token: "live-jwt-token" })
    ctx.host.http.request.mockImplementation(() => ({
      status: 200,
      bodyText: JSON.stringify({ balanceLeft: 0, licenseType: "JUNP" }),
    }))

    const plugin = await loadPlugin()
    const { quota, used, remaining } = quotaLines(plugin.probe(ctx))
    expect(quota && quota.used).toBe(100)
    expect(used && used.value).toBe("10 / 10 credits")
    expect(remaining && remaining.value).toBe("0 credits")
  })

  it("refreshes an expired JetBrains id_token before calling /auth/test", async () => {
    const ctx = makeCtx()
    const expired = makeJwt(ctx, { exp: 1 })
    writeStoredAccount(ctx, { id_token: expired, refresh_token: "refresh-token" })
    const authHeaders = []
    ctx.host.http.request.mockImplementation((opts) => {
      if (opts.url === "https://oauth.account.jetbrains.com/oauth2/token") {
        expect(opts.bodyText).toContain("grant_type=refresh_token")
        expect(opts.bodyText).toContain(`refresh_token=${encodeURIComponent("refresh-token")}`)
        return {
          status: 200,
          bodyText: JSON.stringify({ id_token: "refreshed-id-token" }),
        }
      }
      if (opts.url === "https://ingrazzio-cloud-prod.labs.jb.gg/auth/test") {
        authHeaders.push(opts.headers.Authorization)
        return {
          status: 200,
          bodyText: JSON.stringify({ balanceLeft: 5000000, licenseType: "AIPU" }),
        }
      }
      return { status: 404, bodyText: "" }
    })

    const plugin = await loadPlugin()
    const { quota, used, remaining } = quotaLines(plugin.probe(ctx))
    expect(authHeaders).toEqual(["Bearer refreshed-id-token"])
    expect(quota && quota.used).toBeCloseTo((20 / 70) * 100, 5)
    expect(used && used.value).toBe("20 / 70 credits")
    expect(remaining && remaining.value).toBe("50 credits")
  })

  it("retries /auth/test once after a 401 by refreshing the JetBrains token", async () => {
    const ctx = makeCtx()
    const valid = makeJwt(ctx, { exp: Math.floor(Date.parse("2099-01-01T00:00:00Z") / 1000) })
    writeStoredAccount(ctx, { id_token: valid, refresh_token: "refresh-token" })
    const authHeaders = []
    ctx.host.http.request.mockImplementation((opts) => {
      if (opts.url === "https://oauth.account.jetbrains.com/oauth2/token") {
        return {
          status: 200,
          bodyText: JSON.stringify({ access_token: "refreshed-access-token" }),
        }
      }
      if (opts.url === "https://ingrazzio-cloud-prod.labs.jb.gg/auth/test") {
        authHeaders.push(opts.headers.Authorization)
        if (authHeaders.length === 1) return { status: 401, bodyText: "" }
        return {
          status: 200,
          bodyText: JSON.stringify({ balanceLeft: 1500000, licenseType: "AIP" }),
        }
      }
      return { status: 404, bodyText: "" }
    })

    const plugin = await loadPlugin()
    const { quota, remaining } = quotaLines(plugin.probe(ctx))
    expect(authHeaders).toEqual(["Bearer " + valid, "Bearer refreshed-access-token"])
    expect(quota && quota.used).toBe(25)
    expect(remaining && remaining.value).toBe("15 credits")
  })

  function writeSessionQuota(ctx, sessionId, quota, observedAtMs) {
    ctx.host.fs.writeText(
      `~/.junie/sessions/${sessionId}/events.jsonl`,
      JSON.stringify({
        timestampMs: observedAtMs,
        completion: { quota },
      })
    )
  }

  it("prefers the IDE quota file over an older Junie session with a later until", async () => {
    const ctx = makeCtx()
    ctx.host.fs.writeText(
      DARWIN_PATH,
      makeQuotaXml({
        quotaInfo: {
          current: "30",
          maximum: "100",
          available: "70",
          until: "2099-01-31T00:00:00Z",
        },
        nextRefill: { type: "Known", next: "2099-01-31T00:00:00Z", tariff: { amount: "100", duration: "P30D" } },
      })
    )
    writeSessionQuota(
      ctx,
      "session-old",
      { current: "80", maximum: "100", available: "20", until: "2099-06-01T00:00:00Z" },
      Date.parse("2020-01-01T00:00:00Z")
    )

    const plugin = await loadPlugin()
    const used = plugin.probe(ctx).lines.find((line) => line.label === "Used")
    expect(used && used.value).toBe("30")
  })

  it("does not let a same-window Junie session outrank the IDE quota file", async () => {
    const ctx = makeCtx()
    ctx.host.fs.writeText(
      DARWIN_PATH,
      makeQuotaXml({
        quotaInfo: {
          current: "30",
          maximum: "100",
          available: "70",
          until: "2099-01-31T00:00:00Z",
        },
        nextRefill: { type: "Known", next: "2099-01-31T00:00:00Z", tariff: { amount: "100", duration: "P30D" } },
      })
    )
    writeSessionQuota(
      ctx,
      "session-recent",
      { current: "80", maximum: "100", available: "20", until: "2099-01-31T00:00:00Z" },
      Date.parse("2026-02-01T12:00:00Z")
    )

    const plugin = await loadPlugin()
    const used = plugin.probe(ctx).lines.find((line) => line.label === "Used")
    expect(used && used.value).toBe("30")
  })

  it("uses a recent Junie session when its billing window is newer than XML", async () => {
    const ctx = makeCtx()
    ctx.host.fs.writeText(
      DARWIN_PATH,
      makeQuotaXml({
        quotaInfo: {
          current: "30",
          maximum: "100",
          available: "70",
          until: "2099-01-31T00:00:00Z",
        },
        nextRefill: { type: "Known", next: "2099-01-31T00:00:00Z", tariff: { amount: "100", duration: "P30D" } },
      })
    )
    writeSessionQuota(
      ctx,
      "session-new-window",
      { current: "10", maximum: "100", available: "90", until: "2099-06-01T00:00:00Z" },
      Date.parse("2026-02-01T12:00:00Z")
    )

    const plugin = await loadPlugin()
    const used = plugin.probe(ctx).lines.find((line) => line.label === "Used")
    expect(used && used.value).toBe("10")
  })

  it("prefers a current idea.log over an older session with the same until", async () => {
    const ctx = makeCtx()
    ctx.host.fs.writeText(
      "~/Library/Logs/JetBrains/WebStorm2025.3/log/idea.log",
      '2026-02-02 00:00:00,000 [ 1] INFO - #c.i.m.l.c.q.QuotaManager2Impl - New quota info is received: {"type":"Available","current":"30","maximum":"100","available":"70","until":"2099-01-31T00:00:00Z"}'
    )
    writeSessionQuota(
      ctx,
      "session-260101-000000-old",
      { current: "90", maximum: "100", available: "10", until: "2099-01-31T00:00:00Z" },
      Date.parse("2026-01-01T00:00:00Z")
    )

    const plugin = await loadPlugin()
    const used = plugin.probe(ctx).lines.find((line) => line.label === "Used")
    expect(used && used.value).toBe("30")
  })

  it("keeps a Junie session that is newer than idea.log", async () => {
    const ctx = makeCtx()
    ctx.host.fs.writeText(
      "~/Library/Logs/JetBrains/WebStorm2025.3/log/idea.log",
      '2026-02-01 10:00:00,000 [ 1] INFO - #c.i.m.l.c.q.QuotaManager2Impl - New quota info is received: {"type":"Available","current":"30","maximum":"100","available":"70","until":"2099-01-31T00:00:00Z"}'
    )
    writeSessionQuota(
      ctx,
      "session-260202-120000-new",
      { current: "80", maximum: "100", available: "20", until: "2099-01-31T00:00:00Z" },
      Date.parse("2026-02-02T12:00:00Z")
    )

    const plugin = await loadPlugin()
    const used = plugin.probe(ctx).lines.find((line) => line.label === "Used")
    expect(used && used.value).toBe("80")
  })

  it("reads idea.log timestamps as local wall time, not UTC", () => {
    const pluginFile = path.join(process.cwd(), "plugins/jetbrains-ai-assistant/plugin.js")
    const script = `
      const pluginFile = process.argv[1]
      await import(new URL("file://" + pluginFile).href)
      const plugin = globalThis.__openusage_plugin
      const files = new Map()
      const write = (path, text) => files.set(path, text)
      const fs = {
        exists(path) {
          if (files.has(path)) return true
          const base = String(path).replace(/\\/+$/, "")
          for (const filePath of files.keys()) {
            if (String(filePath).startsWith(base + "/")) return true
          }
          return false
        },
        readText: (path) => files.get(path),
        listDir(path) {
          const base = String(path).replace(/\\/+$/, "")
          const out = new Set()
          for (const filePath of files.keys()) {
            const full = String(filePath)
            if (!full.startsWith(base + "/")) continue
            const child = full.slice(base.length + 1).split("/")[0]
            if (child) out.add(child)
          }
          return Array.from(out).sort()
        },
      }
      const noop = () => {}
      const ctx = {
        nowIso: "2026-02-02T00:00:00.000Z",
        app: { platform: "darwin", version: "0", appDataDir: "/tmp", pluginDataDir: "/tmp/p" },
        host: { fs, log: { debug: noop, info: noop, warn: noop, error: noop, trace: noop } },
        util: {
          tryParseJson(text) {
            try { return JSON.parse(text) } catch { return null }
          },
          parseDateMs(value) {
            const parsed = Date.parse(value)
            return Number.isFinite(parsed) ? parsed : null
          },
          toIso(value) {
            if (typeof value !== "string" || !value) return null
            const parsed = Date.parse(value)
            return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
          },
        },
        line: { progress: (line) => line, text: (line) => line },
      }
      const localMs = new Date(2026, 1, 2, 10, 0, 0, 0).getTime()
      const utcMs = Date.parse("2026-02-02T10:00:00.000Z")
      if (localMs === utcMs) {
        console.error("timezone offset is zero; cannot tell local wall time from UTC")
        process.exit(2)
      }
      write(
        "~/Library/Logs/JetBrains/WebStorm2025.3/log/idea.log",
        '2026-02-02 10:00:00,000 [ 1] INFO - #c.i.m.l.c.q.QuotaManager2Impl - New quota info is received: {"type":"Available","current":"30","maximum":"100","available":"70","until":"2099-01-31T00:00:00Z"}'
      )
      write(
        "~/.junie/sessions/session-mid/events.jsonl",
        JSON.stringify({
          timestampMs: Math.round((localMs + utcMs) / 2),
          completion: {
            quota: { current: "80", maximum: "100", available: "20", until: "2099-01-31T00:00:00Z" },
          },
        })
      )
      const used = plugin.probe(ctx).lines.find((line) => line.label === "Used")
      const expectUsed = localMs < utcMs ? "80" : "30"
      if (!used || used.value !== expectUsed) {
        console.error(JSON.stringify({ expectUsed, got: used && used.value, localMs, utcMs }))
        process.exit(1)
      }
    `
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", script, pluginFile], {
      env: { ...process.env, TZ: "Pacific/Auckland" },
      encoding: "utf8",
    })
    expect(child.status, child.stderr || child.stdout).toBe(0)
  })

  it("keeps the live XML maximum when a stale session would shrink the cloud cap", async () => {
    const ctx = makeCtx()
    ctx.host.fs.writeText(
      DARWIN_PATH,
      makeQuotaXml({
        quotaInfo: {
          current: "1981684.92",
          maximum: "2367648.941",
          available: "385964.021",
          until: "2099-01-31T00:00:00Z",
        },
        nextRefill: null,
      })
    )
    writeSessionQuota(
      ctx,
      "session-old-cloud",
      {
        current: "900000",
        maximum: "1000000",
        available: "100000",
        until: "2099-06-01T00:00:00Z",
      },
      Date.parse("2020-01-01T00:00:00Z")
    )
    writeStoredAccount(ctx, { id_token: "live-jwt-token" })
    ctx.host.http.request.mockImplementation(() => ({
      status: 200,
      bodyText: JSON.stringify({ balanceLeft: 1500000, licenseType: "AIP" }),
    }))

    const plugin = await loadPlugin()
    const { quota, used, remaining } = quotaLines(plugin.probe(ctx))
    expect(used && used.value).toBe("8.68 / 23.68 credits")
    expect(remaining && remaining.value).toBe("15 credits")
    expect(quota && quota.used).toBeCloseTo((867648.941 / 2367648.941) * 100, 4)
  })

  it("still reads a Junie session when no IDE quota file or log exists", async () => {
    const ctx = makeCtx()
    writeSessionQuota(
      ctx,
      "session-260101-000000-cli",
      { current: "40", maximum: "100", available: "60", until: "2099-01-31T00:00:00Z" },
      Date.parse("2020-06-01T00:00:00Z")
    )

    const plugin = await loadPlugin()
    const used = plugin.probe(ctx).lines.find((line) => line.label === "Used")
    expect(used && used.value).toBe("40")
  })
})
