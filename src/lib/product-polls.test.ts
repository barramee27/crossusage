import { describe, expect, it } from "vitest"
import {
  isPollExpired,
  parseProductPoll,
  parseProductPollResults,
  shouldShowUnansweredPoll,
  shouldThrottleFetch,
  versionSatisfies,
  PRODUCT_POLLS_FETCH_THROTTLE_MS,
} from "@/lib/product-polls"

const sample = {
  id: "p1",
  version: 1,
  title: "Pick one",
  body: "Context",
  options: [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
    { id: "c", label: "C" },
  ],
  allowDismiss: true,
  minAppVersion: "1.4.0",
  expiresAt: null,
  ended: false,
}

describe("product-polls", () => {
  it("parses variable-length options", () => {
    const poll = parseProductPoll(sample)
    expect(poll?.options).toHaveLength(3)
    expect(poll?.title).toBe("Pick one")
  })

  it("rejects too few options", () => {
    expect(
      parseProductPoll({
        ...sample,
        options: [{ id: "a", label: "A" }],
      }),
    ).toBeNull()
  })

  it("versionSatisfies compares semver prefixes", () => {
    expect(versionSatisfies("1.4.0", "1.4.0")).toBe(true)
    expect(versionSatisfies("1.3.3", "1.4.0")).toBe(false)
    expect(versionSatisfies("1.4.1", "1.4.0")).toBe(true)
    expect(versionSatisfies(null, "1.4.0")).toBe(true)
  })

  it("isPollExpired", () => {
    expect(isPollExpired(null)).toBe(false)
    expect(isPollExpired("2099-01-01T00:00:00Z")).toBe(false)
    expect(isPollExpired("2000-01-01T00:00:00Z")).toBe(true)
  })

  it("shouldShowUnansweredPoll filters answered/dismissed/ended", () => {
    const poll = parseProductPoll(sample)!
    expect(
      shouldShowUnansweredPoll({
        poll,
        appVersion: "1.4.0",
        answered: {},
        dismissed: {},
      }),
    ).toBe(true)

    expect(
      shouldShowUnansweredPoll({
        poll,
        appVersion: "1.3.0",
        answered: {},
        dismissed: {},
      }),
    ).toBe(false)

    expect(
      shouldShowUnansweredPoll({
        poll,
        appVersion: "1.4.0",
        answered: { p1: "a" },
        dismissed: {},
      }),
    ).toBe(false)

    expect(
      shouldShowUnansweredPoll({
        poll,
        appVersion: "1.4.0",
        answered: {},
        dismissed: { p1: Date.now() },
      }),
    ).toBe(false)

    expect(
      shouldShowUnansweredPoll({
        poll: { ...poll, ended: true },
        appVersion: "1.4.0",
        answered: {},
        dismissed: {},
      }),
    ).toBe(false)
  })

  it("shouldThrottleFetch respects 1h window", () => {
    const now = 1_000_000
    expect(shouldThrottleFetch(null, now)).toBe(false)
    expect(shouldThrottleFetch(now - 1000, now)).toBe(true)
    expect(shouldThrottleFetch(now - PRODUCT_POLLS_FETCH_THROTTLE_MS - 1, now)).toBe(false)
  })

  it("parseProductPollResults", () => {
    const r = parseProductPollResults({
      pollId: "p1",
      total: 10,
      counts: { a: 6, b: 4 },
      winnerId: "a",
      ended: false,
    })
    expect(r?.winnerId).toBe("a")
    expect(r?.counts.a).toBe(6)
  })
})
