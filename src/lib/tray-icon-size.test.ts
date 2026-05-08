import { describe, expect, it, vi } from "vitest"
import { getTrayIconSizePx, resolveTrayIconBasePt } from "@/lib/tray-icon-size"

describe("tray-icon-size", () => {
  it("resolveTrayIconBasePt is 18 on macOS, 30 on Windows and Linux desktop", () => {
    expect(resolveTrayIconBasePt("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe(18)
    expect(resolveTrayIconBasePt("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(30)
    expect(resolveTrayIconBasePt("Mozilla/5.0 (X11; Linux x86_64)")).toBe(30)
    expect(resolveTrayIconBasePt("")).toBe(18)
    expect(resolveTrayIconBasePt("Mozilla/5.0 (Linux; Android 14)")).toBe(18)
  })

  it("getTrayIconSizePx is 18/36 at 1x/2x with macOS UA", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" })
    try {
      expect(getTrayIconSizePx(1)).toBe(18)
      expect(getTrayIconSizePx(2)).toBe(36)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("getTrayIconSizePx is 30/60 at 1x/2x with Windows UA", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" })
    try {
      expect(getTrayIconSizePx(1)).toBe(30)
      expect(getTrayIconSizePx(2)).toBe(60)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
