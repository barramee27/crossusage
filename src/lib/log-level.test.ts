import { describe, expect, it } from "vitest"
import { DEFAULT_LOG_LEVEL, isLogLevel, LOG_LEVEL_OPTIONS } from "./log-level"

describe("log-level", () => {
  it("lists all runtime levels including off", () => {
    expect(LOG_LEVEL_OPTIONS.map((o) => o.value)).toEqual([
      "error",
      "warn",
      "info",
      "debug",
      "trace",
      "off",
    ])
  })

  it("defaults to info", () => {
    expect(DEFAULT_LOG_LEVEL).toBe("info")
  })

  it("validates known levels", () => {
    expect(isLogLevel("debug")).toBe(true)
    expect(isLogLevel("off")).toBe(true)
    expect(isLogLevel("verbose")).toBe(false)
  })
})
