import { describe, expect, it } from "vitest"
import { isFullColorProviderIconUrl, isRasterProviderIconUrl } from "@/lib/provider-icon-url"

describe("isRasterProviderIconUrl", () => {
  it("detects png data urls", () => {
    expect(isRasterProviderIconUrl("data:image/png;base64,abc")).toBe(true)
  })

  it("treats svg data urls as not raster", () => {
    expect(isRasterProviderIconUrl("data:image/svg+xml;base64,abc")).toBe(false)
  })
})

describe("isFullColorProviderIconUrl", () => {
  it("treats png data urls as full-color", () => {
    expect(isFullColorProviderIconUrl("data:image/png;base64,abc")).toBe(true)
  })

  it("treats currentColor svg data urls as mask icons", () => {
    const svg = encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path fill="currentColor" d="M0 0h10v10H0z"/></svg>',
    )
    expect(isFullColorProviderIconUrl(`data:image/svg+xml,${svg}`)).toBe(false)
  })

  it("treats gradient svg data urls as full-color", () => {
    const svg = encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g"><stop stop-color="#3186FF"/></linearGradient></defs><path fill="url(#g)" d="M0 0h10v10H0z"/></svg>',
    )
    expect(isFullColorProviderIconUrl(`data:image/svg+xml,${svg}`)).toBe(true)
  })
})
