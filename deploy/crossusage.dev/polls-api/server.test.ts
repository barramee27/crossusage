import { describe, expect, test } from "bun:test"
import {
  checkBurst,
  clientIp,
  isExpired,
  isValidDismissReason,
  isValidInstallId,
  selectActivePoll,
  versionSatisfies,
  type PollDef,
} from "./server.ts"

describe("polls-api anti-spam helpers", () => {
  test("isValidInstallId accepts uuid-like ids", () => {
    expect(isValidInstallId("550e8400-e29b-41d4-a716-446655440000")).toBe(true)
    expect(isValidInstallId("abc")).toBe(false)
    expect(isValidInstallId("not a uuid!!!")).toBe(false)
    expect(isValidInstallId("")).toBe(false)
  })

  test("isValidDismissReason", () => {
    expect(isValidDismissReason("not_now")).toBe(true)
    expect(isValidDismissReason("dont_ask")).toBe(true)
    expect(isValidDismissReason("nope")).toBe(false)
  })

  test("clientIp prefers X-Real-IP", () => {
    const req = new Request("http://x/vote", {
      headers: {
        "x-real-ip": "203.0.113.9",
        "x-forwarded-for": "198.51.100.1, 203.0.113.9",
      },
    })
    expect(clientIp(req)).toBe("203.0.113.9")
  })

  test("checkBurst trips after limit", () => {
    const key = `test-${Math.random()}`
    const now = Date.now()
    let last: number | null = null
    for (let i = 0; i < 20; i++) {
      last = checkBurst(key, now + i)
    }
    expect(last).not.toBeNull()
    expect(last!).toBeGreaterThan(0)
  })

  test("versionSatisfies", () => {
    expect(versionSatisfies("1.4.0", "1.0.0")).toBe(true)
    expect(versionSatisfies("0.9.0", "1.0.0")).toBe(false)
  })
})

function poll(over: Partial<PollDef> & Pick<PollDef, "id">): PollDef {
  return {
    title: "T",
    options: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ],
    active: true,
    ended: false,
    ...over,
  }
}

describe("selectActivePoll", () => {
  const now = Date.parse("2026-08-13T12:00:00.000Z")

  test("isExpired is false when expiresAt is missing", () => {
    expect(isExpired(undefined, now)).toBe(false)
  })

  test("isExpired is true at/after expiresAt", () => {
    expect(isExpired("2026-08-15T23:59:59.000Z", now)).toBe(false)
    expect(isExpired("2026-08-15T23:59:59.000Z", Date.parse("2026-08-15T23:59:59.000Z"))).toBe(true)
    expect(isExpired("2026-08-15T23:59:59.000Z", Date.parse("2026-08-16T00:00:00.000Z"))).toBe(true)
  })

  test("returns open poll", () => {
    const p = poll({ id: "open", expiresAt: "2026-08-15T23:59:59.000Z" })
    expect(selectActivePoll([p], "1.4.0", now)?.id).toBe("open")
  })

  test("keeps expired published poll so winner stays visible", () => {
    const p = poll({ id: "done", expiresAt: "2026-08-15T23:59:59.000Z" })
    const after = Date.parse("2026-08-16T00:00:00.000Z")
    expect(selectActivePoll([p], "1.4.0", after)?.id).toBe("done")
  })

  test("keeps ended:true published poll", () => {
    const p = poll({ id: "ended", ended: true })
    expect(selectActivePoll([p], "1.4.0", now)?.id).toBe("ended")
  })

  test("prefers an open poll over an expired one", () => {
    const expired = poll({ id: "old", expiresAt: "2026-08-01T00:00:00.000Z" })
    const open = poll({ id: "new", expiresAt: "2026-09-01T00:00:00.000Z" })
    expect(selectActivePoll([expired, open], "1.4.0", now)?.id).toBe("new")
  })

  test("hides polls with active:false", () => {
    const p = poll({ id: "hidden", active: false })
    expect(selectActivePoll([p], "1.4.0", now)).toBeNull()
  })
})
