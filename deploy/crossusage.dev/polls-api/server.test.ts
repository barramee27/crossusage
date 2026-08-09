import { describe, expect, test } from "bun:test"
import {
  checkBurst,
  clientIp,
  isValidDismissReason,
  isValidInstallId,
  versionSatisfies,
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
