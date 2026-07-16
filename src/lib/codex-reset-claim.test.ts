import { describe, expect, it } from "vitest"
import {
  claimBannerText,
  creditIdForExpiry,
  outcomeFromConsume,
  parseAvailableCount,
  resetsDetailContent,
} from "@/lib/codex-reset-claim"

describe("outcomeFromConsume", () => {
  it("maps protocol codes", () => {
    expect(outcomeFromConsume(200, JSON.stringify({ code: "reset" }))).toBe("success")
    expect(outcomeFromConsume(200, JSON.stringify({ code: "already_redeemed" }))).toBe("success")
    expect(outcomeFromConsume(200, JSON.stringify({ code: "nothing_to_reset" }))).toBe(
      "nothing_to_reset",
    )
    expect(outcomeFromConsume(200, JSON.stringify({ code: "no_credit" }))).toBe("no_credit")
    expect(outcomeFromConsume(200, JSON.stringify({ code: "something_new" }))).toBe("failed")
    expect(outcomeFromConsume(500, JSON.stringify({ code: "reset" }))).toBe("failed")
    expect(outcomeFromConsume(200, "not json")).toBe("failed")
  })
})

describe("creditIdForExpiry", () => {
  const expiry = "2026-07-12T03:57:42.000Z"
  const expiryMs = Date.parse(expiry)

  it("matches available credit by expiry", () => {
    const id = creditIdForExpiry(
      {
        credits: [
          { id: "other", status: "available", expires_at: "2026-08-01T00:00:00.000Z" },
          { id: "target", status: "available", expires_at: expiry },
        ],
      },
      expiryMs,
    )
    expect(id).toBe("target")
  })

  it("skips non-available but keeps missing status", () => {
    expect(
      creditIdForExpiry(
        { credits: [{ id: "gone", status: "redeemed", expires_at: expiry }] },
        expiryMs,
      ),
    ).toBeNull()
    expect(
      creditIdForExpiry(
        { credits: [{ id: "bare", expires_at: expiryMs / 1000 }] },
        expiryMs,
      ),
    ).toBe("bare")
  })
})

describe("resetsDetailContent", () => {
  it("distinguishes empty vs unknown expiries", () => {
    expect(resetsDetailContent(0, [])).toEqual({ kind: "empty" })
    expect(resetsDetailContent(2, [])).toEqual({ kind: "unknownExpiries", count: 2 })
    expect(resetsDetailContent(1, ["2026-07-12T00:00:00.000Z"]).kind).toBe("timeline")
  })
})

describe("claim helpers", () => {
  it("parses available count and banner copy", () => {
    expect(parseAvailableCount("3 available")).toBe(3)
    expect(claimBannerText("success")).toMatch(/claimed/i)
    expect(claimBannerText("nothing_to_reset")).toMatch(/doesn't need/i)
  })
})
