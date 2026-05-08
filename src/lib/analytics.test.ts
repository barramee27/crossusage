import { describe, expect, it } from "vitest"
import { track } from "./analytics"

describe("analytics track", () => {
  it("is a no-op (UI Aptabase events removed; Rust may still emit lifecycle events)", () => {
    expect(() => track("setting_changed", { setting: "theme", value: "dark" })).not.toThrow()
  })
})
