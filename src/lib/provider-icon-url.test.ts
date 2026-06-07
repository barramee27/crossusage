import { describe, expect, it } from "vitest"
import { isRasterProviderIconUrl } from "@/lib/provider-icon-url"

describe("isRasterProviderIconUrl", () => {
  it("detects png data urls", () => {
    expect(isRasterProviderIconUrl("data:image/png;base64,abc")).toBe(true)
  })

  it("treats svg data urls as mask icons", () => {
    expect(isRasterProviderIconUrl("data:image/svg+xml;base64,abc")).toBe(false)
  })
})
